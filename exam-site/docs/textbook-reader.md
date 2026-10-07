# 教材阅读器 / Textbook Reader

首次打开需要加载整本教材（约 24 MB）。下方会显示实际加载进度；加载完成后，浏览器会打开教材的指定 PDF 页。浏览器会缓存教材，缓存有效时再次打开其他页码无需重新下载。

The first visit loads the full textbook (about 24 MB). The progress below shows the actual download; when complete, the browser opens the requested PDF page in its native reader. The browser caches the textbook, so opening another page does not download it again while the cache is available.

<section class="textbook-reader" data-textbook-reader data-pdf-url="../assets/textbooks/sciences-practical-guide-hodder-2014-teacher-book.pdf" data-page-count="141">
  <p class="textbook-reader__status" data-reader-status role="status" aria-live="polite">正在准备教材 / Preparing textbook</p>
  <div class="textbook-reader__progress-row" data-progress-row>
    <progress data-download-progress max="100" value="0" aria-label="教材下载进度 / Textbook download progress"></progress>
    <span data-progress-label>0%</span>
  </div>
  <p class="textbook-reader__error" data-reader-error hidden></p>
  <button class="textbook-reader__retry" data-reader-retry type="button" hidden>重试加载 / Retry</button>
</section>
