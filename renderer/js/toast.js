'use strict';

// One message at the bottom of the window. kind: 'ok' | 'error' | undefined.
App.toast = (() => {
  const OK_MS = 3000;
  const ERROR_MS = 7000;
  let timer = null;

  function show(text, kind) {
    const node = App.dom.$('toast');
    clearTimeout(timer);
    node.textContent = text;
    node.className = kind ? `toast is-${kind}` : 'toast';
    node.hidden = !text;
    if (text && kind) timer = setTimeout(() => { node.hidden = true; }, kind === 'error' ? ERROR_MS : OK_MS);
  }

  return { show };
})();
