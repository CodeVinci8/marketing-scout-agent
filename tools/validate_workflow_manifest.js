// validate_workflow_manifest.js — fail-closed consistency check between config/workflow_manifest.json and the
// actual workflow JSONs (QA-001/008/015). Rejects: a manifest entry with no file or a file with no entry; a
// runtime file missing from the closure; a duplicate workflow name or duplicate number WITHIN the runtime set;
// a dependency cycle; a binding edge whose target is missing / not in the runtime set; a binding edge whose
// caller node or type does not exist; a callable target lacking an Execute Sub-workflow Trigger; a callable in
// any activation list; a scheduled workflow with no feature flag; a test/manual workflow inside the runtime set;
// any runtime workflow not expected_active=false. Also asserts the committed manifest is not stale.
//
// runChecks(manifest) is a pure function (workflow JSONs read from disk, manifest passed in) so the rejection
// rules are unit-testable with a mutated manifest. The CLI prints "<N> passed, <M> failed" and exits non-zero
// on any failure. Pure + offline ($0).
'use strict';
const fs = require('fs');
const path = require('path');
const { build } = require('./gen_workflow_manifest.js');

const ROOT = path.join(__dirname, '..');
const WF_DIR = path.join(ROOT, 'n8n', 'workflows');
const MANIFEST = path.join(ROOT, 'config', 'workflow_manifest.json');
const EXECUTE_WORKFLOW = 'n8n-nodes-base.executeWorkflow';
const EXECUTE_WORKFLOW_TRIGGER = 'n8n-nodes-base.executeWorkflowTrigger';
const SCHEDULE = ['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.cron'];

