const { EventEmitter } = require('events');
const { createClient, describeError } = require('./imapClient');
const { toItem } = require('./messages');
const syncState = require('../storage/syncState');

const RETRY_MIN_MS = 5 * 1000;
const RETRY_MAX_MS = 60 * 1000; // back online within a minute after a network outage
const DEFAULT_LIMIT = 20; // when the settings have no maxEmails

// Starred emails first, then newest first.
const byStarThenDate = (a, b) => Number(b.starred) - Number(a.starred) || b.date - a.date;
const REFILL_DELAY_MS = 400; // groups quick removals into one list refresh

// threadId / emailId map to Gmail's X-GM-THRID / X-GM-MSGID (or RFC 8474 OBJECTID
// elsewhere). Gmail's web app uses them to link straight to a conversation.
const LIST_FIELDS = { uid: true, envelope: true, internalDate: true, threadId: true, emailId: true };


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
    this.refillTimer = null; // pending list refresh after a removal
    this.queue = Promise.resolve();
    this.hidden = new Set(); // uids being marked as read / moved right now
    this.folders = null;     // special-use folder paths for the current connection
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
    clearTimeout(this.refillTimer);
    await this.#teardown();
  }

  async restart() {
    await this.stop();
    this.start();
  }

  // Manual "Scan now" and the safety-net timer. No-op until connected.
  refresh() {
    return this.#enqueue(() => this.#sync(false)).catch((err) =>
      this.emit('status', `Error: ${this.#describe(err)}`)
    );
  }

  /* ---------------- connection ---------------- */

  // Marks one message as read on the server. It is hidden from the unread list
  // straight away, so a refresh that is already running can't bring it back.
  async markSeen(uid) {
    this.hidden.add(uid);
    try {
      await this.#enqueue(async () => {
        const client = this.#usableClient();
        const done = await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        if (!done) throw new Error('The server did not accept the change.');
      });
    } finally {
      this.hidden.delete(uid);
    }
    this.#refreshSoon();
  }

  // Downloads the full raw message. imapflow fetches with BODY.PEEK[], so this
  // does not mark the email as read. Resolves to a Buffer.
  fetchMessage(uid) {
    return this.#enqueue(async () => {
      const client = this.#usableClient();
      const result = await client.download(String(uid), undefined, { uid: true });
      if (!result || !result.content) throw new Error('That email could not be found.');
      const chunks = [];
      for await (const chunk of result.content) chunks.push(chunk);
      return Buffer.concat(chunks);
    });
  }

  // Path of the folder with this special-use flag (\Trash, \All, \Archive), or null.
  // Looked up once per connection.
  async folderFor(specialUse) {
    return this.#enqueue(() => this.#findFolder(specialUse));
  }

  // Moves one message out of INBOX into a special-use folder. Hidden from the
  // unread list while the move runs, like markSeen.
  async moveTo(uid, specialUse) {
    this.hidden.add(uid);
    try {
      await this.#enqueue(async () => {
        const client = this.#usableClient();
        const path = await this.#findFolder(specialUse);
        if (!path) throw new Error('This mailbox has no folder for that action.');
        const done = await client.messageMove(String(uid), path, { uid: true });
        if (!done) throw new Error('The server did not accept the change.');
      });
    } finally {
      this.hidden.delete(uid);
    }
    this.#refreshSoon();
  }

  // Stars (on = true) or unstars one message. Gmail shows IMAP's \Flagged as a star.
  async setStarred(uid, on) {
    await this.#enqueue(async () => {
      const client = this.#usableClient();
      const flags = ['\\Flagged'];
      const done = on
        ? await client.messageFlagsAdd(String(uid), flags, { uid: true })
        : await client.messageFlagsRemove(String(uid), flags, { uid: true });
      if (!done) throw new Error('The server did not accept the change.');
    });
    this.#refreshSoon(); // re-sorts the list; an unstarred email may fall outside the limit
  }

  // After an email leaves the unread list (read, archived, deleted), the next
  // unread one beyond the list limit moves up into it. Re-reading the list now,
  // instead of at the next poll, sends it to the window and to the classifier
  // (which then spam-checks it) right away. Rapid removals share one refresh.
  #refreshSoon() {
    clearTimeout(this.refillTimer);
    this.refillTimer = setTimeout(() => {
      if (this.running) this.refresh();
    }, REFILL_DELAY_MS);
  }

  #describe(err) {
    return describeError(err, this.getConfig()).replace(/\.+$/, '');
  }

  #usableClient() {
    const client = this.client;
    if (!client || !client.usable) throw new Error('Not connected to your mailbox.');
    return client;
  }

  async #findFolder(specialUse) {
    const client = this.#usableClient();
    if (!this.folders || this.folders.client !== client) {
      const list = await client.list();
      const map = {};
      for (const box of list) if (box.specialUse) map[box.specialUse] = box.path;
      this.folders = { client, map };
    }
    return this.folders.map[specialUse] || null;
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
        this.emit('status', `Error: ${this.#describe(err)}`)
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
      // Report the error first: close() emits 'close', which would otherwise
      // win the race and replace the real reason with "Disconnected".
      this.#onDrop(gen, err);
      try { client.close(); } catch { /* already closed */ }
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

    const reason = err ? `Error: ${this.#describe(err)}. Retrying…` : 'Disconnected. Reconnecting…';
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
      for await (const msg of client.fetch(range, { ...LIST_FIELDS, flags: true }, { uid: true })) {
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

    // 2) Refresh the unread list: every starred unread email (they don't count
    //    toward the limit), then the newest other unread emails up to the limit.
    const unseen = ((await client.search({ seen: false }, { uid: true })) || []).filter(
      (uid) => !this.hidden.has(uid)
    );
    const starred = new Set(
      unseen.length ? (await client.search({ seen: false, flagged: true }, { uid: true })) || [] : []
    );
    const limit = cfg.maxEmails || DEFAULT_LIMIT;
    const wanted = [
      ...unseen.filter((uid) => starred.has(uid)),
      ...unseen.filter((uid) => !starred.has(uid)).slice(-limit)
    ];
    const results = [];
    if (wanted.length) {
      for await (const msg of client.fetch(wanted, LIST_FIELDS, { uid: true })) {
        results.push({ ...toItem(msg), starred: starred.has(msg.uid) });
      }
    }
    results.sort(byStarThenDate);
    this.emit('snapshot', { unreadCount: unseen.length, results, lastScan: Date.now() });
  }
}

module.exports = MailWatcher;