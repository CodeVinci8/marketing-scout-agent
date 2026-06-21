'use strict';
// refresh_policy.js — canonical per-source smart-refresh decision (Section 7).
//
// Before any external collection the orchestrator decides PER SOURCE: reuse / refresh_stale / refresh_missing
// / refresh_failed / refresh_requested / skip_fresh / skip_excluded / unavailable. Decisions are deterministic
// from freshness, last successful collection, health, content hash, requested fields, report age and explicit
// user instruction, with a per-platform freshness threshold. Reuse preserves lineage (prior source_run_id);
// a failed refresh never destroys the previous valid report (the plan says keep_previous_report). The decision
// + reason are persisted to orchestration_decisions. Pure + deterministic, $0 until the orchestrator acts.

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function ageDays(ts, now) { const t0 = Date.parse(str(ts)); if (!isFinite(t0)) return Infinity; return Math.max(0, ((Date.parse(str(now)) || Date.now()) - t0) / 86400000); }

const DECISIONS = ['reuse', 'refresh_stale', 'refresh_missing', 'refresh_failed', 'refresh_requested', 'skip_fresh', 'skip_excluded', 'unavailable'];
const NEEDS_CALL = { refresh_stale: true, refresh_missing: true, refresh_failed: true, refresh_requested: true };

function refKey(s) { return low(s.ref || s.source || s.source_id); }
function thresholdFor(platform, cfg, instr) {
  if (instr && instr.max_age_days != null) return num(instr.max_age_days, 7);
  const per = (cfg && cfg.freshness_days) || {};
  if (per[low(platform)] != null) return num(per[low(platform)]);
  return num(cfg && cfg.evidence_max_age_days, 7);
}
function collectorAvailable(platform, cfg) {
  platform = low(platform); cfg = cfg || {};
  if (platform === 'website' || platform === '') return true;
  if (platform === 'avito') return true; // search-card discovery is available (see source matrix)
  if (platform === 'telegram_channel') return cfg.enable_telegram_collector === true;
  if (platform === 'vk_community') return cfg.enable_vk_collector === true;
  const allow = (cfg.source_allowlist || []).map(low);
  return allow.indexOf(platform) >= 0;
}

// decideRefresh(source, ctx) -> { ref, platform, decision, reason, needs_call, preserve_source_run_id }
function decideRefresh(source, ctx) {
  source = source || {}; ctx = ctx || {};
  const instr = ctx.user_instruction || {};
  const cfg = ctx.cfg || {};
  const key = refKey(source);
  const platform = low(source.platform) || 'website';
  const mk = (decision, reason) => ({
    ref: source.ref || source.source || source.source_id, platform: platform, decision: decision, reason: reason,
    needs_call: !!NEEDS_CALL[decision],
    preserve_source_run_id: NEEDS_CALL[decision] ? '' : str(source.source_run_id)
  });

  // 1. explicit user exclusion always wins (no call)
  const excluded = (instr.exclude || []).map(low);
  if (excluded.some(e => e && key.indexOf(e) >= 0)) return mk('skip_excluded', 'user_excluded');

  // 2. collector not configured -> honestly unavailable (no call, no fake success)
  if (!collectorAvailable(platform, cfg)) return mk('unavailable', 'collector_setup_required');

  // 3. explicit refresh request (refresh_all or this source named)
  const onlyRefresh = (instr.refresh_only || []).map(low);
  if (instr.refresh_all === true || onlyRefresh.some(e => e && key.indexOf(e) >= 0)) return mk('refresh_requested', 'explicit_refresh_requested');
  // if the user named specific sources to refresh and this is not one of them -> reuse the rest
  if (onlyRefresh.length && !onlyRefresh.some(e => e && key.indexOf(e) >= 0)) return mk('reuse', 'not_in_explicit_refresh_set');

  // 4. last collection failed (retry; checked before "never collected" so an errored source is not mislabelled)
  if (low(source.last_status) === 'error' || (num(source.error_count, 0) > 0 && !str(source.last_success_at))) return mk('refresh_failed', 'last_collection_failed');

  // 5. never collected
  if (!str(source.last_success_at) && !str(source.content_hash) && !str(source.source_run_id)) return mk('refresh_missing', 'never_collected');

  // 6. requested fields not present in this source's collected fields
  const reqFields = (ctx.requested_fields || []).map(low);
  const have = (source.collected_fields || []).map(low);
  if (reqFields.length && reqFields.some(f => have.indexOf(f) < 0)) return mk('refresh_missing', 'requested_fields_missing');

  // 7. stale beyond the per-platform threshold
  const max = thresholdFor(platform, cfg, instr);
  if (ageDays(source.last_success_at, ctx.now) > max) return mk('refresh_stale', 'stale_beyond_' + max + 'd');

  // 8. fresh -> reuse (no call), lineage preserved
  return mk('skip_fresh', 'fresh_within_' + max + 'd');
}

// planRefresh(sources, ctx) -> approval-ready plan
function planRefresh(sources, ctx) {
  sources = Array.isArray(sources) ? sources : []; ctx = ctx || {};
  const cfg = ctx.cfg || {};
  const decisions = sources.map(s => decideRefresh(s, ctx));
  const reused = decisions.filter(d => d.decision === 'reuse' || d.decision === 'skip_fresh');
  const refreshed = decisions.filter(d => d.needs_call);
  const skipped = decisions.filter(d => d.decision === 'skip_excluded');
  const unavailable = decisions.filter(d => d.decision === 'unavailable');
  return {
    decisions: decisions,
    reused: reused.map(d => d.ref), refreshed: refreshed.map(d => d.ref),
    skipped: skipped.map(d => d.ref), unavailable: unavailable.map(d => d.ref),
    expected_calls: refreshed.length,
    max_source_budget_usd: cfg.source_budget_usd != null ? cfg.source_budget_usd : 'unknown',
    max_llm_budget_usd: cfg.llm_budget_usd != null ? cfg.llm_budget_usd : 'unknown',
    reasons: decisions.map(d => ({ ref: d.ref, decision: d.decision, reason: d.reason })),
    on_failure: 'keep_previous_report', external_calls_so_far: 0
  };
}

// decisionRecords(plan, ids) -> orchestration_decisions rows
function decisionRecords(plan, ids) {
  ids = ids || {};
  return (plan.decisions || []).map(d => ({
    agent_request_id: str(ids.agent_request_id), conversation_id: str(ids.conversation_id),
    source_ref: str(d.ref), platform: str(d.platform), decision: str(d.decision), reason: str(d.reason),
    needs_external_call: !!d.needs_call, preserve_source_run_id: str(d.preserve_source_run_id), ts: str(ids.ts)
  }));
}

module.exports = { decideRefresh, planRefresh, decisionRecords, collectorAvailable, thresholdFor, DECISIONS, NEEDS_CALL };
