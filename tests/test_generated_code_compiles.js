'use strict';
// test_generated_code_compiles.js — offline safety net for the "Identifier 'MS_TZ' has already been declared"
// class of release-blocking defect (an embedded module leaking a top-level identifier that collides with node
// glue, a duplicate const, a malformed template, a truncated string, an invalid escape, etc.).
//
// It compiles — never executes — EVERY n8n Code node body in:
//   1. every committed workflow JSON under n8n/workflows/ and ops/n8n/workflows/ (the authoritative import
//      surface: exactly what the operator imports into n8n), and
//   2. the in-memory build() output of every generator (gen_stage4 WF17-26, the Stage 3C ops-QA workflow, and
//      the Stage 3 bootstrap workflow) — so a composition defect is caught at GENERATION time, before the file
//      is ever written or committed.
//
// "Compile" = new Function(body): Node parses the body (catching every SyntaxError, including duplicate lexical
// declarations) without running it, so there are zero external calls and zero side-effects. Each body is parsed
// AS-IS to faithfully mirror how the n8n Code node sandbox parses it. On failure the workflow file/name and the
// offending node name are reported.
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WF_DIRS = [path.join(ROOT, 'n8n', 'workflows'), path.join(ROOT, 'ops', 'n8n', 'workflows')];

function isCode(node) { return node && node.type === 'n8n-nodes-base.code'; }
function codeBody(node) { return (node.parameters && node.parameters.jsCode) || ''; }

// Compile every Code node in one workflow object. Returns { count, failures:[{node, error}] }.
function compileWorkflow(wf) {
  const out = { count: 0, failures: [] };
  for (const node of (wf.nodes || [])) {
    if (!isCode(node)) continue;
    out.count++;
    const body = codeBody(node);
    if (typeof body !== 'string' || body.trim() === '') { out.failures.push({ node: node.name, error: 'empty jsCode' }); continue; }
    try { new Function(body); } // parse-only: never executed, no side-effects, no network
    catch (e) { out.failures.push({ node: node.name, error: e.message }); }
  }
  return out;
}

function detail(label, res) {
  return res.failures.map(function (f) { return label + ' :: node "' + f.node + '" -> ' + f.error; }).join('\n        ');
}

let totalNodes = 0, totalWorkflows = 0;

// ---- 1) committed workflow JSON (the real import surface) ----------------------------------------------------
A.section('committed workflow JSON Code nodes compile');
for (const dir of WF_DIRS) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).sort();
  for (const file of files) {
    let wf;
    try { wf = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }
    catch (e) { A.ok(file + ' parses as JSON', false, e.message); continue; }
    const res = compileWorkflow(wf);
    totalWorkflows++; totalNodes += res.count;
    A.ok(path.relative(ROOT, path.join(dir, file)) + ' — ' + res.count + ' Code node(s) compile',
      res.failures.length === 0, detail(file + ' [' + (wf.name || '') + ']', res));
  }
}

// ---- 2) in-memory generator build() output (catches defects before they are written) -------------------------
A.section('generator build() output Code nodes compile (in-memory, no disk writes)');

// gen_stage4_workflows.js records every workflow it builds; requiring it (not main) writes nothing to disk.
try {
  const stage4 = require('../tools/gen_stage4_workflows.js');
  A.ok('gen_stage4 builds WF17-26 in memory', Array.isArray(stage4.generated) && stage4.generated.length === 10,
    'generated=' + (stage4.generated ? stage4.generated.length : 'none'));
  for (const g of (stage4.generated || [])) {
    const res = compileWorkflow(g.workflow);
    A.ok('gen_stage4 ' + g.file + ' — ' + res.count + ' Code node(s) compile', res.failures.length === 0,
      detail(g.file + ' [' + (g.workflow.name || '') + ']', res));
  }
} catch (e) { A.ok('gen_stage4 generator loads and builds', false, e.message); }

// Stage 3C operations-QA generator (the one that carried the MS_TZ collision) and the Stage 3 bootstrap.
for (const spec of [
  ['gen_sheets_operations_qa_workflow.js', '../tools/gen_sheets_operations_qa_workflow.js'],
  ['gen_sheets_bootstrap_workflow.js', '../tools/gen_sheets_bootstrap_workflow.js']
]) {
  try {
    const gen = require(spec[1]);
    const wf = gen.build().workflow;
    const res = compileWorkflow(wf);
    A.ok(spec[0] + ' build() — ' + res.count + ' Code node(s) compile', res.failures.length === 0,
      detail(spec[0] + ' [' + (wf.name || '') + ']', res));
  } catch (e) { A.ok(spec[0] + ' build() compiles', false, e.message); }
}

// ---- 3) coverage guard: no Code node may go unchecked --------------------------------------------------------
A.section('coverage');
A.ok('committed workflows were scanned', totalWorkflows > 0, 'workflows=' + totalWorkflows);
A.ok('a meaningful number of Code nodes were compiled', totalNodes >= 100, 'nodes=' + totalNodes);

// Regression anchor: the exact node that failed the live Stage 3C retest must be present AND compile.
(function () {
  const file = path.join(ROOT, 'ops', 'n8n', 'workflows', 'qa_stage3_sheets_operations_acceptance.json');
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const node = (wf.nodes || []).find(function (n) { return n.name === 'Init, Guard & Embed Engine'; });
  A.ok('Stage 3C "Init, Guard & Embed Engine" node still exists', !!node);
  let okc = false; try { new Function(codeBody(node)); okc = true; } catch (e) { okc = false; }
  A.ok('Stage 3C "Init, Guard & Embed Engine" compiles (the MS_TZ regression)', okc);
  // the engine's private MS_TZ must live inside the IIFE, never at the node top level (proves isolation, not rename)
  A.ok('engine MS_TZ is isolated inside an IIFE namespace', /const __sheetsOpsQa = \(function \(\) \{/.test(codeBody(node)));
})();

A.report('GENERATED CODE COMPILATION (' + totalWorkflows + ' committed workflows, ' + totalNodes + ' Code nodes)');
