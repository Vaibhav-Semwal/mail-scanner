'use strict';

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const el = {
  // account + scanning fields
  email: $('email'),
  password: $('password'),
  host: $('host'),
  port: $('port'),
  interval: $('interval'),
  keywords: $('keywords'),
  notify: $('notify'),
  launch: $('launch'),
  // inbox
  count: $('count'),
  status: $('status'),
  results: $('results'),
  empty: $('empty'),
  openInbox: $('openInbox'),
  // actions
  save: $('save'),
  test: $('test'),
  scan: $('scan'),
  message: $('msg')
};

const DEFAULT_PORT = 993;
const DEFAULT_INTERVAL_MIN = 10;
const PASSWORD_SAVED_HINT = 'Saved. Leave blank to keep it.';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// kind: 'ok' | 'error' | undefined
function showMessage(text, kind) {
  el.message.textContent = text;
  el.message.className = kind ? `feedback is-${kind}` : 'feedback';
}

// Disables a button while an async task runs.
async function withBusy(button, task) {
  button.disabled = true;
  try {
    return await task();
  } finally {
    button.disabled = false;
  }
}

function textElement(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text; // textContent only: email subjects are untrusted
  return node;
}

/* ------------------------------------------------------------------ */
/* Settings form                                                       */
/* ------------------------------------------------------------------ */

function readForm() {
  return {
    email: el.email.value.trim(),
    password: el.password.value,
    host: el.host.value.trim(),
    port: Number(el.port.value) || DEFAULT_PORT,
    intervalMin: Math.max(1, Number(el.interval.value) || DEFAULT_INTERVAL_MIN),
    keywords: el.keywords.value.trim(),
    notify: el.notify.checked,
    launchAtLogin: el.launch.checked
  };
}

function fillForm(config) {
  el.email.value = config.email;
  el.host.value = config.host;
  el.port.value = config.port;
  el.interval.value = config.intervalMin;
  el.keywords.value = config.keywords;
  el.notify.checked = config.notify;
  el.launch.checked = config.launchAtLogin;
  el.password.placeholder = config.hasPassword ? PASSWORD_SAVED_HINT : 'App password';
}

/* ------------------------------------------------------------------ */
/* Inbox rendering                                                     */
/* ------------------------------------------------------------------ */

function mailRow(mail, canOpen) {
  const item = document.createElement(canOpen ? 'button' : 'div');
  item.className = 'item';
  if (canOpen) {                       // Gmail: each row opens that email in the browser
    item.type = 'button';
    item.title = 'Open in Gmail';
    item.addEventListener('click', () => openMail(mail.uid));
  }
  item.append(textElement('div', 'from', mail.from), textElement('div', 'subj', mail.subject));

  const markRead = document.createElement('button');
  markRead.type = 'button';
  markRead.className = 'mark-read';
  markRead.textContent = 'Mark read';
  markRead.setAttribute('aria-label', `Mark as read: ${mail.subject}`);
  markRead.addEventListener('click', () => markAsRead(mail.uid, li));

  const li = document.createElement('li');
  li.append(item, markRead);
  return li;
}

function renderStatus(state) {
  const checked = state.lastScan ? `, last checked ${new Date(state.lastScan).toLocaleTimeString()}` : '';
  el.status.textContent = state.status + checked;
  el.status.classList.toggle('is-error', state.status.startsWith('Error'));
  el.count.textContent = state.unreadCount;
  el.openInbox.hidden = !state.canOpen;
}

function renderMailList(state) {
  el.results.replaceChildren(...state.results.map((mail) => mailRow(mail, state.canOpen)));
  el.empty.hidden = state.results.length > 0;
  el.empty.textContent = state.lastScan ? 'No unread mail.' : 'Nothing to show yet.';
}

function render(state) {
  renderStatus(state);
  renderMailList(state);
}

// Removes one row in place (no list refresh) and keeps the counter and empty text in sync.
function removeRow(row) {
  row.remove();
  el.count.textContent = Math.max(0, Number(el.count.textContent) - 1);
  const empty = el.results.children.length === 0;
  el.empty.hidden = !empty;
  if (empty) el.empty.textContent = 'No unread mail.';
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

// uid = one email, null = the whole mailbox
async function openMail(uid) {
  const result = await api.openMail(uid);
  if (!result.ok) showMessage(result.error, 'error');
}

// The row disappears immediately; the server is updated in the background.
// Only if that fails is the list restored from the app's last known state.
async function markAsRead(uid, row) {
  removeRow(row);
  const result = await api.markSeen(uid);
  if (!result.ok) {
    showMessage(result.error, 'error');
    render(await api.getState());
  }
}

async function testConnection() {
  const form = readForm();
  if (!form.email) return showMessage('Enter your email address.', 'error');

  showMessage('Connecting…');
  const result = await withBusy(el.test, () => api.testConnection(form));
  if (result.ok) showMessage('Connected. Your email and app password work.', 'ok');
  else showMessage(`Could not connect: ${result.error}`, 'error');
}

function scanNow() {
  return withBusy(el.scan, () => api.scanNow());
}

/* ------------------------------------------------------------------ */
/* Start-up                                                            */
/* ------------------------------------------------------------------ */

async function init() {
  fillForm(await api.getConfig());
  render(await api.getState());
  api.onState(render);

  el.save.addEventListener('click', saveSettings);
  el.test.addEventListener('click', testConnection);
  el.scan.addEventListener('click', scanNow);
  el.openInbox.addEventListener('click', () => openMail(null));
}

init();