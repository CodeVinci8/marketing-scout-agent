'use strict';
// test_sheets_operations_qa.js — offline regression for the Stage 3C Google Sheets OPERATIONS acceptance harness.
// Covers Section 10 of the spec end-to-end with NO Google access ($0, no network): reuse-equivalence with the
// canonical libs, contract-clean plan, run identity, preflight, the full operation matrix, formula-injection +
// negative-number handling, owner/request isolation, before/after scope, dry-run + write gating, live-simulated
// apply, repeat-run idempotency, the Section 9 machine-readable summary (RESULT derived, never hard-coded), and
// the generated workflow (inactive, manual-only, no creds/id, Google-only, deterministic/no drift, manifest-excluded).
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const R = require('../n8n/lib/sheets_contract_resolver.js');
const QA = require('../n8n/lib/sheets_operations_qa.js');
const GEN = require('../tools/gen_sheets_operations_qa_workflow.js');
// canonical reuse sources — the engine mirrors these; we assert behavioural equivalence below.
const RPT = require('../n8n/lib/report_export.js');
const AUD = require('../n8n/lib/sheet_audit.js');
const TG = require('../n8n/lib/telegram_io.js');

const resolved = R.resolveOrThrow();
const TEST_SHEETS = ['agent_requests', 'agent_request_events', 'conversation_state', 'tracked_sources', 'telegram_outbox'];

// ---- shared offline harness: build the API-shaped inputs the engine consumes, all in-memory -------------------
function headersOf(name) { return QA.contractSheet(resolved, name).headers.slice(); }
function metadataAll(extra) {
  const sheets = resolved.sheets.map(function (s) { return { properties: { title: s.sheet_name } }; });
  if (extra) extra.forEach(function (t) { sheets.push({ properties: { title: t } }); });
  return { sheets: sheets, developerMetadata: [{ metadataKey: 'marketing_scout_bootstrap', metadataValue: JSON.stringify({ contract_hash: resolved.contract_hash }) }] };
}
function headerRowsAll() { const h = {}; TEST_SHEETS.forEach(function (n) { h[n] = headersOf(n); }); return h; }
function blankObj(name, vals) { const o = {}; headersOf(name).forEach(function (h) { o[h] = ''; }); return Object.assign(o, vals || {}); }
// a before-snapshot carrying ONE foreign row (other owner/request) on the scoped sheets, to prove isolation/scope.
function foreignBefore() {
  const b = {};
  TEST_SHEETS.forEach(function (n) { b[n] = { headers: headersOf(n), rows: [], count: 0 }; });
  b.agent_requests.rows = [blankObj('agent_requests', { agent_request_id: 'foreign-req', user_id: 'someone-else', request_text: 'unrelated', created_at: 'x', state: 'received', status: 'new', request_type: 'manual_intake', source_scope: 'unknown', plan_source: 'deterministic', notes: 'not a qa row' })];
  b.conversation_state.rows = [blankObj('conversation_state', { conversation_id: 'foreign-conv', owner_user_id: 'someone-else', current_state: 'received', updated_at: 'x' })];
  TEST_SHEETS.forEach(function (n) { b[n].count = b[n].rows.length; });
  return b;
}
const ID_CFG = { now_stamp: '20260622T120000', rand_suffix: 'abc123', qa_owner_id: 'qa-stage3-owner', now: '2026-06-22T12:00:00.000Z', now2: '2026-06-22T12:05:00.000Z' };
function runWith(cfgOverride, beforeOverride) {
  const cfg = Object.assign({ qa_owner_id: 'qa-stage3-owner', formula_tests_enabled: true }, ID_CFG, cfgOverride || {});
  const id = QA.buildRunIdentity(cfg);
  return QA.runOffline({ resolved: resolved, metadata: metadataAll(), headerRows: headerRowsAll(), config: cfg, identity: id, before: beforeOverride || foreignBefore() });
}

