'use strict';
// deploy_workflow_structural.js — canonical STRUCTURAL workflow deploy (graft repo topology into a live export).
//
// Purpose: bring a production workflow to the repo's TOPOLOGY when the change ADDS nodes, REMOVES nodes or
// REWIRES connections (all of which the surgical jsCode tool, tools/deploy_workflow_jscode.js, refuses). It grafts
// the repo's nodes + connections onto the live prod export while keeping everything INSTALLATION-LOCAL:
//
//   * the production workflow id, active state, settings, meta, staticData and pinData are kept;
//   * an existing node keeps its production node id, its real credentials and its webhookId;
//   * an existing Execute Workflow node keeps its production workflowId binding (the repo ships the placeholder
//     "PASTE_WORKFLOW_ID", so adopting the repo parameters blindly would BREAK every sub-workflow call);
//   * connections are replaced wholesale from the canonical repo topology.
//
// This is the canonical, reviewable, in-repo replacement for the throwaway scratchpad graft_topology.js.
//
// CREDENTIAL SAFETY (mandatory). Production holds several credentials of the same type, so a type match alone is
// NOT identity. A NEW node's credential is resolved ONLY by, in order:
//   A. an explicit CLI mapping           --cred  "<node>=<credential name or id>"
//   B. inheritance from a named sibling  --inherit "<new node>=<existing node in this workflow>"
//   C. a repo cred id that already IS a real production cred id
//   D. a UNIQUE type match — accepted only when production has exactly ONE credential of that type
// Two or more candidates and no explicit instruction => ABORT with an actionable error. The tool never prints
// credential values, and it never picks a credential merely because the type matches.
//
// It ABORTS (writing nothing, importing nothing) when it cannot graft unambiguously:
//   * a production node has no repo counterpart and was not explicitly listed via --remove;
//   * an existing node's type changed (a type swap is not a graft);
//   * a credential cannot be resolved by rules A–D above;
//   * ANY node in the merged result still carries a placeholder credential id or placeholder workflow binding;
//   * a connection references a node that does not exist in the merged result;
//   * post-import parity verification finds the live workflow differs from what was intended.
//
// Usage:
//   # offline rehearsal against a captured export (no n8n contact at all)
//   node tools/deploy_workflow_structural.js --prod <prod_export.json> --repo <repo_workflow.json> [--out merged.json]
//
//   # live dry-run: export from n8n, graft, print the structural diff, write nothing to n8n
//   node tools/deploy_workflow_structural.js --id <prodWorkflowId> --repo <repo_workflow.json>
//
//   # live apply: backup -> graft -> import -> re-export -> parity verify -> print rollback command
//   node tools/deploy_workflow_structural.js --id <prodWorkflowId> --repo <repo_workflow.json> --apply
//
//   # rollback
//   node tools/deploy_workflow_structural.js --restore <backup.json>
//
// Options: --cred "<node>=<cred name|id>"  --inherit "<new node>=<sibling node>"  --remove "<node>"
//          --backup-dir <dir>  --container <name>  --out <file>
// Exit 0 = success; non-zero = aborted (nothing imported).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------------------------------
// Pure core (exported for offline unit testing — no IO, no n8n, no docker)
// ---------------------------------------------------------------------------------------------------

const EXECUTE_WORKFLOW_TYPE = 'n8n-nodes-base.executeWorkflow';

