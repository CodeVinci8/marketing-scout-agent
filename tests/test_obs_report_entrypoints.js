// test_obs_report_entrypoints.js — REAL-entrypoint regression for OBS-001 (workflow-scoped WF18 credential metric)
// and REPORT-001 (deferred production release renders ONE consistent aggregate verdict, never a clean RELEASE_PLAN=OK).
//
// Unlike a pure unit test, this drives the ACTUAL CLI entrypoints:
//   * node tools/reconcile_credentials.js --audit --focus 18_   (the metric that mislabeled a global count as WF18)
//   * bash scripts/deploy_n8n.sh --dry-run                       (the production dry-run that printed OK then exit 3)
// using the same host-stub harness as test_deploy_entrypoints.js (a fake `n8n` on PATH; no docker, no network, $0).
//
// Emitted markers (the session's required acceptance signals):
//   WF18_UNIQUE_CREDENTIALS_IS_WORKFLOW_SCOPED=PASS
//   DEFERRED_RELEASE_NEVER_PRINTS_CLEAN_OK=PASS
//   DEFERRED_RELEASE_EXITS_3=PASS
//   CLEAN_RELEASE_PRINTS_OK_ONLY_WHEN_CLEAN=PASS
'use strict';
const A = require('./_assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../tools/manifest_lib.js');
const RID = require('../tools/runtime_ids.js');
const PS = require('../tools/prepare_staged_workflows.js');

const ROOT = path.join(__dirname, '..');
const DEPLOY = path.join(ROOT, 'scripts', 'deploy_n8n.sh');
const RECONCILE = path.join(ROOT, 'tools', 'reconcile_credentials.js');
const BASE_PATH = process.env.PATH;
const HOME = process.env.HOME || '/root';
const PH_RE = /paste|placeholder|changeme|change_me|<[^>]+>|your[-_]|todo|replace[-_]?me/i;

// The full production-shaped credential set: exactly one credential per required (type,name).
const CREDS_FULL = [
  { id: 'cg', name: 'Google Sheets - Marketing Scout Service Account', type: 'googleApi' },
  { id: 'cc', name: 'Claude API - Marketing Scout', type: 'httpHeaderAuth' },
  { id: 'cf', name: 'Firecrawl API - Marketing Scout', type: 'httpHeaderAuth' },
  { id: 'ca', name: 'Apify API - Marketing Scout', type: 'httpHeaderAuth' },
  { id: 'cv', name: 'HTTP Query Auth - VK Access Token', type: 'httpQueryAuth' }
];
// The real production state: the VK (httpQueryAuth) credential is intentionally DEFERRED (not yet attached).
const CREDS_NO_VK = CREDS_FULL.filter(c => c.type !== 'httpQueryAuth');