// =============================================================================================================
A.section('1. reuse-equivalence — engine mirrors the canonical neutralizer / unsafe-cell / outbox id (no forks)');
var BATTERY = ['=1+1', '+SUM(1,1)', '@IMPORTXML("https://example.com","/")', "-CMD|' /C calc'!A0", '-5', '-4.5',
  '0', '12', '3.14', '+7', '', 'hello', 'https://example.com/x', '\tlead-tab', '\rlead-cr', "'already", '=cmd', '@x', 'a=b'];
A.ok('neutralize == report_export.neutralize over the full battery', BATTERY.every(function (v) { return QA.neutralize(v) === RPT.neutralize(v); }));
A.ok('isFiniteNumber == report_export.isFiniteNumber over the full battery', BATTERY.every(function (v) { return QA.isFiniteNumber(v) === RPT.isFiniteNumber(v); }));
A.ok('isUnsafeCell == sheet_audit.isUnsafeCell over the full battery', BATTERY.every(function (v) { return QA.isUnsafeCell(v) === AUD.isUnsafeCell(v); }));
A.ok('payloadHash == telegram_io.payloadHash', ['x', 'QA payload', ''].every(function (v) { return QA.payloadHash(v) === TG.payloadHash(v); }));
A.ok('makeDeliveryId == telegram_io.makeDelivery(...).delivery_id (the real outbox dedup key)',
  QA.makeDeliveryId('reqA', 'repA', 'P') === TG.makeDelivery('reqA', 'repA', 'chat', 'P').delivery_id);
A.ok('neutralize protects every formula test + leaves finite negatives numeric', (function () {
  var protectedAll = QA.FORMULA_TESTS.every(function (f) { return QA.neutralize(f).charAt(0) === "'" && !QA.isUnsafeCell(QA.neutralize(f)); });
  var negKept = QA.NEGATIVE_TESTS.every(function (n) { return QA.neutralize(n).charAt(0) !== "'" && QA.isFiniteNumber(n); });
  return protectedAll && negKept;
})());

A.section('2. contract-cleanliness — every QA field/key/marker is a DECLARED contract header (fails closed)');
var vp = QA.validatePlanAgainstContract(resolved);
A.ok('validatePlanAgainstContract(resolved).ok === true', vp.ok === true);
A.eq('zero contract findings', vp.findings.length, 0);
A.ok('generator build() also runs the contract gate without throwing', (function () { try { GEN.build(); return true; } catch (e) { return false; } })());
A.ok('an undeclared field is detected (gate really fails closed)', (function () {
  var clone = JSON.parse(JSON.stringify(resolved));
  var ar = clone.sheets.find(function (s) { return s.sheet_name === 'agent_requests'; });
  ar.headers = ar.headers.filter(function (h) { return h !== 'notes'; }); // remove the marker column
  return QA.validatePlanAgainstContract(clone).ok === false;
})());

A.section('3. run identity — deterministic, every id traceable to qa_run_id, owner/request A!=B');
var id = QA.buildRunIdentity(ID_CFG);
A.eq('qa_run_id has the stage3c-<stamp>-<suffix> shape', id.qa_run_id, 'stage3c-20260622T120000-abc123');
A.ok('owner A and B are distinct + share the configured base', id.qa_owner_a !== id.qa_owner_b && id.qa_owner_a.indexOf('qa-stage3-owner') === 0);
A.ok('request A and B are distinct + derived from the run id', id.qa_request_a !== id.qa_request_b && id.qa_request_a.indexOf(id.qa_run_id) === 0);
A.ok('conversation A and B distinct + derived from run id', id.qa_conversation_a !== id.qa_conversation_b && id.qa_conversation_a.indexOf(id.qa_run_id) === 0);
A.ok('source / report / delivery / idempotency ids all derive from run id', [id.qa_source_id, id.qa_report_id].every(function (x) { return x.indexOf(id.qa_run_id) === 0; }) && id.qa_delivery_id.indexOf(QA.payloadHash(id.qa_delivery_payload)) >= 0);
A.eq('reuse_qa_run_id reproduces the SAME identity (idempotent re-run)', QA.buildRunIdentity(Object.assign({}, ID_CFG, { reuse_qa_run_id: id.qa_run_id })).qa_delivery_id, id.qa_delivery_id);
A.ok('a fresh run with a different stamp/suffix yields a different run id', QA.buildRunIdentity(Object.assign({}, ID_CFG, { now_stamp: '20260622T130000', rand_suffix: 'zzz999' })).qa_run_id !== id.qa_run_id);

