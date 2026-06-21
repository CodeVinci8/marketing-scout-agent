'use strict';
// telegram_io.js — Stage 4 Telegram gateway + delivery outbox helpers (B2 + B8).
//
// Inbound: parse a Telegram update into a normalized intake record, decide authorization, build a
// duplicate-proof idempotency key (a re-delivered update_id must create exactly ONE request).
// Outbound: an outbox record keyed by a payload hash so retries never double-send the user-visible
// answer; plus safe Markdown escaping and message chunking for Telegram's 4096-char limit.

function str(v) { return v == null ? '' : String(v).trim(); }

// --- inbound -------------------------------------------------------------------------------------------
// Parse a raw Telegram update (message / callback_query) into the fields the gateway persists.
function parseUpdate(update) {
  update = update || {};
  const msg = update.message || update.edited_message || null;
  const cb = update.callback_query || null;
  let kind = 'unknown', text = '', chatId = '', userId = '', messageId = '', callbackData = '';
  if (cb) {
    kind = 'callback';
    callbackData = str(cb.data);
    userId = str(cb.from && cb.from.id);
    chatId = str(cb.message && cb.message.chat && cb.message.chat.id);
    messageId = str(cb.message && cb.message.message_id);
  } else if (msg) {
    text = str(msg.text);
    userId = str(msg.from && msg.from.id);
    chatId = str(msg.chat && msg.chat.id);
    messageId = str(msg.message_id);
    if (/^\/status\b/.test(text)) kind = 'status';
    else if (/^\/cancel\b/.test(text)) kind = 'cancel';
    else if (/^\//.test(text)) kind = 'command';
    else kind = 'request';
  }
  return {
    kind: kind,
    update_id: str(update.update_id),
    chat_id: chatId,
    user_id: userId,
    message_id: messageId,
    text: text,
    callback_data: callbackData
  };
}

function isAuthorized(parsed, allowedUserIds) {
  const ids = (allowedUserIds || []).map(String);
  return ids.indexOf(str(parsed && parsed.user_id)) >= 0;
}

// One Telegram update => one idempotency key. A redelivered update_id maps to the same key.
function updateIdempotencyKey(parsed) {
  parsed = parsed || {};
  return ['tg', str(parsed.update_id) || ('m' + str(parsed.message_id)), str(parsed.chat_id)].join('::');
}

// Callback payloads: approve:<agent_request_id> / reject:<agent_request_id>.
function parseCallback(data) {
  const m = str(data).match(/^(approve|reject|cancel):(.+)$/);
  if (!m) return { action: '', agent_request_id: '' };
  return { action: m[1], agent_request_id: str(m[2]) };
}
function approvalKeyboard(agentRequestId) {
  return { inline_keyboard: [[
    { text: '✅ Запустить', callback_data: 'approve:' + str(agentRequestId) },
    { text: '✖ Отклонить', callback_data: 'reject:' + str(agentRequestId) }
  ]] };
}

// --- outbound ------------------------------------------------------------------------------------------
// Telegram MarkdownV2 reserved chars. Escaping keeps user/report text from breaking the message.
function escapeMarkdown(text) {
  return str(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Split into <=limit chunks on line boundaries where possible (Telegram hard-caps at 4096).
function chunkMessage(text, limit) {
  limit = limit || 3900;
  const s = String(text == null ? '' : text);
  if (s.length <= limit) return [s];
  const out = [];
  let buf = '';
  for (const line of s.split('\n')) {
    if ((buf + '\n' + line).length > limit) {
      if (buf) out.push(buf);
      if (line.length > limit) { for (let i = 0; i < line.length; i += limit) out.push(line.slice(i, i + limit)); buf = ''; }
      else buf = line;
    } else { buf = buf ? (buf + '\n' + line) : line; }
  }
  if (buf) out.push(buf);
  return out;
}

// djb2 — small, stable, dependency-free hash for the outbox dedupe key.
function payloadHash(s) {
  s = String(s == null ? '' : s);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}

// Build an outbox row. delivery_id is deterministic in (agent_request_id, report_id, payload) so the
// same answer can never be enqueued/sent twice for the same request+report.
function makeDelivery(agentRequestId, reportId, chatId, payload) {
  const hash = payloadHash(payload);
  return {
    delivery_id: ['dlv', str(agentRequestId) || 'req', str(reportId) || 'rep', hash].join('_'),
    agent_request_id: str(agentRequestId),
    report_id: str(reportId),
    chat_id: str(chatId),
    payload_hash: hash,
    chunks: chunkMessage(payload).length,
    send_status: 'pending',
    attempts: 0,
    telegram_message_id: '',
    last_error: ''
  };
}

// Idempotent enqueue: if an existing delivery has the same delivery_id and is already sent, skip.
function shouldSend(existingDeliveries, delivery) {
  const prior = (existingDeliveries || []).filter(d => str(d.delivery_id) === str(delivery.delivery_id));
  if (prior.some(d => str(d.send_status) === 'sent')) return { send: false, reason: 'already_sent' };
  return { send: true, reason: '' };
}

module.exports = {
  parseUpdate, isAuthorized, updateIdempotencyKey, parseCallback, approvalKeyboard,
  escapeMarkdown, chunkMessage, payloadHash, makeDelivery, shouldSend
};
