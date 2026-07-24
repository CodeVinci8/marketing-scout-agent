'use strict';
// Canonical STRUCTURAL deploy tool — graft the repo topology into a live prod export while preserving every
// installation-local value (workflow id, node ids, real credentials, Execute Workflow bindings). Offline, $0.
const A = require('./_assert.js');
const D = require('../tools/deploy_workflow_structural.js');
const { graftWorkflow, renderDiff, verifyParity, isPlaceholderCredId, isPlaceholderWorkflowRef } = D;

// prod export: 3 nodes with real cred ids + a real sub-workflow binding; connections A->B, A->X.
function prodFixture() {
  return {
    id: 'WF_PROD', name: 'demo', active: true, versionId: 'v-prod', settings: { executionOrder: 'v1' },
    nodes: [
      { name: 'A', type: 'n8n-nodes-base.code', typeVersion: 2, id: 'p-a', parameters: { jsCode: 'return [{json:{v:1}}]' } },
      { name: 'B', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, id: 'p-b',
        credentials: { googleApi: { id: 'REALGS', name: 'Google Sheets - MS' } },
        parameters: { operation: 'read', sheetName: { __rl: true, value: 'competitor_profiles', mode: 'name' } } },
      { name: 'X', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1, id: 'p-x',
        parameters: { workflowId: { __rl: true, value: '77', mode: 'id', cachedResultName: 'WF28 claude analyst' } } }
    ],
    connections: {
      A: { main: [[{ node: 'B', type: 'main', index: 0 }, { node: 'X', type: 'main', index: 0 }]] }
    }
  };
}
// repo: A jsCode changed; B unchanged; X ships the PASTE_WORKFLOW_ID placeholder; NEW node C (googleSheets,
// placeholder cred); rewired so A -> B, C and C -> X.
function repoFixture() {
  return {
    id: 'WF_REPO', name: 'demo', active: false, versionId: 'v-repo', settings: {},
    nodes: [
      { name: 'A', type: 'n8n-nodes-base.code', typeVersion: 2, id: 'r-a', parameters: { jsCode: 'return [{json:{v:2}}]' } },
      { name: 'B', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, id: 'r-b',
        credentials: { googleApi: { id: 'PASTE_CREDENTIAL_ID_HERE', name: 'Google Sheets - MS' } },
        parameters: { operation: 'read', sheetName: { __rl: true, value: 'competitor_profiles', mode: 'name' } } },
      { name: 'X', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1, id: 'r-x',
        parameters: { workflowId: { __rl: true, value: 'PASTE_WORKFLOW_ID', mode: 'id', cachedResultName: 'WF28 claude analyst' } } },
      { name: 'C', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, id: 'r-c',
        credentials: { googleApi: { id: 'PASTE_CREDENTIAL_ID_HERE', name: 'Google Sheets - MS' } },
        parameters: { operation: 'read', sheetName: { __rl: true, value: 'raw_market_records', mode: 'name' } } }
    ],
    connections: {
      A: { main: [[{ node: 'B', type: 'main', index: 0 }, { node: 'C', type: 'main', index: 0 }]] },
      C: { main: [[{ node: 'X', type: 'main', index: 0 }]] }
    }
  };
}
// A second googleApi credential in production makes the type match ambiguous (the real production situation).
function withTwoGoogleCreds(prod, repo) {
  prod.nodes.push({ name: 'B2', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, id: 'p-b2',
    credentials: { googleApi: { id: 'REALGS2', name: 'Google Sheets - OTHER' } }, parameters: {} });
  repo.nodes.push({ name: 'B2', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, id: 'r-b2',
    credentials: { googleApi: { id: 'PASTE_CREDENTIAL_ID_HERE', name: 'Google Sheets - OTHER' } }, parameters: {} });
  return { prod, repo };
}
const nodeBy = (wf, n) => wf.nodes.find(x => x.name === n);
function throws(label, fn, sub) {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  A.ok(label, msg !== null && (!sub || msg.indexOf(sub) >= 0), 'expected abort' + (sub ? ' containing "' + sub + '"' : '') + ', got: ' + msg);
}

