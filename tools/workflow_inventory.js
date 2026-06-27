// workflow_inventory.js — read-only production-vs-manifest inventory classifier (STATUS-001 / DISCOVERY-001).
//
// Given the manifest logical identity (the 15 runtime workflows + their exact names) and a real n8n inventory
// (either a `list:workflow` listing of "<id>|<name>" lines, or an export directory of workflow JSONs), classify
// every runtime workflow and every production workflow WITHOUT ever guessing a workflow by array position or
// substring. The exact-name rule is authoritative (DEPLOY-002); rename detection is a non-authoritative HINT only
// so the operator is never silently told "(not imported)" when a same-numbered predecessor exists in production.
//
//   exact-name count == 1  -> matched   (UPDATE in place; production id preserved)
//   exact-name count == 0  -> missing, UNLESS a production workflow shares the leading "NN" number prefix, in
//                             which case it is a renamed HINT (CREATE new + legacy predecessor) — operator decision
//   exact-name count  > 1  -> ambiguous (never select one)
//   production name not an exact runtime name -> legacy/extra
//   any name appearing > 1 time in production -> duplicate
//
// Output is sanitized: raw ids are NEVER printed, only fp_<sha10> fingerprints. Pure classify() is unit-testable;
// I/O (export dir / listing) is shelled only by the CLI. This module never calls n8n and never mutates anything.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./manifest_lib.js');
const RID = require('./runtime_ids.js');

// Leading numeric prefix of a workflow name, e.g. "18 — Telegram …" -> "18". Null when there is no number prefix.
function numberPrefix(name) {
  const m = String(name == null ? '' : name).match(/^\s*(\d+)\b/);
  return m ? m[1] : null;
}

// classify(identityMap, entries) -> sanitized inventory.
//   identityMap : { WFxx: { file, name } }            (from L.runtimeIdentity())
//   entries     : [ { id, name, active? } ]           (production inventory; active optional)
function classify(identityMap, entries) {
  entries = (entries || []).map(e => ({ id: e.id == null ? '' : String(e.id), name: String(e.name == null ? '' : e.name), active: e.active === true }));

  // index production by exact name + count duplicates
  const byName = {};
  for (const e of entries) (byName[e.name] = byName[e.name] || []).push(e);
  const duplicates = Object.keys(byName).filter(n => byName[n].length > 1)
    .map(n => ({ name: n, count: byName[n].length }));

  const runtimeNames = new Set();
  for (const k of Object.keys(identityMap)) runtimeNames.add(identityMap[k].name);

  const matched = [], renamed = [], missing = [], ambiguous = [];
  for (const wf of Object.keys(identityMap)) {
    const name = identityMap[wf].name;
    const file = identityMap[wf].file;
    const hits = byName[name] || [];
    if (hits.length === 1) {
      matched.push({ wf, file, name, id_fingerprint: RID.fingerprint(hits[0].id), active: hits[0].active });
    } else if (hits.length > 1) {
      ambiguous.push({ wf, file, name, count: hits.length });
    } else {
      // exact-name absent — look for a same-numbered predecessor (rename hint only; non-authoritative)
      const pfx = numberPrefix(name);
      const cand = pfx ? entries.filter(e => numberPrefix(e.name) === pfx && !runtimeNames.has(e.name)) : [];
      if (cand.length) {
        renamed.push({ wf, file, name, prod_name: cand[0].name, id_fingerprint: RID.fingerprint(cand[0].id), active: cand[0].active, candidates: cand.length });
      } else {
        missing.push({ wf, file, name });
      }
    }
  }

  // legacy/extra: production workflows whose exact name is not a runtime name
  const legacy = entries.filter(e => !runtimeNames.has(e.name))
    .map(e => ({ name: e.name, id_fingerprint: RID.fingerprint(e.id), active: e.active }));

  const activeCount = entries.filter(e => e.active).length;

  return {
    schema: 'marketing-scout/workflow-inventory/v1',
    production_count: entries.length,
    runtime_expected: Object.keys(identityMap).length,
    matched, renamed, missing, ambiguous, legacy, duplicates,
    active_count: activeCount,
    summary: {
      matched: matched.length, renamed: renamed.length, missing: missing.length,
      ambiguous: ambiguous.length, legacy: legacy.length, duplicates: duplicates.length,
      active: activeCount
    },
    // can every runtime workflow be reconciled in place (matched=UPDATE) with no ambiguity? renames need a decision.
    reconcilable_in_place: ambiguous.length === 0 && missing.length === 0,
    ok: ambiguous.length === 0 && duplicates.length === 0
  };
}

