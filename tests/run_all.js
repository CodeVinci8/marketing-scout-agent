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
  ['ci-workflow', 'test_ci_workflow.js'],
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
