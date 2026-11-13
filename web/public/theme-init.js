// Runs before first paint so a saved theme never flashes the wrong palette.
// Keep the storage key in sync with web/src/lib/theme.ts.
try {
  var stored = localStorage.getItem('infinity-echo-theme');
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.dataset.theme = stored;
  }
} catch (e) {
  // Private mode / blocked storage: fall back to the CSS prefers-color-scheme.
}
