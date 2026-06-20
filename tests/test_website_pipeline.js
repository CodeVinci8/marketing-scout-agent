// test_website_pipeline.js — Stage 3 closure: connect the website source quality & analysis pipeline.
// Proves canonical website data flows WF04 -> raw_market_records -> WF16 -> WF08 (exactly-once) on the REAL
// nodes, using fixtures shaped from the observed live run (source_run_id firecrawl_20260620_104531; CASHMOTOR
// healthy primary; CarCapital degraded deterministic fallback). $0, no network, no Claude/Firecrawl.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const LIN = require('../n8n/lib/lineage.js');

const WF04 = H.loadWorkflow('04_firecrawl_url_list_resilient.json');
const WF16 = H.loadWorkflow('16_source_quality_gate_health_score.json');
const WF08 = H.loadWorkflow('08_touchpoint_analyzer.json');
const SID = 'firecrawl_20260620_104531';            // canonical source_run_id from the live run
const REQ = 'wf04_req_20260620_104531';

// Normalize + Route-shaped inputs (what WF04 hands to Build Canonical Raw Record).
const cashIn = { source_url: 'https://cashmotor.ru/', text_context: 'CASHMOTOR — деньги под ПТС автомобиля. Займы под залог ПТС по договору, деньги в день обращения, без снятия с учёта. Москва.', offer_text: 'Займ под ПТС до 1 500 000 ₽', terms: 'ставка от 3% в месяц', company_name: 'CASHMOTOR', entity_type: 'competitor', service_type: 'pts_loan', route: 'monitor_queue', processing_status: 'parsed_success', parse_method: 'primary_json', repair_used: false, region: 'Москва', published_at: '2026-06-20', contact_public: '+7 (495) 000-00-00', run_id: SID, agent_request_id: REQ, batch_index: 1, created_at: '2026-06-20T10:45:31+03:00' };
const carIn = { source_url: 'https://carcapital.ru/', text_context: 'CarCapital — кредиты под залог автомобиля, деньги быстро.', offer_text: 'Займ под ПТС', terms: '', company_name: '', entity_type: 'competitor', service_type: 'generic_lending', route: 'monitor_queue', processing_status: 'parsed_success', parse_method: 'deterministic_competitor_fallback', repair_used: true, repair_status: 'failed_fallback', region: 'Москва', published_at: '', contact_public: '', run_id: SID, agent_request_id: REQ, batch_index: 2, created_at: '2026-06-20T10:45:31+03:00' };

// ---------------------------------------------------------------------------------------------------------
A.section('WF04 — emits one canonical raw_market_records row per scraped URL (CASHMOTOR healthy, CarCapital degraded)');
const r4 = H.makeRun();
H.inject(r4, 'Set URL List', [{ run_id: SID, agent_request_id: REQ }]);
const cash = H.runCodeNode(r4, WF04, 'Build Canonical Raw Record', [{ json: cashIn }])[0].json;
const car = H.runCodeNode(r4, WF04, 'Build Canonical Raw Record', [{ json: carIn }])[0].json;
A.eq('CASHMOTOR canonical source_run_id', cash.source_run_id, SID);
A.eq('CASHMOTOR carries a distinct agent_request_id', cash.agent_request_id, REQ);
A.eq('CASHMOTOR workflow_run_id is the wf04_* local id', cash.workflow_run_id, 'wf04_20260620_104531');
A.eq('CASHMOTOR source_record_id', cash.source_record_id, 'wf04_rec_20260620_104531_1');
A.eq('CASHMOTOR data_mode live', cash.data_mode, 'live');
A.eq('CASHMOTOR quality_status healthy', cash.quality_status, 'healthy');
A.eq('CASHMOTOR analysis_status pending (WF08 owns analysis)', cash.analysis_status, 'pending');
A.eq('CASHMOTOR review_status confirmed', cash.review_status, 'confirmed');
A.eq('CASHMOTOR report_eligible true', cash.report_eligible, true);
A.eq('CASHMOTOR is a canonical raw record (platform website, scraped_web)', cash.platform + '/' + cash.source_type, 'website/scraped_web');
A.eq('CarCapital quality_status degraded (deterministic fallback)', car.quality_status, 'degraded');
A.eq('CarCapital report_eligible false', car.report_eligible, false);
A.eq('CarCapital review_status pending', car.review_status, 'pending');
A.eq('CarCapital brand derived from domain (not Конкурент без бренда)', car.competitor_name, 'Carcapital');
A.eq('CarCapital shares the same canonical source_run_id', car.source_run_id, SID);
A.eq('CarCapital distinct source_record_id', car.source_record_id, 'wf04_rec_20260620_104531_2');

