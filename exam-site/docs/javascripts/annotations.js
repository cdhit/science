(() => {
  const icon = (name) => {
    const element = document.createElement('i');
    element.dataset.lucide = name;
    return element;
  };

  let cleanup = null;
  let activeArticle = null;
  const enhance = () => {
      const article = document.querySelector('.md-content__inner');
      if (!article || article === activeArticle) return;
      cleanup?.();
      activeArticle = article;
      const pathname = location.pathname.replace(/index\.html$/, '').replace(/\/?$/, '/');
      const key = `page:${pathname}`;
      const storageKey = `acas-annotations:${key}`;
      const anchors = new Map();
      Array.from(article.children).forEach((element, index) => anchors.set(`block:${index}`, element));
      article.querySelectorAll('img').forEach((element, index) => anchors.set(`image:${index}`, element));
      ['.md-header', '.md-sidebar--primary', '.md-sidebar--secondary', '.md-footer'].forEach((selector, index) => {
        const element = document.querySelector(selector);
        if (element) anchors.set(`region:${index}`, element);
      });
      const canvas = document.createElement('canvas');
      canvas.className = 'annotation-canvas page-annotation-canvas';
      canvas.setAttribute('aria-label', '\u5168\u9875\u753b\u7b14\u5c42');
      document.body.append(canvas);
      const context = canvas.getContext('2d');
      const toolbar = document.createElement('div');
      toolbar.className = 'annotation-toolbar page-annotation-toolbar';
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', '\u5168\u9875\u6807\u6ce8');
      document.body.append(toolbar);
      const status = document.createElement('span');
      status.className = 'annotation-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      let state = { revision: -1, generation: 0, strokes: [] };
      let pending = [];
      let history = [];
      let current = null;
      let tool = 'view';
      let color = '#dc3545';
      let width = 4;
      let loaded = false;
      let busy = false;
      let warning = '';
      let localAvailable = true;
      let cssWidth = 0;
      let cssHeight = 0;
      let disposed = false;
      let timer = null;
      try {
        const cached = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (cached && Array.isArray(cached.pending)) pending = cached.pending;
      } catch {
        localAvailable = false;
      }

      const setStatus = (message, problem = false) => {
        if (status.textContent !== message) status.textContent = message;
        status.dataset.problem = String(problem);
      };
      const persist = () => {
        try {
          if (pending.length) localStorage.setItem(storageKey, JSON.stringify({ pending }));
          else localStorage.removeItem(storageKey);
        } catch {
          localAvailable = false;
        }
      };
      const visibleStrokes = () => {
        let strokes = [...state.strokes];
        pending.forEach((operation) => {
          if (operation.generation !== state.generation) return;
          if (operation.action === 'clear') strokes = [];
          if (operation.action === 'remove') strokes = strokes.filter((stroke) => stroke.id !== operation.id);
          if (operation.action === 'add' && !strokes.some((stroke) => stroke.id === operation.stroke.id)) strokes.push(operation.stroke);
        });
        return strokes;
      };
      const anchorBounds = (identifier) => {
        if (identifier === 'document') return { left: -window.scrollX, top: -window.scrollY, width: document.documentElement.clientWidth, height: document.documentElement.scrollHeight };
        const element = anchors.get(identifier);
        if (!element?.isConnected) return null;
        const bounds = element.getBoundingClientRect();
        return bounds.width && bounds.height ? bounds : null;
      };
      const drawStroke = (stroke) => {
        const bounds = anchorBounds(stroke.anchor || 'document');
        if (!bounds) return;
        context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
        context.strokeStyle = stroke.color;
        context.fillStyle = stroke.color;
        context.lineWidth = stroke.width * bounds.width;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        stroke.points.forEach((point, index) => {
          if (index === 0) context.moveTo(bounds.left + point[0] * bounds.width, bounds.top + point[1] * bounds.height);
          else context.lineTo(bounds.left + point[0] * bounds.width, bounds.top + point[1] * bounds.height);
        });
        if (stroke.points.length === 1) {
          context.arc(bounds.left + stroke.points[0][0] * bounds.width, bounds.top + stroke.points[0][1] * bounds.height, context.lineWidth / 2, 0, Math.PI * 2);
          context.fill();
        } else context.stroke();
      };
      const render = () => {
        context.globalCompositeOperation = 'source-over';
        context.clearRect(0, 0, cssWidth, cssHeight);
        const strokes = visibleStrokes();
        strokes.forEach(drawStroke);
        if (current && current.generation === state.generation) drawStroke(current.stroke);
        undo.disabled = !loaded || !history.some((identifier) => strokes.some((stroke) => stroke.id === identifier));
        clear.disabled = !loaded || strokes.length === 0;
      };
      const resize = () => {
        cssWidth = document.documentElement.clientWidth;
        cssHeight = window.innerHeight;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(cssWidth * ratio));
        canvas.height = Math.max(1, Math.round(cssHeight * ratio));
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        render();
      };
      const adopt = (next) => {
        if (!Array.isArray(next.strokes) || !Number.isInteger(next.revision)) throw new Error('Invalid server response');
        if (next.revision < state.revision) return;
        state = next;
        loaded = true;
        const valid = pending.filter((operation) => operation.generation === state.generation);
        if (valid.length !== pending.length) {
          warning = '\u5176\u4ed6\u7aef\u5df2\u6e05\u7a7a\uff0c\u65e7\u7b14\u8ff9\u672a\u4e0a\u4f20';
          pending = valid;
          persist();
        }
        render();
      };
      const request = (options = {}) => fetch(`/api/annotations${options.method ? '' : `?key=${encodeURIComponent(key)}`}`, {
        cache: 'no-store', signal: AbortSignal.timeout(8000), ...options,
      });
      const sync = async () => {
        if (busy || disposed) return;
        busy = true;
        try {
          const response = await request();
          if (!response.ok) throw new Error('Backend unavailable');
          adopt(await response.json());
          while (pending.length && !disposed) {
            const operation = pending[0];
            setStatus('\u6b63\u5728\u540c\u6b65');
            const result = await request({
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key, ...operation }),
            });
            if (result.status === 409) {
              pending = pending.filter((item) => item !== operation);
              warning = '\u6807\u6ce8\u5df2\u66f4\u65b0\uff0c\u8bf7\u91cd\u65b0\u64cd\u4f5c';
              adopt(await result.json());
            } else if (result.ok) {
              pending = pending.filter((item) => item !== operation);
              adopt(await result.json());
            } else if (result.status === 400 || result.status === 413) {
              pending = pending.filter((item) => item !== operation);
              warning = '\u7b14\u8ff9\u8d85\u51fa\u9650\u5236\uff0c\u8bf7\u6e05\u7a7a\u540e\u91cd\u8bd5';
              render();
            } else throw new Error('Save failed');
            persist();
          }
          setStatus(warning || '\u5df2\u540c\u6b65', Boolean(warning));
        } catch {
          setStatus(pending.length ? (localAvailable ? '\u79bb\u7ebf\uff0c\u7b14\u8ff9\u5f85\u540c\u6b65' : '\u79bb\u7ebf\uff0c\u8bf7\u52ff\u5173\u95ed\u9875\u9762') : '\u540c\u6b65\u670d\u52a1\u672a\u8fde\u63a5', true);
        } finally {
          busy = false;
        }
      };
      const enqueue = (operation) => {
        warning = '';
        pending.push({ generation: state.generation, ...operation });
        persist();
        render();
        setStatus('\u7b49\u5f85\u540c\u6b65');
        void sync();
      };
      const button = (name, label, action) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'annotation-tool';
        control.title = label;
        control.setAttribute('aria-label', label);
        control.append(icon(name));
        control.addEventListener('click', action);
        toolbar.append(control);
        return control;
      };
      const modes = {};
      const selectTool = (next) => {
        tool = next;
        canvas.dataset.tool = next;
        Object.entries(modes).forEach(([name, control]) => control.setAttribute('aria-pressed', String(name === next)));
      };
      modes.view = button('mouse-pointer-2', '\u6d4f\u89c8', () => selectTool('view'));
      modes.pen = button('pencil', '\u753b\u7b14', () => selectTool('pen'));
      modes.eraser = button('eraser', '\u6a61\u76ae', () => selectTool('eraser'));
      ['#dc3545', '#176b63', '#2563eb', '#202124'].forEach((swatch) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'annotation-swatch';
        control.style.setProperty('--swatch', swatch);
        const label = { '#dc3545': '\u7ea2\u8272', '#176b63': '\u7eff\u8272', '#2563eb': '\u84dd\u8272', '#202124': '\u9ed1\u8272' }[swatch];
        control.title = label;
        control.setAttribute('aria-label', label);
        control.setAttribute('aria-pressed', String(swatch === color));
        control.addEventListener('click', () => {
          color = swatch;
          toolbar.querySelectorAll('.annotation-swatch').forEach((item) => item.setAttribute('aria-pressed', String(item === control)));
          selectTool('pen');
        });
        toolbar.append(control);
      });
      const size = document.createElement('input');
      size.type = 'range';
      size.min = '2';
      size.max = '18';
      size.value = String(width);
      size.title = '\u7b14\u753b\u7c97\u7ec6';
      size.setAttribute('aria-label', size.title);
      size.addEventListener('input', () => { width = Number(size.value); });
      toolbar.append(size);
      const undo = button('undo-2', '\u64a4\u9500\u6211\u7684\u4e0a\u4e00\u7b14', () => {
        const strokes = visibleStrokes();
        while (history.length) {
          const identifier = history.pop();
          if (strokes.some((stroke) => stroke.id === identifier)) {
            enqueue({ action: 'remove', id: identifier });
            break;
          }
        }
      });
      const clear = button('trash-2', '\u6e05\u7a7a\u672c\u9875\u6240\u6709\u7b14\u8ff9', () => {
        if (window.confirm('\u6e05\u7a7a\u672c\u9875\u6240\u6709\u7b14\u8ff9\uff1f\u6240\u6709\u8bbe\u5907\u90fd\u4f1a\u540c\u6b65\u6e05\u7a7a\u3002')) {
          enqueue({ action: 'clear', revision: state.revision });
        }
      });
      const fullscreen = button('maximize', '\u5168\u9875\u5168\u5c4f', async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen();
        } catch { setStatus('\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u5168\u5c4f', true); }
      });
      const updateFullscreen = () => {
        const parent = document.fullscreenElement && document.fullscreenElement !== document.documentElement ? document.fullscreenElement : document.body;
        parent.append(canvas, toolbar);
        fullscreen.replaceChildren(icon(document.fullscreenElement ? 'minimize' : 'maximize'));
        window.lucide?.createIcons({ root: fullscreen });
        resize();
      };
      document.addEventListener('fullscreenchange', updateFullscreen);
      toolbar.append(status);
      window.lucide?.createIcons({ root: toolbar });
      selectTool('view');
      setStatus('\u6b63\u5728\u8fde\u63a5');
      const position = (event, identifier) => {
        const bounds = anchorBounds(identifier);
        return [Math.min(100, Math.max(-100, (event.clientX - bounds.left) / bounds.width)), Math.min(100, Math.max(-100, (event.clientY - bounds.top) / bounds.height))];
      };
      const findAnchor = (event) => {
        const match = Array.from(anchors.entries()).reverse().find(([identifier]) => {
          const bounds = anchorBounds(identifier);
          return bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        });
        return match?.[0] || 'document';
      };
      canvas.addEventListener('pointerdown', (event) => {
        if (tool === 'view' || !loaded || current || event.button !== 0) return;
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        const identifier = `stroke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const anchor = findAnchor(event);
        const bounds = anchorBounds(anchor);
        current = { pointerId: event.pointerId, generation: state.generation, stroke: {
          id: identifier, tool, color, anchor, width: Math.min(0.1, width * (tool === 'eraser' ? 3 : 1) / bounds.width), points: [position(event, anchor)],
        } };
        render();
      });
      canvas.addEventListener('pointermove', (event) => {
        if (!current || current.pointerId !== event.pointerId) return;
        if (current.stroke.points.length < 4095) current.stroke.points.push(position(event, current.stroke.anchor));
        render();
      });
      canvas.addEventListener('pointerup', (event) => {
        if (!current || current.pointerId !== event.pointerId) return;
        const finished = current;
        current = null;
        canvas.releasePointerCapture(event.pointerId);
        if (finished.generation === state.generation) {
          finished.stroke.points.push(position(event, finished.stroke.anchor));
          history.push(finished.stroke.id);
          enqueue({ action: 'add', stroke: finished.stroke });
        } else render();
      });
      canvas.addEventListener('pointercancel', () => { current = null; render(); });
      const keydown = (event) => { if (event.key === 'Escape') selectTool('view'); };
      document.addEventListener('keydown', keydown);
      document.addEventListener('scroll', render, true);
      window.addEventListener('resize', resize);
      const observer = new ResizeObserver(resize);
      observer.observe(article);
      resize();
      const poll = async () => {
        if (disposed) return;
        await sync();
        if (!disposed) timer = window.setTimeout(poll, 1000);
      };
      cleanup = () => {
        disposed = true;
        window.clearTimeout(timer);
        observer.disconnect();
        document.removeEventListener('fullscreenchange', updateFullscreen);
        document.removeEventListener('keydown', keydown);
        document.removeEventListener('scroll', render, true);
        window.removeEventListener('resize', resize);
        canvas.remove();
        toolbar.remove();
      };
      void poll();
  };
  enhance();
  new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
})();