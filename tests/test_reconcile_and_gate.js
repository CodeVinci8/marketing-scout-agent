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

A.section('WF18 activation gate — verdict FOLLOWS the registry (never a hardcoded world-state snapshot)');
{
  // a97bfe7 semantics: compute the expected open set from the registry with the gate's own clearance rules,
  // then require the gate verdict to match it exactly. The test stays true as blockers get resolved.
  const reg = GATE.load();
  const g = GATE.gate(reg);
  const blocking = (reg.gate_severities_blocking || ['P0', 'P1']);
  const expectedOpen = reg.blockers
    .filter(b => blocking.indexOf(b.severity) >= 0)
    .filter(b => !GATE.clearance(b).cleared)
    .map(b => b.id).sort();
  A.eq('gate open set == registry-derived open set', (g.open_ids || []).slice().sort(), expectedOpen);
  A.eq('blocking_open count matches', g.blocking_open, expectedOpen.length);
  A.eq('allow iff nothing open', g.allow, expectedOpen.length === 0);
  A.eq('marker matches verdict', g.marker, expectedOpen.length === 0 ? 'WF18_REARCHITECTURE=READY' : 'WF18_REARCHITECTURE=PENDING');
}

A.section('IDEMP-001 — resolved with LIVE evidence (atomic claim protocol; no residual correctness risk)');
{
  const reg = GATE.load();
  const idemp = reg.blockers.find(b => b.id === 'IDEMP-001');
  A.eq('IDEMP-001 status is resolved', idemp.status, 'resolved');
  A.ok('evidence names the claim protocol + regression suites', /idempotency_claim\.js/.test(idemp.evidence) && /test_idempotency_claim\.js/.test(idemp.evidence));
  A.ok('evidence records the LIVE two-simultaneous-inputs acceptance', /LIVE ACCEPTANCE PASSED/.test(idemp.evidence) && /CONCURRENT_IDEMPOTENCY=PASS/.test(idemp.evidence));
  A.ok('residual risk documents cost only, not a correctness gap', /None for exactly-once/i.test(idemp.residual_risk || ''));
  A.ok('gate clears it as resolved_with_evidence', GATE.clearance(idemp).cleared === true && GATE.clearance(idemp).reason === 'resolved_with_evidence');
  A.ok('registry documents n8n concurrency capability', /N8N_CONCURRENCY_PRODUCTION_LIMIT/.test(reg.n8n_concurrency_capability || ''));
  A.ok('registry documents cleared_statuses', !!(reg.cleared_statuses && reg.cleared_statuses.resolved && reg.cleared_statuses.accepted));
}

