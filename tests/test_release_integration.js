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
  const p = PLAN.plan({ identity, localMap, exportProvided: true, exportIdx: idx, env: { MS_SPREADSHEET_ID: 's', MS_TELEGRAM_ALLOWED_USER_IDS: '1' }, envReport, options: { target: 'production', mode: 'dry-run' } });
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
A.section('§13.16/17 — activation path: WF18 gate is consulted and currently fails closed');
{
  const idx = fullIdx(); const local = RID.scaffold(identity); KEYS.forEach(k => { local.workflows[k].id = 'pid_' + k; });
  // activation strict preflight needs token/webhook/secret; provide a full activation env so we reach the gate
  const actEnv = { MS_SPREADSHEET_ID: 's', MS_TELEGRAM_ALLOWED_USER_IDS: '1', MS_TELEGRAM_BOT_TOKEN: '123456789:AAAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', MS_TELEGRAM_WEBHOOK_SECRET: '0123456789abcdef0123', PUBLIC_WEBHOOK_BASE_URL: 'https://ops.example.com', N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false', NODE_FUNCTION_ALLOW_BUILTIN: 'zlib' };
  const p = PLAN.plan({ identity, localMap: local, exportProvided: true, exportIdx: idx, env: actEnv, credExport: [], credRefs: [], options: { target: 'production', mode: 'apply', activate: true, requireZlib: true } });
  A.ok('activation plan includes a wf18_gate step', p.steps.some(s => s.id === 'wf18_gate'));
  A.ok('WF18 gate currently fails closed (rearchitecture pending)', p.ok === false && p.abort_step === 'wf18_gate');
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
}

A.report('release-integration');
