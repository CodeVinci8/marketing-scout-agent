// release_plan.js — the ORDERED, fail-closed release planner shared by production deploy and disposable
// acceptance (§5 target architecture). This is the single brain that decides what the release pipeline must do,
// in the mandated order, by composing the previously-disconnected release-core tools:
//   runtime_ids.resolveAll   (DEPLOY-007/003/002/006)   reconcile_workflows.reconcile (DEPLOY-002/005/011)
//   reconcile_credentials.reconcile (DEPLOY-008)         preflight_config.evaluate     (CONFIG/PREFLIGHT)
//   wf18_activation_gate.gate (ACTIVATE)                 env_discovery.buildReport      (env source discovery)
//
// It produces an ORDERED step trace (so a test can prove the operator path calls each component in the required
// order) and a single fail-closed verdict. Side-effecting steps (lock/backup/import/bind/export/evidence/unlock)
// are represented as planned steps the shell pipeline executes; the decidable steps (version/uniqueness/id
// resolution/reconciliation/preflight/gate) are evaluated here. On the first hard failure the planner STOPS and
// marks every later step 'skipped' — never "continue importing after an abort".
//
// Pure + offline: all inputs are passed in; this module never calls docker, n8n, or the network.
'use strict';
const RID = require('./runtime_ids.js');
const RW = require('./reconcile_workflows.js');
const RC = require('./reconcile_credentials.js');
const GATE = require('./wf18_activation_gate.js');
const P = require('./preflight_config.js');

// The canonical 22-step order (§5). Each step has a stable id used by the shell pipeline + tests.
const STEP_ORDER = [
  'acquire_lock', 'discover_mode', 'verify_version', 'discover_config', 'export_existing',
  'verify_uniqueness', 'resolve_ids', 'backup_id_map', 'persist_id_map', 'prepare_staged',
  'reconcile_workflows', 'reconcile_credentials', 'strict_preflight', 'backup_production',
  'print_plan', 'import_inactive', 'bind_edges', 'fresh_export', 'verify_release',
  'persist_evidence', 'rollback_command', 'release_lock'
];

const DEFAULT_ROLLBACK = 'scripts/rollback.sh --apply   # (or: make rollback) — unpublish WF18 + delete webhook + restore prior export/id-map';

