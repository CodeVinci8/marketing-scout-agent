// run_all.js — Stage C Hardening offline regression entrypoint ($0, no network, no paid APIs).
// Runs every JS suite + the Python workflow validator + the legacy Lead Scout harness. Usage:
//   node tests/run_all.js     (or)     make test
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const JS_SUITES = [
  ['taxonomy', 'test_taxonomy.js'],
  ['semantic-contract', 'test_semantic_contract.js'],
  ['quality-gate', 'test_quality_gate.js'],
  ['wf16-node', 'test_wf16_node.js'],
  ['intake-gates', 'test_intake_gates.js'],
  // --- Stage C Closure Patch 2 workflow-level suites ---
  ['report-gate', 'test_report_gate.js'],
  ['lineage-e2e', 'test_lineage_e2e.js'],
  ['wf04-processed', 'test_wf04_processed.js'],
  ['wf04-accounting', 'test_wf04_accounting.js'],
  ['wf05-classify', 'test_wf05_classify.js'],
  ['wf09-searchcard', 'test_wf09_searchcard.js'],
  ['wf06-processed', 'test_wf06_processed.js'],
  ['wf07-cost', 'test_wf07_cost.js'],
  ['wf09-multiquery', 'test_wf09_multiquery.js'],
  ['wf10-source-health', 'test_wf10_source_health.js'],
  ['wf12-closure', 'test_wf12_closure.js'],
  // --- Stage C Runtime Patch 4: first real WF09 -> WF16 live execution regression ---
  ['wf16-runtime-searchcards', 'test_wf16_runtime_searchcards.js'],
  // --- Stage C Runtime Patch 5: WF09 Apify actor-input regression (string startUrls, query origin) ---
  ['wf09-actor-input', 'test_wf09_actor_input.js'],
  // --- Stage 3 closure: canonical identity/lineage contract + WF16 boolean fidelity ---
  ['lineage-contract', 'test_lineage_contract.js'],
  // --- Stage 3 closure: WF04 -> WF16 -> WF08 website source quality & analysis pipeline ---
  ['website-pipeline', 'test_website_pipeline.js'],
  // --- Stage 3 closure: production analysis/aggregation/reporting gates (WF05/06/08/09/10/12) ---
  ['stage3-gates', 'test_stage3_gates.js'],
  // --- Stage 4: single-user Telegram agent MVP (libs + generated WF17-20) ---
  ['stage4-contracts', 'test_stage4_contracts.js'],
  ['stage4-workflows', 'test_stage4_workflows.js'],
  ['stage4-e2e', 'test_stage4_e2e.js'],
  // --- Conversational agent: charter, intent router, bounded memory, sources ---
  ['agent-contracts', 'test_agent_contracts.js'],
  ['agent-workflows', 'test_agent_workflows.js'],
  // --- Deep competitor analysis + conversation-aware orchestration reuse ---
  ['deep-analysis-contracts', 'test_deep_analysis_contracts.js'],
  ['deep-analysis-workflows', 'test_deep_analysis_workflows.js'],
  // --- Proactive delivery + scheduled tracked-source monitoring (WF23) ---
  ['monitoring', 'test_monitoring.js'],
  ['agent-e2e', 'test_agent_e2e.js'],
  // --- Release hardening: n8n topology/trigger audit + persistence + delivery proof + full E2E ---
  ['release-audit', 'test_release_audit.js'],
  ['release-e2e', 'test_release_e2e.js'],
  ['ci-workflow', 'test_ci_workflow.js'],
  // --- Reporting UX phase: scoped CSV/XLSX/chart exports ---
  ['report-export', 'test_report_export.js'],
  ['xlsx-writer', 'test_xlsx_writer.js'],
  ['report-charts', 'test_report_charts.js'],
  // --- Reporting UX phase: evidence / compare / filtering / smart refresh ---
  ['evidence', 'test_evidence.js'],
  ['report-compare', 'test_report_compare.js'],
  ['report-filter', 'test_report_filter.js'],
  ['refresh-policy', 'test_refresh_policy.js'],
  // --- Reporting UX phase: scope/cost preview + progress UX + weekly digest ---
  ['scope-preview', 'test_scope_preview.js'],
  ['progress-tracker', 'test_progress_tracker.js'],
  ['weekly-digest', 'test_weekly_digest.js'],
  // --- Reporting UX phase: real n8n workflow integration (WF24 export/delivery, WF25 digest, WF19/WF20 wiring) ---
  ['reporting-workflows', 'test_reporting_workflows.js'],
  // --- Sources: bounded VK public-community collector (lib + WF26 + WF23 integration), fully offline ---
  ['vk-collector', 'test_vk_collector.js'],
  // --- Storage: sheets contract validator + runtime content auditor + before/after verifier + retention ---
  ['sheets-contracts', 'test_sheets_contracts.js'],
  // --- Safety: SSRF defense + prompt-injection guard + honest Telegram channel capability ---
  ['url-safety', 'test_url_safety.js'],
  // --- Capstone: full offline conversational E2E (request->preview->report->exports->VK->digest->audit) ---
  ['reporting-e2e', 'test_reporting_e2e.js'],
  // --- QA Stage 1/2 repair package (QA-001..QA-012) ---
  ['workflow-manifest', 'test_workflow_manifest.js'],
  ['binding-tool', 'test_binding_tool.js'],
  ['deploy-preflight', 'test_deploy_preflight.js'],
  ['attachment-routing', 'test_attachment_routing.js'],
  ['smoke-hardening', 'test_smoke_hardening.js'],
  // --- Stage 3 Google Sheets staging bootstrap (resolver + pure planner + generated QA workflow) ---
  ['sheets-bootstrap', 'test_sheets_bootstrap.js'],
  // --- Stage 3C Google Sheets OPERATIONS acceptance (pure engine + generated manual QA workflow) ---
  ['sheets-operations-qa', 'test_sheets_operations_qa.js'],
];

