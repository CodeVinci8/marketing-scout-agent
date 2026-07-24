'use strict';
// deploy_workflow_jscode.js — canonical, surgical, NON-structural workflow deploy.
//
// Purpose: push a repo workflow's Code-node `jsCode` (and executeWorkflow `workflowInputs`) into a LIVE production
// export, preserving everything installation-local (node ids, credentials, connections, webhookId, typeVersion,
// positions, the workflow id/active/settings, and every executeWorkflow `workflowId` binding). This is the safe
// path for a pure logic change (embedded library refresh) that adds/removes NO nodes and rewires NOTHING.
//
// It DELIBERATELY refuses any structural change: if the repo and prod node-NAME sets differ, or a matched node's
// type differs, it aborts. Adding a node or rewiring connections is a STRUCTURAL deploy (a different, heavier tool)
// — never silently attempted here. This replaces the throwaway scratchpad `deploy_sync.js` prior sessions used, so
// the surgical deploy path is now canonical and reviewable in-repo.
//
// Usage:
//   node tools/deploy_workflow_jscode.js <prod_export.json> <repo_workflow.json> <merged_out.json>
// Exit 0 = merged output written (report on stdout); non-zero = aborted, nothing written.

const fs = require('fs');

function die(msg) { console.error('ABORT: ' + msg); process.exit(2); }
function loadWf(p) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { die('cannot read/parse ' + p + ': ' + e.message); }
  // `n8n export:workflow --output` may emit a single object or a 1-element array.
  if (Array.isArray(obj)) { if (obj.length !== 1) die(p + ': expected exactly one workflow, got ' + obj.length); return { wf: obj[0], wrapped: true }; }
  return { wf: obj, wrapped: false };
}

const [prodPath, repoPath, outPath] = process.argv.slice(2);
if (!prodPath || !repoPath || !outPath) die('usage: deploy_workflow_jscode.js <prod_export.json> <repo_workflow.json> <merged_out.json>');

const prodLoad = loadWf(prodPath);
const prod = prodLoad.wf;
const repo = loadWf(repoPath).wf;
const prodNodes = Array.isArray(prod.nodes) ? prod.nodes : die('prod has no nodes[]');
const repoNodes = Array.isArray(repo.nodes) ? repo.nodes : die('repo has no nodes[]');

// --- structural guard: identical node-NAME sets (no add/remove) ---
const pNames = prodNodes.map(n => n.name).sort();
const rNames = repoNodes.map(n => n.name).sort();
const prodOnly = pNames.filter(n => rNames.indexOf(n) < 0);
const repoOnly = rNames.filter(n => pNames.indexOf(n) < 0);
if (prodOnly.length || repoOnly.length) {
  die('STRUCTURAL node-set mismatch — this tool only syncs jsCode, it cannot add/remove nodes.\n' +
      '  prod-only: ' + JSON.stringify(prodOnly) + '\n  repo-only: ' + JSON.stringify(repoOnly));
}

const repoByName = {};
repoNodes.forEach(n => { repoByName[n.name] = n; });

const isCode = t => String(t || '').endsWith('.code');
const isExecWf = t => /executeWorkflow/i.test(String(t || ''));

const changed = [];
prodNodes.forEach(pn => {
  const rn = repoByName[pn.name];
  if (String(pn.type) !== String(rn.type)) {
    die('type change on node "' + pn.name + '": prod=' + pn.type + ' repo=' + rn.type + ' (structural — refused)');
  }
  pn.parameters = pn.parameters || {};
  if (isCode(pn.type)) {
    const before = String(pn.parameters.jsCode || '');
    const after = String((rn.parameters || {}).jsCode || '');
    if (!after) die('repo node "' + pn.name + '" has empty jsCode — refusing to blank a prod Code node');
    if (before !== after) {
      pn.parameters.jsCode = after;
      changed.push({ node: pn.name, kind: 'jsCode', from_bytes: before.length, to_bytes: after.length });
    }
  } else if (isExecWf(pn.type) && (rn.parameters || {}).workflowInputs !== undefined) {
    // Sync workflowInputs (schema mapping) but NEVER the installation-local workflowId binding.
    const before = JSON.stringify(pn.parameters.workflowInputs || null);
    const after = JSON.stringify(rn.parameters.workflowInputs);
    if (before !== after) {
      pn.parameters.workflowInputs = JSON.parse(after);
      changed.push({ node: pn.name, kind: 'workflowInputs' });
    }
  }
});

// Sanity: we started from prod, so ids/credentials/connections/active/webhookId are untouched by construction.
const out = prodLoad.wrapped ? [prod] : prod;
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

console.log('workflow: ' + (prod.name || '(unnamed)') + ' id=' + (prod.id || '?') + ' active=' + prod.active);
console.log('nodes: ' + prodNodes.length + ' (name-set identical to repo)');
if (!changed.length) { console.log('no jsCode/workflowInputs differences — prod already matches repo'); }
else { console.log('changed ' + changed.length + ' node(s):'); changed.forEach(c => console.log('  - ' + c.node + ' [' + c.kind + ']' + (c.from_bytes != null ? ' ' + c.from_bytes + '→' + c.to_bytes + 'B' : ''))); }
console.log('wrote ' + outPath);
