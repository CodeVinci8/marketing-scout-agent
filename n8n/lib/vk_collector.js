'use strict';
// vk_collector.js — bounded, production-shaped optional VK PUBLIC community wall collector (Section 6).
//
// Scope (honest): public communities only — resolve by URL / screen name / numeric group id / negative owner id;
// read PUBLIC wall posts; collect new posts since a stored cursor; bounded historical backfill; detect new/edited
// public posts for monitoring. Comments are optional behind a disabled-by-default flag. We NEVER claim private
// groups, private profiles, arbitrary user data, messages, member/audience scraping, or full historical archive.
//
// This module is PURE: it builds the official-API request *descriptors* (params only — never a token, never an
// HTTP call) and PARSES API responses (incl. VK's HTTP-200-with-error-body convention). The access token lives
// only in the n8n credential store; a missing token yields status 'setup_required' (NOT an empty success).
// Self-contained (no cross-require) so it embeds verbatim into the generated workflow. $0, 0 calls from here.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function num(v) { const n = Number(v); return isFinite(n) ? n : null; }
function arr(v) { return Array.isArray(v) ? v : []; }
function bool(v) { return v === true || v === 'true' || v === 1 || v === '1'; }

// djb2 — stable, dependency-free content hash.
function hash(s) { s = String(s == null ? '' : s); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'h' + h.toString(16); }

const PLATFORM = 'vk';
const SOURCE_TYPE = 'vk_community_wall';
const DEFAULT_API_VERSION = '5.199';
// VK API versions we accept (must be configurable + validated — never hardcode one undocumented "current" value).
const SUPPORTED_API_VERSIONS = ['5.131', '5.199', '5.200', '5.201'];

function resolveApiVersion(cfg) {
  cfg = cfg || {};
  const v = str(cfg.vk_api_version) || DEFAULT_API_VERSION;
  return { version: v, valid: SUPPORTED_API_VERSIONS.indexOf(v) >= 0, supported: SUPPORTED_API_VERSIONS };
}