// Build a host-stub: stage the runtime closure with `creds`, write a fake n8n that serves them, return stubEnv+paths.
function buildStub(creds) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-obsrep-'));
  const staged = path.join(work, 'staged'); fs.mkdirSync(staged);
  const credsFile = path.join(work, 'creds.json'); fs.writeFileSync(credsFile, JSON.stringify(creds));
  const map = RID.resolveAll(L.runtimeIdentity(), RID.emptyMap(), { byName: {}, byId: {} }).nextMap;
  const st = PS.prepareStaged({ localMap: map, credExport: creds, outDir: staged });
  const localFile = path.join(work, 'local.json'); fs.writeFileSync(localFile, JSON.stringify(map));
  const id = L.runtimeIdentity();
  const listing = Object.keys(id).map(k => (map.workflows[k].id) + '|' + id[k].name).join('\n') + '\n';
  const listFile = path.join(work, 'listing.txt'); fs.writeFileSync(listFile, listing);
  const bin = path.join(work, 'bin'); fs.mkdirSync(bin);
  const fake = '#!/usr/bin/env bash\n' +
    'out=""; for a in "$@"; do case "$a" in --output=*) out="${a#--output=}";; esac; done\n' +
    'case "$1" in\n' +
    '  --version) echo "2.23.3" ;;\n' +
    '  export:workflow) mkdir -p "$out"; cp "$MSFAKE_STAGED"/*.json "$out"/ ;;\n' +
    '  export:credentials) cp "$MSFAKE_CREDS" "$out" ;;\n' +
    '  list:workflow) cat "$MSFAKE_LISTING" ;;\n' +
    '  *) exit 0 ;;\n' +
    'esac\n';
  fs.writeFileSync(path.join(bin, 'n8n'), fake); fs.chmodSync(path.join(bin, 'n8n'), 0o755);
  const stubEnv = {
    MS_N8N_MODE: 'host', PATH: bin + ':' + BASE_PATH, HOME: HOME,
    MSFAKE_STAGED: staged, MSFAKE_CREDS: credsFile, MSFAKE_LISTING: listFile,
    MS_RUNTIME_IDS_LOCAL: localFile, MS_ENV_SOURCE: 'process',
    MS_SPREADSHEET_ID: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG',
    MS_TELEGRAM_ALLOWED_USER_IDS: '111111111'
  };
  return { work, staged, credsFile, stubEnv, stagedSummary: st.summary };
}

