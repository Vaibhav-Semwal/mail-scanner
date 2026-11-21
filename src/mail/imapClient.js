const { ImapFlow } = require('imapflow');

const HOSTS = {
  'gmail.com': 'imap.gmail.com',
  'googlemail.com': 'imap.gmail.com',
  'outlook.com': 'outlook.office365.com',
  'hotmail.com': 'outlook.office365.com',
  'live.com': 'outlook.office365.com',
  'office365.com': 'outlook.office365.com',
  'yahoo.com': 'imap.mail.yahoo.com',
  'icloud.com': 'imap.mail.me.com',
  'me.com': 'imap.mail.me.com',
  'zoho.com': 'imap.zoho.com'
};

function resolveHost(cfg) {
  if (cfg.host) return cfg.host;
  const domain = (cfg.email.split('@')[1] || '').toLowerCase();
  return HOSTS[domain] || `imap.${domain}`;
}

function createClient(cfg) {
  return new ImapFlow({
    host: resolveHost(cfg),
    port: cfg.port || 993,
    secure: true,
    auth: { user: cfg.email, pass: cfg.password },
    maxIdleTime: 4 * 60 * 1000, // refresh the IDLE push channel before servers drop it
    logger: false
  });
}

async function testConnection(cfg) {
  const client = createClient(cfg);
  client.on('error', () => {}); // reported through the rejected promise instead
  await client.connect();
  await client.logout();
}

module.exports = { createClient, testConnection, resolveHost };