A.section('placeholder detection');
A.ok('PASTE_ cred id is placeholder', isPlaceholderCredId('PASTE_CREDENTIAL_ID_HERE'));
A.ok('empty cred id is placeholder', isPlaceholderCredId(''));
A.ok('real cred id is NOT placeholder', !isPlaceholderCredId('REALGS'));
A.ok('PASTE_WORKFLOW_ID resource locator is placeholder', isPlaceholderWorkflowRef({ __rl: true, value: 'PASTE_WORKFLOW_ID', mode: 'id' }));
A.ok('real workflow binding is NOT placeholder', !isPlaceholderWorkflowRef({ __rl: true, value: '77', mode: 'id' }));

A.section('happy graft: node addition, rewiring, id/cred/binding preservation');
{
  const prod = prodFixture();
  const { out, report } = graftWorkflow(prod, repoFixture());
  A.eq('node count 3 -> 4', out.nodes.length, 4);
  A.eq('added node reported', report.added, ['C']);
  A.eq('nothing removed', report.removed, []);
  // existing node identity is installation-local; the repo only supplies behavior
  A.eq('A keeps prod node id', nodeBy(out, 'A').id, 'p-a');
  A.eq('A adopts repo jsCode', nodeBy(out, 'A').parameters.jsCode, 'return [{json:{v:2}}]');
  A.eq('B keeps prod node id', nodeBy(out, 'B').id, 'p-b');
  A.eq('B keeps the REAL prod credential (never the repo placeholder)', nodeBy(out, 'B').credentials.googleApi.id, 'REALGS');
  A.includes('B reported as credential-preserved', report.preserved_creds, 'B');
  // requirement 8 — the repo placeholder must never overwrite a live sub-workflow binding
  A.eq('X keeps the PROD Execute Workflow binding', nodeBy(out, 'X').parameters.workflowId.value, '77');
  A.includes('X reported as binding-preserved', report.preserved_bindings, 'X');
  // new node
  A.ok('C gets a non-colliding node id', nodeBy(out, 'C').id && !['p-a', 'p-b', 'p-x'].includes(nodeBy(out, 'C').id));
  A.eq('C credential resolved to the single prod googleApi cred (unique type match)', nodeBy(out, 'C').credentials.googleApi.id, 'REALGS');
  A.eq('C keeps its repo sheet parameter', nodeBy(out, 'C').parameters.sheetName.value, 'raw_market_records');
  // connections come only from the canonical repo topology
  A.eq('A now fans out to B and C', out.connections.A.main[0].map(e => e.node), ['B', 'C']);
  A.eq('C->X edge added', out.connections.C.main[0][0].node, 'X');
  A.includes('A reported as rewired', report.rewired, 'A');
  A.includes('C reported as rewired', report.rewired, 'C');
  A.ok('B was not rewired', report.rewired.indexOf('B') < 0);
  // installation-local workflow envelope
  A.eq('workflow id from prod', out.id, 'WF_PROD');
  A.eq('active state from prod', out.active, true);
  A.eq('settings from prod', out.settings, { executionOrder: 'v1' });
  A.eq('versionId from prod', out.versionId, 'v-prod');
  A.eq('prod export not mutated', prod.nodes.length, 3);
  // human-readable structural diff
  const diff = renderDiff(prod, out, report);
  A.ok('diff names the added node', diff.indexOf('added   (1): C') >= 0, diff);
  A.ok('diff shows the node count change', diff.indexOf('nodes: 3 -> 4') >= 0, diff);
  A.ok('diff lists rewired nodes', /rewired \(2\)/.test(diff), diff);
}

