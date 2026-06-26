// test_reconcile_and_gate.js — Stage 8: exact-name workflow reconciliation (DEPLOY-002/005/011), non-decrypted
// credential reconciliation (DEPLOY-008), and the hard WF18 activation gate. Pure + offline, $0, no secrets.
'use strict';
const A = require('./_assert');
const RW = require('../tools/reconcile_workflows.js');
const RC = require('../tools/reconcile_credentials.js');
const GATE = require('../tools/wf18_activation_gate.js');
const RID = require('../tools/runtime_ids.js');
const L = require('../tools/manifest_lib.js');

const identity = L.runtimeIdentity();
const KEYS = Object.keys(identity);

function idxFrom(pairs) { const byName = {}, byId = {}; for (const [n, ids] of pairs) { byName[n] = ids.slice(); ids.forEach(i => { byId[i] = n; }); } return { byName, byId }; }
function fullExport(suffix) { return idxFrom(KEYS.map(k => [identity[k].name, ['id_' + k.toLowerCase() + (suffix || '')]])); }

A.section('DEPLOY-002 — exact-name count drives create/update/abort');
{
  // count==1 for all -> all UPDATE, preserve production id
  const r = RW.reconcile(identity, fullExport(), RID.emptyMap());
  A.ok('all single-match -> ok', r.ok);
  A.eq('15 updates', r.summary.updates, 15);
  A.eq('0 creates', r.summary.creates, 0);
  A.ok('every plan item UPDATE', r.plan.every(p => p.action === RW.ACTIONS.UPDATE));
}
{
  // count==0 -> CREATE (uses local id when present)
  const empty = idxFrom([]);
  const local = RID.scaffold(identity); local.workflows.WF18.id = 'localWF18';
  const r = RW.reconcile(identity, empty, local);
  A.ok('empty export still ok (creates)', r.ok);
  A.eq('15 creates', r.summary.creates, 15);
  A.ok('WF18 create uses the local id fingerprint', r.plan.find(p => p.wf === 'WF18').id_fingerprint === RID.fingerprint('localWF18'));
}
{
  // count>1 -> ABORT (never select one)
  const dup = fullExport(); dup.byName[identity.WF18.name] = ['a', 'b'];
  const r = RW.reconcile(identity, dup, RID.emptyMap());
  A.ok('duplicate exact name aborts whole plan', r.ok === false);
  A.ok('WF18 reason is duplicate', /duplicate_exact_name/.test(r.plan.find(p => p.wf === 'WF18').reason));
}

A.section('DEPLOY-002/005 — fail-closed on id collision and map-vs-production disagreement');
{
  // same id used by two names -> id_collision abort
  const idx = fullExport(); idx.byName[identity.WF18.name] = ['shared']; idx.byName[identity.WF19.name] = ['shared']; idx.byId['shared'] = identity.WF19.name;
  const r = RW.reconcile(identity, idx, RID.emptyMap());
  A.ok('id collision aborts', r.ok === false && r.plan.some(p => p.reason === 'id_collision'));
}
{
  const idx = fullExport();
  const local = RID.scaffold(identity); local.workflows.WF18.id = 'DIFFERENT_FROM_PROD';
  const r = RW.reconcile(identity, idx, local);
  A.ok('local map disagreeing with production aborts', r.ok === false && r.plan.some(p => p.wf === 'WF18' && p.reason === 'map_vs_production_disagree'));
}

A.section('DEPLOY-011 — reconciliation plan is sanitized (no raw ids)');
{
  const idx = idxFrom([[identity.WF18.name, ['RAW_SECRET_WF_ID']]].concat(KEYS.filter(k => k !== 'WF18').map(k => [identity[k].name, ['x_' + k]])));
  const r = RW.reconcile(identity, idx, RID.emptyMap());
  A.ok('raw id absent from plan', JSON.stringify(r).indexOf('RAW_SECRET_WF_ID') < 0);
  A.ok('fingerprints present', JSON.stringify(r).indexOf('fp_') >= 0);
}

