'use strict';

// Settings for smart labels: Laya's status, model setup and the list of
// classifiers (ready-made presets plus the user's own). Each classifier is one
// of Laya's question types: Yes / No, Pick one, or Scale. Every change is saved
// straight away through api.saveAi.
App.smartLabels = (() => {
  const { $, h, withBusy } = App.dom;
  const SPAM_ID = 'spam';
  let el = null;
  let editingId = null;   // custom classifier being edited, or null when adding
  let pickedColor = null;
  let pickedType = 'noul';

  const cfg = () => App.store.aiConfig;

  async function save(partial, button) {
    const next = { ...cfg(), ...partial };
    for (const key of ['presets', 'types', 'colors', 'maxClassifiers', 'maxOptions', 'maxLevels']) delete next[key];
    const task = () => api.saveAi(next);
    const result = button ? await withBusy(button, task) : await task();
    if (result && result.ok) App.store.setAiConfig(result.config);
    else App.toast.show('Could not save smart-label settings.', 'error');
    return result;
  }

  /* ---------------- status ---------------- */

  function renderStatus(ai) {
    if (!ai) return;
    const pending = ai.pending ? ai.pending.length : 0;
    const pct = ai.progress != null ? ` ${Math.round(ai.progress * 100)}%` : '';
    const views = {
      disabled: ['idle', 'Smart labels are off.'],
      starting: ['idle', 'Starting Laya…'],
      'no-ollama': ['error', ai.message],
      'needs-model': ['warn', ai.message || `${ai.model} isn't downloaded yet.`],
      downloading: ['idle', `Downloading ${ai.model}…${pct}`],
      ready: ['ok', pending ? `Ready (${ai.model}). Labelling ${pending} email${pending === 1 ? '' : 's'}…` : `Ready (${ai.model}). All unread mail is labelled.`],
      error: ['error', ai.message || 'Something went wrong.']
    };
    const [tone, text] = views[ai.status] || ['idle', ai.message];
    el.status.dataset.tone = tone;
    el.statusText.textContent = text;

    el.progress.hidden = ai.status !== 'downloading';
    el.progressBar.style.width = `${Math.round((ai.progress || 0) * 100)}%`;
    el.download.hidden = ai.status !== 'needs-model';
    el.download.textContent = `Download ${ai.model}`;
    el.retry.hidden = !['no-ollama', 'error'].includes(ai.status);
    el.reclassify.hidden = ai.status !== 'ready';
  }

  /* ---------------- classifier list ---------------- */

  // "Work · Personal · Shopping …" or "No action needed → … → Urgent".
  function answersSummary(c) {
    if (c.type === 'choice') return c.options.map((o) => o.name).join(' · ');
    if (c.type === 'score') return c.levels.join(' → ');
    return '';
  }

  function classifierRow(c) {
    const types = cfg().types;
    const toggle = h('input', { type: 'checkbox', 'aria-label': `Use ${c.name}` });
    toggle.checked = c.enabled;
    toggle.addEventListener('change', () =>
      save({ classifiers: cfg().classifiers.map((x) => (x.id === c.id ? { ...x, enabled: toggle.checked } : x)) })
    );

    const dot = h('span', { class: 'cls-dot', 'aria-hidden': 'true' });
    dot.style.setProperty('--label', c.color);

    const tags = [h('span', { class: 'cls-tag cls-type', text: types[c.type].label })];
    if (c.id === SPAM_ID) tags.push(h('span', { class: 'cls-tag', text: 'Default' }));
    else if (c.preset) tags.push(h('span', { class: 'cls-tag', text: 'Ready-made' }));

    const buttons = [];
    if (c.id !== SPAM_ID) {
      if (!c.preset) buttons.push(h('button', { type: 'button', class: 'link-btn', text: 'Edit', onClick: () => startEdit(c) }));
      buttons.push(h('button', {
        type: 'button',
        class: 'link-btn is-danger',
        text: 'Remove',
        onClick: () => {
          if (editingId === c.id) resetForm();
          save({ classifiers: cfg().classifiers.filter((x) => x.id !== c.id) });
        }
      }));
    }

    const summary = answersSummary(c);
    return h('li', { class: c.enabled ? 'cls-item' : 'cls-item is-off' }, [
      dot,
      h('div', { class: 'cls-text' }, [
        h('div', { class: 'cls-name' }, [h('strong', { text: c.name }), ...tags]),
        h('div', { class: 'cls-rule muted small', text: c.question }),
        summary ? h('div', { class: 'cls-answers small', text: summary }) : null
      ]),
      h('div', { class: 'cls-controls' }, [
        ...buttons,
        h('label', { class: 'switch', title: c.enabled ? 'On' : 'Off' }, [toggle, h('span', { text: '' })])
      ])
    ]);
  }

  function renderPresets() {
    const config = cfg();
    const used = new Set(config.classifiers.map((c) => c.preset).filter(Boolean));
    const full = config.classifiers.length >= config.maxClassifiers;
    const available = config.presets.filter((p) => !used.has(p.id));
    el.presets.replaceChildren(
      ...available.map((p) => {
        const summary = answersSummary(p);
        const node = h('button', {
          type: 'button',
          class: 'preset-chip',
          title: `${config.types[p.type].label}: ${p.question}${summary ? `\n${summary}` : ''}`,
          disabled: full,
          onClick: () => save({ classifiers: [...config.classifiers, { id: p.id, preset: p.id, enabled: true }] })
        }, [
          h('span', { class: 'preset-plus', text: '+' }),
          h('span', { text: p.name }),
          p.type !== 'noul' ? h('span', { class: 'preset-type', text: config.types[p.type].label }) : null
        ]);
        node.style.setProperty('--label', p.color);
        return node;
      })
    );
    if (!available.length) el.presets.append(h('p', { class: 'muted small', text: 'All ready-made classifiers are added.' }));
  }

  /* ---------------- custom classifier form ---------------- */

  function renderTypePicker() {
    const types = cfg().types;
    el.types.replaceChildren(
      ...Object.entries(types).map(([key, t]) =>
        h('button', {
          type: 'button',
          role: 'radio',
          class: key === pickedType ? 'seg is-picked' : 'seg',
          'aria-checked': key === pickedType ? 'true' : 'false',
          text: t.label,
          onClick: () => {
            pickedType = key;
            renderTypePicker();
          }
        })
      )
    );
    el.typeHint.textContent = types[pickedType].hint;
    el.optionsField.hidden = pickedType !== 'choice';
    el.levelsField.hidden = pickedType !== 'score';
  }

  function renderSwatches() {
    const colors = cfg().colors;
    if (!pickedColor || !colors.includes(pickedColor)) pickedColor = colors[0];
    el.colors.replaceChildren(
      ...colors.map((color) => {
        const node = h('button', {
          type: 'button',
          class: color === pickedColor ? 'swatch is-picked' : 'swatch',
          role: 'radio',
          'aria-checked': color === pickedColor ? 'true' : 'false',
          'aria-label': color,
          onClick: () => {
            pickedColor = color;
            renderSwatches();
          }
        });
        node.style.setProperty('--label', color);
        return node;
      })
    );
  }

  const lines = (text) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // "Name: optional hint" per line.
  function parseOptions(text) {
    return lines(text).map((line) => {
      const i = line.indexOf(':');
      return i > 0 ? { name: line.slice(0, i).trim(), desc: line.slice(i + 1).trim() || null } : { name: line, desc: null };
    });
  }

  const formatOptions = (options) => options.map((o) => (o.desc ? `${o.name}: ${o.desc}` : o.name)).join('\n');

  function startEdit(c) {
    editingId = c.id;
    pickedType = c.type;
    pickedColor = c.color;
    el.name.value = c.name;
    el.question.value = c.question;
    el.options.value = c.type === 'choice' ? formatOptions(c.options) : '';
    el.levels.value = c.type === 'score' ? c.levels.join('\n') : '';
    el.formTitle.textContent = `Edit "${c.name}"`;
    el.save.textContent = 'Save changes';
    el.cancel.hidden = false;
    renderTypePicker();
    renderSwatches();
    el.name.scrollIntoView({ block: 'center' });
    el.name.focus();
  }

  function resetForm() {
    editingId = null;
    pickedType = 'noul';
    el.name.value = '';
    el.question.value = '';
    el.options.value = '';
    el.levels.value = '';
    el.formTitle.textContent = 'Create your own';
    el.save.textContent = 'Add classifier';
    el.cancel.hidden = true;
    renderTypePicker();
  }

  async function saveCustom() {
    const config = cfg();
    const name = el.name.value.trim();
    const question = el.question.value.trim();
    if (!name) return App.toast.show('Give the classifier a name.', 'error');
    if (question.length < 8) return App.toast.show('Write the question Laya should answer.', 'error');

    const classifier = { preset: null, type: pickedType, name, question, color: pickedColor, enabled: true };
    if (pickedType === 'choice') {
      classifier.options = parseOptions(el.options.value);
      const names = new Set(classifier.options.map((o) => o.name.toLowerCase()));
      if (classifier.options.length < 2) return App.toast.show('Add at least two options, one per line.', 'error');
      if (classifier.options.length > config.maxOptions) return App.toast.show(`Use at most ${config.maxOptions} options.`, 'error');
      if (names.size !== classifier.options.length) return App.toast.show('Each option needs a different name.', 'error');
    }
    if (pickedType === 'score') {
      classifier.levels = lines(el.levels.value);
      if (classifier.levels.length < 2) return App.toast.show('Add at least two levels, lowest first.', 'error');
      if (classifier.levels.length > config.maxLevels) return App.toast.show(`Use at most ${config.maxLevels} levels.`, 'error');
    }

    const list = config.classifiers;
    const clash = list.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== editingId);
    if (clash) return App.toast.show(`You already have a classifier called "${clash.name}".`, 'error');

    const classifiers = editingId
      ? list.map((c) => (c.id === editingId ? { ...classifier, id: c.id, enabled: c.enabled } : c))
      : [...list, { ...classifier, id: await api.newClassifierId() }];

    const wasEditing = Boolean(editingId);
    const result = await save({ classifiers }, el.save);
    if (result && result.ok) {
      App.toast.show(wasEditing ? 'Classifier updated' : `Added "${name}"`, 'ok');
      resetForm();
      render();
    }
  }

  function render() {
    const config = cfg();
    if (!config) return;
    el.enabled.checked = config.enabled;
    el.model.value = config.model;
    el.modelsDir.value = config.modelsDir;
    el.ollamaPath.value = config.ollamaPath;
    el.list.replaceChildren(...config.classifiers.map(classifierRow));
    el.count.textContent = `${config.classifiers.filter((c) => c.enabled).length} on`;
    renderPresets();
    renderTypePicker();
    renderSwatches();
    el.save.disabled = !editingId && config.classifiers.length >= config.maxClassifiers;
  }

  function init() {
    el = {
      enabled: $('aiEnabled'),
      status: $('aiStatus'),
      statusText: $('aiStatusText'),
      progress: $('aiProgress'),
      progressBar: $('aiProgressBar'),
      download: $('aiDownload'),
      retry: $('aiRetry'),
      reclassify: $('aiReclassify'),
      model: $('aiModel'),
      modelsDir: $('aiModelsDir'),
      ollamaPath: $('aiOllamaPath'),
      applyModel: $('aiApplyModel'),
      list: $('clsList'),
      count: $('clsCount'),
      presets: $('presetGrid'),
      formTitle: $('clsFormTitle'),
      name: $('clsName'),
      types: $('clsTypes'),
      typeHint: $('clsTypeHint'),
      question: $('clsQuestion'),
      optionsField: $('clsOptionsField'),
      options: $('clsOptions'),
      levelsField: $('clsLevelsField'),
      levels: $('clsLevels'),
      colors: $('clsColors'),
      save: $('clsSave'),
      cancel: $('clsCancel')
    };

    el.enabled.addEventListener('change', () => save({ enabled: el.enabled.checked }));
    el.download.addEventListener('click', async () => {
      const result = await withBusy(el.download, () => api.downloadModel());
      if (result && result.ok) App.toast.show('Laya is ready. Labelling your mail now.', 'ok');
      else if (result) App.toast.show(result.error || 'Download failed.', 'error');
    });
    el.retry.addEventListener('click', () => withBusy(el.retry, () => api.retryAi()));
    el.reclassify.addEventListener('click', async () => {
      await withBusy(el.reclassify, () => api.reclassify());
      App.toast.show('Labelling your unread mail again', 'ok');
    });
    el.applyModel.addEventListener('click', async () => {
      const result = await save({
        model: el.model.value.trim(),
        modelsDir: el.modelsDir.value.trim(),
        ollamaPath: el.ollamaPath.value.trim()
      }, el.applyModel);
      if (result && result.ok) App.toast.show('Model settings applied', 'ok');
    });
    el.save.addEventListener('click', saveCustom);
    el.cancel.addEventListener('click', () => { resetForm(); render(); });

    App.store.on((store, changed) => {
      if (changed === 'ai-config') render();
      if (changed === 'mail') renderStatus(store.mail.ai);
    });
  }

  return { init };
})();
