const nodemailer = require('nodemailer');

// Outgoing servers for the providers imapClient.js knows. 465 = TLS from the start,
// 587 = STARTTLS. Others default to smtp.<domain>:465 and can be set in Settings.
const HOSTS = {
  'gmail.com': ['smtp.gmail.com', 465],
  'googlemail.com': ['smtp.gmail.com', 465],
  'outlook.com': ['smtp.office365.com', 587],
  'hotmail.com': ['smtp.office365.com', 587],
  'live.com': ['smtp.office365.com', 587],
  'office365.com': ['smtp.office365.com', 587],
  'yahoo.com': ['smtp.mail.yahoo.com', 465],
  'icloud.com': ['smtp.mail.me.com', 587],
  'me.com': ['smtp.mail.me.com', 587],
  'zoho.com': ['smtp.zoho.com', 465]
};

const domainOf = (email) => (String(email).split('@')[1] || '').toLowerCase();

function resolveSmtp(cfg) {
  const known = HOSTS[domainOf(cfg.email)];
  const host = cfg.smtpHost || (known ? known[0] : `smtp.${domainOf(cfg.email)}`);
  const port = cfg.smtpPort || (known && !cfg.smtpHost ? known[1] : 465);
  return { host, port };
}

// Gmail and Outlook file mail sent over SMTP in "Sent" themselves; for other
// providers the app saves a copy there over IMAP.
function serverSavesSent(cfg) {
  const { host } = resolveSmtp(cfg);
  return /(^|\.)gmail\.com$|(^|\.)office365\.com$|(^|\.)outlook\.com$/i.test(host);
}

function createTransport(cfg) {
  const { host, port } = resolveSmtp(cfg);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465, // never send the password over a plain connection
    auth: { user: cfg.email, pass: cfg.password },
    connectionTimeout: 20 * 1000,
    greetingTimeout: 15 * 1000,
    socketTimeout: 60 * 1000
  });
}

async function testSmtp(cfg) {
  const transport = createTransport(cfg);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

module.exports = { resolveSmtp, createTransport, testSmtp, serverSavesSent };
