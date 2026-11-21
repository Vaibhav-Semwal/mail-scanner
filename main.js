const { app, powerMonitor, shell } = require('electron');
const config = require('./src/config');
const session = require('./src/session');
const autostart = require('./src/system/autostart');
const MailWatcher = require('./src/mail/watcher');
const { matchesKeywords } = require('./src/mail/messages');
const { notifyNewMail } = require('./src/notifier');
const { webmailUrl } = require('./src/mail/webmail');
const { markAsRead } = require('./src/mail/markRead');
const mainWindow = require('./src/ui/mainWindow');
const { createTray } = require('./src/ui/tray');
const { registerIpc } = require('./src/ipc');

app.setAppUserModelId('com.local.mailscanner'); // required for notifications on Windows

function start() {
  const cfg = config.load();
  autostart.apply(cfg.launchAtLogin);

  const watcher = new MailWatcher(config.load);

  // Mail watcher -> app state
  watcher.on('status', (status) => session.update({ status }));
  watcher.on('snapshot', (snapshot) =>
    session.update({ ...snapshot, canOpen: webmailUrl(config.load()) !== null })
  );
  watcher.on('mail', (items) => {
    const current = config.load();
    if (!current.notify) return;
    notifyNewMail(items.filter((m) => matchesKeywords(m, current.keywords)), {
      onOpenApp: mainWindow.show,
      urlFor: (item) => webmailUrl(current, item),
      onMarkRead: (item) => markAsRead({ watcher, uid: item.uid })
    });
  });

  // App state -> settings window + tray tooltip
  const tray = createTray({
    onOpen: mainWindow.show,
    onScan: () => watcher.refresh(),
    onOpenLogs: () => shell.openPath(app.getPath('userData')),
    onQuit: () => {
      mainWindow.allowClose();
      app.quit();
    }
  });
  session.onChange((s, meta) => {
    if (!meta.silent) mainWindow.send('state', s);
    tray.setToolTip(`Mail Scanner: ${s.status}${s.unreadCount ? `, ${s.unreadCount} unread` : ''}`);
  });

  registerIpc({ watcher });
  mainWindow.create();
  if (!autostart.startedHidden() || !cfg.email) mainWindow.show();

  watcher.start();
  powerMonitor.on('resume', () => watcher.restart()); // connections go stale during sleep
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', mainWindow.show); // clicking the app-drawer icon again lands here
  app.on('window-all-closed', () => {});      // keep running in the tray
  app.on('before-quit', mainWindow.allowClose);
  app.whenReady().then(start);
}