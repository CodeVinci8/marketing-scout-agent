// test_source_parity.js — RELEASE-SOURCE-PARITY-001 regression for the content-parity verifier.
//
// Offline + pure ($0, no docker, no network): synthesises a production export dir and a staged dir for the REAL
// 15 runtime workflow keys, then proves the verifier (1) MATCHES when content is equal even though the prod side
// carries n8n-managed metadata (versionId/createdAt/triggerCount/meta/pinData/staticData/tags + per-node
// webhookId), (2) localises DRIFT to exactly the workflow whose node params changed, (3) flags a workflow that
// is missing from production, and (4) never prints a raw workflow id (sanitization).
'use strict';
const A = require('./_assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./../tools/manifest_lib.js');
const SP = require('./../tools/verify_source_parity.js');

const identity = L.runtimeIdentity();
const files = L.importOrder();
const keyByFile = {}; for (const k of Object.keys(identity)) keyByFile[identity[k].file] = k;

// synthetic resolved id per workflow key + a synthetic local map for the verifier.
const idForKey = k => 'PRODID-' + k;
const localMap = { workflows: {} };
for (const k of Object.keys(identity)) localMap.workflows[k] = { id: idForKey(k) };

// canonical authored content for one workflow (same on both sides unless we deliberately mutate it).
function authored(file, mutate, credId) {
  const nodes = [
    { id: 'n1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'n2', name: 'Do', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0],
      parameters: { jsCode: 'return [{json:{file:"' + file + '"' + (mutate ? ',drift:true' : '') + '}}];' } },
    // a credentialled node: the BINDING (type,id) is canonical content; the cached `name` is installation-local.
    { id: 'n3', name: 'Sheet', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, position: [400, 0], parameters: {},
      credentials: { googleApi: { id: credId || 'CRED-canon', name: 'Google Sheets - Marketing Scout Service Account' } } }
  ];
  return { name: file.replace('.json', ''), active: false, settings: { executionOrder: 'v1' }, connections: { Start: { main: [[{ node: 'Do', type: 'main', index: 0 }]] } }, nodes };
}
// the production side adds n8n-managed metadata that MUST be ignored by the comparator, and re-emits the
// operator's ACTUAL credential display name (different from the canonical placeholder) while keeping the id.
function withProdMeta(wf, id) {
  const p = JSON.parse(JSON.stringify(wf));
  p.id = id; p.versionId = 'ver-' + id; p.createdAt = '2026-01-01T00:00:00.000Z'; p.updatedAt = '2026-06-01T00:00:00.000Z';
  p.triggerCount = 3; p.isArchived = false; p.meta = { templateId: 'x' }; p.pinData = {}; p.staticData = { foo: 1 };
  p.tags = [{ id: 't1', name: 'prod' }]; p.versionCounter = 7; p.nodeGroups = [];
  // a webhook node id n8n assigns on import — must be stripped per-node
  p.nodes[0].webhookId = 'wh-' + id;
  // n8n resolves the id -> the operator's real credential name on export (installation-local; must be ignored)
  const sheet = p.nodes.find(n => n.credentials);
  if (sheet) sheet.credentials.googleApi.name = "operator's real Google SA cred";
  return p;
}

function writeDirs(mutateFile) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-parity-'));
  const prod = path.join(base, 'prod'), staged = path.join(base, 'staged');
  fs.mkdirSync(prod); fs.mkdirSync(staged);
  for (const file of files) {
    const id = idForKey(keyByFile[file]);
    const stagedWf = authored(file, false); stagedWf.id = id;
    fs.writeFileSync(path.join(staged, file), JSON.stringify(stagedWf, null, 2) + '\n');
    // production content equals staged EXCEPT where we inject drift, and always wrapped with n8n metadata
    const prodWf = withProdMeta(authored(file, file === mutateFile), id);
    fs.writeFileSync(path.join(prod, id + '.json'), JSON.stringify(prodWf, null, 2) + '\n');
  }
  return { base, prod, staged };
}

