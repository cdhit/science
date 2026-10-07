document$.subscribe(() => {
  if (!window.mermaid) return;

  window.mermaid.initialize({ startOnLoad: false });
  window.mermaid.run({ querySelector: ".mermaid" });
});