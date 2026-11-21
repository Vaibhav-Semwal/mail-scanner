const { Notification } = require('electron');
const { openInBrowser } = require('./mail/webmail');
const log = require('./logger');

const MAX_INDIVIDUAL = 3;
const live = new Set(); // keeps notifications alive so click handlers still fire

// Windows and macOS can show buttons on a notification. Linux cannot.
const hasButtons = process.platform === 'win32' || process.platform === 'darwin';

//   urlFor(item)     web link for an email (or the mailbox when no item is given), or null
//   onMarkRead(item) called when "Mark read" is pressed
function buttonsFor(item, { urlFor, onMarkRead }) {
  const buttons = [];
  const url = urlFor(item);
  if (url) buttons.push({ kind: 'open', label: 'Open in browser', run: () => openInBrowser(url) });
  if (item) buttons.push({ kind: 'read', label: 'Mark read', run: () => onMarkRead(item) });
  return buttons;
}

function show({ title, body, buttons }, onOpenApp) {
  const options = { title, body, silent: false };
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

  // Clicking the notification itself opens the app. Linux has no buttons, so
  // there a click opens the email in the browser instead.
  const open = buttons.find((b) => b.kind === 'open');
  n.on('click', () => {
    if (actionHandled) return;
    open && !hasButtons ? open.run() : onOpenApp();
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
    items.forEach((m) =>
      show({ title: m.from, body: m.subject, buttons: buttonsFor(m, handlers) }, handlers.onOpenApp)
    );
  } else {
    show(
      { title: 'Mail Scanner', body: `${items.length} new emails`, buttons: buttonsFor(null, handlers) },
      handlers.onOpenApp
    );
  }
}

module.exports = { notifyNewMail };