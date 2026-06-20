'use strict';
// orchestration_policy.js — Part 7: conversation-aware reuse vs. collect decision.
//
// A follow-up turn must not blindly repeat paid collection. Before any external call the orchestrator decides:
// can existing evidence answer this? is the evidence too old? did the user explicitly ask to refresh? does the
// new action need a source we have not collected? The decision (and its reason) is persisted so the operator
// can see why a paid call did or did not happen. Standalone + deterministic.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

// Intents that are answerable purely from stored context (no external call).
const CONTEXT_ANSWERABLE = ['report_followup', 'generate_ideas', 'compare_periods'];

function freshnessAgeDays(collectedAt, now) {
  const t0 = Date.parse(str(collectedAt)); const t1 = Date.parse(str(now)) || Date.now();
  if (!isFinite(t0)) return Infinity;
  return Math.max(0, (t1 - t0) / 86400000);
}

// Returns { action: 'reuse'|'collect'|'extend', reason, needs_external_call, target_sources }.
function reuseDecision(p) {
  p = p || {};
  const intent = p.intent || {};
  const intentId = low(intent.intent);
  const ctx = p.ctx || {};
  const cfg = p.cfg || {};
  const now = p.now;
  const hasReport = !!(ctx.last_report || ctx.last_report_id);
  const maxAge = num(cfg.evidence_max_age_days, 7);
  const ageDays = freshnessAgeDays(ctx.last_collected_at, now);
  const explicitRefresh = (intent.entities && intent.entities.refresh === true) || intentId === 'rerun_request';
  const requestedPlatforms = (intent.entities && intent.entities.platforms) || [];
  const collected = (ctx.collected_platforms || ['website']).map(low);

  // 1. pure context-answerable intents never spend (if we have a report)
  if (CONTEXT_ANSWERABLE.indexOf(intentId) >= 0) {
    if (hasReport) return mk('reuse', 'answerable_from_last_report', false, []);
    return mk('collect', 'no_report_yet', true, ['website']);
  }
  // 2. explicit refresh always collects fresh
  if (explicitRefresh) return mk('collect', 'explicit_refresh_requested', true, requestedPlatforms.length ? requestedPlatforms : ['website']);
  // 3. deep analysis on existing competitors
  if (intentId === 'deep_competitor_analysis') {
    const newPlatforms = requestedPlatforms.map(low).filter(pl => collected.indexOf(pl) < 0);
    if (hasReport && ageDays <= maxAge && newPlatforms.length === 0) return mk('reuse', 'fresh_evidence_covers_request', false, []);
    if (hasReport && newPlatforms.length > 0) return mk('extend', 'new_platform_requested', true, newPlatforms);
    if (hasReport && ageDays > maxAge) return mk('collect', 'evidence_stale', true, requestedPlatforms.length ? requestedPlatforms : ['website']);
    return mk('collect', 'no_prior_evidence', true, requestedPlatforms.length ? requestedPlatforms : ['website']);
  }
  // 4. source management never spends on collection
  if (intentId === 'add_source' || intentId === 'manage_sources') return mk('reuse', 'source_management_no_collection', false, []);
  // 5. default: a fresh search collects
  return mk('collect', 'new_search', true, requestedPlatforms.length ? requestedPlatforms : ['website']);
}

function mk(action, reason, needsCall, targets) {
  return { action: action, reason: reason, needs_external_call: !!needsCall, target_sources: (targets || []).map(low) };
}

// Persistable record for the orchestration_decisions tab.
function decisionRecord(decision, ids) {
  ids = ids || {};
  return {
    agent_request_id: str(ids.agent_request_id), conversation_id: str(ids.conversation_id),
    intent: str(ids.intent), action: str(decision.action), reason: str(decision.reason),
    needs_external_call: !!decision.needs_external_call, target_sources: (decision.target_sources || []).join(','),
    ts: str(ids.ts)
  };
}

module.exports = { CONTEXT_ANSWERABLE, freshnessAgeDays, reuseDecision, decisionRecord, str, low, num };
