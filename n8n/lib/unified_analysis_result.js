'use strict';
// unified_analysis_result.js — WIP4 UAR-001: ONE canonical, versioned analysis-result contract that every
// user-facing consumer reads (Telegram, XLSX, stored report, comparison, Opportunity Radar, Analyst Agent,
// Monitoring, Stage G export). Renderers must NOT re-interpret raw Claude output independently — they read this.
//
// Design: deterministic collectors are the source of facts; Claude interprets a bounded evidence package; every
// non-deterministic item cites evidence_ids that exist; wording/source scope + limitations travel WITH each item
// so a downstream renderer can never widen a scoped claim. Pure/embeddable; no network, no Date.now dependency
// for identity (item ids are derived from stable content, not time).

function uarStr(v) { return v == null ? '' : String(v); }
function uarNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function uarArr(v) { return Array.isArray(v) ? v : []; }
function uarClamp01(x) { x = Number(x); return isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }

var UAR_SCHEMA_VERSION = 'uar.v1';
var UAR_MODES = ['source_analysis', 'comparison', 'synthesis', 'change_report', 'discovery_enrichment', 'public_lead'];
var UAR_ROLES = ['direct_competitor', 'adjacent_player', 'industry_source', 'news_source', 'public_community', 'irrelevant_or_uncertain'];
var UAR_KINDS = ['fact', 'inference', 'recommendation'];

// djb2 — stable, dependency-free content hash for item ids (no timestamp → deterministic + resume-safe).
function uarHash(s) { var h = 5381; s = uarStr(s); for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; } return h.toString(16); }
function uarItemId(prefix, parts) { return prefix + '_' + uarHash(uarArr(parts).map(uarStr).join('|')).slice(0, 8); }

// A non-deterministic item carries its own scope + limitations so no renderer can widen it.
function uarMakeItem(prefix, o) {
  o = o || {};
  var text = uarStr(o.text_ru || o.text);
  return {
    item_id: uarStr(o.item_id) || uarItemId(prefix, [text, (o.evidence_ids || []).join(',')]),
    kind: UAR_KINDS.indexOf(uarStr(o.kind)) >= 0 ? uarStr(o.kind) : prefix,
    text_ru: text,
    evidence_ids: uarArr(o.evidence_ids).map(uarStr).filter(Boolean),
    confidence: uarClamp01(o.confidence == null ? 0.5 : o.confidence),
    source_scope: uarStr(o.source_scope) || 'single_source',   // single_source | multi_source | market
    wording_scope: uarStr(o.wording_scope) || 'source_only',   // source_only | scoped | market_wide
    dimension: uarStr(o.dimension) || '',
    limitations: uarArr(o.limitations).map(uarStr).filter(Boolean)
  };
}

// Build a fresh, empty UAR shell for a request.
function emptyUnifiedResult(ctx) {
  ctx = ctx || {};
  return {
    schema_version: UAR_SCHEMA_VERSION,
    analysis_id: uarStr(ctx.analysis_id),
    analysis_mode: UAR_MODES.indexOf(uarStr(ctx.analysis_mode)) >= 0 ? uarStr(ctx.analysis_mode) : 'source_analysis',
    owner_user_id: uarStr(ctx.owner_user_id),
    agent_request_id: uarStr(ctx.agent_request_id),
    report_id: uarStr(ctx.report_id),
    source_ids: uarArr(ctx.source_ids).map(uarStr),
    source_roles: [],
    confirmed_facts: [],
    inferences: [],
    recommendations: [],
    comparisons: [],
    opportunities: [],
    public_lead_interpretations: [],
    evidence: [],
    limitations: [],
    quality: { overall_confidence: 0, enriched: false, fallback_used: false },
    costs: { analysis_cost_usd: 0, repair_cost_usd: 0 },
    telemetry: { llm_primary_calls: 0, llm_repair_calls: 0, external_requests: 0, tokens_in: 0, tokens_out: 0, model: '' },
    lineage: { reused_from_analysis_id: '', original_created_at: '' },
    next_actions: []
  };
}

