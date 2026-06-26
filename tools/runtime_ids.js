// runtime_ids.js — operator-local, installation-specific n8n workflow id resolver (DEPLOY-007/003/002/006).
//
// The COMMITTED source of truth for logical identity is config/workflow_manifest.json -> runtime_identity
// (WF key, exact name, file, role, callable/trigger expectations, binding edges, canonical_id:null). The REAL
// installation-specific ids are NEVER committed: they live in config/runtime_ids.local.json (gitignored, mode
// 600). This module reconciles the two against a real n8n export, fail-closed and idempotent.
//
// Resolver decision table (per WF key), given the local map entry and the production/disposable export index:
//   local entry present:
//     - id present in export AND export[id].name == expected name           -> VERIFIED (noop)
//     - id present in export but maps to a DIFFERENT name                    -> ABORT (id_name_mismatch)
//     - id absent from export, exact-name count == 1, single id == local id  -> VERIFIED (noop)
//     - id absent from export, exact-name count == 1, single id != local id  -> ABORT (map_vs_production_disagree)
//     - id absent from export, exact-name count == 0                         -> CREATE_WITH_LOCAL_ID (reserved id)
//     - exact-name count > 1                                                 -> ABORT (ambiguous_name)
//   local entry missing:
//     - exact-name count == 1                                                -> DISCOVER (persist export id)
//     - exact-name count == 0                                                -> GENERATE (mint stable local id, persist)
//     - exact-name count > 1                                                 -> ABORT (ambiguous_name)
// Any ABORT makes the whole resolution fail-closed (ok=false). DISCOVER/GENERATE mutate the local map; the map
// is backed up before any write. Reports are SANITIZED: id fingerprints only (fp_<sha10>), never raw ids.
//
// CLI:
//   node tools/runtime_ids.js init   [--local <file>]                 # scaffold local map from manifest identity
//   node tools/runtime_ids.js status [--local <file>]                 # coverage + fingerprints (no raw ids)
//   node tools/runtime_ids.js validate [--local <file>]               # schema + name match + id uniqueness
//   node tools/runtime_ids.js resolve --export-dir <dir> [--local <file>] [--apply]
//   node tools/runtime_ids.js seed --from <map.json> [--local <file>] [--apply]   # operator migration input
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./manifest_lib.js');

const ROOT = path.join(__dirname, '..');
const DEFAULT_LOCAL = path.join(ROOT, 'config', 'runtime_ids.local.json');
const SCHEMA = 'marketing-scout/runtime-ids/v1';

// ---- sanitization: never expose a raw id ----
function fingerprint(id) {
  if (id == null || id === '') return 'fp_none';
  return 'fp_' + crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 10);
}
// Deterministic installation-local id for a brand-new workflow (no production row yet). 16-char base36-ish slug,
// stable for a given (key,name) so a re-run mints the SAME id (idempotent creation). Prefixed so it is obviously
// a Marketing-Scout-minted id and not an n8n nanoid.
function stableLocalId(key, name) {
  const h = crypto.createHash('sha256').update(key + '|' + String(name)).digest('hex');
  return 'msloc' + h.slice(0, 11);
}

// ---- local map I/O (backup-before-write, mode 600) ----
function emptyMap() {
  return { schema: SCHEMA, n8n_version: L.expectedN8nVersion(), updated_at: null, workflows: {} };
}
function loadLocalMap(file) {
  if (!fs.existsSync(file)) return emptyMap();
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (m.schema !== SCHEMA) throw new Error('runtime_ids local map has unexpected schema: ' + m.schema);
  m.workflows = m.workflows || {};
  return m;
}
function saveLocalMap(file, map) {
  // backup the existing file first (best-effort, never throws on backup)
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
    try { fs.copyFileSync(file, file + '.bak.' + stamp); try { fs.chmodSync(file + '.bak.' + stamp, 0o600); } catch (e) { void e; } } catch (e) { void e; }
  }
  try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); } catch (e) { void e; }
  map.updated_at = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (e) { void e; }
}
function checksum(map) {
  // checksum over the id-bearing content (stable key order) — used in release evidence WITHOUT leaking ids.
  const w = map.workflows || {};
  const norm = Object.keys(w).sort().map(k => k + '=' + (w[k] && w[k].id != null ? String(w[k].id) : '')).join(';');
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

// ---- export index: { byName: {name: [ids]}, byId: {id: name} } from a directory of exported workflow JSONs ----
function indexExportDir(dir) {
  const byName = {}, byId = {};
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const name = String(j.name == null ? '' : j.name).trim();
    const id = j.id == null ? '' : String(j.id);
    if (!name || !id) continue;
    (byName[name] = byName[name] || []).push(id);
    byId[id] = name;
  }
  return { byName, byId };
}

