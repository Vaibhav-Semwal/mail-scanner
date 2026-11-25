'use strict';

// Wires the modules together: views, top bar, keyboard shortcuts and start-up.
App.app = (() => {
  const { $, withBusy, shortDate } = App.dom;
  const root = $('app');

  // view: 'inbox' | 'reader' | 'compose' | 'settings'. Opening the reader goes
  // through App.reader.open, a new email through App.reader.newMessage.
  function showView(view) {
    if (view === 'reader' || view === 'compose') return;
    if (App.store.ui.view === 'reader' || App.store.ui.view === 'compose') App.reader.close();
    App.store.setUi({ view, selected: null });
  }

  function renderShell(store) {
    root.dataset.view = store.ui.view;

    const { status, lastScan, canOpen } = store.mail;
    const tone = status.startsWith('Error') ? 'error' : status.startsWith('Watching') ? 'ok' : 'idle';
    $('statusPill').dataset.tone = tone;
    $('statusText').textContent = status;
    $('statusPill').title = lastScan ? `${status}. Last checked ${shortDate(lastScan)}.` : status;
    $('gmailBtn').hidden = !canOpen;
    $('navSettings').classList.toggle('is-active', store.ui.view === 'settings');
    $('composeBtn').classList.toggle('is-active', store.ui.view === 'compose');
    $('composeDot').hidden = store.ui.view === 'compose' || !App.composer.hasNewDraft();
  }

  const isTyping = (target) => target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

  // Gmail-like shortcuts. Arrow keys / j k switch emails, Esc goes back.
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const { view } = App.store.ui;

    if (e.key === 'Escape' && view !== 'inbox') {
      e.preventDefault();
      showView('inbox');
      return;
    }
    if (view === 'settings') return;
    if (e.key === 'c' && view !== 'compose') {
      e.preventDefault(); // don't type the "c" into the To field it focuses
      App.reader.newMessage();
      return;
    }

    const down = e.key === 'ArrowDown' || e.key === 'j';
    const up = e.key === 'ArrowUp' || e.key === 'k';
    if (view === 'reader') {
      if (down || up) {
        e.preventDefault();
        App.reader.step(down ? 1 : -1);
      } else if (e.key === 'e') App.reader.act('archive');
      else if (e.key === '#' || e.key === 'Delete') App.reader.act('trash');
      else if (e.key === 'i') App.reader.act('read');
      else if (e.key === 's') App.reader.toggleStar();
      else if (e.key === 'r' || e.key === 'a' || e.key === 'f') {
        e.preventDefault(); // don't type the letter into the composer it focuses
        App.reader.compose({ r: 'reply', a: 'replyAll', f: 'forward' }[e.key]);
      }
      return;
    }
    // Inbox view: S stars the focused row.
    const focusedRow = document.activeElement && document.activeElement.closest('#mailList .mail-row');
    if (e.key === 's' && focusedRow) {
      App.actions.toggleStar(Number(focusedRow.dataset.uid));
      return;
    }
    // Inbox view: arrows move focus between rows; Enter opens (native button).
    if (down || up) {
      const rows = [...document.querySelectorAll('#mailList .row-main')];
      if (!rows.length) return;
      e.preventDefault();
      const i = rows.indexOf(document.activeElement);
      rows[Math.min(rows.length - 1, Math.max(0, i === -1 ? 0 : i + (down ? 1 : -1)))].focus();
    }
  }

  async function init() {
    App.icons.mount();
    App.inbox.init();
    App.composer.init();
    App.reader.init();
    App.settings.init();
    App.smartLabels.init();
    App.appearanceUi.init();
    App.store.on(renderShell);

    // Registered first so a notification click during start-up isn't lost.
    api.onShowMail((uid) => App.reader.open(uid));
    api.onState((mail) => App.store.setMail(mail));

    $('navInbox').addEventListener('click', () => showView('inbox'));
    $('navSettings').addEventListener('click', () =>
      showView(App.store.ui.view === 'settings' ? 'inbox' : 'settings')
    );
    $('composeBtn').addEventListener('click', () => App.reader.newMessage());
    $('gmailBtn').addEventListener('click', () => App.actions.openInBrowser(null));
    $('scanBtn').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.classList.add('is-spinning');
      withBusy(btn, () => api.scanNow()).finally(() => btn.classList.remove('is-spinning'));
    });
    document.addEventListener('keydown', onKey);

    const [config, mail, aiConfig] = await Promise.all([api.getConfig(), api.getState(), api.getAi()]);
    App.store.setConfig(config);
    App.store.setAiConfig(aiConfig);
    App.store.setMail(mail);
    // First run: go straight to setup. (Unless a notification already opened an email.)
    if ((!config.email || !config.hasPassword) && App.store.ui.view === 'inbox') showView('settings');
    else renderShell(App.store);
  }

  return { init, showView };
})();

App.app.init();
