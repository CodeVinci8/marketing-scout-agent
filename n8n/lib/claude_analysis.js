'use strict';
// claude_analysis.js — Stage F single-source + synthesis + candidate-enrichment orchestration. Ties the adapter
// (transport), contracts (schema+validators), evidence_package (bounded input) and llm_cost together into ONE
// flow: build → call (tool_use) → parse → LOCAL validate (schema + evidence + range) → at most ONE repair →
// deterministic fallback. Because tool_use returns a JSON object, there are no JSON-syntax repairs — repair fires
// only on a schema/evidence violation. English system/tool structure; Russian narrative fields. The deterministic
// report/analysis always survives an LLM failure (fail-closed). Embeddable: unique ca*-prefixed names.

var CLAUDE_A = require('./claude_adapter.js');
var CLAUDE_C = require('./claude_contracts.js');
var EVPKG = require('./evidence_package.js');
var LLMCOST = require('./llm_cost.js');

function caStr(v) { return v == null ? '' : String(v); }

var CA_SYSTEM_PROMPT = [
  'You are CodeVinci AI Pilot, an evidence-grounded competitor and market-intelligence analyst for a secured-lending',
  'business operating in Moscow and Moscow Oblast, Russia.',
  'You receive a BOUNDED evidence package (deterministic facts + citable evidence items). Absolute rules:',
  '1. Ground every item in evidence: each item.evidence_ids / used_evidence_ids MUST contain only evidence_id values',
  '   that appear in the package. Never invent an evidence_id, a price, a contact, or a region.',
  '2. Separate knowledge by item.kind: "fact" = directly stated in evidence; "inference" = reasoned from evidence;',
  '   "recommendation" = advice, never a fact.',
  '3. Narrative fields whose key ends in _ru MUST be written in natural, professional Russian. No English labels,',
  '   no JSON, no internal identifiers in those fields.',
  '4. Historical context is NOT a current result — never present it as this run.',
  '5. If evidence is thin or contradictory, say so in unknowns_ru and lower overall_confidence honestly.',
  '6. Do not recommend contacting private individuals or any unsolicited outreach.',
  'Return your result ONLY by calling the provided tool.'
].join('\n');

// Build the primary analysis call for a single source. `pkgResult` = buildEvidencePackage() output.
function buildSourceAnalysisCall(pkgResult, cfg) {
  cfg = cfg || {};
  var pkg = (pkgResult && pkgResult.package) || {};
  var tool = CLAUDE_C.ccAnalysisTool();
  var body = CLAUDE_A.buildToolRequest({
    model: caStr(cfg.llm_model) || 'claude-sonnet-4-6',
    system: CA_SYSTEM_PROMPT,
    user: EVPKG.renderPackagePrompt(pkg),
    tool: tool,
    max_tokens: 3072,
    temperature: 0.2
  });
  return { body: body, tool: tool, schema: CLAUDE_C.CC_ANALYSIS_SCHEMA, allowed_evidence_ids: (pkgResult && pkgResult.allowed_evidence_ids) || [] };
}

// Local validation gate — the ONLY thing that can trigger a repair. Returns { ok, errors }.
function validateAnalysisResult(result, allowedIds, schema) {
  var errs = CLAUDE_C.validateStructured(result, schema || CLAUDE_C.CC_ANALYSIS_SCHEMA);
  errs = errs.concat(CLAUDE_C.validateEvidenceIds(result, allowedIds || []));
  return { ok: errs.length === 0, errors: errs };
}

// Build the single bounded repair call: rejected object + validation errors + schema + allowed ids ONLY.
function buildRepairCall(rejected, errors, allowedIds, cfg) {
  cfg = cfg || {};
  var tool = CLAUDE_C.ccAnalysisTool();
  var user = [
    'Your previous tool call failed local validation. Fix ONLY the listed problems and resubmit via the tool.',
    'Do not add new claims. Keep every valid field. Use ONLY these evidence_ids: [' + (allowedIds || []).join(', ') + '].',
    'VALIDATION ERRORS:',
    (errors || []).map(function (e) { return '- ' + e; }).join('\n'),
    'YOUR PREVIOUS RESULT (JSON):',
    JSON.stringify(rejected)
  ].join('\n');
  var body = CLAUDE_A.buildToolRequest({
    model: caStr(cfg.llm_model) || 'claude-sonnet-4-6',
    system: CA_SYSTEM_PROMPT, user: user, tool: tool, max_tokens: 3072, temperature: 0
  });
  return { body: body, tool: tool };
}

