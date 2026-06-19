// test_wf04_processed.js — WF04 Stage C Closure on the REAL nodes ($0, no network).
// Covers the competitor_site_snapshots writer (brand preservation S2-D10/D12; evidence-based page_type
// S2-D14; canonical service_primary/secondary S2-D13; evidence confidence S2-D11; phone normalization
// S2-D15; raw-markdown kept in audit only S2-D10/D20; quality_status/report_eligible/fallback_reason
// S2-D16; cost telemetry unknown!=zero S2-D17) AND the Final Summary Output repair/fallback accounting
// (S2-D7/D8/D9/D16).
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('04_firecrawl_url_list_resilient.json');

function snapshot(rec) {
  const run = H.makeRun();
  return H.runCodeNode(run, wf, 'Build competitor_site_snapshots Row', [{ json: rec }])[0].json;
}

// ---- MKBK: deterministic fallback, raw markdown offer, no analysis brand, domain/title evidence ----
const mkbk = snapshot({
  source_url: 'https://mkbk.ru/uslugi', route: 'monitor_queue', processing_status: 'parsed_success',
  parse_method: 'deterministic_competitor_fallback', repair_used: true, repair_status: 'failed_fallback',
  company_name: '', title: 'МКБ Кредит — помощь в получении кредита | mkbk.ru',
  text_context: 'МКБ Кредит: кредитный брокер, помощь в получении кредита, подбор банка, работаем по договору.',
  offer_text: '# Услуги\n\n- [Кредит](https://mkbk.ru/a)\n- Помощь в получении\n\n## ' + 'очень длинный markdown '.repeat(40),
  terms: 'от 10 000 ₽', contact_public: 'тел: +7 (495) 123 45 67, 8 495 123-45-67', run_id: 'firecrawl_x', batch_index: 1
});
A.section('WF04 — MKBK brand-preserving fallback, no raw markdown in stakeholder offer (S2-D10/D12/D16/D20)');
A.ok('brand preserved from title/domain (not "Конкурент без бренда")', mkbk.company_name !== 'Конкурент без бренда' && /МКБ/.test(mkbk.company_name));
A.ok('broken_brand=false (evidence existed)', mkbk.broken_brand === false);
A.ok('page_type not "other" (services identified)', mkbk.page_type !== 'other');
A.eq('page_type=services', mkbk.page_type, 'services');
A.ok('offer_summary is NOT raw markdown', !/#|\]\(http|```/.test(mkbk.offer_summary));
A.ok('offer_summary length bounded', mkbk.offer_summary.length <= 200);
A.ok('raw markdown preserved in audit field', mkbk.offer_text_raw_audit.length > 200);
A.eq('quality_status=degraded (fallback)', mkbk.quality_status, 'degraded');
A.eq('report_eligible=false by default', mkbk.report_eligible, false);
A.ok('fallback_reason set', !!mkbk.fallback_reason);
A.ok('confidence is NOT the fixed 80', mkbk.source_confidence !== 80);
A.ok('confidence capped for degraded', mkbk.source_confidence <= 40);

A.section('WF04 — phone normalization (S2-D15)');
A.ok('canonical +7 (495) form present', /\+7 \(495\) 123-45-67/.test(mkbk.contact_public));
A.ok('duplicate phone collapsed to one', (mkbk.contact_public.match(/\+7 \(495\) 123-45-67/g) || []).length === 1);
A.ok('original kept in raw audit', /123/.test(mkbk.contact_public_raw_audit));

A.section('WF04 — cost telemetry: unknown != zero (S2-D17)');
A.eq('cost_status=unknown', mkbk.cost_status, 'unknown');
A.eq('actual_source_cost_usd null (not 0)', mkbk.actual_source_cost_usd, null);
A.eq('actual_llm_cost_usd null (not 0)', mkbk.actual_llm_cost_usd, null);
A.eq('primary_calls=1', mkbk.primary_calls, 1);
A.eq('repair_calls=1 (repair was used)', mkbk.repair_calls, 1);
A.eq('firecrawl_calls=1', mkbk.firecrawl_calls, 1);

// ---- Finardi: broad brokerage evidence + a PTS mention -> primary must stay credit_brokerage (S2-D13) ----
const finardi = snapshot({
  source_url: 'https://finardi.ru/', route: 'monitor_queue', processing_status: 'parsed_success',
  parse_method: 'primary_json', repair_used: false, company_name: 'Finardi',
  title: 'Finardi — кредитный брокер в Москве',
  text_context: 'Finardi — кредитный брокер: помощь в получении кредита, подбор банка, рефинансирование, а также займ под ПТС. Работаем по договору.',
  offer_text: 'Кредитный брокер: поможем получить кредит, подбор банка, рефинансирование, займ под ПТС.',
  terms: 'оплата за результат', contact_public: '+7 499 000 11 22', run_id: 'firecrawl_x', batch_index: 2
});
A.section('WF04 — Finardi service not narrowed to pts_loan when brokerage evidence exists (S2-D13)');
A.eq('service_primary=credit_brokerage', finardi.service_primary, 'credit_brokerage');
A.ok('pts_loan only secondary, never primary', finardi.service_primary !== 'pts_loan' && /pts_loan/.test(finardi.service_secondary));
A.eq('page_type=home', finardi.page_type, 'home');
A.eq('healthy primary parse -> report_eligible', finardi.report_eligible, true);
A.ok('confidence evidence-based and not fixed 80', finardi.source_confidence !== 80);

// ---- Royalfinance: a services page must classify as services, not other (S2-D14) ----
const royal = snapshot({
  source_url: 'https://royalfinance.ru/uslugi/refinansirovanie', route: 'monitor_queue', processing_status: 'parsed_success',
  parse_method: 'primary_json', repair_used: false, company_name: 'Royal Finance',
  title: 'Рефинансирование кредитов — Royal Finance', text_context: 'Услуги рефинансирования и подбора кредита.',
  offer_text: 'Рефинансирование кредитов, снижение ставки.', terms: '', contact_public: '', run_id: 'firecrawl_x', batch_index: 3
});
A.section('WF04 — Royalfinance services page not page_type=other (S2-D14)');
A.eq('page_type=services', royal.page_type, 'services');
A.ok('confidence differs across records (not uniform 80)',
  new Set([mkbk.source_confidence, finardi.source_confidence, royal.source_confidence]).size >= 2);

// ---- Final Summary Output: repair/fallback accounting from staticData (S2-D7/D8/D9/D16) ----
A.section('WF04 — Final Summary repair/fallback accounting (S2-D7/D8/D9/D16)');
const run = H.makeRun();
run.staticData.wf04_run = {
  urls_received: 5, urls_scraped: 5, primary_calls: 5, primary_parse_success: 2, primary_parse_failure: 3,
  repair_calls: 3, repair_success: 1, repair_failure: 2, deterministic_fallback: 2, degraded: 3, quarantined: 0,
  snapshots_written: 5, firecrawl_calls: 5, claude_calls: 8
};
H.inject(run, 'Set URL List', [{ run_id: 'firecrawl_demo' }, {}, {}, {}, {}]);
const done = [{ note: 'processed_by_workflow_04' }, { note: 'processed_by_workflow_04' }, { note: 'processed_by_workflow_04' }, { note: 'processed_by_workflow_04' }, { note: 'processed_by_workflow_04' }];
const summary = H.runCodeNode(run, wf, 'Final Summary Output', done.map(j => ({ json: j })))[0].json;
A.eq('urls_received', summary.urls_received, 5);
A.eq('primary_calls', summary.primary_calls, 5);
A.eq('primary_parse_successes', summary.primary_parse_successes, 2);
A.eq('primary_parse_failures', summary.primary_parse_failures, 3);
A.eq('repair_calls', summary.repair_calls, 3);
A.eq('repair_successes', summary.repair_successes, 1);
A.eq('repair_failures', summary.repair_failures, 2);
A.eq('deterministic_fallback_count', summary.deterministic_fallback_count, 2);
A.ok('repair success distinguishable from primary success/repair failure/fallback',
  summary.repair_successes === 1 && summary.repair_failures === 2 && summary.primary_parse_successes === 2 && summary.deterministic_fallback_count === 2);
A.eq('repair_rate_pct = 60', summary.repair_rate_pct, 60);
A.ok('high repair rate surfaced as degraded in next_action (S2-D9/D16)', /HIGH repair rate/.test(summary.next_action));
A.eq('degraded_count surfaced', summary.degraded_count, 3);
A.eq('cost_status=unknown (not zero)', summary.cost_status, 'unknown');
A.eq('actual_llm_cost_usd null', summary.actual_llm_cost_usd, null);
A.eq('status completed', summary.status, 'completed');

A.report('wf04-processed');
