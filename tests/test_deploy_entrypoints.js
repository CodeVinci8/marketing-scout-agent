// test_deploy_entrypoints.js — REAL shell-entrypoint regression for scripts/deploy_n8n.sh (ENTRYPOINT-001 /
// BLOCKER A + BLOCKER B). Unlike the function-level suites, this RUNS the script's mode dispatch end-to-end:
//
//   Part 1 — shell-safety sweep: every supported mode runs under a CLEAN env (env -i style) with the Docker-safe
//            DRY executor, asserting NO unbound-variable / ordering / shell-init defect (the exact class of bug
//            that made `make credential-audit` die with "N8N_EXPECTED_VERSION: unbound variable"). Each mode emits
//            a <MODE>_ENTRYPOINT=PASS marker.
//   Part 2 — host-stub HAPPY path: a fake `n8n` CLI on PATH serves a canned workflow + non-decrypted credential
//            export so the REAL --credential-audit and --dry-run entrypoints reconcile to PASS through the actual
//            shell flow (no docker, $0, no network). This is the proof an entrypoint works, not just that it parses.
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
const BASE_PATH = process.env.PATH;
const HOME = process.env.HOME || '/root';

// Run deploy_n8n.sh with a controlled env (nothing inherited except what we pass). Captures stdout+stderr+code.
function runDeploy(args, extraEnv) {
  const env = Object.assign({ PATH: BASE_PATH, HOME: HOME }, extraEnv || {});
  try {
    const out = execFileSync('bash', [DEPLOY].concat(args), { env, encoding: 'utf8', stdio: 'pipe', cwd: ROOT });
    return { code: 0, out: out };
  } catch (e) { return { code: e.status == null ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}
// The shell-init defects we must never reintroduce (BLOCKER A class).
function initDefect(out) {
  return /unbound variable|: command not found|syntax error|bad substitution|: line [0-9]+: [A-Za-z_][A-Za-z0-9_]*: parameter/.test(out);
}

// ---------------------------------------------------------------------------------------------------------------
A.section('ENTRYPOINT-001 — every deploy mode initializes shared manifest/version context before strict-shell use');
// Docker DRY executor: n8n_available() returns true but NOTHING is executed (no docker, no real export). The point
// is purely to exercise each mode's INITIALIZATION ORDER under `set -euo pipefail` with an empty environment.
const SWEEP = ['--status', '--discover', '--check-config', '--credential-audit', '--verify-production',
  '--verify-bindings', '--dry-run', '--offline-plan', '--plan-triggers', '--deactivate-triggers'];
for (const m of SWEEP) {
  const r = runDeploy([m], { MS_N8N_EXEC_DRY: '1', MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'n8n-n8n-1' });
  const offenders = r.out.split('\n').filter(l => /unbound variable|command not found|syntax error|bad substitution/.test(l)).slice(0, 2).join(' | ');
  A.ok('mode ' + m + ' — no unbound-variable / shell-init defect under a clean env', !initDefect(r.out), offenders);
}

// The specific BLOCKER A repro: credential-audit must reach its OWN logic (manifest/version initialized), never die
// on N8N_EXPECTED_VERSION before first use.
{
  const r = runDeploy(['--credential-audit'], { MS_N8N_EXEC_DRY: '1', MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'n8n-n8n-1' });
  A.ok('credential-audit no longer dies on N8N_EXPECTED_VERSION unbound', !/N8N_EXPECTED_VERSION: unbound variable/.test(r.out));
  A.ok('credential-audit reaches its own runtime-workflow accounting (mode initialized)', /PRODUCTION_RUNTIME_WORKFLOWS=/.test(r.out));
  console.log('CREDENTIAL_AUDIT_ENTRYPOINT=PASS');
}
{
  const r = runDeploy(['--status'], { MS_N8N_EXEC_DRY: '1', MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'n8n-n8n-1' });
  A.ok('status mode reaches its classification header (manifest loaded first)', !initDefect(r.out));
  console.log('STATUS_ENTRYPOINT=PASS');
}
{
  const r = runDeploy(['--discover'], { MS_N8N_EXEC_DRY: '1', MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'n8n-n8n-1' });
  A.ok('discover mode prints the manifest runtime plan (no init defect)', /Manifest runtime plan:/.test(r.out) && !initDefect(r.out));
  console.log('DISCOVERY_ENTRYPOINT=PASS');
}
{
  const r = runDeploy(['--check-config'], { MS_N8N_EXEC_DRY: '1', MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'n8n-n8n-1', MS_ENV_SOURCE: 'process' });
  A.ok('check-config runs the preflight without a shell-init defect', !initDefect(r.out));
  console.log('CHECK_CONFIG_ENTRYPOINT=PASS');
}

// ---------------------------------------------------------------------------------------------------------------
A.section('ENTRYPOINT — production dry-run is FAIL-CLOSED when no n8n is reachable (never a silent OK)');
{
  // docker mode + a container that cannot exist => n8n_available() false => production dry-run must refuse (offline only).
  const r = runDeploy(['--dry-run'], { MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'ms-nonexistent-test-container-zzz' });
  A.ok('production dry-run with no reachable n8n fails closed', r.code !== 0);
  A.ok('it points the operator at --offline-plan', /offline-plan/.test(r.out));
}

// ---------------------------------------------------------------------------------------------------------------
A.section('ENTRYPOINT (host-stub) — REAL --credential-audit + --dry-run reconcile to PASS through the shell flow');
// Build a fully-resolved staged runtime set + a synthetic NON-decrypted credential export with exactly one
// credential per required (type,name) so EVERY reference reconciles (0 deferred). A fake `n8n` serves them.
let stubOk = true;
try {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-entry-'));
  const staged = path.join(work, 'staged'); fs.mkdirSync(staged);
  const creds = [
    { id: 'cg', name: 'Google Sheets - Marketing Scout Service Account', type: 'googleApi' },
    { id: 'cc', name: 'Claude API - Marketing Scout', type: 'httpHeaderAuth' },
    { id: 'cf', name: 'Firecrawl API - Marketing Scout', type: 'httpHeaderAuth' },
    { id: 'ca', name: 'Apify API - Marketing Scout', type: 'httpHeaderAuth' },
    { id: 'cv', name: 'HTTP Query Auth - VK Access Token', type: 'httpQueryAuth' }
  ];
  const credsFile = path.join(work, 'creds.json'); fs.writeFileSync(credsFile, JSON.stringify(creds));
  const map = RID.resolveAll(L.runtimeIdentity(), RID.emptyMap(), { byName: {}, byId: {} }).nextMap;
  const st = PS.prepareStaged({ localMap: map, credExport: creds, outDir: staged });
  A.ok('staged fixture reconciles every reference (0 deferred) for the stub', st.ok && st.summary.credentials_deferred === 0);
  // Point the deploy's installation-local id map at the SAME map the fixture/export use, so release_plan's
  // resolve_ids agrees with the (stubbed) production export instead of the real repo-local map.
  const localFile = path.join(work, 'local.json'); fs.writeFileSync(localFile, JSON.stringify(map));

  // listing "id|name" for the 15 runtime workflows (only --status consumes it; harmless for the two modes we drive)
  const id = L.runtimeIdentity();
  const listing = Object.keys(id).map(k => (map.workflows[k].id) + '|' + id[k].name).join('\n') + '\n';
  const listFile = path.join(work, 'listing.txt'); fs.writeFileSync(listFile, listing);

  // fake n8n CLI: serves --version / export:workflow (dir) / export:credentials (file) / list:workflow.
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
    MS_N8N_MODE: 'host', PATH: bin + ':' + BASE_PATH,
    MSFAKE_STAGED: staged, MSFAKE_CREDS: credsFile, MSFAKE_LISTING: listFile,
    MS_RUNTIME_IDS_LOCAL: localFile,
    MS_ENV_SOURCE: 'process',
    MS_SPREADSHEET_ID: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG',
    MS_TELEGRAM_ALLOWED_USER_IDS: '111111111'
  };

  // --credential-audit: audits the live (stubbed) export against the live (stubbed) creds -> PASS, exit 0.
  const ca = runDeploy(['--credential-audit'], stubEnv);
  A.ok('host-stub --credential-audit exits 0', ca.code === 0, 'code=' + ca.code);
  A.ok('host-stub PRODUCTION_CREDENTIAL_AUDIT=PASS', /PRODUCTION_CREDENTIAL_AUDIT=PASS/.test(ca.out));
  A.ok('host-stub WF18_CREDENTIAL_AUDIT=PASS', /WF18_CREDENTIAL_AUDIT=PASS/.test(ca.out));
  A.ok('host-stub credential-audit: 0 missing references', /PRODUCTION_NODES_MISSING_REFERENCE=0/.test(ca.out));

  // --dry-run (production target): exports, resolves ids, stages, audits, plans -> PASS + RELEASE_PLAN=OK, exit 0.
  const dr = runDeploy(['--dry-run'], stubEnv);
  A.ok('host-stub production --dry-run exits 0', dr.code === 0, 'code=' + dr.code + (dr.code ? ' :: ' + dr.out.split('\n').filter(l => /ABORT|FAIL|preflight|error/i.test(l)).slice(-3).join(' | ') : ''));
  A.ok('host-stub dry-run performs real reconciliation (PRODUCTION_DRY_RUN_CREDENTIALS=PASS)', /PRODUCTION_DRY_RUN_CREDENTIALS=PASS/.test(dr.out));
  A.ok('host-stub dry-run RELEASE_PLAN=OK', /RELEASE_PLAN=OK/.test(dr.out));
  A.ok('host-stub dry-run reconcile_credentials is reconciled (not "deferred to apply")', !/reconciliation deferred to apply/.test(dr.out));
  // derive the expected reference count from the canonical workflows so a legitimate node change (e.g. the WF18
  // batchGet read refactor: 6 googleApi read refs -> 1) updates the expectation instead of silently breaking.
  const expectedRefs = (() => {
    const L = require('../tools/manifest_lib.js'); const fs = require('fs'); const path = require('path');
    let n = 0;
    for (const f of L.importOrder()) { const wf = JSON.parse(fs.readFileSync(path.join(L.WF_DIR, f), 'utf8')); (wf.nodes || []).forEach(nd => { if (nd.credentials) n += Object.keys(nd.credentials).length; }); }
    return n;
  })();
  A.ok('host-stub dry-run reconciles ' + expectedRefs + ' canonical references, 0 deferred', /PRODUCTION_CREDENTIAL_DEFERRED=0/.test(dr.out) && new RegExp('PRODUCTION_CREDENTIAL_REFERENCES=' + expectedRefs + '\\b').test(dr.out));
  if (/PRODUCTION_DRY_RUN_CREDENTIALS=PASS/.test(dr.out) && dr.code === 0) console.log('PRODUCTION_DRY_RUN_ENTRYPOINT=PASS');

  fs.rmSync(work, { recursive: true, force: true });
} catch (e) { stubOk = false; A.ok('host-stub entrypoint harness ran', false, String(e && e.message)); }

// ------------------------------------------------------------------------------------------------------------
A.section('DISPATCH-PUBLISH-001 — callable dispatch targets are publishable (n8n 2.x refuses unpublished sub-wf)');
{
  const fs2 = require('fs'); const path2 = require('path');
  const deploy = fs2.readFileSync(path2.join(__dirname, '..', 'scripts', 'deploy_n8n.sh'), 'utf8');
  A.ok('deploy exposes --publish-callables', /--publish-callables\) MODE="publish-callables"/.test(deploy) && /publish_callables\(\)/.test(deploy));
  A.ok('deploy exposes --unpublish-callables (rollback)', /--unpublish-callables\) MODE="unpublish-callables"/.test(deploy) && /unpublish_callables\(\)/.test(deploy));
  A.ok('publish-callables fail-closes on a public/scheduled trigger', /assert_callable_no_public_surface/.test(deploy) && /refusing to publish/.test(deploy));
  A.ok('publish set comes from the manifest callable targets (no hand list)', /for f in "\$\{CALLABLE_TARGETS\[@\]\}"/.test(deploy));
  // every manifest callable must indeed carry ONLY executeWorkflow/manual triggers — the runtime precondition
  const L2 = require('../tools/manifest_lib.js');
  for (const f of L2.callableTargets()) {
    const wf = JSON.parse(fs2.readFileSync(path2.join(L2.WF_DIR, f), 'utf8'));
    const bad = (wf.nodes || []).filter(n => /trigger|webhook|cron|interval/i.test(String(n.type)) && !/executeWorkflowTrigger|manualTrigger/.test(String(n.type)));
    A.eq(f + ' has no public/scheduled trigger (safe to publish)', bad.map(n => n.type).join(','), '');
    // TRIGGER-INPUTS-001: the trigger's workflowInputs is a fixedCollection { values:[{name,type}] } with
    // minRequiredFields=1. The caller-style resourceMapper ({mappingMode,value,schema}) counts as ZERO fields —
    // checkForWorkflowIssues then kills every server-side dispatch with WorkflowHasIssuesError (live-observed).
    const trg = (wf.nodes || []).find(n => /executeWorkflowTrigger/.test(String(n.type)));
    const wi = (trg && trg.parameters && trg.parameters.workflowInputs) || {};
    A.ok(f + ' trigger declares >=1 fixedCollection input field (no resourceMapper shape)',
      Array.isArray(wi.values) && wi.values.length >= 1 && wi.values.every(v => v && v.name) && wi.mappingMode === undefined && wi.schema === undefined);
  }
  // WF23/WF25 are NOT callables — publishing callables must never touch the scheduled workflows
  A.ok('WF23/WF25 are not in the callable publish set', L2.callableTargets().every(f => !/^2[35]_/.test(f)));
}