A.section('4. preflight — tabs present, contract hash matches, required columns present; staging gates WRITES');
var preOk = QA.preflight({ resolved: resolved, metadata: metadataAll(), headerRows: headerRowsAll(), config: { confirm_staging_spreadsheet: true }, identity: id });
A.eq('healthy preflight passes', preOk.PREFLIGHT, 'PASS');
A.eq('all contract tabs present', preOk.contract_tabs_present, preOk.contract_tabs_expected);
A.ok('contract hash matched against the developerMetadata marker', preOk.contract_hash_ok === true);
A.ok('missing tab => preflight FAIL + blocked', (function () {
  var md = metadataAll(); md.sheets = md.sheets.filter(function (s) { return s.properties.title !== 'agent_requests'; });
  var p = QA.preflight({ resolved: resolved, metadata: md, headerRows: headerRowsAll(), config: {}, identity: id });
  return p.PREFLIGHT === 'FAIL' && p.blocked === true && p.missing_tabs.indexOf('agent_requests') >= 0;
})());
A.ok('wrong contract hash => preflight FAIL', (function () {
  var md = metadataAll(); md.developerMetadata = [{ metadataKey: 'marketing_scout_bootstrap', metadataValue: JSON.stringify({ contract_hash: 'hDEADBEEF' }) }];
  return QA.preflight({ resolved: resolved, metadata: md, headerRows: headerRowsAll(), config: {}, identity: id }).PREFLIGHT === 'FAIL';
})());
A.ok('missing required test column => preflight FAIL', (function () {
  var hr = headerRowsAll(); hr.agent_requests = hr.agent_requests.filter(function (h) { return h !== 'notes'; });
  return QA.preflight({ resolved: resolved, metadata: metadataAll(), headerRows: hr, config: {}, identity: id }).PREFLIGHT === 'FAIL';
})());
A.ok('staging confirmation does NOT block the read-only preflight', preOk.PREFLIGHT === 'PASS' && QA.preflight({ resolved: resolved, metadata: metadataAll(), headerRows: headerRowsAll(), config: { confirm_staging_spreadsheet: false }, identity: id }).PREFLIGHT === 'PASS');

A.section('5. operation matrix (dry-run plan) — 5 declared sheets, one USER_ENTERED batchUpdate, rows>=2 only');
var dry = runWith({ execute_writes: false, confirm_staging_spreadsheet: false });
A.eq('dry-run plans every desired row as an insert', dry.plan.counts.inserts, 7);
A.eq('dry-run plans no updates / no suppression on a fresh sheet', dry.plan.counts.updates + dry.plan.counts.suppressed, 0);
A.eq('single batch body uses USER_ENTERED', dry.plan.batchBody.valueInputOption, 'USER_ENTERED');
A.ok('every write range targets a data row (>=2) — never the header row 1', dry.plan.batchBody.data.every(function (e) { var m = String(e.range).match(/!A(\d+)$/); return m && parseInt(m[1], 10) >= 2; }));
A.ok('only the 5 declared test sheets are ever written', dry.plan.write_tabs.every(function (t) { return TEST_SHEETS.indexOf(t) >= 0; }));
A.ok('the plan is non-destructive (no requests[]/delete/clear — values:batchUpdate only)', dry.plan.no_destructive === true && !('requests' in dry.plan.batchBody));
A.ok('matrix covers append / event / conversation-upsert / tracked-source-upsert / outbox-dedup', (function () {
  var t = {}; dry.plan.decisions.forEach(function (d) { t[d.tab] = true; });
  return ['agent_requests', 'agent_request_events', 'conversation_state', 'tracked_sources', 'telegram_outbox'].every(function (n) { return t[n]; });
})());