A.section('DEPLOY-008 — credential reconciliation: present/type-match/ambiguous, fingerprints only');
{
  const refs = [
    { file: '08_x.json', node: 'Google Read', type: 'googleApi', id: 'GIDABC' },
    { file: '08_x.json', node: 'Claude', type: 'httpHeaderAuth', id: 'HIDXYZ' }
  ];
  const exp = [{ id: 'GIDABC', name: 'Google account', type: 'googleApi' }, { id: 'HIDXYZ', name: 'Claude key', type: 'httpHeaderAuth' }];
  const r = RC.reconcile(refs, exp);
  A.ok('all references resolve -> PASS', r.ok);
  A.eq('2 references', r.summary.references, 2);
  A.ok('raw credential id never serialized', JSON.stringify(r).indexOf('GIDABC') < 0 && JSON.stringify(r).indexOf('Google account') < 0);
  A.ok('usage reported by fingerprint', r.summary.usage_by_fingerprint.every(u => /^fp_/.test(u.id_fingerprint)));
}
{
  // missing reference
  const refs = [{ file: 'w.json', node: 'N', type: 'googleApi', id: 'NOPE' }];
  A.ok('missing credential -> FAIL', RC.reconcile(refs, []).ok === false);
  // type mismatch
  const r2 = RC.reconcile([{ file: 'w.json', node: 'N', type: 'googleApi', id: 'X' }], [{ id: 'X', name: 'n', type: 'httpHeaderAuth' }]);
  A.ok('type mismatch -> FAIL', r2.ok === false && r2.audit[0].status === 'type_mismatch');
  // ambiguous (duplicate id in export)
  const r3 = RC.reconcile([{ file: 'w.json', node: 'N', type: 'googleApi', id: 'D' }], [{ id: 'D', name: 'a', type: 'googleApi' }, { id: 'D', name: 'b', type: 'googleApi' }]);
  A.ok('ambiguous credential -> FAIL', r3.ok === false && r3.audit[0].status === 'ambiguous');
}

A.section('DEPLOY-008 — committed workflows ship a credential PLACEHOLDER; reconciliation refuses it');
{
  // The committed source carries PASTE_CREDENTIAL_ID_HERE; real ids are attached in n8n at deploy time. The
  // reconciler must REFUSE to treat an unattached placeholder as a satisfied credential.
  const refs = RC.collectReferences(L.runtimeClosure());
  A.ok('runtime workflows do reference credentials', refs.length > 0);
  const rec = RC.reconcile(refs, []);
  A.ok('placeholder credential -> CREDENTIAL_AUDIT=FAIL', rec.ok === false);
  A.ok('every failing ref is flagged as placeholder', rec.audit.filter(a => a.status !== 'ok').every(a => a.status === 'placeholder'));
}
{
  // After attachment (real ids in the export), the same logical references reconcile cleanly.
  const refs = [
    { file: '08.json', node: 'Google Read', type: 'googleApi', id: 'REAL_G' },
    { file: '08.json', node: 'Claude', type: 'httpHeaderAuth', id: 'REAL_H' }
  ];
  const exp = [{ id: 'REAL_G', name: 'g', type: 'googleApi' }, { id: 'REAL_H', name: 'h', type: 'httpHeaderAuth' }];
  A.ok('attached real ids reconcile PASS', RC.reconcile(refs, exp).ok);
}

A.section('WF18 activation gate — BLOCKS while P0/P1 blockers are open (current state)');
{
  const g = GATE.gate(GATE.load());
  A.ok('gate is currently PENDING (rearchitecture not done)', g.allow === false && g.marker === 'WF18_REARCHITECTURE=PENDING');
  A.ok('at least one P0 open', g.blocking_open >= 1);
  A.ok('open ids include RUNTIME-001 and SECURITY-001', g.open_ids.indexOf('RUNTIME-001') >= 0 && g.open_ids.indexOf('SECURITY-001') >= 0);
}

A.section('WF18 activation gate — opens ONLY when every P0/P1 is resolved WITH evidence');
{
  const reg = GATE.load();
  // resolve all blocking items but leave one without evidence -> still blocked
  const noEvidence = JSON.parse(JSON.stringify(reg));
  noEvidence.blockers.forEach(b => { b.status = 'resolved'; b.evidence = 'tests/foo.js'; });
  noEvidence.blockers[0].evidence = '';
  A.ok('resolved-without-evidence keeps the gate closed', GATE.gate(noEvidence).allow === false);
  // resolve all with evidence -> gate opens
  const allResolved = JSON.parse(JSON.stringify(reg));
  allResolved.blockers.forEach(b => { b.status = 'resolved'; b.evidence = 'tests/wf18_x.js'; });
  const open = GATE.gate(allResolved);
  A.ok('all-resolved-with-evidence opens the gate', open.allow === true && open.marker === 'WF18_REARCHITECTURE=READY');
}

A.report('reconcile-and-gate');
