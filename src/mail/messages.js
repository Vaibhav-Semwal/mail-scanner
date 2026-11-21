const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function senderOf(list) {
  const first = (list || [])[0];
  return first ? first.name || first.address || 'Unknown sender' : 'Unknown sender';
}

// Turns an IMAP message into the small object the rest of the app uses.
function toItem(msg) {
  const envelope = msg.envelope || {};
  return {
    uid: msg.uid,
    messageId: envelope.messageId || '',
    threadId: msg.threadId ? String(msg.threadId) : '', // Gmail: X-GM-THRID (decimal)
    emailId: msg.emailId ? String(msg.emailId) : '',    // Gmail: X-GM-MSGID (decimal)
    from: clip(senderOf(envelope.from), 80),
    fromAddress: String(((envelope.from || [])[0] || {}).address || '').toLowerCase(),
    subject: clip(envelope.subject || '(no subject)', 140),
    date: +new Date(msg.internalDate || Date.now()),
    seen: msg.flags ? msg.flags.has('\\Seen') : false,
    starred: msg.flags ? msg.flags.has('\\Flagged') : false // Gmail's star
  };
}

// An empty keyword list matches everything.
function matchesKeywords(item, keywords) {
  const words = String(keywords || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (!words.length) return true;
  const haystack = `${item.from} ${item.subject}`.toLowerCase();
  return words.some((w) => haystack.includes(w));
}

module.exports = { toItem, matchesKeywords };