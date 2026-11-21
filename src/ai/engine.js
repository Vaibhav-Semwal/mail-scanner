const { EventEmitter } = require('events');
const { simpleParser } = require('mailparser');
const ollama = require('./ollama');
const aiConfig = require('./aiConfig');
const { readJson, writeJson } = require('../storage/jsonStore');
const log = require('../logger');

const CACHE_FILE = 'classifications.json';
const CACHE_VERSION = 2;       // bump when the stored result format changes
const CACHE_LIMIT = 1000;      // emails remembered across restarts
// Laya reads at most 512 tokens per question (instructions + options + email),
// so only the start of the body is sent. ~1,200 characters is about 300 tokens.
const BODY_CHARS = 1200;
const MIN_BODY_CHARS = 100;    // shortest body tried before giving up on an email
const SUBJECT_CHARS = 200;
const TOO_LONG = /longer than the context length/i;
const MATCH_THRESHOLD = 0.6;   // yes/no probability at which a label is shown

/**
 * Runs the user's classifiers over the unread list with Laya, a local
 * decision model. Every enabled classifier becomes one typed question, and a
 * single request answers them all for one email.
 *
 * Stored result per classifier (null = Laya couldn't answer):
 *   noul   { p }                 probability of "yes", 0..1
 *   choice { choice, conf }      the picked option
 *   score  { score, level, conf } probability-weighted level and its rounding
 *
 * status: 'disabled' | 'starting' | 'no-ollama' | 'needs-model' | 'downloading'
 *         | 'ready' | 'error'
 * Emits 'change' whenever its public state changes.
 */
class ClassifierEngine extends EventEmitter {
  constructor({ watcher }) {
    super();
    this.watcher = watcher;
    this.cfg = aiConfig.load();
    this.status = 'starting';
    this.message = '';
    this.progress = null;
    this.items = [];          // the unread list (from the watcher's snapshots)
    this.working = null;      // uid being classified right now
    this.running = false;
    const stored = readJson(CACHE_FILE, {});
    this.cache = new Map(stored.version === CACHE_VERSION ? Object.entries(stored.items || {}) : []);
    // Failures are saved as null so one bad email can't stall the queue; give
    // each of them one fresh attempt per app start.
    for (const [key, entry] of this.cache) {
      const kept = Object.fromEntries(Object.entries(entry).filter(([, hit]) => hit && hit.r !== null));
      if (Object.keys(kept).length) this.cache.set(key, kept);
      else this.cache.delete(key);
    }
    this.saveTimer = null;
  }

  /* ---------------- lifecycle ---------------- */

  async start() {
    if (!this.cfg.enabled) return this.#set('disabled', 'Smart labels are off.');
    this.#set('starting', 'Starting the local AI…');
    try {
      await ollama.ensureServer(this.cfg);
      if (await ollama.hasModel(this.cfg.model)) {
        this.#set('ready', '');
        this.#schedule();
      } else {
        this.#set('needs-model', `Download ${this.cfg.model} to start labelling mail.`);
      }
    } catch (err) {
      log.warn('Smart labels could not start', err);
      this.#set(err.code === 'NO_OLLAMA' ? 'no-ollama' : 'error', err.message);
    }
  }

  stop() {
    return ollama.stop();
  }

  async download() {
    if (this.status === 'downloading') return { ok: true };
    try {
      await ollama.ensureServer(this.cfg);
      this.#set('downloading', 'Starting download…', 0);
      let last = 0;
      await ollama.pull(this.cfg.model, (fraction, text) => {
        const now = Date.now();
        if (now - last < 400 && fraction !== 1) return; // don't flood the window
        last = now;
        this.#set('downloading', text, fraction);
      });
      log.info('Model downloaded');
      this.#set('ready', '');
      this.#schedule();
      return { ok: true };
    } catch (err) {
      log.error('Model download failed', err);
      this.#set('needs-model', `Download failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // New settings from the window. Restarts only when the model setup changed.
  async configure(next) {
    const prev = this.cfg;
    aiConfig.save(next);
    this.cfg = aiConfig.load();
    const setupChanged =
      prev.enabled !== this.cfg.enabled || prev.model !== this.cfg.model ||
      prev.modelsDir !== this.cfg.modelsDir || prev.ollamaPath !== this.cfg.ollamaPath;
    if (setupChanged) {
      if (prev.modelsDir !== this.cfg.modelsDir || !this.cfg.enabled) await ollama.stop();
      await this.start();
    } else {
      this.#emit();
      this.#schedule();
    }
  }

  // Forget every stored score and label the list again.
  reclassify() {
    this.cache.clear();
    this.#persist();
    this.#emit();
    this.#schedule();
  }

  // The watcher's unread list changed.
  setItems(items) {
    this.items = items;
    this.#emit();
    this.#schedule();
  }

  /* ---------------- public state ---------------- */

  publicConfig() {
    return {
      ...this.cfg,
      presets: aiConfig.PRESETS,
      types: aiConfig.TYPES,
      colors: aiConfig.COLORS,
      maxClassifiers: aiConfig.MAX_CLASSIFIERS,
      maxOptions: aiConfig.MAX_OPTIONS,
      maxLevels: aiConfig.MAX_LEVELS
    };
  }

  // Sent to the window with the mail state: labels for each listed uid.
  snapshot() {
    const active = this.#active();
    const scores = {};
    const pending = [];
    for (const item of this.items) {
      const known = this.#scoresFor(item, active);
      if (Object.keys(known).length) scores[item.uid] = known;
      if (this.status === 'ready' && active.some((c) => known[c.id] === undefined)) pending.push(item.uid);
    }
    return {
      enabled: this.cfg.enabled,
      status: this.status,
      message: this.message,
      progress: this.progress,
      model: this.cfg.model,
      threshold: MATCH_THRESHOLD,
      classifiers: this.cfg.classifiers.map(({ id, type, name, color, enabled, options, levels }) => ({
        id, type, name, color, enabled,
        options: options ? options.map((o) => o.name) : undefined,
        levels
      })),
      scores,
      pending,
      working: this.working
    };
  }

  /* ---------------- internals ---------------- */

  #set(status, message, progress = null) {
    this.status = status;
    this.message = message;
    this.progress = progress;
    this.#emit();
  }

  #emit() {
    this.emit('change', this.snapshot());
  }

