'use strict';
// test_wf28_coercion_nodes.js — TOOLUSE-COERCE-002.
//
// Session 70 fixed the coercion in the LIBRARY but WF28's own Code nodes threw the coerced value away:
//   Parse Primary : `var v=validateAnalysisResult(res.content,...); if(v.ok){ out.analysis=res.content; }`
//   Parse Repair  : same shape.
// validateAnalysisResult normalizes INTERNALLY and returns v.value, so validation passed on the coerced object
// while the RAW object (items still a JSON string) was the one persisted, rendered and cached. The session-70
// live proof (WF28 exec 1268) only passed because that run happened not to need coercion — the transport quirk
// is intermittent. A run that DID need it would have stored a broken analysis: strictly worse than the fallback,
// because it would be marked enriched=true.
//
// This suite runs the REAL generated WF28 Code-node source (not a re-implementation) against a response whose
// `items` is a JSON string, and asserts the node hands on a real array plus the coercion telemetry.
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WF = path.join(__dirname, '..', 'n8n', 'workflows', '28_claude_analyst.json');
let wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
if (Array.isArray(wf)) wf = wf[0];
const nodeCode = (name) => {
  const n = (wf.nodes || []).find((x) => x.name === name);
  if (!n) throw new Error('missing node: ' + name);
  return n.parameters.jsCode;
};

const ITEMS = [
  { dimension: 'positioning', kind: 'fact', text_ru: 'Ценовой якорь от 2,4%/мес.', evidence_ids: ['ev_1'] },
  { dimension: 'offers', kind: 'fact', text_ru: 'Займы под залог авто и ПТС.', evidence_ids: ['ev_2'] }
];
const GOOD = {
  executive_summary_ru: 'Залог 24 — брокер залогового кредитования.',
  items: ITEMS,
  recommended_actions: [{ text_ru: 'Проверить комиссии', priority: 'medium', evidence_ids: ['ev_1'] }],
  unknowns_ru: ['нет отзывов'], overall_confidence: 60, used_evidence_ids: ['ev_1', 'ev_2']
};
const prep = {
  ctx: { model: 'claude-sonnet-4-6', analysis_type: 'source_analysis', evidence_package_hash: 'b9a57e3a' },
  allowed_ids: ['ev_1', 'ev_2'],
  pkg: { package: { evidence_items: [{ evidence_id: 'ev_1', source_url: 'https://zalog24h.ru/' }, { evidence_id: 'ev_2', source_url: 'https://zalog24h.ru/pts' }] }, allowed_evidence_ids: ['ev_1', 'ev_2'], package_hash: 'b9a57e3a' },
  mode: 'call'
};
// The wire shape that broke production: a complete analysis whose items arrived JSON-encoded.
const wireStringItems = Object.assign({}, GOOD, { items: JSON.stringify(ITEMS) });

function claudeHttp(input) {
  return { statusCode: 200, body: { id: 'msg_1', model: 'claude-sonnet-4-6', stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'submit_analysis', input: input }],
    usage: { input_tokens: 2696, output_tokens: 529 } }, headers: {} };
}

// Minimal n8n Code-node harness: $json is the incoming item, $('Node') returns a prior node's output.
function runNode(code, $json, priorByName) {
  const sandbox = {
    $json: $json,
    $: (name) => ({ first: () => ({ json: priorByName[name] }) }),
    console: { log: () => {} },
    Date: Date, JSON: JSON, Math: Math, String: String, Number: Number, Object: Object, Array: Array,
    isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, RegExp: RegExp, Error: Error
  };
  sandbox.global = sandbox;
  const res = vm.runInNewContext('(function(){' + code + '})()', sandbox, { timeout: 20000 });
  return res[0].json;
}

A.section('WF28 Parse Primary — a string-encoded items array is coerced and KEPT');
{
  const out = runNode(nodeCode('Parse Primary'), claudeHttp(wireStringItems), { 'Prepare Analysis': prep });
  A.eq('status is valid (no repair triggered)', out.status, 'valid');
  A.ok('analysis handed on', !!out.analysis);
  A.ok('items is a REAL array, not the raw string', Array.isArray(out.analysis.items));
  A.eq('both items preserved', out.analysis.items.length, 2);
  A.eq('content unchanged', out.analysis.items[0].text_ru, ITEMS[0].text_ru);
  A.eq('evidence ids preserved', out.analysis.items[1].evidence_ids.join(','), 'ev_2');
  A.eq('coercion recorded as telemetry', (out.coerced_paths || []).join(','), '$.items');
  A.ok('no repair body built', !out.claude_body);
}

A.section('WF28 Parse Primary — well-formed payload is unchanged (no regression)');
{
  const out = runNode(nodeCode('Parse Primary'), claudeHttp(GOOD), { 'Prepare Analysis': prep });
  A.eq('status valid', out.status, 'valid');
  A.eq('items intact', out.analysis.items.length, 2);
  A.eq('no coercion recorded', (out.coerced_paths || []).length, 0);
}

A.section('WF28 Parse Primary — genuinely malformed payload still routes to repair');
{
  const bad = Object.assign({}, GOOD, { items: 'просто текст, не JSON' });
  const out = runNode(nodeCode('Parse Primary'), claudeHttp(bad), { 'Prepare Analysis': prep });
  A.eq('status repair', out.status, 'repair');
  A.ok('validation errors present', (out.errors || []).length > 0);
  A.ok('repair body built', !!out.claude_body);
  A.eq('nothing coerced', (out.coerced_paths || []).length, 0);
}

A.section('WF28 Parse Repair — coerced repair result is KEPT');
{
  const pp = runNode(nodeCode('Parse Primary'), claudeHttp(Object.assign({}, GOOD, { items: 'не json' })), { 'Prepare Analysis': prep });
  A.eq('primary asked for repair', pp.status, 'repair');
  const out = runNode(nodeCode('Parse Repair'), claudeHttp(wireStringItems), { 'Parse Primary': pp });
  A.eq('status repaired', out.status, 'repaired');
  A.ok('repair_success', out.repair_success);
  A.ok('items is a REAL array after repair', Array.isArray(out.analysis.items));
  A.eq('items preserved through repair', out.analysis.items.length, 2);
  A.eq('coercion recorded on the repair path', (out.coerced_paths || []).join(','), '$.items');
}

A.section('WF28 Finalize Analysis — coerced_paths reaches the typed return');
{
  const pp = runNode(nodeCode('Parse Primary'), claudeHttp(wireStringItems), { 'Prepare Analysis': prep });
  const fin = runNode(nodeCode('Finalize Analysis'), {}, { 'Prepare Analysis': prep, 'Parse Primary': pp });
  const tr = fin.typed_return;
  A.ok('typed return produced', !!tr);
  A.ok('enriched', tr.enriched);
  A.ok('items array survives into the typed return', Array.isArray(tr.analysis.items));
  A.eq('items count', tr.analysis.items.length, 2);
  A.eq('coerced_paths forwarded downstream', (tr.coerced_paths || []).join(','), '$.items');
  A.ok('persisted', fin.persist);
  A.ok('result row carries the coerced analysis', String(fin.result_row.structured_result_json).indexOf('"items":[') > 0);
}

A.report('wf28-coercion-nodes');
