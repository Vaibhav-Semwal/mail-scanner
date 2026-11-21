const { app, powerMonitor, shell, protocol } = require('electron');
const path = require('path');

// One data folder for the dev and installed builds (settings, saved password,
// labels, log), whatever the app is called. Must run before anything reads it.
app.setPath('userData', path.join(app.getPath('appData'), 'mail-scanner'));
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
const { viewHtml } = require('./src/mail/reader');
const { ClassifierEngine } = require('./src/ai/engine');
const log = require('./src/logger');
const { disposeAvatars } = require('./src/ui/avatar');

const { registerNotificationIdentity } = require('./src/system/notifyIdentity');

// mail-view://msg/<uid> serves an email body to the reader's sandboxed iframe with
// its own strict CSP: inline styles and images are allowed, scripts never are.
const VIEW_SCHEME = 'mail-view';
const VIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https:",
  'img-src https: http: data:',
  'font-src https: data:',
  "form-action 'none'",
  "frame-src 'none'"
].join('; ');
protocol.registerSchemesAsPrivileged([{ scheme: VIEW_SCHEME, privileges: { standard: true, secure: true } }]);

function registerViewProtocol() {
  protocol.handle(VIEW_SCHEME, (request) => {
    const url = new URL(request.url);
    const uid = Number(url.pathname.replace(/^\/+|\/+$/g, ''));
    const html = url.hostname === 'msg' && Number.isInteger(uid) ? viewHtml(uid) : null;
    if (!html) return new Response('Not found', { status: 404 });
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': VIEW_CSP }
    });
  });
}

async function start() {
  await registerNotificationIdentity(); // "MailTag" + icon on every notification
  const cfg = config.load();
  autostart.apply(cfg.launchAtLogin);
  registerViewProtocol();

  const watcher = new MailWatcher(config.load);

  // Mail watcher -> app state
  let lastStatus = null;
  watcher.on('status', (status) => {
    if (status !== lastStatus) log.info(`Mailbox: ${status}`); // connection history for the log file
    lastStatus = status;
    session.update({ status });
  });
  watcher.on('snapshot', (snapshot) =>
    session.update({ ...snapshot, canOpen: webmailUrl(config.load()) !== null })
  );
  watcher.on('mail', (items) => {
    const current = config.load();
    if (!current.notify) return;
    notifyNewMail(items.filter((m) => matchesKeywords(m, current.keywords)), {
      onOpenApp: (item) => {
        mainWindow.show();
        if (item) mainWindow.send('mail:show', item.uid); // open that email in the reader
      },
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
  // Smart labels: the local Llama model classifies whatever is in the unread list.
  const classifier = new ClassifierEngine({ watcher });
  classifier.on('change', (ai) => session.update({ ai }));

  session.onChange((s, meta) => {
    if (s.results !== classifier.items) classifier.setItems(s.results); // list changed
    if (!meta.silent) mainWindow.send('state', s);
    tray.setToolTip(`MailTag: ${s.status}${s.unreadCount ? `, ${s.unreadCount} unread` : ''}`);
  });
  app.on('will-quit', () => {
    classifier.stop(); // stops the private Ollama server
    disposeAvatars();  // the hidden window that draws notification pictures
  });

  registerIpc({ watcher, classifier });
  mainWindow.create();
  if (!autostart.startedHidden() || !cfg.email) mainWindow.show();

  watcher.start();
  classifier.start();
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