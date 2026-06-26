// prepare_staged_workflows.js — produce STAGED, deploy-ready workflow JSON the release path imports instead of
// the raw committed source (DEPLOY-002/008, §8). The committed templates carry no id, a PASTE_WORKFLOW_ID
// binding placeholder, and a PASTE_CREDENTIAL_ID_HERE credential placeholder; importing them raw is exactly the
// defect that produced "(assigned on import)" ids and forced a manual "attach credentials in the UI" step.
//
// For each runtime workflow this writes a staged copy that carries:
//   * the RESOLVED installation-local id (from config/runtime_ids.local.json via the resolver) — never minted here;
//   * active = false (hard-enforced regardless of source);
//   * resolved Execute Sub-workflow binding ids (PASTE_WORKFLOW_ID -> the target's resolved id), by exact
//     caller-node + manifest edge — never by node position;
//   * reconciled credential ids (PASTE_CREDENTIAL_ID_HERE -> the unique compatible production credential of the
//     same type), preserving the operator's existing credentials automatically. AMBIGUOUS credential types
//     (more than one of a type) ABORT — never auto-pick. Types with no production credential yet stay placeholder
//     and are reported as deferred (operator attaches once).
//
// Pure: identity + id map + (optional) non-decrypted credential metadata in, staged files + a SANITIZED report
// out (fingerprints only, never a raw id/name/secret). The caller supplies the inputs; no n8n/docker/network.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./manifest_lib.js');
const RID = require('./runtime_ids.js');

const EXECUTE_WORKFLOW = 'n8n-nodes-base.executeWorkflow';
const WF_PLACEHOLDER = 'PASTE_WORKFLOW_ID';
const CRED_PLACEHOLDER_RE = /paste|changeme|change_me|your[-_]|placeholder|todo|<[^>]+>|replace[-_]?me/i;
function fp(s) { return s == null || s === '' ? 'fp_none' : 'fp_' + crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 10); }

// Map manifest WF key -> resolved id from the local map; throws if a key is unresolved (deploy must resolve first).
function idByKey(identity, localMap) {
  const out = {};
  for (const key of Object.keys(identity)) {
    const e = (localMap.workflows || {})[key];
    out[key] = e && e.id ? String(e.id) : null;
  }
  return out;
}
// fileName -> WF key
function keyByFile(identity) { const m = {}; for (const k of Object.keys(identity)) m[identity[k].file] = k; return m; }

// Choose the unique compatible production credential per type from a NON-decrypted credential export
// ([{id,name,type}]). Returns { byType:{type:id}, ambiguous:[type], single:{type:count} }.
function credentialsByType(credExport) {
  const byTypeIds = {};
  for (const c of (credExport || [])) { const t = String(c.type); (byTypeIds[t] = byTypeIds[t] || []).push(String(c.id)); }
  const byType = {}, ambiguous = [];
  for (const t of Object.keys(byTypeIds)) {
    const ids = Array.from(new Set(byTypeIds[t]));
    if (ids.length === 1) byType[t] = ids[0];
    else ambiguous.push(t);
  }
  return { byType, ambiguous };
}