function runDeploy(args, env) {
  try {
    const out = execFileSync('bash', [DEPLOY].concat(args), { env, encoding: 'utf8', stdio: 'pipe', cwd: ROOT });
    return { code: 0, out };
  } catch (e) { return { code: e.status == null ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}
const mk = (out, key) => { const m = out.match(new RegExp('^' + key + '=(.+)$', 'm')); return m ? m[1].trim() : null; };

// ---------------------------------------------------------------------------------------------------------------
A.section('OBS-001 — WF18_UNIQUE_CREDENTIALS is WORKFLOW-SCOPED (derived from WF18 refs, not the global export size)');
{
  const s = buildStub(CREDS_FULL);
  // Independently DERIVE the truth from the staged WF18 graph: distinct non-placeholder credential ids it references.
  const wf18File = L.runtimeIdentity().WF18.file;
  const wf18 = JSON.parse(fs.readFileSync(path.join(s.staged, wf18File), 'utf8'));
  const wf18Ids = new Set();
  for (const n of (wf18.nodes || [])) for (const t of Object.keys(n.credentials || {})) {
    const c = n.credentials[t] || {}; if (c.id != null && c.id !== '' && !PH_RE.test(String(c.id))) wf18Ids.add(String(c.id));
  }
  const expectedWf18Unique = wf18Ids.size;

  const out = execFileSync('node', [RECONCILE, '--audit', '--wf-dir', s.staged, '--export', s.credsFile,
    '--prefix', 'PRODUCTION', '--focus', '18_'], { encoding: 'utf8', cwd: ROOT });
  const wf18Unique = Number(mk(out, 'WF18_UNIQUE_CREDENTIALS'));
  const wf18InExport = Number(mk(out, 'WF18_UNIQUE_CREDENTIALS_IN_EXPORT'));
  const exportSize = CREDS_FULL.length;

  A.ok('WF18 references at least one credential (sanity)', expectedWf18Unique >= 1, 'derived=' + expectedWf18Unique);
  A.ok('global export holds >1 credential (so a global count cannot equal the WF18 count by accident)', exportSize > 1);
  A.ok('WF18_UNIQUE_CREDENTIALS equals the credentials WF18 actually references (derived, not hard-coded)',
    wf18Unique === expectedWf18Unique, 'marker=' + wf18Unique + ' derived=' + expectedWf18Unique);
  A.ok('WF18_UNIQUE_CREDENTIALS_IN_EXPORT equals the global export size (truthful global figure)',
    wf18InExport === exportSize, 'marker=' + wf18InExport + ' exportSize=' + exportSize);
  A.ok('the workflow-scoped count is STRICTLY LESS than the global export size (proves it is not the export size)',
    wf18Unique < wf18InExport, 'scoped=' + wf18Unique + ' global=' + wf18InExport);
  const scoped = (wf18Unique === expectedWf18Unique) && (wf18Unique < wf18InExport) && (wf18InExport === exportSize);
  if (scoped) console.log('WF18_UNIQUE_CREDENTIALS_IS_WORKFLOW_SCOPED=PASS');
  fs.rmSync(s.work, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------------------
A.section('REPORT-001 — a DEFERRED production dry-run renders ONE aggregate verdict (never a clean RELEASE_PLAN=OK)');
{
  const s = buildStub(CREDS_NO_VK);  // VK httpQueryAuth omitted => VK references defer (the real production state)
  A.ok('staging with VK omitted produces deferred credential references (>0)', s.stagedSummary.credentials_deferred > 0,
    'deferred=' + s.stagedSummary.credentials_deferred);
  const dr = runDeploy(['--dry-run'], s.stubEnv);

  A.ok('deferred production dry-run NEVER prints a clean RELEASE_PLAN=OK', !/RELEASE_PLAN=OK\b/.test(dr.out));
  A.ok('deferred production dry-run prints the single consistent RELEASE_PLAN=DEFERRED_CREDENTIALS aggregate',
    /RELEASE_PLAN=DEFERRED_CREDENTIALS/.test(dr.out));
  A.ok('the release-plan header itself reads "=> DEFERRED_CREDENTIALS" (no earlier "=> OK")',
    /=> DEFERRED_CREDENTIALS/.test(dr.out) && !/=> OK\b/.test(dr.out));
  A.ok('credential verdict is PASS_WITH_DEFERRED_CREDENTIALS', /PRODUCTION_DRY_RUN_CREDENTIALS=PASS_WITH_DEFERRED_CREDENTIALS/.test(dr.out));
  A.ok('deferred production dry-run exits 3', dr.code === 3, 'code=' + dr.code);

  if (!/RELEASE_PLAN=OK\b/.test(dr.out) && /RELEASE_PLAN=DEFERRED_CREDENTIALS/.test(dr.out)) console.log('DEFERRED_RELEASE_NEVER_PRINTS_CLEAN_OK=PASS');
  if (dr.code === 3) console.log('DEFERRED_RELEASE_EXITS_3=PASS');
  fs.rmSync(s.work, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------------------
A.section('REPORT-001 — a CLEAN dry-run (every reference resolves) prints RELEASE_PLAN=OK and exits 0');
{
  const s = buildStub(CREDS_FULL);
  A.ok('staging with every credential present has 0 deferred references', s.stagedSummary.credentials_deferred === 0,
    'deferred=' + s.stagedSummary.credentials_deferred);
  const dr = runDeploy(['--dry-run'], s.stubEnv);

  A.ok('clean production dry-run exits 0', dr.code === 0, 'code=' + dr.code +
    (dr.code ? ' :: ' + dr.out.split('\n').filter(l => /ABORT|FAIL|preflight|error/i.test(l)).slice(-3).join(' | ') : ''));
  A.ok('clean production dry-run prints RELEASE_PLAN=OK', /RELEASE_PLAN=OK\b/.test(dr.out));
  A.ok('clean production dry-run does NOT print RELEASE_PLAN=DEFERRED_CREDENTIALS', !/RELEASE_PLAN=DEFERRED_CREDENTIALS/.test(dr.out));
  A.ok('clean production dry-run header reads "=> OK"', /=> OK\b/.test(dr.out));

  if (dr.code === 0 && /RELEASE_PLAN=OK\b/.test(dr.out) && !/RELEASE_PLAN=DEFERRED_CREDENTIALS/.test(dr.out)) console.log('CLEAN_RELEASE_PRINTS_OK_ONLY_WHEN_CLEAN=PASS');
  fs.rmSync(s.work, { recursive: true, force: true });
}

A.report('obs-report-entrypoints');
