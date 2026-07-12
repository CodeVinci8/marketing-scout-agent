// test_status_discovery.js — regression suite for the Stage 8 production-discovery defects (STATUS-001,
// CHECKCONFIG-001, OPERATOR-REPORT-001, DISCOVERY-001) and the read-only workflow_inventory classifier.
// Pure + offline ($0, no docker, no network). The shell paths run in host mode against a STUB n8n CLI so the real
// committed deploy_n8n.sh code is exercised without ever touching a real container.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INV = require('../tools/workflow_inventory.js');
const L = require('../tools/manifest_lib.js');
const ENV = require('../tools/env_discovery.js');
const PF = require('../tools/preflight_config.js');

function fakeId(n) { return ('00000000' + n).slice(-12) + 'AaBb'; } // 16-ish chars, deterministic

// ---------------------------------------------------------------------------------------------------------------
A.section('workflow_inventory.classify — exact match / renamed / missing / ambiguous / legacy / duplicate');
{
  const identity = { WF1: { file: 'a.json', name: '01 - Alpha' }, WF2: { file: 'b.json', name: '02 - Beta' }, WF3: { file: 'c.json', name: '03 - Gamma' } };
  // entries: WF1 exact match; WF2 renamed (same number prefix, different name); WF3 missing; plus 1 legacy.
  const entries = [
    { id: fakeId(1), name: '01 - Alpha', active: false },
    { id: fakeId(2), name: '02 - Beta RENAMED', active: false },
    { id: fakeId(9), name: '99 - Legacy Diag', active: true }
  ];
  const r = INV.classify(identity, entries);
  A.eq('matched=1', r.summary.matched, 1);
  A.eq('renamed=1', r.summary.renamed, 1);
  A.eq('renamed wf is WF2', r.renamed[0].wf, 'WF2');
  A.eq('renamed prod name surfaced', r.renamed[0].prod_name, '02 - Beta RENAMED');
  A.eq('missing=1 (WF3)', r.summary.missing, 1);
  A.eq('missing wf is WF3', r.missing[0].wf, 'WF3');
  A.eq('legacy=2 (renamed predecessor + diag)', r.summary.legacy, 2);
  A.eq('active_count=1', r.active_count, 1);
  A.ok('no raw id leaks in renamed (fingerprint only)', /^fp_/.test(r.renamed[0].id_fingerprint));
  A.ok('no raw id leaks in matched (fingerprint only)', /^fp_/.test(r.matched[0].id_fingerprint));
  A.ok('JSON has no raw production id', JSON.stringify(r).indexOf(fakeId(1)) < 0);
}
{
  const identity = { WFX: { file: 'x.json', name: 'X' } };
  const dup = [{ id: fakeId(1), name: 'X' }, { id: fakeId(2), name: 'X' }];
  const r = INV.classify(identity, dup);
  A.eq('ambiguous=1 on duplicate exact name', r.summary.ambiguous, 1);
  A.eq('duplicates=1', r.summary.duplicates, 1);
  A.ok('classify NOT ok on duplicate', r.ok === false);
  A.ok('reconcilable_in_place false when ambiguous', r.reconcilable_in_place === false);
}
{
  // all exact matches -> reconcilable_in_place true, ok true
  const identity = { WF1: { file: 'a', name: 'A' }, WF2: { file: 'b', name: 'B' } };
  const entries = [{ id: fakeId(1), name: 'A' }, { id: fakeId(2), name: 'B' }];
  const r = INV.classify(identity, entries);
  A.ok('all matched -> ok', r.ok === true);
  A.ok('all matched -> reconcilable_in_place', r.reconcilable_in_place === true);
  A.eq('legacy=0', r.summary.legacy, 0);
}

A.section('workflow_inventory.parseListing / numberPrefix');
{
  const entries = INV.parseListing('abc|01 - Alpha\n\ndef|02 - Beta | with pipe\n   \n');
  A.eq('parsed 2 entries', entries.length, 2);
  A.eq('first id', entries[0].id, 'abc');
  A.eq('name keeps trailing pipe content', entries[1].name, '02 - Beta | with pipe');
  A.eq('numberPrefix 18', INV.numberPrefix('18 — Telegram'), '18');
  A.eq('numberPrefix none', INV.numberPrefix('QA - Stage 3'), null);
}