// ---------------------------------------------------------------------------------------------------
A.section('parity — equal content matches despite n8n-managed metadata on the production side');
{
  const d = writeDirs(null);
  const r = SP.verify({ prodDir: d.prod, stagedDir: d.staged, localMap });
  A.eq('all 15 runtime workflows MATCH', r.matched, files.length);
  A.eq('zero drift', r.drifted, 0);
  A.eq('zero missing', r.missing, 0);
  fs.rmSync(d.base, { recursive: true, force: true });
}

A.section('parity — a single changed node param DRIFTS exactly one workflow, localised to [nodes]');
const target = '19_request_planner.json';
{
  const d = writeDirs(target);
  const r = SP.verify({ prodDir: d.prod, stagedDir: d.staged, localMap });
  A.eq('exactly one workflow drifts', r.drifted, 1);
  A.eq('the rest match', r.matched, files.length - 1);
  const row = r.rows.find(x => x.file === target);
  A.ok('the drift is the mutated workflow', !!row && row.status === 'DRIFT');
  A.eq('drift localised to the nodes section', row.drift_sections, ['nodes']);
  fs.rmSync(d.base, { recursive: true, force: true });
}

A.section('parity — a workflow missing from the production export is reported, not silently passed');
{
  const d = writeDirs(null);
  // delete one production file
  const id = idForKey(keyByFile[target]);
  fs.rmSync(path.join(d.prod, id + '.json'));
  const r = SP.verify({ prodDir: d.prod, stagedDir: d.staged, localMap });
  A.eq('one workflow is missing', r.missing, 1);
  const row = r.rows.find(x => x.file === target);
  A.ok('missing workflow flagged NOT_IN_PRODUCTION', !!row && row.status === 'NOT_IN_PRODUCTION');
  fs.rmSync(d.base, { recursive: true, force: true });
}

A.section('parity — a credential NAME-only difference matches, but a credential ID drift is caught');
{
  const d = writeDirs(null);
  // baseline already proves name-only difference matches (withProdMeta rewrites the cred name). Now repoint ONE
  // production workflow's credential to a DIFFERENT id (a real binding drift) and prove it is flagged.
  const id = idForKey(keyByFile[target]);
  const pf = path.join(d.prod, id + '.json');
  const pj = JSON.parse(fs.readFileSync(pf, 'utf8'));
  pj.nodes.find(n => n.credentials).credentials.googleApi.id = 'CRED-WRONG';
  fs.writeFileSync(pf, JSON.stringify(pj, null, 2) + '\n');
  const r = SP.verify({ prodDir: d.prod, stagedDir: d.staged, localMap });
  A.eq('credential id drift drifts exactly one workflow', r.drifted, 1);
  const row = r.rows.find(x => x.file === target);
  A.ok('the id-drifted workflow is flagged DRIFT in [nodes]', !!row && row.status === 'DRIFT' && JSON.stringify(row.drift_sections) === JSON.stringify(['nodes']));
  A.eq('all other workflows (name-only cred diff) still MATCH', r.matched, files.length - 1);
  fs.rmSync(d.base, { recursive: true, force: true });
}

A.section('parity — sanitization: no raw production workflow id appears in any reported row');
{
  const d = writeDirs(target);
  const r = SP.verify({ prodDir: d.prod, stagedDir: d.staged, localMap });
  const blob = JSON.stringify(r.rows);
  const leaks = files.map(f => idForKey(keyByFile[f])).filter(id => blob.indexOf(id) >= 0);
  A.eq('no raw id leaks into reported rows', leaks, []);
  fs.rmSync(d.base, { recursive: true, force: true });
}

// honest named marker for the regression itself (the LIVE PASS/FAIL comes from scripts/verify_source_parity.sh)
console.log('\nSOURCE_PARITY_VERIFIER_REGRESSION=PASS');
A.report('source-parity');
