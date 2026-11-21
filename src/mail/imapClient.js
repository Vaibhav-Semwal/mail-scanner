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

// Network failures from imapflow often have a code but an empty message, which
// used to surface as "unknown error" (or nothing). Say what went wrong instead.
const NETWORK_ERRORS = {
  ETIMEDOUT: 'timed out',
  CONNECT_TIMEOUT: 'timed out',
  GREETING_TIMEOUT: 'timed out',
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection was reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'no network',
  ENOTFOUND: 'server name not found',
  EAI_AGAIN: 'no network (name lookup failed)'
};

function describeError(err, cfg) {
  if (!err) return 'unknown error';
  const network = NETWORK_ERRORS[err.code];
  if (network && cfg) {
    const port = cfg.port || 993;
    const hint = port === 993 ? 'Check your internet connection.' : 'Check the port in Settings (most mail servers use 993).';
    return `Could not reach ${resolveHost(cfg)}:${port} (${network}). ${hint}`;
  }
  return err.responseText || err.message || network || err.code || 'unknown error';
}

async function testConnection(cfg) {
  const client = createClient(cfg);
  client.on('error', () => {}); // reported through the rejected promise instead
  await client.connect();
  await client.logout();
}

module.exports = { createClient, testConnection, resolveHost, describeError };