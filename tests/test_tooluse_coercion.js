'use strict';
// test_tooluse_coercion.js — TOOLUSE-COERCE-001.
//
// Production defect (WF28 exec 1252, req_76722084, zalog24h.ru, 2026-07-22): the gateway's tool_use transport
// returned a COMPLETE, correct, fully evidence-cited analysis whose `items` parameter was serialized as a JSON
// STRING instead of an array. validateStructured rejected it ("$.items: expected array, got string"), a bounded
// repair was billed and came back the same way, and the run fell through to the deterministic fallback: the user
// paid for two real provider calls (12217 in / 651 out, $0.0464) and received no AI analysis.
//
// Contract proven here: a string that parses to the schema-expected container is coerced BEFORE validation and
// the coerced value is what flows downstream; a string that does not parse, or parses to the wrong type, is left
// alone so the payload still fails honestly and reaches repair/fallback. Pure/offline, injected fetchFn, $0.
const A = require('./_assert.js');
const CA = require('../n8n/lib/claude_analysis.js');
const CC = require('../n8n/lib/claude_contracts.js');

const pkgResult = {
  package: {
    analysis_request: { agent_request_id: 'req_76722084', niche: 'credit_brokerage', region: 'Москва/МО' },
    source_identity: { source_id: 'zalog24h.ru', kind: 'website', quality_status: 'accepted' },
    current_run_facts: { company_name: 'Залог 24', positioning: 'ценовой якорь от 2,4%/мес', offer_summary: 'займы под ПТС' },
    evidence_items: [
      { evidence_id: 'ev_1', source_url: 'https://zalog24h.ru/', excerpt: 'от 2,4% в месяц' },
      { evidence_id: 'ev_2', source_url: 'https://zalog24h.ru/pts', excerpt: 'до 90% от рыночной стоимости' }
    ]
  },
  allowed_evidence_ids: ['ev_1', 'ev_2'], package_hash: 'b9a57e3a'
};

// The exact analysis shape the model returned live, with items as a real array.
const ITEMS = [
  { dimension: 'positioning', kind: 'fact', text_ru: 'Выраженный ценовой якорь: от 2,4 %/мес. (авто), от 2,9 %/мес. (ПТС).', evidence_ids: ['ev_1'] },
  { dimension: 'products_services', kind: 'fact', text_ru: 'Займы под залог авто и ПТС, одобрение за 5 минут, до 5 лет.', evidence_ids: ['ev_2'] },
  { dimension: 'prices_terms', kind: 'inference', text_ru: 'Ставка ниже среднерыночной для сегмента.', evidence_ids: ['ev_1', 'ev_2'] }
];
const GOOD = {
  executive_summary_ru: 'Залог 24 — московский брокер залогового кредитования с выраженным ценовым якорем.',
  items: ITEMS,
  recommended_actions: [{ text_ru: 'Проверить прозрачность комиссий', priority: 'medium', evidence_ids: ['ev_1'] }],
  unknowns_ru: ['Нет независимых отзывов'],
  overall_confidence: 70,
  used_evidence_ids: ['ev_1', 'ev_2']
};
// The SAME payload as it actually arrived on the wire: nested containers JSON-encoded as strings.
function stringified(obj, keys) {
  const out = Object.assign({}, obj);
  keys.forEach((k) => { out[k] = JSON.stringify(obj[k]); });
  return out;
}

function toolResponse(input) {
  return { status: 200, latency_ms: 98982, headers: { 'x-request-id': 'rq_1' },
    body: { id: 'msg_1', model: 'claude-sonnet-4-6', stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'submit_analysis', input: input }],
      usage: { input_tokens: 2696, output_tokens: 529 } } };
}
const cfg = { llm_model: 'claude-sonnet-4-6' };

