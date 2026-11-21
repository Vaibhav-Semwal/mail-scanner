'use strict';

// Single source of truth for the window.
//   mail: what the main process last reported (status, unread list, …)
//   ui:   which view is showing and which email is selected
// Modules subscribe with App.store.on(fn); fn(store, changed) runs after every change.
App.store = (() => {
  const listeners = [];

  const store = {
    mail: { status: 'Starting…', lastScan: null, unreadCount: 0, results: [], canOpen: false },
    ui: { view: 'inbox', selected: null, filter: null }, // filter: classifier id or null
    config: null,
    aiConfig: null // smart-label settings (classifiers, model) from api.getAi()
  };

  function emit(changed) {
    listeners.forEach((fn) => fn(store, changed));
  }

  return {
    get mail() { return store.mail; },
    get ui() { return store.ui; },
    get config() { return store.config; },
    get aiConfig() { return store.aiConfig; },

    setAiConfig(aiConfig) {
      store.aiConfig = aiConfig;
      emit('ai-config');
    },

    on(fn) { listeners.push(fn); },

    setMail(mail) {
      store.mail = mail;
      emit('mail');
    },

    setConfig(config) {
      store.config = config;
      emit('config');
    },

    setUi(partial) {
      Object.assign(store.ui, partial);
      emit('ui');
    },

    // Optimistic removal: the row disappears before the server confirms.
    removeMail(uid) {
      const results = store.mail.results.filter((m) => m.uid !== uid);
      if (results.length === store.mail.results.length) return;
      store.mail = { ...store.mail, results, unreadCount: Math.max(0, store.mail.unreadCount - 1) };
      emit('mail');
    },

    // Optimistic star: starred emails sit at the top, newest first.
    setStarred(uid, starred) {
      if (!this.find(uid)) return;
      const results = store.mail.results
        .map((m) => (m.uid === uid ? { ...m, starred } : m))
        .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || b.date - a.date);
      store.mail = { ...store.mail, results };
      emit('mail');
    },

    find(uid) {
      return store.mail.results.find((m) => m.uid === uid) || null;
    },

    // The email next to uid in the list (the one below, else the one above).
    neighbourOf(uid, list = store.mail.results) {
      const i = list.findIndex((m) => m.uid === uid);
      if (i === -1) return null;
      return list[i + 1] || list[i - 1] || null;
    }
  };
})();
