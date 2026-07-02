// test_release_integration.js — proves the OPERATOR DEPLOY PATH calls the release-core components in the
// required order, fail-closed (RELEASE-005, DEPLOY-002/003/004/007, CONFIG/PREFLIGHT, §13). A test that checks
// each component in isolation is insufficient (the original Stage-8 defect), so this drives the shared ordered
// planner (tools/release_plan.js) + env discovery (tools/env_discovery.js) end to end and asserts the order, the
// fail-closed aborts, and that the deploy/disposable SCRIPTS actually wire these tools in. Pure + offline, $0.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const L = require('../tools/manifest_lib.js');
const RID = require('../tools/runtime_ids.js');
const RC = require('../tools/reconcile_credentials.js');
const PLAN = require('../tools/release_plan.js');
const ENV = require('../tools/env_discovery.js');

const identity = L.runtimeIdentity();
const KEYS = Object.keys(identity);
function fullIdx(suffix) { const byName = {}, byId = {}; KEYS.forEach(k => { const id = 'pid_' + k + (suffix || ''); byName[identity[k].name] = [id]; byId[id] = identity[k].name; }); return { byName, byId }; }
function stepStatus(p, id) { const s = p.steps.find(x => x.id === id); return s ? s.status : '(absent)'; }
function idxOf(p, id) { return p.steps.findIndex(x => x.id === id); }

