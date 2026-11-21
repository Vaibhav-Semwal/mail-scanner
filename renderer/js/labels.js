'use strict';

// Smart labels in the window. Results come from the main process in mail.ai
// (see src/ai/engine.js), one per classifier, shaped by Laya's question types:
//   noul   { p }                  -> a label when p >= threshold
//   choice { choice, conf }       -> the picked option as the label
//   score  { score, level, conf } -> the level's name (the lowest level = no label)
// null means Laya couldn't answer.
App.labels = (() => {
  const { h } = App.dom;
  const SPAM_ID = 'spam';
  const isOther = (name) => /^other$/i.test(name);
  const MIN_CHOICE_CONFIDENCE = 0.35;

  const ai = () => App.store.mail.ai || null;
  const enabledClassifiers = () => ((ai() && ai().classifiers) || []).filter((c) => c.enabled);
  const resultsOf = (uid) => (ai() && ai().scores && ai().scores[uid]) || {};

  // One label for classifier c with result r, or null when nothing should show.
  // key identifies the label for filtering; strength sorts labels (0..1).
  function labelFor(c, r) {
    if (!r) return null;
    if (c.type === 'noul') {
      if (r.p < ai().threshold) return null;
      const pct = Math.round(r.p * 100);
      return { key: c.id, classifier: c, text: c.id === SPAM_ID ? `${c.name} ${pct}%` : c.name, title: `${c.name}: ${pct}% likely`, strength: r.p };
    }
    if (c.type === 'choice') {
      // Laya always picks something; a low-confidence pick is a guess, not a label.
      if (isOther(r.choice) || (r.conf != null && r.conf < MIN_CHOICE_CONFIDENCE)) return null;
      const conf = r.conf != null ? ` (confidence ${Math.round(r.conf * 100)}%)` : '';
      return { key: `${c.id}=${r.choice}`, classifier: c, text: r.choice, title: `${c.name}: ${r.choice}${conf}`, strength: 0.5 + (r.conf || 0) / 2 };
    }
    if (c.type === 'score') {
      if (!c.levels || r.level < 1) return null;
      const top = c.levels.length - 1;
      return { key: `${c.id}=${r.level}`, classifier: c, text: c.levels[r.level], title: `${c.name}: ${c.levels[r.level]} (${r.level} of ${top})`, strength: r.level / top };
    }
    return null;
  }

  // Labels for one email, strongest first.
  function matchesFor(uid) {
    if (!ai()) return [];
    const results = resultsOf(uid);
    return enabledClassifiers()
      .map((c) => labelFor(c, results[c.id]))
      .filter(Boolean)
      // Spam first (it matters most), then the strongest answers.
      .sort((a, b) => (b.key === SPAM_ID) - (a.key === SPAM_ID) || b.strength - a.strength);
  }

  // Spam likelihood 0-100, or null when unknown / spam classifier off.
  function spamScore(uid) {
    if (!enabledClassifiers().some((c) => c.id === SPAM_ID)) return null;
    const r = resultsOf(uid)[SPAM_ID];
    return r && typeof r.p === 'number' ? Math.round(r.p * 100) : null;
  }

  const isPending = (uid) => {
    const a = ai();
    return Boolean(a && a.status === 'ready' && a.pending && a.pending.includes(uid));
  };
  const isWorking = (uid) => Boolean(ai() && ai().working === uid);

  function chip(label) {
    const node = h('span', { class: 'label-chip', text: label.text, title: label.title });
    node.style.setProperty('--label', label.classifier.color);
    return node;
  }

  // Chips for a list row (at most 3, plus "+n").
  function rowChips(uid) {
    const matches = matchesFor(uid);
    const shown = matches.slice(0, 3).map(chip);
    if (matches.length > 3) shown.push(h('span', { class: 'label-chip label-more', text: `+${matches.length - 3}` }));
    if (!matches.length && isPending(uid)) {
      shown.push(h('span', { class: 'label-pending', title: 'Waiting for Laya' }, [
        h('span', { class: isWorking(uid) ? 'pulse is-working' : 'pulse' })
      ]));
    }
    return shown.length ? h('span', { class: 'row-labels' }, shown) : null;
  }

  // The list narrowed to the current filter (a label key), or all of it.
  function filtered(results) {
    const key = App.store.ui.filter;
    if (!key) return results;
    return results.filter((m) => matchesFor(m.uid).some((l) => l.key === key));
  }

  // Filter chips above the list: All + every label that some email has.
  function renderFilterBar(container) {
    const results = App.store.mail.results;
    const current = App.store.ui.filter;
    const found = new Map(); // key -> { label, count }
    for (const m of results) {
      for (const l of matchesFor(m.uid)) {
        const entry = found.get(l.key) || { label: l, count: 0 };
        entry.count++;
        found.set(l.key, entry);
      }
    }
    // Keep classifier order, then by count.
    const order = enabledClassifiers().map((c) => c.id);
    const entries = [...found.values()].sort((a, b) =>
      order.indexOf(a.label.classifier.id) - order.indexOf(b.label.classifier.id) || b.count - a.count
    );

    if (current && !found.has(current)) App.store.ui.filter = null; // its emails are gone
    container.hidden = entries.length === 0;
    if (container.hidden) return;

    const active = App.store.ui.filter;
    const button = (key, text, color, count, title) => {
      const node = h('button', {
        type: 'button',
        class: active === key ? 'filter-chip is-active' : 'filter-chip',
        title,
        'aria-pressed': active === key ? 'true' : 'false',
        onClick: () => App.store.setUi({ filter: active === key ? null : key })
      }, [
        color ? h('span', { class: 'filter-dot', 'aria-hidden': 'true' }) : null,
        h('span', { text }),
        h('span', { class: 'filter-count', text: String(count) })
      ]);
      if (color) node.style.setProperty('--label', color);
      return node;
    };
    container.replaceChildren(
      button(null, 'All', null, results.length, 'Show every unread email'),
      ...entries.map(({ label, count }) => {
        const text = label.classifier.type === 'noul' ? label.classifier.name : label.text;
        return button(label.key, text, label.classifier.color, count, label.classifier.type === 'noul' ? label.classifier.name : `${label.classifier.name}: ${label.text}`);
      })
    );
  }

  return { matchesFor, spamScore, isPending, chip, rowChips, filtered, renderFilterBar, SPAM_ID };
})();
