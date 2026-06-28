// bind_n8n_workflow_ids.js — deterministic, idempotent post-import binder for the eight Execute Sub-workflow
// edges (QA-002 / QA-009). After n8n assigns an id to every imported workflow and they are EXPORTED back to a
// directory, each caller still carries workflowId.value="PASTE_WORKFLOW_ID". This tool rewrites that value to the
// REAL assigned id of the target workflow, matched by EXACT workflow name and EXACT caller-node name — never by
// node-array position and never by substring.
//
// The eight edges come from config/workflow_manifest.json (the single source of truth), via manifest_lib. For
// each edge it resolves:
//   caller  = exported workflow whose name == manifest name of edge.caller_workflow
//   node    = caller node whose name == edge.caller_node   (must exist, must be executeWorkflow)
//   target  = exported workflow whose name == manifest name of edge.target_workflow
// and sets node.parameters.workflowId.value = target.id  (mode:"id").
//
// Fail-closed: rejects missing/empty/duplicate/ambiguous workflow names, a missing caller node, a caller node of
// the wrong type, or a missing target. Never activates or publishes anything (active is left untouched). A second
// run is a no-op. Emits a machine-readable JSON report.
//
// Usage:
//   node tools/bind_n8n_workflow_ids.js --dir <exported_dir> [--report <file.json>]   # bind (writes files)
//   node tools/bind_n8n_workflow_ids.js --dir <exported_dir> --verify                 # check only, no writes
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./manifest_lib.js');

const EXECUTE_WORKFLOW = 'n8n-nodes-base.executeWorkflow';
const PLACEHOLDER = 'PASTE_WORKFLOW_ID';

// Fingerprint a raw n8n id for SAFE logging (DEPLOY-003 / SECURITY-005): the report and --verify output must NEVER
// carry a raw installation workflow id. A PASTE_WORKFLOW_ID placeholder is not an id, so it is shown verbatim so an
// unbound edge is still diagnosable; everything else becomes fp_<sha10>.
function fp(v) {
  const s = v == null ? '' : String(v);
  if (s === '' ) return 'fp_none';
  if (s === PLACEHOLDER) return PLACEHOLDER;
  return 'fp_' + crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
}

// Read every *.json workflow in an exported directory; index by exact workflow name. Detects duplicate/empty names.
function loadExportedDir(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const byName = {};      // name -> {id, file, path, json}
  const nameCounts = {};  // name -> count (to detect duplicates / ambiguity)
  let emptyNames = 0;
  for (const f of files) {
    const p = path.join(dir, f);
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    const name = String(json.name == null ? '' : json.name).trim();
    if (!name) { emptyNames++; continue; }
    nameCounts[name] = (nameCounts[name] || 0) + 1;
    byName[name] = { id: json.id == null ? '' : String(json.id), file: f, path: p, json: json };
  }
  return { files, byName, nameCounts, emptyNames };
}

// Count remaining PASTE_WORKFLOW_ID placeholders across every executeWorkflow node in the directory.
function countPlaceholders(loaded) {
  let n = 0;
  for (const name of Object.keys(loaded.byName)) {
    const wf = loaded.byName[name].json;
    for (const node of (wf.nodes || [])) {
      if (node.type !== EXECUTE_WORKFLOW) continue;
      const w = node.parameters && node.parameters.workflowId;
      if (w && String(w.value) === PLACEHOLDER) n++;
    }
  }
  return n;
}

function allInactive(loaded) {
  return Object.keys(loaded.byName).every(name => loaded.byName[name].json.active === false);
}

// Resolve the eight manifest edges into concrete caller-node/target-id operations against the exported dir.
function planBindings(loaded) {
  const edges = L.bindingEdges();
  const errors = [];
  const ops = [];     // {edge, callerEntry, node, targetId}
  let missingTargets = 0, ambiguousTargets = 0;

  for (const e of edges) {
    const callerName = L.workflowName(e.caller_workflow);
    const targetName = L.workflowName(e.target_workflow);

    if (loaded.nameCounts[callerName] > 1) { ambiguousTargets++; errors.push('ambiguous caller name in export: ' + callerName); continue; }
    if (loaded.nameCounts[targetName] > 1) { ambiguousTargets++; errors.push('ambiguous target name in export: ' + targetName); continue; }
    const caller = loaded.byName[callerName];
    const target = loaded.byName[targetName];
    if (!caller) { missingTargets++; errors.push('caller workflow not found in export: ' + callerName); continue; }
    if (!target) { missingTargets++; errors.push('target workflow not found in export: ' + targetName + ' (for ' + e.caller_node + ')'); continue; }
    if (!target.id) { missingTargets++; errors.push('target workflow has no assigned id: ' + targetName); continue; }

    const matches = (caller.json.nodes || []).filter(n => n.name === e.caller_node);
    if (matches.length === 0) { errors.push('caller node not found by exact name: ' + callerName + ' :: ' + e.caller_node); continue; }
    if (matches.length > 1) { ambiguousTargets++; errors.push('ambiguous caller node name: ' + callerName + ' :: ' + e.caller_node); continue; }
    const node = matches[0];
    if (node.type !== (e.expected_caller_type || EXECUTE_WORKFLOW)) {
      errors.push('caller node wrong type: ' + callerName + ' :: ' + e.caller_node + ' is ' + node.type); continue;
    }
    ops.push({ edge: e, callerEntry: caller, node: node, targetId: target.id, targetName: targetName });
  }
  return { ops, errors, missingTargets, ambiguousTargets };
}

