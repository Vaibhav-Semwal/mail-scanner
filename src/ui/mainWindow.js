const { BrowserWindow, shell } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let win = null;
let closing = false;
let loaded = false;
let pending = []; // messages sent before the page finished loading

// Links clicked inside an email open in the default browser (or mail app).
function isExternalLink(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

function create() {
  loaded = false;
  win = new BrowserWindow({
    width: 760,
    height: 820,
    minWidth: 420,
    minHeight: 500,
    show: false,
    title: 'Mail Scanner',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    loaded = true;
    const queued = pending;
    pending = [];
    queued.forEach(([channel, payload]) => win.webContents.send(channel, payload));
  });

  // Email links use <base target="_blank">, so they arrive here as popups.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  // The email iframe may only show mail-view: pages; any other navigation inside
  // it (e.g. a link with target="_self") is sent to the browser instead.
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame || event.url.startsWith('mail-view:')) return;
    event.preventDefault();
    if (isExternalLink(event.url)) shell.openExternal(event.url).catch(() => {});
  });

  // Closing the window hides it; scanning continues from the tray.
  win.on('close', (event) => {
    if (!closing) {
      event.preventDefault();
      win.hide();
    }
  });
}

function show() {
  if (!win || win.isDestroyed()) create();
  win.show();
  win.focus();
}

function send(channel, payload) {
  if (!win || win.isDestroyed()) return;
  if (loaded) win.webContents.send(channel, payload);
  else pending.push([channel, payload]);
}

function allowClose() {
  closing = true;
}

module.exports = { create, show, send, allowClose };
