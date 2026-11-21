'use strict';

// Theme (System / Light / Dark), accent colour and background tone.
// This file loads in <head> without "defer", so the saved look is applied
// before the first paint (no flash of the wrong theme). The settings controls
// and the top-bar toggle are wired up later by App.appearance.init().
window.App = window.App || {};

App.appearance = (() => {
  const KEY = 'mail-scanner.appearance';
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  const ACCENTS = [
    { name: 'Teal', color: '#0f766e' },
    { name: 'Blue', color: '#1a73e8' },
    { name: 'Indigo', color: '#4f46e5' },
    { name: 'Purple', color: '#8e24aa' },
    { name: 'Pink', color: '#d81b60' },
    { name: 'Red', color: '#d93025' },
    { name: 'Orange', color: '#e8710a' },
    { name: 'Green', color: '#188038' },
    { name: 'Graphite', color: '#5f6368' }
  ];
  const THEMES = ['system', 'light', 'dark'];
  const TONES = ['slate', 'neutral', 'warm'];
  const DEFAULTS = { theme: 'system', accent: ACCENTS[0].color, tone: 'slate' };
  const HEX = /^#[0-9a-f]{6}$/i;

  function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { saved = {}; }
    return {
      theme: THEMES.includes(saved.theme) ? saved.theme : DEFAULTS.theme,
      accent: HEX.test(saved.accent || '') ? saved.accent.toLowerCase() : DEFAULTS.accent,
      tone: TONES.includes(saved.tone) ? saved.tone : DEFAULTS.tone
    };
  }

  let prefs = load();

  /* ---------------- colour maths ---------------- */

  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function hslToHex(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  // The accent is also used as text and links, so it is darkened for light
  // themes and lightened for dark ones until it reads well on the page.
  function tuneAccent(hex, mode) {
    const [h, s, l] = hexToHsl(hex);
    const color = mode === 'dark' ? hslToHex(h, Math.min(s, 0.85), Math.max(l, 0.62)) : hslToHex(h, s, Math.min(l, 0.42));
    const ink = contrast(color, '#ffffff') >= contrast(color, '#0b1215') ? '#ffffff' : '#0b1215';
    return { color, ink };
  }

  /* ---------------- apply ---------------- */

  const effectiveMode = () => (prefs.theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : prefs.theme);

  function apply() {
    const mode = effectiveMode();
    root.dataset.mode = mode;
    root.dataset.tone = prefs.tone;
    const { color, ink } = tuneAccent(prefs.accent, mode);
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-ink', ink);
    if (window.App.appearanceUi) window.App.appearanceUi.render();
  }

  function set(partial) {
    prefs = { ...prefs, ...partial };
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* still applied for this session */ }
    apply();
    if (window.api && 'theme' in partial) window.api.setTheme(prefs.theme); // window frame follows
  }

  // Top-bar button: flip between day and night (leaving "System" if it was set).
  const toggle = () => set({ theme: effectiveMode() === 'dark' ? 'light' : 'dark' });

  systemDark.addEventListener('change', () => { if (prefs.theme === 'system') apply(); });
  apply();

  return {
    get prefs() { return prefs; },
    effectiveMode, set, toggle, ACCENTS, THEMES, TONES, DEFAULTS,
    reset: () => set({ ...DEFAULTS })
  };
})();
