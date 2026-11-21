const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const log = require('../logger');

// Name and icon Windows shows at the top of every notification (and in the
// notification centre). Windows takes them from the registry entry for the
// app's AppUserModelID, so they are registered here on every start.
const APP_ID = 'com.local.mailscanner';
const APP_NAME = 'MailTag';
const ICON_SOURCE = path.join(__dirname, '..', '..', 'assets', 'icon.png');

// Windows can't read files inside the packaged app.asar, so the icon is copied out.
function iconPath() {
  const dest = path.join(app.getPath('userData'), 'notification-icon.png');
  try {
    fs.copyFileSync(ICON_SOURCE, dest);
    return dest;
  } catch (err) {
    log.warn('Could not prepare the notification icon', err);
    return null;
  }
}

function regAdd(key, name, value) {
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  return new Promise((resolve, reject) => {
    execFile(reg, ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true }, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

let icon = null;

async function registerNotificationIdentity() {
  app.setAppUserModelId(APP_ID);
  icon = iconPath();
  if (process.platform !== 'win32') return;
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
  try {
    await regAdd(key, 'DisplayName', APP_NAME);
    if (icon) await regAdd(key, 'IconUri', icon);
  } catch (err) {
    log.warn('Could not register the notification name and icon', err);
  }
}

module.exports = { registerNotificationIdentity, APP_NAME, notificationIcon: () => icon };
