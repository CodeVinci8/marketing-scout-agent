'use strict';
// test_synthesis_analysis.js — WIP4 mode 1: analyzeComparison over >=3 sources. Pure/offline, injected fetchFn, $0.
const A = require('./_assert.js');
const CA = require('../n8n/lib/claude_analysis.js');

function synthResponse(input) {
  return { status: 200, latency_ms: 20000, headers: { 'x-request-id': 'rq_s' },
    body: { id: 'msg_s', model: 'claude-sonnet-4-6', stop_reason: 'tool_use',
      content: [{ type: 'thinking', thinking: '…' }, { type: 'tool_use', name: 'submit_synthesis', input: input }],
      usage: { input_tokens: 3000, output_tokens: 500 } } };
}
function errResponse(status) { return { status: status, latency_ms: 200, headers: {}, body: { type: 'error', error: { type: 'x', message: 'boom' } } }; }
function textResponse(t) { return { status: 200, latency_ms: 100, headers: {}, body: { id: 'm', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage: { input_tokens: 100, output_tokens: 10 } } }; }

// A 3-source bounded package (source-level facts stay separately traceable via each source's evidence_ids).
const pkgResult = {
  package: {
    analysis_request: { agent_request_id: 'req_cmp', niche: 'credit_brokerage', region: 'Москва/МО' },
    sources: [
      { source_id: 't.me/rusmicrofinance', source_name: 'rusmicrofinance', positioning: 'отраслевая аналитика МФО', evidence_ids: ['ev_1'] },
      { source_id: 't.me/probonds', source_name: 'probonds', positioning: 'облигации и макро', evidence_ids: ['ev_2'] },
      { source_id: 'autolombardn1.ru', source_name: 'Автоломбандн1', offer_summary: 'займы под ПТС до 90%', prices_terms: 'от 3% в месяц', evidence_ids: ['ev_3'] }
    ],
    evidence_items: [
      { evidence_id: 'ev_1', source_url: 'https://t.me/rusmicrofinance/6179', excerpt: 'ренкинг МФО ЦБ' },
      { evidence_id: 'ev_2', source_url: 'https://t.me/probonds/1', excerpt: 'доходности облигаций' },
      { evidence_id: 'ev_3', source_url: 'https://autolombardn1.ru/', excerpt: 'займ под ПТС до 90%, ставка от 3%' }
    ]
  },
  allowed_evidence_ids: ['ev_1', 'ev_2', 'ev_3'], package_hash: 'h_cmp'
};
const validSynth = {
  overview_ru: 'Три источника: два публичных (МФО-аналитика, облигации) и один автоломбард с офферами.',
  comparisons: [
    { aspect: 'positioning', text_ru: 'rusmicrofinance и probonds — публичные источники; автоломбард — коммерческий оффер.', evidence_ids: ['ev_1', 'ev_2', 'ev_3'] },
    { aspect: 'prices', text_ru: 'Цены заявлены только у автоломбарда (от 3%); у публичных источников офферов нет.', evidence_ids: ['ev_3'] }
  ],
  recurring_pains_ru: ['высокая ставка'],
  opportunities: [{ text_ru: 'Прозрачный калькулятор ставки', evidence_ids: ['ev_3'] }],
  recommended_experiments: [{ text_ru: 'A/B тест лендинга с калькулятором', priority: 'medium', evidence_ids: ['ev_3'] }],
  used_evidence_ids: ['ev_1', 'ev_2', 'ev_3']
};
const cfg = { sleep: () => Promise.resolve(), rand: () => 0 };

A.section('synthesis — valid submit_synthesis on first call => no repair, no fallback');
CA.analyzeComparison(() => Promise.resolve(synthResponse(validSynth)), pkgResult, cfg).then((r) => {
  A.ok('ok', r.ok); A.ok('no repair', !r.repair_used); A.ok('no fallback', !r.fallback_used);
  A.eq('analysis_mode', r.analysis_mode, 'comparison'); A.eq('one call', r.calls, 1);
  A.ok('cost > 0', r.cost_usd > 0);
  A.eq('comparisons preserved', r.analysis.comparisons.length, 2);
  A.ok('each comparison cites contributing evidence', r.analysis.comparisons.every(c => (c.evidence_ids || []).length >= 1));

  A.section('synthesis — invented evidence id => ONE repair => valid');
  const bad = JSON.parse(JSON.stringify(validSynth)); bad.comparisons[0].evidence_ids = ['ev_99'];
  let call = 0;
  return CA.analyzeComparison(() => { call++; return Promise.resolve(synthResponse(call === 1 ? bad : validSynth)); }, pkgResult, cfg).then((r2) => {
    A.ok('repaired ok', r2.ok); A.ok('repair_used', r2.repair_used); A.ok('repair_success', r2.repair_success);
    A.eq('two calls', r2.calls, 2); A.ok('flagged the invented id', r2.validation_errors.some(e => /ev_99/.test(e)));

    A.section('synthesis — repair still invalid => deterministic fallback (fail closed)');
    return CA.analyzeComparison(() => Promise.resolve(synthResponse(bad)), pkgResult, cfg).then((r3) => {
      A.ok('not ok (fallback)', !r3.ok); A.ok('fallback_used', r3.fallback_used); A.eq('exactly 2 calls', r3.calls, 2);
      A.ok('fallback is deterministic', r3.analysis._fallback === true);
      A.ok('fallback still compares sources', r3.analysis.comparisons.length >= 1);
      A.ok('fallback cites only real evidence', r3.analysis.used_evidence_ids.every(id => ['ev_1', 'ev_2', 'ev_3'].indexOf(id) >= 0));

      A.section('synthesis — transport error / no-tool => immediate fallback, one call');
      return CA.analyzeComparison(() => Promise.resolve(errResponse(429)), pkgResult, cfg).then((r4) => {
        A.ok('fallback_used', r4.fallback_used); A.ok('no repair on hard transport failure', !r4.repair_used); A.eq('one call', r4.calls, 1);
        return CA.analyzeComparison(() => Promise.resolve(textResponse('no tool')), pkgResult, cfg).then((r5) => {
          A.ok('no-structured-output => fallback', r5.fallback_used);
          A.report('synthesis-analysis');
        });
      });
    });
  });
}).catch((e) => { A.ok('no exception: ' + e.message, false); A.report('synthesis-analysis'); });