// ---------------------------------------------------------------------------------------------------------
A.section('WF16 — both WF04 canonical records are visible and evaluated by source_run_id');
const r16 = H.makeRun();
const cfg16 = H.runCodeNode(H.makeRun(), WF16, 'Set WF16 Config', [])[0].json;
r16.outputs['Set WF16 Config'] = [{ json: Object.assign({}, cfg16, { fixture_self_test: false, source_run_id_filter: SID }) }];
H.inject(r16, 'Read live_source_runs', [{ source_run_id: SID, run_id: SID, workflow_run_id: 'wf04_20260620_104531', platform: 'website', source_family: 'web_competitor', mode: 'live', data_mode: 'live', items_received: 2 }]);
H.inject(r16, 'Read raw_market_records', [cash, car]);
H.inject(r16, 'Read market_record_registry', []);
const bundles = H.runCodeNode(r16, WF16, 'Assemble Run Bundles', []).map(i => i.json).filter(b => b.is_run_bundle);
A.eq('exactly one WF04 run bundle', bundles.length, 1);
A.eq('bundle keyed on the canonical source_run_id', bundles[0].run.source_run_id, SID);
A.eq('both WF04 records visible to WF16', bundles[0].records.length, 2);
A.eq('bundle joined WF04 live_source_runs metadata (website)', String(bundles[0].run.platform).toLowerCase(), 'website');
const health = H.runCodeNode(r16, WF16, 'Build Source Health', bundles.map(j => ({ json: j })))[0].json;
A.eq('WF16 health row keyed on the canonical source_run_id', health.source_run_id, SID);
A.ok('WF16 did NOT flag no_compatible_baseline', String(health.quality_flags || '').indexOf('no_compatible_baseline') < 0);

// ---------------------------------------------------------------------------------------------------------
A.section('WF08 — healthy record reaches analysis, degraded is blocked, exactly-once enforced');
const cfg8 = H.runCodeNode(H.makeRun(), WF08, 'Set Analyzer Config', [])[0].json;
function selectWF08(analysisRuns, extraCfg) {
  const r8 = H.makeRun();
  r8.outputs['Set Analyzer Config'] = [{ json: Object.assign({}, cfg8, { test_mode: true, source_run_id_filter: SID, require_quality_eligible: true }, extraCfg || {}) }];
  H.inject(r8, 'Read raw_market_records', [cash, car]);
  H.inject(r8, 'Read analysis_runs', analysisRuns || []);
  const sel = H.runCodeNode(r8, WF08, 'Filter & Select Records', []).map(i => i.json);
  return { r8, sel };
}
// Run 1 — empty ledger.
const run1 = selectWF08([]);
A.eq('exactly one record selected for analysis', run1.sel.length, 1);
A.eq('the selected record is CASHMOTOR (healthy)', run1.sel[0].record_id, cash.record_id);
A.ok('CarCapital (degraded) is NOT selected for WF08', !run1.sel.some(s => s.record_id === car.record_id));
A.eq('selected record source_run_id is the canonical id (lineage unchanged)', run1.sel[0].source_run_id, SID);
A.eq('selected record carries the analysis idempotency key', run1.sel[0].analysis_idempotency_key, SID + '::' + cash.source_record_id);

// ledger write (one row per selected record).
const ledger = H.runCodeNode(run1.r8, WF08, 'Build analysis_runs Row', []).map(i => i.json);
A.eq('analysis_runs ledger has exactly one row', ledger.length, 1);
A.eq('ledger idempotency key matches', ledger[0].analysis_idempotency_key, SID + '::' + cash.source_record_id);
A.eq('ledger records no LLM use ($0)', ledger[0].llm_used, false);

// Run 2 — same ledger present: CASHMOTOR must NOT be re-selected (exactly-once).
const run2 = selectWF08(ledger);
A.eq('repeated execution selects ZERO (no duplicate analysis)', run2.sel.length, 0);

// Run 3 — force_reprocess overrides idempotency.
const run3 = selectWF08(ledger, { force_reprocess: true });
A.eq('force_reprocess=true re-selects CASHMOTOR exactly once', run3.sel.length, 1);
A.ok('force_reprocess still does NOT admit the degraded CarCapital', !run3.sel.some(s => s.record_id === car.record_id));

// ---------------------------------------------------------------------------------------------------------
A.section('WF08 — analysis preserves the canonical lineage end-to-end ($0, deterministic)');
H.runCodeNode(run1.r8, WF08, 'Prepare Record', [{ json: run1.sel[0] }]);
const analyzed = H.runCodeNode(run1.r8, WF08, 'Build Deterministic Row', [{ json: run1.sel[0] }])[0].json;
A.eq('analyzed row keeps the canonical source_run_id (WF04==WF16==WF08)', LIN.canonicalSourceRunId(analyzed), SID);
A.eq('analyzed deterministically with no LLM cost ($0)', Number(analyzed.estimated_analysis_cost_usd) || 0, 0);
A.eq('lineage is identical across all three workflows', [cash.source_run_id, bundles[0].run.source_run_id, LIN.canonicalSourceRunId(analyzed)].join('|'), [SID, SID, SID].join('|'));

A.report('website-pipeline');
