'use strict';
// test_enrich_lead.js — WIP4 mode 2 (WF27 candidate enrichment) + mode 3 (public-lead interpretation). Offline, $0.
const A = require('./_assert.js');
const CA = require('../n8n/lib/claude_analysis.js');

function toolResp(name, input) {
  return { status: 200, latency_ms: 5000, headers: { 'x-request-id': 'rq' },
    body: { id: 'm', model: 'claude-sonnet-4-6', stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: name, input: input }], usage: { input_tokens: 800, output_tokens: 120 } } };
}
function errResp() { return { status: 429, latency_ms: 100, headers: {}, body: { type: 'error', error: { type: 'x', message: 'boom' } } }; }
const cfg = { sleep: () => Promise.resolve(), rand: () => 0 };

// ---- mode 2: candidate enrichment -----------------------------------------------------------------------------
const candPkg = { package: { evidence_items: [{ evidence_id: 'ev_1', source_url: 'https://t.me/autolombard_x', excerpt: 'Займы под ПТС в Москве, оформить онлайн' }] }, allowed_evidence_ids: ['ev_1'], deterministic_default: { verdict: 'lead_source', is_regional_match: true } };
const validVerdict = { verdict: 'competitor', confidence: 82, rationale_ru: 'Предлагает собственные займы под ПТС в Москве.', is_regional_match: true, evidence_ids: ['ev_1'] };

A.section('mode2 — candidate enrichment: valid verdict, no repair, no fabrication path');
CA.enrichCandidate(() => Promise.resolve(toolResp('submit_candidate_verdict', validVerdict)), candPkg, cfg).then((r) => {
  A.ok('ok', r.ok); A.ok('no fallback', !r.fallback_used); A.eq('mode', r.analysis_mode, 'discovery_enrichment');
  A.eq('verdict preserved', r.verdict.verdict, 'competitor'); A.ok('cites evidence', r.verdict.evidence_ids.indexOf('ev_1') >= 0);

  A.section('mode2 — invented evidence id => ONE repair => valid');
  const bad = Object.assign({}, validVerdict, { evidence_ids: ['ev_9'] });
  let c = 0;
  return CA.enrichCandidate(() => { c++; return Promise.resolve(toolResp('submit_candidate_verdict', c === 1 ? bad : validVerdict)); }, candPkg, cfg).then((r2) => {
    A.ok('repaired', r2.ok && r2.repair_used && r2.repair_success); A.eq('two calls', r2.calls, 2);

    A.section('mode2 — transport error => conservative deterministic fallback (keeps discovery default, no upgrade)');
    return CA.enrichCandidate(() => Promise.resolve(errResp()), candPkg, cfg).then((r3) => {
      A.ok('fallback_used', r3.fallback_used); A.eq('one call', r3.calls, 1);
      A.eq('does NOT upgrade to competitor', r3.verdict.verdict, 'lead_source');
      A.eq('fallback confidence 0', r3.verdict.confidence, 0); A.ok('marked _fallback', r3.verdict._fallback === true);
      modeThree();
    });
  });
}).catch((e) => { A.ok('mode2 no exception: ' + e.message, false); A.report('enrich-lead'); });

// ---- mode 3: public-lead interpretation -----------------------------------------------------------------------
function modeThree() {
  const leadPkg = { package: { evidence_items: [{ evidence_id: 'ev_1', source_url: 'https://t.me/chat/1', excerpt: 'Срочно нужен займ под ПТС, банки отказывают' }] }, allowed_evidence_ids: ['ev_1'] };
  const validLeads = { overview_ru: 'Один публичный сигнал спроса.', leads: [{ observed_fact_ru: 'Пользователь пишет: срочно нужен займ под ПТС, банки отказывают.', interpretation_ru: 'Вероятная потребность в займе под залог авто после отказа банка.', signal: 'buying_intent', confidence: 65, evidence_ids: ['ev_1'] }], limitations_ru: ['Один пост, приватная личность не устанавливается.'], used_evidence_ids: ['ev_1'] };

  A.section('mode3 — public-lead: fact separated from interpretation, evidence-bound');
  CA.interpretPublicLead(() => Promise.resolve(toolResp('submit_public_leads', validLeads)), leadPkg, cfg).then((r) => {
    A.ok('ok', r.ok); A.eq('mode', r.analysis_mode, 'public_lead'); A.eq('one lead', r.analysis.leads.length, 1);
    A.ok('observed fact present', /займ под ПТС/.test(r.analysis.leads[0].observed_fact_ru));
    A.ok('interpretation is separate', r.analysis.leads[0].interpretation_ru !== r.analysis.leads[0].observed_fact_ru);
    A.ok('signal is a buying intent', r.analysis.leads[0].signal === 'buying_intent');
    A.ok('cites real evidence only', r.analysis.leads[0].evidence_ids.every(id => id === 'ev_1'));

    A.section('mode3 — transport error => empty, honestly-limited (no invented leads)');
    return CA.interpretPublicLead(() => Promise.resolve(errResp()), leadPkg, cfg).then((r2) => {
      A.ok('fallback_used', r2.fallback_used); A.eq('no invented leads', r2.analysis.leads.length, 0);
      A.ok('limitation stated', r2.analysis.limitations_ru.length >= 1);
      A.report('enrich-lead');
    });
  }).catch((e) => { A.ok('mode3 no exception: ' + e.message, false); A.report('enrich-lead'); });
}
