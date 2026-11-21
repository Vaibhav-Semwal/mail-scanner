const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_BYTES = 200 * 1024;

// A tiny log file for a tray app that has no console. It never records email
// addresses, subjects or links, and it can never crash the app.
function write(level, message, err) {
  try {
    const file = path.join(app.getPath('userData'), 'mail-scanner.log');
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
    const detail = err ? ` | ${err.message || err}` : '';
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}${detail}\n`);
  } catch { /* ignore */ }
}

module.exports = {
  info: (message) => write('info', message),
  warn: (message, err) => write('warn', message, err),
  error: (message, err) => write('error', message, err)
};