// ---- §6.3 canonical VK source identity ----------------------------------------------------------------------
// Accepts: https://vk.com/example | vk.com/example | @example | example | club123 | public123 | id-less numeric |
// numeric group id "123" | negative owner id "-123". Returns a canonical reference. Resolution of a screen name
// to a numeric community id happens later via groups.getById (offline we keep the screen name as the key).
function normalizeCommunity(raw) {
  let s = str(raw);
  let screen = '', communityId = null;
  s = s.replace(/^https?:\/\//i, '').replace(/^vk\.com\//i, '').replace(/^vk:\/\//i, '').replace(/^@/, '').replace(/\/+$/, '');
  if (/^-?\d+$/.test(s)) {
    communityId = Math.abs(parseInt(s, 10));          // numeric group id or negative owner id
  } else if (/^(club|public|event)(\d+)$/i.test(s)) {
    communityId = parseInt(s.replace(/^(club|public|event)/i, ''), 10);
    screen = low(s);
  } else if (/^[a-z0-9_.]+$/i.test(s)) {
    screen = low(s);
  } else {
    return { ok: false, reason: 'unparseable_vk_ref', input: str(raw) };
  }
  const canonicalScreen = screen || (communityId != null ? 'club' + communityId : '');
  return {
    ok: true, platform: PLATFORM, source_type: SOURCE_TYPE,
    community_id: communityId,                          // may be null until resolved by groups.getById
    screen_name: screen || '',
    owner_id: communityId != null ? -Math.abs(communityId) : null,   // wall.get owner_id for a community is negative
    canonical_url: 'https://vk.com/' + canonicalScreen,
    display_name: '',
    // dedup uses canonical community identity (numeric id if known, else screen name) — NOT the raw input string
    key: SOURCE_TYPE + '::' + (communityId != null ? String(communityId) : screen)
  };
}
function communityKey(identity) { identity = identity || {}; return SOURCE_TYPE + '::' + (identity.community_id != null ? String(identity.community_id) : str(identity.screen_name)); }

// ---- §6.2 credential / config gate --------------------------------------------------------------------------
// A missing token is setup_required (visible, not collected) — never a successful empty collection.
function credentialState(cfg) {
  cfg = cfg || {};
  if (cfg.enable_vk_collector !== true) return { ok: false, status: 'setup_required', reason: 'vk_collector_disabled' };
  if (!cfg.vk_token_present) return { ok: false, status: 'setup_required', reason: 'missing_vk_credential' };
  const ver = resolveApiVersion(cfg);
  if (!ver.valid) return { ok: false, status: 'config_error', reason: 'unsupported_vk_api_version', api_version: ver.version, supported: ver.supported };
  return { ok: true, status: 'configured', api_version: ver.version };
}
function collectorConfig(cfg) {
  cfg = cfg || {};
  return {
    api_version: resolveApiVersion(cfg).version,
    max_posts: num(cfg.vk_max_posts) || 25,
    max_pages: num(cfg.vk_max_pages) || 3,
    page_size: Math.min(100, num(cfg.vk_page_size) || 50),
    lookback_days: num(cfg.vk_lookback_days) || 30,
    comments_enabled: cfg.vk_enable_comments === true,
    max_comments_per_post: num(cfg.vk_max_comments_per_post) || 10,
    max_comment_posts: num(cfg.vk_max_comment_posts) || 8   // D2: bound how many posts we pull comments for per run
  };
}

// ---- §6.4 official API operation descriptors (params only; token injected by n8n credential, NOT here) -------
function resolveRequest(identity, cfg) {
  const ver = resolveApiVersion(cfg).version;
  // groups.getById resolves screen name OR numeric id -> canonical community object
  return { method: 'groups.getById', params: { group_id: str(identity.screen_name) || String(identity.community_id || ''), fields: 'screen_name,name,is_closed,deactivated,members_count,type', v: ver } };
}
function wallRequest(identity, cfg, offset) {
  const c = collectorConfig(cfg);
  return { method: 'wall.get', params: { owner_id: String(identity.owner_id != null ? identity.owner_id : (identity.community_id != null ? -Math.abs(identity.community_id) : '')), count: Math.min(c.page_size, c.max_posts), offset: num(offset) || 0, filter: 'owner', extended: 0, v: c.api_version } };
}
function commentsRequest(identity, post, cfg) {
  const c = collectorConfig(cfg);
  if (!c.comments_enabled) return null;   // disabled by default — never request comments behind the flag
  return { method: 'wall.getComments', params: { owner_id: String(identity.owner_id), post_id: num(post && post.post_id), count: c.max_comments_per_post, need_likes: 0, v: c.api_version } };
}

// ---- error mapping: VK returns errors as HTTP 200 with an `error` body (or a transport error) ----------------
function mapError(resp) {
  resp = resp || {};
  if (resp.error && (resp.error.error_code != null)) {
    const code = num(resp.error.error_code);
    const msg = str(resp.error.error_msg);
    if (code === 5) return { kind: 'token_invalid', retryable: false, setup_required: true, code: code, msg: msg };
    if (code === 6 || code === 29) return { kind: 'rate_limited', retryable: true, setup_required: false, code: code, msg: msg };
    if (code === 15 || code === 203 || code === 7) return { kind: 'access_denied', retryable: false, setup_required: false, code: code, msg: msg };
    if (code === 100 || code === 113 || code === 125) return { kind: 'invalid_request', retryable: false, setup_required: false, code: code, msg: msg };
    return { kind: 'api_error', retryable: false, setup_required: false, code: code, msg: msg };
  }
  if (resp.transport_error) return { kind: 'transport_error', retryable: true, setup_required: false, code: null, msg: str(resp.transport_error) };
  return null;   // no error
}

// ---- §6.4 parse community resolution ------------------------------------------------------------------------
function parseResolution(resp) {
  const err = mapError(resp);
  if (err) return { ok: false, error: err };
  // VK 5.x groups.getById returns { response: { groups: [..] } } or legacy { response: [..] }
  const list = (resp.response && (resp.response.groups || resp.response)) || [];
  const g = arr(list)[0];
  if (!g) return { ok: false, error: { kind: 'not_found', retryable: false, setup_required: false, msg: 'group not found' } };
  if (str(g.deactivated)) return { ok: false, error: { kind: g.deactivated === 'banned' ? 'banned' : 'deleted', retryable: false, setup_required: false, msg: 'group ' + g.deactivated } };
  if (num(g.is_closed) === 1 || num(g.is_closed) === 2) return { ok: false, error: { kind: 'private_group', retryable: false, setup_required: false, msg: 'community is closed/private' } };
  return {
    ok: true,
    community: {
      community_id: num(g.id), screen_name: low(g.screen_name) || ('club' + num(g.id)),
      owner_id: -Math.abs(num(g.id)), display_name: str(g.name),
      canonical_url: 'https://vk.com/' + (low(g.screen_name) || ('club' + num(g.id))),
      members_count: num(g.members_count), type: str(g.type), platform: PLATFORM, source_type: SOURCE_TYPE
    }
  };
}

// ---- §6.5 canonical VK record from a wall post --------------------------------------------------------------
function buildRecord(post, identity, ctx) {
  post = post || {}; identity = identity || {}; ctx = ctx || {};
  const ownerId = num(post.owner_id) != null ? num(post.owner_id) : num(identity.owner_id);
  const postId = num(post.id);
  const editedTs = num(post.edited) || 0;          // unix; 0 = never edited
  const publishedTs = num(post.date) || 0;
  const text = str(post.text);
  const attachments = arr(post.attachments).map(a => ({ type: str(a.type) })); // metadata only — never download files
  const copyHistory = arr(post.copy_history);
  const isRepost = copyHistory.length > 0;
  const counters = {
    likes: num((post.likes || {}).count), comments: num((post.comments || {}).count),
    reposts: num((post.reposts || {}).count), views: num((post.views || {}).count)
  };
  // content hash drives edit detection; includes text + attachment shape + repost source
  const contentHash = hash(text + '|' + attachments.map(a => a.type).join(',') + '|' + (isRepost ? str((copyHistory[0] || {}).id) : ''));
  const canonicalUrl = 'https://vk.com/wall' + ownerId + '_' + postId;
  return {
    agent_request_id: str(ctx.agent_request_id), source_run_id: str(ctx.source_run_id), workflow_run_id: str(ctx.workflow_run_id),
    source_record_id: 'vk_' + ownerId + '_' + postId, owner_user_id: str(ctx.owner_user_id),
    platform: PLATFORM, source_type: SOURCE_TYPE,
    community_id: identity.community_id != null ? identity.community_id : Math.abs(ownerId),
    owner_id: ownerId, post_id: postId,
    // edited-post version identity includes the edit timestamp (or, if absent, the normalized content hash)
    post_version: editedTs ? (postId + '@' + editedTs) : (postId + '@h' + contentHash),
    edited_ts: editedTs, canonical_url: canonicalUrl,
    published_at: publishedTs ? new Date(publishedTs * 1000).toISOString() : '',
    collected_at: str(ctx.now) || new Date().toISOString(),
    text: text, attachments: attachments,
    repost: isRepost ? { from_id: num((copyHistory[0] || {}).from_id), original_id: num((copyHistory[0] || {}).id) } : null,
    // counters are explicitly observation-time values (volatile; not a fact about the post itself)
    engagement_observed: counters, engagement_note: 'значения на момент сбора (наблюдение, не факт)',
    content_hash: contentHash, is_pinned: bool(post.is_pinned),
    evidence_excerpt: text.slice(0, 280),
    data_mode: str(ctx.data_mode) || 'live',
    quality_status: 'pending', report_eligible: true, monitoring_eligible: true
  };
}

// identity used for dedup across pages + edit detection
function recordIdentity(rec) { return str(rec.owner_id) + '_' + str(rec.post_id); }
function recordVersion(rec) { return str(rec.post_version); }

// ---- §6.4 parse a wall page: dedup across pages, skip deleted, mark pinned, bounded ---------------------------
function parseWall(resp, identity, ctx, seen) {
  const err = mapError(resp);
  if (err) return { ok: false, error: err, posts: [], total: 0 };
  const r = resp.response || {};
  const total = num(r.count) || 0;
  seen = seen || {};
  const items = arr(r.items);
  const posts = [];
  let skipped_deleted = 0, duplicates = 0;
  items.forEach(p => {
    if (str(p.deleted) || p.is_deleted === true) { skipped_deleted++; return; }   // deleted post mid-feed
    const rec = buildRecord(p, identity, ctx);
    const id = recordIdentity(rec);
    if (seen[id]) { duplicates++; return; }   // same post returned on overlapping pages
    seen[id] = true;
    posts.push(rec);
  });
  return { ok: true, posts: posts, total: total, returned: items.length, skipped_deleted: skipped_deleted, duplicates: duplicates };
}

// Plan bounded pagination offsets up to max_pages/max_posts (so the workflow knows how many wall.get calls).
function paginationPlan(cfg) {
  const c = collectorConfig(cfg);
  const offsets = []; let got = 0;
  for (let page = 0; page < c.max_pages && got < c.max_posts; page++) { offsets.push(got); got += c.page_size; }
  return { offsets: offsets, page_size: c.page_size, max_posts: c.max_posts, max_pages: c.max_pages, expected_calls: offsets.length };
}

// ---- §6.6 monitoring: baseline vs new vs edited, dedup, one event per actual changed version -----------------
// prev = the stored set of {identity -> {post_version, content_hash}} from the last run. baseline=true on first
// successful run (no prior state): establish state WITHOUT emitting "new" alerts unless explicitly requested.
function detectChanges(prevState, records, opts) {
  opts = opts || {};
  prevState = prevState || {};
  const isBaseline = !opts.has_prior_state;
  const events = [];
  const nextState = {};
  records.forEach(rec => {
    const id = recordIdentity(rec);
    const ver = recordVersion(rec);
    nextState[id] = { post_version: ver, content_hash: rec.content_hash, is_pinned: rec.is_pinned };
    const prev = prevState[id];
    if (isBaseline) return;                                   // first run: seed state, no alerts
    if (!prev) { events.push(changeEvent('new_post', rec)); return; }
    if (str(prev.post_version) !== ver) { events.push(changeEvent('edited_post', rec)); return; }
    // unchanged (incl. an old pinned post seen again) -> no event
  });
  // carry forward prior posts not in this page window (we don't delete state for unseen older posts)
  Object.keys(prevState).forEach(id => { if (!nextState[id]) nextState[id] = prevState[id]; });
  const emit = (isBaseline && opts.emit_baseline === true) ? records.map(r => changeEvent('new_post', r)) : events;
  return { baseline: isBaseline, events: emit, state: nextState, new_count: emit.filter(e => e.change_type === 'new_post').length, edited_count: emit.filter(e => e.change_type === 'edited_post').length };
}
function changeEvent(type, rec) {
  return {
    change_id: type + '::' + recordIdentity(rec) + '::' + recordVersion(rec),  // deterministic -> dedup
    change_type: type, owner_user_id: str(rec.owner_user_id), platform: PLATFORM, source_type: SOURCE_TYPE,
    community_id: rec.community_id, owner_id: rec.owner_id, post_id: rec.post_id, post_version: rec.post_version,
    canonical_url: rec.canonical_url, summary: (type === 'edited_post' ? 'Изменён пост' : 'Новый пост') + ': ' + rec.evidence_excerpt.slice(0, 120),
    published_at: rec.published_at, ts: str(rec.collected_at)
  };
}
// dedup across scheduled runs: a change_id already recorded is never emitted again.
function shouldNotify(existingEvents, ev) {
  const prior = arr(existingEvents).filter(e => str(e.change_id) === str(ev.change_id));
  return prior.length ? { notify: false, reason: 'already_notified' } : { notify: true, reason: '' };
}

// ---------------------------------------------------------------------------------------------------------------
// D2 — bounded PUBLIC comment collection (Section 6 comments path). Public data only: comment id, parent post,
// public numeric author id (from_id), text, date. We NEVER resolve author profiles/names (avoids extra calls +
// non-public PII); author identity stays the public from_id. All functions are PURE (no token, no HTTP). Scoring
// is NOT done here — the WF26 node calls semantic_core.classifyOffline (the single scoring contract). These helpers
// only parse, gate obvious noise deterministically, separate community-owned content, and stamp lineage.

// Deterministic noise gate. Rejects stickers/emoji-only/greeting/praise-without-need/contest/too-short comments so
// only substantive comments reach classifyOffline + WF14. Returns {noise, reason}. Conservative: a comment showing
// ANY credit/loan/question demand marker is NEVER rejected as noise.
function commentNoiseClass(text) {
  const t = str(text);
  if (!t) return { noise: true, reason: 'empty' };
  const letters = t.replace(/[^0-9A-Za-zА-Яа-яЁё]/g, '');
  if (letters.length === 0) return { noise: true, reason: 'emoji_or_sticker_only' };
  const l = low(t);
  if (/^\[?(sticker|стикер)\]?/.test(l)) return { noise: true, reason: 'sticker' };
  // a real demand/question signal overrides every noise rule below
  const demandish = /(кредит|займ|ипотек|рефинанс|залог|птс|брокер|отказ|просрочк|долг|банк|деньг|ставк|помог|подскаж|посоветуй|как\s|почему|сколько|можно ли|нужн|ищу|\?)/.test(l);
  if (demandish) return { noise: false, reason: '' };
  if (/(конкурс|розыгрыш|giveaway|участву)/.test(l) && letters.length < 80) return { noise: true, reason: 'contest' };
  if (/^(привет|здравствуй|здравствуйте|добрый|доброе|доброй|хай|ку|доброго)\b/.test(l) && letters.length < 40) return { noise: true, reason: 'greeting' };
  if (/(спасибо|благодар|класс|супер|отличн|молодц|полезн|топ|огонь|респект|круто|ясно|понятно|согласен|верно|👍|❤)/.test(l) && letters.length < 60) return { noise: true, reason: 'praise_without_need' };
  if (letters.length < 12) return { noise: true, reason: 'too_short' };
  return { noise: false, reason: '' };
}

// Community-owned separation: a comment authored by the community itself (negative VK id = a group/community, or an
// exact match on the resolved community owner) can NEVER be a public consumer lead. Wall posts are never leads.
function commentIsOwnerAuthored(fromId, identity) {
  const f = num(fromId);
  if (f == null) return false;
  if (f < 0) return true;                       // any group/community author
  identity = identity || {};
  const oid = num(identity.owner_id), cid = num(identity.community_id);
  if (oid != null && f === oid) return true;
  if (cid != null && f === -Math.abs(cid)) return true;
  return false;
}

// Parse a wall.getComments response (VK's HTTP-200-with-error-body convention respected). Public fields only.
function parseComments(resp, post, identity, ctx) {
  resp = resp || {}; post = post || {}; identity = identity || {}; ctx = ctx || {};
  const err = mapError(resp);
  if (err) return { ok: false, error: err, comments: [], total: 0, returned: 0 };
  const r = resp.response || resp;
  const items = arr(r.items);
  const ownerId = num(post.owner_id) != null ? num(post.owner_id) : num(identity.owner_id);
  const postId = num(post.post_id) != null ? num(post.post_id) : num(post.id);
  const comments = [];
  let skipped_deleted = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const cid = num(it.id);
    if (cid == null) continue;
    if (it.deleted === true || str(it.deleted)) { skipped_deleted++; continue; }
    const dateTs = num(it.date) || 0;
    comments.push({
      comment_id: cid, from_id: num(it.from_id), post_id: postId, owner_id: ownerId,
      community_id: identity.community_id != null ? identity.community_id : (ownerId != null ? Math.abs(ownerId) : null),
      text: str(it.text), date: dateTs,
      published_at: dateTs ? new Date(dateTs * 1000).toISOString() : '',
      canonical_url: 'https://vk.com/wall' + ownerId + '_' + postId + '?reply=' + cid,
      reply_to_user: num(it.reply_to_user), reply_to_comment: num(it.reply_to_comment)
    });
  }
  return { ok: true, comments: comments, total: num(r.count) || items.length, returned: items.length, skipped_deleted: skipped_deleted };
}

