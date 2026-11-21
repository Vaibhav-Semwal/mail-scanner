const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

function createTray({ onOpen, onScan, onOpenLogs, onQuit }) {
  const icon = nativeImage
  .createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png'))
  .resize({ width: 16, height: 16 });

  const tray = new Tray(icon);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open settings', click: onOpen },
      { label: 'Scan now', click: onScan },
      { label: 'Open log folder', click: onOpenLogs },
      { type: 'separator' },
      { label: 'Quit', click: onQuit }
    ])
  );
  tray.on('click', onOpen);
  return tray;
}

module.exports = { createTray };