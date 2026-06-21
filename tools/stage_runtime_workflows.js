// stage_runtime_workflows.js — copy the runtime-closure workflows into a staging directory with a DETERMINISTIC
// workflow id injected into each (QA-002/QA-003). n8n 2.23.3's `import:workflow` requires a non-null workflow id
// (verified: importing an id-less template fails with "NOT NULL constraint failed: workflow_entity.id"). The
// committed templates intentionally carry no id, so deploy/smokes stage them with a stable id first. Stable ids
// also make import idempotent (re-import updates the same row) and let the binder resolve every edge to a known
// target id by exact workflow name.
//
// The id is a deterministic UUID-shaped string derived from the workflow number, e.g. WF04 ->
// 00000000-0000-4000-8000-000000000004, so it never collides and is reproducible across runs.
//
// Library: stageRuntime(outDir) -> { idByFile, files }. CLI: node tools/stage_runtime_workflows.js <outDir>
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./manifest_lib.js');

// Deterministic UUID-shaped id from a workflow file's leading number (unique within the runtime set).
function deterministicId(file) {
  const num = (String(file).match(/^(\d+)/) || [])[1] || '00';
  return '00000000-0000-4000-8000-0000000000' + num.padStart(2, '0').slice(-2);
}

function stageRuntime(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const order = L.importOrder();
  const idByFile = {};
  for (const file of order) {
    const wf = JSON.parse(fs.readFileSync(path.join(L.WF_DIR, file), 'utf8'));
    wf.id = deterministicId(file);
    idByFile[file] = wf.id;
    fs.writeFileSync(path.join(outDir, file), JSON.stringify(wf, null, 2) + '\n');
  }
  return { idByFile: idByFile, files: order.slice() };
}

module.exports = { stageRuntime, deterministicId };

if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tools/stage_runtime_workflows.js <outDir>'); process.exit(2); }
  const r = stageRuntime(out);
  for (const f of r.files) console.log(f + '\t' + r.idByFile[f]);
}
