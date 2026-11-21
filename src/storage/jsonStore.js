const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const filePath = (name) => path.join(app.getPath('userData'), name);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

// Write to a temp file first so a crash can never leave a half-written file.
function writeJson(name, value) {
  const target = filePath(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

module.exports = { readJson, writeJson };