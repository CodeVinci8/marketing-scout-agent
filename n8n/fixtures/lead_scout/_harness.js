// _harness.js — deterministic $0 local test harness for the Lead Scout workflows (Stage C.1).
// Runs the ACTUAL n8n Code-node `jsCode` extracted from the workflow JSON under minimal n8n shims,
// so tests exercise the real workflow logic (not a copy). NO network, NO external calls, NO creds.
//
// A "run" holds:
//   - outputs:    map nodeName -> array of n8n items ({json:{...}})
//   - staticData: the shared object returned by $getWorkflowStaticData('global')
//
// Code nodes reference upstream nodes via $('Node Name').all()/.first(), the immediate input via
// $input.all()/.first(), and persistent state via $getWorkflowStaticData('global').
'use strict';
const fs = require('fs');
const path = require('path');

const WF_DIR = path.join(__dirname, '..', '..', 'workflows');

function loadWorkflow(file) {
  return JSON.parse(fs.readFileSync(path.join(WF_DIR, file), 'utf8'));
}

function getNodeCode(wf, name) {
  const n = (wf.nodes || []).find(x => x.name === name);
  if (!n) throw new Error('node not found: ' + name);
  if (!n.parameters || typeof n.parameters.jsCode !== 'string') {
    throw new Error('node is not a Code node with jsCode: ' + name);
  }
  return n.parameters.jsCode;
}

function makeRun() {
  return { outputs: Object.create(null), staticData: {} };
}

// inject sheet-read / fixture data as a node output (rows = array of plain json objects)
function inject(run, name, rows) {
  run.outputs[name] = (rows || []).map(j => ({ json: j }));
  return run.outputs[name];
}

// run a real Code node from a workflow; inputItems = array of {json} (the immediate predecessor output)
function runCodeNode(run, wf, name, inputItems) {
  const code = getNodeCode(wf, name);
  inputItems = inputItems || [];

  const $ = (nm) => {
    const out = run.outputs[nm];
    if (out === undefined) throw new Error('$("' + nm + '") referenced before it was produced');
    return {
      all: () => out.map(i => ({ json: i.json })),
      first: () => ({ json: (out[0] && out[0].json) || {} }),
      last: () => ({ json: (out[out.length - 1] && out[out.length - 1].json) || {} }),
    };
  };
  const $input = {
    all: () => inputItems.map(i => ({ json: i.json })),
    first: () => ({ json: (inputItems[0] && inputItems[0].json) || {} }),
    get item() { return { json: (inputItems[0] && inputItems[0].json) || {} }; },
  };
  const $getWorkflowStaticData = () => run.staticData;

  const fn = new Function('$', '$input', '$getWorkflowStaticData', code);
  const res = fn($, $input, $getWorkflowStaticData);
  const items = Array.isArray(res) ? res : (res ? [res] : []);
  run.outputs[name] = items;
  return items;
}

// ---- tiny assertion kit -------------------------------------------------------
const RESULTS = [];
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  RESULTS.push({ ok, label, got, want });
  return ok;
}
function ok(label, cond, detail) {
  RESULTS.push({ ok: !!cond, label, got: detail === undefined ? cond : detail, want: true });
  return !!cond;
}
function section(title) { RESULTS.push({ section: title }); }
function reset() { RESULTS.length = 0; }
function report(title) {
  let pass = 0, fail = 0;
  const lines = [];
  lines.push('\n===== ' + title + ' =====');
  for (const r of RESULTS) {
    if (r.section) { lines.push('\n-- ' + r.section + ' --'); continue; }
    if (r.ok) { pass++; lines.push('  PASS  ' + r.label); }
    else {
      fail++;
      lines.push('  FAIL  ' + r.label + '\n        got=' + JSON.stringify(r.got) + '\n        want=' + JSON.stringify(r.want));
    }
  }
  lines.push('\n  ' + title + ': ' + pass + ' passed, ' + fail + ' failed');
  console.log(lines.join('\n'));
  return { pass, fail };
}

module.exports = {
  loadWorkflow, getNodeCode, makeRun, inject, runCodeNode,
  eq, ok, section, reset, report,
};
