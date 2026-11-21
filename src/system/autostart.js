const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Registers (or removes) the app so it starts hidden when you sign in.
// Only done for the packaged app: in dev it would register the bare electron binary.
function apply(enabled) {
  if (!app.isPackaged) return;

  if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'mail-scanner.desktop');
    if (enabled) {
      fs.mkdirSync(dir, { recursive: true });
      const exe = process.env.APPIMAGE || process.execPath;
      fs.writeFileSync(
        file,
        `[Desktop Entry]\nType=Application\nName=MailTag\nExec="${exe}" --hidden\nX-GNOME-Autostart-enabled=true\n`
      );
    } else {
      fs.rmSync(file, { force: true });
    }
    return;
  }

  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

function startedHidden() {
  return process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
}

module.exports = { apply, startedHidden };