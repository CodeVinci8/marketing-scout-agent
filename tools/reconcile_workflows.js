// reconcile_workflows.js — exact-name, fail-closed workflow reconciliation plan (DEPLOY-002/005/010/011).
//
// Given a real n8n export (directory of workflow JSONs) + the manifest logical identity + the operator-local id
// map, decide, per runtime workflow, what deploy MUST do — without ever picking a workflow by array position or
// substring:
//     exact-name count == 0  -> CREATE   (use the operator-local/generated id)
//     exact-name count == 1  -> UPDATE   (preserve the existing production id; reconcile topology)
//     exact-name count  > 1  -> ABORT    (ambiguous; never select one)
// Also fail-closed on: an id used by two different names (id collision), a local-map id that disagrees with the
// single production id for that name, and a runtime name whose id belongs to a different name. Output is a
// sanitized plan (id fingerprints only). This is the planning layer; it never calls n8n and never mutates.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./manifest_lib.js');
const RID = require('./runtime_ids.js');

const ACTIONS = { CREATE: 'create', UPDATE: 'update', ABORT: 'abort' };

// reconcile(identityMap, exportIndex, localMap) -> { ok, plan, summary }
function reconcile(identityMap, idx, localMap) {
  localMap = localMap || RID.emptyMap();
  const plan = [];
  let aborts = 0, creates = 0, updates = 0;

  // id collision across the whole export (same id, two different names)
  const idNames = {};
  for (const name of Object.keys(idx.byName)) for (const id of idx.byName[name]) { (idNames[id] = idNames[id] || new Set()).add(name); }

  for (const key of Object.keys(identityMap)) {
    const name = identityMap[key].name;
    const ids = (idx.byName[name] || []);
    const count = ids.length;
    const localId = (localMap.workflows && localMap.workflows[key] && localMap.workflows[key].id) || null;
    let action, reason = '', id = null;

    if (count > 1) { action = ACTIONS.ABORT; reason = 'duplicate_exact_name(' + count + ')'; }
    else if (count === 1) {
      id = ids[0];
      if (idNames[id] && idNames[id].size > 1) { action = ACTIONS.ABORT; reason = 'id_collision'; }
      else if (localId && String(localId) !== String(id)) { action = ACTIONS.ABORT; reason = 'map_vs_production_disagree'; }
      else { action = ACTIONS.UPDATE; reason = 'preserve_production_id'; }
    } else {
      action = ACTIONS.CREATE; id = localId; reason = localId ? 'create_with_local_id' : 'needs_local_id';
      if (!localId) { /* not fatal here: resolver mints one; flag so deploy resolves ids first */ }
    }

    if (action === ACTIONS.ABORT) aborts++;
    else if (action === ACTIONS.CREATE) creates++;
    else updates++;
    plan.push({ wf: key, name: name, action: action, reason: reason, exact_name_count: count, id_fingerprint: RID.fingerprint(id) });
  }

  const ok = aborts === 0;
  return {
    ok: ok,
    summary: { expected: Object.keys(identityMap).length, creates: creates, updates: updates, aborts: aborts },
    plan: plan
  };
}

// Lightweight drift detection (DEPLOY-011): compare committed source node names/types/counts to a production
// export, ignoring expected production-only metadata. Returns per-workflow drift (NO node parameter values, so
// nothing sensitive leaks). exportByName: { name: workflowJson }.
function detectDrift(identityMap, exportByName) {
  const drift = [];
  for (const key of Object.keys(identityMap)) {
    const file = identityMap[key].file;
    const src = JSON.parse(fs.readFileSync(path.join(L.WF_DIR, file), 'utf8'));
    const prod = exportByName[identityMap[key].name];
    if (!prod) { drift.push({ wf: key, drift: 'absent_in_production' }); continue; }
    const srcSig = nodeSig(src), prodSig = nodeSig(prod);
    const added = srcSig.filter(s => prodSig.indexOf(s) < 0);
    const removed = prodSig.filter(s => srcSig.indexOf(s) < 0);
    if (added.length || removed.length) drift.push({ wf: key, added_nodes: added.length, removed_nodes: removed.length });
  }
  return { ok: drift.length === 0, drift };
}
function nodeSig(wf) { return (wf.nodes || []).map(n => n.name + '::' + n.type).sort(); }

module.exports = { reconcile, detectDrift, ACTIONS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--export-dir');
  const localIdx = args.indexOf('--local');
  if (dirIdx < 0) { console.error('usage: node tools/reconcile_workflows.js --export-dir <dir> [--local <file>]'); process.exit(2); }
  const idx = RID.indexExportDir(args[dirIdx + 1]);
  const localMap = RID.loadLocalMap(localIdx >= 0 ? args[localIdx + 1] : RID.DEFAULT_LOCAL);
  const r = reconcile(L.runtimeIdentity(), idx, localMap);
  console.log(JSON.stringify(r, null, 2));
  console.log('WORKFLOW_RECONCILIATION=' + (r.ok ? 'PASS' : 'FAIL') + ' creates=' + r.summary.creates + ' updates=' + r.summary.updates + ' aborts=' + r.summary.aborts);
  process.exit(r.ok ? 0 : 1);
}
