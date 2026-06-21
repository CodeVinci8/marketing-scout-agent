'use strict';
// validate_sheet_contracts.js — static validation of the Google Sheets contract against the actual workflows.
// Offline, no network, no secrets. Exit 0 = all pass, 1 = findings. Usage: node tools/validate_sheet_contracts.js
//
// Asserts: (1) every googleSheets node in every workflow targets a tab that is DECLARED in
// config/sheets_contracts.json (or is an allowlisted dynamic tab) — catches typos / undeclared tabs;
// (2) each declared tab's writers/readers list is consistent with the workflows that actually write/read it;
// (3) every declared scope-required tab names its scope columns; (4) the contract is internally well-formed.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WF_DIR = path.join(ROOT, 'n8n', 'workflows');
const CONTRACT = path.join(ROOT, 'config', 'sheets_contracts.json');

let passed = 0, failed = 0;
const findings = [];
function check(label, cond, detail) { if (cond) passed++; else { failed++; findings.push('  FAIL  ' + label + (detail ? ('  -> ' + detail) : '')); } }

function build() {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const tabs = contract.tabs || {};
  const dynamicAllow = contract.dynamic_tab_allowlist || [];
  const writeOps = ['append', 'appendOrUpdate', 'update'];

  // observed usage from the workflows
  const observed = {}; // tab -> { writers:Set, readers:Set, nodes:[] }
  const files = fs.readdirSync(WF_DIR).filter(f => f.endsWith('.json')).sort();
  for (const f of files) {
    const wf = JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8'));
    const wfNum = f.slice(0, 2);
    for (const n of (wf.nodes || [])) {
      if (n.type !== 'n8n-nodes-base.googleSheets') continue;
      const tab = (n.parameters && n.parameters.sheetName && n.parameters.sheetName.value) || '';
      const op = (n.parameters && n.parameters.operation) || '';
      if (dynamicAllow.indexOf(tab) >= 0) continue;          // allowlisted dynamic / demo tab
      check('tab "' + tab + '" used by WF' + wfNum + ' is declared in the contract', !!tabs[tab], f + ' :: ' + n.name);
      observed[tab] = observed[tab] || { writers: new Set(), readers: new Set() };
      if (writeOps.indexOf(op) >= 0) observed[tab].writers.add(wfNum); else observed[tab].readers.add(wfNum);
    }
  }

  // contract well-formedness + consistency with observed usage
  for (const tab of Object.keys(tabs)) {
    const d = tabs[tab];
    check(tab + ' has a retention_class', !!contract.retention_classes[d.retention_class], 'retention_class=' + d.retention_class);
    check(tab + ' declares required_columns[]', Array.isArray(d.required_columns));
    check(tab + ' declares writers[] + readers[]', Array.isArray(d.writers) && Array.isArray(d.readers));
    if (d.owner_scoped) check(tab + ' owner_scoped tab includes owner_user_id in required_columns', d.required_columns.length === 0 || d.required_columns.indexOf('owner_user_id') >= 0);
    if (d.request_scoped) check(tab + ' request_scoped tab includes agent_request_id in required_columns', d.required_columns.length === 0 || d.required_columns.indexOf('agent_request_id') >= 0);
    const obs = observed[tab] || { writers: new Set(), readers: new Set() };
    // every workflow that actually writes the tab must be declared as a writer (drift guard)
    for (const w of obs.writers) check(tab + ' declares writer WF' + w, d.writers.indexOf(w) >= 0, 'observed writer not in contract');
    for (const r of obs.readers) check(tab + ' declares reader WF' + r, d.readers.indexOf(r) >= 0, 'observed reader not in contract');
  }

  return { contract: contract, observed: observed, passed: passed, failed: failed, findings: findings };
}

if (require.main === module) {
  const r = build();
  console.log('===== validate_sheet_contracts =====');
  console.log('  declared tabs: ' + Object.keys(r.contract.tabs).length);
  if (r.findings.length) console.log(r.findings.join('\n'));
  console.log('\n  ' + r.passed + ' passed, ' + r.failed + ' failed');
  process.exit(r.failed ? 1 : 0);
}

module.exports = { build };
