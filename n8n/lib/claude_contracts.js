'use strict';
// claude_contracts.js — versioned structured-output schemas + tool definitions + local validators for Stage F.
// English keys/enums internally (the model reasons in English structure); user-facing narrative fields are Russian
// (suffixed _ru). Every analytical item carries kind ∈ {fact,inference,recommendation} and evidence_ids so the
// renderer can separate «Подтверждённые факты» / «Аналитические выводы» / «Рекомендации» and every claim is
// grounded. Validators are a pragmatic JSON-schema subset (required/type/enum/range/array-items) — enough to gate
// the tool_use output locally so the ONLY reason to repair is a real schema/evidence violation.
// Embeddable: unique cc*-prefixed names, no cross-lib require.

var CC_SCHEMA_VERSION = 'stageF.analysis.v1';
var CC_PROMPT_VERSION = 'stageF.prompt.v1';

var CC_DIMENSIONS = ['positioning', 'products_services', 'offers', 'prices_terms', 'cta_touchpoints',
  'target_audience', 'pains', 'objections', 'advertising_angles', 'content_angles', 'strengths', 'weaknesses',
  'trust_signals', 'market_gaps', 'risks'];
var CC_KINDS = ['fact', 'inference', 'recommendation'];
var CC_PRIORITIES = ['high', 'medium', 'low'];
var CC_CANDIDATE_VERDICTS = ['competitor', 'lead_source', 'content_creator', 'aggregator', 'irrelevant'];

// ---- single-source analysis (website / telegram / vk) -------------------------------------------------------
var CC_ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['executive_summary_ru', 'items', 'recommended_actions', 'unknowns_ru', 'overall_confidence', 'used_evidence_ids'],
  properties: {
    executive_summary_ru: { type: 'string' },
    items: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['dimension', 'kind', 'text_ru', 'evidence_ids'],
      properties: {
        dimension: { type: 'string', enum: CC_DIMENSIONS },
        kind: { type: 'string', enum: CC_KINDS },
        text_ru: { type: 'string' },
        evidence_ids: { type: 'array', items: { type: 'string' } }
      } } },
    recommended_actions: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['text_ru', 'priority', 'evidence_ids'],
      properties: {
        text_ru: { type: 'string' }, priority: { type: 'string', enum: CC_PRIORITIES },
        evidence_ids: { type: 'array', items: { type: 'string' } }
      } } },
    unknowns_ru: { type: 'array', items: { type: 'string' } },
    overall_confidence: { type: 'integer', minimum: 0, maximum: 100 },
    used_evidence_ids: { type: 'array', items: { type: 'string' } }
  }
};
function ccAnalysisTool() {
  return { name: 'submit_analysis', description: 'Submit the complete evidence-bound competitor analysis. Every item must cite evidence_ids that exist in the package. Narrative fields (text_ru, *_ru) are Russian; do not invent facts.', input_schema: CC_ANALYSIS_SCHEMA };
}

// ---- discovery candidate enrichment -------------------------------------------------------------------------
var CC_CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'confidence', 'rationale_ru', 'is_regional_match', 'evidence_ids'],
  properties: {
    verdict: { type: 'string', enum: CC_CANDIDATE_VERDICTS },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    rationale_ru: { type: 'string' },
    is_regional_match: { type: 'boolean' },
    service_hint_ru: { type: 'string' },
    evidence_ids: { type: 'array', items: { type: 'string' } }
  }
};
function ccCandidateTool() {
  return { name: 'submit_candidate_verdict', description: 'Classify one discovery candidate strictly from its evidence. verdict is the competitor/lead/content/aggregator/irrelevant call; rationale_ru is a short Russian justification; evidence_ids must exist in the package.', input_schema: CC_CANDIDATE_SCHEMA };
}

// ---- multi-source synthesis ---------------------------------------------------------------------------------
var CC_SYNTHESIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overview_ru', 'comparisons', 'recurring_pains_ru', 'opportunities', 'recommended_experiments', 'used_evidence_ids'],
  properties: {
    overview_ru: { type: 'string' },
    comparisons: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['aspect', 'text_ru', 'evidence_ids'],
      properties: {
        aspect: { type: 'string', enum: ['positioning', 'offers', 'prices', 'cta', 'strengths', 'weaknesses', 'audience'] },
        text_ru: { type: 'string' }, evidence_ids: { type: 'array', items: { type: 'string' } } } } },
    recurring_pains_ru: { type: 'array', items: { type: 'string' } },
    opportunities: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['text_ru', 'evidence_ids'],
      properties: { text_ru: { type: 'string' }, evidence_ids: { type: 'array', items: { type: 'string' } } } } },
    recommended_experiments: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['text_ru', 'priority'],
      properties: { text_ru: { type: 'string' }, priority: { type: 'string', enum: CC_PRIORITIES }, evidence_ids: { type: 'array', items: { type: 'string' } } } } },
    used_evidence_ids: { type: 'array', items: { type: 'string' } }
  }
};
function ccSynthesisTool() {
  return { name: 'submit_synthesis', description: 'Submit the cross-competitor synthesis. Every comparison/opportunity cites evidence_ids from the package. Russian narrative; no invented facts.', input_schema: CC_SYNTHESIS_SCHEMA };
}

