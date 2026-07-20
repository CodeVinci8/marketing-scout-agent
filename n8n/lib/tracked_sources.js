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

// DEFECT-10: the source allowlist uses SHORT platform names (website/telegram/vk) while normalizeSourceRef emits
// LONG forms (telegram_channel/vk_community/website). Map long->short so an addable Telegram/VK source is not
// falsely reported "площадка недоступна".
function platformAlias(p) { p = low(p); if (p === 'telegram_channel') return 'telegram'; if (p === 'vk_community') return 'vk'; return p; }
function sourceAvailable(cfg, platform) {
  const allow = ((cfg && cfg.source_allowlist) || []).map(low);
  // accept the allowlist in EITHER form — real config uses short names (telegram/vk), some fixtures use the long
  // normalizeSourceRef form (telegram_channel/vk_community).
  return allow.indexOf(low(platform)) >= 0 || allow.indexOf(platformAlias(platform)) >= 0;
}

// SOURCE-OP-001: classify a free-text source command into a concrete sub-op (+arg) so WF22 can act on it. The
// WF18 dispatch only knows the coarse intent ('manage_sources'); this turns "покажи источники" -> list,
// "поставь на паузу vk.com/x" -> pause+ref, "добавь https://a.ru" -> add+ref, etc. Deterministic; order matters
// (specific verbs before the generic add / list fallback). arg prefers an explicit URL/@handle, else the tail text.
function parseSourceOp(text) {
  const t = low(text);
  const ref = (str(text).match(/https?:\/\/\S+|(?:^|\s)@[a-z0-9_]{3,32}|\b(?:t\.me|telegram\.me)\/\S+|\bvk\.com\/\S+|\b[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?/i) || [''])[0].trim();
  function tail(rx) { const m = str(text).replace(rx, '').trim(); return ref || m; }
  if (/пауз|приостанов|останов/.test(t)) return { op: 'pause', arg: tail(/.*пауз[а-яё]*|.*приостанов[а-яё]*|.*останов[а-яё]*/i) };
  if (/возобнов|resume|сними?\s*(с\s*)?паузы?|верни\s*в\s*работу/.test(t)) return { op: 'resume', arg: tail(/.*возобнов[а-яё]*|.*resume|.*пауз[а-яё]*/i) };
  if (/убер|удал|remove|перестан[ья]|не\s*следи/.test(t)) return { op: 'remove', arg: tail(/.*убер[а-яё]*|.*удал[а-яё]*|.*remove/i) };
  if (/провер|check|статус\b/.test(t)) return { op: 'check', arg: tail(/.*провер[а-яё]*|.*check|.*статус/i) };
  if (/(покаж|список|list|какие|все|мои)\b.{0,20}источник|^\/?sources?\b|список источник/.test(t) || /покажи.*источник|источники\??$/.test(t)) return { op: 'list', arg: '' };
  if (ref || /добав|подключ|track|включи\s*в\s*монитор/.test(t)) return { op: 'add', arg: ref || tail(/.*добав[а-яё]*|.*подключ[а-яё]*/i) };
  return { op: 'list', arg: '' }; // safest default: show the registry
}

// A newly tracked source is monitorable (active) only when a real collector is configured for its platform.
// website is always collectable; Telegram/VK are active only when the operator has enabled their collector,
// otherwise the honest initial state is setup_required (visible, but not checked until configured).
function initialStatus(platform, cfg) {
  cfg = cfg || {}; platform = low(platform);
  if (platform === 'website') return 'active';
  if (platform === 'telegram_channel') return cfg.enable_telegram_collector === true ? 'active' : 'setup_required';
  if (platform === 'vk_community') return cfg.enable_vk_collector === true ? 'active' : 'setup_required';
  return 'setup_required';
}

// Idempotent add. Blocks unavailable platforms (honest). Returns the new list + outcome + audit event.
function addSource(existing, raw, ctx) {
  existing = Array.isArray(existing) ? existing : []; ctx = ctx || {};
  const n = normalizeSourceRef(raw);
  if (!n.key) return { sources: existing, added: false, reason: 'unparseable_source', audit: null };
  if (ctx.cfg && !sourceAvailable(ctx.cfg, n.platform)) return { sources: existing, added: false, reason: 'platform_unavailable', platform: n.platform, audit: null };
  const userId = str(ctx.owner_user_id);
  // duplicate registration returns/updates the existing source rather than creating a second row
  const dup = existing.find(s => str(s.key) === n.key && str(s.owner_user_id) === userId && s.status !== 'removed');
  if (dup) return { sources: existing, added: false, reason: 'already_tracked', source: dup, audit: null };
  const status = initialStatus(n.platform, ctx.cfg);
  const rec = {
    source_id: 'src_' + userId + '_' + n.key.replace(/[^a-z0-9]+/gi, '_'),
    owner_user_id: userId, chat_id: str(ctx.chat_id), platform: n.platform, ref: n.ref, key: n.key, label: n.label,
    status: status, added_at: str(ctx.ts), updated_at: str(ctx.ts),
    // monitoring lifecycle (populated by WF23 scheduled monitor)
    last_checked_at: '', last_success_at: '', next_check_at: str(ctx.ts), last_content_hash: '',
    last_change_at: '', last_status: status === 'active' ? 'new' : 'setup_required', last_error: '', error_count: 0,
    check_interval_hours: (ctx.cfg && ctx.cfg.monitor_interval_hours) || 24,
    agent_request_id: str(ctx.agent_request_id)
  };
  const audit = { event: 'source_add', owner_user_id: userId, source_id: rec.source_id, key: rec.key, platform: rec.platform, status: status, ts: str(ctx.ts) };
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
    if (s.status !== 'removed' && sourceMatches(s, key, userId)) {
      if (s.status === status) return s; // idempotent
      changed = true;
      audit = { event: 'source_status', owner_user_id: userId, source_id: s.source_id, key: s.key, from: s.status, to: status, ts: str(ctx.ts) };
      return Object.assign({}, s, { status: status, updated_at: str(ctx.ts) });
    }
    return s;
  });
  return { sources: out, changed: changed, reason: changed ? '' : 'not_found_or_unchanged', audit: audit };
}

// SOURCE-OP-001: match a tracked source by its key, its source_id, OR a raw URL/handle the user typed (normalized
// to the same canonical key add uses) — so pause/resume/remove/check work on "vk.com/x" / "https://a.ru", not only
// on an internal key.
function sourceMatches(x, keyOrRef, owner) {
  if (str(x.owner_user_id) !== str(owner)) return false;
  const k = str(keyOrRef);
  if (str(x.key) === k || str(x.source_id) === k) return true;
  const nk = normalizeSourceRef(keyOrRef).key;
  return nk && str(x.key) === nk;
}
function checkSource(existing, key, ctx) {
  ctx = ctx || {};
  const s = (existing || []).find(x => x.status !== 'removed' && sourceMatches(x, key, ctx.owner_user_id));
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
  setSourceStatus, checkSource, resolveSourcesFromContext, parseSourceOp, str, low
};
