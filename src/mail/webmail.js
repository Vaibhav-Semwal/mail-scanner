const { shell } = require('electron');
const { resolveHost } = require('./imapClient');
const log = require('../logger');

// Gmail's web app addresses a conversation by its id in hex: #all/<hex>.
// IMAP gives the id in decimal (X-GM-THRID / X-GM-MSGID), so convert it.
// Returns '' for anything that isn't a plain decimal id.
function toGmailHex(decimal) {
  if (!/^\d{1,20}$/.test(decimal || '')) return '';
  try {
    return BigInt(decimal).toString(16);
  } catch {
    return '';
  }
}

// Gmail link for the signed-in account. With an item, opens that email's
// conversation directly (under "All Mail", so it still works once archived);
// without one, or if the id is unknown, opens the inbox.
function gmailUrl(cfg, item) {
  const base = `https://mail.google.com/mail/?authuser=${encodeURIComponent(cfg.email)}`;
  const hex = item ? toGmailHex(item.threadId) || toGmailHex(item.emailId) : '';
  return hex ? `${base}#all/${hex}` : `${base}#inbox`;
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