// prepareStaged({ identity, localMap, credExport|null, outDir|null }) -> { ok, errors, staged, summary }
// When outDir is null the files are staged in-memory only (the returned staged[].json carries the object).
function prepareStaged(opts) {
  opts = opts || {};
  const identity = opts.identity || L.runtimeIdentity();
  const localMap = opts.localMap || RID.emptyMap();
  const ids = idByKey(identity, localMap);
  const fkey = keyByFile(identity);
  const edges = L.bindingEdges();
  const cred = credentialsByType(opts.credExport || null);
  const errors = [];
  const staged = [];
  let bindingsResolved = 0, bindingsUnresolved = 0, credsResolved = 0, credsDeferred = 0;
  let credAmbiguousHit = false;

  if (opts.outDir) fs.mkdirSync(opts.outDir, { recursive: true });

  for (const file of L.importOrder()) {
    const key = fkey[file];
    const wf = JSON.parse(fs.readFileSync(path.join(L.WF_DIR, file), 'utf8'));
    // 1) resolved installation-local id (never minted here)
    if (!ids[key]) { errors.push('unresolved id for ' + key + ' (' + file + ') — run: node tools/runtime_ids.js resolve --apply'); continue; }
    wf.id = ids[key];
    // 2) hard-enforce inactive
    wf.active = false;
    // 3) resolve bindings + credentials per node
    for (const node of (wf.nodes || [])) {
      // bindings
      if (node.type === EXECUTE_WORKFLOW && node.parameters && node.parameters.workflowId) {
        const w = node.parameters.workflowId;
        if (String(w.value) === WF_PLACEHOLDER) {
          // resolve via the manifest edge: this file is the caller, node.name is the caller node
          const edge = edges.find(e => e.caller_node === node.name && L.workflowName(e.caller_workflow) === wf.name);
          const targetKey = edge ? fkey[edge.target_workflow] : null;
          if (targetKey && ids[targetKey]) { w.value = ids[targetKey]; w.mode = 'id'; bindingsResolved++; }
          else { bindingsUnresolved++; errors.push('unresolved binding in ' + file + ' :: ' + node.name); }
        }
      }
      // credentials
      if (node.credentials) {
        for (const type of Object.keys(node.credentials)) {
          const c = node.credentials[type] || {};
          if (c.id == null || !CRED_PLACEHOLDER_RE.test(String(c.id))) { credsResolved++; continue; }
          if (cred.ambiguous.indexOf(type) >= 0) { credAmbiguousHit = true; errors.push('ambiguous production credential for type ' + type + ' — refusing to auto-select (' + file + ' :: ' + node.name + ')'); continue; }
          if (cred.byType[type]) { c.id = cred.byType[type]; credsResolved++; }
          else { credsDeferred++; }
        }
      }
    }
    if (opts.outDir) fs.writeFileSync(path.join(opts.outDir, file), JSON.stringify(wf, null, 2) + '\n');
    staged.push({ file: file, wf_key: key, id_fingerprint: fp(wf.id), name: wf.name, active: wf.active });
  }

  const ok = errors.length === 0 && !credAmbiguousHit;
  return {
    ok: ok,
    errors: errors,
    staged: staged,
    summary: {
      staged_count: staged.length,
      bindings_resolved: bindingsResolved, bindings_unresolved: bindingsUnresolved,
      credentials_resolved: credsResolved, credentials_deferred: credsDeferred,
      credential_types_ambiguous: cred.ambiguous,
      all_inactive: staged.every(s => s.active === false)
    }
  };
}

module.exports = { prepareStaged, credentialsByType, fp, WF_PLACEHOLDER };

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const outDir = val('--out');
  if (!outDir) { console.error('usage: node tools/prepare_staged_workflows.js --out <dir> [--local <map>] [--cred-export <metadata.json>]'); process.exit(2); }
  let localMap = RID.emptyMap();
  try { localMap = RID.loadLocalMap(val('--local') || RID.DEFAULT_LOCAL); } catch (e) { console.error('STAGE_ERROR: ' + e.message); process.exit(1); }
  let credExport = null;
  const ce = val('--cred-export');
  if (ce) { try { credExport = JSON.parse(fs.readFileSync(ce, 'utf8')); } catch (e) { console.error('STAGE_ERROR: bad cred export: ' + e.message); process.exit(1); } }
  const r = prepareStaged({ localMap, credExport, outDir });
  console.log(JSON.stringify(r.summary, null, 2));
  if (!r.ok) { r.errors.forEach(e => console.log('  - ' + e)); console.log('PREPARE_STAGED=FAIL'); process.exit(1); }
  console.log('PREPARE_STAGED=PASS staged=' + r.summary.staged_count + ' bindings=' + r.summary.bindings_resolved +
    ' creds_resolved=' + r.summary.credentials_resolved + ' creds_deferred=' + r.summary.credentials_deferred + ' (out=' + outDir + ')');
}
