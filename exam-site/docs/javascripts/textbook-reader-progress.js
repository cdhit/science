(() => {
  let activeRoot = null;
  let activeRequest = null;

  const cleanup = () => {
    if (activeRequest) activeRequest.abort();
    activeRequest = null;
  };

  const initialize = () => {
    const root = document.querySelector('[data-textbook-reader]');
    if (root === activeRoot) return;
    cleanup();
    activeRoot = root;
    if (!root) return;

    const pageCount = Number(root.dataset.pageCount);
    const pdfUrl = new URL(root.dataset.pdfUrl, location.href);
    const status = root.querySelector('[data-reader-status]');
    const progress = root.querySelector('[data-download-progress]');
    const progressLabel = root.querySelector('[data-progress-label]');
    const progressRow = root.querySelector('[data-progress-row]');
    const error = root.querySelector('[data-reader-error]');
    const retry = root.querySelector('[data-reader-retry]');
    const params = new URLSearchParams(location.search);
    const initialPage = Number(params.get('page')) || 1;

    const formatBytes = (bytes) => {
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const targetPage = Math.min(pageCount, Math.max(1, Math.floor(initialPage)));

    const loadPdf = () => {
      cleanup();
      progressRow.hidden = false;
      progress.value = 0;
      progressLabel.textContent = '0%';
      error.hidden = true;
      retry.hidden = true;
      status.textContent = '正在加载教材 / Loading textbook';

      const request = new XMLHttpRequest();
      activeRequest = request;
      request.open('GET', pdfUrl);
      request.responseType = 'blob';
      request.timeout = 180000;
      request.onprogress = (event) => {
        if (!event.lengthComputable) {
          progress.removeAttribute('value');
          progressLabel.textContent = `${formatBytes(event.loaded)} / ?`;
          return;
        }
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        progress.value = percent;
        progressLabel.textContent = `${percent}%  (${formatBytes(event.loaded)} / ${formatBytes(event.total)})`;
      };
      request.onload = () => {
        if (request.status < 200 || request.status >= 300 || !(request.response instanceof Blob)) {
          status.textContent = '教材加载失败 / Textbook failed to load';
          error.textContent = `服务器返回状态 ${request.status} / Server returned status ${request.status}`;
          error.hidden = false;
          retry.hidden = false;
          return;
        }
        activeRequest = null;
        progress.value = 100;
        progressLabel.textContent = `100%  (${formatBytes(request.response.size)})`;
        status.textContent = `加载完成，正在打开 PDF 第 ${targetPage} 页 / Download complete; opening PDF page ${targetPage}`;
        window.location.assign(`${pdfUrl.href}#page=${targetPage}`);
      };
      request.onerror = () => {
        status.textContent = '教材加载失败 / Textbook failed to load';
        error.textContent = '请检查网络连接后重试 / Check your connection and retry.';
        error.hidden = false;
        retry.hidden = false;
      };
      request.ontimeout = request.onerror;
      request.send();
    };

    retry.addEventListener('click', loadPdf);
    loadPdf();
  };

  if (window.document$) document$.subscribe(initialize);
  else document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();