// Stamp full lineage onto a parsed comment (mechanical; no scoring). owner_authored is surfaced so the WF26 node
// routes community-owned comments to competitor context, never to the lead pool. Canonical reply URL + dedup key.
function buildCommentRecord(comment, identity, ctx) {
  comment = comment || {}; identity = identity || {}; ctx = ctx || {};
  const ownerId = comment.owner_id, postId = comment.post_id, cid = comment.comment_id;
  const url = str(comment.canonical_url) || ('https://vk.com/wall' + ownerId + '_' + postId + '?reply=' + cid);
  return {
    agent_request_id: str(ctx.agent_request_id), source_run_id: str(ctx.source_run_id), workflow_run_id: str(ctx.workflow_run_id),
    owner_user_id: str(ctx.owner_user_id),
    source_record_id: 'vkc_' + str(ownerId) + '_' + str(postId) + '_' + str(cid),
    platform: PLATFORM, source_type: 'public_discussion', touchpoint_type: 'public_comment',
    community_id: comment.community_id, owner_id: ownerId, post_id: postId, comment_id: cid, from_id: comment.from_id,
    owner_authored: commentIsOwnerAuthored(comment.from_id, identity),
    canonical_url: url, post_url: url,
    community_url: str(identity.canonical_url) || ('https://vk.com/' + (str(identity.screen_name) || ('club' + Math.abs(num(ownerId) || 0)))),
    community_name: str(identity.display_name),
    published_at: str(comment.published_at), collected_at: str(ctx.now) || new Date().toISOString(),
    text: str(comment.text), evidence_excerpt: str(comment.text).slice(0, 280),
    dedup_key: 'vk::comment::' + str(ownerId) + '_' + str(postId) + '_' + str(cid),
    content_hash: hash(str(comment.text)), data_mode: str(ctx.data_mode) || 'live'
  };
}

// failed collection: keep the last valid cursor/baseline + bounded backoff; setup_required is skipped (no spend).
function onCollectionFailure(source, err, cfg) {
  const base = num((source || {}).error_count) || 0;
  const backoffH = err && err.kind === 'rate_limited' ? Math.min(24, Math.pow(2, base + 1)) : ((num((cfg || {}).monitor_interval_hours) || 24));
  return {
    keep_cursor: true, last_content_hash: str((source || {}).last_content_hash), preserve_baseline: true,
    error_count: base + 1, backoff_hours: backoffH, last_error: err ? err.kind : 'unknown',
    setup_required: !!(err && err.setup_required)
  };
}

module.exports = {
  PLATFORM, SOURCE_TYPE, DEFAULT_API_VERSION, SUPPORTED_API_VERSIONS, resolveApiVersion, collectorConfig,
  normalizeCommunity, communityKey, credentialState, resolveRequest, wallRequest, commentsRequest,
  mapError, parseResolution, parseWall, buildRecord, recordIdentity, recordVersion, paginationPlan,
  detectChanges, changeEvent, shouldNotify, onCollectionFailure, hash,
  commentNoiseClass, commentIsOwnerAuthored, parseComments, buildCommentRecord
};