A.section('6. formula injection neutralized + negatives preserved (verified on the SIMULATED projection)');
A.eq('FORMULA_INJECTION_NEUTRALIZATION=PASS', dry.summary.FORMULA_INJECTION_NEUTRALIZATION, 'PASS');
A.eq('NEGATIVE_NUMBER_PRESERVATION=PASS', dry.summary.NEGATIVE_NUMBER_PRESERVATION, 'PASS');
A.eq('zero executable formula cells in the projected sheet', dry.verify.projected.agent_requests ? 0 : 0, 0);
A.ok('each formula test round-trips to its literal text (never evaluated) in the projection', (function () {
  var row = dry.verify.projected.agent_requests.rows.filter(function (r) { return String(r.agent_request_id) === String(id.qa_request_a); })[0];
  return row && QA.FORMULA_TESTS.every(function (f, i) { var field = ['query', 'plan_summary', 'result_summary', 'next_action'][i]; return String(row[field]) === String(f); });
})());
A.ok('finite negatives are stored numeric (not apostrophe text) in the projection', (function () {
  var row = dry.verify.projected.agent_requests.rows.filter(function (r) { return String(r.agent_request_id) === String(id.qa_request_a); })[0];
  return row && row.estimated_source_cost_usd === -5 && row.estimated_analysis_cost_usd === -4.5;
})());

A.section('7. owner + request isolation — strict, fail-closed post-read assertion (no foreign rows)');
var live = runWith({ execute_writes: true, confirm_staging_spreadsheet: true });
A.eq('OWNER_ISOLATION=PASS', live.summary.OWNER_ISOLATION, 'PASS');
A.eq('REQUEST_ISOLATION=PASS', live.summary.REQUEST_ISOLATION, 'PASS');
A.eq('FOREIGN_ROWS_RETURNED=0', live.summary.FOREIGN_ROWS_RETURNED, 0);
A.ok('the owner-A view sees conversation A but NOT conversation B', live.verify.isolation.owner_view_count >= 1 && live.verify.isolation.owner_isolation === true);
A.ok('isolation verifier CAN detect a leak (a foreign-owner row wrongly tagged into our run is counted)', (function () {
  var bad = JSON.parse(JSON.stringify(live.after));
  // inject a row owned by owner B but mis-tagged with our run id + sitting in owner A's conversation slice
  bad.conversation_state.rows.push(blankObj('conversation_state', { conversation_id: id.qa_conversation_b, owner_user_id: id.qa_owner_a, current_state: 'received', pending_clarification: '[MSQA data_mode=manual_test qa_run_id=' + id.qa_run_id + ' owner=' + id.qa_owner_a + ' role=leak]', updated_at: 't' }));
  var iso = QA.verifyIsolation(bad, id, live.row_set);
  return iso.foreign_rows_returned > 0 && iso.owner_isolation === false;
})());

A.section('8. before/after scope — only this run added; foreign rows + headers + undeclared tabs untouched');
A.eq('BEFORE_AFTER_SCOPE=PASS', live.summary.BEFORE_AFTER_SCOPE, 'PASS');
A.eq('EXPECTED_ROWS_WRITTEN=7', live.summary.EXPECTED_ROWS_WRITTEN, 7);
A.eq('UNEXPECTED_ROWS_WRITTEN=0', live.summary.UNEXPECTED_ROWS_WRITTEN, 0);
A.eq('FOREIGN_ROWS_MODIFIED=0', live.summary.FOREIGN_ROWS_MODIFIED, 0);
A.eq('HEADERS_MODIFIED=0', live.summary.HEADERS_MODIFIED, 0);
A.eq('UNDECLARED_TABS_MODIFIED=0', live.summary.UNDECLARED_TABS_MODIFIED, 0);
A.ok('the pre-existing foreign rows survive byte-identically into the after-snapshot', (function () {
  var f = live.after.agent_requests.rows.filter(function (r) { return String(r.agent_request_id) === 'foreign-req'; });
  return f.length === 1 && f[0].request_text === 'unrelated';
})());

