// run_all.js — run every Lead Scout deterministic test ($0, no network) and print a PASS/FAIL table.
// Usage: node n8n/fixtures/lead_scout/run_all.js
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const TESTS = [
  ['WF14 triage (vectors A+B+repeat)', 'run_wf14_triage.test.js'],
  ['WF13 fixture + monitored sim',     'run_wf13_monitored.test.js'],
  ['WF12 report redaction',            'run_wf12_redaction.test.js'],
];

let failed = 0;
const summary = [];
for (const [label, file] of TESTS) {
  try {
    const out = execFileSync('node', [path.join(__dirname, file)], { encoding: 'utf8' });
    const m = out.match(/(\d+) passed, (\d+) failed/);
    console.log(out);
    summary.push([label, m ? m[1] : '?', m ? m[2] : '?', m && m[2] === '0' ? 'PASS' : 'FAIL']);
    if (!m || m[2] !== '0') failed++;
  } catch (e) {
    console.log(e.stdout || '');
    console.log('  (process exited non-zero)');
    summary.push([label, '?', '?', 'FAIL']);
    failed++;
  }
}

console.log('\n================ LEAD SCOUT HARNESS SUMMARY ================');
for (const [label, p, f, st] of summary) {
  console.log('  [' + st + ']  ' + label.padEnd(34) + '  passed=' + p + ' failed=' + f);
}
console.log('  ' + (failed ? failed + ' SUITE(S) FAILED' : 'ALL SUITES PASS') + '  ($0, no network)');
process.exit(failed ? 1 : 0);
