'use strict';
// telegram_io.js — Stage 4 Telegram gateway + delivery outbox helpers (B2 + B8).
//
// Inbound: parse a Telegram update into a normalized intake record, decide authorization, build a
// duplicate-proof idempotency key (a re-delivered update_id must create exactly ONE request).
// Outbound: an outbox record keyed by a payload hash so retries never double-send the user-visible
// answer; plus safe Markdown escaping and message chunking for Telegram's 4096-char limit.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }

// --- inbound -------------------------------------------------------------------------------------------
// Classify the raw Telegram update envelope. Only 'message' and 'callback_query' carry actionable business;
// everything else (edited_message, channel_post, service messages, bot-originated) must NOT create a request.
function updateType(update) {
  update = update || {};
  if (update.callback_query) return 'callback_query';
  if (update.edited_message) return 'edited_message';
  if (update.channel_post || update.edited_channel_post) return 'channel_post';
  if (update.my_chat_member || update.chat_member || update.chat_join_request) return 'service';
  if (update.message) {
    const m = update.message;
    // attachments / service content with no text are unsupported (we never create a request from them)
    if (!str(m.text) && (m.new_chat_members || m.left_chat_member || m.pinned_message || m.photo || m.document || m.sticker || m.voice || m.video)) return 'unsupported_message';
    return 'message';
  }
  return 'empty';
}
const SUPPORTED_UPDATE_TYPES = ['message', 'callback_query'];
function isSupportedUpdate(update) { return SUPPORTED_UPDATE_TYPES.indexOf(updateType(update)) >= 0; }

// Parse a raw Telegram update (message / callback_query) into the fields the gateway persists.
function parseUpdate(update) {
  update = update || {};
  const msg = update.message || update.edited_message || null;
  const cb = update.callback_query || null;
  let kind = 'unknown', text = '', chatId = '', userId = '', messageId = '', callbackData = '',
    chatType = '', callbackQueryId = '', fromIsBot = false;
  if (cb) {
    kind = 'callback';
    callbackData = str(cb.data);
    userId = str(cb.from && cb.from.id);
    chatId = str(cb.message && cb.message.chat && cb.message.chat.id);
    messageId = str(cb.message && cb.message.message_id);
    chatType = str(cb.message && cb.message.chat && cb.message.chat.type);
    callbackQueryId = str(cb.id);
    fromIsBot = !!(cb.from && cb.from.is_bot);
  } else if (msg) {
    text = str(msg.text);
    userId = str(msg.from && msg.from.id);
    chatId = str(msg.chat && msg.chat.id);
    messageId = str(msg.message_id);
    chatType = str(msg.chat && msg.chat.type);
    fromIsBot = !!(msg.from && msg.from.is_bot);
    if (/^\/status\b/.test(text)) kind = 'status';
    else if (/^\/cancel\b/.test(text)) kind = 'cancel';
    else if (/^\//.test(text)) kind = 'command';
    else kind = 'request';
  }
  return {
    kind: kind,
    update_type: updateType(update),
    update_id: str(update.update_id),
    chat_id: chatId,
    chat_type: chatType,
    user_id: userId,
    from_is_bot: fromIsBot,
    message_id: messageId,
    text: text,
    callback_data: callbackData,
    callback_query_id: callbackQueryId
  };
}

function isAuthorized(parsed, allowedUserIds) {
  const ids = (allowedUserIds || []).map(String);
  return ids.indexOf(str(parsed && parsed.user_id)) >= 0;
}

// --- WF18 fail-closed ingress security (SECURITY-001 / TELEGRAM-002/003/004/005, WEBHOOK-002, STATE-005) -----
// Read the Telegram secret header case-insensitively from a headers object. Telegram sends it as
// 'X-Telegram-Bot-Api-Secret-Token'. Returns '' when absent. The value itself is NEVER logged by callers.
function headerSecret(headers) {
  headers = headers || {};
  for (const k in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, k) && low(k) === 'x-telegram-bot-api-secret-token') return String(headers[k] == null ? '' : headers[k]);
  }
  return '';
}
// Constant-ish comparison (no early-exit on length) so timing leaks nothing. Fails CLOSED: a blank expected
// secret (operator never configured MS_TELEGRAM_WEBHOOK_SECRET) is REJECTED — we do not accept an unsecured webhook.
function secretEqual(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}
function webhookSecretOk(headers, expectedSecret) {
  return secretEqual(headerSecret(headers), expectedSecret);
}

// Private chats only by default (STATE-005 option 1): a group/supergroup/channel would share one context across
// users. Empty chat_type is treated as private (Telegram omits it in some test payloads / direct DMs).
function isPrivateChat(parsed) {
  const t = low(parsed && parsed.chat_type);
  return t === '' || t === 'private';
}