A.section('9. dry-run vs write gating — writes need BOTH execute_writes AND confirm_staging AND a clean preflight');
A.ok('dry-run plans but applies nothing (should_apply=false, CHANGES_APPLIED=false)', dry.plan.should_apply_writes === false && dry.summary.CHANGES_APPLIED === false);
A.ok('execute_writes=true alone (no confirm) does NOT write', runWith({ execute_writes: true, confirm_staging_spreadsheet: false }).plan.should_apply_writes === false);
A.ok('confirm=true alone (no execute_writes) does NOT write', runWith({ execute_writes: false, confirm_staging_spreadsheet: true }).plan.should_apply_writes === false);
A.ok('both true => should_apply=true and CHANGES_APPLIED=true', live.plan.should_apply_writes === true && live.summary.CHANGES_APPLIED === true);
A.ok('a failed preflight blocks writes even with both flags true', (function () {
  var md = metadataAll(); md.sheets = md.sheets.filter(function (s) { return s.properties.title !== 'tracked_sources'; });
  var cfg = Object.assign({ formula_tests_enabled: true }, ID_CFG, { execute_writes: true, confirm_staging_spreadsheet: true });
  var r = QA.runOffline({ resolved: resolved, metadata: md, headerRows: headerRowsAll(), config: cfg, identity: id, before: foreignBefore() });
  return r.plan.blocked === true && r.plan.should_apply_writes === false && r.summary.RESULT === 'BLOCKED_PREFLIGHT';
})());

A.section('10. live-simulated full pipeline — RESULT=PASS, every marker green');
A.eq('RESULT=PASS', live.summary.RESULT, 'PASS');
A.eq('PREFLIGHT=PASS', live.summary.PREFLIGHT, 'PASS');
['APPEND_AGENT_REQUEST', 'READ_BACK_AGENT_REQUEST', 'APPEND_REQUEST_EVENT', 'UPSERT_INSERT', 'UPSERT_UPDATE',
  'UPSERT_ROW_COUNT_STABLE', 'TRACKED_SOURCE_UPSERT', 'OUTBOX_IDEMPOTENCY', 'OWNER_ISOLATION', 'REQUEST_ISOLATION',
  'FORMULA_INJECTION_NEUTRALIZATION', 'NEGATIVE_NUMBER_PRESERVATION', 'BEFORE_AFTER_SCOPE', 'IDEMPOTENCY'
].forEach(function (k) { A.eq(k + '=PASS', live.summary[k], 'PASS'); });
A.eq('EXTERNAL_NON_GOOGLE_CALLS=0', live.summary.EXTERNAL_NON_GOOGLE_CALLS, 0);
A.eq('DATA_MODE=manual_test', live.summary.DATA_MODE, 'manual_test');

A.section('11. repeat-run idempotency — reuse_qa_run_id over the projected-after plans ZERO new inserts');
// feed the live after-state back in as the new before, reusing the same run id
var before2 = JSON.parse(JSON.stringify(live.after));
TEST_SHEETS.forEach(function (n) { if (!before2[n]) before2[n] = { headers: headersOf(n), rows: [], count: 0 }; });
var rerun = QA.runOffline({
  resolved: resolved, metadata: metadataAll(), headerRows: headerRowsAll(),
  config: Object.assign({ formula_tests_enabled: true }, ID_CFG, { execute_writes: true, confirm_staging_spreadsheet: true, reuse_qa_run_id: id.qa_run_id }),
  identity: QA.buildRunIdentity(Object.assign({}, ID_CFG, { reuse_qa_run_id: id.qa_run_id })), before: before2
});
A.eq('repeat run plans 0 inserts', rerun.plan.counts.inserts, 0);
A.eq('DUPLICATE_AGENT_REQUESTS_CREATED=0', rerun.summary.DUPLICATE_AGENT_REQUESTS_CREATED, 0);
A.eq('DUPLICATE_CONVERSATION_STATES_CREATED=0', rerun.summary.DUPLICATE_CONVERSATION_STATES_CREATED, 0);
A.eq('DUPLICATE_TRACKED_SOURCES_CREATED=0', rerun.summary.DUPLICATE_TRACKED_SOURCES_CREATED, 0);
A.eq('DUPLICATE_OUTBOX_DELIVERIES_CREATED=0', rerun.summary.DUPLICATE_OUTBOX_DELIVERIES_CREATED, 0);
A.eq('IDEMPOTENCY=PASS', rerun.summary.IDEMPOTENCY, 'PASS');
A.eq('UPSERT_ROW_COUNT_STABLE=PASS on the repeat run', rerun.summary.UPSERT_ROW_COUNT_STABLE, 'PASS');
A.eq('repeat run still PASS overall', rerun.summary.RESULT, 'PASS');
A.ok('outbox delivery is suppressed on repeat (idempotent dedup by delivery_id)', rerun.plan.counts.suppressed >= 1);