// plan(input) -> { ok, mode, target, activate, steps, abort_step, abort_reason, coverage, id_map_checksum,
//                  rollback_command, evidence_attempt }
// input:
//   identity        : manifest runtime_identity (15 keys)
//   localMap        : operator-local id map (RID.emptyMap() shape)
//   exportProvided  : bool — was a real n8n export captured? (production MUST have one to resolve ids)
//   exportIdx       : { byName, byId } from RID.indexExportDir (empty {byName:{},byId:{}} if none)
//   credExport      : [{id,name,type}] non-decrypted cred metadata, or null if not yet available
//   credRefs        : [{file,node,type,id}] references in the STAGED workflows (RC.collectReferences shape)
//   env             : effective env object (from env_discovery), or process.env
//   envReport       : env_discovery report (for agreement/source notes), or null
//   n8nVersionActual: detected version string, or 'unknown'
//   options         : { mode:'dry-run'|'apply', target:'production'|'disposable'|'offline', activate:bool,
//                       monitoring, weeklyDigest, expectedVersion, expectedCount, image, requireZlib }
function plan(input) {
  input = input || {};
  const o = input.options || {};
  const target = o.target || 'production';
  const mode = o.mode || 'dry-run';
  const activate = !!o.activate;
  const expectedVersion = o.expectedVersion || '2.23.3';
  const expectedCount = o.expectedCount != null ? o.expectedCount : 15;
  // OPERATOR-REPORT-001: the binding-edge count is derived from the manifest (13 today), never hard-coded.
  const bindingEdgeCount = o.bindingEdgeCount != null ? o.bindingEdgeCount : null;
  const isProd = target === 'production';
  const isOffline = target === 'offline';

  const identity = input.identity || {};
  const keys = Object.keys(identity);
  const steps = [];
  let aborted = false, abortStep = null, abortReason = null;

  // helper: record a step. status: 'planned' | 'ok' | 'warn' | 'fail' | 'skipped'
  function step(id, status, detail) { steps.push({ n: steps.length + 1, id: id, status: status, detail: detail || '' }); }
  // a hard failure: record fail, set abort, and from now every step is skipped.
  function fail(id, reason) { step(id, 'fail', reason); aborted = true; abortStep = id; abortReason = reason; }
  function skip(id) { step(id, 'skipped', 'aborted before this step'); }
  // run a decidable step `fn` only if not yet aborted; otherwise skip it.
  function decide(id, fn) {
    if (aborted) { skip(id); return; }
    fn(id);
  }

  let resolved = null;          // runtime_ids.resolveAll result
  let coverage = null;
  let idMapChecksum = null;
  let deferredCreds = 0;        // REPORT-001: credential references on a TYPE with no production credential yet

  // 1. acquire lock (side effect; planned)
  step('acquire_lock', 'planned', 'host release lock prevents concurrent deploys');

  // 2. discover execution mode + container (from options/abstraction)
  step('discover_mode', 'ok', 'mode=' + (o.execMode || 'docker') + ' container=' + (o.container || 'n8n-n8n-1'));

  // 3. verify n8n version / image (no :latest drift)
  decide('verify_version', (id) => {
    const image = String(o.image || '');
    if (/:latest\b/.test(image)) {
      if (isProd) return fail(id, 'image pinned to :latest is forbidden in production (' + image + ')');
      return step(id, 'warn', 'image uses :latest (' + image + ') — tolerated off-production');
    }
    const v = input.n8nVersionActual || 'unknown';
    if (v !== 'unknown' && v !== expectedVersion) {
      if (isProd) return fail(id, 'n8n version ' + v + ' != expected ' + expectedVersion);
      return step(id, 'warn', 'n8n version ' + v + ' != expected ' + expectedVersion + ' (off-production)');
    }
    step(id, 'ok', 'version=' + v + ' expected=' + expectedVersion);
  });

  // 4. discover configuration sources (env file / compose / container / process)
  decide('discover_config', (id) => {
    const rep = input.envReport;
    if (!rep) { return step(id, isProd && mode === 'apply' ? 'warn' : 'warn', 'no env report supplied'); }
    if (!rep.sources_present || rep.sources_present.length === 0) {
      if (isProd && mode === 'apply') return fail(id, 'no configuration source discovered (env file/container/process all empty)');
      return step(id, 'warn', 'no configuration source discovered');
    }
    if (!rep.agree) {
      // material disagreement between env file and running container
      if (isProd) return fail(id, 'env-file and running container disagree on ' + rep.mismatches.length + ' key(s)');
      return step(id, 'warn', 'env source disagreement (' + rep.mismatches.length + ')');
    }
    step(id, 'ok', 'sources=' + rep.sources_present.join(',') + ' effective=' + (rep.effective_precedence[0] || 'none'));
  });

  // 5. export existing workflows (side effect; for production we MUST have one to resolve ids against)
  decide('export_existing', (id) => {
    if (input.exportProvided) return step(id, 'ok', 'production export captured (' + keys.length + ' identities to resolve)');
    if (isProd) return fail(id, 'no production export captured — cannot resolve installation-local ids (refusing to mint new ids over an existing install)');
    step(id, 'planned', 'fresh/disposable install — export will be empty, ids generated');
  });

  // 6. verify exact-name uniqueness (0/1/>1 — never select one of many)
  decide('verify_uniqueness', (id) => {
    const idx = input.exportIdx || { byName: {}, byId: {} };
    const dupes = keys.map(k => identity[k].name).filter(n => (idx.byName[n] || []).length > 1);
    if (dupes.length) return fail(id, 'duplicate exact workflow name(s) in export: ' + dupes.length + ' — refusing to select one');
    step(id, 'ok', keys.length + ' runtime names, no >1 exact-name collision');
  });

  // 7. resolve installation-local ids (verify/discover/generate/create/abort)
  decide('resolve_ids', (id) => {
    const idx = input.exportIdx || { byName: {}, byId: {} };
    resolved = RID.resolveAll(identity, input.localMap || RID.emptyMap(), idx);
    coverage = resolved.report.coverage;
    idMapChecksum = resolved.report.local_map_checksum;
    if (!resolved.ok) return fail(id, 'id resolution aborted (' + resolved.report.aborts + ' abort(s)): ' +
      resolved.decisions.filter(d => d.action === RID.ACTIONS.ABORT).map(d => d.key + ':' + d.reason).join(', '));
    // DEPLOY-004: a production apply/dry-run must not finish "successful" with coverage 0/15 unresolved
    const covered = keys.filter(k => resolved.nextMap.workflows[k] && resolved.nextMap.workflows[k].id).length;
    if (covered !== keys.length) {
      if (isProd) return fail(id, 'runtime id coverage ' + coverage + ' incomplete and unresolved');
      return step(id, 'warn', 'coverage ' + coverage + ' (off-production)');
    }
    step(id, 'ok', 'coverage=' + coverage + ' checksum=' + idMapChecksum);
  });

  // 8. back up the operator-local id map before changing it (side effect; planned)
  decide('backup_id_map', (id) => step(id, resolved && resolved.mutated ? 'planned' : 'ok', resolved && resolved.mutated ? 'map will change — backup-before-write' : 'map unchanged'));

  // 9. persist the resolved id map (mutation gated by --apply; planned here)
  decide('persist_id_map', (id) => step(id, mode === 'apply' ? 'planned' : 'ok', mode === 'apply' ? 'persist resolved map (chmod 600)' : 'dry-run: map not persisted'));

  // 10. prepare staged workflow JSON with resolved ids (side effect; the import source — never raw files)
  decide('prepare_staged', (id) => step(id, 'planned', 'stage ' + keys.length + ' workflows with resolved ids + active=false + reconciled creds'));

  // 11. reconcile existing workflows by exact name (create/update/abort)
  decide('reconcile_workflows', (id) => {
    const idx = input.exportIdx || { byName: {}, byId: {} };
    const rw = RW.reconcile(identity, idx, resolved ? resolved.nextMap : (input.localMap || RID.emptyMap()));
    if (!rw.ok) return fail(id, 'workflow reconciliation aborted: ' + rw.plan.filter(p => p.action === 'abort').map(p => p.wf + ':' + p.reason).join(', '));
    step(id, 'ok', 'creates=' + rw.summary.creates + ' updates=' + rw.summary.updates + ' aborts=0');
  });

  // 12. reconcile compatible credentials (preserve; abort on ambiguous/mismatch). BLOCKER B: a PRODUCTION release
  //     (dry-run OR apply) MUST reconcile live credentials — never defer the whole step to "apply". With no export
  //     supplied it fails closed for production; with an export it reconciles the RESOLVED references and reports
  //     any deferred ones (a credential TYPE with no production credential yet) as a warning, not a clean pass.
  decide('reconcile_credentials', (id) => {
    if (input.credExport == null) {
      if (isProd) return fail(id, 'no non-decrypted credential export supplied — a production release must reconcile LIVE credentials (fail-closed; never deferred to apply)');
      return step(id, 'warn', 'no credential export supplied (off-production planning only)');
    }
    const refs = input.credRefs || [];
    const PH = /paste|placeholder|changeme|change_me|<[^>]+>|your[-_]|todo|replace[-_]?me/i;
    const resolvedRefs = refs.filter(r => !PH.test(String(r.id)));
    const deferred = refs.length - resolvedRefs.length;
    const rc = RC.reconcile(resolvedRefs, input.credExport);
    if (!rc.ok) return fail(id, 'credential reconciliation FAILED: ' + rc.summary.failures + ' issue(s) (' +
      rc.audit.filter(a => a.status !== 'ok').map(a => a.status).join(',') + ')');
    // REPORT-001: a deferred reference is NOT a clean pass. Record the count so the aggregate plan verdict renders
    // DEFERRED_CREDENTIALS (never a clean RELEASE_PLAN=OK) while the per-step status stays a non-aborting 'warn'.
    if (deferred > 0) { deferredCreds = deferred; return step(id, 'warn', 'references=' + refs.length + ' resolved=' + resolvedRefs.length + ' deferred=' + deferred + ' (type(s) with no production credential yet — operator attaches before activating that path)'); }
    step(id, 'ok', 'references=' + refs.length + ' resolved=' + resolvedRefs.length + ' deferred=0 failures=0');
  });

  // 13. strict production-target preflight (effective env; stricter when activating)
  decide('strict_preflight', (id) => {
    const env = input.env || {};
    const pf = P.evaluate(env, { soft: isOffline, requireZlib: !!o.requireZlib || activate, forActivation: activate });
    if (!pf.ok) {
      if (isProd || activate) return fail(id, 'preflight FAILED (' + pf.error_count + ' error(s)): ' + pf.errors.slice(0, 3).join('; '));
      return step(id, 'warn', 'preflight soft: ' + pf.error_count + ' error(s), ' + pf.warning_count + ' warning(s)');
    }
    step(id, 'ok', (activate ? 'activation-strict' : 'inactive-deploy') + ' preflight: 0 errors, ' + pf.warning_count + ' warning(s)');
  });

  // 13b. activation gate (only when activating — WF18 hard pre-live gate)
  if (activate) {
    decide('wf18_gate', (id) => {
      const g = GATE.gate(GATE.load());
      if (!g.allow) return fail(id, 'WF18 activation gate CLOSED — ' + g.blocking_open + ' open P0/P1 blocker(s); ' + g.marker);
      step(id, 'ok', g.marker);
    });
  }

  // 14. create the production backup BEFORE any mutation (side effect; planned)
  decide('backup_production', (id) => step(id, mode === 'apply' ? 'planned' : 'ok', mode === 'apply' ? 'docker-safe backup before first import' : 'dry-run: no backup taken'));

  // 15. print sanitized mutation plan
  decide('print_plan', (id) => step(id, 'ok', 'sanitized plan (fingerprints only, no raw ids/secrets)'));

  // 16-19 + 20-22: import/bind/export/verify + evidence/rollback/unlock (side effects; planned)
  decide('import_inactive', (id) => step(id, mode === 'apply' ? 'planned' : 'ok', 'import staged JSON --activeState=false (never raw source)'));
  decide('bind_edges', (id) => step(id, mode === 'apply' ? 'planned' : 'ok', (bindingEdgeCount != null ? bindingEdgeCount : 'manifest') + ' Execute Sub-workflow edges auto-bound'));
  decide('fresh_export', (id) => step(id, mode === 'apply' ? 'planned' : 'ok', 're-export to verify against reality'));
  decide('verify_release', (id) => step(id, mode === 'apply' ? 'planned' : 'ok', 'verify ids/names/creds/bindings + active=false'));
  // --- cleanup steps: ALWAYS emitted, even on abort (§5 failure behavior: preserve sanitized diagnostics,
  //     print a rollback instruction, release the lock — never leave a half-finished release silently locked).
  step('persist_evidence', 'planned', aborted ? 'sanitized ABORT diagnostics (fingerprints only)' : 'sanitized release evidence (fingerprints only)');
  step('rollback_command', 'ok', 'rollback command emitted');
  step('release_lock', 'planned', 'release the host lock');

  const evidence_attempt = {
    result: aborted ? 'ABORTED' : (mode === 'apply' ? 'PLANNED_APPLY' : 'DRY_RUN'),
    runtime_workflows_expected: expectedCount,
    runtime_workflows_found: input.exportProvided ? keys.filter(k => (input.exportIdx.byName[identity[k].name] || []).length === 1).length : 0,
    runtime_id_coverage: coverage,
    runtime_id_map_checksum: idMapChecksum,
    n8n_version_expected: expectedVersion,
    n8n_image: o.image || 'n8nio/n8n:2.23.3',
    rollback_command: o.rollbackCommand || DEFAULT_ROLLBACK
  };

  return {
    ok: !aborted,
    mode: mode, target: target, activate: activate,
    deferred_credentials: deferredCreds,
    steps: steps,
    abort_step: abortStep, abort_reason: abortReason,
    coverage: coverage, id_map_checksum: idMapChecksum,
    rollback_command: o.rollbackCommand || DEFAULT_ROLLBACK,
    evidence_attempt: evidence_attempt
  };
}

