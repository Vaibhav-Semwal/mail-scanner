const { safeStorage } = require('electron');
const { readJson, writeJson } = require('./storage/jsonStore');

const FILE = 'config.json';
const MAX_EMAILS = 200;

const DEFAULTS = {
  email: '',
  host: '',
  port: 993,
  intervalMin: 10,
  maxEmails: 20, // unread emails listed (starred ones are shown on top of this)
  keywords: '',
  notify: true,
  launchAtLogin: true
};

const clamp = (n, min, max, fallback) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

function sanitize(input) {
  return {
    email: String(input.email || '').trim(),
    password: String(input.password || ''),
    host: String(input.host || '').trim(),
    port: clamp(input.port, 1, 65535, DEFAULTS.port),
    intervalMin: clamp(input.intervalMin, 1, 1440, DEFAULTS.intervalMin),
    maxEmails: clamp(input.maxEmails, 1, MAX_EMAILS, DEFAULTS.maxEmails),
    keywords: String(input.keywords || '').trim(),
    notify: Boolean(input.notify),
    launchAtLogin: Boolean(input.launchAtLogin)
  };
}

// Returns the settings including the decrypted app password (main process only).
function load() {
  const stored = readJson(FILE, {});
  let password = '';
  try {
    if (stored.pw) password = safeStorage.decryptString(Buffer.from(stored.pw, 'base64'));
    else password = stored.pwPlain || '';
  } catch {
    password = '';
  }
  return sanitize({ ...DEFAULTS, ...stored, password });
}

function save(cfg) {
  const { password, ...rest } = sanitize(cfg);
  const out = { ...rest, pw: '', pwPlain: '' };
  if (password) {
    if (safeStorage.isEncryptionAvailable()) out.pw = safeStorage.encryptString(password).toString('base64');
    else out.pwPlain = password; // no OS keyring available (some Linux setups)
  }
  writeJson(FILE, out);
}

// Keeps the saved password when the form leaves the password field blank.
function merge(existing, incoming) {
  return sanitize({ ...existing, ...incoming, password: incoming.password || existing.password });
}

// Safe to send to the settings window: never includes the password.
function toPublic(cfg) {
  const { password, ...safe } = cfg;
  return { ...safe, hasPassword: Boolean(password) };
}

module.exports = { load, save, merge, toPublic };