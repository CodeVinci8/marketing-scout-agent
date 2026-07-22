'use strict';
// claude_analysis.js — Stage F single-source + synthesis + candidate-enrichment orchestration. Ties the adapter
// (transport), contracts (schema+validators), evidence_package (bounded input) and llm_cost together into ONE
// flow: build → call (tool_use) → parse → LOCAL validate (schema + evidence + range) → at most ONE repair →
// deterministic fallback. Because tool_use returns a JSON object, there are no JSON-syntax repairs — repair fires
// only on a schema/evidence violation. English system/tool structure; Russian narrative fields. The deterministic
// report/analysis always survives an LLM failure (fail-closed). Embeddable: unique ca*-prefixed names.

// Destructured requires so the embed step (which strips `const { … } = require('./local')`) inlines the
// co-embedded lib functions directly into the n8n Code-node scope. Do NOT switch to namespace requires — the
// generator does not strip `var X = require('./local')` and n8n Code nodes cannot require() a local file.
const { buildToolRequest, callClaude } = require('./claude_adapter.js');
const { ccAnalysisTool, CC_ANALYSIS_SCHEMA, ccSynthesisTool, CC_SYNTHESIS_SCHEMA, ccCandidateTool, CC_CANDIDATE_SCHEMA, ccLeadTool, CC_LEAD_SCHEMA, validateStructured, validateEvidenceIds } = require('./claude_contracts.js');
const { renderPackagePrompt } = require('./evidence_package.js');
const { costFromUsage, sumCosts } = require('./llm_cost.js');

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
  '3a. Every JSON/tool KEY you emit MUST be the exact ASCII English key from the tool schema (e.g. text_ru,',
  '   evidence_ids, overall_confidence). NEVER use Cyrillic or visually-similar Unicode in a key — for example',
  '   write "text_ru" with a Latin r-u, never "text_ю". Russian belongs ONLY in the VALUES of _ru fields.',
  '4. Historical context is NOT a current result — never present it as this run.',
  '5. If evidence is thin or contradictory, say so in unknowns_ru and lower overall_confidence honestly.',
  '6. Do not recommend contacting private individuals or any unsolicited outreach.',
  'Return your result ONLY by calling the provided tool.'
].join('\n');

// Build the primary analysis call for a single source. `pkgResult` = buildEvidencePackage() output.
function buildSourceAnalysisCall(pkgResult, cfg) {
  cfg = cfg || {};
  var pkg = (pkgResult && pkgResult.package) || {};
  var tool = ccAnalysisTool();
  var body = buildToolRequest({
    model: caStr(cfg.llm_model) || 'claude-sonnet-4-6',
    system: CA_SYSTEM_PROMPT,
    user: renderPackagePrompt(pkg),
    tool: tool,
    max_tokens: 3072,
    temperature: 0.2
  });
  return { body: body, tool: tool, schema: CC_ANALYSIS_SCHEMA, allowed_evidence_ids: (pkgResult && pkgResult.allowed_evidence_ids) || [] };
}

// Local validation gate — the ONLY thing that can trigger a repair. Returns { ok, errors }.
function validateAnalysisResult(result, allowedIds, schema) {
  var errs = validateStructured(result, schema || CC_ANALYSIS_SCHEMA);
  errs = errs.concat(validateEvidenceIds(result, allowedIds || []));
  return { ok: errs.length === 0, errors: errs };
}

