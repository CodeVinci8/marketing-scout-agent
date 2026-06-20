// test_lineage_contract.js — Stage 3 closure commit 1. Proves the canonical identity/lineage contract on the
// REAL WF04 + WF16 nodes ($0, no network):
//  * WF04 `live_source_runs` no longer rewrites the connector run id to `wf04_*`; its `source_run_id` equals the
//    canonical `firecrawl_<stamp>` produced by `Set URL List` (the value downstream rows/snapshots/source_health
//    join on), and the workflow-local `wf04_*` id is preserved separately as `workflow_run_id`;
//  * WF04 competitor_site_snapshots carry the same canonical `source_run_id`;
//  * WF16's join key resolver matches WF04's `live_source_runs` row to records by `source_run_id` (the
//    pre-fix `wf04_*` mismatch produced `no_compatible_baseline`);
//  * WF16 `Assemble Run Bundles` honours explicit Sheets booleans — a raw row with the STRING 'FALSE' for
//    is_valid_listing is scored structurally INVALID (the `x !== false` defect), and the embedded coercion
//    matches n8n/lib/lineage.coerceSheetBool (drift-proof).
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const LIN = require('../n8n/lib/lineage.js');

const wf04 = H.loadWorkflow('04_firecrawl_url_list_resilient.json');
const wf16 = H.loadWorkflow('16_source_quality_gate_health_score.json');

// ---------------------------------------------------------------------------------------------------------
A.section('lineage lib — canonical join key + Sheets boolean coercion');
A.eq('canonicalSourceRunId prefers source_run_id', LIN.canonicalSourceRunId({ source_run_id: 'firecrawl_X', run_id: 'wf04_X' }), 'firecrawl_X');
A.eq('canonicalSourceRunId falls back to run_id (legacy)', LIN.canonicalSourceRunId({ run_id: 'firecrawl_Y' }), 'firecrawl_Y');
A.eq('coerceSheetBool string FALSE -> false', LIN.coerceSheetBool('FALSE'), false);
A.eq('coerceSheetBool string TRUE -> true', LIN.coerceSheetBool('TRUE'), true);
A.eq('coerceSheetBool real false -> false', LIN.coerceSheetBool(false), false);
A.eq('coerceSheetBool empty -> default (undefined)', LIN.coerceSheetBool('', undefined), undefined);
A.eq('coerceSheetBool empty -> explicit default true', LIN.coerceSheetBool('', true), true);

// ---------------------------------------------------------------------------------------------------------
A.section('WF04 — live_source_runs uses the canonical source_run_id, not a wf04_* rewrite');
const run = H.makeRun();
const urls = H.runCodeNode(run, wf04, 'Set URL List', []).map(i => i.json);
const canonical = urls[0].run_id; // 'firecrawl_<stamp>'
A.ok('Set URL List run_id is the canonical firecrawl id', /^firecrawl_\d{8}_\d{6}$/.test(canonical));
A.ok('every downstream item carries that canonical run_id', urls.every(u => u.run_id === canonical));

// live_source_runs aggregates the DONE output; feed two processed records shaped like the batch output.
const processed = [
  { json: { note: 'processed_by_workflow_04', run_id: canonical, source_url: 'https://cashmotor.ru/' } },
  { json: { note: 'processed_by_workflow_04', run_id: canonical, source_url: 'https://carcapital.ru/' } }
];
const lsr = H.runCodeNode(run, wf04, 'Build live_source_runs Row', processed)[0].json;
A.eq('live_source_runs.source_run_id === canonical firecrawl id', lsr.source_run_id, canonical);
A.eq('live_source_runs.run_id (alias) === canonical (join-safe)', lsr.run_id, canonical);
A.ok('live_source_runs.run_id is NOT a wf04_* id', !/^wf04_/.test(lsr.run_id));
A.eq('workflow-local id preserved separately as workflow_run_id', lsr.workflow_run_id, 'wf04_' + canonical.replace(/^firecrawl_/, ''));
A.eq('data_mode stamped', lsr.data_mode, 'live');
A.eq('approval_token_used is accurate (not a fake no)', lsr.approval_token_used, 'not_required');
A.eq('primary/repair calls present (separated)', typeof lsr.primary_calls + ',' + typeof lsr.repair_calls, 'number,number');
A.eq('unrecovered source cost is unknown, not 0', lsr.source_cost_status, 'unknown');
A.eq('actual source cost null (never fake zero)', lsr.actual_source_cost_usd, null);