// Parse a `list:workflow` listing ("<id>|<name>" per line) into entries (no active state available this way).
function parseListing(text) {
  const out = [];
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;
    const bar = line.indexOf('|');
    if (bar <= 0) continue;
    out.push({ id: line.slice(0, bar), name: line.slice(bar + 1) });
  }
  return out;
}

// Read an export directory of workflow JSONs into entries (id, name, active).
function readExportDir(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    try {
      const w = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ id: w.id == null ? '' : String(w.id), name: String(w.name == null ? '' : w.name), active: w.active === true });
    } catch (e) { void e; }
  }
  return out;
}

module.exports = { classify, parseListing, readExportDir, numberPrefix };

function printReport(rep, opts) {
  const showActive = !!opts.exportMode;
  console.log('Production workflow inventory (sanitized; fingerprints only — raw ids never shown):');
  console.log('  production_total=' + rep.production_count + '  runtime_expected=' + rep.runtime_expected + (showActive ? ('  active=' + rep.active_count) : '  (active state unavailable from listing)'));
  const fmt = a => a + (showActive ? '' : '');
  console.log('  matched(UPDATE in place) : ' + rep.summary.matched);
  rep.matched.forEach(m => console.log('    [ok]   ' + m.wf + ' ' + m.id_fingerprint + (showActive ? ('  active=' + m.active) : '') + '  "' + m.name + '"'));
  if (rep.renamed.length) {
    console.log('  renamed(HINT: CREATE new + legacy predecessor — operator decision) : ' + rep.summary.renamed);
    rep.renamed.forEach(r => console.log('    [rename] ' + r.wf + ' repo="' + r.name + '"  prod="' + r.prod_name + '" ' + r.id_fingerprint + (showActive ? ('  active=' + r.active) : '')));
  }
  if (rep.missing.length) {
    console.log('  missing(not in production) : ' + rep.summary.missing);
    rep.missing.forEach(m => console.log('    [missing] ' + m.wf + '  "' + m.name + '"'));
  }
  if (rep.ambiguous.length) {
    console.log('  AMBIGUOUS(duplicate exact name — refuse to deploy) : ' + rep.summary.ambiguous);
    rep.ambiguous.forEach(a => console.log('    [AMBIGUOUS] ' + a.wf + ' count=' + a.count + '  "' + a.name + '"'));
  }
  console.log('  legacy/extra(not in runtime set) : ' + rep.summary.legacy);
  rep.legacy.forEach(l => console.log('    [legacy] ' + l.id_fingerprint + (showActive ? ('  active=' + l.active) : '') + '  "' + l.name + '"'));
  if (rep.duplicates.length) {
    console.log('  DUPLICATE names : ' + rep.summary.duplicates);
    rep.duplicates.forEach(d => console.log('    [DUP] count=' + d.count + '  "' + d.name + '"'));
  }
  console.log('INVENTORY_MATCHED=' + rep.summary.matched);
  console.log('INVENTORY_RENAMED=' + rep.summary.renamed);
  console.log('INVENTORY_MISSING=' + rep.summary.missing);
  console.log('INVENTORY_AMBIGUOUS=' + rep.summary.ambiguous);
  console.log('INVENTORY_LEGACY=' + rep.summary.legacy);
  console.log('INVENTORY_DUPLICATES=' + rep.summary.duplicates);
  if (showActive) console.log('INVENTORY_ACTIVE=' + rep.active_count);
  console.log('INVENTORY_RECONCILABLE_IN_PLACE=' + (rep.reconcilable_in_place ? 'true' : 'false'));
  console.log('WORKFLOW_INVENTORY=' + (rep.ok ? 'PASS' : 'FAIL'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const exportDir = val('--export-dir');
  const listingArg = val('--listing');
  let entries, exportMode = false;
  if (exportDir) { entries = readExportDir(exportDir); exportMode = true; }
  else if (listingArg) {
    const text = listingArg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(listingArg, 'utf8');
    entries = parseListing(text);
  } else { console.error('usage: node tools/workflow_inventory.js (--export-dir <dir> | --listing <file|->)'); process.exit(2); }
  const rep = classify(L.runtimeIdentity(), entries);
  if (args.indexOf('--json') >= 0) console.log(JSON.stringify(rep, null, 2));
  else printReport(rep, { exportMode });
  // exit non-zero only on a hard, deploy-blocking condition (ambiguous or duplicate)
  process.exit(rep.ok ? 0 : 1);
}
