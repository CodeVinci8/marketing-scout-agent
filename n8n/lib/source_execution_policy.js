'use strict';
// source_execution_policy.js — the ONE decision for "do we pay to collect this source again?"
//
// SOURCE-EXEC-001. Before this, WF04's `url_registry` check was a PERMANENT dedup: `hit = !force && rows.some(...)`
// with no time component. Once a URL was ever scraped it was skipped forever, so a user could never re-analyze a
// site — and the run produced an empty bundle and a misleading "данных нет" while a perfectly good saved snapshot
// sat in the sheet. Permanent-skip is not a freshness policy; it is a leak.
//
// Three explicit modes:
//   reuse   — a recent ACCEPTED snapshot exists and is still fresh. No paid collection; analyze the saved snapshot
//             and say so, with its collection time. Collection cost $0.
//   collect — no accepted snapshot, or the newest is older than the TTL, or every prior attempt failed. Pay once.
//   refresh — the user explicitly asked to re-collect. Bypasses ONLY the freshness check; approval, budget, quality
//             and global dedup all still apply, and the repeated paid collection is stated in the plan.
//
// A FAILED snapshot never counts as reusable and never blocks a retry — otherwise one bad scrape would poison a
// source forever (the same permanence bug in a different costume).
//
// Embeddable: unique sx*-prefixed names, no cross-lib require.

function sxStr(v) { return v == null ? '' : String(v); }
function sxNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

var SX_MODES = { REUSE: 'reuse', COLLECT: 'collect', REFRESH: 'refresh' };
// Default freshness window. The product's monitoring/report cadence is weekly (WF25 weekly digest, WF23 monitor),
// and WF10/WF12 already reason over a 30-day window — so a snapshot younger than 7 days is "current" for a
// competitor's public positioning (offers/prices change on a weeks-to-months scale, not hourly). Operator override:
// MS_SOURCE_FRESHNESS_DAYS.
var SX_DEFAULT_FRESHNESS_DAYS = 7;

