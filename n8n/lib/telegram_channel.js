'use strict';
// telegram_channel.js — honest Telegram channel capability (Section 7). Two distinct modes, never conflated:
//
//   BOT UPDATE MODE (supported, future posts only): when the bot is an admin of a channel, Telegram delivers
//   `channel_post` / `edited_channel_post` updates. We canonicalize the channel + message, suppress duplicates,
//   match a tracked source, and feed the quality pipeline / emit a monitoring alert. This reads FUTURE posts
//   only — it CANNOT read arbitrary historical channel content.
//
//   EXTERNAL HISTORY MODE (not built-in): reading arbitrary public channel HISTORY needs an external collector
//   (e.g. a user-account MTProto client). Without it, status is setup_required — we NEVER fabricate history or
//   claim we can read the past. /help states the exact missing prerequisite.
//
// Pure + deterministic, $0, offline. Self-contained (no cross-require).

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function num(v) { const n = Number(v); return isFinite(n) ? n : null; }

const PLATFORM = 'telegram_channel';

// canonical channel identity from an update's chat object (id is negative for channels; username optional)
function canonicalChannel(chat) {
  chat = chat || {};
  const id = num(chat.id);
  const username = low(chat.username);
  return {
    platform: PLATFORM, channel_id: id, username: username,
    canonical_url: username ? ('https://t.me/' + username) : (id != null ? ('tg://channel?id=' + Math.abs(id)) : ''),
    key: PLATFORM + '::' + (username || (id != null ? String(id) : '')), title: str(chat.title)
  };
}

// parse a Telegram bot update; only channel_post / edited_channel_post are in scope here.
function parseChannelUpdate(update) {
  update = update || {};
  const post = update.channel_post || update.edited_channel_post || null;
  if (!post) return { ok: false, reason: 'not_a_channel_post' };
  const edited = !!update.edited_channel_post;
  const chan = canonicalChannel(post.chat);
  const messageId = num(post.message_id);
  const editDate = num(post.edit_date) || 0;
  const date = num(post.date) || 0;
  const text = str(post.text || post.caption);
  return {
    ok: true, edited: edited, channel: chan, message_id: messageId,
    // version identity: an edit bumps the version (edit_date), so an edit is one distinct version
    message_version: edited ? (messageId + '@' + editDate) : (messageId + '@orig'),
    edit_date: editDate, date: date, text: text,
    update_id: num(update.update_id)
  };
}

// bot CANNOT see posts from before it joined / before now: drop anything older than the activation watermark.
function isFuturePost(parsed, sinceTs) {
  const since = num(sinceTs);
  if (since == null) return true;            // no watermark -> accept (first activation establishes baseline)
  return num(parsed.date) != null && num(parsed.date) >= since;
}

// duplicate suppression: same (channel, message_version) already processed -> skip (handles redelivered updates).
function dedupKey(parsed) { return parsed.channel.key + '::' + parsed.message_version; }
function shouldProcess(seenKeys, parsed) {
  const k = dedupKey(parsed);
  if ((seenKeys || {})[k]) return { process: false, reason: 'duplicate_update', key: k };
  return { process: true, reason: '', key: k };
}

// match the channel update to a tracked source (by canonical key) for the right owner.
function matchTrackedSource(trackedSources, parsed, ownerHint) {
  const key = parsed.channel.key;
  const rows = (trackedSources || []).filter(s => low(s.platform) === PLATFORM && s.status !== 'removed');
  const m = rows.find(s => telegramKeyOf(s) === key && (ownerHint == null || str(s.owner_user_id) === str(ownerHint)));
  return m || null;
}
function telegramKeyOf(source) {
  // tracked_sources stores telegram ref as '@handle'; normalize to the same key shape as canonicalChannel
  const ref = low(source && source.ref).replace(/^@/, '');
  return PLATFORM + '::' + ref;
}

// build a canonical channel-post record for the quality pipeline (future-post mode).
function buildRecord(parsed, source, ctx) {
  ctx = ctx || {}; source = source || {};
  const chan = parsed.channel;
  return {
    agent_request_id: str(ctx.agent_request_id), source_run_id: str(ctx.source_run_id), workflow_run_id: str(ctx.workflow_run_id),
    source_record_id: 'tg_' + (chan.channel_id != null ? chan.channel_id : chan.username) + '_' + parsed.message_id,
    owner_user_id: str(source.owner_user_id || ctx.owner_user_id),
    platform: PLATFORM, source_type: 'telegram_channel_post',
    channel_id: chan.channel_id, channel_username: chan.username,
    message_id: parsed.message_id, message_version: parsed.message_version, edited: parsed.edited,
    canonical_url: chan.username ? ('https://t.me/' + chan.username + '/' + parsed.message_id) : chan.canonical_url,
    published_at: parsed.date ? new Date(parsed.date * 1000).toISOString() : '',
    collected_at: str(ctx.now), text: parsed.text, evidence_excerpt: parsed.text.slice(0, 280),
    mode: 'bot_update', data_mode: str(ctx.data_mode) || 'live',
    quality_status: 'pending', report_eligible: true, monitoring_eligible: true
  };
}

// external HISTORY request -> setup_required (never fabricated). Names the exact missing prerequisite for /help.
function historyAvailability(cfg) {
  cfg = cfg || {};
  if (cfg.enable_telegram_history_collector === true) return { ok: true, status: 'configured', mode: 'external_history' };
  return {
    ok: false, status: 'setup_required', mode: 'external_history',
    missing_prerequisite: 'external Telegram history collector (e.g. an MTProto user-client) + its credentials',
    help_text: 'Чтение прошлых постов канала недоступно: нужен внешний сборщик истории Telegram (MTProto user-клиент) и его учётные данные. Бот видит только НОВЫЕ посты канала, где он администратор.'
  };
}
// bot-update availability (the supported mode): requires the bot to be a channel admin (operator-asserted flag).
function botUpdateAvailability(cfg) {
  cfg = cfg || {};
  if (cfg.enable_telegram_collector === true) return { ok: true, status: 'configured', mode: 'bot_update' };
  return { ok: false, status: 'setup_required', mode: 'bot_update', missing_prerequisite: 'bot must be added as an admin of the channel + MS_ENABLE_TELEGRAM_COLLECTOR' };
}

module.exports = {
  PLATFORM, canonicalChannel, parseChannelUpdate, isFuturePost, dedupKey, shouldProcess,
  matchTrackedSource, telegramKeyOf, buildRecord, historyAvailability, botUpdateAvailability
};
