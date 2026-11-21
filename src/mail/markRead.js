const session = require('../session');
const log = require('../logger');

// Marks one email as read on the server and removes it from the stored list.
// silent = true when the settings window already removed the row itself.
async function markAsRead({ watcher, uid, silent = false, mustBeListed = false }) {
  if (!Number.isInteger(uid) || (mustBeListed && !session.get().results.some((m) => m.uid === uid))) {
    return { ok: false, error: 'That email is no longer in the list.' };
  }
  try {
    await watcher.markSeen(uid);
  } catch (err) {
    log.error('Could not mark an email as read', err);
    return { ok: false, error: 'Could not mark it as read. Check your connection and try again.' };
  }
  session.removeResult(uid, { silent });
  return { ok: true };
}

module.exports = { markAsRead };