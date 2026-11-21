const { ipcMain, nativeTheme } = require('electron');
const config = require('./config');
const session = require('./session');
const autostart = require('./system/autostart');
const { testConnection, describeError } = require('./mail/imapClient');
const { webmailUrl, openInBrowser } = require('./mail/webmail');
const { markAsRead } = require('./mail/markRead');
const { setStar } = require('./mail/star');
const { loadMessage, archiveMessage, deleteMessage } = require('./mail/reader');
const aiConfig = require('./ai/aiConfig');

// Connects the settings window to the main process.
function registerIpc({ watcher, classifier }) {
  // Appearance: the window frame (title bar, scrollbars) follows the app's theme.
  ipcMain.handle('ui:theme', (_event, theme) => {
    if (['system', 'light', 'dark'].includes(theme)) nativeTheme.themeSource = theme;
  });

  // Smart labels (local Llama classifiers).
  ipcMain.handle('ai:get', () => classifier.publicConfig());
  ipcMain.handle('ai:save', async (_event, data) => {
    await classifier.configure(data && typeof data === 'object' ? data : {});
    return { ok: true, config: classifier.publicConfig() };
  });
  ipcMain.handle('ai:download', () => classifier.download());
  ipcMain.handle('ai:retry', async () => {
    await classifier.start();
    return { ok: true };
  });
  ipcMain.handle('ai:reclassify', () => {
    classifier.reclassify();
    return { ok: true };
  });
  ipcMain.handle('ai:newId', () => aiConfig.newId());

  ipcMain.handle('cfg:get', () => config.toPublic(config.load()));

  ipcMain.handle('cfg:save', async (_event, data) => {
    const merged = config.merge(config.load(), data || {});
    config.save(merged);
    autostart.apply(merged.launchAtLogin);
    await watcher.restart(); // reconnect with the new settings
    return { ok: true };
  });

  ipcMain.handle('cfg:test', async (_event, data) => {
    const cfg = config.merge(config.load(), data || {});
    try {
      await testConnection(cfg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err, cfg) };
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

  // Reader view: load the full email, then archive / delete from its toolbar.
  ipcMain.handle('mail:star', (_event, uid, starred) => setStar({ watcher, uid, starred }));
  ipcMain.handle('mail:get', (_event, uid) => loadMessage({ watcher, uid }));
  ipcMain.handle('mail:archive', (_event, uid) => archiveMessage({ watcher, uid, silent: true }));
  ipcMain.handle('mail:trash', (_event, uid) => deleteMessage({ watcher, uid, silent: true }));

  ipcMain.handle('scan:now', () => watcher.refresh());
  ipcMain.handle('state:get', () => session.get());
}

module.exports = { registerIpc };