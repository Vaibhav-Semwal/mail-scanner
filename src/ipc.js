const { ipcMain } = require('electron');
const config = require('./config');
const session = require('./session');
const autostart = require('./system/autostart');
const { testConnection } = require('./mail/imapClient');
const { webmailUrl, openInBrowser } = require('./mail/webmail');
const { markAsRead } = require('./mail/markRead');

// Connects the settings window to the main process.
function registerIpc({ watcher }) {
  ipcMain.handle('cfg:get', () => config.toPublic(config.load()));

  ipcMain.handle('cfg:save', async (_event, data) => {
    const merged = config.merge(config.load(), data || {});
    config.save(merged);
    autostart.apply(merged.launchAtLogin);
    await watcher.restart(); // reconnect with the new settings
    return { ok: true };
  });

  ipcMain.handle('cfg:test', async (_event, data) => {
    const existing = config.load();
    try {
      await testConnection(config.merge(existing, data || {}));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.responseText || err.message };
    }
  });

  // Opens one email (by uid) or, with null, the whole mailbox in the default browser.
  // The window only sends an id; the link itself is always built here.
  ipcMain.handle('mail:open', (_event, uid) => {
    let item = null;
    if (uid !== null && uid !== undefined) {
      item = Number.isInteger(uid) ? session.get().results.find((m) => m.uid === uid) : null;
      if (!item) return { ok: false, error: 'That email is no longer in the list.' };
    }
    const url = webmailUrl(config.load(), item);
    if (!url) return { ok: false, error: 'Opening mail in the browser works for Gmail accounts only.' };
    return openInBrowser(url); // { ok } or { ok: false, error }
  });

  // Marks one listed email as read. The window has already removed the row, so the
  // stored list is updated quietly (no re-send to the window).
  ipcMain.handle('mail:markSeen', (_event, uid) =>
    markAsRead({ watcher, uid, silent: true, mustBeListed: true })
  );

  ipcMain.handle('scan:now', () => watcher.refresh());
  ipcMain.handle('state:get', () => session.get());
}

module.exports = { registerIpc };