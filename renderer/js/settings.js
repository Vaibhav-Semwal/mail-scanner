'use strict';

// The settings page: account, alerts and background options.
App.settings = (() => {
  const { $, withBusy } = App.dom;
  const DEFAULT_PORT = 993;
  const DEFAULT_INTERVAL_MIN = 10;
  const DEFAULT_MAX_EMAILS = 20;
  const MAX_EMAILS = 200;
  const PASSWORD_SAVED_HINT = 'Saved. Leave blank to keep it.';
  let el = null;

  function read() {
    return {
      email: el.email.value.trim(),
      password: el.password.value,
      host: el.host.value.trim(),
      port: Number(el.port.value) || DEFAULT_PORT,
      smtpHost: el.smtpHost.value.trim(),
      smtpPort: Number(el.smtpPort.value) || 0,
      intervalMin: Math.max(1, Number(el.interval.value) || DEFAULT_INTERVAL_MIN),
      maxEmails: Math.min(MAX_EMAILS, Math.max(1, Math.round(Number(el.maxEmails.value)) || DEFAULT_MAX_EMAILS)),
      keywords: el.keywords.value.trim(),
      notify: el.notify.checked,
      launchAtLogin: el.launch.checked
    };
  }

  function fill(config) {
    el.email.value = config.email;
    el.password.value = '';
    el.password.placeholder = config.hasPassword ? PASSWORD_SAVED_HINT : 'App password';
    el.host.value = config.host;
    el.port.value = config.port;
    el.smtpHost.value = config.smtpHost || '';
    el.smtpPort.value = config.smtpPort || '';
    el.interval.value = config.intervalMin;
    el.maxEmails.value = config.maxEmails;
    el.keywords.value = config.keywords;
    el.notify.checked = config.notify;
    el.launch.checked = config.launchAtLogin;
    el.banner.hidden = Boolean(config.email && config.hasPassword);
    // Custom server settings stay visible; otherwise they're tucked away.
    el.advanced.open = Boolean(config.host || config.smtpHost || config.smtpPort);
  }

  async function save() {
    const form = read();
    if (!form.email) return App.toast.show('Enter your email address.', 'error');
    App.toast.show('Saving…');
    const result = await withBusy(el.save, () => api.saveConfig(form));
    if (!result || !result.ok) return App.toast.show('Could not save your settings.', 'error');
    const config = await api.getConfig();
    App.store.setConfig(config); // refills the form via the store listener
    App.toast.show('Settings saved', 'ok');
    App.app.showView('inbox');
  }

  async function test() {
    const form = read();
    if (!form.email) return App.toast.show('Enter your email address.', 'error');
    App.toast.show('Connecting…');
    const result = await withBusy(el.test, () => api.testConnection(form));
    if (result.ok) App.toast.show('Connected. Receiving and sending both work.', 'ok');
    else App.toast.show(`Could not connect: ${result.error}`, 'error');
  }

  function init() {
    el = {
      email: $('email'),
      password: $('password'),
      host: $('host'),
      port: $('port'),
      smtpHost: $('smtpHost'),
      smtpPort: $('smtpPort'),
      interval: $('interval'),
      maxEmails: $('maxEmails'),
      keywords: $('keywords'),
      notify: $('notify'),
      launch: $('launch'),
      save: $('save'),
      test: $('test'),
      banner: $('setupBanner'),
      advanced: document.querySelector('#settingsPane .advanced')
    };
    el.save.addEventListener('click', save);
    el.test.addEventListener('click', test);
    $('settingsBack').addEventListener('click', () => App.app.showView('inbox'));
    App.store.on((store, changed) => {
      if (changed === 'config' && store.config) fill(store.config);
    });
  }

  return { init };
})();
