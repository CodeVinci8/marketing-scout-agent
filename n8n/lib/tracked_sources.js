'use strict';
// tracked_sources.js — public-source management (add / list / pause / resume / remove / check).
//
// A user can manage the public sources the agent monitors purely conversationally ("add their sites",
// "pause the second source"). Adds are idempotent (a source already tracked is never duplicated), platform
// availability is honest (a platform not in the source allowlist cannot be added), and every state change is
// audited. Source refs can be resolved from conversation context (competitor root URLs in the last report).
// Standalone + deterministic; stores no secrets.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }

const PLATFORMS = ['website', 'telegram_channel', 'vk_community'];
const STATUSES = ['active', 'paused', 'removed'];

// Detect the platform + canonical ref from a raw URL/handle.
function normalizeSourceRef(raw) {
  const s = str(raw);
  const l = low(s);
  if (/(^|\/\/|\.)?(t\.me|telegram\.me)\//.test(l) || /^@[a-z0-9_]+$/i.test(s) || /^tg:/.test(l)) {
    let handle = s.replace(/^https?:\/\//i, '').replace(/^(t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/^tg:\/\//i, '').replace(/\/+$/, '');
    return { platform: 'telegram_channel', ref: '@' + low(handle), label: '@' + handle, key: 'telegram_channel::' + low(handle) };
  }
  if (/vk\.com\//.test(l) || /^vk:/.test(l)) {
    let handle = s.replace(/^https?:\/\//i, '').replace(/^vk\.com\//i, '').replace(/^vk:\/\//i, '').replace(/\/+$/, '');
    return { platform: 'vk_community', ref: 'vk.com/' + low(handle), label: 'vk.com/' + handle, key: 'vk_community::' + low(handle) };
  }
  // default: website root
  let host = s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').replace(/\/+$/, '');
  if (!host) return { platform: 'website', ref: '', label: '', key: '' };
  return { platform: 'website', ref: 'https://' + low(host) + '/', label: low(host), key: 'website::' + low(host) };
}

function sourceAvailable(cfg, platform) {
  const allow = ((cfg && cfg.source_allowlist) || []).map(low);
  return allow.indexOf(low(platform)) >= 0;
}

// Idempotent add. Blocks unavailable platforms (honest). Returns the new list + outcome + audit event.
function addSource(existing, raw, ctx) {
  existing = Array.isArray(existing) ? existing : []; ctx = ctx || {};
  const n = normalizeSourceRef(raw);
  if (!n.key) return { sources: existing, added: false, reason: 'unparseable_source', audit: null };
  if (ctx.cfg && !sourceAvailable(ctx.cfg, n.platform)) return { sources: existing, added: false, reason: 'platform_unavailable', platform: n.platform, audit: null };
  const userId = str(ctx.owner_user_id);
  const dup = existing.find(s => str(s.key) === n.key && str(s.owner_user_id) === userId && s.status !== 'removed');
  if (dup) return { sources: existing, added: false, reason: 'already_tracked', source: dup, audit: null };
  const rec = {
    source_id: 'src_' + userId + '_' + n.key.replace(/[^a-z0-9]+/gi, '_'),
    owner_user_id: userId, platform: n.platform, ref: n.ref, key: n.key, label: n.label,
    status: 'active', added_at: str(ctx.ts), updated_at: str(ctx.ts), last_checked_at: '',
    agent_request_id: str(ctx.agent_request_id)
  };
  const audit = { event: 'source_add', owner_user_id: userId, source_id: rec.source_id, key: rec.key, platform: rec.platform, ts: str(ctx.ts) };
  return { sources: existing.concat([rec]), added: true, reason: '', source: rec, audit: audit };
}

function listSources(existing, userId) {
  return (existing || []).filter(s => str(s.owner_user_id) === str(userId) && s.status !== 'removed');
}

// pause / resume / remove with validated transitions + audit.
function setSourceStatus(existing, key, status, ctx) {
  existing = Array.isArray(existing) ? existing : []; ctx = ctx || {};
  status = low(status);
  if (STATUSES.indexOf(status) < 0) return { sources: existing, changed: false, reason: 'bad_status', audit: null };
  const userId = str(ctx.owner_user_id);
  let changed = false, audit = null;
  const out = existing.map(s => {
    if ((str(s.key) === str(key) || str(s.source_id) === str(key)) && str(s.owner_user_id) === userId && s.status !== 'removed') {
      if (s.status === status) return s; // idempotent
      changed = true;
      audit = { event: 'source_status', owner_user_id: userId, source_id: s.source_id, key: s.key, from: s.status, to: status, ts: str(ctx.ts) };
      return Object.assign({}, s, { status: status, updated_at: str(ctx.ts) });
    }
    return s;
  });
  return { sources: out, changed: changed, reason: changed ? '' : 'not_found_or_unchanged', audit: audit };
}

function checkSource(existing, key, ctx) {
  ctx = ctx || {};
  const s = (existing || []).find(x => (str(x.key) === str(key) || str(x.source_id) === str(key)) && str(x.owner_user_id) === str(ctx.owner_user_id));
  if (!s) return { found: false, status: '', last_checked_at: '' };
  return { found: true, status: s.status, platform: s.platform, ref: s.ref, last_checked_at: s.last_checked_at };
}

// Resolve source refs from conversation context — e.g. "add their sites to monitoring" uses the competitor
// root URLs from the last report / selected competitors.
function resolveSourcesFromContext(ctx) {
  ctx = ctx || {};
  const comps = (ctx.selected_competitors && ctx.selected_competitors.length) ? ctx.selected_competitors
    : ((ctx.last_report && ctx.last_report.competitors) || []);
  const refs = [];
  for (const c of comps) {
    const url = str(c && (c.root_url || c.evidence_url || c.url));
    if (url) refs.push(url);
  }
  return refs;
}

module.exports = {
  PLATFORMS, STATUSES, normalizeSourceRef, sourceAvailable, addSource, listSources,
  setSourceStatus, checkSource, resolveSourcesFromContext, str, low
};