// ------------------------------------------------------------------------------------------------------------
A.section('env_discovery — effective config from file/container/process, secrets NEVER printed (CONFIG/PREFLIGHT)');
{
  const fileEnv = ENV.parseEnvFile('export MS_SPREADSHEET_ID=sheetFILE\nMS_TELEGRAM_BOT_TOKEN="999:tokFILEaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\n# comment\nN8N_BLOCK_ENV_ACCESS_IN_NODE=false\n');
  A.eq('env file parses 3 keys', Object.keys(fileEnv).length, 3);
  A.eq('quoted secret value parsed', fileEnv.MS_TELEGRAM_BOT_TOKEN, '999:tokFILEaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const containerEnv = { MS_SPREADSHEET_ID: 'sheetCONTAINER', MS_TELEGRAM_ALLOWED_USER_IDS: '42' };
  const rep = ENV.buildReport({ file: fileEnv, container: containerEnv, process: { PATH: '/x' } });
  // effective precedence: container > file > process
  A.eq('effective spreadsheet comes from container', rep.effective.MS_SPREADSHEET_ID, 'sheetCONTAINER');
  A.eq('effective token falls back to file', rep.effective.MS_TELEGRAM_BOT_TOKEN, '999:tokFILEaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  // material disagreement: file vs container differ on spreadsheet id
  A.ok('material disagreement on MS_SPREADSHEET_ID flagged', rep.mismatches.some(m => m.key === 'MS_SPREADSHEET_ID'));
  A.ok('report agree=false when sources disagree', rep.agree === false);
  // the SANITIZED report (what the CLI serializes) must never carry a raw secret value
  const safe = Object.assign({}, rep); delete safe.effective; delete safe.effective_from;
  const blob = JSON.stringify(safe);
  A.ok('sanitized report has NO secret value', blob.indexOf('tokFILE') < 0 && blob.indexOf('sheetFILE') < 0 && blob.indexOf('sheetCONTAINER') < 0);
  A.ok('sanitized report uses fingerprints', /fp_[0-9a-f]{10}/.test(blob));
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.1-3 — the planner runs discovery -> exact-name reconciliation -> id evaluation IN ORDER');
{
  const idx = fullIdx();
  const localMap = RID.scaffold(identity); KEYS.forEach(k => { localMap.workflows[k].id = 'pid_' + k; });
  const envReport = ENV.buildReport({ container: { MS_SPREADSHEET_ID: 's', MS_TELEGRAM_ALLOWED_USER_IDS: '1' } });
  const p = PLAN.plan({ identity, localMap, exportProvided: true, exportIdx: idx, env: { MS_SPREADSHEET_ID: 's', MS_TELEGRAM_ALLOWED_USER_IDS: '1' }, envReport, credExport: [], credRefs: [], options: { target: 'production', mode: 'dry-run' } });
  A.ok('plan ok with a clean production export', p.ok);
  // the canonical order is enforced
  A.ok('discover_config precedes verify_uniqueness', idxOf(p, 'discover_config') >= 0 && idxOf(p, 'discover_config') < idxOf(p, 'verify_uniqueness'));
  A.ok('verify_uniqueness precedes resolve_ids', idxOf(p, 'verify_uniqueness') < idxOf(p, 'resolve_ids'));
  A.ok('resolve_ids precedes reconcile_workflows', idxOf(p, 'resolve_ids') < idxOf(p, 'reconcile_workflows'));
  A.ok('reconcile_workflows precedes reconcile_credentials', idxOf(p, 'reconcile_workflows') < idxOf(p, 'reconcile_credentials'));
  A.ok('reconcile_credentials precedes strict_preflight', idxOf(p, 'reconcile_credentials') < idxOf(p, 'strict_preflight'));
  A.ok('backup_production precedes import_inactive', idxOf(p, 'backup_production') < idxOf(p, 'import_inactive'));
  A.ok('import_inactive precedes bind_edges precedes fresh_export precedes verify_release',
    idxOf(p, 'import_inactive') < idxOf(p, 'bind_edges') && idxOf(p, 'bind_edges') < idxOf(p, 'fresh_export') && idxOf(p, 'fresh_export') < idxOf(p, 'verify_release'));
  A.eq('step order matches the canonical STEP_ORDER spine', p.steps.map(s => s.id).filter(id => PLAN.STEP_ORDER.indexOf(id) >= 0), PLAN.STEP_ORDER);
  A.eq('discovery/reconcile/resolve all evaluated ok', [stepStatus(p, 'discover_config'), stepStatus(p, 'verify_uniqueness'), stepStatus(p, 'resolve_ids'), stepStatus(p, 'reconcile_workflows')], ['ok', 'ok', 'ok', 'ok']);
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.4 — apply REFUSES runtime-id coverage 0/15 unless ids can be resolved against production');
{
  // production apply, no export captured -> abort at export_existing (cannot resolve installation-local ids)
  const p = PLAN.plan({ identity, localMap: RID.emptyMap(), exportProvided: false, exportIdx: { byName: {}, byId: {} }, env: {}, options: { target: 'production', mode: 'apply' } });
  A.ok('no production export aborts (fail-closed)', p.ok === false && p.abort_step === 'export_existing');
  // every MUTATING middle step is skipped after the abort (cleanup steps persist_evidence/rollback/unlock still run)
  const MUTATING = ['resolve_ids', 'reconcile_workflows', 'reconcile_credentials', 'strict_preflight', 'backup_production', 'import_inactive', 'bind_edges', 'fresh_export', 'verify_release'];
  A.ok('every mutating step after the abort is skipped', MUTATING.every(s => stepStatus(p, s) === 'skipped'));
  A.ok('cleanup still runs on abort (evidence + rollback + unlock)', stepStatus(p, 'persist_evidence') === 'planned' && stepStatus(p, 'rollback_command') === 'ok' && stepStatus(p, 'release_lock') === 'planned');
  // a disposable/fresh install CAN resolve by generating ids (coverage 15/15) -> ok
  const fresh = PLAN.plan({ identity, localMap: RID.emptyMap(), exportProvided: false, exportIdx: { byName: {}, byId: {} }, env: {}, options: { target: 'disposable', mode: 'apply' } });
  A.ok('disposable fresh install resolves 15/15 by generation', fresh.ok && fresh.coverage === '15/15');
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.5 — apply REFUSES duplicate exact names (never selects one)');
{
  const idx = fullIdx(); idx.byName[identity.WF18.name] = ['a', 'b'];
  const p = PLAN.plan({ identity, localMap: RID.emptyMap(), exportProvided: true, exportIdx: idx, env: {}, options: { target: 'production', mode: 'apply' } });
  A.ok('duplicate exact name aborts at verify_uniqueness', p.ok === false && p.abort_step === 'verify_uniqueness');
  A.ok('resolve_ids/import never reached', stepStatus(p, 'resolve_ids') === 'skipped' && stepStatus(p, 'import_inactive') === 'skipped');
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13 negative — ID/name mismatch (local map disagrees with production) aborts at resolve_ids');
{
  const idx = fullIdx();
  const local = RID.scaffold(identity); local.workflows.WF18.id = 'DIFFERENT_FROM_PROD';
  const p = PLAN.plan({ identity, localMap: local, exportProvided: true, exportIdx: idx, env: {}, options: { target: 'production', mode: 'apply' } });
  A.ok('map-vs-production disagreement aborts at resolve_ids', p.ok === false && p.abort_step === 'resolve_ids');
  A.ok('reconcile/preflight/import all skipped after abort', ['reconcile_workflows', 'strict_preflight', 'import_inactive'].every(s => stepStatus(p, s) === 'skipped'));
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.6 — apply REFUSES ambiguous / mismatched credentials');
{
  const idx = fullIdx();
  const local = RID.scaffold(identity); KEYS.forEach(k => { local.workflows[k].id = 'pid_' + k; });
  const base = { identity, localMap: local, exportProvided: true, exportIdx: idx, env: { MS_SPREADSHEET_ID: 's', MS_TELEGRAM_ALLOWED_USER_IDS: '1' } };
  // ambiguous: one cred id present twice in the export
  const refs = [{ file: '08.json', node: 'G', type: 'googleApi', id: 'DUP' }];
  const ambiguous = PLAN.plan(Object.assign({}, base, { credRefs: refs, credExport: [{ id: 'DUP', name: 'a', type: 'googleApi' }, { id: 'DUP', name: 'b', type: 'googleApi' }], options: { target: 'production', mode: 'apply' } }));
  A.ok('ambiguous credential aborts at reconcile_credentials', ambiguous.ok === false && ambiguous.abort_step === 'reconcile_credentials');
  // type mismatch
  const mismatch = PLAN.plan(Object.assign({}, base, { credRefs: refs, credExport: [{ id: 'DUP', name: 'a', type: 'httpHeaderAuth' }], options: { target: 'production', mode: 'apply' } }));
  A.ok('credential type mismatch aborts at reconcile_credentials', mismatch.ok === false && mismatch.abort_step === 'reconcile_credentials');
  // compatible: type matches, single entry -> reconciliation passes (preserve production credential)
  const okPlan = PLAN.plan(Object.assign({}, base, { credRefs: refs, credExport: [{ id: 'DUP', name: 'a', type: 'googleApi' }], options: { target: 'production', mode: 'apply' } }));
  A.ok('compatible credential reconciliation passes (preserved)', okPlan.ok && stepStatus(okPlan, 'reconcile_credentials') === 'ok');
}

// ------------------------------------------------------------------------------------------------------------
A.section('BLOCKER B — a PRODUCTION release must reconcile LIVE credentials (no export => fail-closed; never deferred-to-apply)');
{
  const idx = fullIdx(); const local = RID.scaffold(identity); KEYS.forEach(k => { local.workflows[k].id = 'pid_' + k; });
  const base = { identity, localMap: local, exportProvided: true, exportIdx: idx, env: { MS_SPREADSHEET_ID: 's', MS_TELEGRAM_ALLOWED_USER_IDS: '1' } };
  // production dry-run with NO credential export -> fail-closed at reconcile_credentials (the BLOCKER B defect)
  const noCred = PLAN.plan(Object.assign({}, base, { credExport: null, credRefs: [], options: { target: 'production', mode: 'dry-run' } }));
  A.ok('production dry-run without a credential export fails closed at reconcile_credentials', noCred.ok === false && noCred.abort_step === 'reconcile_credentials');
  A.ok('the abort reason is about reconciling LIVE credentials (fail-closed)', /reconcile LIVE credentials/i.test(noCred.abort_reason || '') && /fail-closed/i.test(noCred.abort_reason || ''));
  A.ok('reconcile_credentials is a hard FAIL, never a deferred-to-apply WARN', stepStatus(noCred, 'reconcile_credentials') === 'fail');
  // off-production planning with no export -> soft warn (does not abort)
  const offline = PLAN.plan(Object.assign({}, base, { credExport: null, credRefs: [], options: { target: 'offline', mode: 'dry-run' } }));
  A.ok('off-production with no export warns (soft), does not abort at credentials', stepStatus(offline, 'reconcile_credentials') === 'warn');
  // production with an export where one TYPE has no production credential yet -> deferred WARN, plan still ok
  const refs = [{ file: '08.json', node: 'G', type: 'googleApi', id: 'pid_g' }, { file: '26.json', node: 'VK', type: 'httpQueryAuth', id: 'PASTE_CREDENTIAL_ID_HERE' }];
  const deferred = PLAN.plan(Object.assign({}, base, { credRefs: refs, credExport: [{ id: 'pid_g', name: 'g', type: 'googleApi' }], options: { target: 'production', mode: 'dry-run' } }));
  A.ok('a deferred credential type is a WARN (not a hard failure)', deferred.ok && stepStatus(deferred, 'reconcile_credentials') === 'warn');
  A.ok('deferred warn detail names the deferred count', /deferred=1/.test((deferred.steps.find(s => s.id === 'reconcile_credentials') || {}).detail || ''));
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13 negative — strict preflight fails closed on a production apply (missing required env)');
{
  const idx = fullIdx(); const local = RID.scaffold(identity); KEYS.forEach(k => { local.workflows[k].id = 'pid_' + k; });
  const p = PLAN.plan({ identity, localMap: local, exportProvided: true, exportIdx: idx, env: {}, envReport: ENV.buildReport({ container: { FOO: 'bar' } }), credExport: [], credRefs: [], options: { target: 'production', mode: 'apply' } });
  A.ok('missing MS_SPREADSHEET_ID/user-ids aborts at strict_preflight', p.ok === false && p.abort_step === 'strict_preflight');
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13 negative — wrong n8n version / :latest image drift fail closed in production');
{
  const idx = fullIdx(); const local = RID.scaffold(identity); KEYS.forEach(k => { local.workflows[k].id = 'pid_' + k; });
  const base = { identity, localMap: local, exportProvided: true, exportIdx: idx, env: { MS_SPREADSHEET_ID: 's', MS_TELEGRAM_ALLOWED_USER_IDS: '1' } };
  const badVer = PLAN.plan(Object.assign({}, base, { n8nVersionActual: '1.0.0', options: { target: 'production', mode: 'apply', expectedVersion: '2.23.3' } }));
  A.ok('wrong n8n version aborts at verify_version', badVer.ok === false && badVer.abort_step === 'verify_version');
  const latest = PLAN.plan(Object.assign({}, base, { options: { target: 'production', mode: 'apply', image: 'n8nio/n8n:latest' } }));
  A.ok(':latest image drift aborts at verify_version', latest.ok === false && latest.abort_step === 'verify_version');
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.14/15 — release evidence carries rollback data and NO secrets / raw ids');
{
  const idx = ((() => { const byName = {}, byId = {}; KEYS.forEach(k => { byName[identity[k].name] = ['RAW_PROD_ID_' + k]; byId['RAW_PROD_ID_' + k] = identity[k].name; }); return { byName, byId }; })());
  const local = RID.scaffold(identity); KEYS.forEach(k => { local.workflows[k].id = 'RAW_PROD_ID_' + k; });
  const p = PLAN.plan({ identity, localMap: local, exportProvided: true, exportIdx: idx, env: { MS_SPREADSHEET_ID: 's', MS_TELEGRAM_ALLOWED_USER_IDS: '1' }, credExport: [], credRefs: [], options: { target: 'production', mode: 'apply' } });
  A.ok('plan ok', p.ok);
  A.ok('rollback command present', /rollback/i.test(p.rollback_command) && p.evidence_attempt.rollback_command);
  const rendered = PLAN.render(p) + JSON.stringify(p);
  A.ok('rendered plan never leaks a raw production id', rendered.indexOf('RAW_PROD_ID_WF18') < 0);
  A.ok('coverage reported as a count, id map as a checksum (not raw)', p.coverage === '15/15' && /^[0-9a-f]{16}$/.test(p.id_map_checksum));
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.16/17 — activation path: WF18 gate is consulted and enforces the blocker registry');
{
  const idx = fullIdx(); const local = RID.scaffold(identity); KEYS.forEach(k => { local.workflows[k].id = 'pid_' + k; });
  // activation strict preflight needs token/webhook/secret; provide a full activation env so we reach the gate
  const actEnv = { MS_SPREADSHEET_ID: 's', MS_TELEGRAM_ALLOWED_USER_IDS: '1', MS_TELEGRAM_BOT_TOKEN: '123456789:AAAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', MS_TELEGRAM_WEBHOOK_SECRET: '0123456789abcdef0123', PUBLIC_WEBHOOK_BASE_URL: 'https://ops.example.com', N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false', NODE_FUNCTION_ALLOW_BUILTIN: 'zlib' };
  const p = PLAN.plan({ identity, localMap: local, exportProvided: true, exportIdx: idx, env: actEnv, credExport: [], credRefs: [], options: { target: 'production', mode: 'apply', activate: true, requireZlib: true } });
  A.ok('activation plan includes a wf18_gate step', p.steps.some(s => s.id === 'wf18_gate'));
  // The gate's verdict must MATCH config/wf18_blockers.json — not a hardcoded world-state. With any open P0/P1
  // blocker the plan aborts at wf18_gate; with all resolved/accepted the plan proceeds past it.
  const blockers = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'wf18_blockers.json'), 'utf8'));
  const list = Array.isArray(blockers) ? blockers : (blockers.blockers || []);
  const open = list.filter(b => /^P[01]$/.test(String(b.severity)) && ['resolved', 'accepted'].indexOf(String(b.status)) < 0);
  if (open.length) {
    A.ok('open P0/P1 blockers (' + open.map(b => b.id).join(',') + ') => gate fails closed', p.ok === false && p.abort_step === 'wf18_gate');
  } else {
    A.ok('all P0/P1 blockers resolved/accepted => gate passes (no wf18_gate abort)', p.abort_step !== 'wf18_gate');
  }
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.20 + ACTIVATE-001/MARKER-001/DOCS-001 — the SCRIPTS actually wire the release-core tools');
{
  const deploy = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy_n8n.sh'), 'utf8');
  // RELEASE-005: deploy now consumes the previously-disconnected tools
  A.ok('deploy references the runtime-id resolver', /tools\/runtime_ids\.js/.test(deploy));
  A.ok('deploy references env discovery', /tools\/env_discovery\.js/.test(deploy));
  A.ok('deploy references the ordered release planner', /tools\/release_plan\.js/.test(deploy));
  // DEPLOY-003: no "(assigned on import)" placeholder is ever printed (only in the documenting comments)
  const codeLines = deploy.split('\n').filter(l => !/^\s*#/.test(l));
  A.ok('deploy never PRINTS id=(assigned on import)', !codeLines.some(l => /\(assigned on import\)/.test(l)));
  A.ok('deploy logs use id_fp= fingerprints', /id_fp=/.test(deploy));
  // DEPLOY-002: first-match awk selection removed; strict exact-name count resolution in place
  A.ok('deploy uses strict exact-name resolution (count 0/1/>1)', /resolve_exact_name/.test(deploy) && /ambiguous/.test(deploy));
  A.ok('legacy first-match id_for_workflow_name function removed', !/id_for_workflow_name\(\)/.test(deploy));
  // DEPLOY-004: production-target dry-run fails closed; offline plan is explicitly named + soft
  A.ok('explicit offline-plan mode exists and does not claim production readiness', /--offline-plan/.test(deploy) && /does NOT assert production readiness/.test(deploy));
  A.ok('production dry-run fails closed', /production-target dry-run FAILED CLOSED/.test(deploy));
  // §8/§13.9 — apply imports STAGED prepared JSON (never raw source), resolving ids + creds first
  A.ok('deploy stages prepared workflows before import', /prepare_staged_workflows\.js/.test(deploy));
  A.ok('apply imports from the staged dir (import_src), not the raw WF_DIR', /import_src="\$\{tmp\}\/staged"/.test(deploy) && /import:workflow --input="\$\{import_src\}\/\$\{f\}"/.test(deploy));
  A.ok('apply no longer imports raw WF_DIR templates in the main loop', !/import:workflow --input="\$\{WF_DIR\}\/\$\{f\}" --activeState=false/.test(deploy));
  A.ok('apply resolves+persists installation-local ids before staging', /RUNTIME_IDS_TOOL" resolve --export-dir[^\n]*--apply/.test(deploy));
  // non-decrypted credential metadata only; the actual CODE must never pass --decrypted (comments may mention it)
  A.ok('apply reconciles credentials via a non-decrypted export', codeLines.some(l => /export:credentials --all/.test(l)));
  A.ok('deploy CODE never passes --decrypted', !codeLines.some(l => /--decrypted/.test(l)));
  // §12/DOCS-001 — no instruction to manually attach COMPATIBLE credentials in the UI
  A.ok('compatible credentials are preserved automatically (no blanket manual-UI attach step)', /preserved automatically/.test(deploy) && !/In the n8n UI, attach credentials \(Google Sheets/.test(deploy));
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.7/8 + ROLLBACK-001 — apply acquires the lock, backs up BEFORE import, writes evidence + rollback');
{
  const deploy = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy_n8n.sh'), 'utf8');
  A.ok('deploy sources the shared release pipeline', /release_pipeline\.sh/.test(deploy));
  A.ok('apply acquires the release lock', /rp_lock_acquire/.test(deploy));
  A.ok('apply installs the EXIT-trap finisher (releases lock + abort evidence on failure)', /trap "rp_finish/.test(deploy));
  A.ok('apply backs up production before mutation', /rp_backup_production/.test(deploy));
  // backup must precede the first staged import
  const backupIdx = deploy.indexOf('rp_backup_production || die');
  const importIdx = deploy.indexOf('import:workflow --input="${import_src}/${f}"');
  A.ok('backup is invoked BEFORE the first staged import', backupIdx >= 0 && importIdx >= 0 && backupIdx < importIdx);
  // Apply runs the POST-IMPORT credential audit and writes evidence with the HONEST credential status (never a bare
  // PASS when credentials are unknown/deferred), emits rollback, marks RP_DONE.
  A.ok('apply runs the post-import credential audit before evidence', /--audit --wf-dir "\$tmp\/runtime_audit"/.test(deploy));
  A.ok('apply writes evidence with the derived credential status + emits rollback + marks RP_DONE',
    /rp_write_evidence "\$CRED_STATUS"/.test(deploy) && /rp_emit_rollback/.test(deploy) && /RP_DONE="yes"/.test(deploy));
  A.ok('apply refuses to claim "preserved automatically" unless CREDENTIAL_AUDIT=PASS', /if \[ "\$CRED_STATUS" = "PASS" \]/.test(deploy));
  A.ok('a hard credential FAILURE blocks the clean release (return 1)', /CREDENTIAL_AUDIT=FAIL — do NOT activate/.test(deploy));
  // the shared library writes evidence via the sanitizing release_report.js (fingerprints only) and passes creds
  const lib = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'release_pipeline.sh'), 'utf8');
  A.ok('evidence goes through the sanitizing release_report.js', /release_report\.js/.test(lib));
  A.ok('evidence carries the credential audit + counts for honest derivation', /"credential_audit":"%s"/.test(lib) && /RP_CRED_AUDIT/.test(lib));
  A.ok('abort path preserves diagnostics + rollback (RP_DONE!=yes)', /RP_DONE" != "yes"/.test(lib) && /RELEASE_ABORTED/.test(lib));
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.19 + ROLLBACK-001 — rollback.sh is a REAL rollback, not just Telegram deactivation');
{
  const rb = fs.readFileSync(path.join(ROOT, 'scripts', 'rollback.sh'), 'utf8');
  A.ok('rollback deletes the Telegram webhook', /telegram_webhook\.sh|deleteWebhook|WEBHOOK\}? delete/.test(rb) && /delete --apply/.test(rb));
  A.ok('rollback unpublishes/deactivates the trigger workflows', /--deactivate-triggers/.test(rb));
  A.ok('rollback restores the runtime-id map from a backup', /RUNTIME_IDS_LOCAL/.test(rb) && /\.bak\./.test(rb));
  A.ok('rollback references the pre-release backup for DB restore', /n8n-prerelease-|from-backup|restore_validate\.sh/.test(rb));
  A.ok('rollback verifies post-rollback state', /--status/.test(rb));
  A.ok('rollback never removes the volume / decrypts', !/down -v|volume rm|--decrypted/.test(rb.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')));
  const mk = fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  A.ok('make rollback invokes rollback.sh (not only telegram-deactivate)', /rollback:\n\tscripts\/rollback\.sh --apply/.test(mk));
}

// ------------------------------------------------------------------------------------------------------------
A.section('§5 failure behavior — rp_finish writes ABORT evidence + releases lock; clean run does not');
{
  const { execFileSync } = require('child_process');
  const os = require('os');
  function runFinish(done) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-rpf-'));
    const ev = path.join(tmp, 'ev'); const lock = path.join(tmp, 'lock');
    const script = [
      'set -euo pipefail',
      'export RP_ROOT="' + ROOT + '"',
      'export MS_RELEASE_EVIDENCE_DIR="' + ev + '"',
      'export MS_RELEASE_LOCK="' + lock + '"',
      '. "' + ROOT + '/scripts/lib/n8n_exec.sh"',
      '. "' + ROOT + '/scripts/lib/release_pipeline.sh"',
      'rp_lock_acquire >/dev/null',
      'RP_DONE="' + done + '"',
      'rp_finish ""',
      '"' + ROOT + '/scripts/release_lock.sh" status'
    ].join('\n');
    let out; try { out = execFileSync('bash', ['-c', script], { encoding: 'utf8' }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    const files = fs.existsSync(ev) ? fs.readdirSync(ev) : [];
    const evText = files.length ? fs.readFileSync(path.join(ev, files[0]), 'utf8') : '';
    fs.rmSync(tmp, { recursive: true, force: true });
    return { out, files, evText };
  }
  const aborted = runFinish('no');
  A.ok('abort run writes exactly one evidence file', aborted.files.length === 1);
  A.ok('abort evidence result=ABORTED', /"result":\s*"ABORTED"/.test(aborted.evText));
  A.ok('abort run releases the lock (status FREE)', /RELEASE_LOCK=FREE/.test(aborted.out));
  A.ok('abort run emits the rollback command', /ROLLBACK_COMMAND=/.test(aborted.out));
  const clean = runFinish('yes');
  A.ok('clean run writes NO abort evidence', clean.files.length === 0);
  A.ok('clean run also releases the lock', /RELEASE_LOCK=FREE/.test(clean.out));
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.16/17/18 + ACTIVATE-001/002 — activation is Docker-safe and transactional (WF18 only)');
{
  const deploy = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy_n8n.sh'), 'utf8');
  const code = deploy.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  // ACTIVATE-001: publish/unpublish ALWAYS via the Docker-safe n8n_cli abstraction; never the bare `n8n` binary
  A.ok('activation uses n8n_cli publish:workflow (Docker-safe)', /n8n_cli publish:workflow/.test(code));
  A.ok('deactivation uses n8n_cli unpublish:workflow (Docker-safe)', /n8n_cli unpublish:workflow/.test(code));
  A.ok('no bare `n8n publish:workflow` (would fail on Docker-only VPS)', !/\bn8n publish:workflow/.test(code));
  A.ok('no bare `n8n unpublish:workflow`', !/\bn8n unpublish:workflow/.test(code));
  // ACTIVATE-002: transactional WF18-only Telegram activation
  A.ok('a transactional --activate-telegram mode exists', /--activate-telegram\)\s*MODE="activate-telegram"/.test(deploy));
  A.ok('activate_telegram publishes WF18 only (the gateway file)', /WF18_FILE="18_telegram_agent_gateway\.json"/.test(deploy));
  A.ok('activate_telegram states WF23/WF25 are NOT touched', /WF23\/WF25 (are NOT touched|remain inactive)/.test(deploy));
  A.ok('activation runs the stricter --for-activation preflight', /--for-activation --require-zlib/.test(deploy));
  A.ok('activation passes the WF18 hard gate', /wf18_activation_gate\.js/.test(deploy));
  // webhook failure auto-unpublishes WF18 (transactional rollback)
  const setIdx = deploy.indexOf('telegram_webhook.sh" set --apply');
  const rollbackIdx = deploy.indexOf('webhook registration FAILED');
  A.ok('webhook registration failure unpublishes WF18 (transactional)', setIdx >= 0 && rollbackIdx >= 0 && /unpublishing WF18/.test(deploy));
  A.ok('webhook verification failure also rolls back WF18', /webhook verification FAILED/.test(deploy) && /WEBHOOK_MATCH=PASS/.test(deploy));
  const mk = fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  A.ok('make telegram-activate uses the transactional WF18-only path', /telegram-activate:\n\tscripts\/deploy_n8n\.sh --activate-telegram/.test(mk));
  A.ok('make telegram-activate is NOT the old publish-then-set two-step', !/--activate-triggers\n\tscripts\/telegram_webhook\.sh set --apply/.test(mk));
}

// ------------------------------------------------------------------------------------------------------------
A.section('§13.20 + TEST-002/003 + MARKER-001 — disposable acceptance drives the SAME shared pipeline');
{
  const e2e = fs.readFileSync(path.join(ROOT, 'scripts', 'n8n_disposable_e2e.sh'), 'utf8');
  const lib = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'disposable_n8n.sh'), 'utf8');
  // TEST-002: it runs the production deploy path, not the legacy stage+bind reimplementation
  A.ok('disposable e2e drives scripts/deploy_n8n.sh --apply (the shared pipeline)', /deploy_n8n\.sh" --apply/.test(e2e));
  A.ok('disposable e2e starts/stops a persistent disposable container', /disp_start_persistent/.test(e2e) && /disp_stop_persistent/.test(e2e));
  A.ok('disposable e2e never targets the production container/volume name', /disp_guard_name/.test(lib) && /n8n-n8n-1/.test(lib) && /n8n_n8n_data/.test(lib));
  A.ok('disposable removal uses EXACT disposable names, never an image/ancestor filter', !/docker (rm|stop)[^\n]*--filter[^\n]*ancestor/.test(e2e) && /ms-disp-e2e-/.test(e2e));
  // MARKER-001: the runtime marker is renamed to TOPOLOGY (no false PARENT_CHILD_RUNTIME)
  A.ok('emits PARENT_CHILD_TOPOLOGY', /PARENT_CHILD_TOPOLOGY/.test(e2e));
  A.ok('does NOT emit the misleading PARENT_CHILD_RUNTIME', !/PARENT_CHILD_RUNTIME=/.test(e2e));
  // §14: the honest marker block is present
  for (const m of ['RELEASE_PIPELINE_SHARED', 'DISPOSABLE_IMPORT', 'DISPOSABLE_REIMPORT', 'RUNTIME_ID_RESOLUTION',
    'EXACT_NAME_RECONCILIATION', 'CREDENTIAL_RECONCILIATION', 'BACKUP_RESTORE_SMOKE', 'BINDINGS',
    'RELEASE_LOCK', 'RELEASE_EVIDENCE', 'ROLLBACK_READINESS', 'DISPOSABLE_DEPLOY']) {
    A.ok('disposable e2e emits ' + m, new RegExp(m).test(e2e));
  }
  // PRODUCTION_UNTOUCHED is emitted via the shared disp_production_untouched helper
  A.ok('disposable e2e emits PRODUCTION_UNTOUCHED', /disp_production_untouched/.test(e2e) && /PRODUCTION_UNTOUCHED/.test(lib));
  // TEST-003: the PRIMARY shared-pipeline apply captures its exit code (no `deploy ... || true`)
  A.ok('the shared-pipeline apply captures its exit code (not `|| true`)', /deploy_n8n\.sh" --apply --yes >"\$\{WORK\}\/apply1\.log"[^\n]*; then APPLY1=0; else APPLY1=\$\?; fi/.test(e2e));
  A.ok('no broad `deploy_n8n.sh --apply ... || true`', !/deploy_n8n\.sh" --apply[^\n]*\|\| true/.test(e2e));
  // honest skip: without docker it must SKIP (never a fake PASS)
  A.ok('SKIPs without docker (never fake PASS)', /disp_docker_ready/.test(e2e) && /DISPOSABLE_DEPLOY=SKIPPED/.test(e2e));
  // n8n_exec gained container copy primitives so a docker-exec import can read its input (DEPLOY-001 reality)
  const exec = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'n8n_exec.sh'), 'utf8');
  A.ok('n8n_exec provides n8n_put/n8n_get for docker-mode file transfer', /n8n_put\(\)/.test(exec) && /n8n_get\(\)/.test(exec) && /docker cp/.test(exec));
  // DOCKER-COPY-PERM-001: copy-IN that the n8n CLI must read uses the runtime-readable helper (least-privilege,
  // never world-readable), so it survives a restrictive caller umask (0077 host files -> 0600 in-container, node-owned)
  A.ok('n8n_exec provides n8n_put_for_runtime + n8n_make_runtime_readable (DOCKER-COPY-PERM-001)', /n8n_put_for_runtime\(\)/.test(exec) && /n8n_make_runtime_readable\(\)/.test(exec));
  A.ok('runtime-readable helper sets least-privilege node-owned modes, never world-readable', /chown -R "\$u":"\$u"/.test(exec) && /chmod 0700/.test(exec) && /chmod 0600/.test(exec) && !/chmod -R a\+r|chmod 0644|chmod 0?777/.test(exec));
  A.ok('runtime-readable helper verifies readability as the runtime user and fails closed', /RUNTIME_USER_CANNOT_READ/.test(exec) && /FAIL-CLOSED/.test(exec));
  A.ok('deploy stages files into the container via n8n_put_for_runtime before a docker-mode import', /n8n_put_for_runtime "\$\{tmp\}\/staged"/.test(deployText()));
  A.ok('deploy removes the in-container staging temp after import (CONTAINER_TEMP_CLEANUP)', /rm -rf \\"\$import_src\\"/.test(deployText()));
}
function deployText() { return fs.readFileSync(path.join(ROOT, 'scripts', 'deploy_n8n.sh'), 'utf8'); }

// ------------------------------------------------------------------------------------------------------------
A.section('§7 shell-consumed CLI outputs are ANSI-free (COLOR-STDOUT-001)');
{
  // deploy_n8n.sh does `[ "${#IMPORT_ORDER[@]}" -eq "$RUNTIME_COUNT" ]` on this output. Under FORCE_COLOR
  // (any colour-forcing terminal env) node colorizes console.log(<number>) — "\x1b[33m15\x1b[39m" — which is
  // not an integer and killed activation. Numeric CLI outputs must be printed as plain strings.
  const { execFileSync } = require('child_process');
  const colorEnv = Object.assign({}, process.env, { FORCE_COLOR: '3' });
  for (const cmd of ['runtime-count', 'binding-count', 'callable-count']) {
    const out = execFileSync('node', [path.join(ROOT, 'tools', 'manifest_lib.js'), cmd], { encoding: 'utf8', env: colorEnv }).trim();
    A.ok('manifest_lib ' + cmd + ' is a bare integer under FORCE_COLOR=3 (got ' + JSON.stringify(out) + ')', /^\d+$/.test(out));
  }
}

A.report('release-integration');