// REPORT-001: ONE truthful aggregate verdict for the whole plan. A plan that aborted is ABORT; a plan that is
// otherwise OK but carries deferred credential references is DEFERRED_CREDENTIALS (never a clean OK); only a plan
// with zero aborts AND zero deferred references is OK. The shell pipeline and tests both read this single word.
function aggregateVerdict(p) {
  if (!p.ok) return 'ABORT@' + p.abort_step;
  if ((p.deferred_credentials || 0) > 0) return 'DEFERRED_CREDENTIALS';
  return 'OK';
}

// Pretty, sanitized one-line-per-step rendering for the shell pipeline / CLI.
function render(p) {
  const verdict = aggregateVerdict(p);            // OK | DEFERRED_CREDENTIALS | ABORT@<step>
  const marker = p.ok ? ((p.deferred_credentials || 0) > 0 ? 'DEFERRED_CREDENTIALS' : 'OK') : 'ABORT';
  const lines = [];
  lines.push('Release plan (target=' + p.target + ' mode=' + p.mode + ' activate=' + p.activate + ') => ' + verdict);
  for (const s of p.steps) lines.push('  ' + String(s.n).padStart(2) + '. [' + s.status.padEnd(7) + '] ' + s.id + (s.detail ? '  — ' + s.detail : ''));
  if (!p.ok) lines.push('ABORT_REASON: ' + p.abort_reason);
  if (marker === 'DEFERRED_CREDENTIALS') lines.push('RELEASE_PLAN_DEFERRED_CREDENTIALS=' + p.deferred_credentials);
  lines.push('RUNTIME_ID_COVERAGE=' + (p.coverage || 'n/a'));
  lines.push('ROLLBACK_COMMAND=' + p.rollback_command);
  // REPORT-001: the SINGLE aggregate marker. Never a clean OK while a credential reference is deferred.
  lines.push('RELEASE_PLAN=' + marker);
  return lines.join('\n');
}