// A snapshot is reusable only if it actually produced accepted content.
function sxIsAccepted(s) {
  if (!s) return false;
  var st = sxStr(s.quality_status || s.status).toLowerCase();
  if (st && ['failed', 'error', 'quarantined', 'technical_error', 'excluded', 'invalid'].indexOf(st) >= 0) return false;
  if (sxStr(s.processing_status).toLowerCase() === 'technical_error') return false;
  if (s.accepted === false) return false;
  return true;
}
function sxTime(s) {
  var t = Date.parse(sxStr((s && (s.collected_at || s.parsed_at || s.last_seen_at || s.created_at)) || ''));
  return isFinite(t) ? t : NaN;
}
function sxNorm(u) {
  return sxStr(u).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

// newestAcceptedSnapshot(snapshots, source_url, owner) -> the freshest ACCEPTED snapshot for this url (or null).
// Owner isolation: when a snapshot carries an owner, only that owner's rows are considered.
function newestAcceptedSnapshot(snapshots, sourceUrl, owner) {
  var key = sxNorm(sourceUrl);
  var best = null, bestT = -1;
  (Array.isArray(snapshots) ? snapshots : []).forEach(function (s) {
    if (!s) return;
    if (sxNorm(s.source_url || s.normalized_source_url) !== key) return;
    if (owner && sxStr(s.owner_user_id) && sxStr(s.owner_user_id) !== sxStr(owner)) return;
    if (!sxIsAccepted(s)) return;
    var t = sxTime(s);
    if (isNaN(t)) return;
    if (t > bestT) { bestT = t; best = s; }
  });
  return best;
}

// decideSourceExecution(input) -> { mode, reason, force_reprocess, snapshot, snapshot_age_days, snapshot_collected_at }
// input: { source_url, snapshots[], owner_user_id, requested_refresh, now, freshness_days }
function decideSourceExecution(input) {
  input = input || {};
  var nowMs = input.now ? Date.parse(sxStr(input.now)) : Date.now();
  if (!isFinite(nowMs)) nowMs = Date.now();
  var ttlDays = sxNum(input.freshness_days, SX_DEFAULT_FRESHNESS_DAYS);
  if (!(ttlDays > 0)) ttlDays = SX_DEFAULT_FRESHNESS_DAYS;

  var snap = newestAcceptedSnapshot(input.snapshots, input.source_url, input.owner_user_id);
  // Did we try this url before and fail? That is NOT "never collected" — the user deserves the real reason, and a
  // failed attempt must never block a retry.
  var key = sxNorm(input.source_url);
  var triedBefore = (Array.isArray(input.snapshots) ? input.snapshots : []).some(function (s) {
    return s && sxNorm(s.source_url || s.normalized_source_url) === key &&
      (!input.owner_user_id || !sxStr(s.owner_user_id) || sxStr(s.owner_user_id) === sxStr(input.owner_user_id));
  });
  var ageDays = snap ? (nowMs - sxTime(snap)) / 86400000 : null;
  var out = {
    mode: SX_MODES.COLLECT, reason: triedBefore ? 'last_attempt_failed' : 'never_collected', force_reprocess: false,
    snapshot: null, snapshot_age_days: null, snapshot_collected_at: ''
  };
  if (snap) {
    out.snapshot = snap;
    out.snapshot_age_days = Math.round(ageDays * 100) / 100;
    out.snapshot_collected_at = sxStr(snap.collected_at || snap.parsed_at || snap.last_seen_at || snap.created_at);
  }

  // An explicit refresh wins over freshness — but ONLY over freshness. Everything else still gates it.
  if (input.requested_refresh === true) {
    out.mode = SX_MODES.REFRESH;
    out.force_reprocess = true;
    out.reason = snap ? 'explicit_refresh' : 'explicit_refresh_no_snapshot';
    return out;
  }
  if (!snap) return out;                                   // collect / never_collected
  if (ageDays > ttlDays) { out.reason = 'snapshot_stale'; return out; }  // collect / stale
  out.mode = SX_MODES.REUSE;
  out.reason = 'fresh_snapshot';
  return out;
}

// Russian phrases that mean "collect it again, now". Cyrillic \b/\w do not fire in JS, so match on explicit
// [а-яё] boundaries. Deliberately narrow: an accidental refresh costs the user real money.
var SX_REFRESH_RE = /(^|[^а-яёa-z])(обнови(ть|те)?|переобнови(ть|те)?|пересобери|пересобрать|пересоберите|заново|повтори(ть|те)? сбор|повторный сбор|принудительн(о|ый|ая)|ещё раз собери|еще раз собери|свеж(ие|их) данн(ые|ых)|актуализируй|перепроверь)([^а-яёa-z]|$)/i;
// "обнови отчёт" = rebuild the report from what we have; it is NOT automatically a paid re-collection.
var SX_REPORT_ONLY_RE = /обнови(ть|те)?\s+отч[её]т/i;

// detectRefreshRequest(text) -> { requested_refresh, refresh_reason }
function detectRefreshRequest(text) {
  var t = sxStr(text);
  if (!t) return { requested_refresh: false, refresh_reason: '' };
  if (SX_REPORT_ONLY_RE.test(t) && !/данн|сбор|источник|сайт/i.test(t)) {
    return { requested_refresh: false, refresh_reason: 'report_rebuild_only' };
  }
  if (SX_REFRESH_RE.test(t)) return { requested_refresh: true, refresh_reason: 'user_requested_refresh' };
  return { requested_refresh: false, refresh_reason: '' };
}

module.exports = {
  SX_MODES, SX_DEFAULT_FRESHNESS_DAYS, SX_REFRESH_RE,
  decideSourceExecution, detectRefreshRequest, newestAcceptedSnapshot, sxIsAccepted, sxNorm
};
