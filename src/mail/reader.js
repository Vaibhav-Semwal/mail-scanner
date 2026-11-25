const { simpleParser } = require('mailparser');
const session = require('../session');
const log = require('../logger');

const CACHE_SIZE = 5;
const cache = new Map(); // uid -> { html } for the mail-view: protocol

// Gmail keeps every message in "All Mail", so archiving there just drops the
// Inbox label. Other providers usually have an "Archive" folder instead.
const ARCHIVE_FOLDERS = ['\\All', '\\Archive'];
const TRASH_FOLDER = '\\Trash';

const isListed = (uid) => session.get().results.some((m) => m.uid === uid);

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function addresses(field) {
  const list = field ? (Array.isArray(field) ? field.flatMap((f) => f.value) : field.value) : [];
  return (list || []).map((a) => ({ name: a.name || '', address: a.address || '' }));
}

// The full document served to the sandboxed iframe. <base target="_blank">
// makes every link a popup, which the main window sends to the browser.
function wrapBody(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#222;}
  body{padding:4px 2px 16px;font:14px/1.5 Arial,Helvetica,sans-serif;word-wrap:break-word;}
  img{max-width:100%;height:auto;}
  pre.plain{white-space:pre-wrap;font:inherit;margin:0;}
</style></head><body>${body}</body></html>`;
}

function remember(uid, entry) {
  cache.delete(uid);
  cache.set(uid, entry);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
}

// Fetches and parses one listed email. The raw HTML stays in the main process;
// the window only gets header fields and loads the body via mail-view://msg/<uid>.
async function loadMessage({ watcher, uid }) {
  if (!Number.isInteger(uid) || !isListed(uid)) {
    return { ok: false, error: 'That email is no longer in the list.' };
  }
  try {
    const source = await watcher.fetchMessage(uid);
    const parsed = await simpleParser(source, { skipTextToHtml: true });
    const attachments = parsed.attachments || [];
    // mailparser already swaps cid: images for data: URIs, so they render offline.
    const body = parsed.html
      ? parsed.html
      : `<pre class="plain">${escapeHtml(parsed.text || '')}</pre>`;
    remember(uid, { html: wrapBody(body) });

    const archiveFolder = (await Promise.all(ARCHIVE_FOLDERS.map((f) => watcher.folderFor(f)))).some(Boolean);
    const trashFolder = Boolean(await watcher.folderFor(TRASH_FOLDER));

    return {
      ok: true,
      mail: {
        uid,
        subject: parsed.subject || '(no subject)',
        from: addresses(parsed.from)[0] || { name: 'Unknown sender', address: '' },
        replyTo: addresses(parsed.replyTo),
        to: addresses(parsed.to),
        cc: addresses(parsed.cc),
        date: parsed.date ? +parsed.date : null,
        attachments: attachments
          .filter((a) => !a.related) // images shown inside the body aren't listed as files
          .map((a) => ({ filename: a.filename || 'attachment', size: a.size || 0 })),
        canArchive: archiveFolder,
        canDelete: trashFolder
      }
    };
  } catch (err) {
    log.error('Could not load an email', err);
    return { ok: false, error: 'Could not load this email. Check your connection and try again.' };
  }
}

// HTML for the mail-view: protocol, or null if it isn't cached.
const viewHtml = (uid) => (cache.get(uid) || {}).html || null;

async function moveListed({ watcher, uid, silent, folders, failure }) {
  if (!Number.isInteger(uid) || !isListed(uid)) {
    return { ok: false, error: 'That email is no longer in the list.' };
  }
  try {
    let target = null;
    for (const f of folders) if (!target && (await watcher.folderFor(f))) target = f;
    if (!target) return { ok: false, error: 'Your mailbox does not support this action.' };
    await watcher.moveTo(uid, target);
  } catch (err) {
    log.error(`Could not ${failure} an email`, err);
    return { ok: false, error: `Could not ${failure} it. Check your connection and try again.` };
  }
  cache.delete(uid);
  session.removeResult(uid, { silent });
  return { ok: true };
}

const archiveMessage = ({ watcher, uid, silent = false }) =>
  moveListed({ watcher, uid, silent, folders: ARCHIVE_FOLDERS, failure: 'archive' });

const deleteMessage = ({ watcher, uid, silent = false }) =>
  moveListed({ watcher, uid, silent, folders: [TRASH_FOLDER], failure: 'delete' });

module.exports = { loadMessage, viewHtml, archiveMessage, deleteMessage };
