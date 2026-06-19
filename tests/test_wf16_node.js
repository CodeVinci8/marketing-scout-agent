// test_wf16_node.js — runs the REAL WF16 Code nodes and proves:
//   1. Build Fixture Runs emits 3 bundles -> Build Source Health scores them healthy/degraded/quarantined.
//   2. The node-embedded computeRunHealth equals n8n/lib/quality_gate.js for the SAME bundles (no drift).
//   3. Final Summary Output reports the right eligibility and zero external calls.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const Q = require('../n8n/lib/quality_gate.js');

const wf = H.loadWorkflow('16_source_quality_gate_health_score.json');

A.section('WF16 imports as a valid n8n workflow');
A.ok('has nodes', Array.isArray(wf.nodes) && wf.nodes.length > 0);
A.ok('has Build Source Health node', wf.nodes.some(n => n.name === 'Build Source Health'));
A.ok('writes source_health tab', wf.nodes.some(n => n.type === 'n8n-nodes-base.googleSheets' && n.parameters.operation === 'append' && n.parameters.sheetName.value === 'source_health'));
A.ok('no external API node (no httpRequest)', !wf.nodes.some(n => n.type === 'n8n-nodes-base.httpRequest'));

// ---- run the real nodes (self-test path) ----
const run = H.makeRun();
const cfg = H.runCodeNode(run, wf, 'Set WF16 Config', [])[0].json;
A.section('Set WF16 Config');
A.eq('fixture_self_test default true', cfg.fixture_self_test, true);
A.eq('write_result default false (dry-run)', cfg.write_result, false);

const bundles = H.runCodeNode(run, wf, 'Build Fixture Runs', [{ json: cfg }]);
A.eq('Build Fixture Runs -> 3 bundles', bundles.length, 3);

const health = H.runCodeNode(run, wf, 'Build Source Health', bundles);
A.section('Build Source Health (real embedded scoring)');
A.eq('3 source_health rows', health.length, 3);
const byId = {}; health.forEach(h => byId[h.json.source_run_id] = h.json);
A.eq('healthy run status', byId['tg_demo_healthy'].quality_status, 'healthy');
A.eq('healthy report_eligible', byId['tg_demo_healthy'].report_eligible, true);
A.eq('degraded run status', byId['av_demo_degraded'].quality_status, 'degraded');
A.eq('degraded excluded from report', byId['av_demo_degraded'].report_eligible, false);
A.eq('quarantined run status', byId['av_demo_quarantined'].quality_status, 'quarantined');
A.eq('quarantined excluded from report', byId['av_demo_quarantined'].report_eligible, false);
A.eq('quarantined llm ineligible', byId['av_demo_quarantined'].llm_eligible, false);
A.ok('source_health row exposes quality_flags string', typeof byId['av_demo_quarantined'].quality_flags === 'string');

A.section('node-embedded computeRunHealth === n8n/lib/quality_gate.js (drift-proof)');
for (const b of bundles) {
  const lib = Q.computeRunHealth(b.json.run, b.json.records, { now_iso: '2026-06-19T12:00:00+03:00', freshness_window_days: 30, allow_degraded_report: cfg.allow_degraded_report === true, taxonomy_version: 'semantic-v2.0' });
  const node = byId[b.json.run.source_run_id];
  A.eq(b.json.run.source_run_id + ' quality_score match', node.quality_score, lib.quality_score);
  A.eq(b.json.run.source_run_id + ' quality_status match', node.quality_status, lib.quality_status);
  A.eq(b.json.run.source_run_id + ' report_eligible match', node.report_eligible, lib.report_eligible);
  A.eq(b.json.run.source_run_id + ' llm_eligible match', node.llm_eligible, lib.llm_eligible);
  A.eq(b.json.run.source_run_id + ' flags match', node.quality_flags, (lib.quality_flags || []).join('; '));
}

A.section('Final Summary Output (§7.6)');
const summary = H.runCodeNode(run, wf, 'Final Summary Output', health)[0].json;
A.eq('evaluated 3 runs', summary.evaluated_runs, 3);
A.eq('external_calls=0', summary.external_calls, 0);
A.eq('llm_calls=0', summary.llm_calls, 0);
A.eq('cost_status not_applicable', summary.cost_status, 'not_applicable');
A.eq('only healthy run is report-eligible', summary.report_eligible_runs, ['tg_demo_healthy']);
A.eq('status counts', summary.status_counts, { healthy: 1, degraded: 1, quarantined: 1 });

A.report('wf16-node');
