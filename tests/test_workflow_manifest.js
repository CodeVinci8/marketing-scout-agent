// test_workflow_manifest.js — QA-001 (runtime closure as single source of truth) + QA-008 (weekly-digest gating)
// + the manifest rejection ruleset. Proves the committed manifest is internally consistent AND that the validator
// actually rejects each class of corruption (so it can't silently pass a broken manifest). Offline, $0.
'use strict';
const A = require('./_assert');
const path = require('path');
const L = require('../tools/manifest_lib.js');
const { runChecks } = require('../tools/validate_workflow_manifest.js');

const EXPECTED_CLOSURE = [
  '04_firecrawl_url_list_resilient.json', '08_touchpoint_analyzer.json',
  '10_competitor_audience_intelligence_aggregator.json', '12_market_intelligence_report_builder.json',
  '16_source_quality_gate_health_score.json', '17_agent_settings_config.json', '18_telegram_agent_gateway.json',
  '19_request_planner.json', '20_agent_orchestrator.json', '21_deep_competitor_analysis.json',
  '22_conversation_control.json', '23_scheduled_source_monitor.json', '24_report_export_delivery.json',
  '25_weekly_digest.json', '26_vk_public_community_collector.json'
];
const TEST_ONLY = ['00_healthcheck_manual_test.json', '01_google_sheets_append_row_test.json', '09_avito_classifieds_listing_connector.json', '15_live_source_run_logger.json'];

function freshManifest() { return JSON.parse(JSON.stringify(L.loadManifest())); }

A.section('QA-001 — runtime closure (15) is the single source of truth');
const closure = L.runtimeClosure().slice().sort();
A.eq('runtime closure is exactly the 15 expected workflows', closure, EXPECTED_CLOSURE.slice().sort());
A.eq('runtime-count == 15', L.deployment().runtime_workflow_count, 15);
A.eq('binding edges == 8', L.bindingEdges().length, 8);
A.eq('callable targets == 6', L.callableTargets().length, 6);
A.eq('expected n8n version', L.expectedN8nVersion(), '2.23.3');
for (const f of ['04_firecrawl_url_list_resilient.json', '08_touchpoint_analyzer.json', '10_competitor_audience_intelligence_aggregator.json', '12_market_intelligence_report_builder.json', '16_source_quality_gate_health_score.json'])
  A.ok('callable dependency in closure: ' + f, closure.indexOf(f) >= 0);
for (const f of TEST_ONLY) A.ok('test/manual workflow excluded from runtime: ' + f, closure.indexOf(f) < 0);

A.section('QA-001 — import order is topological (every callable bound before its caller)');
const order = L.importOrder();
const posn = {}; order.forEach((f, i) => { posn[f] = i; });
A.eq('import order is a permutation of the closure (15, unique)', order.length === 15 && new Set(order).size === 15, true);
for (const e of L.bindingEdges())
  A.ok('dependency before caller: ' + e.target_wf + ' < ' + e.caller_wf, posn[e.target_workflow] < posn[e.caller_workflow]);

A.section('QA-008 — activation policy gates WF23 (monitoring) and WF25 (weekly digest); never a callable');
const callable = new Set(L.callableTargets());
A.eq('default activation = WF18 only', L.activationPlan({}), ['18_telegram_agent_gateway.json']);
A.ok('monitoring adds WF23', L.activationPlan({ monitoring: true }).indexOf('23_scheduled_source_monitor.json') >= 0);
A.ok('weekly digest adds WF25', L.activationPlan({ weeklyDigest: true }).indexOf('25_weekly_digest.json') >= 0);
A.ok('WF25 is NOT in the always set', L.deployment().activation.always.indexOf('25_weekly_digest.json') < 0);
const fullPlan = L.activationPlan({ monitoring: true, weeklyDigest: true });
A.ok('no callable target ever appears in an activation plan', fullPlan.every(f => !callable.has(f)));
A.eq('callable_trigger_count == 6', L.deployment().activation.callable_trigger_count, 6);

A.section('manifest validator passes on the committed manifest');
A.eq('runChecks(committed) has zero failures', runChecks(freshManifest()).failed, 0);

A.section('validator REJECTS each class of corruption (cannot silently pass a broken manifest)');
function rejects(label, mutate) {
  const m = freshManifest(); mutate(m.deployment, m);
  const r = runChecks(m);
  A.ok(label, r.failed > 0);
}
rejects('rejects a runtime closure of 14 (dropped workflow)', d => { d.runtime_closure = d.runtime_closure.slice(0, 14); d.runtime_workflow_count = 14; });
rejects('rejects a callable placed in activation.always', d => { d.activation.always = d.activation.always.concat(['04_firecrawl_url_list_resilient.json']); });
rejects('rejects 7 binding edges (missing edge)', d => { d.binding_edges = d.binding_edges.slice(0, 7); d.binding_edge_count = 7; });
rejects('rejects a binding edge with an unknown caller node', d => { d.binding_edges[0].caller_node = 'No Such Node'; });
rejects('rejects a binding target outside the runtime closure', d => { d.binding_edges[0].target_workflow = '09_avito_classifieds_listing_connector.json'; });
rejects('rejects an import order that is not a permutation of the closure', d => { d.import_order = d.import_order.slice(0, 14); });
rejects('rejects a test-only workflow injected into the runtime set', (d, m) => {
  d.runtime_closure = d.runtime_closure.concat(['09_avito_classifieds_listing_connector.json']); d.runtime_workflow_count = 16;
  const e = (m.workflows || []).find(w => w.file === '09_avito_classifieds_listing_connector.json'); if (e) e.deployment_role = 'manual_diagnostic';
});
rejects('rejects callable_trigger_count != 6', d => { d.activation.callable_trigger_count = 5; });

A.report('workflow-manifest');
void path;
