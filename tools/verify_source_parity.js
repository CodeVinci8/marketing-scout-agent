// verify_source_parity.js — RELEASE-SOURCE-PARITY-001.
//
// Proves CONTENT equality between what is actually running in production and the canonical branch — not just
// that ids/bindings/credentials reconcile (which the credential audit already covers), but that every node's
// type/params/credential-ref and the whole connection graph match. It compares:
//   * the LIVE production workflow export (n8n export:workflow --all --separate -> <id>.json), against
//   * the STAGED canonical set (tools/prepare_staged_workflows.js: committed source resolved to the production
//     ids/bindings/credential references, active=false) — i.e. exactly what an inactive apply would import.
//
// Both sides are stripped of installation-local + n8n-generated metadata (versionId/createdAt/updatedAt/
// triggerCount/meta/pinData/staticData/shared/tags/... and per-node webhookId), key-sorted (canonical JSON),
// and SHA-256 fingerprinted. Each of the 15 runtime workflows is matched to its production counterpart by the
// resolved id and compared by fingerprint.
//
// SANITIZED: it reports by committed FILE NAME (public repo path) and SHA fingerprints ONLY — never a raw
// workflow id, credential id/name, webhook secret or node content. Pure + offline once the two dirs exist.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./manifest_lib.js');
const RID = require('./runtime_ids.js');

// n8n-managed / installation-local top-level fields that are NOT canonical workflow content.
const STRIP_TOP = new Set([
  'id', 'activeVersionId', 'createdAt', 'updatedAt', 'versionId', 'versionCounter', 'versionMetadata',
  'triggerCount', 'isArchived', 'meta', 'pinData', 'staticData', 'shared', 'tags', 'nodeGroups',
  'homeProject', 'scopes', 'ownedBy', 'sharedWith', 'description'
]);
// per-node fields n8n assigns on import (not authored content).
const STRIP_NODE = new Set(['webhookId']);

// A node credential reference is { <type>: { id, name } }. The BINDING is (type, id) — that is the canonical
// content we verify. The cached `name` is installation-local: the committed template ships the canonical
// placeholder name ("Google Sheets - Marketing Scout Service Account"), but n8n resolves and re-emits the
// operator's ACTUAL credential name from the id on export, so the names legitimately differ on a real VPS even
// though the binding is identical. Normalise to (type -> id) so a name-only difference is NOT counted as drift,
// while a wrong/absent credential id still drifts.
function canonCreds(creds) {
  const out = {};
  for (const type of Object.keys(creds || {})) {
    const ref = creds[type] || {};
    out[type] = { id: ref.id == null ? null : String(ref.id) };
  }
  return out;
}

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function fp10(s) { return 'fp_' + sha(String(s)).slice(0, 10); }
// deterministic deep key-sort so JSON.stringify is canonical regardless of source key order.
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}
function canonNode(n) {
  const c = {};
  for (const k of Object.keys(n)) if (!STRIP_NODE.has(k)) c[k] = n[k];
  if (c.credentials) c.credentials = canonCreds(c.credentials);
  return sortDeep(c);
}
// Canonical projection: only authored content. Nodes are sorted by id so node ARRAY order never causes drift.
function canon(wf) {
  const nodes = (wf.nodes || []).map(canonNode)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)) || String(a.name).localeCompare(String(b.name)));
  return {
    name: wf.name == null ? '' : String(wf.name),
    active: wf.active === true,
    settings: sortDeep(wf.settings || {}),
    connections: sortDeep(wf.connections || {}),
    nodes: nodes
  };
}
// per-section fingerprints (sanitized) so drift can be localized WITHOUT printing any content.
function sectionFps(c) {
  return {
    name: fp10(c.name),
    active: c.active,
    settings: fp10(JSON.stringify(c.settings)),
    connections: fp10(JSON.stringify(c.connections)),
    nodes: fp10(JSON.stringify(c.nodes)),
    whole: fp10(JSON.stringify(c))
  };
}

function loadExportById(dir) {
  const byId = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let wf; try { wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    if (wf && wf.id != null) byId[String(wf.id)] = wf;
  }
  return byId;
}

function verify(opts) {
  const identity = L.runtimeIdentity();
  const fkeys = Object.keys(identity);
  const localMap = opts.localMap || RID.loadLocalMap(RID.DEFAULT_LOCAL);
  const prodById = loadExportById(opts.prodDir);
  const rows = [];
  let matched = 0, drifted = 0, missing = 0;

  for (const file of L.importOrder()) {
    const key = fkeys.find(k => identity[k].file === file);
    const idEntry = (localMap.workflows || {})[key];
    const resolvedId = idEntry && idEntry.id ? String(idEntry.id) : null;
    const stagedPath = path.join(opts.stagedDir, file);
    if (!resolvedId) { rows.push({ file, status: 'NO_ID' }); missing++; continue; }
    if (!fs.existsSync(stagedPath)) { rows.push({ file, status: 'NO_STAGED' }); missing++; continue; }
    const prodWf = prodById[resolvedId];
    if (!prodWf) { rows.push({ file, status: 'NOT_IN_PRODUCTION', id_fp: fp10(resolvedId) }); missing++; continue; }

    const stagedC = canon(JSON.parse(fs.readFileSync(stagedPath, 'utf8')));
    const prodC = canon(prodWf);
    const sFp = sectionFps(stagedC), pFp = sectionFps(prodC);
    const ok = sFp.whole === pFp.whole;
    if (ok) matched++; else drifted++;
    const diffSections = ok ? [] : ['name', 'active', 'settings', 'connections', 'nodes']
      .filter(s => JSON.stringify(sFp[s]) !== JSON.stringify(pFp[s]));
    rows.push({ file, status: ok ? 'MATCH' : 'DRIFT', id_fp: fp10(resolvedId),
      staged_fp: sFp.whole, prod_fp: pFp.whole, drift_sections: diffSections });
  }
  return { rows, matched, drifted, missing, total: L.importOrder().length };
}

module.exports = { verify, canon, sectionFps, sortDeep, STRIP_TOP, STRIP_NODE };

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const prodDir = val('--prod'), stagedDir = val('--staged');
  if (!prodDir || !stagedDir) {
    console.error('usage: node tools/verify_source_parity.js --prod <prod_export_dir> --staged <staged_dir> [--local <map>]');
    process.exit(2);
  }
  let localMap; try { localMap = RID.loadLocalMap(val('--local') || RID.DEFAULT_LOCAL); }
  catch (e) { console.error('PARITY_ERROR: ' + e.message); process.exit(1); }
  const r = verify({ prodDir, stagedDir, localMap });
  console.log('----- source parity (sanitized; file names + fingerprints only) -----');
  for (const row of r.rows) {
    if (row.status === 'MATCH') console.log('  MATCH   ' + row.file + '  ' + row.prod_fp);
    else if (row.status === 'DRIFT') console.log('  DRIFT   ' + row.file + '  staged=' + row.staged_fp + ' prod=' + row.prod_fp + '  sections=[' + row.drift_sections.join(',') + ']');
    else console.log('  ' + row.status + '  ' + row.file);
  }
  console.log('PRODUCTION_SOURCE_PARITY_MATCHED=' + r.matched);
  console.log('PRODUCTION_SOURCE_PARITY_DRIFTED=' + r.drifted);
  console.log('PRODUCTION_SOURCE_PARITY_MISSING=' + r.missing);
  const pass = r.drifted === 0 && r.missing === 0 && r.matched === r.total;
  console.log('PRODUCTION_SOURCE_PARITY=' + (pass ? 'PASS' : 'FAIL'));
  process.exit(pass ? 0 : 1);
}
