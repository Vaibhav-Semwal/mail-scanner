const { shell } = require('electron');
const { resolveHost } = require('./imapClient');
const log = require('../logger');

// Gmail link for the signed-in account. With an item, opens a search for that
// exact message (by its Message-ID); without one, opens the account's mailbox.
function gmailUrl(cfg, item) {
  const base = `https://mail.google.com/mail/?authuser=${encodeURIComponent(cfg.email)}`;
  const id = ((item && item.messageId) || '').replace(/^<|>$/g, '');
  return id ? `${base}#search/rfc822msgid%3A${encodeURIComponent(id)}` : base;
}

// Returns a web link for the email, or null when the account isn't Gmail
// (no browser button is shown in that case).
function webmailUrl(cfg, item) {
  return resolveHost(cfg) === 'imap.gmail.com' ? gmailUrl(cfg, item) : null;
}

// The app only ever opens https links on mail.google.com. Parsing the URL (rather
// than checking its start) also rejects tricks like https://mail.google.com@evil.com.
function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'mail.google.com';
  } catch {
    return false;
  }
}

// Opens the link in the default browser. Always resolves to { ok, error? } and
// never throws, so a background click can't fail silently or crash the app.
async function openInBrowser(url) {
  if (!isAllowedUrl(url)) {
    log.warn('Blocked a link that is not a Gmail address');
    return { ok: false, error: 'That link is not allowed.' };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    log.error('Could not open the default browser', err);
    return { ok: false, error: 'Could not open your browser. Check that a default browser is set.' };
  }
}

module.exports = { webmailUrl, gmailUrl, openInBrowser, isAllowedUrl };