// Normalize a source-role record (from source_role.classifySourceRole) into the UAR shape.
function uarSourceRole(o) {
  o = o || {};
  var role = UAR_ROLES.indexOf(uarStr(o.source_role)) >= 0 ? uarStr(o.source_role) : 'irrelevant_or_uncertain';
  return {
    source_id: uarStr(o.source_id),
    source_url: uarStr(o.source_url),
    source_type: uarStr(o.source_type || o.kind),
    source_role: role,
    role_confidence: uarClamp01(o.role_confidence),
    role_reason: uarStr(o.role_reason),
    direct_competitor: role === 'direct_competitor' && o.direct_competitor === true,
    evidence_ids: uarArr(o.evidence_ids).map(uarStr).filter(Boolean),
    relationship_to_niche: uarStr(o.relationship_to_niche) || (role === 'irrelevant_or_uncertain' ? 'не определено' : 'связан с кредитной тематикой'),
    limitations: uarArr(o.limitations).map(uarStr).filter(Boolean)
  };
}

// UAR-MIGRATE-001: deterministic migration from the CURRENT shapes — a WF28 "Return Result" (analysisReturn) and
// the WF12/WF20 report bundle (bundle) — into the unified contract. No Claude call, no network. Legacy bundles
// (bundle.analysis with inferences/recommendations/pains/evidence) migrate too.
function migrateToUnifiedResult(analysisReturn, bundle, ctx) {
  analysisReturn = analysisReturn || {};
  bundle = bundle || {};
  ctx = ctx || {};
  var A = analysisReturn.analysis || {};
  var uar = emptyUnifiedResult({
    analysis_id: ctx.analysis_id || analysisReturn.analysis_id,
    analysis_mode: ctx.analysis_mode || bundle.analysis_mode || 'source_analysis',
    owner_user_id: ctx.owner_user_id || bundle.owner_user_id,
    agent_request_id: ctx.agent_request_id || bundle.agent_request_id,
    report_id: ctx.report_id || bundle.report_id,
    source_ids: ctx.source_ids
  });

  // ---- evidence (canonical, deduped elsewhere) ----
  var evMap = analysisReturn.evidence_map || {};
  var evList = [];
  if (Array.isArray(evMap)) evList = evMap;
  else Object.keys(evMap).forEach(function (k) { evList.push(evMap[k]); });
  if (!evList.length && Array.isArray(bundle.evidence)) evList = bundle.evidence;
  uar.evidence = evList.map(function (e) {
    e = e || {};
    return {
      evidence_id: uarStr(e.evidence_id || e.id),
      source_id: uarStr(e.source_id || e.source_key || e.source_name),
      source_url: uarStr(e.source_url || e.url || e.profile_url || e.post_url),
      excerpt: uarStr(e.excerpt || e.text || e.quote),
      published_at: uarStr(e.published_at || e.collected_at || e.date),
      source_role: uarStr(e.source_role || '')
    };
  });

  // ---- items from a Stage-F analysis (items[].kind) ----
  uarArr(A.items).forEach(function (it) {
    var item = uarMakeItem(uarStr(it.kind) || 'fact', {
      kind: it.kind, text_ru: it.text_ru, evidence_ids: it.evidence_ids, dimension: it.dimension,
      confidence: it.confidence, source_scope: it.source_scope, wording_scope: it.wording_scope, limitations: it.limitations
    });
    if (item.kind === 'fact') uar.confirmed_facts.push(item);
    else if (item.kind === 'recommendation') uar.recommendations.push(item);
    else uar.inferences.push(item);
  });
  uarArr(A.recommended_actions).forEach(function (r) {
    uar.recommendations.push(uarMakeItem('recommendation', { kind: 'recommendation', text_ru: r.text_ru, evidence_ids: r.evidence_ids, confidence: r.confidence }));
  });

  // ---- legacy bundle.analysis (inferences/recommendations/pains) when there was no items[] ----
  var LB = bundle.analysis || {};
  if (!uarArr(A.items).length) {
    uarArr(LB.inferences).forEach(function (t) { uar.inferences.push(uarMakeItem('inference', { kind: 'inference', text_ru: uarStr(t.text_ru || t), evidence_ids: t.evidence_ids })); });
    uarArr(LB.recommendations).forEach(function (t) { uar.recommendations.push(uarMakeItem('recommendation', { kind: 'recommendation', text_ru: uarStr(t.text_ru || t), evidence_ids: t.evidence_ids })); });
  }
  uarArr(LB.pains).forEach(function (t) { uar.inferences.push(uarMakeItem('inference', { kind: 'inference', text_ru: uarStr(t.text_ru || t), dimension: 'pains', evidence_ids: t.evidence_ids })); });

  // ---- limitations / unknowns ----
  uar.limitations = uarArr(A.unknowns_ru).map(uarStr).concat(uarArr(LB.unknowns).map(uarStr)).filter(Boolean);
  if (uar.evidence.length) uar.source_ids = uar.source_ids.length ? uar.source_ids
    : uar.evidence.map(function (e) { return e.source_id; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; });

  // ---- quality / costs / telemetry / lineage ----
  uar.quality.overall_confidence = uarNum(A.overall_confidence != null ? A.overall_confidence : (analysisReturn.overall_confidence), 0);
  uar.quality.enriched = analysisReturn.enriched === true;
  uar.quality.fallback_used = analysisReturn.fallback_used === true;
  uar.costs.analysis_cost_usd = uarNum(analysisReturn.cost_usd || (LB.analysis_cost_usd), 0);
  uar.costs.repair_cost_usd = uarNum(analysisReturn.repair_cost_usd || (LB.repair_cost_usd), 0);
  var reused = uarStr(analysisReturn.mode) === 'reuse' || !!analysisReturn.reused_from_analysis_id;
  uar.telemetry.llm_primary_calls = reused ? 0 : (analysisReturn.enriched ? 1 : 0);
  uar.telemetry.llm_repair_calls = (!reused && analysisReturn.repair_used === true) ? 1 : 0;
  uar.telemetry.tokens_in = uarNum(analysisReturn.tokens_in, 0);
  uar.telemetry.tokens_out = uarNum(analysisReturn.tokens_out, 0);
  uar.telemetry.model = uarStr(analysisReturn.model || LB.model);
  uar.lineage.reused_from_analysis_id = uarStr(analysisReturn.reused_from_analysis_id);
  uar.lineage.original_created_at = uarStr(analysisReturn.reused_from_created_at);
  return uar;
}

