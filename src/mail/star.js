const session = require('../session');
const log = require('../logger');

const byStarThenDate = (a, b) => Number(b.starred) - Number(a.starred) || b.date - a.date;

// Stars or unstars one listed email on the server (Gmail's star), then updates
// the stored list quietly: the window has already moved the row itself.
async function setStar({ watcher, uid, starred }) {
  if (!Number.isInteger(uid) || typeof starred !== 'boolean' || !session.get().results.some((m) => m.uid === uid)) {
    return { ok: false, error: 'That email is no longer in the list.' };
  }
  try {
    await watcher.setStarred(uid, starred);
  } catch (err) {
    log.error('Could not change a star', err);
    return { ok: false, error: `Could not ${starred ? 'star' : 'unstar'} it. Check your connection and try again.` };
  }
  const results = session.get().results.map((m) => (m.uid === uid ? { ...m, starred } : m)).sort(byStarThenDate);
  session.update({ results }, { silent: true });
  return { ok: true };
}

module.exports = { setStar };
