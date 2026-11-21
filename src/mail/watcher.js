const { EventEmitter } = require('events');
const { createClient } = require('./imapClient');
const { toItem } = require('./messages');
const syncState = require('../storage/syncState');

const RETRY_MIN_MS = 5 * 1000;
const RETRY_MAX_MS = 5 * 60 * 1000;
const UNREAD_LIMIT = 20;

const describe = (err) => (err && (err.responseText || err.message)) || 'unknown error';

/**
 * Keeps one connection to the inbox open and uses IMAP IDLE, so the server
 * pushes new mail to us the moment it arrives (no waiting for a timer).
 *
 * Events:
 *   'status'   (text)                          connection / health text
 *   'snapshot' ({ unreadCount, results, lastScan })
 *   'mail'     (items[])                       messages that just arrived
 */
class MailWatcher extends EventEmitter {
  constructor(getConfig) {
    super();
    this.getConfig = getConfig;
    this.running = false;
    this.client = null;
    this.lock = null;
    this.generation = 0; // bumped on every (re)connect so stale events are ignored
    this.backoff = RETRY_MIN_MS;
    this.retryTimer = null;
    this.pollTimer = null;
    this.queue = Promise.resolve();
    this.hidden = new Set(); // uids being marked as read right now
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.backoff = RETRY_MIN_MS;
    this.#connect();
    this.#schedulePoll();
  }

  async stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    await this.#teardown();
  }

  async restart() {
    await this.stop();
    this.start();
  }

  // Manual "Scan now" and the safety-net timer. No-op until connected.
  refresh() {
    return this.#enqueue(() => this.#sync(false)).catch((err) =>
      this.emit('status', `Error: ${describe(err)}`)
    );
  }

  /* ---------------- connection ---------------- */

  // Marks one message as read on the server. It is hidden from the unread list
  // straight away, so a refresh that is already running can't bring it back.
  async markSeen(uid) {
    this.hidden.add(uid);
    try {
      await this.#enqueue(async () => {
        const client = this.client;
        if (!client || !client.usable) throw new Error('Not connected to your mailbox.');
        const done = await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        if (!done) throw new Error('The server did not accept the change.');
      });
    } finally {
      this.hidden.delete(uid);
    }
  }

  async #connect() {
    const cfg = this.getConfig();
    if (!cfg.email || !cfg.password) {
      this.emit('status', 'Not configured');
      return;
    }

    const gen = ++this.generation;
    this.emit('status', 'Connecting…');

    const client = createClient(cfg);
    client.on('error', (err) => this.#onDrop(gen, err));
    client.on('close', () => this.#onDrop(gen));
    client.on('exists', () => {
      if (gen !== this.generation) return;
      this.#enqueue(() => this.#sync(true)).catch((err) =>
        this.emit('status', `Error: ${describe(err)}`)
      );
    });

    try {
      await client.connect();
      if (gen !== this.generation || !this.running) {
        await client.logout().catch(() => client.close());
        return;
      }
      this.client = client;
      this.lock = await client.getMailboxLock('INBOX'); // holds INBOX open; IDLE starts automatically
      this.backoff = RETRY_MIN_MS;
      await this.#enqueue(() => this.#sync(true));
      this.emit('status', 'Watching for new mail');
    } catch (err) {
      try { client.close(); } catch { /* already closed */ }
      this.#onDrop(gen, err);
    }
  }

  #onDrop(gen, err) {
    if (gen !== this.generation || !this.running) return; // stale or intentional
    this.generation++;
    this.client = null;
    this.lock = null;

    if (err && err.authenticationFailed) {
      // Retrying a wrong password can get the account locked, so stop here.
      this.emit('status', 'Error: sign-in failed. Check your email and app password.');
      return;
    }

    const reason = err ? `Error: ${describe(err)}. Retrying…` : 'Disconnected. Reconnecting…';
    this.emit('status', reason);
    this.retryTimer = setTimeout(() => this.#connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, RETRY_MAX_MS);
  }

  async #teardown() {
    this.generation++;
    const { client, lock } = this;
    this.client = null;
    this.lock = null;
    try { lock && lock.release(); } catch { /* ignore */ }
    if (client) {
      try { await client.logout(); } catch { client.close(); }
    }
  }

  #schedulePoll() {
    clearInterval(this.pollTimer);
    const minutes = Math.max(1, this.getConfig().intervalMin || 10);
    this.pollTimer = setInterval(() => this.refresh(), minutes * 60 * 1000);
  }

  /* ---------------- syncing ---------------- */

  // One command batch at a time, in order.
  #enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  async #sync(announceNew) {
    const client = this.client;
    if (!client || !client.usable) return;

    const cfg = this.getConfig();
    const mailbox = client.mailbox;
    const validity = String(mailbox.uidValidity);

    // First run for this account (or the mailbox was rebuilt): only mail that
    // arrives from now on counts as new.
    let { account, uidValidity, lastUid } = syncState.load();
    if (account !== cfg.email || uidValidity !== validity || typeof lastUid !== 'number') {
      lastUid = mailbox.uidNext - 1;
      syncState.save({ account: cfg.email, uidValidity: validity, lastUid });
    }

    // 1) Messages that arrived since we last looked.
    const fresh = [];
    if (mailbox.exists > 0) {
      const range = `${lastUid + 1}:*`; // "n:*" always returns the last message, so filter below
      for await (const msg of client.fetch(range, { uid: true, flags: true, envelope: true, internalDate: true }, { uid: true })) {
        if (msg.uid > lastUid) fresh.push(toItem(msg));
      }
    }
    if (fresh.length) {
      fresh.sort((a, b) => a.uid - b.uid);
      lastUid = fresh[fresh.length - 1].uid;
      syncState.save({ account: cfg.email, uidValidity: validity, lastUid });
      const unread = fresh.filter((m) => !m.seen); // skip mail already read on another device
      if (announceNew && unread.length) this.emit('mail', unread);
    }

    // 2) Refresh the unread list shown in the settings window.
    const unseen = ((await client.search({ seen: false }, { uid: true })) || []).filter(
      (uid) => !this.hidden.has(uid)
    );
    const results = [];
    if (unseen.length) {
      const newest = unseen.slice(-UNREAD_LIMIT);
      for await (const msg of client.fetch(newest, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
        results.push(toItem(msg));
      }
    }
    results.sort((a, b) => b.date - a.date);
    this.emit('snapshot', { unreadCount: unseen.length, results, lastScan: Date.now() });
  }
}

module.exports = MailWatcher;