// smoke_report.js — compute the machine-readable disposable-import metrics from an EXPORTED workflow directory
// (QA-007/011). Run inside the disposable container after import/bind/export. Prints KEY=VALUE lines that the
// shell smoke greps; never mutates anything. Pure + offline.
//
// Usage: node tools/smoke_report.js <exportedDir> [bindReport.json]
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./manifest_lib.js');
const B = require('./bind_n8n_workflow_ids.js');

function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/smoke_report.js <exportedDir> [bindReport.json]'); process.exit(2); }

  const expected = L.deployment().runtime_workflow_count;
  const runtimeNames = new Set(L.runtimeClosure().map(f => L.workflowName(f)));

  // read every exported workflow
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const nameCounts = {};
  let active = 0;
  for (const f of files) {
    const wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const nm = String(wf.name == null ? '' : wf.name).trim();
    nameCounts[nm] = (nameCounts[nm] || 0) + 1;
    if (wf.active === true) active++;
  }

  let imported = 0, duplicates = 0, extra = 0;
  for (const nm of Object.keys(nameCounts)) {
    if (runtimeNames.has(nm)) { imported++; if (nameCounts[nm] > 1) duplicates += (nameCounts[nm] - 1); }
    else extra++;
  }
  const missing = [];
  for (const nm of runtimeNames) if (!nameCounts[nm]) missing.push(nm);

  // bindings: verify against the exported dir
  let resolved = 0, placeholders = 0, edgesExpected = L.bindingEdges().length;
  try {
    const v = B.bindDir(dir, { verify: true });
    resolved = v.bindings_resolved; placeholders = v.placeholders_remaining;
  } catch (e) { placeholders = -1; }

  // callable triggers: every callable target present in the export must carry an Execute Sub-workflow Trigger
  const TRIGGER = 'n8n-nodes-base.executeWorkflowTrigger';
  const byName = {};
  for (const f of files) { const wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); byName[String(wf.name || '').trim()] = wf; }
  let callableTriggers = 0;
  for (const cf of L.callableTargets()) {
    const wf = byName[L.workflowName(cf)];
    if (wf && (wf.nodes || []).some(n => n.type === TRIGGER)) callableTriggers++;
  }

  console.log('RUNTIME_WORKFLOWS_EXPECTED=' + expected);
  console.log('RUNTIME_WORKFLOWS_IMPORTED=' + imported);
  console.log('MISSING_WORKFLOWS=' + missing.length);
  console.log('EXTRA_WORKFLOWS=' + extra);
  console.log('DUPLICATE_WORKFLOWS=' + duplicates);
  console.log('PLACEHOLDER_BINDINGS=' + placeholders);
  console.log('BINDING_EDGES_EXPECTED=' + edgesExpected);
  console.log('RESOLVED_EDGES=' + resolved);
  console.log('CALLABLE_TRIGGERS_VALID=' + callableTriggers);
  console.log('ACTIVE_WORKFLOWS=' + active);
  if (missing.length) console.log('MISSING_NAMES=' + missing.join('|'));
}

main();