// Bind (or verify) the directory. opts: { write: bool, verify: bool }.
function bindDir(dir, opts) {
  opts = opts || {};
  const verify = !!opts.verify;
  const write = verify ? false : (opts.write !== false);
  const loaded = loadExportedDir(dir);
  const expected = L.bindingEdges().length;

  const duplicateWorkflows = Object.keys(loaded.nameCounts).filter(n => loaded.nameCounts[n] > 1).length;
  const plan = planBindings(loaded);

  let resolved = 0;
  const touched = new Map(); // path -> json (deduped writes; preserves caller workflow ids)
  const edgeReport = [];
  for (const op of plan.ops) {
    const w = op.node.parameters.workflowId;
    const before = String(w.value);
    const already = before === op.targetId;
    if (verify) {
      if (already) resolved++;
      else plan.errors.push('binding not resolved to target id: ' + op.callerEntry.json.name + ' :: ' + op.edge.caller_node + ' = ' + fp(before));
    } else {
      if (!already) {
        w.value = op.targetId;
        w.mode = 'id';
        if (!w.cachedResultName) w.cachedResultName = op.edge.caller_wf;
        touched.set(op.callerEntry.path, op.callerEntry.json);
      }
      resolved++;
    }
    edgeReport.push({
      caller_wf: op.edge.caller_wf, caller_node: op.edge.caller_node, target_wf: op.edge.target_wf,
      target_workflow: op.edge.target_workflow, target_id_fp: fp(op.targetId),
      previous_value_fp: fp(before), action: already ? 'noop' : (verify ? 'verify' : 'bound')
    });
  }

  if (write) for (const [p, json] of touched) fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n');

  // recount placeholders against the (possibly mutated) in-memory state
  const placeholders = countPlaceholders(loaded);

  const report = {
    bindings_expected: expected,
    bindings_resolved: resolved,
    placeholders_remaining: placeholders,
    missing_targets: plan.missingTargets,
    ambiguous_targets: plan.ambiguousTargets,
    duplicate_workflows: duplicateWorkflows,
    all_inactive: allInactive(loaded),
    edges: edgeReport,
    errors: plan.errors,
    files_written: write ? Array.from(touched.keys()).map(p => path.basename(p)) : []
  };
  const okClose =
    report.bindings_resolved === report.bindings_expected &&
    report.placeholders_remaining === 0 &&
    report.missing_targets === 0 &&
    report.ambiguous_targets === 0 &&
    report.duplicate_workflows === 0 &&
    report.all_inactive === true &&
    report.errors.length === 0;
  report.ok = okClose;
  return report;
}

module.exports = { loadExportedDir, countPlaceholders, allInactive, planBindings, bindDir, EXECUTE_WORKFLOW, PLACEHOLDER };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  if (dirIdx < 0 || !args[dirIdx + 1]) { console.error('usage: node tools/bind_n8n_workflow_ids.js --dir <exported_dir> [--verify] [--report <file>]'); process.exit(2); }
  const dir = args[dirIdx + 1];
  const verify = args.indexOf('--verify') >= 0;
  const repIdx = args.indexOf('--report');
  let report;
  try {
    report = bindDir(dir, { verify: verify, write: !verify });
  } catch (e) {
    console.error('BIND_ERROR: ' + e.message); process.exit(1);
  }
  const out = JSON.stringify(report, null, 2);
  if (repIdx >= 0 && args[repIdx + 1]) fs.writeFileSync(args[repIdx + 1], out + '\n');
  console.log(out);
  process.exit(report.ok ? 0 : 1);
}
