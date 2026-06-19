// test_wf07_cost.js — WF07 Manual Touchpoint Intake cost/metric semantics ($0, no network).
// Proves: actual analysis cost=0; estimated future analysis cost is derived ONLY from unique relevant
// rows; eligible_unique_for_analysis=10; irrelevant=2; hard_skipped=0; audit rows=12; data_mode=manual_test;
// and the duplicate-only repeat run estimates 0 with eligible_unique=0, duplicate_count=12. (S3-D18/D19)
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('07_manual_touchpoint_intake.json');

function runIntake(registryRows) {
  const run = H.makeRun();
  H.runCodeNode(run, wf, 'Set Manual Intake Request', []);
  const set = H.runCodeNode(run, wf, 'Set Manual Records', []);
  const norm = H.runCodeNode(run, wf, 'Normalize Manual Records', set);
  H.inject(run, 'Read market_record_registry', registryRows || []);
  const dedup = H.runCodeNode(run, wf, 'Dedup Against Registry', norm);
  const summary = H.runCodeNode(run, wf, 'Final Summary Output', dedup)[0].json;
  const lsr = H.runCodeNode(run, wf, 'Build live_source_runs Row', dedup)[0].json;
  return { dedupRows: dedup.map(i => i.json), summary, lsr };
}

// ---- first fixture run (empty registry) ----
const first = runIntake([]);
A.section('WF07 — first fixture run cost/metric semantics (§8)');
A.eq('total/raw rows = 12', first.summary.total_records, 12);
A.eq('audit_rows_written = 12', first.summary.audit_rows_written, 12);
A.eq('raw_market_records_written = 12', first.summary.raw_market_records_written, 12);
A.eq('actual_analysis_cost_usd = 0', first.summary.actual_analysis_cost_usd, 0);
A.eq('eligible_unique_for_analysis = 10', first.summary.eligible_unique_for_analysis, 10);
A.eq('irrelevant_items = 2', first.summary.irrelevant_items, 2);
A.eq('hard_skipped_items = 0', first.summary.hard_skipped_items, 0);
A.eq('data_mode = manual_test', first.summary.data_mode, 'manual_test');
A.ok('estimated_future_analysis_cost_usd > 0 and based on 10 rows', first.summary.estimated_future_analysis_cost_usd > 0);
A.eq('estimated cost = 10 * 0.004', first.summary.estimated_future_analysis_cost_usd, 0.04);
A.eq('cost_status = not_applicable', first.summary.cost_status, 'not_applicable');

A.section('WF07 — live_source_runs no longer mislabels irrelevant as hard_skipped (S3-D19)');
A.eq('lsr hard_skipped = 0', first.lsr.hard_skipped, 0);
A.eq('lsr irrelevant_items = 2', first.lsr.irrelevant_items, 2);
A.eq('lsr data_mode = manual_test (WF16-visible)', first.lsr.data_mode, 'manual_test');
A.eq('lsr items_received = 12', first.lsr.items_received, 12);

// ---- duplicate-only repeat (registry seeded with every dedup_key from the first run) ----
const seededRegistry = first.dedupRows.map(r => ({ dedup_key: r.dedup_key }));
const repeat = runIntake(seededRegistry);
A.section('WF07 — duplicate-only repeat run');
A.eq('repeat duplicate_count = 12', repeat.summary.duplicate_count, 12);
A.eq('repeat eligible_unique_for_analysis = 0', repeat.summary.eligible_unique_for_analysis, 0);
A.eq('repeat estimated_future_analysis_cost_usd = 0', repeat.summary.estimated_future_analysis_cost_usd, 0);
A.eq('repeat actual_analysis_cost_usd = 0', repeat.summary.actual_analysis_cost_usd, 0);

A.report('wf07-cost');
