const { readJson, writeJson } = require('./jsonStore');

// Remembers the newest message we have already seen, so a restart or a
// reconnect never repeats old notifications.
const FILE = 'sync-state.json';

const load = () => readJson(FILE, {});
const save = (state) => writeJson(FILE, state);

module.exports = { load, save };