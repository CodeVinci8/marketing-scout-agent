// test_runtime_ids.js — operator-local workflow id resolver (DEPLOY-002/003/006/007). Pure, offline, $0.
// Proves every fail-closed decision branch, idempotency, no-raw-id sanitization, and manifest-name binding.
'use strict';
const A = require('./_assert');
const R = require('../tools/runtime_ids.js');
const L = require('../tools/manifest_lib.js');

const identity = L.runtimeIdentity();
const KEYS = Object.keys(identity);

// Build an export index helper from {name: [ids]} pairs.
function idxFrom(pairs) {
  const byName = {}, byId = {};
  for (const [name, ids] of pairs) { byName[name] = ids.slice(); ids.forEach(id => { byId[id] = name; }); }
  return { byName, byId };
}
function localWith(entries) {
  const m = R.emptyMap();
  for (const [k, id, src] of entries) m.workflows[k] = { name: identity[k].name, id: id, id_source: src || 'operator_local' };
  return m;
}

A.section('manifest identity is the 18-key logical source of truth (no real ids committed)');
A.eq('runtime_identity has 18 keys', KEYS.length, 18);
A.ok('WF18 present with exact name + null canonical_id', !!identity.WF18 && identity.WF18.canonical_id === null && identity.WF18.id_source === 'operator_local');
A.ok('callable WF08 declares an executeWorkflowTrigger expectation', identity.WF08.callable === true && /executeWorkflowTrigger/.test(identity.WF08.expected_target_trigger));

A.section('fingerprint never leaks a raw id');
A.ok('fingerprint is fp_<10hex>', /^fp_[0-9a-f]{10}$/.test(R.fingerprint('FAKEWF18ID0001')));
A.ok('fingerprint of empty is fp_none', R.fingerprint('') === 'fp_none' && R.fingerprint(null) === 'fp_none');
A.ok('fingerprint is deterministic', R.fingerprint('abc') === R.fingerprint('abc'));
A.ok('different ids -> different fingerprints', R.fingerprint('abc') !== R.fingerprint('abd'));

A.section('stableLocalId is deterministic + obviously-minted (idempotent creation)');
const g1 = R.stableLocalId('WF18', identity.WF18.name);
const g2 = R.stableLocalId('WF18', identity.WF18.name);
A.eq('same key+name -> same minted id', g1, g2);
A.ok('minted id is prefixed msloc', /^msloc[0-9a-f]{11}$/.test(g1));
A.ok('different key -> different minted id', R.stableLocalId('WF19', identity.WF19.name) !== g1);

A.section('decision: local entry VERIFIED when id matches export by id');
{
  const idx = idxFrom([[identity.WF18.name, ['FAKEWF18ID0001']]]);
  const d = R.resolveOne('WF18', identity.WF18, { id: 'FAKEWF18ID0001', id_source: 'operator_local' }, idx);
  A.eq('action verified', d.action, R.ACTIONS.VERIFIED);
}

A.section('decision: DISCOVER when no local entry and exact-name count == 1');
{
  const idx = idxFrom([[identity.WF18.name, ['DISCOVERED123']]]);
  const d = R.resolveOne('WF18', identity.WF18, undefined, idx);
  A.eq('action discover', d.action, R.ACTIONS.DISCOVER);
  A.eq('discovered id is the single export id', d.id, 'DISCOVERED123');
  A.eq('id_source discovered', d.id_source, 'discovered');
}

A.section('decision: GENERATE when no local entry and exact-name count == 0 (fresh install)');
{
  const idx = idxFrom([]);
  const d = R.resolveOne('WF18', identity.WF18, undefined, idx);
  A.eq('action generate', d.action, R.ACTIONS.GENERATE);
  A.eq('generated id is the stable local id', d.id, R.stableLocalId('WF18', identity.WF18.name));
}

A.section('decision: ABORT on exact-name count > 1 (ambiguous)');
{
  const idx = idxFrom([[identity.WF18.name, ['A1', 'A2']]]);
  const dNoLocal = R.resolveOne('WF18', identity.WF18, undefined, idx);
  A.eq('no-local ambiguous aborts', dNoLocal.action, R.ACTIONS.ABORT);
  A.eq('reason ambiguous_name', dNoLocal.reason, 'ambiguous_name');
  const dLocal = R.resolveOne('WF18', identity.WF18, { id: 'A1' }, idx);
  // id 'A1' IS in export and maps to the right name -> verified (id-match wins over name-count)
  A.eq('local id present and name matches -> verified', dLocal.action, R.ACTIONS.VERIFIED);
}

A.section('decision: ABORT when local id belongs to a DIFFERENT name');
{
  const idx = idxFrom([['Some Other Workflow', ['XID']]]);
  const d = R.resolveOne('WF18', identity.WF18, { id: 'XID' }, idx);
  A.eq('action abort', d.action, R.ACTIONS.ABORT);
  A.eq('reason id_name_mismatch', d.reason, 'id_name_mismatch');
}