// Build the single bounded repair call: rejected object + validation errors + schema + allowed ids ONLY.
function buildRepairCall(rejected, errors, allowedIds, cfg) {
  cfg = cfg || {};
  var tool = ccAnalysisTool();
  var user = [
    'Your previous tool call failed local validation. Fix ONLY the listed problems and resubmit via the tool.',
    'Do not add new claims. Keep every valid field. Use ONLY these evidence_ids: [' + (allowedIds || []).join(', ') + '].',
    'VALIDATION ERRORS:',
    (errors || []).map(function (e) { return '- ' + e; }).join('\n'),
    'YOUR PREVIOUS RESULT (JSON):',
    JSON.stringify(rejected)
  ].join('\n');
  var body = buildToolRequest({
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
  function record(res) { calls++; costs.push(costFromUsage(res.usage, cfg)); }
  return callClaude(fetchFn, built.body, cfg).then(function (res1) {
    record(res1);
    if (!res1.ok) return finalize(deterministicAnalysisFallback(pkgResult), { schema_mode: '', repair_used: false, repair_success: false, fallback_used: true, validation_errors: [res1.error_category], stop_reason: res1.stop_reason, request_id: res1.request_id, error_category: res1.error_category });
    var v1 = validateAnalysisResult(res1.content, allowed, built.schema);
    if (v1.ok) return finalize(res1.content, { schema_mode: res1.schema_mode, repair_used: false, repair_success: false, fallback_used: false, validation_errors: [], stop_reason: res1.stop_reason, request_id: res1.request_id, error_category: '' });
    // ONE bounded repair
    var rep = buildRepairCall(res1.content, v1.errors, allowed, cfg);
    return callClaude(fetchFn, rep.body, cfg).then(function (res2) {
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
    var cost = sumCosts(costs);
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

// ============================ WIP4: three-source synthesis / comparison ======================================
// Same fail-closed flow as analyzeSource, but over a MULTI-SOURCE evidence package (>=3 accepted sources): build
// -> call (submit_synthesis) -> validate (schema + evidence ids) -> ONE repair -> deterministic fallback. Source-
// level facts stay separately traceable via evidence_ids; each comparison item MUST cite evidence from the
// contributing sources; no market-wide conclusion without support.
var CA_SYNTHESIS_PROMPT = [
  'You are CodeVinci AI Pilot, an evidence-grounded competitor and market-intelligence analyst for a secured-lending',
  'business in Moscow and Moscow Oblast, Russia. You receive a BOUNDED MULTI-SOURCE evidence package (several',
  'sources, each with citable evidence items). Absolute rules:',
  '1. Ground every comparison/opportunity/experiment in evidence: evidence_ids / used_evidence_ids MUST contain only',
  '   evidence_id values present in the package. Never invent an id, a price, a company fact, or a source.',
  '2. Keep source-level facts SEPARATE. A comparison states a COMMON pattern, a DIFFERENCE, a CONTRADICTION or a',
  '   MISSING-DATA gap — and cites the evidence_ids of the sources it compares.',
  '3. Do NOT assert a market-wide conclusion (leader/maximum/"весь рынок") unless the evidence across the sources',
  '   actually supports it; otherwise scope it or put it in recurring_pains_ru / opportunities as a hypothesis.',
  '4. Narrative fields whose key ends in _ru MUST be natural professional Russian; keys stay exact ASCII English.',
  '5. If the sources are too few or thin to compare, say so in overview_ru and keep comparisons conservative.',
  '6. Do not recommend contacting private individuals or any unsolicited outreach.',
  'Return your result ONLY by calling the provided tool.'
].join('\n');

function buildComparisonCall(pkgResult, cfg) {
  cfg = cfg || {};
  var pkg = (pkgResult && pkgResult.package) || {};
  var tool = ccSynthesisTool();
  var body = buildToolRequest({
    model: caStr(cfg.llm_model) || 'claude-sonnet-4-6',
    system: CA_SYNTHESIS_PROMPT, user: renderPackagePrompt(pkg), tool: tool, max_tokens: 3072, temperature: 0.2
  });
  return { body: body, tool: tool, schema: CC_SYNTHESIS_SCHEMA, allowed_evidence_ids: (pkgResult && pkgResult.allowed_evidence_ids) || [] };
}

function buildSynthesisRepairCall(rejected, errors, allowedIds, cfg) {
  cfg = cfg || {};
  var tool = ccSynthesisTool();
  var user = [
    'Your previous tool call failed local validation. Fix ONLY the listed problems and resubmit via the tool.',
    'Do not add new claims. Keep every valid field. Use ONLY these evidence_ids: [' + (allowedIds || []).join(', ') + '].',
    'VALIDATION ERRORS:', (errors || []).map(function (e) { return '- ' + e; }).join('\n'),
    'YOUR PREVIOUS RESULT (JSON):', JSON.stringify(rejected)
  ].join('\n');
  return { body: buildToolRequest({ model: caStr(cfg.llm_model) || 'claude-sonnet-4-6', system: CA_SYNTHESIS_PROMPT, user: user, tool: tool, max_tokens: 3072, temperature: 0 }), tool: tool };
}

// Deterministic comparison fallback — a conservative cross-source view from the package facts, so a synthesis
// section always survives an LLM failure. Compares by whatever facts each source exposed; cites their evidence.
function deterministicComparisonFallback(pkgResult) {
  var pkg = (pkgResult && pkgResult.package) || {};
  var srcs = Array.isArray(pkg.sources) ? pkg.sources : [];
  var ev = pkg.evidence_items || [];
  var comparisons = [];
  var used = [];
  ['positioning', 'offers', 'prices'].forEach(function (aspect) {
    var ids = [], bits = [];
    srcs.forEach(function (s) {
      var sid = (s.evidence_ids || []).filter(function (id) { return true; });
      var val = aspect === 'positioning' ? s.positioning : (aspect === 'offers' ? s.offer_summary : s.prices_terms);
      if (val && sid.length) { bits.push((s.source_name || s.source_id || 'источник') + ': ' + val); ids = ids.concat(sid.slice(0, 2)); }
    });
    if (bits.length >= 2) { comparisons.push({ aspect: aspect, text_ru: bits.join(' | '), evidence_ids: ids.slice(0, 6) }); used = used.concat(ids); }
  });
  if (!comparisons.length) { var f = ev.slice(0, 3).map(function (e) { return e.evidence_id; }); if (f.length) { comparisons.push({ aspect: 'positioning', text_ru: 'ИИ-сравнение недоступно — приведены собранные факты источников.', evidence_ids: f }); used = f; } }
  return {
    overview_ru: 'ИИ-сравнение временно недоступно — показан детерминированный срез по собранным источникам.',
    comparisons: comparisons, recurring_pains_ru: [], opportunities: [],
    recommended_experiments: [], used_evidence_ids: used.filter(function (v, i, a) { return v && a.indexOf(v) === i; }), _fallback: true
  };
}

// analyzeComparison(fetchFn, pkgResult, cfg) -> same result envelope as analyzeSource (analysis = synthesis obj).
function analyzeComparison(fetchFn, pkgResult, cfg) {
  cfg = cfg || {};
  var built = buildComparisonCall(pkgResult, cfg);
  var allowed = built.allowed_evidence_ids;
  var costs = [], calls = 0;
  function record(res) { calls++; costs.push(costFromUsage(res.usage, cfg)); }
  function validate(obj) { var errs = validateStructured(obj, CC_SYNTHESIS_SCHEMA).concat(validateEvidenceIds(obj, allowed)); return { ok: errs.length === 0, errors: errs }; }
  return callClaude(fetchFn, built.body, cfg).then(function (res1) {
    record(res1);
    if (!res1.ok) return finalize(deterministicComparisonFallback(pkgResult), { schema_mode: '', repair_used: false, repair_success: false, fallback_used: true, validation_errors: [res1.error_category], stop_reason: res1.stop_reason, request_id: res1.request_id, error_category: res1.error_category });
    var v1 = validate(res1.content);
    if (v1.ok) return finalize(res1.content, { schema_mode: res1.schema_mode, repair_used: false, repair_success: false, fallback_used: false, validation_errors: [], stop_reason: res1.stop_reason, request_id: res1.request_id, error_category: '' });
    var rep = buildSynthesisRepairCall(res1.content, v1.errors, allowed, cfg);
    return callClaude(fetchFn, rep.body, cfg).then(function (res2) {
      record(res2);
      if (res2.ok) { var v2 = validate(res2.content);
        if (v2.ok) return finalize(res2.content, { schema_mode: res2.schema_mode, repair_used: true, repair_success: true, fallback_used: false, validation_errors: v1.errors, stop_reason: res2.stop_reason, request_id: res2.request_id, error_category: '' });
        return finalize(deterministicComparisonFallback(pkgResult), { schema_mode: res2.schema_mode, repair_used: true, repair_success: false, fallback_used: true, validation_errors: v2.errors, stop_reason: res2.stop_reason, request_id: res2.request_id, error_category: 'validation_failed' });
      }
      return finalize(deterministicComparisonFallback(pkgResult), { schema_mode: '', repair_used: true, repair_success: false, fallback_used: true, validation_errors: [res2.error_category], stop_reason: res2.stop_reason, request_id: res2.request_id, error_category: res2.error_category });
    });
  });
  function finalize(analysis, meta) {
    var totalUsage = costs.reduce(function (a, c) { return { input_tokens: a.input_tokens + c.input_tokens, output_tokens: a.output_tokens + c.output_tokens }; }, { input_tokens: 0, output_tokens: 0 });
    return {
      ok: !meta.fallback_used, analysis: analysis, analysis_mode: 'comparison', calls: calls,
      schema_mode: meta.schema_mode || (analysis && analysis._fallback ? 'fallback' : 'tool_use'),
      repair_used: meta.repair_used, repair_success: meta.repair_success, fallback_used: meta.fallback_used,
      validation_errors: meta.validation_errors, stop_reason: meta.stop_reason, request_id: meta.request_id,
      error_category: meta.error_category, usage: totalUsage, cost_usd: sumCosts(costs),
      package_hash: (pkgResult && pkgResult.package_hash) || ''
    };
  }
}

// ============================ WIP4 mode 2: WF27 top-candidate enrichment =====================================
// A deterministic relevance gate (top 3–5) runs in WF27 BEFORE this. This classifies ONE eligible candidate from
// its bounded discovery evidence: verdict + confidence + Russian rationale + regional match. AI may EXPLAIN
// relevance; it may NOT fabricate organisation facts, and every claim cites evidence in the package. Fail-closed:
// on any failure the candidate stays 'irrelevant'/low-confidence with its discovery evidence preserved upstream.
var CA_CANDIDATE_PROMPT = [
  'You are CodeVinci AI Pilot classifying ONE discovery candidate for a secured-lending business in Moscow/MO.',
  'You get a BOUNDED evidence package for this single candidate. Rules:',
  '1. Choose exactly one verdict: competitor | lead_source | content_creator | aggregator | irrelevant — strictly',
  '   from the evidence. Do NOT invent company facts, prices, ownership or services.',
  '2. rationale_ru: short professional Russian explaining the verdict FROM the evidence. is_regional_match reflects',
  '   whether the evidence ties the candidate to Moscow/Moscow Oblast.',
  '3. evidence_ids MUST be evidence_id values present in the package. If evidence is thin, pick irrelevant/low',
  '   confidence — never upgrade to competitor without own-offer evidence.',
  'Return your result ONLY by calling the provided tool.'
].join('\n');

function deterministicCandidateFallback(pkgResult, def) {
  var ev = ((pkgResult && pkgResult.package) || {}).evidence_items || [];
  return { verdict: (def && def.verdict) || 'irrelevant', confidence: 0,
    rationale_ru: 'ИИ-оценка кандидата недоступна — оставлена консервативная классификация по доказательствам поиска.',
    is_regional_match: !!(def && def.is_regional_match), evidence_ids: ev.slice(0, 3).map(function (e) { return e.evidence_id; }), _fallback: true };
}

function enrichCandidate(fetchFn, pkgResult, cfg) {
  cfg = cfg || {};
  var pkg = (pkgResult && pkgResult.package) || {};
  var allowed = (pkgResult && pkgResult.allowed_evidence_ids) || [];
  var def = (pkgResult && pkgResult.deterministic_default) || {};
  var tool = ccCandidateTool();
  var body = buildToolRequest({ model: caStr(cfg.llm_model) || 'claude-sonnet-4-6', system: CA_CANDIDATE_PROMPT, user: renderPackagePrompt(pkg), tool: tool, max_tokens: 1024, temperature: 0.1 });
  var costs = [], calls = 0;
  function record(res) { calls++; costs.push(costFromUsage(res.usage, cfg)); }
  function validate(o) { var e = validateStructured(o, CC_CANDIDATE_SCHEMA).concat(validateEvidenceIds(o, allowed)); return { ok: e.length === 0, errors: e }; }
  return callClaude(fetchFn, body, cfg).then(function (res1) {
    record(res1);
    if (!res1.ok) return fin(deterministicCandidateFallback(pkgResult, def), { fallback_used: true, error_category: res1.error_category, request_id: res1.request_id });
    var v1 = validate(res1.content);
    if (v1.ok) return fin(res1.content, { fallback_used: false, schema_mode: res1.schema_mode, request_id: res1.request_id });
    var rtool = ccCandidateTool();
    var ruser = ['Fix ONLY the listed problems and resubmit via the tool. Use ONLY evidence_ids: [' + allowed.join(', ') + '].', 'ERRORS:', v1.errors.map(function (e) { return '- ' + e; }).join('\n'), 'PREVIOUS:', JSON.stringify(res1.content)].join('\n');
    var rbody = buildToolRequest({ model: caStr(cfg.llm_model) || 'claude-sonnet-4-6', system: CA_CANDIDATE_PROMPT, user: ruser, tool: rtool, max_tokens: 1024, temperature: 0 });
    return callClaude(fetchFn, rbody, cfg).then(function (res2) {
      record(res2);
      if (res2.ok && validate(res2.content).ok) return fin(res2.content, { fallback_used: false, repair_used: true, repair_success: true, schema_mode: res2.schema_mode, request_id: res2.request_id });
      return fin(deterministicCandidateFallback(pkgResult, def), { fallback_used: true, repair_used: true, error_category: 'validation_failed', request_id: res2.request_id });
    });
  });
  function fin(verdict, meta) {
    return { ok: !meta.fallback_used, verdict: verdict, analysis_mode: 'discovery_enrichment', calls: calls,
      repair_used: !!meta.repair_used, repair_success: !!meta.repair_success, fallback_used: !!meta.fallback_used,
      schema_mode: meta.schema_mode || (verdict && verdict._fallback ? 'fallback' : 'tool_use'), request_id: meta.request_id || '',
      error_category: meta.error_category || '', usage: costs.reduce(function (a, c) { return { input_tokens: a.input_tokens + c.input_tokens, output_tokens: a.output_tokens + c.output_tokens }; }, { input_tokens: 0, output_tokens: 0 }), cost_usd: sumCosts(costs) };
  }
}

// ============================ WIP4 mode 3: public-lead interpretation =========================================
// PUBLIC audience evidence only. Each lead separates the observed public fact from the interpretation
// (need/pain/buying-intent). No private identity inference, no contact/outreach. Low-info content stays low
// confidence. Fail-closed: an LLM failure yields an empty, honestly-limited result — never invented leads.
var CA_LEAD_PROMPT = [
  'You are CodeVinci AI Pilot interpreting PUBLIC audience signals for a secured-lending business in Moscow/MO.',
  'You get a BOUNDED package of PUBLIC posts/comments. Rules:',
  '1. Use ONLY public evidence. NEVER infer a private identity, contact detail, or suggest contacting anyone.',
  '2. For each lead separate observed_fact_ru (what the post literally says) from interpretation_ru (the inferred',
  '   need/pain/buying-intent). signal ∈ need|pain|buying_intent|none. evidence_ids MUST exist in the package.',
  '3. Low-information content (greeting, off-topic, ambiguous) → signal "none" and low confidence, or omit it.',
  '4. Never present an interpretation as a fact. If nothing qualifies, return an empty leads array and say so.',
  'Return your result ONLY by calling the provided tool.'
].join('\n');

function deterministicLeadFallback() {
  return { overview_ru: 'ИИ-интерпретация публичных сигналов недоступна — выводы не сформированы.', leads: [], limitations_ru: ['ИИ-анализ временно недоступен; интерпретация лидов не выполнена.'], used_evidence_ids: [], _fallback: true };
}

function interpretPublicLead(fetchFn, pkgResult, cfg) {
  cfg = cfg || {};
  var pkg = (pkgResult && pkgResult.package) || {};
  var allowed = (pkgResult && pkgResult.allowed_evidence_ids) || [];
  var tool = ccLeadTool();
  var body = buildToolRequest({ model: caStr(cfg.llm_model) || 'claude-sonnet-4-6', system: CA_LEAD_PROMPT, user: renderPackagePrompt(pkg), tool: tool, max_tokens: 2048, temperature: 0.2 });
  var costs = [], calls = 0;
  function record(res) { calls++; costs.push(costFromUsage(res.usage, cfg)); }
  function validate(o) { var e = validateStructured(o, CC_LEAD_SCHEMA).concat(validateEvidenceIds(o, allowed)); return { ok: e.length === 0, errors: e }; }
  return callClaude(fetchFn, body, cfg).then(function (res1) {
    record(res1);
    if (!res1.ok) return fin(deterministicLeadFallback(), { fallback_used: true, error_category: res1.error_category, request_id: res1.request_id });
    var v1 = validate(res1.content);
    if (v1.ok) return fin(res1.content, { fallback_used: false, schema_mode: res1.schema_mode, request_id: res1.request_id });
    var ruser = ['Fix ONLY the listed problems and resubmit via the tool. Use ONLY evidence_ids: [' + allowed.join(', ') + '].', 'ERRORS:', v1.errors.map(function (e) { return '- ' + e; }).join('\n'), 'PREVIOUS:', JSON.stringify(res1.content)].join('\n');
    var rbody = buildToolRequest({ model: caStr(cfg.llm_model) || 'claude-sonnet-4-6', system: CA_LEAD_PROMPT, user: ruser, tool: ccLeadTool(), max_tokens: 2048, temperature: 0 });
    return callClaude(fetchFn, rbody, cfg).then(function (res2) {
      record(res2);
      if (res2.ok && validate(res2.content).ok) return fin(res2.content, { fallback_used: false, repair_used: true, repair_success: true, schema_mode: res2.schema_mode, request_id: res2.request_id });
      return fin(deterministicLeadFallback(), { fallback_used: true, repair_used: true, error_category: 'validation_failed', request_id: res2.request_id });
    });
  });
  function fin(leads, meta) {
    return { ok: !meta.fallback_used, analysis: leads, analysis_mode: 'public_lead', calls: calls,
      repair_used: !!meta.repair_used, repair_success: !!meta.repair_success, fallback_used: !!meta.fallback_used,
      schema_mode: meta.schema_mode || (leads && leads._fallback ? 'fallback' : 'tool_use'), request_id: meta.request_id || '',
      error_category: meta.error_category || '', usage: costs.reduce(function (a, c) { return { input_tokens: a.input_tokens + c.input_tokens, output_tokens: a.output_tokens + c.output_tokens }; }, { input_tokens: 0, output_tokens: 0 }), cost_usd: sumCosts(costs) };
  }
}

module.exports = {
  CA_SYSTEM_PROMPT, buildSourceAnalysisCall, validateAnalysisResult, buildRepairCall,
  deterministicAnalysisFallback, analyzeSource,
  CA_SYNTHESIS_PROMPT, buildComparisonCall, buildSynthesisRepairCall, deterministicComparisonFallback, analyzeComparison,
  CA_CANDIDATE_PROMPT, deterministicCandidateFallback, enrichCandidate,
  CA_LEAD_PROMPT, deterministicLeadFallback, interpretPublicLead
};
