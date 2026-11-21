'use strict';

// The unread list. Full page in the inbox view, a sidebar while reading.
App.inbox = (() => {
  const { $, h, shortDate, fullDate, paintAvatar } = App.dom;
  let el = null;

  function quickAction(kind, icon, label, mail) {
    return h('button', {
      type: 'button',
      class: 'row-action',
      title: label,
      'aria-label': `${label}: ${mail.subject}`,
      onClick: (e) => {
        e.stopPropagation();
        App.actions.run(kind, mail.uid);
      }
    }, App.icons.svg(icon));
  }

  function row(mail, selected) {
    const avatar = h('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true' });
    paintAvatar(avatar, mail.from);

    const main = h('button', {
      type: 'button',
      class: 'row-main',
      'aria-current': selected ? 'true' : null,
      onClick: () => App.reader.open(mail.uid)
    }, [
      avatar,
      h('span', { class: 'row-text' }, [
        h('span', { class: 'row-top' }, [
          h('span', { class: 'row-from', text: mail.from }),
          h('time', { class: 'row-date', text: shortDate(mail.date), title: fullDate(mail.date) })
        ]),
        h('span', { class: 'row-subject', text: mail.subject }),
        App.labels.rowChips(mail.uid)
      ])
    ]);

    const actions = h('span', { class: 'row-actions' }, [
      quickAction('archive', 'archive', 'Archive', mail),
      quickAction('trash', 'trash', 'Delete', mail),
      quickAction('read', 'read', 'Mark as read', mail)
    ]);

    const star = h('button', {
      type: 'button',
      class: mail.starred ? 'row-star is-starred' : 'row-star',
      title: mail.starred ? 'Starred (S to remove)' : 'Star (S)',
      'aria-pressed': mail.starred ? 'true' : 'false',
      'aria-label': `${mail.starred ? 'Unstar' : 'Star'}: ${mail.subject}`,
      onClick: () => App.actions.toggleStar(mail.uid)
    }, App.icons.svg(mail.starred ? 'star' : 'starOutline'));

    const classes = ['mail-row'];
    if (selected) classes.push('is-selected');
    if (mail.starred) classes.push('is-starred');
    return h('li', { class: classes.join(' '), dataset: { uid: String(mail.uid) } }, [star, main, actions]);
  }

  // Readable name for a filter key: "spam", "topic=Finance" or "urgency=2".
  function filterName(key, ai) {
    const [id, value] = key.split('=');
    const c = ((ai && ai.classifiers) || []).find((x) => x.id === id);
    if (!c) return 'that';
    if (value === undefined) return c.name;
    return c.type === 'score' && c.levels ? c.levels[Number(value)] || value : value;
  }

  // What to say when the list is empty depends on why it is empty.
  function emptyCopy(mail, config) {
    if (!config || !config.email || mail.status === 'Not configured') {
      return { title: 'Connect your mailbox', text: 'Add your email address and an app password to start.', setup: true };
    }
    if (mail.status.startsWith('Error')) {
      return { title: "Can't reach your mailbox", text: mail.status.replace(/^Error:\s*/, ''), setup: true };
    }
    if (!mail.lastScan) return { title: 'Checking your inbox…', text: 'This only takes a moment.', setup: false };
    return { title: "You're all caught up", text: 'No unread mail right now.', setup: false };
  }

  function render(store) {
    const { mail, ui, config } = store;
    const focusedUid = document.activeElement && document.activeElement.closest('.mail-row')
      ? document.activeElement.closest('.mail-row').dataset.uid
      : null;

    App.labels.renderFilterBar(el.filterBar);
    const visible = App.labels.filtered(mail.results);
    el.list.replaceChildren(...visible.map((m) => row(m, ui.view === 'reader' && ui.selected === m.uid)));

    // Keep keyboard focus on the same email across refreshes.
    if (focusedUid) {
      const again = el.list.querySelector(`.mail-row[data-uid="${focusedUid}"] .row-main`);
      if (again) again.focus();
    }

    el.badge.textContent = mail.unreadCount;
    el.badge.hidden = !mail.unreadCount;
    el.lastChecked.textContent = mail.lastScan ? `Checked ${shortDate(mail.lastScan)}` : '';

    const isEmpty = visible.length === 0;
    el.empty.hidden = !isEmpty;
    if (isEmpty) {
      const copy = ui.filter && mail.results.length
        ? { title: `Nothing labelled ${filterName(ui.filter, mail.ai)}`, text: 'Pick "All" above to see every unread email.', setup: false }
        : emptyCopy(mail, config);
      el.emptyTitle.textContent = copy.title;
      el.emptyText.textContent = copy.text;
      el.emptyAction.hidden = !copy.setup;
    }
  }

  // Keeps the selected row visible when switching with the keyboard.
  function revealSelected() {
    const node = el.list.querySelector('.mail-row.is-selected');
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  function init() {
    el = {
      list: $('mailList'),
      filterBar: $('labelFilter'),
      badge: $('unreadBadge'),
      lastChecked: $('lastChecked'),
      empty: $('inboxEmpty'),
      emptyTitle: $('inboxEmptyTitle'),
      emptyText: $('inboxEmptyText'),
      emptyAction: $('inboxEmptyAction')
    };
    el.emptyAction.addEventListener('click', () => App.app.showView('settings'));
    App.store.on((store, changed) => {
      if (changed === 'mail' || changed === 'ui' || changed === 'config') render(store);
      if (changed === 'ui') revealSelected();
    });
  }

  return { init };
})();
