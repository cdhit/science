(() => {
  const enhanceImages = (root) => {
    const images = root.querySelectorAll?.('.md-typeset img') ?? [];

    images.forEach((image) => {
      const link = image.closest('a[href]');
      if (!link || !link.href.includes('/assets/source-pages/') || link.parentElement.classList.contains('source-image-viewer')) {
        return;
      }

      const viewer = document.createElement('div');
      viewer.className = 'source-image-viewer';
      link.parentElement.insertBefore(viewer, link);
      viewer.append(link);

      const button = document.createElement('button');
      button.className = 'source-image-fullscreen';
      button.type = 'button';
      button.textContent = '全屏';
      button.setAttribute('aria-label', '全屏查看原题图片');
      button.addEventListener('click', async () => {
        if (document.fullscreenElement === viewer) {
          await document.exitFullscreen();
        } else {
          await viewer.requestFullscreen();
        }
      });
      viewer.append(button);

      document.addEventListener('fullscreenchange', () => {
        const isFullscreen = document.fullscreenElement === viewer;
        button.textContent = isFullscreen ? '还原' : '全屏';
        button.setAttribute('aria-label', isFullscreen ? '还原图片大小' : '全屏查看原题图片');
      });
    });
  };

  enhanceImages(document);
  new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          enhanceImages(node);
        }
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();