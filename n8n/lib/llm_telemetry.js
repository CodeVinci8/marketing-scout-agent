'use strict';
// llm_telemetry.js — Stage F persistence row builders for the llm_analysis_results + llm_analysis_telemetry tabs.
// Owner/request/report/source lineage on every row; NEVER a secret, NEVER a hidden thinking block, NEVER private
// PII. structured_result_json is the typed tool_use.input (validated). schema_mode/repair/fallback/cost/tokens are
// audit-grade. Idempotent-friendly: analysis_id is derived from (owner, agent_request_id, source_run_id,
// analysis_type, evidence_package_hash) so the SAME evidence reuses the same row. Embeddable: lt*-prefixed names.

function ltStr(v) { return v == null ? '' : String(v); }
function ltNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function ltHash(s) { s = ltStr(s); var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); }

function ltAnalysisId(ctx) {
  ctx = ctx || {};
  return 'an_' + ltHash([ltStr(ctx.owner_user_id), ltStr(ctx.agent_request_id), ltStr(ctx.source_run_id),
    ltStr(ctx.analysis_type), ltStr(ctx.evidence_package_hash)].join('::'));
}

// Row for llm_analysis_results. `result` = the finalized analyzeSource() output; `analysis` = its .analysis.
function buildAnalysisResultRow(ctx, result, nowIso) {
  ctx = ctx || {}; result = result || {};
  var analysis = result.analysis || {};
  return {
    analysis_id: ltAnalysisId(ctx),
    owner_user_id: ltStr(ctx.owner_user_id),
    chat_id: ltStr(ctx.chat_id),
    agent_request_id: ltStr(ctx.agent_request_id),
    source_run_id: ltStr(ctx.source_run_id),
    report_id: ltStr(ctx.report_id),
    analysis_type: ltStr(ctx.analysis_type) || 'single_source',
    source_scope_json: JSON.stringify(ctx.source_scope || {}),
    evidence_package_hash: ltStr(ctx.evidence_package_hash),
    schema_version: ltStr(ctx.schema_version),
    prompt_version: ltStr(ctx.prompt_version),
    model: ltStr(ctx.model) || 'claude-sonnet-4-6',
    structured_result_json: JSON.stringify(analysis),
    overall_confidence: ltNum(analysis.overall_confidence, 0),
    quality_status: result.fallback_used ? 'deterministic_fallback' : (result.repair_used ? 'repaired' : 'ok'),
    created_at: ltStr(nowIso),
    updated_at: ltStr(nowIso)
  };
}

// Row for llm_analysis_telemetry. `result` = finalized analyzeSource() output. No secret/thinking persisted.
function buildTelemetryRow(ctx, result, nowIso) {
  ctx = ctx || {}; result = result || {};
  var usage = result.usage || {};
  return {
    telemetry_id: 'tl_' + ltHash(ltAnalysisId(ctx) + '::' + ltStr(nowIso) + '::' + ltStr(result.request_id)),
    analysis_id: ltAnalysisId(ctx),
    owner_user_id: ltStr(ctx.owner_user_id),
    agent_request_id: ltStr(ctx.agent_request_id),
    provider: ltStr(result.provider) || 'aiprimetech',
    model: ltStr(ctx.model) || 'claude-sonnet-4-6',
    schema_mode: ltStr(result.schema_mode),
    stop_reason: ltStr(result.stop_reason),
    provider_request_id: ltStr(result.request_id),
    input_tokens: ltNum(usage.input_tokens, 0),
    output_tokens: ltNum(usage.output_tokens, 0),
    cache_creation_input_tokens: ltNum(usage.cache_creation_input_tokens, 0),
    cache_read_input_tokens: ltNum(usage.cache_read_input_tokens, 0),
    latency_ms: ltNum(result.latency_ms, 0),
    estimated_cost_usd: ltNum(ctx.estimated_cost_usd, 0),
    actual_cost_usd: ltNum(result.cost_usd, 0),
    repair_attempted: result.repair_used === true ? 'true' : 'false',
    repair_success: result.repair_success === true ? 'true' : 'false',
    repair_reason: (Array.isArray(result.validation_errors) ? result.validation_errors.slice(0, 3).join('; ') : ''),
    validation_errors: ltNum((result.validation_errors || []).length, 0),
    fallback_used: result.fallback_used === true ? 'true' : 'false',
    error_category: ltStr(result.error_category),
    created_at: ltStr(nowIso)
  };
}

// Find a reusable persisted result for this evidence hash (idempotent reuse) — same owner + analysis_id and a
// non-fallback quality. Returns the parsed structured_result_json or null.
function findReusableAnalysis(rows, ctx) {
  // ANALYSIS-REUSE-001: this used to require r.analysis_id === ltAnalysisId(ctx) — but ltAnalysisId embeds
  // agent_request_id + source_run_id, which are NEW for every request, so cross-request reuse could never match
  // and every repeat question paid for a fresh Claude call (live: exec 972 re-analyzed the same snapshot 3h after
  // exec 962). Same evidence means same analysis: match on owner + analysis_type + evidence_package_hash (the hash
  // already encodes source identity + facts + excerpts), and invalidate when the schema/prompt version moved.
  var owner = ltStr(ctx.owner_user_id);
  var hash = ltStr(ctx.evidence_package_hash);
  var typ = ltStr(ctx.analysis_type) || 'single_source';
  if (!hash) return null;                                            // no evidence identity -> nothing to reuse
  var best = null, bestT = -1;
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r) return;
    if (ltStr(r.owner_user_id) !== owner) return;                    // owner isolation, never relaxed
    if ((ltStr(r.analysis_type) || 'single_source') !== typ) return;
    if (ltStr(r.evidence_package_hash) !== hash) return;
    if (ctx.schema_version && ltStr(r.schema_version) && ltStr(r.schema_version) !== ltStr(ctx.schema_version)) return;
    if (ctx.prompt_version && ltStr(r.prompt_version) && ltStr(r.prompt_version) !== ltStr(ctx.prompt_version)) return;
    if (ltStr(r.quality_status) === 'deterministic_fallback') return; // don't reuse a failed run
    var t = Date.parse(ltStr(r.created_at)); if (!isFinite(t)) t = 0;
    if (t >= bestT) { bestT = t; best = r; }                          // newest valid analysis wins
  });
  if (!best) return null;
  try {
    return { analysis: JSON.parse(ltStr(best.structured_result_json) || '{}'), analysis_id: ltAnalysisId(ctx),
      quality_status: ltStr(best.quality_status), reused_from_analysis_id: ltStr(best.analysis_id) };
  } catch (e) { return null; }
}

module.exports = { ltAnalysisId, buildAnalysisResultRow, buildTelemetryRow, findReusableAnalysis, ltHash };