// The ONE fail-closed ingress gate. Pure: NO Sheets, NO Telegram, NO state. Returns a decision the workflow
// branches on BEFORE any side effect. stop_reason is ordered so the cheapest/least-revealing check wins.
//   { accepted, stop_reason, secret_ok, telegram_enabled, supported, is_private, authorized, is_callback,
//     ack_needed, parsed, idempotency_key }
function ingressDecision(args) {
  args = args || {};
  const update = (args.update && args.update.body) ? args.update.body : (args.update || {});
  const cfg = args.cfg || {};
  const headers = args.headers || {};
  const expectedSecret = args.expectedSecret;

  const secret_ok = webhookSecretOk(headers, expectedSecret);
  const telegram_enabled = cfg.enable_telegram === true;
  const supported = isSupportedUpdate(update);
  const parsed = parseUpdate(update);
  const is_callback = parsed.kind === 'callback';
  const is_private = isPrivateChat(parsed);
  const not_bot = !parsed.from_is_bot;
  const authorized = isAuthorized(parsed, cfg.telegram_allowed_user_ids);
  const idempotency_key = updateIdempotencyKey(parsed);

  let stop_reason = '';
  if (!secret_ok) stop_reason = 'bad_secret';
  else if (!telegram_enabled) stop_reason = 'telegram_disabled';
  else if (!supported) stop_reason = 'unsupported_update';
  else if (!not_bot) stop_reason = 'bot_message';
  else if (!is_private) stop_reason = 'non_private_chat';
  else if (!authorized) stop_reason = 'unauthorized';

  return {
    accepted: stop_reason === '',
    stop_reason: stop_reason,
    secret_ok: secret_ok,
    telegram_enabled: telegram_enabled,
    supported: supported,
    is_private: is_private,
    authorized: authorized,
    is_callback: is_callback,
    // Only an AUTHORIZED callback that later proves to be a duplicate gets a benign answerCallbackQuery (stop the
    // spinner) — never a business send. A bad-secret / disabled / unsupported / unauthorized / non-private update
    // gets NOTHING outbound (we never reveal the bot to a spoofed or unauthorized caller).
    ack_needed: is_callback && secret_ok && telegram_enabled && is_private && not_bot && authorized && !!parsed.callback_query_id,
    callback_query_id: parsed.callback_query_id,
    parsed: parsed,
    idempotency_key: idempotency_key
  };
}

// --- guarded free-text approval (WF18-APPROVAL-003) --------------------------------------------------------
// A free-text "yes/run it" or "no/cancel" only counts as an approval signal; the caller MUST still verify there
// is exactly ONE unambiguous pending request before acting on it (zero => nothing to approve; many => ask which).
function freetextApprovalSignal(text) {
  const t = low(text);
  if (!t) return '';
  // NOTE: \b/\w do not work on Cyrillic in JS regex, so we anchor each phrase to start + a trailing
  // whitespace/punctuation/end-of-string boundary (so "дай отчёт" never reads as "да").
  const END = '([\\s,;:!.)]|$)';
  if (new RegExp('^(да|ага|давай|запускай|запуск|одобряю|одобрить|подтверждаю|подтвердить|поехали|ок запускай|go|yes|approve|confirm|launch)' + END).test(t)) return 'approve';
  if (new RegExp('^(нет|не надо|не запускай|отклоняю|отклонить|отмена|отмени|стоп|no|cancel|reject|stop|abort)' + END).test(t)) return 'reject';
  return '';
}

// --- Sheets formula-injection guard (WF18-SHEETS-004) ------------------------------------------------------
// Any user-controlled value that begins with = + - @ (or tab/CR) can execute as a spreadsheet formula. Prefix a
// single quote to neutralize, but never corrupt a legitimate finite number (e.g. "-4.5" stays numeric).
function escapeSheetValue(v) {
  if (v == null) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;                 // a plain finite number is safe, keep it
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;              // neutralize formula-leading content
  return s;
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

// --- outbox status lifecycle (TG-DELIVERY-003): pending -> sending -> sent | failed -------------------------
// A dedupe helper is useless if the durable row never advances past 'pending'. These produce the upsert row the
// delivery node writes AFTER the Telegram call so a retry can see send_status='sent' and skip.
function markSending(delivery) {
  return Object.assign({}, delivery, { send_status: 'sending', attempts: num(delivery && delivery.attempts, 0) + 1 });
}
function markSent(delivery, telegramMessageId) {
  return Object.assign({}, delivery, { send_status: 'sent', telegram_message_id: str(telegramMessageId), last_error: '' });
}
function markFailed(delivery, errText) {
  return Object.assign({}, delivery, { send_status: 'failed', last_error: str(errText).slice(0, 200) });
}
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

// answerCallbackQuery body (TELEGRAM-006). Acknowledges a callback fast so Telegram drops the loading spinner and
// the user is not tempted to press again. Text is short and never carries secrets.
function answerCallbackBody(callbackQueryId, text) {
  const b = { callback_query_id: str(callbackQueryId) };
  if (str(text)) b.text = str(text).slice(0, 180);
  return b;
}

module.exports = {
  parseUpdate, isAuthorized, updateIdempotencyKey, parseCallback, approvalKeyboard,
  updateType, isSupportedUpdate, SUPPORTED_UPDATE_TYPES, headerSecret, secretEqual, webhookSecretOk,
  isPrivateChat, ingressDecision, freetextApprovalSignal, escapeSheetValue,
  escapeMarkdown, chunkMessage, payloadHash, makeDelivery, shouldSend,
  markSending, markSent, markFailed, answerCallbackBody
};