// ------------------------------------------------------------------------------------------------------------
A.section('CI-HERMETIC-001 — the entrypoints must work on a machine with NO docker (clean GitHub runner)');
// Root cause this locks: n8n_version_string() ran `docker exec … n8n --version` unconditionally, ignoring the DRY
// executor. Under the callers' `set -euo pipefail`, a missing docker binary (127) or an absent container (1) made
// detect_n8n_version()'s command substitution exit the whole script SILENTLY, so --credential-audit never reached
// its own accounting. The suite therefore passed only where a real n8n container answered — the production VPS —
// and failed in CI. Here we rebuild a minimal PATH with docker deliberately absent and prove the modes still run.
{
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-nodocker-')) + '/bin';
  fs.mkdirSync(bin);
  const needed = ['bash', 'sh', 'node', 'python3', 'mktemp', 'rm', 'mkdir', 'grep', 'sed', 'awk', 'cat', 'cp',
    'ls', 'date', 'env', 'dirname', 'basename', 'find', 'sort', 'uniq', 'head', 'tail', 'wc', 'tr', 'cut',
    'chmod', 'touch', 'id', 'readlink', 'stat', 'xargs', 'printf'];
  const dirs = String(BASE_PATH || '').split(':').filter(Boolean);
  let linked = 0;
  for (const b of needed) {
    const src = dirs.map(d => path.join(d, b)).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (e) { return false; } });
    if (src) { try { fs.symlinkSync(src, path.join(bin, b)); linked++; } catch (e) { /* already linked */ } }
  }
  A.ok('built a minimal PATH sandbox for the hermetic check', linked >= 20, 'linked=' + linked);
  const noDocker = (args, extra) => {
    const env = Object.assign({ PATH: bin, HOME: HOME }, extra || {});
    try { return { code: 0, out: execFileSync('bash', [DEPLOY].concat(args), { env, encoding: 'utf8', stdio: 'pipe', cwd: ROOT }) }; }
    catch (e) { return { code: e.status == null ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') }; }
  };
  A.ok('sandbox really has no docker', !fs.existsSync(path.join(bin, 'docker')));

  const dry = { MS_N8N_EXEC_DRY: '1', MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'n8n-n8n-1' };
  const ca = noDocker(['--credential-audit'], dry);
  A.ok('no-docker: credential-audit reaches its runtime-workflow accounting', /PRODUCTION_RUNTIME_WORKFLOWS=/.test(ca.out), ca.out.slice(-400));
  A.ok('no-docker: credential-audit emits its verdict marker', /PRODUCTION_CREDENTIAL_AUDIT=/.test(ca.out), ca.out.slice(-400));
  A.ok('no-docker: an unreachable n8n reports version "unknown", it does not abort',
    /n8n CLI detected: version unknown/.test(ca.out), ca.out.slice(0, 400));
  A.ok('no-docker: no shell-init defect', !initDefect(ca.out), ca.out.slice(-400));

  for (const m of ['--status', '--discover', '--check-config', '--verify-bindings', '--offline-plan']) {
    const r = noDocker([m], dry);
    A.ok('no-docker: mode ' + m + ' runs without a shell-init defect', !initDefect(r.out), r.out.slice(-300));
  }
  // Fail-closed behaviour must survive the fix: a production dry-run with genuinely no n8n still refuses.
  const fc = noDocker(['--dry-run'], { MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'definitely-not-running' });
  A.ok('no-docker: production dry-run still FAILS CLOSED (no silent OK)', fc.code !== 0 && /requires a reachable n8n/.test(fc.out), fc.out.slice(-300));
}

A.report('deploy-entrypoints');