// Validate the minimal invariants (used by tests + a runtime guard). Returns {ok, errors[]}.
function validateUnifiedResult(uar) {
  var errors = [];
  uar = uar || {};
  if (uar.schema_version !== UAR_SCHEMA_VERSION) errors.push('bad schema_version');
  if (UAR_MODES.indexOf(uarStr(uar.analysis_mode)) < 0) errors.push('bad analysis_mode');
  var evIds = {};
  uarArr(uar.evidence).forEach(function (e) { if (e && e.evidence_id) evIds[e.evidence_id] = true; });
  ['confirmed_facts', 'inferences', 'recommendations', 'comparisons', 'opportunities', 'public_lead_interpretations'].forEach(function (bucket) {
    uarArr(uar[bucket]).forEach(function (it) {
      if (!it.item_id) errors.push(bucket + ' item missing item_id');
      // every non-deterministic item must cite evidence that EXISTS in the package (facts/inferences/comparisons)
      if (['confirmed_facts', 'inferences', 'comparisons'].indexOf(bucket) >= 0) {
        var cited = uarArr(it.evidence_ids);
        if (!cited.length) errors.push(bucket + ' item ' + it.item_id + ' cites no evidence');
        cited.forEach(function (id) { if (!evIds[id]) errors.push(bucket + ' item ' + it.item_id + ' cites unknown evidence ' + id); });
      }
      if (it.wording_scope === 'market_wide' && it.source_scope !== 'market') errors.push('item ' + it.item_id + ' claims market_wide wording without market source_scope');
    });
  });
  uarArr(uar.source_roles).forEach(function (r) {
    if (UAR_ROLES.indexOf(uarStr(r.source_role)) < 0) errors.push('bad source_role ' + r.source_role);
    if (r.direct_competitor === true && r.source_role !== 'direct_competitor') errors.push('direct_competitor flag without direct_competitor role');
  });
  return { ok: errors.length === 0, errors: errors };
}

module.exports = {
  UAR_SCHEMA_VERSION, UAR_MODES, UAR_ROLES, UAR_KINDS,
  emptyUnifiedResult, uarMakeItem, uarSourceRole, migrateToUnifiedResult, validateUnifiedResult, uarItemId, uarHash
};