function isPlaceholderCredId(id) {
  const s = String(id == null ? '' : id);
  return !s || /^PASTE_/i.test(s) || s === 'REPLACE_ME';
}
// The repo ships "PASTE_WORKFLOW_ID" for every Execute Workflow binding; production carries the real local id.
function isPlaceholderWorkflowRef(v) {
  const s = String((v && typeof v === 'object' ? v.value : v) == null ? '' : (v && typeof v === 'object' ? v.value : v));
  return !s || /^PASTE_/i.test(s) || s === 'REPLACE_ME';
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function nodeByName(wf, name) { return (wf.nodes || []).find(n => n.name === name); }

// Normalized outgoing edges of one node, for a stable rewire diff: [outputIdx, targetName, targetIdx]
function edgesOf(connections, nodeName) {
  const c = (connections || {})[nodeName];
  const out = [];
  if (!c) return out;
  Object.keys(c).forEach(kind => {
    (c[kind] || []).forEach((branch, bi) => {
      (branch || []).forEach(e => out.push(kind + ':' + bi + '->' + e.node + ':' + (e.index || 0)));
    });
  });
  return out.sort();
}

// Build type -> [{id,name}] from a production export, using ONLY real (non-placeholder) credential ids.
function credentialRegistry(prodNodes) {
  const reg = {};
  prodNodes.forEach(n => {
    const creds = n.credentials || {};
    Object.keys(creds).forEach(type => {
      const c = creds[type] || {};
      if (isPlaceholderCredId(c.id)) return;
      reg[type] = reg[type] || [];
      if (!reg[type].some(x => x.id === c.id)) reg[type].push({ id: c.id, name: c.name });
    });
  });
  return reg;
}

/**
 * Graft the repo topology onto a production export.
 * @param {object} prod  live production workflow export
 * @param {object} repo  canonical repo workflow
 * @param {object} opts  { remove: [name], cred: {node: 'credNameOrId'}, inherit: {newNode: siblingNode} }
 * @returns {{out: object, report: object}}
 */
function graftWorkflow(prod, repo, opts) {
  opts = opts || {};
  const removeList = opts.remove || [];
  const credMap = opts.cred || {};
  const inheritMap = opts.inherit || {};

  const prodNodes = Array.isArray(prod.nodes) ? prod.nodes : null;
  const repoNodes = Array.isArray(repo.nodes) ? repo.nodes : null;
  if (!prodNodes) throw new Error('prod has no nodes[]');
  if (!repoNodes) throw new Error('repo has no nodes[]');

  const prodByName = {};
  prodNodes.forEach(n => { prodByName[n.name] = n; });
  const repoNames = {};
  repoNodes.forEach(n => { repoNames[n.name] = true; });

  // --- removals: only ever explicit. An unlisted prod-only node is an unmanaged deletion => abort.
  const prodOnly = prodNodes.filter(n => !repoNames[n.name]).map(n => n.name);
  const removed = prodOnly.filter(n => removeList.indexOf(n) >= 0);
  const unmanaged = prodOnly.filter(n => removeList.indexOf(n) < 0);
  if (unmanaged.length) {
    throw new Error('prod has node(s) absent from repo: ' + JSON.stringify(unmanaged) +
      ' — reconcile the repo first, or authorize the deletion explicitly with --remove "<node>"');
  }
  const bogusRemove = removeList.filter(n => prodOnly.indexOf(n) < 0);
  if (bogusRemove.length) {
    throw new Error('--remove named node(s) that are not prod-only: ' + JSON.stringify(bogusRemove) +
      ' — they either do not exist in production or still exist in the repo');
  }

  const credReg = credentialRegistry(prodNodes);

  // Resolve credentials for a NEW node — rules A–D from the header. Never guesses among several candidates.
  function resolveCredsForNewNode(nodeName, repoCreds) {
    const out = {};
    Object.keys(repoCreds || {}).forEach(type => {
      const want = repoCreds[type] || {};
      const pool = credReg[type] || [];

      // A. explicit CLI mapping: --cred "Node=<credential name or id>"
      const explicit = credMap[nodeName] || credMap[nodeName + '.' + type];
      if (explicit) {
        const hit = pool.filter(x => x.id === explicit || x.name === explicit);
        if (hit.length === 1) { out[type] = { id: hit[0].id, name: hit[0].name }; return; }
        throw new Error('--cred "' + nodeName + '=' + explicit + '" does not uniquely match a production credential' +
          ' of type "' + type + '" (matches: ' + hit.length + ')');
      }
      // B. inherit from a named sibling node that already exists in production
      const sibName = inheritMap[nodeName];
      if (sibName) {
        const sib = prodByName[sibName];
        if (!sib) throw new Error('--inherit "' + nodeName + '=' + sibName + '": node "' + sibName + '" does not exist in production');
        const sc = (sib.credentials || {})[type];
        if (!sc || isPlaceholderCredId(sc.id)) {
          throw new Error('--inherit "' + nodeName + '=' + sibName + '": node "' + sibName +
            '" has no real credential of type "' + type + '"');
        }
        out[type] = { id: sc.id, name: sc.name };
        return;
      }
      // C. the repo already names a real production credential id
      if (!isPlaceholderCredId(want.id) && pool.some(x => x.id === want.id)) {
        const m = pool.find(x => x.id === want.id);
        out[type] = { id: m.id, name: m.name };
        return;
      }
      // D. unique type match — the ONLY implicit resolution allowed
      if (pool.length === 0) {
        throw new Error('new node "' + nodeName + '" needs a credential of type "' + type +
          '" but production has none of that type');
      }
      if (pool.length === 1) { out[type] = { id: pool[0].id, name: pool[0].name }; return; }
      throw new Error('new node "' + nodeName + '" credential type "' + type + '" is ambiguous — production has ' +
        pool.length + ' credentials of that type (' + pool.map(x => JSON.stringify(x.name)).join(', ') +
        '). Refusing to pick one by type. Re-run with --inherit "' + nodeName +
        '=<existing node name>" or --cred "' + nodeName + '=<credential name>"');
    });
    return out;
  }

  const usedIds = {};
  prodNodes.forEach(n => { usedIds[n.id] = true; });
  function freshId(preferred) {
    if (preferred && !usedIds[preferred]) { usedIds[preferred] = true; return preferred; }
    let i = 1, cand;
    do { cand = 'ds_graft_' + i++; } while (usedIds[cand]);
    usedIds[cand] = true; return cand;
  }

  const report = {
    added: [], retained: [], removed: removed.slice(), rewired: [],
    params_changed: [], preserved_creds: [], preserved_bindings: []
  };

  const mergedNodes = repoNodes.map(rn => {
    const pn = prodByName[rn.name];
    if (!pn) {
      // NEW node: adopt the repo shape, assign a non-colliding id, resolve credentials by rules A–D.
      const merged = Object.assign({}, clone(rn), { id: freshId(rn.id) });
      if (rn.credentials !== undefined) merged.credentials = resolveCredsForNewNode(rn.name, rn.credentials);
      report.added.push(rn.name);
      return merged;
    }
    if (String(pn.type) !== String(rn.type)) {
      throw new Error('type change on existing node "' + rn.name + '": prod=' + pn.type + ' repo=' + rn.type +
        ' (a type swap is not a graft — reconcile manually)');
    }
    // EXISTING node: adopt the repo shape (parameters incl. jsCode, position, typeVersion) but keep every
    // installation-local field: node id, real credentials, webhookId and Execute Workflow bindings.
    const merged = Object.assign({}, clone(rn), { id: pn.id });
    if (pn.credentials !== undefined) { merged.credentials = clone(pn.credentials); report.preserved_creds.push(rn.name); }
    else if (rn.credentials !== undefined) { merged.credentials = resolveCredsForNewNode(rn.name, rn.credentials); }
    if (pn.webhookId !== undefined) merged.webhookId = pn.webhookId;
    // Requirement 8: the repo ships PASTE_WORKFLOW_ID — production is authoritative for sub-workflow bindings.
    const pWf = pn.parameters && pn.parameters.workflowId;
    if (pWf !== undefined && !isPlaceholderWorkflowRef(pWf)) {
      merged.parameters = merged.parameters || {};
      merged.parameters.workflowId = clone(pWf);
      report.preserved_bindings.push(rn.name);
    }
    report.retained.push(rn.name);
    if (JSON.stringify(pn.parameters || {}) !== JSON.stringify(merged.parameters || {})) report.params_changed.push(rn.name);
    return merged;
  });

  // Requirement 9: connections come only from the canonical repo topology.
  const connections = clone(repo.connections || {});
  const mergedNames = {};
  mergedNodes.forEach(n => { mergedNames[n.name] = true; });
  Object.keys(connections).forEach(src => {
    if (!mergedNames[src]) throw new Error('repo connections reference unknown source node "' + src + '"');
    Object.keys(connections[src]).forEach(kind => {
      (connections[src][kind] || []).forEach(branch => (branch || []).forEach(e => {
        if (!mergedNames[e.node]) throw new Error('repo connections reference unknown target node "' + e.node + '"');
      }));
    });
  });

  // Requirement 10: which nodes were rewired (edge set differs between prod and the repo topology).
  const wireNames = {};
  Object.keys(prod.connections || {}).forEach(n => { wireNames[n] = true; });
  Object.keys(connections).forEach(n => { wireNames[n] = true; });
  Object.keys(wireNames).sort().forEach(n => {
    if (removed.indexOf(n) >= 0) return; // already reported as removed
    if (JSON.stringify(edgesOf(prod.connections, n)) !== JSON.stringify(edgesOf(connections, n))) report.rewired.push(n);
  });

  // Requirements 3/4: installation-local workflow envelope stays production's.
  const out = Object.assign({}, clone(prod), { nodes: mergedNodes, connections: connections });

  // Fail-closed final gate (requirement 7): nothing placeholder may ever reach production.
  const bad = [];
  mergedNodes.forEach(n => {
    Object.keys(n.credentials || {}).forEach(type => {
      if (isPlaceholderCredId((n.credentials[type] || {}).id)) bad.push(n.name + ' [credential ' + type + ']');
    });
    if (n.type === EXECUTE_WORKFLOW_TYPE && isPlaceholderWorkflowRef(n.parameters && n.parameters.workflowId)) {
      bad.push(n.name + ' [Execute Workflow binding]');
    }
  });
  if (bad.length) throw new Error('placeholder value(s) would reach production: ' + JSON.stringify(bad) + ' — refusing to deploy');

  return { out, report };
}

// Requirement 1/10: human-readable structural diff.
function renderDiff(prod, out, report) {
  const L = [];
  L.push('workflow: ' + (prod.name || '(unnamed)') + '  id=' + (prod.id || '?') + '  active=' + prod.active);
  L.push('nodes: ' + (prod.nodes || []).length + ' -> ' + out.nodes.length);
  L.push('  added   (' + report.added.length + '): ' + (report.added.join(', ') || '-'));
  L.push('  removed (' + report.removed.length + '): ' + (report.removed.join(', ') || '-'));
  L.push('  retained(' + report.retained.length + '), of which parameters changed (' + report.params_changed.length + '): ' +
    (report.params_changed.join(', ') || '-'));
  L.push('  rewired (' + report.rewired.length + '): ' + (report.rewired.join(', ') || '-'));
  L.push('preserved production credentials on ' + report.preserved_creds.length + ' node(s); ' +
    'preserved Execute Workflow bindings on ' + report.preserved_bindings.length + ' node(s)');
  L.push('connections: replaced from the canonical repo topology');
  return L.join('\n');
}

/**
 * Requirement 11: compare what we intended to deploy with what n8n actually stored after the import.
 * Ignores server-managed fields (versionId, updatedAt, createdAt) and node ordering.
 * @returns {{ok: boolean, mismatches: string[]}}
 */
function verifyParity(expected, actual) {
  const m = [];
  if (String(expected.id) !== String(actual.id)) m.push('workflow id: expected ' + expected.id + ', got ' + actual.id);
  if (!!expected.active !== !!actual.active) m.push('active: expected ' + !!expected.active + ', got ' + !!actual.active);

  const eN = expected.nodes || [], aN = actual.nodes || [];
  const eNames = eN.map(n => n.name).sort(), aNames = aN.map(n => n.name).sort();
  if (JSON.stringify(eNames) !== JSON.stringify(aNames)) {
    eNames.filter(n => aNames.indexOf(n) < 0).forEach(n => m.push('node missing in production: ' + n));
    aNames.filter(n => eNames.indexOf(n) < 0).forEach(n => m.push('unexpected node in production: ' + n));
  }
  eN.forEach(en => {
    const an = aN.find(x => x.name === en.name);
    if (!an) return; // already reported
    if (String(en.id) !== String(an.id)) m.push('node id changed: ' + en.name + ' expected ' + en.id + ', got ' + an.id);
    if (String(en.type) !== String(an.type)) m.push('node type changed: ' + en.name);
    const ec = en.credentials || {}, ac = an.credentials || {};
    Object.keys(ec).forEach(t => {
      if (!ac[t]) { m.push('credential lost: ' + en.name + ' [' + t + ']'); return; }
      if (String(ec[t].id) !== String(ac[t].id)) m.push('credential rebound: ' + en.name + ' [' + t + ']');
    });
    if (JSON.stringify(en.parameters || {}) !== JSON.stringify(an.parameters || {})) m.push('parameters differ: ' + en.name);
  });
  if (JSON.stringify(expected.connections || {}) !== JSON.stringify(actual.connections || {})) m.push('connections differ');
  return { ok: m.length === 0, mismatches: m };
}

module.exports = {
  graftWorkflow, renderDiff, verifyParity, credentialRegistry,
  isPlaceholderCredId, isPlaceholderWorkflowRef, edgesOf
};

// ---------------------------------------------------------------------------------------------------
// CLI (IO + n8n) — everything above stays pure so the offline regression can prove the semantics at $0.
// ---------------------------------------------------------------------------------------------------

function die(msg) { console.error('ABORT: ' + msg); process.exit(2); }

function loadWf(p) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { die('cannot read/parse ' + p + ': ' + e.message); }
  if (Array.isArray(obj)) {
    if (obj.length !== 1) die(p + ': expected exactly one workflow, got ' + obj.length);
    return { wf: obj[0], wrapped: true };
  }
  return { wf: obj, wrapped: false };
}

