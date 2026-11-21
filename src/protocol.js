const { app } = require('electron');
const crypto = require('crypto');

// The Windows notification button can't call into the running app directly. Instead
// it opens a link like  mail-scanner://mark-read/123?t=<token>  which Windows hands
// back to this app (the already-running copy receives it as a "second instance").
const SCHEME = 'mail-scanner';

// Random per run: web pages or other programs can't forge a link, and old
// notifications from a previous run are ignored.
const token = crypto.randomBytes(16).toString('hex');

function register() {
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
}

const markReadUrl = (uid) => `${SCHEME}://mark-read/${uid}?t=${token}`;

const findLink = (argv) => (argv || []).find((a) => typeof a === 'string' && a.startsWith(`${SCHEME}://`));

// True when the app was started by one of our links (so it should stay hidden).
const isLinkLaunch = (argv) => Boolean(findLink(argv));

// Returns the uid from a valid mark-read link in the command line, otherwise null.
function parseMarkRead(argv) {
  const raw = findLink(argv);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const given = Buffer.from(url.searchParams.get('t') || '');
    const expected = Buffer.from(token);
    if (url.hostname !== 'mark-read' || given.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(given, expected)) return null;
    const uid = Number(url.pathname.replace(/^\/+|\/+$/g, ''));
    return Number.isInteger(uid) && uid > 0 ? uid : null;
  } catch {
    return null;
  }
}

module.exports = { register, markReadUrl, parseMarkRead, isLinkLaunch, SCHEME };