module.exports = { plan, render, aggregateVerdict, STEP_ORDER, DEFAULT_ROLLBACK };

// CLI: build an effective env + export index from real inputs and print the sanitized ordered plan.
if (require.main === module) {
  const fs = require('fs');
  const L = require('./manifest_lib.js');
  const ENV = require('./env_discovery.js');
  const args = process.argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const target = val('--target') || 'production';
  const mode = val('--mode') || 'dry-run';
  const exportDir = val('--export-dir');
  const localFile = val('--local') || RID.DEFAULT_LOCAL;

  const identity = L.runtimeIdentity();
  let localMap = RID.emptyMap();
  try { localMap = RID.loadLocalMap(localFile); } catch (e) { void e; }
  let exportIdx = { byName: {}, byId: {} }, exportProvided = false;
  if (exportDir && fs.existsSync(exportDir)) { exportIdx = RID.indexExportDir(exportDir); exportProvided = true; }
  const envReport = ENV.discover({ source: val('--env-source'), envFile: val('--env-file'), container: val('--container') });

  // BLOCKER B: a production dry-run reconciles LIVE credentials. The shell passes the captured non-decrypted
  // credential export (--cred-export) and the STAGED workflow dir (--staged-dir) so the planner reconciles the
  // exact references that would be imported, never a hard-coded null.
  let credExport = null, credRefs = [];
  const credExportFile = val('--cred-export');
  if (credExportFile && fs.existsSync(credExportFile)) {
    try { credExport = JSON.parse(fs.readFileSync(credExportFile, 'utf8')); } catch (e) { credExport = null; }
  }
  const stagedDir = val('--staged-dir');
  if (stagedDir && fs.existsSync(stagedDir)) {
    const files = fs.readdirSync(stagedDir).filter(f => f.endsWith('.json'));
    credRefs = RC.collectReferences(files, stagedDir);
  }

  const p = plan({
    identity, localMap, exportProvided, exportIdx, env: envReport.effective, envReport,
    credExport, credRefs, n8nVersionActual: val('--n8n-version') || 'unknown',
    options: {
      target, mode, activate: args.indexOf('--activate') >= 0,
      image: val('--image') || process.env.MS_N8N_IMAGE || 'n8nio/n8n:2.23.3',
      requireZlib: args.indexOf('--require-zlib') >= 0,
      expectedCount: Object.keys(identity).length,
      bindingEdgeCount: L.bindingEdges().length
    }
  });
  console.log(render(p));
  process.exit(p.ok ? 0 : 1);
}
