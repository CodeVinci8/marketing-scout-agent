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

// ---- purity + all-four-mode primary/repair coverage -------------------------------------------------------
A.section('ccNormalizeStructured is PURE (a shared payload can be normalized twice)');
{
  const wire = Object.assign({}, GOOD, { items: JSON.stringify(ITEMS) });
  const a1 = CC.ccNormalizeStructured(wire, CC.CC_ANALYSIS_SCHEMA);
  const a2 = CC.ccNormalizeStructured(wire, CC.CC_ANALYSIS_SCHEMA);
  A.eq('input untouched by the first pass', typeof wire.items, 'string');
  A.eq('first pass coerces', a1.coerced.join(','), '$.items');
  A.eq('second pass coerces identically (not a no-op)', a2.coerced.join(','), '$.items');
  A.ok('both produce arrays', Array.isArray(a1.value.items) && Array.isArray(a2.value.items));
}

A.section('all four modes — primary AND repair payloads with string-encoded containers');
{
  const mk = (name, input, usage) => ({ status: 200, latency_ms: 1000, headers: {},
    body: { id: 'm', model: 'claude-sonnet-4-6', stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: name, input: input }],
      usage: usage || { input_tokens: 100, output_tokens: 20 } } });

  // --- comparison / synthesis ---
  const cmpPkg = { package: { analysis_request: { agent_request_id: 'r' }, sources: [
      { source_id: 'a.ru', evidence_ids: ['ev_1'] }, { source_id: 'b.ru', evidence_ids: ['ev_2'] }],
      evidence_items: [{ evidence_id: 'ev_1', source_url: 'https://a.ru' }, { evidence_id: 'ev_2', source_url: 'https://b.ru' }] },
    allowed_evidence_ids: ['ev_1', 'ev_2'], package_hash: 'h' };
  const CMP = { overview_ru: 'Два источника сравнимы.',
    comparisons: [{ aspect: 'prices', text_ru: 'Ставки различаются.', evidence_ids: ['ev_1', 'ev_2'] }],
    recurring_pains_ru: ['ставка'], opportunities: [{ text_ru: 'калькулятор', evidence_ids: ['ev_1'] }],
    recommended_experiments: [{ text_ru: 'A/B', priority: 'medium', evidence_ids: ['ev_2'] }],
    used_evidence_ids: ['ev_1', 'ev_2'] };
  const cmpWire = Object.assign({}, CMP, { comparisons: JSON.stringify(CMP.comparisons), used_evidence_ids: JSON.stringify(CMP.used_evidence_ids) });

  // --- candidate ---
  const candPkg = { package: { analysis_request: {}, evidence_items: [{ evidence_id: 'ev_1', source_url: 'https://c.ru' }] },
    allowed_evidence_ids: ['ev_1'], package_hash: 'h2' };
  const CAND = { verdict: 'competitor', confidence: 70, rationale_ru: 'Профиль совпадает.', is_regional_match: true, evidence_ids: ['ev_1'] };
  const candWire = Object.assign({}, CAND, { evidence_ids: JSON.stringify(CAND.evidence_ids) });

  // --- public lead ---
  const leadPkg = { package: { analysis_request: {}, evidence_items: [{ evidence_id: 'ev_1', source_url: 'https://t.me/x/1' }] },
    allowed_evidence_ids: ['ev_1'], package_hash: 'h3' };
  const LEAD = { overview_ru: 'Публичные сигналы спроса.',
    leads: [{ observed_fact_ru: 'Ищет займ под ПТС.', interpretation_ru: 'Возможная потребность.', signal: 'need', confidence: 55, evidence_ids: ['ev_1'] }],
    limitations_ru: ['только публичные данные'], used_evidence_ids: ['ev_1'] };
  const leadWire = Object.assign({}, LEAD, { leads: JSON.stringify(LEAD.leads) });

  // PRIMARY path: one call, no repair, container coerced, value kept.
  return CA.analyzeComparison(() => Promise.resolve(mk('submit_synthesis', cmpWire)), cmpPkg, cfg).then((rc) => {
    A.ok('comparison primary ok', rc.ok);
    A.ok('comparison no repair', !rc.repair_used);
    A.eq('comparison one call', rc.calls, 1);
    A.ok('comparisons is an array', Array.isArray(rc.analysis.comparisons));
    A.eq('comparison coerced_paths surfaced', (rc.coerced_paths || []).length, 2);

    return CA.enrichCandidate(() => Promise.resolve(mk('submit_candidate', candWire)), candPkg, cfg).then((rk) => {
      A.ok('candidate primary ok', rk.ok);
      A.ok('candidate no repair', !rk.repair_used);
      A.ok('evidence_ids is an array', Array.isArray(rk.verdict.evidence_ids));
      A.eq('candidate coerced_paths surfaced', (rk.coerced_paths || []).join(','), '$.evidence_ids');

      return CA.interpretPublicLead(() => Promise.resolve(mk('submit_public_leads', leadWire)), leadPkg, cfg).then((rl) => {
        A.ok('lead primary ok', rl.ok);
        A.ok('leads is an array', Array.isArray(rl.analysis.leads));
        A.eq('lead coerced_paths surfaced', (rl.coerced_paths || []).join(','), '$.leads');

        // REPAIR path for each mode: primary is unrecoverable, repair returns a string-encoded container.
        const twoStep = (bad, good, name) => { let n = 0; return () => Promise.resolve(mk(name, (n++ === 0) ? bad : good)); };
        const cmpBad = Object.assign({}, CMP, { comparisons: 'не json' });
        return CA.analyzeComparison(twoStep(cmpBad, cmpWire, 'submit_synthesis'), cmpPkg, cfg).then((rc2) => {
          A.ok('comparison repair succeeded', rc2.ok && rc2.repair_used && rc2.repair_success);
          A.eq('comparison exactly two calls', rc2.calls, 2);
          A.ok('comparison repair value coerced', Array.isArray(rc2.analysis.comparisons));
          A.ok('comparison repair coercion surfaced', (rc2.coerced_paths || []).length > 0);

          const candBad = Object.assign({}, CAND, { evidence_ids: 'не json' });
          return CA.enrichCandidate(twoStep(candBad, candWire, 'submit_candidate'), candPkg, cfg).then((rk2) => {
            A.ok('candidate repair succeeded', rk2.ok && rk2.repair_used && rk2.repair_success);
            A.eq('candidate exactly two calls', rk2.calls, 2);
            A.ok('candidate repair value coerced', Array.isArray(rk2.verdict.evidence_ids));
            A.ok('candidate repair coercion surfaced', (rk2.coerced_paths || []).length > 0);

            const leadBad = Object.assign({}, LEAD, { leads: 'не json' });
            return CA.interpretPublicLead(twoStep(leadBad, leadWire, 'submit_public_leads'), leadPkg, cfg).then((rl2) => {
              A.ok('lead repair succeeded', rl2.ok && rl2.repair_used && rl2.repair_success);
              A.eq('lead exactly two calls', rl2.calls, 2);
              A.ok('lead repair value coerced', Array.isArray(rl2.analysis.leads));
              A.ok('lead repair coercion surfaced', (rl2.coerced_paths || []).length > 0);
              A.report('tooluse-coercion');
            });
          });
        });
      });
    });
  });
}

    });
  });
}).catch((e) => { A.ok('no exception: ' + e.message, false); A.report('tooluse-coercion'); });