// ---- public-lead interpretation (WIP4 mode 3) ---------------------------------------------------------------
// PUBLIC audience/lead evidence only. Each lead separates the OBSERVED public fact from the INTERPRETATION
// (need/pain/buying-intent), is evidence-bound, and carries confidence. No private identity inference, no contact.
var CC_LEAD_SIGNALS = ['need', 'pain', 'buying_intent', 'none'];
var CC_LEAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overview_ru', 'leads', 'limitations_ru', 'used_evidence_ids'],
  properties: {
    overview_ru: { type: 'string' },
    leads: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['observed_fact_ru', 'interpretation_ru', 'signal', 'confidence', 'evidence_ids'],
      properties: {
        observed_fact_ru: { type: 'string' },          // what the public post literally says
        interpretation_ru: { type: 'string' },          // inferred need/pain/buying-intent (NOT a fact)
        signal: { type: 'string', enum: CC_LEAD_SIGNALS },
        confidence: { type: 'integer', minimum: 0, maximum: 100 },
        evidence_ids: { type: 'array', items: { type: 'string' } }
      } } },
    limitations_ru: { type: 'array', items: { type: 'string' } },
    used_evidence_ids: { type: 'array', items: { type: 'string' } }
  }
};
function ccLeadTool() {
  return { name: 'submit_public_leads', description: 'Interpret PUBLIC audience evidence only. Separate observed_fact_ru (literal public text) from interpretation_ru (inferred need/pain/buying-intent). Cite evidence_ids. Never infer private identity, never suggest contacting a person.', input_schema: CC_LEAD_SCHEMA };
}

// ---- local validator (pragmatic JSON-schema subset) ---------------------------------------------------------
function ccTypeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number') return (Math.floor(v) === v ? 'integer' : 'number');
  return typeof v; // 'string' | 'boolean' | 'object' | 'undefined'
}
// validateStructured(obj, schema) -> array of error strings (empty = valid).
function validateStructured(obj, schema, path) {
  path = path || '$';
  var errs = [];
  if (!schema || typeof schema !== 'object') return errs;
  var t = schema.type;
  if (t) {
    var at = ccTypeOf(obj);
    var ok = (t === at) || (t === 'number' && at === 'integer') || (t === 'string' && at === 'string');
    if (!ok) { errs.push(path + ': expected ' + t + ', got ' + at); return errs; }
  }
  if (t === 'integer' || t === 'number') {
    if (schema.minimum != null && obj < schema.minimum) errs.push(path + ': below minimum ' + schema.minimum);
    if (schema.maximum != null && obj > schema.maximum) errs.push(path + ': above maximum ' + schema.maximum);
  }
  if (t === 'string' && schema.enum && schema.enum.indexOf(obj) < 0) errs.push(path + ': "' + obj + '" not in enum [' + schema.enum.join(',') + ']');
  if (t === 'object') {
    var props = schema.properties || {};
    (schema.required || []).forEach(function (k) { if (obj == null || obj[k] === undefined) errs.push(path + ': missing required "' + k + '"'); });
    if (schema.additionalProperties === false && obj) {
      Object.keys(obj).forEach(function (k) { if (!props[k]) errs.push(path + ': unexpected property "' + k + '"'); });
    }
    if (obj) Object.keys(props).forEach(function (k) { if (obj[k] !== undefined) errs = errs.concat(validateStructured(obj[k], props[k], path + '.' + k)); });
  }
  if (t === 'array' && Array.isArray(obj) && schema.items) {
    obj.forEach(function (it, i) { errs = errs.concat(validateStructured(it, schema.items, path + '[' + i + ']')); });
  }
  return errs;
}

// Collect every evidence_ids / used_evidence_ids value anywhere in the object and check membership in allowedIds.
function collectEvidenceIds(obj, acc) {
  acc = acc || [];
  if (Array.isArray(obj)) { obj.forEach(function (x) { collectEvidenceIds(x, acc); }); return acc; }
  if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach(function (k) {
      if ((k === 'evidence_ids' || k === 'used_evidence_ids' || k === 'supporting_evidence_ids') && Array.isArray(obj[k])) {
        obj[k].forEach(function (id) { acc.push(String(id)); });
      } else collectEvidenceIds(obj[k], acc);
    });
  }
  return acc;
}
// validateEvidenceIds(obj, allowedIds) -> array of error strings for any cited id not in allowedIds.
function validateEvidenceIds(obj, allowedIds) {
  var allow = {}; (allowedIds || []).forEach(function (id) { allow[String(id)] = true; });
  var cited = collectEvidenceIds(obj, []);
  var bad = {};
  cited.forEach(function (id) { if (!allow[id]) bad[id] = true; });
  return Object.keys(bad).map(function (id) { return 'evidence_id "' + id + '" is not in the allowed evidence set'; });
}

module.exports = {
  CC_SCHEMA_VERSION, CC_PROMPT_VERSION, CC_DIMENSIONS, CC_KINDS, CC_PRIORITIES, CC_CANDIDATE_VERDICTS,
  CC_ANALYSIS_SCHEMA, CC_CANDIDATE_SCHEMA, CC_SYNTHESIS_SCHEMA, CC_LEAD_SCHEMA, CC_LEAD_SIGNALS,
  ccAnalysisTool, ccCandidateTool, ccSynthesisTool, ccLeadTool,
  validateStructured, validateEvidenceIds, collectEvidenceIds
};
