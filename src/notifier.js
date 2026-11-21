const { Notification } = require('electron');
const { APP_NAME, notificationIcon } = require('./system/notifyIdentity');
const { avatarFor } = require('./ui/avatar');
const log = require('./logger');

const MAX_INDIVIDUAL = 3;
const live = new Set(); // keeps notifications alive so click handlers still fire

// Windows and macOS can show buttons on a notification. Linux cannot.
const hasButtons = process.platform === 'win32' || process.platform === 'darwin';

//   onOpenApp(item)  shows the app; with an item it opens that email in the reader
//   onMarkRead(item) called when "Mark read" is pressed
function buttonsFor(item, { onOpenApp, onMarkRead }) {
  const buttons = [{ kind: 'open', label: 'Open in app', run: () => onOpenApp(item) }];
  if (item) buttons.push({ kind: 'read', label: 'Mark read', run: () => onMarkRead(item) });
  return buttons;
}

// picture: the sender's avatar (NativeImage) or null for the MailTag logo.
function show({ title, body, buttons, item = null, picture = null }, onOpenApp) {
  const options = { title, body, silent: false };
  const icon = picture || notificationIcon();
  if (icon) options.icon = icon; // main image beside the text
  if (hasButtons && buttons.length) {
    options.actions = buttons.map((b) => ({ type: 'button', text: b.label }));
  }

  const n = new Notification(options);
  live.add(n);

  // Windows (and some Electron versions on macOS) fire 'click' right after
  // 'action' when a button is pressed, treating the press as both an action
  // and a generic activation of the toast. This flag stops that trailing
  // 'click' from re-running the open/open-app logic for the same press.
  let actionHandled = false;

  // Clicking the notification itself opens the email in the app.
  n.on('click', () => {
    if (actionHandled) return;
    onOpenApp(item);
  });

  // A button was pressed. Newer Electron passes { actionIndex }; older passes the index.
  n.on('action', (details, legacyIndex) => {
    actionHandled = true;
    const index = details && Number.isInteger(details.actionIndex) ? details.actionIndex : legacyIndex;
    const button = buttons[index];
    if (!button) return;
    log.info(`Notification button pressed: ${button.kind}`);
    button.run();
  });

  n.on('failed', (_event, error) => {
    log.warn('Windows could not show a notification', new Error(String(error)));
    live.delete(n);
  });
  n.on('close', () => live.delete(n));

  log.info(`Notification shown with ${options.actions ? options.actions.length : 0} button(s)`);
  n.show();
}

// One notification per email for small bursts, one summary for bigger ones.
function notifyNewMail(items, handlers) {
  if (!items.length || !Notification.isSupported()) return;

  if (items.length <= MAX_INDIVIDUAL) {
    // Sender pictures load in parallel (a photo lookup waits at most a few seconds),
    // then the notifications show in arrival order.
    Promise.all(items.map((m) => avatarFor(m).catch(() => null))).then((pictures) =>
      items.forEach((m, i) =>
        show(
          { title: m.from, body: m.subject, buttons: buttonsFor(m, handlers), item: m, picture: pictures[i] },
          handlers.onOpenApp
        )
      )
    );
  } else {
    show(
      { title: APP_NAME, body: `${items.length} new emails`, buttons: buttonsFor(null, handlers) },
      handlers.onOpenApp
    );
  }
}

module.exports = { notifyNewMail };