function n8n(container, args) {
  return execFileSync('docker', ['exec', container, 'n8n'].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
// DEPLOY-CLEANUP-001: removing a scratch file inside the container is HOUSEKEEPING, never part of the deploy
// contract. `docker cp` writes as root while n8n runs as `node`, so the tidy-up `rm` fails with "Operation not
// permitted" — and when that threw, it aborted --apply AFTER the import but BEFORE the re-publish, leaving the
// production workflow imported-but-INACTIVE (observed live on WF12: active count 17 -> 16). Cleanup must never
// be able to change the outcome of a deploy.
function tryRm(container, file) {
  try { execFileSync('docker', ['exec', '-u', '0', container, 'rm', '-f', file], { encoding: 'utf8', stdio: 'pipe' }); return true; }
  catch (e) { console.error('  [warn] could not remove container scratch file ' + file + ' (harmless): ' + String(e.message).split('\n')[0]); return false; }
}

// A docker-mode export writes INSIDE the container (DEPLOY-001), so read it back out with `docker exec cat`.
function exportFromProd(container, id) {
  const inner = '/tmp/ds_export_' + Date.now() + '.json';
  n8n(container, ['export:workflow', '--id=' + id, '--output=' + inner, '--pretty']);
  const raw = execFileSync('docker', ['exec', container, 'cat', inner], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  tryRm(container, inner);
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function importToProd(container, wf) {
  const host = path.join(require('os').tmpdir(), 'ds_import_' + Date.now() + '.json');
  fs.writeFileSync(host, JSON.stringify([wf], null, 2) + '\n');
  const inner = '/tmp/' + path.basename(host);
  execFileSync('docker', ['cp', host, container + ':' + inner], { encoding: 'utf8' });
  const log = n8n(container, ['import:workflow', '--input=' + inner, '--activeState=false']);
  tryRm(container, inner);
  try { fs.unlinkSync(host); } catch (e) { /* housekeeping only */ }
  return log;
}

function parseKV(list, flag) {
  const out = {};
  list.forEach(s => {
    const i = s.indexOf('=');
    if (i <= 0) die(flag + ' expects "<key>=<value>", got: ' + s);
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  });
  return out;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = { apply: false, cred: [], inherit: [], remove: [], container: process.env.MS_N8N_CONTAINER || 'n8n-n8n-1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) die(a + ' requires a value'); return v; };
    if (a === '--apply') opt.apply = true;
    else if (a === '--dry-run') opt.apply = false;
    else if (a === '--prod') opt.prod = next();
    else if (a === '--repo') opt.repo = next();
    else if (a === '--id') opt.id = next();
    else if (a === '--out') opt.out = next();
    else if (a === '--restore') opt.restore = next();
    else if (a === '--backup-dir') opt.backupDir = next();
    else if (a === '--container') opt.container = next();
    else if (a === '--cred') opt.cred.push(next());
    else if (a === '--inherit') opt.inherit.push(next());
    else if (a === '--remove') opt.remove.push(next());
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
    else die('unknown argument: ' + a + ' (try --help)');
  }

  // Requirement 12: rollback path.
  if (opt.restore) {
    const back = loadWf(opt.restore).wf;
    console.log('restoring workflow id=' + back.id + ' name=' + back.name + ' from ' + opt.restore);
    console.log(importToProd(opt.container, back).trim());
    const after = exportFromProd(opt.container, back.id);
    const par = verifyParity(back, after);
    console.log(par.ok ? 'restore parity: OK' : 'restore parity FAILED:\n  ' + par.mismatches.join('\n  '));
    process.exit(par.ok ? 0 : 3);
  }

  if (!opt.repo) die('--repo <repo_workflow.json> is required');
  if (!opt.prod && !opt.id) die('provide --prod <export.json> (offline) or --id <prodWorkflowId> (live)');
  if (opt.apply && !opt.id) die('--apply requires --id <prodWorkflowId>');

  const repo = loadWf(opt.repo).wf;
  const prod = opt.prod ? loadWf(opt.prod).wf : exportFromProd(opt.container, opt.id);

  // Requirement 2: back up the production export BEFORE anything else.
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupDir = opt.backupDir || path.join(__dirname, '..', 'scratchpad', 'backup');
  let backupPath = null;
  if (opt.apply) {
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, 'wf' + prod.id + '_prod_' + stamp + '.json');
    fs.writeFileSync(backupPath, JSON.stringify([prod], null, 2) + '\n');
    console.log('backup: ' + backupPath);
  }

  let res;
  try {
    res = graftWorkflow(prod, repo, {
      remove: opt.remove, cred: parseKV(opt.cred, '--cred'), inherit: parseKV(opt.inherit, '--inherit')
    });
  } catch (e) { die(e.message); }

  console.log(renderDiff(prod, res.out, res.report));

  if (opt.out) { fs.writeFileSync(opt.out, JSON.stringify([res.out], null, 2) + '\n'); console.log('wrote ' + opt.out); }

  if (!opt.apply) { console.log('\nDRY RUN — nothing was imported. Re-run with --apply to deploy.'); process.exit(0); }

  console.log('\nimporting…');
  console.log(importToProd(opt.container, res.out).trim());
  if (prod.active) {
    // import:workflow always lands inactive; restore the production publication state.
    try { n8n(opt.container, ['publish:workflow', '--id=' + prod.id]); }
    catch (e) { n8n(opt.container, ['update:workflow', '--id=' + prod.id, '--active=true']); }
  }

  // Requirement 11: post-import export + parity verification against what we intended.
  const after = exportFromProd(opt.container, prod.id);
  const expected = Object.assign({}, res.out, { active: !!prod.active });
  const par = verifyParity(expected, after);
  console.log(par.ok ? '\nparity: OK — production matches the intended graft'
    : '\nPARITY FAILED:\n  ' + par.mismatches.join('\n  '));
  console.log('rollback: node tools/deploy_workflow_structural.js --restore ' + backupPath);
  process.exit(par.ok ? 0 : 3);
}