// ---- core resolver (pure: identity + local map + export index in, decisions + next map out) ----
const ACTIONS = { VERIFIED: 'verified', DISCOVER: 'discover', GENERATE: 'generate', CREATE_WITH_LOCAL_ID: 'create_with_local_id', ABORT: 'abort' };

function resolveOne(key, identity, localEntry, idx) {
  const name = identity.name;
  const ids = (idx.byName[name] || []);
  const nameCount = ids.length;
  const has = localEntry && localEntry.id;

  if (has) {
    const localId = String(localEntry.id);
    const mappedName = idx.byId[localId];
    if (mappedName != null) {
      if (mappedName === name) return { key, action: ACTIONS.VERIFIED, id: localId, id_source: localEntry.id_source || 'operator_local' };
      return { key, action: ACTIONS.ABORT, reason: 'id_name_mismatch', id: localId };
    }
    // local id not seen in export
    if (nameCount > 1) return { key, action: ACTIONS.ABORT, reason: 'ambiguous_name', id: localId };
    if (nameCount === 1) {
      return ids[0] === localId
        ? { key, action: ACTIONS.VERIFIED, id: localId, id_source: localEntry.id_source || 'operator_local' }
        : { key, action: ACTIONS.ABORT, reason: 'map_vs_production_disagree', id: localId };
    }
    return { key, action: ACTIONS.CREATE_WITH_LOCAL_ID, id: localId, id_source: localEntry.id_source || 'operator_local' };
  }

  // no local entry yet
  if (nameCount > 1) return { key, action: ACTIONS.ABORT, reason: 'ambiguous_name' };
  if (nameCount === 1) return { key, action: ACTIONS.DISCOVER, id: ids[0], id_source: 'discovered' };
  return { key, action: ACTIONS.GENERATE, id: stableLocalId(key, name), id_source: 'generated' };
}

// resolveAll -> { ok, decisions, nextMap, mutated, report } . report is SANITIZED (fingerprints only).
function resolveAll(identityMap, localMap, idx) {
  const next = JSON.parse(JSON.stringify(localMap));
  next.workflows = next.workflows || {};
  const decisions = [];
  let mutated = false, aborts = 0;
  for (const key of Object.keys(identityMap)) {
    const identity = identityMap[key];
    const localEntry = next.workflows[key];
    const d = resolveOne(key, identity, localEntry, idx);
    decisions.push(d);
    if (d.action === ACTIONS.ABORT) { aborts++; continue; }
    if (d.action === ACTIONS.DISCOVER || d.action === ACTIONS.GENERATE) {
      next.workflows[key] = { name: identity.name, id: d.id, id_source: d.id_source, bound_at: new Date().toISOString() };
      mutated = true;
    } else if (!next.workflows[key]) {
      next.workflows[key] = { name: identity.name, id: d.id, id_source: d.id_source };
    }
  }
  // also flag any local entries whose key is unknown to the manifest (stale)
  for (const key of Object.keys(next.workflows)) {
    if (!identityMap[key]) { decisions.push({ key, action: ACTIONS.ABORT, reason: 'stale_local_key' }); aborts++; }
  }
  const report = {
    schema_ok: localMap.schema === SCHEMA,
    expected_keys: Object.keys(identityMap).length,
    resolved: decisions.filter(d => d.action !== ACTIONS.ABORT).length,
    aborts: aborts,
    actions: decisions.map(d => ({ wf: d.key, action: d.action, reason: d.reason || '', id_fingerprint: fingerprint(d.id) })),
    coverage: Object.keys(identityMap).filter(k => next.workflows[k] && next.workflows[k].id).length + '/' + Object.keys(identityMap).length,
    local_map_checksum: checksum(next)
  };
  return { ok: aborts === 0, decisions, nextMap: next, mutated, report };
}

// validate a local map against the manifest identity (names match, ids unique, schema)
function validateMap(identityMap, localMap) {
  const errors = [];
  if (localMap.schema !== SCHEMA) errors.push('schema mismatch: ' + localMap.schema);
  const w = localMap.workflows || {};
  const seenIds = {};
  for (const key of Object.keys(w)) {
    if (!identityMap[key]) { errors.push('stale key not in manifest: ' + key); continue; }
    if (w[key].name && w[key].name !== identityMap[key].name) errors.push('name mismatch for ' + key + ' (local "' + w[key].name + '" != manifest "' + identityMap[key].name + '")');
    const id = w[key].id;
    if (id != null && id !== '') {
      if (seenIds[id]) errors.push('duplicate id across ' + seenIds[id] + ' and ' + key + ' (fp=' + fingerprint(id) + ')');
      seenIds[id] = key;
    }
  }
  return { ok: errors.length === 0, errors, checksum: checksum(localMap), coverage: Object.keys(identityMap).filter(k => w[k] && w[k].id).length + '/' + Object.keys(identityMap).length };
}

