const { simpleParser } = require('mailparser');
let MailComposer = require('nodemailer/lib/mail-composer');
MailComposer = MailComposer.default || MailComposer;
const config = require('../config');
const log = require('../logger');
const outbox = require('./outbox');
const { createTransport, serverSavesSent } = require('./smtp');

const MODES = ['new', 'reply', 'replyAll', 'forward'];
const MAX_RECIPIENTS = 100;
const MAX_TEXT = 200 * 1024;
const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const textToHtml = (text) => escapeHtml(text).replace(/\r?\n/g, '<br>');

const fail = (error) => ({ ok: false, error });

function cleanList(list) {
  return [].concat(list || []).map((a) => String(a).trim()).filter(Boolean);
}

function addressList(field) {
  const list = field ? (Array.isArray(field) ? field.flatMap((f) => f.value) : field.value) : [];
  return (list || []).filter((a) => a.address);
}
const formatAddresses = (field) =>
  addressList(field).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');

// The quoted original under a reply, or the header block of a forward.
function quoteFor(mode, parsed) {
  const date = parsed.date ? parsed.date.toLocaleString() : '';
  const from = formatAddresses(parsed.from) || 'Unknown sender';
  const originalHtml = parsed.html || `<div>${textToHtml(parsed.text || '')}</div>`;
  const originalText = parsed.text || '';

  if (mode === 'forward') {
    const lines = [
      '---------- Forwarded message ---------',
      `From: ${from}`,
      `Date: ${date}`,
      `Subject: ${parsed.subject || ''}`,
      `To: ${formatAddresses(parsed.to)}`
    ];
    const cc = formatAddresses(parsed.cc);
    if (cc) lines.push(`Cc: ${cc}`);
    return {
      text: `\n\n${lines.join('\n')}\n\n${originalText}`,
      html: `<br><br><div>${lines.map(escapeHtml).join('<br>')}</div><br>${originalHtml}`
    };
  }
  const intro = `On ${date}, ${from} wrote:`;
  return {
    text: `\n\n${intro}\n${originalText.split(/\r?\n/).map((l) => `> ${l}`).join('\n')}`,
    html: `<br><br><div>${escapeHtml(intro)}</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${originalHtml}</blockquote>`
  };
}

function validate(draft) {
  if (!draft || typeof draft !== 'object') return 'Nothing to send.';
  if (!MODES.includes(draft.mode)) return 'Unknown kind of message.';
  if (draft.mode !== 'new' && !Number.isInteger(draft.uid)) return 'The original email is missing.';
  const all = [...draft.to, ...draft.cc, ...draft.bcc];
  if (!all.length) return 'Add at least one recipient.';
  if (all.length > MAX_RECIPIENTS) return `You can send to at most ${MAX_RECIPIENTS} people at once.`;
  const bad = all.find((a) => !ADDRESS.test(a));
  if (bad) return `"${bad}" is not an email address.`;
  if (draft.text.length > MAX_TEXT) return 'The message is too long.';
  if (outbox.sizeOf(draft.attachmentIds) > outbox.MAX_FILE) return 'The attachments add up to more than 25 MB, which most mail servers refuse.';
  return null;
}

/**
 * Sends a reply, reply-all, forward or new email over SMTP.
 * draft: { mode, uid, to[], cc[], bcc[], subject, text, attachmentIds[], includeOriginal }
 * Replies thread with the original (In-Reply-To / References) and quote it; forwards
 * carry the original body and, with includeOriginal, its attachments.
 */
async function sendMail({ watcher, draft: input }) {
  const draft = {
    mode: input && input.mode,
    uid: input && input.uid,
    to: cleanList(input && input.to),
    cc: cleanList(input && input.cc),
    bcc: cleanList(input && input.bcc),
    subject: String((input && input.subject) || '').slice(0, 998),
    text: String((input && input.text) || ''),
    attachmentIds: cleanList(input && input.attachmentIds),
    includeOriginal: Boolean(input && input.includeOriginal)
  };
  const problem = validate(draft);
  if (problem) return fail(problem);

  const cfg = config.load();
  if (!cfg.email || !cfg.password) return fail('Add your account in Settings first.');

  let transport = null;
  try {
    const message = {
      from: cfg.email,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      text: draft.text,
      html: `<div>${textToHtml(draft.text)}</div>`,
      attachments: outbox.attachmentsFor(draft.attachmentIds)
    };

    if (draft.mode !== 'new') {
      const source = await watcher.fetchMessage(draft.uid);
      // keepCidLinks: inline images stay cid: links and travel as related parts below.
      const parsed = await simpleParser(source, { keepCidLinks: true });
      const quote = quoteFor(draft.mode, parsed);
      message.text += quote.text;
      message.html += quote.html;
      const original = parsed.attachments || [];
      const carried = original.filter((a) => (a.related && a.cid) || (draft.mode === 'forward' && draft.includeOriginal && !a.related));
      message.attachments.push(
        ...carried.map((a) => ({
          filename: a.filename || 'attachment',
          content: a.content,
          contentType: a.contentType,
          cid: a.related ? a.cid : undefined,
          contentDisposition: a.related ? 'inline' : 'attachment'
        }))
      );
      if (draft.mode !== 'forward' && parsed.messageId) {
        message.inReplyTo = parsed.messageId;
        message.references = [...[].concat(parsed.references || []), parsed.messageId];
      }
    }

    const raw = await new MailComposer(message).compile().build(); // Bcc is left out of the headers
    transport = createTransport(cfg);
    await transport.sendMail({ raw, envelope: { from: cfg.email, to: [...draft.to, ...draft.cc, ...draft.bcc] } });

    // Best effort from here on: the email has already gone.
    if (!serverSavesSent(cfg)) {
      await watcher.saveToSent(raw).catch((err) => log.error('Could not save a copy in Sent', err));
    }
    if (draft.mode === 'reply' || draft.mode === 'replyAll') {
      await watcher.addFlag(draft.uid, '\\Answered').catch(() => {});
    }
    outbox.discard(draft.attachmentIds);
    return { ok: true };
  } catch (err) {
    log.error('Could not send an email', err);
    if (err.userFacing) return fail(err.message);
    if (err.code === 'EAUTH') return fail('Your mail server refused the sign-in for sending. Check your app password, or the outgoing (SMTP) server in Settings.');
    if (err.responseCode && err.response) return fail(`The mail server refused it: ${err.response}`);
    return fail('Could not send it. Check your connection and the outgoing (SMTP) server in Settings.');
  } finally {
    if (transport) transport.close();
  }
}

module.exports = { sendMail };