A.section('credential safety: ambiguity is fail-closed, resolution must be explicit');
{
  const f = withTwoGoogleCreds(prodFixture(), repoFixture());
  // C's repo cred name matches an existing credential name, but a NAME is not identity — two candidates => abort.
  throws('two candidates of the same type => abort (never pick by type)',
    () => graftWorkflow(f.prod, f.repo), 'ambiguous');
  let msg = '';
  try { graftWorkflow(f.prod, f.repo); } catch (e) { msg = e.message; }
  A.ok('abort message is actionable (names --inherit / --cred)', msg.indexOf('--inherit "C=') >= 0 && msg.indexOf('--cred "C=') >= 0, msg);
  A.ok('abort message never prints a credential id', msg.indexOf('REALGS') < 0, msg);

  // B. explicit inheritance from a named sibling node
  const f2 = withTwoGoogleCreds(prodFixture(), repoFixture());
  const inh = graftWorkflow(f2.prod, f2.repo, { inherit: { C: 'B' } });
  A.eq('C inherits the exact credential of sibling node B', nodeBy(inh.out, 'C').credentials.googleApi.id, 'REALGS');
  const f2b = withTwoGoogleCreds(prodFixture(), repoFixture());
  const inh2 = graftWorkflow(f2b.prod, f2b.repo, { inherit: { C: 'B2' } });
  A.eq('inheriting from B2 binds the OTHER credential', nodeBy(inh2.out, 'C').credentials.googleApi.id, 'REALGS2');
  const f2c = withTwoGoogleCreds(prodFixture(), repoFixture());
  throws('inherit from a node that does not exist => abort',
    () => graftWorkflow(f2c.prod, f2c.repo, { inherit: { C: 'NOPE' } }), 'does not exist in production');
  const f2d = withTwoGoogleCreds(prodFixture(), repoFixture());
  throws('inherit from a node with no credential of that type => abort',
    () => graftWorkflow(f2d.prod, f2d.repo, { inherit: { C: 'A' } }), 'no real credential of type');

  // A. explicit CLI mapping, by credential name or by id
  const f3 = withTwoGoogleCreds(prodFixture(), repoFixture());
  A.eq('--cred by credential NAME resolves', nodeBy(graftWorkflow(f3.prod, f3.repo, { cred: { C: 'Google Sheets - OTHER' } }).out, 'C').credentials.googleApi.id, 'REALGS2');
  const f4 = withTwoGoogleCreds(prodFixture(), repoFixture());
  A.eq('--cred by credential ID resolves', nodeBy(graftWorkflow(f4.prod, f4.repo, { cred: { C: 'REALGS' } }).out, 'C').credentials.googleApi.id, 'REALGS');
  const f5 = withTwoGoogleCreds(prodFixture(), repoFixture());
  throws('--cred naming an unknown credential => abort',
    () => graftWorkflow(f5.prod, f5.repo, { cred: { C: 'Not A Credential' } }), 'does not uniquely match');

  // prod has no credential of the needed type at all
  const prodNoGs = prodFixture();
  delete nodeBy(prodNoGs, 'B').credentials;
  throws('prod lacks the credential type entirely => abort',
    () => graftWorkflow(prodNoGs, repoFixture()), 'none of that type');
}

A.section('placeholder rejection is a hard final gate');
{
  // A new Execute Workflow node has no prod binding to inherit — a PASTE_WORKFLOW_ID must never be imported.
  const repo = repoFixture();
  repo.nodes.push({ name: 'Y', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1, id: 'r-y',
    parameters: { workflowId: { __rl: true, value: 'PASTE_WORKFLOW_ID', mode: 'id' } } });
  repo.connections.C.main[0].push({ node: 'Y', type: 'main', index: 0 });
  throws('new node with a placeholder sub-workflow binding => abort',
    () => graftWorkflow(prodFixture(), repo), 'placeholder value(s) would reach production');
}