A.section('ccNormalizeStructured — unit contract');
{
  const schema = CC.CC_ANALYSIS_SCHEMA;
  const n1 = CC.ccNormalizeStructured(JSON.parse(JSON.stringify(stringified(GOOD, ['items']))), schema);
  A.ok('string array coerced to array', Array.isArray(n1.value.items));
  A.eq('all items preserved', n1.value.items.length, 3);
  A.eq('coercion path recorded', n1.coerced.join(','), '$.items');
  A.eq('content unchanged', n1.value.items[0].text_ru, ITEMS[0].text_ru);

  const n2 = CC.ccNormalizeStructured(JSON.parse(JSON.stringify(stringified(GOOD, ['items', 'used_evidence_ids', 'unknowns_ru']))), schema);
  A.eq('multiple containers coerced', n2.coerced.length, 3);
  A.ok('used_evidence_ids is array', Array.isArray(n2.value.used_evidence_ids));

  // Non-JSON string must NOT be touched — validation has to fail honestly.
  const bad = Object.assign({}, GOOD, { items: 'не массив, а просто текст' });
  const n3 = CC.ccNormalizeStructured(bad, schema);
  A.eq('non-JSON string left untouched', typeof n3.value.items, 'string');
  A.eq('no coercion recorded', n3.coerced.length, 0);
  A.ok('validator still rejects it', CC.validateStructured(n3.value, schema).length > 0);

  // A string parsing to the WRONG type must not be accepted.
  const wrong = Object.assign({}, GOOD, { items: '{"a":1}' });
  const n4 = CC.ccNormalizeStructured(wrong, schema);
  A.eq('object-for-array not coerced', typeof n4.value.items, 'string');
  A.ok('validator rejects wrong-type payload', CC.validateStructured(n4.value, schema).length > 0);

  // Already-correct payloads must be untouched and still valid.
  const n5 = CC.ccNormalizeStructured(JSON.parse(JSON.stringify(GOOD)), schema);
  A.eq('well-formed payload needs no coercion', n5.coerced.length, 0);
  A.eq('well-formed payload stays valid', CC.validateStructured(n5.value, schema).length, 0);
}

A.section('analyzeSource — the live zalog24h regression: string items => accepted, no repair, no fallback');
let calls = 0;
const fetchStringItems = () => { calls++; return Promise.resolve(toolResponse(stringified(GOOD, ['items']))); };
CA.analyzeSource(fetchStringItems, pkgResult, cfg).then((r) => {
  A.ok('analysis accepted (ok)', r.ok);
  A.ok('NOT a fallback', !r.fallback_used);
  A.ok('NO repair call billed', !r.repair_used);
  A.eq('exactly ONE provider call', r.calls, 1);
  A.eq('exactly one fetch', calls, 1);
  A.ok('items is a real array downstream', Array.isArray(r.analysis.items));
  A.eq('all 3 items survive into the persisted analysis', r.analysis.items.length, 3);
  A.ok('real summary, not the fallback wording', r.analysis.executive_summary_ru.indexOf('ИИ-анализ недоступен') < 0);
  A.ok('no _fallback marker', !r.analysis._fallback);
  A.eq('coercion surfaced as telemetry', (r.coerced_paths || []).join(','), '$.items');
  A.eq('evidence ids preserved', r.analysis.items[0].evidence_ids.join(','), 'ev_1');

  A.section('analyzeSource — genuinely malformed payload still fails closed');
  let c2 = 0;
  const fetchBad = () => { c2++; return Promise.resolve(toolResponse(Object.assign({}, GOOD, { items: 'просто текст' }))); };
  return CA.analyzeSource(fetchBad, pkgResult, cfg).then((r2) => {
    A.ok('malformed => repair attempted', r2.repair_used);
    A.eq('exactly two calls (primary + one repair)', r2.calls, 2);
    A.ok('malformed twice => deterministic fallback', r2.fallback_used);
    A.ok('fallback marker present', !!r2.analysis._fallback);

    A.section('analyzeSource — well-formed payload unchanged (no regression)');
    let c3 = 0;
    const fetchGood = () => { c3++; return Promise.resolve(toolResponse(GOOD)); };
    return CA.analyzeSource(fetchGood, pkgResult, cfg).then((r3) => {
      A.ok('well-formed accepted', r3.ok);
      A.ok('no repair', !r3.repair_used);
      A.eq('one call', r3.calls, 1);
      A.eq('no coercion needed', (r3.coerced_paths || []).length, 0);
      A.eq('items intact', r3.analysis.items.length, 3);
      A.report('tooluse-coercion');
    });
  });
}).catch((e) => { A.ok('no exception: ' + e.message, false); A.report('tooluse-coercion'); });