A.section('WF18 activation gate — clearance semantics (resolved/accepted clear; mitigated/partial/open block)');
{
  function reg1(b) { return { gate_severities_blocking: ['P0', 'P1'], blockers: [Object.assign({ id: 'X', severity: 'P0' }, b)] }; }
  A.ok('mitigated BLOCKS', GATE.gate(reg1({ status: 'mitigated', evidence: 'e' })).allow === false);
  A.ok('partial BLOCKS', GATE.gate(reg1({ status: 'partial', evidence: 'e' })).allow === false);
  A.ok('open BLOCKS', GATE.gate(reg1({ status: 'open' })).allow === false);
  A.ok('resolved+evidence CLEARS', GATE.gate(reg1({ status: 'resolved', evidence: 'tests/x.js' })).allow === true);
  A.ok('resolved without evidence BLOCKS', GATE.gate(reg1({ status: 'resolved', evidence: '' })).allow === false);
  // 'accepted' clears ONLY with full operator sign-off (evidence + residual_risk + accepted_by)
  A.ok('accepted without sign-off BLOCKS', GATE.gate(reg1({ status: 'accepted', evidence: 'e' })).allow === false);
  A.ok('accepted with full sign-off CLEARS', GATE.gate(reg1({ status: 'accepted', evidence: 'e', residual_risk: 'r', accepted_by: 'operator' })).allow === true);
  // clearance() reasons are explicit
  A.eq('clearance reason for mitigated', GATE.clearance({ status: 'mitigated' }).reason, 'status_mitigated');
  A.eq('clearance reason for accepted-without-signoff', GATE.clearance({ status: 'accepted', evidence: 'e' }).reason, 'accepted_without_full_signoff');
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

A.section('CRED-001 — node-level credential REQUIREMENT model (closes the zero-reference blind spot)');
{
  const fs = require('fs'); const os = require('os'); const path = require('path');
  // requiredCredentialType is derived from each node's OWN config, never to make a count green.
  // SHEETS-AUTH-001: the required Sheets credential follows the node's authentication. serviceAccount => googleApi;
  // unset/oAuth2 => googleSheetsOAuth2Api (the node's runtime default is OAuth2 — a googleApi-only node is a defect).
  A.eq('googleSheets serviceAccount requires googleApi', RC.requiredCredentialType({ type: 'n8n-nodes-base.googleSheets', parameters: { authentication: 'serviceAccount' } }), 'googleApi');
  A.eq('googleSheets with UNSET authentication defaults to OAuth2 (googleSheetsOAuth2Api)', RC.requiredCredentialType({ type: 'n8n-nodes-base.googleSheets', parameters: {} }), 'googleSheetsOAuth2Api');
  A.eq('googleSheets oAuth2 requires googleSheetsOAuth2Api', RC.requiredCredentialType({ type: 'n8n-nodes-base.googleSheets', parameters: { authentication: 'oAuth2' } }), 'googleSheetsOAuth2Api');
  A.eq('http genericCredentialType/httpHeaderAuth requires httpHeaderAuth',
    RC.requiredCredentialType({ type: 'n8n-nodes-base.httpRequest', parameters: { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' } }), 'httpHeaderAuth');
  A.eq('http predefinedCredentialType requires the declared type',
    RC.requiredCredentialType({ type: 'n8n-nodes-base.httpRequest', parameters: { authentication: 'predefinedCredentialType', nodeCredentialType: 'httpQueryAuth' } }), 'httpQueryAuth');
  A.eq('telegram $env send (no authentication) requires NO credential',
    RC.requiredCredentialType({ type: 'n8n-nodes-base.httpRequest', parameters: { url: '=https://api.telegram.org/bot{{ $env.X }}/sendMessage' } }), null);

  // The committed runtime closure must have a reference on EVERY credential-requiring node (the fix). The count is
  // DERIVED from actual nodes, not hard-coded.
  const reqs = RC.collectRequirements(L.runtimeClosure());
  const missing = reqs.filter(r => !r.hasRef);
  A.ok('runtime closure has credential-requiring nodes (derived count > 36)', reqs.length > 36);
  A.eq('ZERO credential-requiring nodes lack a reference', missing.length, 0);

  // audit() over the SOURCE with an empty export: every reference is a deferred placeholder, but structurally there
  // are no missing references and no leaked placeholders -> PASS (nothing to leak yet).
  const src = RC.audit(L.runtimeClosure(), []);
  A.eq('source audit: 0 missing references', src.summary.nodes_missing_reference, 0);
  A.eq('source audit: all references deferred (no export)', src.summary.deferred, src.summary.references);
  A.ok('source audit PASS structurally', src.ok === true);

  // A workflow whose only Sheets node has NO credentials block must FAIL the audit (the WF18 false-PASS defect).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credaudit-'));
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ name: 'bad', nodes: [
    { name: 'Read X', type: 'n8n-nodes-base.googleSheets', parameters: { authentication: 'serviceAccount', operation: 'read' } }
  ] }));
  const bad = RC.audit(['bad.json'], [], dir);
  A.eq('credential-less Sheets node -> 1 missing reference', bad.summary.nodes_missing_reference, 1);
  A.ok('credential-less Sheets node -> audit FAIL (not a hollow PASS)', bad.ok === false);

  // A leaked placeholder (a credential of that TYPE exists in the export, yet the ref is still a template) FAILS;
  // a placeholder for a type with NO production credential is DEFERRED (operator attaches), not a hard failure.
  fs.writeFileSync(path.join(dir, 'ph.json'), JSON.stringify({ name: 'ph', nodes: [
    { name: 'Read X', type: 'n8n-nodes-base.googleSheets', parameters: { authentication: 'serviceAccount', operation: 'read' }, credentials: { googleApi: { id: 'PASTE_CREDENTIAL_ID_HERE', name: 'g' } } }
  ] }));
  const leak = RC.audit(['ph.json'], [{ id: 'realG', name: 'g', type: 'googleApi' }], dir);
  A.eq('placeholder + matching cred type -> leaked (failure)', leak.summary.placeholder_leaked, 1);
  A.ok('leaked placeholder -> audit FAIL', leak.ok === false);
  const defer = RC.audit(['ph.json'], [{ id: 'realH', name: 'h', type: 'httpHeaderAuth' }], dir);
  A.eq('placeholder + no matching cred type -> deferred (not failure)', defer.summary.deferred, 1);
  A.ok('deferred-only -> audit PASS for inactive deploy', defer.ok === true);

  // CRED-003: with SEVERAL credentials of a type and NO name match, a placeholder is DEFERRED (cannot auto-pick),
  // not a leak — the operator attaches the right one. A named httpHeaderAuth node demonstrates this.
  fs.writeFileSync(path.join(dir, 'named.json'), JSON.stringify({ name: 'named', nodes: [
    { name: 'Claude', type: 'n8n-nodes-base.httpRequest', parameters: { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' }, credentials: { httpHeaderAuth: { id: 'PASTE_CREDENTIAL_ID_HERE', name: 'Claude API - Marketing Scout' } } }
  ] }));
  const twoNoMatch = RC.audit(['named.json'], [{ id: 'h1', name: 'Other A', type: 'httpHeaderAuth' }, { id: 'h2', name: 'Other B', type: 'httpHeaderAuth' }], dir);
  A.eq('placeholder, >1 of type, no name match -> deferred (not leaked)', twoNoMatch.summary.deferred, 1);
  A.eq('placeholder, >1 of type, no name match -> 0 leaked', twoNoMatch.summary.placeholder_leaked, 0);
  A.ok('ambiguous-no-name placeholder -> audit PASS (operator attaches; not a hard fail)', twoNoMatch.ok === true);
  // but a placeholder whose (type,name) DOES uniquely match a production credential is a LEAK (should have resolved)
  const nameLeak = RC.audit(['named.json'], [{ id: 'h1', name: 'Claude API - Marketing Scout', type: 'httpHeaderAuth' }, { id: 'h2', name: 'Other', type: 'httpHeaderAuth' }], dir);
  A.eq('placeholder whose (type,name) uniquely matches -> leaked', nameLeak.summary.placeholder_leaked, 1);
  A.ok('name-matched placeholder leak -> audit FAIL', nameLeak.ok === false);

  // resolved real ids of the right type -> clean PASS.
  fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ name: 'ok', nodes: [
    { name: 'Read X', type: 'n8n-nodes-base.googleSheets', parameters: { authentication: 'serviceAccount', operation: 'read' }, credentials: { googleApi: { id: 'realG', name: 'g' } } }
  ] }));
  const good = RC.audit(['ok.json'], [{ id: 'realG', name: 'g', type: 'googleApi' }], dir);
  A.eq('resolved real id -> 1 resolved, 0 failures', good.summary.failures, 0);
  A.ok('resolved real id -> audit PASS', good.ok === true && good.summary.resolved === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

A.report('reconcile-and-gate');