// Deterministic fallback analysis from the package facts — so the report keeps a factual section if the LLM fails.
function deterministicAnalysisFallback(pkgResult) {
  var pkg = (pkgResult && pkgResult.package) || {};
  var f = pkg.current_run_facts || {};
  var ev = pkg.evidence_items || [];
  var items = [];
  var firstIds = ev.slice(0, 3).map(function (e) { return e.evidence_id; });
  if (f.positioning) items.push({ dimension: 'positioning', kind: 'fact', text_ru: f.positioning, evidence_ids: firstIds });
  if (f.offer_summary) items.push({ dimension: 'offers', kind: 'fact', text_ru: f.offer_summary, evidence_ids: firstIds });
  if (f.prices_terms) items.push({ dimension: 'prices_terms', kind: 'fact', text_ru: f.prices_terms, evidence_ids: firstIds });
  if (f.cta_text) items.push({ dimension: 'cta_touchpoints', kind: 'fact', text_ru: f.cta_text, evidence_ids: firstIds });
  return {
    executive_summary_ru: f.company_name ? ('Конкурент: ' + f.company_name + '. ИИ-анализ недоступен — приведены проверенные факты из источника.') : 'ИИ-анализ недоступен — приведены проверенные факты из источника.',
    items: items, recommended_actions: [], unknowns_ru: ['ИИ-анализ временно недоступен; показаны только детерминированные факты.'],
    overall_confidence: 0, used_evidence_ids: firstIds, _fallback: true
  };
}

// Full orchestration: analyzeSource(fetchFn, pkgResult, cfg) -> Promise<{ ok, analysis, schema_mode, repair_used,
// repair_success, fallback_used, validation_errors, usage, cost, telemetry }>. fetchFn is injected (testable).
function analyzeSource(fetchFn, pkgResult, cfg) {
  cfg = cfg || {};
  var built = buildSourceAnalysisCall(pkgResult, cfg);
  var allowed = built.allowed_evidence_ids;
  var costs = [], calls = 0;
  function record(res) { calls++; costs.push(LLMCOST.costFromUsage(res.usage, cfg)); }
  return CLAUDE_A.callClaude(fetchFn, built.body, cfg).then(function (res1) {
    record(res1);
    if (!res1.ok) return finalize(deterministicAnalysisFallback(pkgResult), { schema_mode: '', repair_used: false, repair_success: false, fallback_used: true, validation_errors: [res1.error_category], stop_reason: res1.stop_reason, request_id: res1.request_id, error_category: res1.error_category });
    var v1 = validateAnalysisResult(res1.content, allowed, built.schema);
    if (v1.ok) return finalize(res1.content, { schema_mode: res1.schema_mode, repair_used: false, repair_success: false, fallback_used: false, validation_errors: [], stop_reason: res1.stop_reason, request_id: res1.request_id, error_category: '' });
    // ONE bounded repair
    var rep = buildRepairCall(res1.content, v1.errors, allowed, cfg);
    return CLAUDE_A.callClaude(fetchFn, rep.body, cfg).then(function (res2) {
      record(res2);
      if (res2.ok) {
        var v2 = validateAnalysisResult(res2.content, allowed, built.schema);
        if (v2.ok) return finalize(res2.content, { schema_mode: res2.schema_mode, repair_used: true, repair_success: true, fallback_used: false, validation_errors: v1.errors, stop_reason: res2.stop_reason, request_id: res2.request_id, error_category: '' });
        return finalize(deterministicAnalysisFallback(pkgResult), { schema_mode: res2.schema_mode, repair_used: true, repair_success: false, fallback_used: true, validation_errors: v2.errors, stop_reason: res2.stop_reason, request_id: res2.request_id, error_category: 'validation_failed' });
      }
      return finalize(deterministicAnalysisFallback(pkgResult), { schema_mode: '', repair_used: true, repair_success: false, fallback_used: true, validation_errors: [res2.error_category], stop_reason: res2.stop_reason, request_id: res2.request_id, error_category: res2.error_category });
    });
  });
  function finalize(analysis, meta) {
    var totalUsage = costs.reduce(function (a, c) { return { input_tokens: a.input_tokens + c.input_tokens, output_tokens: a.output_tokens + c.output_tokens, cost_usd: 0 }; }, { input_tokens: 0, output_tokens: 0 });
    var cost = LLMCOST.sumCosts(costs);
    return {
      ok: !meta.fallback_used, analysis: analysis, calls: calls,
      schema_mode: meta.schema_mode || (analysis && analysis._fallback ? 'fallback' : 'tool_use'),
      repair_used: meta.repair_used, repair_success: meta.repair_success, fallback_used: meta.fallback_used,
      validation_errors: meta.validation_errors, stop_reason: meta.stop_reason, request_id: meta.request_id,
      error_category: meta.error_category,
      usage: { input_tokens: totalUsage.input_tokens, output_tokens: totalUsage.output_tokens }, cost_usd: cost,
      package_hash: (pkgResult && pkgResult.package_hash) || ''
    };
  }
}

module.exports = {
  CA_SYSTEM_PROMPT, buildSourceAnalysisCall, validateAnalysisResult, buildRepairCall,
  deterministicAnalysisFallback, analyzeSource
};