// Pure checker. Reads the workflow JSONs from disk (they are the ground truth) but takes the manifest object as
// an argument so a test can mutate it and prove a specific rejection. Returns { passed, failed, fails }.
function runChecks(m) {
  let passed = 0, failed = 0;
  const fails = [];
  const ok = (name, cond) => { if (cond) passed++; else { failed++; fails.push(name); } };

  const d = m.deployment;
  ok('manifest has a deployment section', !!d);
  if (!d) return { passed, failed, fails };

  const onDisk = new Set(fs.readdirSync(WF_DIR).filter(f => f.endsWith('.json')));
  const entryByFile = {}; (m.workflows || []).forEach(w => { entryByFile[w.file] = w; });

  // entry<->file bijection
  for (const w of (m.workflows || [])) ok('manifest entry has a file on disk: ' + w.file, onDisk.has(w.file));
  for (const f of onDisk) ok('file on disk has a manifest entry: ' + f, !!entryByFile[f]);

  // load every workflow once
  const wf = {}; for (const f of onDisk) wf[f] = JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8'));

  // runtime membership: every runtime file exists; runtime count == closure length
  const runtime = new Set(d.runtime_closure);
  for (const f of d.runtime_closure) ok('runtime file present: ' + f, onDisk.has(f));
  ok('runtime_workflow_count matches closure length', d.runtime_workflow_count === d.runtime_closure.length);
  ok('runtime closure has exactly 18 workflows (+WF27 Discovery)', d.runtime_closure.length === 18);

  // import order must be a permutation of the closure, with every callable target before any caller that binds it
  ok('import_order is a permutation of the runtime closure',
    d.import_order.length === d.runtime_closure.length && d.import_order.every(f => runtime.has(f)) && new Set(d.import_order).size === d.import_order.length);
  const pos = {}; d.import_order.forEach((f, i) => { pos[f] = i; });
  for (const e of d.binding_edges) ok('import order places dependency before caller: ' + e.target_workflow + ' < ' + e.caller_workflow,
    pos[e.target_workflow] != null && pos[e.caller_workflow] != null && pos[e.target_workflow] < pos[e.caller_workflow]);

  // duplicate name / number WITHIN the runtime set (the 02_* variants legitimately share WF02 but are excluded)
  const rNames = {}, rNums = {};
  for (const f of d.runtime_closure) {
    const nm = String(wf[f].name || ''); rNames[nm] = (rNames[nm] || 0) + 1;
    const num = (f.match(/^(\d+)/) || [])[1] || ''; rNums[num] = (rNums[num] || 0) + 1;
  }
  ok('no duplicate workflow NAME in runtime set', Object.keys(rNames).every(n => rNames[n] === 1));
  ok('no duplicate workflow NUMBER in runtime set', Object.keys(rNums).every(n => rNums[n] === 1));

  // test/manual/optional must not be inside the runtime set
  for (const w of (m.workflows || [])) {
    if (!runtime.has(w.file)) continue;
    ok('runtime member is not a manual_diagnostic/optional role: ' + w.file,
      ['entrypoint', 'orchestration', 'callable_dependency'].indexOf(w.deployment_role) >= 0);
    ok('runtime member expected_active=false: ' + w.file, w.expected_active === false && wf[w.file].active === false);
  }

  // binding edges: count, target presence, caller node + type, target trigger, no edge without a runtime dependency
  ok('binding_edge_count matches edges length', d.binding_edge_count === d.binding_edges.length);
  ok('exactly 17 runtime binding edges (+WF18 -> WF27 Discovery)', d.binding_edges.length === 17);
  for (const e of d.binding_edges) {
    const caller = wf[e.caller_workflow];
    ok('binding caller exists in runtime: ' + e.caller_workflow, !!caller && runtime.has(e.caller_workflow));
    const node = caller && (caller.nodes || []).find(n => n.name === e.caller_node);
    ok('binding caller node exists: ' + e.caller_workflow + ' :: ' + e.caller_node, !!node);
    ok('binding caller node is executeWorkflow: ' + e.caller_node, !!node && node.type === EXECUTE_WORKFLOW);
    ok('binding target in runtime closure: ' + e.target_workflow, runtime.has(e.target_workflow));
    const tgt = wf[e.target_workflow];
    ok('binding target has Execute Sub-workflow Trigger: ' + e.target_workflow,
      !!tgt && (tgt.nodes || []).some(n => n.type === EXECUTE_WORKFLOW_TRIGGER));
    ok('binding edge expects correct trigger type', e.expected_target_trigger === EXECUTE_WORKFLOW_TRIGGER);
  }

  // every executeWorkflow node in a runtime workflow MUST be covered by a binding edge (binding without dependency)
  const edgeKeys = new Set(d.binding_edges.map(e => e.caller_workflow + '::' + e.caller_node));
  for (const f of d.runtime_closure) {
    for (const n of (wf[f].nodes || [])) {
      if (n.type === EXECUTE_WORKFLOW) ok('executeWorkflow node has a binding edge: ' + f + ' :: ' + n.name, edgeKeys.has(f + '::' + n.name));
    }
  }

  // dependency cycle check over runtime binding edges
  const adj = {}; d.binding_edges.forEach(e => { (adj[e.caller_workflow] = adj[e.caller_workflow] || []).push(e.target_workflow); });
  let cyclic = false; const WHITE = 0, GREY = 1, BLACK = 2; const color = {};
  function dfs(u) { color[u] = GREY; for (const v of (adj[u] || [])) { if (color[v] === GREY) cyclic = true; else if ((color[v] || WHITE) === WHITE) dfs(v); } color[u] = BLACK; }
  Object.keys(adj).forEach(u => { if ((color[u] || WHITE) === WHITE) dfs(u); });
  ok('no dependency cycle among binding edges', !cyclic);

  // activation: no callable in any activation list; scheduled runtime workflow must carry a feature flag
  const callable = new Set(d.callable_targets);
  const actAll = [].concat(d.activation.always, d.activation.when_monitoring, d.activation.when_weekly_digest);
  for (const f of actAll) ok('activation entry is NOT a callable target: ' + f, !callable.has(f));
  for (const f of d.runtime_closure) {
    const scheduled = (wf[f].nodes || []).some(n => SCHEDULE.indexOf(n.type) >= 0);
    if (!scheduled) continue;
    const flagged = d.activation.when_monitoring.indexOf(f) >= 0 || d.activation.when_weekly_digest.indexOf(f) >= 0;
    ok('scheduled runtime workflow is gated by a feature flag: ' + f, flagged);
  }
  ok('callable_trigger_count equals callable target count (14)', d.activation.callable_trigger_count === 14);

  return { passed, failed, fails };
}

function main() {
  const fileText = fs.readFileSync(MANIFEST, 'utf8');
  const m = JSON.parse(fileText);
  const r = runChecks(m);
  // committed manifest must not be stale (disk-bound check, kept out of the pure checker)
  if (JSON.stringify(build(), null, 2) + '\n' === fileText) r.passed++;
  else { r.failed++; r.fails.push('committed manifest matches generator output (not stale)'); }

  if (r.fails.length) { console.log('FAILURES:'); r.fails.forEach(f => console.log('  - ' + f)); }
  console.log('===== validate_workflow_manifest =====');
  console.log('  ' + r.passed + ' passed, ' + r.failed + ' failed');
  process.exit(r.failed ? 1 : 0);
}

module.exports = { runChecks, MANIFEST, WF_DIR };

if (require.main === module) main();
