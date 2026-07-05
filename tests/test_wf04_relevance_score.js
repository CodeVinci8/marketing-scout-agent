// test_wf04_relevance_score.js — RELEV-WEB-001 regression on the REAL WF04 node ($0, no network).
// Stage D required-field defect: website records were persisted with an EMPTY relevance signal
// (confidence_score='' , semantic_keywords='' , no relevance_reason) while Telegram records carry a
// confidence_score + specific relevance rationale. Real persisted evidence (req_90112771: mkbkfin.ru /
// lioncredit.ru) confirmed the gap. This proves WF04 'Build Canonical Raw Record' now emits an
// evidence-grounded, in-range confidence_score, content-derived semantic_keywords, and a specific
// relevance_reason for every website record — WITHOUT inventing a new score range (canonical 0-100).
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('04_firecrawl_url_list_resilient.json');

function build(rec) {
  const run = H.makeRun();
  H.inject(run, 'Set URL List', [{ run_id: 'firecrawl_req_90112771::website::a1', agent_request_id: 'req_90112771' }]);
  const out = H.runCodeNode(run, wf, 'Build Canonical Raw Record', [{ json: rec }]);
  return out[0] && out[0].json;
}

function inRange(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100; }

// ---- Case 1: healthy competitor website with real credit-broker service evidence (mkbkfin.ru-like) ----
const healthy = build({
  source_url: 'https://mkbkfin.ru/', route: 'monitor_queue', processing_status: 'parsed_success',
  parse_method: 'primary', entity_type: 'competitor', company_name: 'МКБК finance',
  service_type: 'ипотека', region: 'Москва', detected_need: 'кредит под залог',
  text_context: 'МКБК finance — кредитный брокер, офис у метро Чистые пруды, Москва. Услуги: '
    + 'кредиты под залог имущества, ипотека, рефинансирование, потребительские кредиты. Работают с плохой КИ.',
  offer_text: '', terms: '', repair_used: false, batch_index: 3,
});
A.section('RELEV-WEB-001 — healthy competitor gets an evidence-based in-range confidence_score');
A.ok('confidence_score KEY present (was absent — the bug)', Object.prototype.hasOwnProperty.call(healthy, 'confidence_score'));
A.ok('confidence_score is a number in [0,100]', inRange(healthy.confidence_score), healthy.confidence_score);
A.ok('healthy competitor scores strong (>70)', healthy.confidence_score > 70, healthy.confidence_score);
A.ok('confidence capped at 90 for deterministic web adapter', healthy.confidence_score <= 90, healthy.confidence_score);
A.eq('quality_status=healthy', healthy.quality_status, 'healthy');
A.ok('semantic_keywords is content-derived (non-empty)', String(healthy.semantic_keywords || '') !== '');
A.ok('semantic_keywords reflect real services', /ипотек|рефинанс|потребительск|кредитный брокер/.test(String(healthy.semantic_keywords)));
A.ok('relevance_reason is specific (names it a competitor site)', /сайт-конкурент/.test(String(healthy.relevance_reason || '')));
A.ok('relevance_reason references the actual domain', /mkbkfin\.ru/.test(String(healthy.relevance_reason || '')));

// ---- Case 2: degraded competitor (deterministic fallback) still gets a score, lower base than healthy ----
const degraded = build({
  source_url: 'https://finardi.ru/', route: 'monitor_queue', processing_status: 'parsed_success',
  parse_method: 'deterministic_competitor_fallback', entity_type: 'competitor', company_name: 'Finardi',
  service_type: 'кредитный брокер', region: 'Москва', detected_need: '',
  text_context: 'Finardi — подбор банка и помощь в получении кредита, рефинансирование, автокредит.',
  offer_text: '', terms: '', repair_used: true, repair_status: 'failed_fallback', batch_index: 2,
});
A.section('RELEV-WEB-001 — degraded competitor scored (lower base than healthy)');
A.eq('quality_status=degraded', degraded.quality_status, 'degraded');
A.ok('confidence_score in range', inRange(degraded.confidence_score), degraded.confidence_score);
A.ok('degraded base below healthy base (evidence held equal)', degraded.confidence_score < healthy.confidence_score, degraded.confidence_score);
A.ok('semantic_keywords still content-derived', String(degraded.semantic_keywords || '') !== '');

// ---- Case 3: quarantined (transport/parse failure) -> lowest confidence, honest irrelevance reason ----
const quarantined = build({
  source_url: 'https://broken.example/', route: 'technical_errors', processing_status: 'technical_error',
  parse_method: '', entity_type: 'competitor', company_name: '', text_context: '', offer_text: '', batch_index: 1,
});
A.section('RELEV-WEB-001 — quarantined page is low-confidence, not silently scored high');
A.eq('quality_status=quarantined', quarantined.quality_status, 'quarantined');
A.eq('confidence_score=10 (no page evidence)', quarantined.confidence_score, 10);
A.ok('relevance_reason states no evidence', /нерелевантно|нет доказательной/.test(String(quarantined.relevance_reason || '')));

// ---- Case 4: non-competitor finance page -> market_signal tier (45), not competitor tier ----
const market = build({
  source_url: 'https://example-news.ru/', route: 'content_queue', processing_status: 'parsed_success',
  parse_method: 'primary', entity_type: 'market_signal', company_name: 'Новостной портал',
  service_type: '', region: 'Москва', text_context: 'Обзор рынка кредитования и ставок в Москве за месяц. '.repeat(3),
  offer_text: '', terms: '', repair_used: false, batch_index: 4,
});
A.section('RELEV-WEB-001 — non-competitor finance page uses the market-signal tier');
A.ok('confidence_score in range', inRange(market.confidence_score), market.confidence_score);
A.eq('market_signal tier confidence=45', market.confidence_score, 45);
A.ok('not marked as a competitor', market.competitor_related === false);

// ---- required-field invariant across every website record ----
A.section('RELEV-WEB-001 — required relevance field present on every website record');
for (const [name, rec] of [['healthy', healthy], ['degraded', degraded], ['quarantined', quarantined], ['market', market]]) {
  A.ok(name + ': confidence_score present & in range', inRange(rec.confidence_score), rec.confidence_score);
  A.ok(name + ': relevance_reason present & specific', String(rec.relevance_reason || '').length >= 10);
}

A.report('wf04-relevance-score');