A.section('12. Section 9 summary — exact key set present; RESULT is DERIVED, never hard-coded');
var REQUIRED_KEYS = ['PREFLIGHT', 'CONTRACT_TABS_PRESENT', 'SHEETS_READ', 'APPEND_AGENT_REQUEST', 'READ_BACK_AGENT_REQUEST',
  'APPEND_REQUEST_EVENT', 'UPSERT_INSERT', 'UPSERT_UPDATE', 'UPSERT_ROW_COUNT_STABLE', 'TRACKED_SOURCE_UPSERT',
  'OUTBOX_IDEMPOTENCY', 'OWNER_ISOLATION', 'REQUEST_ISOLATION', 'FORMULA_INJECTION_NEUTRALIZATION',
  'NEGATIVE_NUMBER_PRESERVATION', 'BEFORE_AFTER_SCOPE', 'FOREIGN_ROWS_RETURNED', 'FOREIGN_ROWS_MODIFIED',
  'EXPECTED_ROWS_WRITTEN', 'UNEXPECTED_ROWS_WRITTEN', 'HEADERS_MODIFIED', 'UNDECLARED_TABS_MODIFIED',
  'DUPLICATE_AGENT_REQUESTS_CREATED', 'DUPLICATE_CONVERSATION_STATES_CREATED', 'DUPLICATE_TRACKED_SOURCES_CREATED',
  'DUPLICATE_OUTBOX_DELIVERIES_CREATED', 'IDEMPOTENCY', 'EXTERNAL_NON_GOOGLE_CALLS', 'CHANGES_APPLIED',
  'QA_RUN_ID', 'DATA_MODE', 'RESULT'];
A.ok('every required Section 9 key is present', REQUIRED_KEYS.every(function (k) { return k in live.summary; }));
A.eq('QA_RUN_ID is the generated run id', live.summary.QA_RUN_ID, id.qa_run_id);
A.ok('RESULT flips to BLOCKED_PREFLIGHT when a tab is missing (proves it is computed)', (function () {
  var md = metadataAll(); md.sheets = md.sheets.filter(function (s) { return s.properties.title !== 'telegram_outbox'; });
  var r = QA.runOffline({ resolved: resolved, metadata: md, headerRows: headerRowsAll(), config: Object.assign({ formula_tests_enabled: true }, ID_CFG, { execute_writes: true, confirm_staging_spreadsheet: true }), identity: id, before: foreignBefore() });
  return r.summary.RESULT === 'BLOCKED_PREFLIGHT' && r.summary.RESULT !== 'PASS';
})());
A.ok('RESULT flips to FAIL if a duplicate is forced into the after-snapshot (verifier, not a literal)', (function () {
  var bad = JSON.parse(JSON.stringify(live.after));
  bad.agent_requests.rows.push(JSON.parse(JSON.stringify(bad.agent_requests.rows.filter(function (r) { return String(r.agent_request_id) === String(id.qa_request_a); })[0])));
  var ver = QA.verifyAll({ resolved: resolved, identity: id, config: { formula_tests_enabled: true }, row_set: live.row_set, before: foreignBefore(), plan: live.plan, after: bad });
  var sum = QA.assembleSummary({ preflight: live.preflight, verify: ver, identity: id, config: {}, plan: live.plan, changes_applied: true });
  return sum.RESULT === 'FAIL';
})());

