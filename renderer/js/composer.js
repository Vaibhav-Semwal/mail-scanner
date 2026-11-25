'use strict';

// The chat-style composer under an open email: reply, reply all or forward, with
// To / Cc / Bcc / Subject and files from the PC (the + button, drag and drop, or
// paste). Each email keeps its own draft while you move around the list, and what
// you send shows up in the thread like a chat message.
App.composer = (() => {
  const { $, h, shortDate, fullDate, formatSize, paintAvatar } = App.dom;
  const MAX_FILE = 25 * 1024 * 1024;
  const TEXT_MAX_HEIGHT = 240;

  let el = null;
  let fields = null;   // recipient inputs { to, cc, bcc }
  let mail = null;     // the loaded email being answered, or null
  let state = null;    // the current draft
  let sending = false;
  const drafts = new Map(); // uid -> draft
  const sent = new Map();   // uid -> [{ ... }] what was sent from this window

  const nameOf = (a) => a.name || a.address;
  const current = () => mail;
  const myAddress = () => ((App.store.config && App.store.config.email) || '').toLowerCase();

  /* ---------------- drafts ---------------- */

  function prefixed(subject, prefix, test) {
    const s = subject || '';
    return test.test(s) ? s : `${prefix} ${s}`.trim();
  }

  // Recipients and subject for a mode, from the email being answered.
  function defaultsFor(mode, mail = current()) {
    if (mode === 'forward') {
      return { to: [], cc: [], subject: prefixed(mail.subject, 'Fwd:', /^\s*fwd?:/i) };
    }
    const me = myAddress();
    const target = (mail.replyTo && mail.replyTo.length ? mail.replyTo : [mail.from]).filter((a) => a.address);
    const taken = new Set([me, ...target.map((a) => a.address.toLowerCase())]);
    const cc = mode === 'replyAll'
      ? [...mail.to, ...mail.cc].filter((a) => {
          const key = (a.address || '').toLowerCase();
          if (!key || taken.has(key)) return false;
          taken.add(key);
          return true;
        })
      : [];
    return { to: target, cc, subject: prefixed(mail.subject, 'Re:', /^\s*re:/i) };
  }

  function freshDraft(mode = 'reply') {
    const d = defaultsFor(mode);
    return { mode, to: d.to, cc: d.cc, bcc: [], subject: d.subject, text: '', files: [], includeOriginal: true, ccOpen: d.cc.length > 0, bccOpen: false, open: false };
  }

  // Copies what's on screen back into the draft object.
  function capture() {
    if (!state) return;
    state.to = fields.to.get();
    state.cc = fields.cc.get();
    state.bcc = fields.bcc.get();
    state.subject = el.subject.value;
    state.text = el.text.value;
    state.includeOriginal = el.orig.checked;
  }

  function isEmpty(d) {
    return !d.text.trim() && !d.files.length;
  }

  /* ---------------- rendering ---------------- */

  function renderContext() {
    const mode = state ? state.mode : 'reply';
    el.modeIcon.replaceChildren(App.icons.svg(mode === 'forward' ? 'forward' : mode === 'replyAll' ? 'replyAll' : 'reply'));
    const strong = (text) => h('strong', { text });
    if (!mail) el.contextText.replaceChildren('Open an email to reply');
    else if (mode === 'forward') el.contextText.replaceChildren('Forwarding ', strong(mail.subject));
    else if (mode === 'replyAll') el.contextText.replaceChildren('Replying to ', strong('everyone'));
    else el.contextText.replaceChildren('Replying to ', strong(nameOf(mail.from)));

    el.modes.querySelectorAll('.mode-pill').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-picked', on);
      b.setAttribute('aria-checked', String(on));
    });

    el.text.placeholder = !mail ? 'Message'
      : mode === 'forward' ? 'Add a note (optional)'
        : `Message @${nameOf(mode === 'replyAll' ? { name: 'everyone' } : mail.from)}`;

    const originals = mail ? mail.attachments.length : 0;
    el.origRow.hidden = !(mode === 'forward' && originals);
    el.origText.textContent = `Include the original ${originals === 1 ? 'attachment' : `${originals} attachments`}`;
  }

  function renderFields() {
    el.ccRow.hidden = !state.ccOpen;
    el.bccRow.hidden = !state.bccOpen;
    el.ccToggle.hidden = state.ccOpen;
    el.bccToggle.hidden = state.bccOpen;
  }

  function uploadTile(file) {
    const preview = file.thumb
      ? h('img', { class: 'upload-thumb', src: file.thumb, alt: '' })
      : h('div', { class: 'upload-icon' }, App.icons.svg('file'));
    return h('li', { class: 'upload', title: file.name }, [
      preview,
      h('div', { class: 'upload-meta' }, [
        h('span', { class: 'upload-name', text: file.name }),
        h('span', { class: 'upload-size', text: formatSize(file.size) })
      ]),
      h('button', {
        type: 'button',
        class: 'upload-x',
        title: 'Remove',
        'aria-label': `Remove ${file.name}`,
        onclick: () => removeFile(file.id)
      }, App.icons.svg('trash'))
    ]);
  }

  function renderUploads() {
    const files = state ? state.files : [];
    el.uploads.replaceChildren(...files.map(uploadTile));
    el.uploads.hidden = files.length === 0;
  }

  function renderAll() {
    renderContext();
    if (!state) return;
    fields.to.set(state.to);
    fields.cc.set(state.cc);
    fields.bcc.set(state.bcc);
    el.subject.value = state.subject;
    el.text.value = state.text;
    el.orig.checked = state.includeOriginal;
    renderFields();
    renderUploads();
    autosize();
  }

  // The composer is hidden until you reply or forward; a slim bar of buttons
  // stands in for it so the email gets the room.
  function renderOpen() {
    const open = Boolean(state && state.open);
    el.form.hidden = !open;
    el.bar.hidden = open;
    el.pane.classList.toggle('is-composing', open);
    el.resume.hidden = !(state && !open && (!isEmpty(state) || state.mode !== 'reply'));
    el.bar.querySelectorAll('button').forEach((b) => { b.disabled = !state; });
  }

  function show() {
    if (!state || state.open) return;
    state.open = true;
    renderOpen();
    if (state.mode === 'forward' && !fields.to.get().length) fields.to.focus();
    else el.text.focus();
  }

  // Hides the composer. The draft is kept and can be picked up again.
  function hide() {
    if (!state || !state.open) return;
    fields.to.commit();
    fields.cc.commit();
    fields.bcc.commit();
    capture();
    state.open = false;
    renderOpen();
  }

  function setEnabled(on) {
    el.form.classList.toggle('is-disabled', !on);
    for (const node of el.form.querySelectorAll('input, textarea, button')) node.disabled = !on;
  }

  function autosize() {
    el.text.style.height = 'auto';
    el.text.style.height = `${Math.min(el.text.scrollHeight, TEXT_MAX_HEIGHT)}px`;
  }

  /* ---------------- the thread of sent messages ---------------- */

  function sentMessage(entry) {
    const avatar = h('div', { class: 'avatar', 'aria-hidden': 'true' });
    paintAvatar(avatar, myAddress() || 'You');
    const verb = entry.mode === 'forward' ? 'forwarded to' : 'replied to';
    const files = entry.files.map((f) =>
      h('li', { class: 'chip', title: f.name }, [App.icons.svg('attach'), h('span', { class: 'chip-name', text: f.name }), h('span', { class: 'chip-size', text: formatSize(f.size) })])
    );
    return h('article', { class: 'msg msg-sent' }, [
      avatar,
      h('div', { class: 'msg-main' }, [
        h('div', { class: 'msg-head' }, [
          h('strong', { class: 'msg-author', text: 'You' }),
          h('span', { class: 'sent-badge' }, [App.icons.svg(entry.mode === 'forward' ? 'forward' : 'reply'), 'Sent']),
          h('time', { class: 'msg-time', title: fullDate(entry.at), text: shortDate(entry.at) })
        ]),
        h('div', { class: 'muted small msg-to', text: `${verb} ${entry.recipients.join(', ')}` }),
        entry.subject !== entry.originalSubject ? h('div', { class: 'sent-subject', text: entry.subject }) : null,
        entry.text.trim() ? h('div', { class: 'sent-text', text: entry.text }) : null,
        files.length ? h('ul', { class: 'attachments' }, files) : null
      ])
    ]);
  }

  function renderSent() {
    const list = (mail && sent.get(mail.uid)) || [];
    el.sent.replaceChildren(...list.map(sentMessage));
  }

  /* ---------------- files ---------------- */

  async function pickFiles() {
    if (!state) return;
    const result = await api.pickFiles();
    if (result.files && result.files.length) addFiles(result.files);
    if (!result.ok) App.toast.show(result.error, 'error');
    el.text.focus();
  }

  function addFiles(files) {
    if (!state) return api.discardFiles(files.map((f) => f.id));
    state.files.push(...files);
    renderUploads();
  }

  // Dropped or pasted files (File objects) are read here and handed over as bytes.
  async function addLocalFiles(fileList) {
    const files = [...fileList].filter((f) => f.size > 0 || f.type);
    if (!files.length || !state) return;
    const owner = state;
    for (const file of files) {
      if (file.size > MAX_FILE) {
        App.toast.show(`${file.name} is larger than 25 MB, which most mail servers refuse.`, 'error');
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const name = file.name || `pasted-${Date.now()}.${(file.type.split('/')[1] || 'bin').replace(/\W/g, '')}`;
      const result = await api.addFileData(name, file.type, bytes);
      if (!result.ok) {
        App.toast.show(result.error, 'error');
        continue;
      }
      if (owner === state) addFiles([result.file]);
      else owner.files.push(result.file); // the user moved to another email meanwhile
    }
  }

  function removeFile(id) {
    if (!state) return;
    state.files = state.files.filter((f) => f.id !== id);
    api.discardFiles([id]);
    renderUploads();
  }

  /* ---------------- sending ---------------- */

  async function send() {
    if (!state || !mail || sending) return;
    fields.to.commit();
    fields.cc.commit();
    fields.bcc.commit();
    capture();

    const invalid = [...fields.to.invalid(), ...fields.cc.invalid(), ...fields.bcc.invalid()];
    if (invalid.length) return App.toast.show(`"${invalid[0]}" is not an email address.`, 'error');
    if (!state.to.length && !state.cc.length && !state.bcc.length) {
      App.toast.show('Add at least one recipient.', 'error');
      return fields.to.focus();
    }
    if (state.mode !== 'forward' && isEmpty(state)) {
      App.toast.show('Write a message first.', 'error');
      return el.text.focus();
    }

    const draft = state;
    const original = mail;
    const payload = {
      mode: draft.mode,
      uid: original.uid,
      to: draft.to.map((r) => r.address),
      cc: draft.cc.map((r) => r.address),
      bcc: draft.bcc.map((r) => r.address),
      subject: draft.subject,
      text: draft.text,
      attachmentIds: draft.files.map((f) => f.id),
      includeOriginal: draft.mode === 'forward' && draft.includeOriginal
    };

    sending = true;
    el.form.classList.add('is-sending');
    el.send.disabled = true;
    App.toast.show('Sending…');
    const result = await api.sendMail(payload);
    sending = false;
    el.form.classList.remove('is-sending');
    el.send.disabled = false;

    if (!result || !result.ok) return App.toast.show((result && result.error) || 'Could not send it.', 'error');

    App.toast.show(draft.mode === 'forward' ? 'Forwarded' : 'Reply sent', 'ok');
    const entry = {
      mode: draft.mode,
      recipients: [...draft.to, ...draft.cc, ...draft.bcc].map(nameOf),
      subject: draft.subject,
      originalSubject: defaultsFor(draft.mode, original).subject,
      text: draft.text,
      files: draft.files.map(({ name, size }) => ({ name, size })),
      at: Date.now()
    };
    sent.set(original.uid, [...(sent.get(original.uid) || []), entry]);
    drafts.delete(original.uid);
    if (mail === original) {
      state = freshDraft('reply'); // starts hidden again
      renderAll();
      renderOpen();
      renderSent();
      el.channel.scrollTo({ top: el.channel.scrollHeight, behavior: 'smooth' });
    }
  }

  /* ---------------- public ---------------- */

  // The reader loaded an email: restore its draft, or start a reply.
  function attach(loaded) {
    detach();
    mail = loaded;
    state = drafts.get(loaded.uid) || freshDraft('reply');
    setEnabled(true);
    renderAll();
    renderOpen();
    renderSent();
  }

  // The reader is moving on: keep a draft if there is one.
  function detach() {
    if (mail && state) {
      capture();
      if (isEmpty(state) && state.mode === 'reply') {
        drafts.delete(mail.uid);
      } else {
        drafts.set(mail.uid, state);
      }
    }
    mail = null;
    state = null;
    el.dropZone.hidden = true;
    el.sent.replaceChildren();
    setEnabled(false);
    renderContext();
    renderOpen();
  }

  // Switches between reply / reply all / forward. The message and files stay.
  function start(mode) {
    if (!mail || !state || !['reply', 'replyAll', 'forward'].includes(mode)) return;
    capture();
    if (state.mode !== mode) {
      const d = defaultsFor(mode);
      Object.assign(state, { mode, to: d.to, cc: d.cc, subject: d.subject, ccOpen: state.ccOpen || d.cc.length > 0 });
      renderAll();
    }
    state.open = true;
    renderOpen();
    if (mode === 'forward') fields.to.focus();
    else el.text.focus();
  }

  function init() {
    el = {
      form: $('composer'),
      channel: $('rChannel'),
      sent: $('rSent'),
      modeIcon: $('cModeIcon'),
      contextText: $('cContextText'),
      modes: $('cModes'),
      ccRow: $('cCcRow'),
      bccRow: $('cBccRow'),
      ccToggle: $('cCcToggle'),
      bccToggle: $('cBccToggle'),
      subject: $('cSubject'),
      uploads: $('cUploads'),
      origRow: $('cOrigRow'),
      orig: $('cOrig'),
      origText: $('cOrigText'),
      attach: $('cAttach'),
      text: $('cText'),
      send: $('cSend'),
      dropZone: $('dropZone'),
      bar: $('composeBar'),
      resume: $('cResume'),
      pane: $('readerPane')
    };
    fields = {
      to: App.recipients.create($('cTo')),
      cc: App.recipients.create($('cCc')),
      bcc: App.recipients.create($('cBcc'))
    };

    el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      send();
    });
    el.text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    el.form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation(); // only hide the composer, don't also leave the email
        hide();
      }
    });
    $('cClose').addEventListener('click', hide);
    el.resume.addEventListener('click', show);
    el.text.addEventListener('input', autosize);
    el.text.addEventListener('paste', (e) => {
      if (e.clipboardData.files.length) {
        e.preventDefault();
        addLocalFiles(e.clipboardData.files);
      }
    });
    el.attach.addEventListener('click', pickFiles);
    el.modes.addEventListener('click', (e) => {
      const pill = e.target.closest('.mode-pill');
      if (pill) start(pill.dataset.mode);
    });
    el.ccToggle.addEventListener('click', () => {
      if (!state) return;
      state.ccOpen = true;
      renderFields();
      fields.cc.focus();
    });
    el.bccToggle.addEventListener('click', () => {
      if (!state) return;
      state.bccOpen = true;
      renderFields();
      fields.bcc.focus();
    });

    // Drag files anywhere over the open email to attach them. Once shown, the
    // overlay takes all drag events, so the email's frame never sees the drop.
    const hasFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
    el.pane.addEventListener('dragenter', (e) => {
      if (hasFiles(e) && state) el.dropZone.hidden = false;
    });
    el.dropZone.addEventListener('dragover', (e) => e.preventDefault());
    el.dropZone.addEventListener('dragleave', () => { el.dropZone.hidden = true; });
    el.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      el.dropZone.hidden = true;
      if (!state) return;
      show(); // dropping files starts (or reopens) a reply
      addLocalFiles(e.dataTransfer.files);
    });
    // A file dropped outside the pane must never navigate the window away.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    detach();
  }

  return { init, attach, detach, start, show, hide };
})();