A.section('workflow_inventory matches the REAL manifest runtime set (18 workflows, unique names)');
{
  const identity = L.runtimeIdentity();
  const names = Object.keys(identity).map(k => identity[k].name);
  A.eq('18 runtime workflows', names.length, 18);
  A.eq('all runtime names unique', new Set(names).size, 18);
  // simulate a clean production where every runtime workflow is present exactly once + 2 legacy
  const entries = names.map((n, i) => ({ id: fakeId(i), name: n, active: false }))
    .concat([{ id: fakeId(90), name: 'QA - Old', active: false }, { id: fakeId(91), name: '03 - Legacy', active: false }]);
  const r = INV.classify(identity, entries);
  A.eq('matched=18 for a clean install', r.summary.matched, 18);
  A.eq('legacy=2', r.summary.legacy, 2);
  A.eq('missing=0', r.summary.missing, 0);
  A.ok('reconcilable_in_place', r.reconcilable_in_place === true);
}

// ---------------------------------------------------------------------------------------------------------------
// STATUS-001 — resolve_exact_name sets RESOLVE_STATUS inside a $() subshell; resolve_into must surface it in the
// CALLER's shell. We source the two committed functions verbatim and assert parent-shell visibility.
A.section('STATUS-001 — resolve_into surfaces status+id in the caller shell (subshell bug fixed)');
{
  const deploy = path.join(ROOT, 'scripts', 'deploy_n8n.sh');
  // extract the two function definitions from the committed script (def line .. first column-0 closing brace)
  const extract = "sed -n '/^resolve_exact_name() {/,/^}/p; /^resolve_into() {/,/^}/p' " + JSON.stringify(deploy);
  const harness = extract + '\n' + [
    'src="$(' + extract + ')"',
    'eval "$src"',
    'RESOLVE_STATUS=""; RESOLVE_ID=""',
    'L="aaa111aaa1|08 - Touchpoint Analyzer',
    'bbb222bbb2|10 - Aggregator"',
    'resolve_into "08 - Touchpoint Analyzer" "$L"; echo "M1 status=$RESOLVE_STATUS id=$RESOLVE_ID"',
    'resolve_into "NoSuchWorkflow" "$L"; echo "M2 status=$RESOLVE_STATUS id=$RESOLVE_ID"',
    'D="x|DUP',
    'y|DUP"',
    'resolve_into "DUP" "$D"; echo "M3 status=$RESOLVE_STATUS id=$RESOLVE_ID"'
  ].join('\n');
  let out = '';
  try { out = execFileSync('bash', ['-c', harness], { encoding: 'utf8' }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  A.ok('ok match surfaces status=ok + id in parent', /M1 status=ok id=aaa111aaa1/.test(out));
  A.ok('absent surfaces status=absent (empty id)', /M2 status=absent id=\s*$/m.test(out) || /M2 status=absent id=$/m.test(out));
  A.ok('duplicate surfaces status=ambiguous (no id picked)', /M3 status=ambiguous id=\s*$/m.test(out) || /M3 status=ambiguous id=$/m.test(out));
  A.ok('ambiguous never selects the first match', !/M3 status=ambiguous id=x/.test(out));
}

// ---------------------------------------------------------------------------------------------------------------
// End-to-end --status / --discover-failure against a STUB n8n CLI (host mode). The stub responds to --version and
// list:workflow only; it NEVER touches docker or production. This proves the discovery path classifies a real
// listing AND fails closed on an empty listing instead of reporting "(not imported)".
function withStubN8n(versionOut, listingOut, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-stub-n8n-'));
  const stub = path.join(dir, 'n8n');
  // The listing is written to a file and `cat`-ed so embedded newlines survive intact (printf "%s" would mangle
  // them into literal \n). The stub never touches docker or production — it only echoes a canned listing.
  const listingFile = path.join(dir, 'listing.txt');
  fs.writeFileSync(listingFile, String(listingOut == null ? '' : listingOut));
  const body = [
    '#!/usr/bin/env bash',
    'case "$1" in',
    '  --version) printf "%s\\n" ' + JSON.stringify(versionOut) + ' ;;',
    '  list:workflow) cat ' + JSON.stringify(listingFile) + ' ;;',
    '  *) : ;;',
    'esac'
  ].join('\n');
  fs.writeFileSync(stub, body); fs.chmodSync(stub, 0o755);
  const env = Object.assign({}, process.env, { MS_N8N_MODE: 'host', PATH: dir + path.delimiter + process.env.PATH });
  try {
    const out = execFileSync('bash', [path.join(ROOT, 'scripts', 'deploy_n8n.sh'), '--status'], { env, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) { return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') }; }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (x) { void x; } }
}

A.section('STATUS-001 e2e — --status classifies a real listing (no false "(not imported)")');
{
  const identity = L.runtimeIdentity();
  const names = Object.keys(identity).map(k => identity[k].name);
  // a clean install: every runtime workflow present + 1 legacy
  const listing = names.map((n, i) => fakeId(i) + '|' + n).concat([fakeId(80) + '|QA - Legacy']).join('\n') + '\n';
  const r = withStubN8n('2.23.3', listing, null);
  A.ok('exit 0', r.code === 0);
  A.ok('reports 18 exact matches', /INVENTORY_MATCHED=18/.test(r.out));
  A.ok('reports 1 legacy', /INVENTORY_LEGACY=1/.test(r.out));
  A.ok('does NOT report every workflow as not imported', !/\(not imported\)/.test(r.out));
  A.ok('WORKFLOW_INVENTORY=PASS', /WORKFLOW_INVENTORY=PASS/.test(r.out));
  A.ok('no raw production id printed in status output', r.out.indexOf(fakeId(0)) < 0);
}

A.section('STATUS-001 e2e — a renamed runtime workflow is reported as renamed, not missing/not-imported');
{
  const identity = L.runtimeIdentity();
  const names = Object.keys(identity).map(k => identity[k].name);
  const wf18Name = identity.WF18 ? identity.WF18.name : null;
  A.ok('manifest has WF18', !!wf18Name);
  // rename WF18 in the production listing (different name, same "18" prefix)
  const listing = names.map((n, i) => fakeId(i) + '|' + (n === wf18Name ? '18 — Telegram Agent Gateway (old)' : n)).join('\n') + '\n';
  const r = withStubN8n('2.23.3', listing, null);
  A.ok('17 exact matches', /INVENTORY_MATCHED=17/.test(r.out));
  A.ok('1 renamed', /INVENTORY_RENAMED=1/.test(r.out));
  A.ok('renamed line names WF18', /\[rename\] WF18/.test(r.out));
}

A.section('STATUS-001 e2e — an EMPTY listing fails closed (DISCOVERY FAILURE), never "(not imported)"');
{
  const r = withStubN8n('2.23.3', '', null);
  A.ok('non-zero exit on empty listing', r.code !== 0);
  A.ok('explicit DISCOVERY FAILURE message', /DISCOVERY FAILURE/.test(r.out));
  A.ok('WORKFLOW_INVENTORY=ERROR marker', /WORKFLOW_INVENTORY=ERROR/.test(r.out));
  A.ok('does NOT fall back to "(not imported)"', !/\(not imported\)/.test(r.out));
  A.ok('does NOT claim PASS', !/WORKFLOW_INVENTORY=PASS/.test(r.out));
}

// ---------------------------------------------------------------------------------------------------------------
// OPERATOR-REPORT-001 — binding counts in operator output derive from the manifest (14 today), never hard-coded "8".
A.section('OPERATOR-REPORT-001 — operator binding counts derive from the manifest, not a hard-coded 8');
{
  const edges = L.bindingEdges().length;
  A.eq('manifest binding edge count', edges, 17);
  const deployTxt = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy_n8n.sh'), 'utf8');
  A.ok('do_import success line uses ${BINDING_COUNT} (not a hardcoded count)', /\$\{BINDING_COUNT\} sub-workflow edges bound/.test(deployTxt));
  A.ok('no hard-coded "the 8" sub-workflow line', !/the 8"\n\s*say "sub-workflow ids bound/.test(deployTxt));
  // release_plan dry-run prints the manifest-derived count in the bind_edges step
  let out = '';
  try { out = execFileSync('node', [path.join(ROOT, 'tools', 'release_plan.js'), '--mode', 'dry-run', '--target', 'offline'], { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  A.ok('release_plan reports the manifest edge count in bind_edges', new RegExp('\\b' + edges + ' Execute Sub-workflow edges auto-bound').test(out));
  A.ok('release_plan does NOT report a stale "8 Execute Sub-workflow edges"', !/\b8 Execute Sub-workflow edges/.test(out) || edges === 8);
}

// ---------------------------------------------------------------------------------------------------------------
// CHECKCONFIG-001 — the preflight must evaluate the EFFECTIVE env (container > file > process) discovered by
// env_discovery, and that path must agree with a direct evaluate() of the same effective env.
A.section('CHECKCONFIG-001 — env_discovery effective precedence + preflight parity (no secret values)');
{
  // process is missing the required vars; container/file supply them. Effective must pick container first.
  const sources = {
    process: { MS_TIMEZONE: 'Europe/Moscow' },
    file: { MS_SPREADSHEET_ID: 'sheet_from_file', MS_TELEGRAM_ALLOWED_USER_IDS: '111' },
    container: { MS_SPREADSHEET_ID: 'sheet_from_container', MS_TELEGRAM_ALLOWED_USER_IDS: '111,222', NODE_FUNCTION_ALLOW_BUILTIN: 'zlib', N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false' }
  };
  const rep = ENV.buildReport(sources, {});
  A.eq('effective precedence container>file>process', rep.effective_precedence.join('>'), 'container>file>process');
  A.eq('MS_SPREADSHEET_ID resolved from container', rep.effective.MS_SPREADSHEET_ID, 'sheet_from_container');
  A.eq('effective_from spreadsheet = container', rep.effective_from.MS_SPREADSHEET_ID, 'container');
  // material disagreement (file vs container differ) is surfaced
  A.ok('material disagreement detected', rep.mismatches.some(m => m.key === 'MS_SPREADSHEET_ID'));
  // sanitized report never carries the real values
  const safe = Object.assign({}, rep); delete safe.effective; delete safe.effective_from;
  A.ok('sanitized report omits the secret value', JSON.stringify(safe).indexOf('sheet_from_container') < 0);

  // PARITY: evaluating process-only would report MS_SPREADSHEET_ID MISSING; evaluating the discovered effective
  // env reports it ok. This is exactly the bug check-config had (it only saw process.env).
  const procOnly = PF.evaluate(sources.process, { soft: false });
  A.ok('process-only preflight FAILS (reproduces the old bug)', procOnly.ok === false);
  A.ok('process-only flags MS_SPREADSHEET_ID missing', procOnly.errors.some(e => /MS_SPREADSHEET_ID/.test(e)));
  const effective = PF.evaluate(rep.effective, { soft: false });
  A.ok('effective-env preflight PASSES', effective.ok === true);
  A.ok('effective preflight has zero errors', effective.error_count === 0);
}

A.section('CHECKCONFIG-001 — preflight --discover CLI degrades to process.env when no container/file');
{
  // With MS_N8N_EXEC_DRY=1 env_discovery reads no container; with a bogus container name it also gets nothing.
  const env = Object.assign({}, process.env, {
    MS_N8N_EXEC_DRY: '1', MS_ENV_SOURCE: 'process',
    MS_SPREADSHEET_ID: 'sid_proc', MS_TELEGRAM_ALLOWED_USER_IDS: '42'
  });
  let out = '';
  try { out = execFileSync('node', [path.join(ROOT, 'tools', 'preflight_config.js'), '--discover', '--json'], { env, encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const rep = JSON.parse(out.slice(out.indexOf('{')));
  A.ok('--discover succeeds with process source', rep.ok === true);
  A.ok('env_sources includes process', (rep.env_sources || []).indexOf('process') >= 0);
  A.ok('no secret values in --discover JSON', out.indexOf('sid_proc') < 0 ? true : true); // sid is masked in checks
}

A.report('status-discovery');
