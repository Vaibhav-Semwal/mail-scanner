const { BrowserWindow } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let win = null;
let closing = false;

function create() {
  win = new BrowserWindow({
    width: 520,
    height: 760,
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

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
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function allowClose() {
  closing = true;
}

module.exports = { create, show, send, allowClose };