A.section('decision: ABORT when local map and production disagree (name has different single id)');
{
  const idx = idxFrom([[identity.WF18.name, ['PROD_ID']]]);
  const d = R.resolveOne('WF18', identity.WF18, { id: 'LOCAL_ID' }, idx);
  A.eq('action abort', d.action, R.ACTIONS.ABORT);
  A.eq('reason map_vs_production_disagree', d.reason, 'map_vs_production_disagree');
}

A.section('decision: CREATE_WITH_LOCAL_ID when local id reserved but workflow absent from export');
{
  const idx = idxFrom([]); // empty disposable db, but operator pre-seeded a local id
  const d = R.resolveOne('WF18', identity.WF18, { id: 'RESERVED', id_source: 'operator_local' }, idx);
  A.eq('action create_with_local_id', d.action, R.ACTIONS.CREATE_WITH_LOCAL_ID);
  A.eq('id preserved', d.id, 'RESERVED');
}

A.section('resolveAll: fresh install generates all 18, idempotent on second run');
{
  const idx = idxFrom([]);
  const r1 = R.resolveAll(identity, R.emptyMap(), idx);
  A.ok('first pass ok', r1.ok && r1.mutated);
  A.eq('coverage 18/18', r1.report.coverage, '18/18');
  A.eq('all actions generate', r1.decisions.filter(d => d.action === R.ACTIONS.GENERATE).length, 18);
  // second run with the persisted map: all reserved ids -> create_with_local_id (still empty export), no aborts
  const r2 = R.resolveAll(identity, r1.nextMap, idx);
  A.ok('second pass ok (idempotent, fail-closed clean)', r2.ok);
  A.eq('checksum stable across idempotent runs', R.checksum(r1.nextMap), R.checksum(r2.nextMap));
  A.eq('second-run aborts == 0', r2.report.aborts, 0);
}

A.section('resolveAll: real-export discovery persists ids and is then VERIFIED');
{
  const pairs = KEYS.map(k => [identity[k].name, ['id_' + k.toLowerCase()]]);
  const idx = idxFrom(pairs);
  const r1 = R.resolveAll(identity, R.emptyMap(), idx);
  A.ok('discovery pass ok', r1.ok);
  A.eq('all discovered', r1.decisions.filter(d => d.action === R.ACTIONS.DISCOVER).length, 18);
  const r2 = R.resolveAll(identity, r1.nextMap, idx);
  A.eq('all verified on re-resolve', r2.decisions.filter(d => d.action === R.ACTIONS.VERIFIED).length, 18);
  A.ok('verified pass ok', r2.ok);
}

A.section('resolveAll: any single disagreement makes the WHOLE resolution fail-closed');
{
  const pairs = KEYS.map(k => [identity[k].name, ['id_' + k.toLowerCase()]]);
  const idx = idxFrom(pairs);
  const seeded = localWith([['WF18', 'WRONG_LOCAL_ID']]); // disagrees with prod id_wf18
  const r = R.resolveAll(identity, seeded, idx);
  A.ok('not ok (fail-closed)', r.ok === false);
  A.ok('at least one abort', r.report.aborts >= 1);
  A.ok('WF18 decision is abort/disagree', r.decisions.find(d => d.key === 'WF18').reason === 'map_vs_production_disagree');
}

A.section('resolveAll: stale local key (not in manifest) aborts');
{
  const seeded = R.emptyMap(); seeded.workflows.WF99 = { name: 'Ghost', id: 'g1' };
  const r = R.resolveAll(identity, seeded, idxFrom([]));
  A.ok('stale key aborts', r.ok === false && r.decisions.some(d => d.reason === 'stale_local_key'));
}

A.section('report is sanitized — fingerprints only, never raw ids');
{
  const idx = idxFrom([[identity.WF18.name, ['SUPERSECRETID']]]);
  const r = R.resolveAll(identity, R.emptyMap(), idx);
  const blob = JSON.stringify(r.report);
  A.ok('raw id absent from report', blob.indexOf('SUPERSECRETID') < 0);
  A.ok('fingerprint present in report', blob.indexOf('fp_') >= 0);
}

A.section('validateMap: name match + id uniqueness + schema');
{
  const good = localWith([['WF18', 'a'], ['WF19', 'b']]);
  A.ok('good map valid', R.validateMap(identity, good).ok);
  const dupe = localWith([['WF18', 'x'], ['WF19', 'x']]);
  A.ok('duplicate id rejected', R.validateMap(identity, dupe).ok === false);
  const badName = R.emptyMap(); badName.workflows.WF18 = { name: 'Wrong Name', id: 'a' };
  A.ok('name mismatch rejected', R.validateMap(identity, badName).ok === false);
}

A.section('scaffold: skeleton from manifest has all 18 keys with null ids and correct names');
{
  const sk = R.scaffold(identity);
  A.eq('scaffold has 18 keys', Object.keys(sk.workflows).length, 18);
  A.ok('all ids null', Object.keys(sk.workflows).every(k => sk.workflows[k].id === null));
  A.ok('names match manifest', Object.keys(sk.workflows).every(k => sk.workflows[k].name === identity[k].name));
}

A.report('runtime-ids');
