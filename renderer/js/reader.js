'use strict';

// Shows one email: toolbar, Gmail-style header and the sandboxed body frame.
// The body is served by the main process at mail-view://msg/<uid>; this window
// never handles the email's HTML itself.
App.reader = (() => {
  const { $, h, shortDate, fullDate, formatSize, paintAvatar } = App.dom;
  let el = null;
  let current = null; // the loaded email, or null while loading / on error
  let token = 0;      // ignores slow loads after the user has moved on

  const nameOf = (a) => a.name || a.address;

  function setButtons(mail) {
    el.archive.disabled = !mail || !mail.canArchive;
    el.trash.disabled = !mail || !mail.canDelete;
    el.read.disabled = !mail;
    el.open.hidden = !App.store.mail.canOpen;
    renderStar();
  }

  // The toolbar star follows the list item, so it updates with the list.
  function renderStar() {
    const uid = selectedUid();
    const item = uid === null ? null : App.store.find(uid);
    const starred = Boolean(item && item.starred);
    el.star.disabled = !item;
    el.star.classList.toggle('is-starred', starred);
    el.star.setAttribute('aria-pressed', String(starred));
    el.star.title = starred ? 'Remove star (S)' : 'Star (S)';
    el.starLabel.textContent = starred ? 'Starred' : 'Star';
    el.starIcon.replaceChildren(App.icons.svg(starred ? 'star' : 'starOutline'));
  }

  function toggleStar() {
    const uid = selectedUid();
    if (uid !== null && App.store.find(uid)) App.actions.toggleStar(uid);
  }

  // Label chips under the subject, plus the spam likelihood as Gmail-style banner
  // when it's high. Re-run whenever new scores arrive.
  function renderLabels() {
    const uid = App.store.ui.view === 'reader' ? App.store.ui.selected : null;
    if (uid === null) {
      el.labels.hidden = true;
      el.spam.hidden = true;
      return;
    }
    const matches = App.labels.matchesFor(uid).filter((m) => m.key !== App.labels.SPAM_ID);
    const spam = App.labels.spamScore(uid);
    const chips = matches.map((m) => App.labels.chip(m));
    if (spam !== null) {
      chips.unshift(h('span', {
        class: spam >= 60 ? 'spam-meter is-high' : spam >= 30 ? 'spam-meter is-mid' : 'spam-meter',
        title: 'How likely this email is spam, according to the local AI'
      }, `Spam likelihood ${spam}%`));
    } else if (App.labels.isPending(uid)) {
      chips.unshift(h('span', { class: 'spam-meter is-pending' }, 'Checking with Laya…'));
    }
    el.labels.replaceChildren(...chips);
    el.labels.hidden = chips.length === 0;

    el.spam.hidden = !(spam !== null && spam >= 60);
  }

  function reset() {
    current = null;
    el.subject.textContent = '';
    el.avatar.textContent = '';
    el.fromName.textContent = '';
    el.fromAddr.textContent = '';
    el.to.textContent = '';
    el.date.textContent = '';
    el.date.title = '';
    el.attachments.replaceChildren();
    el.attachments.hidden = true;
    el.error.hidden = true;
    el.loading.hidden = true;
    el.body.hidden = true;
    el.body.removeAttribute('src');
    setButtons(null);
  }

  // Shows what the list already knows while the full email downloads.
  function preview(item) {
    if (!item) return;
    el.subject.textContent = item.subject;
    el.fromName.textContent = item.from;
    paintAvatar(el.avatar, item.from);
    el.date.textContent = shortDate(item.date);
    el.date.title = fullDate(item.date);
  }

  function fill(mail) {
    el.subject.textContent = mail.subject;
    el.fromName.textContent = nameOf(mail.from);
    el.fromAddr.textContent = mail.from.name && mail.from.address ? `<${mail.from.address}>` : '';
    paintAvatar(el.avatar, nameOf(mail.from));

    const parts = [];
    if (mail.to.length) parts.push(`to ${mail.to.map(nameOf).join(', ')}`);
    if (mail.cc.length) parts.push(`cc ${mail.cc.map(nameOf).join(', ')}`);
    el.to.textContent = parts.join('  ·  ');
    el.to.title = el.to.textContent;

    el.date.textContent = shortDate(mail.date);
    el.date.title = fullDate(mail.date);

    el.attachments.replaceChildren(
      ...mail.attachments.map((a) =>
        h('li', { class: 'chip', title: a.filename }, [
          App.icons.svg('attach'),
          h('span', { class: 'chip-name', text: a.filename }),
          h('span', { class: 'chip-size', text: formatSize(a.size) })
        ])
      )
    );
    el.attachments.hidden = mail.attachments.length === 0;

    el.body.src = `mail-view://msg/${mail.uid}`;
    el.body.hidden = false;
  }

  async function open(uid) {
    if (!Number.isInteger(uid)) return;
    const mine = ++token;
    App.store.setUi({ view: 'reader', selected: uid });
    reset();
    preview(App.store.find(uid));
    renderLabels();
    el.loading.hidden = false;

    const result = await api.getMail(uid);
    if (mine !== token) return;
    el.loading.hidden = true;
    if (!result.ok) {
      el.error.textContent = result.error;
      el.error.hidden = false;
      return;
    }
    current = result.mail;
    fill(current);
    setButtons(current);
  }

  function close() {
    token++;
    reset();
    App.store.setUi({ view: 'inbox', selected: null });
  }

  // Moves to the email above (-1) or below (+1) the open one in the list.
  function step(direction) {
    const list = App.labels.filtered(App.store.mail.results); // stay inside the current filter
    if (!list.length) return;
    const i = list.findIndex((m) => m.uid === App.store.ui.selected);
    const next = list[i === -1 ? 0 : Math.min(list.length - 1, Math.max(0, i + direction))];
    if (next && next.uid !== App.store.ui.selected) open(next.uid);
  }

  const selectedUid = () => (App.store.ui.view === 'reader' ? App.store.ui.selected : null);

  function act(kind) {
    const uid = selectedUid();
    if (uid !== null && current) App.actions.run(kind, uid);
  }

  function init() {
    el = {
      back: $('rBack'),
      open: $('rOpen'),
      archive: $('rArchive'),
      trash: $('rDelete'),
      read: $('rRead'),
      star: $('rStar'),
      starIcon: document.querySelector('#rStar .star-icon'),
      starLabel: document.querySelector('#rStar .tool-label'),
      subject: $('rSubject'),
      avatar: $('rAvatar'),
      fromName: $('rFromName'),
      fromAddr: $('rFromAddr'),
      to: $('rTo'),
      date: $('rDate'),
      attachments: $('rAttachments'),
      loading: $('rLoading'),
      error: $('rError'),
      body: $('rBody'),
      labels: $('rLabels'),
      spam: $('rSpamBanner')
    };
    el.back.addEventListener('click', close);
    el.open.addEventListener('click', () => {
      const uid = selectedUid();
      if (uid !== null) App.actions.openInBrowser(uid);
    });
    el.archive.addEventListener('click', () => act('archive'));
    el.trash.addEventListener('click', () => act('trash'));
    el.read.addEventListener('click', () => act('read'));
    el.star.addEventListener('click', toggleStar);

    App.store.on((store, changed) => {
      if (changed === 'mail') el.open.hidden = !store.mail.canOpen;
      if (changed === 'mail' || changed === 'ui') {
        renderLabels();
        renderStar();
      }
    });
  }

  return { init, open, close, step, act, toggleStar };
})();
