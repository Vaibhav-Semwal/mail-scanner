'use strict';

// Controls for App.appearance: the day/night button in the top bar and the
// Appearance card in Settings. Everything applies instantly and is remembered.
App.appearanceUi = (() => {
  const { $, h } = App.dom;
  let el = null;

  const THEME_LABELS = { system: ['System', 'settings'], light: ['Light', 'sun'], dark: ['Dark', 'moon'] };
  const TONE_LABELS = { slate: 'Slate', neutral: 'Neutral', warm: 'Warm' };

  function segmented(container, values, current, labelFor, onPick) {
    container.replaceChildren(
      ...values.map((value) => {
        const [text, icon] = labelFor(value);
        return h('button', {
          type: 'button',
          role: 'radio',
          class: value === current ? 'seg is-picked' : 'seg',
          'aria-checked': value === current ? 'true' : 'false',
          onClick: () => onPick(value)
        }, [icon ? App.icons.svg(icon) : null, h('span', { text })]);
      })
    );
  }

  function renderSwatches(current) {
    const { ACCENTS } = App.appearance;
    const isPreset = ACCENTS.some((a) => a.color === current);
    const swatches = ACCENTS.map((a) => {
      const node = h('button', {
        type: 'button',
        role: 'radio',
        class: a.color === current ? 'swatch is-picked' : 'swatch',
        'aria-checked': a.color === current ? 'true' : 'false',
        'aria-label': a.name,
        title: a.name,
        onClick: () => App.appearance.set({ accent: a.color })
      });
      node.style.setProperty('--label', a.color);
      return node;
    });

    // Any colour: the native colour picker, shown as one more swatch.
    const picker = h('input', { type: 'color', 'aria-label': 'Custom accent colour' });
    picker.value = current;
    picker.addEventListener('input', () => App.appearance.set({ accent: picker.value }));
    const custom = h('label', {
      class: isPreset ? 'swatch swatch-custom' : 'swatch swatch-custom is-picked',
      title: 'Pick any colour'
    }, [picker, h('span', { class: 'swatch-plus', 'aria-hidden': 'true', text: '+' })]);
    if (!isPreset) custom.style.setProperty('--label', current);

    el.accents.replaceChildren(...swatches, custom);
  }

  // Called by App.appearance whenever the look changes.
  function render() {
    if (!el) return;
    const { prefs, effectiveMode, THEMES, TONES } = App.appearance;
    const dark = effectiveMode() === 'dark';

    el.toggle.replaceChildren(App.icons.svg(dark ? 'sun' : 'moon'));
    el.toggle.title = dark ? 'Switch to day theme' : 'Switch to night theme';
    el.toggle.setAttribute('aria-label', el.toggle.title);

    segmented(el.themes, THEMES, prefs.theme, (v) => THEME_LABELS[v], (v) => App.appearance.set({ theme: v }));
    segmented(el.tones, TONES, prefs.tone, (v) => [TONE_LABELS[v]], (v) => App.appearance.set({ tone: v }));
    renderSwatches(prefs.accent);
  }

  function init() {
    el = {
      toggle: $('themeBtn'),
      themes: $('themePicker'),
      tones: $('tonePicker'),
      accents: $('accentSwatches'),
      reset: $('appearanceReset')
    };
    el.toggle.addEventListener('click', App.appearance.toggle);
    el.reset.addEventListener('click', () => {
      App.appearance.reset();
      App.toast.show('Default look restored', 'ok');
    });
    render();
    api.setTheme(App.appearance.prefs.theme); // window frame matches from the start
  }

  return { init, render };
})();