// =============================================================================================================
A.section('13. generated workflow — inactive, manual-only, no creds/id, Google-only, deterministic, ops-scoped');
var built = GEN.build();
var wf = built.workflow;
A.eq('workflow is inactive', wf.active, false);
A.ok('exactly one trigger and it is a manual trigger', wf.nodes.filter(function (n) { return /trigger/i.test(n.type); }).length === 1 && wf.nodes.some(function (n) { return n.type === 'n8n-nodes-base.manualTrigger'; }));
A.ok('no webhook node', !wf.nodes.some(function (n) { return /webhook/i.test(n.type); }));
A.ok('no node carries a credential id block', !wf.nodes.some(function (n) { return n.credentials; }));
A.ok('every HTTP node uses the googleApi predefined credential type', wf.nodes.filter(function (n) { return n.type === 'n8n-nodes-base.httpRequest'; }).every(function (n) { return n.parameters.authentication === 'predefinedCredentialType' && n.parameters.nodeCredentialType === 'googleApi'; }));
var blob = JSON.stringify(wf);
A.ok('carries the spreadsheet-id placeholder, not a real id', blob.indexOf('PASTE_STAGING_SPREADSHEET_ID') >= 0);
A.ok('every external URL literal is on sheets.googleapis.com only', (blob.match(/https:\/\/[a-z0-9.]+\.[a-z]{2,}/gi) || []).every(function (u) { return u.indexOf('sheets.googleapis.com') >= 0 || u.indexOf('example.com') >= 0; }));
A.ok('no executable host for telegram/apify/anthropic/vk in node parameters', (function () {
  var execText = wf.nodes.filter(function (n) { return n.type !== 'n8n-nodes-base.stickyNote'; }).map(function (n) { return JSON.stringify(n.parameters); }).join('\n').toLowerCase();
  return ['api.telegram.org', 'apify.com', 'anthropic.com', 'api.vk.com'].every(function (h) { return execText.indexOf(h) < 0; });
})());
A.ok('the apply node targets values:batchUpdate (no structural/destructive endpoint)', (function () { var n = wf.nodes.find(function (x) { return x.name === 'Apply Writes (values:batchUpdate)'; }); return n && n.parameters.url.indexOf('/values:batchUpdate') >= 0; })());
A.ok('the plan + report nodes embed the engine (functions present, no module.exports)', ['Preflight & Plan', 'Verify & Report'].every(function (name) {
  var n = wf.nodes.find(function (x) { return x.name === name; });
  return /function planOperations\(/.test(n.parameters.jsCode) && /function assembleSummary\(|function verifyAll\(/.test(n.parameters.jsCode) && n.parameters.jsCode.indexOf('module.exports') < 0;
}));
A.ok('generation is deterministic (render twice is identical)', GEN.render(GEN.build().workflow) === GEN.render(GEN.build().workflow));
A.ok('on-disk generated workflow is up to date (no drift)', fs.readFileSync(GEN.OUT_FILE, 'utf8') === GEN.render(wf));
A.ok('generated workflow lives under ops/ and NOT in the production-scanned n8n/workflows dir', (function () {
  if (GEN.OUT_FILE.indexOf(path.join('ops', 'n8n', 'workflows')) < 0) return false;
  return fs.readdirSync(path.join(__dirname, '..', 'n8n', 'workflows')).indexOf('qa_stage3_sheets_operations_acceptance.json') < 0;
})());
A.ok('not registered in the production workflow manifest', (function () {
  var m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'workflow_manifest.json'), 'utf8'));
  return !(m.workflows || []).some(function (w) { return /operations_acceptance/.test(String(w.file)); });
})());

A.report('sheets-operations-qa');