// scaffold a local map skeleton from manifest identity (no ids)
function scaffold(identityMap) {
  const m = emptyMap();
  for (const key of Object.keys(identityMap)) m.workflows[key] = { name: identityMap[key].name, id: null, id_source: 'operator_local' };
  return m;
}

module.exports = {
  SCHEMA, fingerprint, stableLocalId, emptyMap, loadLocalMap, saveLocalMap, checksum,
  indexExportDir, resolveOne, resolveAll, validateMap, scaffold, ACTIONS, DEFAULT_LOCAL
};

// ---- CLI ----
function argVal(args, flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const localFile = argVal(args, '--local') || DEFAULT_LOCAL;
  const apply = args.indexOf('--apply') >= 0;
  const identity = L.runtimeIdentity();
  try {
    if (cmd === 'init') {
      if (fs.existsSync(localFile)) { console.error('refusing to overwrite existing ' + localFile + ' (delete it first)'); process.exit(2); }
      const m = scaffold(identity);
      saveLocalMap(localFile, m);
      console.log('RUNTIME_IDS_INIT=PASS wrote ' + localFile + ' (' + Object.keys(m.workflows).length + ' keys, no ids; chmod 600)');
    } else if (cmd === 'status') {
      const m = loadLocalMap(localFile);
      const v = validateMap(identity, m);
      console.log('coverage=' + v.coverage + ' checksum=' + v.checksum);
      for (const k of Object.keys(identity)) {
        const e = (m.workflows || {})[k];
        console.log('  ' + k + '  ' + (e && e.id ? fingerprint(e.id) + ' (' + (e.id_source || '?') + ')' : '(no id)'));
      }
      process.exit(v.ok ? 0 : 1);
    } else if (cmd === 'validate') {
      const m = loadLocalMap(localFile);
      const v = validateMap(identity, m);
      if (!v.ok) { console.log('FAILURES:'); v.errors.forEach(e => console.log('  - ' + e)); }
      console.log('RUNTIME_IDS_VALIDATE=' + (v.ok ? 'PASS' : 'FAIL') + ' coverage=' + v.coverage + ' checksum=' + v.checksum);
      process.exit(v.ok ? 0 : 1);
    } else if (cmd === 'resolve') {
      const dir = argVal(args, '--export-dir');
      if (!dir) { console.error('resolve requires --export-dir <dir>'); process.exit(2); }
      const idx = indexExportDir(dir);
      const m = loadLocalMap(localFile);
      const r = resolveAll(identity, m, idx);
      console.log(JSON.stringify(r.report, null, 2));
      if (!r.ok) { console.log('RUNTIME_IDS_RESOLVE=FAIL (aborts=' + r.report.aborts + ')'); process.exit(1); }
      if (apply && r.mutated) { saveLocalMap(localFile, r.nextMap); console.log('persisted ' + localFile + ' checksum=' + checksum(r.nextMap)); }
      console.log('RUNTIME_IDS_RESOLVE=PASS coverage=' + r.report.coverage + (apply ? '' : ' (dry-run; pass --apply to persist)'));
    } else if (cmd === 'seed') {
      const fromFile = argVal(args, '--from');
      if (!fromFile) { console.error('seed requires --from <map.json> (operator migration: {"WF18":"<id>",...} or {"<name>":"<id>"})'); process.exit(2); }
      const from = JSON.parse(fs.readFileSync(fromFile, 'utf8'));
      const m = loadLocalMap(localFile); m.workflows = m.workflows || {};
      const nameToKey = {}; Object.keys(identity).forEach(k => { nameToKey[identity[k].name] = k; });
      let seeded = 0;
      for (const key of Object.keys(from)) {
        const wfKey = identity[key] ? key : nameToKey[key];
        if (!wfKey) { console.error('  [skip] unknown workflow key/name in seed: ' + key); continue; }
        m.workflows[wfKey] = { name: identity[wfKey].name, id: String(from[key]), id_source: 'operator_local', bound_at: new Date().toISOString() };
        seeded++;
      }
      const v = validateMap(identity, m);
      if (!v.ok) { console.log('SEED_VALIDATE=FAIL'); v.errors.forEach(e => console.log('  - ' + e)); process.exit(1); }
      if (apply) { saveLocalMap(localFile, m); console.log('RUNTIME_IDS_SEED=PASS seeded=' + seeded + ' coverage=' + v.coverage + ' checksum=' + v.checksum); }
      else console.log('RUNTIME_IDS_SEED=DRYRUN would seed=' + seeded + ' coverage=' + v.coverage + ' (pass --apply to persist)');
    } else {
      console.error('usage: node tools/runtime_ids.js <init|status|validate|resolve|seed> [--local <file>] [--export-dir <dir>] [--from <map.json>] [--apply]');
      process.exit(2);
    }
  } catch (e) {
    console.error('RUNTIME_IDS_ERROR: ' + e.message);
    process.exit(1);
  }
}
