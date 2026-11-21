'use strict';

// Mark read / archive / delete, shared by the list rows and the reader toolbar.
// The email leaves the list straight away; if it was open, the reader moves on to
// the next email (like Gmail's auto-advance). If the server refuses, the list is
// restored from the main process.
App.actions = (() => {
  const KINDS = {
    read: { call: (uid) => api.markSeen(uid), done: 'Marked as read' },
    archive: { call: (uid) => api.archiveMail(uid), done: 'Archived' },
    trash: { call: (uid) => api.trashMail(uid), done: 'Moved to Trash' }
  };

  async function run(kind, uid) {
    const action = KINDS[kind];
    if (!action || !App.store.find(uid)) return;

    const { view, selected } = App.store.ui;
    const wasOpen = view === 'reader' && selected === uid;
    const next = wasOpen ? App.store.neighbourOf(uid, App.labels.filtered(App.store.mail.results)) : null;

    App.store.removeMail(uid);
    if (wasOpen) next ? App.reader.open(next.uid) : App.reader.close();

    const result = await action.call(uid);
    if (result && result.ok) {
      App.toast.show(action.done, 'ok');
    } else {
      App.toast.show((result && result.error) || 'Something went wrong.', 'error');
      App.store.setMail(await api.getState());
    }
  }

  // Stars or unstars an email. It moves to / from the top of the list at once.
  async function toggleStar(uid) {
    const mail = App.store.find(uid);
    if (!mail) return;
    const starred = !mail.starred;
    App.store.setStarred(uid, starred);
    const result = await api.starMail(uid, starred);
    if (result && result.ok) {
      App.toast.show(starred ? 'Starred' : 'Star removed', 'ok');
    } else {
      App.toast.show((result && result.error) || 'Something went wrong.', 'error');
      App.store.setMail(await api.getState());
    }
  }

  // Open one email (uid) or the whole mailbox (null) in the default browser.
  async function openInBrowser(uid) {
    const result = await api.openMail(uid);
    if (!result.ok) App.toast.show(result.error, 'error');
  }

  return { run, toggleStar, openInBrowser };
})();