  #active() {
    return this.cfg.classifiers.filter((c) => c.enabled);
  }

  // Cache key: Gmail's message id when known, else the Message-ID header.
  #key(item) {
    return item.emailId || item.messageId || null;
  }

  // Stored scores that are still valid (same classifier wording).
  #scoresFor(item, classifiers) {
    const entry = this.cache.get(this.#key(item)) || {};
    const out = {};
    for (const c of classifiers) {
      const hit = entry[c.id];
      if (hit && hit.sig === aiConfig.signature(c)) out[c.id] = hit.r;
    }
    return out;
  }

  // Works through the list one email at a time, newest first.
  async #schedule() {
    if (this.running || this.status !== 'ready') return;
    this.running = true;
    try {
      for (;;) {
        if (this.status !== 'ready') break;
        const active = this.#active();
        if (!active.length) break;
        const next = this.items.find(
          (item) => this.#key(item) && active.some((c) => this.#scoresFor(item, [c])[c.id] === undefined)
        );
        if (!next) break;
        const missing = active.filter((c) => this.#scoresFor(next, [c])[c.id] === undefined);
        this.working = next.uid;
        this.#emit();
        try {
          await this.#classify(next, missing);
        } catch (err) {
          log.warn('Could not classify an email', err);
          // Remember the failure as "unknown" (null) so one bad email can't stall the queue.
          this.#store(next, missing, Object.fromEntries(missing.map((c) => [c.id, null])));
        }
      }
    } finally {
      this.working = null;
      this.running = false;
      this.#emit();
    }
  }

  async #classify(item, classifiers) {
    const source = await this.watcher.fetchMessage(item.uid);
    const parsed = await simpleParser(source, { skipImageLinks: true, skipTextLinks: true });
    const from = parsed.from && parsed.from.value && parsed.from.value[0];
    const text = String(parsed.text || '').replace(/\s+/g, ' ').trim();
    const subject = String(parsed.subject || '(no subject)').slice(0, SUBJECT_CHARS);

    // Laya builds its own prompt from the questions; the email is just "state".
    const stateWith = (chars) => [
      `From: ${from ? `${from.name || ''} <${from.address || ''}>`.trim() : 'unknown'}`,
      `Subject: ${subject}`,
      '',
      text.slice(0, chars) || '(empty body)'
    ].join('\n');

    const questions = Object.fromEntries(classifiers.map((c) => [c.id, aiConfig.toQuestion(c)]));
    // Laya allows about 512 tokens per question. Emails full of codes, links or
    // non-English text use far more tokens per character, so shorten and retry.
    let answers;
    for (let chars = BODY_CHARS; ; chars = Math.floor(chars / 2)) {
      try {
        answers = await ollama.decide({ model: this.cfg.model, state: stateWith(chars), questions });
        break;
      } catch (err) {
        if (!TOO_LONG.test(err.message) || chars < MIN_BODY_CHARS) throw err;
      }
    }

    const results = {};
    for (const c of classifiers) results[c.id] = readAnswer(c, answers[c.id]);
    this.#store(item, classifiers, results);
  }

  #store(item, classifiers, results) {
    const key = this.#key(item);
    const entry = { ...(this.cache.get(key) || {}) };
    for (const c of classifiers) entry[c.id] = { r: results[c.id], sig: aiConfig.signature(c) };
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
    this.#persist();
    this.#emit();
  }

  #persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        writeJson(CACHE_FILE, { version: CACHE_VERSION, items: Object.fromEntries(this.cache) });
      } catch (err) {
        log.warn('Could not save classifications', err);
      }
    }, 1000);
  }
}

const round = (n, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Turns one Laya answer into the small result stored per classifier, or null.
function readAnswer(c, a) {
  if (!a || a.type !== c.type) return null;
  if (c.type === 'noul') return isNum(a.noul) ? { p: round(Math.min(1, Math.max(0, a.noul))) } : null;
  if (c.type === 'choice') {
    const names = c.options.map((o) => o.name);
    return names.includes(a.choice) ? { choice: a.choice, conf: isNum(a.confidence) ? round(a.confidence) : null } : null;
  }
  if (c.type === 'score' && isNum(a.score)) {
    const level = Math.min(c.levels.length - 1, Math.max(0, Math.round(a.score)));
    return { score: round(a.score), level, conf: isNum(a.confidence) ? round(a.confidence) : null };
  }
  return null;
}

module.exports = { ClassifierEngine, MATCH_THRESHOLD };
