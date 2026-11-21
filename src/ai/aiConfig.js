const crypto = require('crypto');
const { readJson, writeJson } = require('../storage/jsonStore');
const { PRESETS, TYPES, COLORS, SPAM_ID, presetById } = require('./presets');

// Smart-label settings, kept apart from the mail settings so changing a
// classifier never reconnects the mailbox.
const FILE = 'ai.json';

// Laya: Convai's open decision model, run locally through Ollama.
const DEFAULT_MODEL = 'laya';
// Models for the app's own Ollama server are stored here (never in Ollama's
// global folder).
const DEFAULT_MODELS_DIR = process.platform === 'win32' ? 'D:\\.ollama\\downloaded_models' : '';

const MAX_CLASSIFIERS = 16;    // Laya answers up to 64 questions per request
const MAX_OPTIONS = 20;        // Laya allows 26; it suggests staying near 20
const MAX_LEVELS = 10;         // Laya's limit for score questions
const ID_RE = /^[a-z0-9-]{1,40}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const clip = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanOptions(list) {
  const seen = new Set();
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    const name = clip(o && o.name, 30);
    if (!name || seen.has(name.toLowerCase()) || out.length >= MAX_OPTIONS) continue;
    seen.add(name.toLowerCase());
    out.push({ name, desc: clip(o.desc, 150) || null });
  }
  return out;
}

function cleanLevels(list) {
  return (Array.isArray(list) ? list : []).map((l) => clip(l, 60)).filter(Boolean).slice(0, MAX_LEVELS);
}

function sanitizeClassifier(input) {
  if (!input || typeof input !== 'object' || !ID_RE.test(input.id || '')) return null;
  const color = COLOR_RE.test(input.color || '') ? input.color.toLowerCase() : null;
  const enabled = input.enabled !== false;

  // Ready-made classifiers always use the current preset definition.
  const preset = presetById(input.preset);
  if (preset) {
    return { ...preset, id: input.id, preset: preset.id, color: color || preset.color, enabled };
  }

  const type = TYPES[input.type] ? input.type : 'noul';
  const name = clip(input.name, 40);
  const question = clip(input.question || input.rule, 300); // "rule" = older settings
  if (!name || !question) return null;

  const c = { id: input.id, preset: null, type, name, question, color: color || COLORS[0], enabled };
  if (type === 'choice') {
    c.options = cleanOptions(input.options);
    if (c.options.length < 2) return null;
  }
  if (type === 'score') {
    c.levels = cleanLevels(input.levels);
    if (c.levels.length < 2) return null;
  }
  return c;
}

function sanitize(input = {}) {
  const seen = new Set();
  const classifiers = [];
  for (const raw of Array.isArray(input.classifiers) ? input.classifiers : []) {
    const c = sanitizeClassifier(raw);
    if (c && !seen.has(c.id) && classifiers.length < MAX_CLASSIFIERS) {
      seen.add(c.id);
      classifiers.push(c);
    }
  }
  // The spam classifier is always there, first in the list.
  if (!seen.has(SPAM_ID)) classifiers.unshift(sanitizeClassifier({ id: SPAM_ID, preset: SPAM_ID }));
  else classifiers.sort((a, b) => (a.id === SPAM_ID ? -1 : b.id === SPAM_ID ? 1 : 0));

  return {
    enabled: input.enabled !== false,
    model: clip(input.model, 80) || DEFAULT_MODEL,
    modelsDir: clip(input.modelsDir, 260) || DEFAULT_MODELS_DIR,
    ollamaPath: clip(input.ollamaPath, 260),
    classifiers
  };
}

const load = () => sanitize(readJson(FILE, {}));
const save = (cfg) => writeJson(FILE, sanitize(cfg));

// A fresh id for a custom classifier.
const newId = () => `c-${crypto.randomBytes(4).toString('hex')}`;

// Any change to what a classifier asks invalidates its old results.
const signature = (c) =>
  crypto
    .createHash('sha1')
    .update(JSON.stringify([c.type, c.question, c.criteria || null, c.options || null, c.levels || null]))
    .digest('hex')
    .slice(0, 12);

// The Laya question for one classifier (see the /v1/systemone API).
function toQuestion(c) {
  if (c.type === 'choice') {
    return { type: 'choice', instructions: c.question, criteria: Object.fromEntries(c.options.map((o) => [o.name, o.desc || null])) };
  }
  if (c.type === 'score') {
    return { type: 'score', instructions: c.question, criteria: c.levels };
  }
  const q = { type: 'noul', instructions: c.question };
  if (c.criteria) q.criteria = c.criteria;
  return q;
}

module.exports = {
  load, save, sanitize, newId, signature, toQuestion,
  PRESETS, TYPES, COLORS, SPAM_ID, MAX_CLASSIFIERS, MAX_OPTIONS, MAX_LEVELS, DEFAULT_MODEL
};