// ---------------------------------------------------------------------------------------------------------
A.section('WF04 — competitor_site_snapshots carry the same canonical source_run_id');
const snapIn = { run_id: canonical, source_url: 'https://carcapital.ru/', title: 'CarCapital — займы под ПТС', text_context: 'Деньги под ПТС автомобиля, договор, без снятия с учёта.', offer_text: 'Займ под ПТС', route: 'monitor_queue', processing_status: 'analyzed', parse_method: 'deterministic_competitor_fallback', company_name: '', batch_index: 2 };
const snap = H.runCodeNode(run, wf04, 'Build competitor_site_snapshots Row', [{ json: snapIn }])[0].json;
A.eq('snapshot.source_run_id === canonical', snap.source_run_id, canonical);
A.eq('snapshot.workflow_run_id is the wf04_* local id', /^wf04_/.test(snap.workflow_run_id), true);
A.eq('snapshot.data_mode stamped', snap.data_mode, 'live');
A.eq('snapshot brand derived from page evidence (title): CarCapital', snap.company_name, 'CarCapital');
A.ok('snapshot brand is NOT the broken placeholder', !/Конкурент без бренда/.test(snap.company_name) && snap.brand_source !== 'none');
A.eq('snapshot lineage joins to live_source_runs (same canonical key)', LIN.canonicalSourceRunId(snap), LIN.canonicalSourceRunId(lsr));
// pure domain-evidence fallback (no title) still derives the brand from the domain, never the placeholder.
const snapDom = H.runCodeNode(run, wf04, 'Build competitor_site_snapshots Row', [{ json: { run_id: canonical, source_url: 'https://carcapital.ru/uslugi', title: '', text_context: 'Деньги под ПТС, договор.', offer_text: 'Займ под ПТС', route: 'monitor_queue', processing_status: 'analyzed', parse_method: 'deterministic_competitor_fallback', company_name: '', batch_index: 3 } }])[0].json;
A.eq('domain-only fallback derives Carcapital (not Конкурент без бренда)', snapDom.company_name, 'Carcapital');

// ---------------------------------------------------------------------------------------------------------
A.section('WF16 — Assemble joins WF04 live_source_runs by source_run_id + honours explicit Sheets booleans');
// Filter to the WF04 run; provide one canonical raw record + the WF04 live_source_runs row + a string-FALSE row.
const cfg16 = H.runCodeNode(H.makeRun(), wf16, 'Set WF16 Config', [])[0].json;
const run16 = H.makeRun();
const cfg = Object.assign({}, cfg16, { fixture_self_test: false, source_run_id_filter: canonical });
run16.outputs['Set WF16 Config'] = [{ json: cfg }];
H.inject(run16, 'Read live_source_runs', [lsr]);
H.inject(run16, 'Read raw_market_records', [
  { record_id: 'wf04_rec_1', source_run_id: canonical, data_mode: 'live', is_valid_listing: true, record_type_hint: 'competitor_activity', title: 'CASHMOTOR', text_context: 'Займы под ПТС автомобиля по договору, деньги в день обращения, без снятия с учёта.', source_url: 'https://cashmotor.ru/', post_url: 'https://cashmotor.ru/', is_detail: true, review_status: 'confirmed', exact_evidence_url: true, service_hint: 'pts_loan', published_at: '2026-06-20' },
  { record_id: 'wf04_rec_2', source_run_id: canonical, data_mode: 'live', is_valid_listing: 'FALSE', record_type_hint: 'competitor_activity', title: 'broken', text_context: '', source_url: 'https://carcapital.ru/' }
]);
H.inject(run16, 'Read market_record_registry', []);
const bundles = H.runCodeNode(run16, wf16, 'Assemble Run Bundles', []).map(i => i.json).filter(b => b.is_run_bundle);
A.eq('exactly one run bundle for the WF04 run', bundles.length, 1);
const b = bundles[0];
A.eq('bundle keyed on the canonical source_run_id', b.run.source_run_id, canonical);
A.eq('bundle joined the WF04 live_source_runs metadata (platform=website)', String(b.run.platform).toLowerCase(), 'website');
A.eq('bundle attached BOTH raw records (non-empty -> not no_compatible_baseline)', b.records.length, 2);
const valid = b.records.filter(r => r.structurally_valid === true);
const invalid = b.records.filter(r => r.structurally_valid === false);
A.eq('the real CASHMOTOR record is structurally valid', valid.length, 1);
A.eq("the string-'FALSE' record is structurally INVALID (boolean fidelity)", invalid.length, 1);

// drift proof: the embedded WF16 coercion agrees with the library on the explicit-FALSE case.
A.eq('embedded WF16 coercion matches lib on string FALSE', invalid.length === 1, LIN.coerceSheetBool('FALSE') === false);

// And the run now SCORES (Build Source Health) instead of no_compatible_baseline.
const health = H.runCodeNode(run16, wf16, 'Build Source Health', bundles.map(j => ({ json: j })))[0].json;
A.ok('WF16 produced a health row for the WF04 run', !!health && health.source_run_id === canonical);
A.ok('WF16 did NOT flag no_compatible_baseline (records were joined)', String(health.quality_flags || '').indexOf('no_compatible_baseline') < 0);

A.report('lineage-contract');