let failed = 0;
const summary = [];

function runNode(file) {
  try {
    const out = execFileSync('node', [path.join(__dirname, file)], { encoding: 'utf8' });
    const m = out.match(/(\d+) passed, (\d+) failed/);
    process.stdout.write(out);
    const pass = m ? m[1] : '?', fl = m ? m[2] : '?';
    const ok = m && m[2] === '0';
    if (!ok) failed++;
    return [pass, fl, ok ? 'PASS' : 'FAIL'];
  } catch (e) {
    process.stdout.write((e.stdout || '') + '\n  (exit non-zero)\n');
    failed++;
    return ['?', '?', 'FAIL'];
  }
}

for (const [label, file] of JS_SUITES) {
  const [p, f, st] = runNode(file);
  summary.push([label, p, f, st]);
}

// Python workflow validator
try {
  const out = execFileSync('python3', [path.join(__dirname, '..', 'scripts', 'validate_workflows.py')], { encoding: 'utf8' });
  process.stdout.write(out);
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const ok = m && m[2] === '0';
  if (!ok) failed++;
  summary.push(['validate_workflows.py', m ? m[1] : '?', m ? m[2] : '?', ok ? 'PASS' : 'FAIL']);
} catch (e) {
  process.stdout.write((e.stdout || '') + '\n  (python validator exit non-zero)\n');
  failed++;
  summary.push(['validate_workflows.py', '?', '?', 'FAIL']);
}

// Sheets contract validator (static: every workflow Sheets node targets a declared tab; no drift).
try {
  const out = execFileSync('node', [path.join(__dirname, '..', 'tools', 'validate_sheet_contracts.js')], { encoding: 'utf8' });
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const ok = m && m[2] === '0';
  if (!ok) { failed++; process.stdout.write(out); }
  summary.push(['validate_sheet_contracts', m ? m[1] : '?', m ? m[2] : '?', ok ? 'PASS' : 'FAIL']);
} catch (e) {
  process.stdout.write((e.stdout || '') + '\n  (sheet contract validator exit non-zero)\n');
  failed++;
  summary.push(['validate_sheet_contracts', '?', '?', 'FAIL']);
}

// Stage 3 sheets bootstrap: contract resolver + generated QA workflow must be drift-free.
try {
  execFileSync('node', [path.join(__dirname, '..', 'n8n', 'lib', 'sheets_contract_resolver.js')], { encoding: 'utf8' });
  execFileSync('node', [path.join(__dirname, '..', 'tools', 'gen_sheets_bootstrap_workflow.js'), '--check'], { encoding: 'utf8' });
  summary.push(['sheets_bootstrap_gen (drift)', 'ok', '0', 'PASS']);
} catch (e) {
  process.stdout.write((e.stdout || '') + (e.stderr || '') + '\n  (sheets bootstrap resolver/generator drift)\n');
  failed++;
  summary.push(['sheets_bootstrap_gen (drift)', '?', '?', 'FAIL']);
}

// Stage 3C sheets operations acceptance: generated manual QA workflow must be drift-free.
try {
  execFileSync('node', [path.join(__dirname, '..', 'tools', 'gen_sheets_operations_qa_workflow.js'), '--check'], { encoding: 'utf8' });
  summary.push(['sheets_ops_qa_gen (drift)', 'ok', '0', 'PASS']);
} catch (e) {
  process.stdout.write((e.stdout || '') + (e.stderr || '') + '\n  (sheets operations QA generator drift)\n');
  failed++;
  summary.push(['sheets_ops_qa_gen (drift)', '?', '?', 'FAIL']);
}

// Legacy Lead Scout harness (WF12/13/14) — must remain green.
try {
  const out = execFileSync('node', [path.join(__dirname, '..', 'n8n', 'fixtures', 'lead_scout', 'run_all.js')], { encoding: 'utf8' });
  const m = out.match(/ALL SUITES PASS/);
  if (!m) failed++;
  summary.push(['lead_scout (WF12/13/14)', m ? 'all' : '?', m ? '0' : '?', m ? 'PASS' : 'FAIL']);
} catch (e) {
  failed++;
  summary.push(['lead_scout (WF12/13/14)', '?', '?', 'FAIL']);
}

console.log('\n================ STAGE C HARDENING — REGRESSION SUMMARY ================');
for (const [label, p, f, st] of summary) {
  console.log('  [' + st + ']  ' + String(label).padEnd(26) + '  passed=' + p + ' failed=' + f);
}
console.log('  ' + (failed ? failed + ' SUITE(S) FAILED' : 'ALL SUITES PASS') + '   (external calls=0, live cost=$0)');
process.exit(failed ? 1 : 0);
