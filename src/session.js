const { EventEmitter } = require('events');

// The live status shown in the settings window and the tray tooltip.
const state = { status: 'Not configured', lastScan: null, unreadCount: 0, results: [], canOpen: false };
const emitter = new EventEmitter();

// meta.silent = true updates the tray and stored state but does not re-send the
// list to the settings window (the window already removed the item itself).
function update(partial, meta = {}) {
  Object.assign(state, partial);
  emitter.emit('change', state, meta);
}

// Drops one email from the list after it was marked as read.
function removeResult(uid, meta = {}) {
  const results = state.results.filter((m) => m.uid !== uid);
  if (results.length === state.results.length) return;
  update({ results, unreadCount: Math.max(0, state.unreadCount - 1) }, meta);
}

module.exports = {
  get: () => state,
  update,
  removeResult,
  onChange: (fn) => emitter.on('change', fn)
};