'use strict';

// Shared namespace for the renderer modules (plain scripts, loaded in order).
window.App = window.App || {};

App.dom = (() => {
  const $ = (id) => document.getElementById(id);

  // Small element builder. Text always goes through textContent, because sender
  // names and subjects come from untrusted email.
  function h(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...[].concat(children).filter((c) => c !== null && c !== undefined));
    return node;
  }

  // Disables a button while an async task runs.
  async function withBusy(button, task) {
    button.disabled = true;
    try {
      return await task();
    } finally {
      button.disabled = false;
    }
  }

  const sameDay = (a, b) => a.toDateString() === b.toDateString();

  // Gmail-style: time for today, "Mar 4" this year, "3/4/24" for older mail.
  function shortDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString();
  }

  const fullDate = (ms) => (ms ? new Date(ms).toLocaleString() : '');

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const initialOf = (name) => (String(name || '?').trim().replace(/^["'<]+/, '').charAt(0) || '?').toUpperCase();

  // A stable colour per sender, so avatars are easy to tell apart.
  const AVATAR_HUES = [174, 205, 260, 330, 18, 42, 140, 290];
  function avatarHue(name) {
    let hash = 0;
    for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_HUES[hash % AVATAR_HUES.length];
  }

  function paintAvatar(node, name) {
    node.textContent = initialOf(name);
    node.style.setProperty('--hue', avatarHue(name));
  }

  return { $, h, withBusy, shortDate, fullDate, formatSize, initialOf, paintAvatar };
})();