A.section('intentional node removal is explicit only');
{
  const prod = prodFixture();
  prod.nodes.push({ name: 'Z', type: 'n8n-nodes-base.noOp', typeVersion: 1, id: 'p-z', parameters: {} });
  prod.connections.B = { main: [[{ node: 'Z', type: 'main', index: 0 }]] };
  throws('prod-only node without --remove => abort (never an unmanaged deletion)',
    () => graftWorkflow(prod, repoFixture()), 'absent from repo');

  const prod2 = prodFixture();
  prod2.nodes.push({ name: 'Z', type: 'n8n-nodes-base.noOp', typeVersion: 1, id: 'p-z', parameters: {} });
  prod2.connections.B = { main: [[{ node: 'Z', type: 'main', index: 0 }]] };
  const { out, report } = graftWorkflow(prod2, repoFixture(), { remove: ['Z'] });
  A.eq('explicitly removed node is reported', report.removed, ['Z']);
  A.ok('removed node is gone from the merged workflow', !nodeBy(out, 'Z'));
  A.ok('dangling connection from the removed node is gone', !out.connections.B);
  A.ok('renderDiff shows the removal', renderDiff(prod2, out, report).indexOf('removed (1): Z') >= 0);

  throws('--remove naming a node that is still in the repo => abort',
    () => graftWorkflow(prodFixture(), repoFixture(), { remove: ['B'] }), 'not prod-only');
}

A.section('structural guards');
{
  const repoTypeSwap = repoFixture();
  nodeBy(repoTypeSwap, 'A').type = 'n8n-nodes-base.set';
  throws('existing-node type change => abort', () => graftWorkflow(prodFixture(), repoTypeSwap), 'type change');

  const repoBadEdge = repoFixture();
  repoBadEdge.connections.A.main[0].push({ node: 'GHOST', type: 'main', index: 0 });
  throws('connection to an unknown node => abort', () => graftWorkflow(prodFixture(), repoBadEdge), 'unknown target node');
}

A.section('post-import parity verification');
{
  const { out } = graftWorkflow(prodFixture(), repoFixture());
  const expected = Object.assign({}, out, { active: true });

  const clean = JSON.parse(JSON.stringify(expected));
  clean.versionId = 'server-assigned'; clean.updatedAt = '2026-07-21T00:00:00.000Z';
  clean.nodes.reverse(); // n8n may return nodes in any order
  A.ok('parity OK ignoring server-managed fields and node order', verifyParity(expected, clean).ok);

  const lostCred = JSON.parse(JSON.stringify(expected));
  delete lostCred.nodes.find(n => n.name === 'B').credentials;
  A.ok('parity detects a lost credential', verifyParity(expected, lostCred).mismatches.some(m => /credential lost: B/.test(m)));

  const rebound = JSON.parse(JSON.stringify(expected));
  rebound.nodes.find(n => n.name === 'C').credentials.googleApi.id = 'SOMETHING_ELSE';
  A.ok('parity detects a rebound credential', verifyParity(expected, rebound).mismatches.some(m => /credential rebound: C/.test(m)));

  const idChanged = JSON.parse(JSON.stringify(expected));
  idChanged.nodes.find(n => n.name === 'A').id = 'new-id';
  A.ok('parity detects a changed node id', verifyParity(expected, idChanged).mismatches.some(m => /node id changed: A/.test(m)));

  const dropped = JSON.parse(JSON.stringify(expected));
  dropped.nodes = dropped.nodes.filter(n => n.name !== 'C');
  A.ok('parity detects a missing node', verifyParity(expected, dropped).mismatches.some(m => /node missing in production: C/.test(m)));

  const rewired = JSON.parse(JSON.stringify(expected));
  rewired.connections.A.main[0].pop();
  A.ok('parity detects changed connections', verifyParity(expected, rewired).mismatches.some(m => /connections differ/.test(m)));

  const deactivated = JSON.parse(JSON.stringify(expected));
  deactivated.active = false;
  A.ok('parity detects a lost active state', verifyParity(expected, deactivated).mismatches.some(m => /^active:/.test(m)));

  const wrongWf = JSON.parse(JSON.stringify(expected));
  wrongWf.id = 'OTHER';
  A.ok('parity detects a wrong workflow id', verifyParity(expected, wrongWf).mismatches.some(m => /^workflow id:/.test(m)));

  const bindingLost = JSON.parse(JSON.stringify(expected));
  bindingLost.nodes.find(n => n.name === 'X').parameters.workflowId.value = 'PASTE_WORKFLOW_ID';
  A.ok('parity detects a broken Execute Workflow binding', verifyParity(expected, bindingLost).mismatches.some(m => /parameters differ: X/.test(m)));
}

A.report('deploy-structural');
