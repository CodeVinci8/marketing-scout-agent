'use strict';
// test_sheets_operations_qa.js — offline regression for the Stage 3C Google Sheets OPERATIONS acceptance harness.
// Covers Section 10 of the spec end-to-end with NO Google access ($0, no network): reuse-equivalence with the
// canonical libs, contract-clean plan, run identity, preflight, the full operation matrix, formula-injection +
// negative-number handling, owner/request isolation, before/after scope, dry-run + write gating, live-simulated
// apply, repeat-run idempotency, the Section 9 machine-readable summary, and the generated workflow.
//
// It ALSO reproduces and locks the live "exceeds grid limits" defect (agent_requests!A1001): write rows are now
// derived from PHYSICAL occupied rows in the actual before-snapshot (occupancy keyed on identity columns, so
// preallocated checkbox-default cells / trailing empties never count), grid rowCount is a capacity limit only,
// and a bounded per-sheet expansion handles the capacity boundary. Dry-run markers are truthful (live-operation
// markers are NOT_EXECUTED_DRY_RUN until a real write + after-snapshot read-back verifies them).
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
const PLAN_META = QA.sheetPlanMeta();
const IDENTITY = {}; TEST_SHEETS.forEach(function (n) { IDENTITY[n] = PLAN_META[n].identity_cols; });

// ---- shared offline harness: build PHYSICAL-row-aware API inputs the engine consumes, all in-memory ----------
function headersOf(name) { return QA.contractSheet(resolved, name).headers.slice(); }
function metadataAll(gridMap, extra) {
  gridMap = gridMap || {};
  var sheets = resolved.sheets.map(function (s, i) {
    return { properties: { sheetId: 100 + i, title: s.sheet_name, gridProperties: { rowCount: gridMap[s.sheet_name] || 1000, columnCount: 30 } } };
  });
  if (extra) extra.forEach(function (t) { sheets.push({ properties: { sheetId: 900, title: t, gridProperties: { rowCount: 1000, columnCount: 30 } } }); });
  return { sheets: sheets, developerMetadata: [{ metadataKey: 'marketing_scout_bootstrap', metadataValue: JSON.stringify({ contract_hash: resolved.contract_hash }) }] };
}
function headerRowsAll() { var h = {}; TEST_SHEETS.forEach(function (n) { h[n] = headersOf(n); }); return h; }
function sheetIdsAll() { var s = {}; resolved.sheets.forEach(function (sh, i) { if (TEST_SHEETS.indexOf(sh.sheet_name) >= 0) s[sh.sheet_name] = 100 + i; }); return s; }
function gridMapAll(cap) { var g = {}; TEST_SHEETS.forEach(function (n) { g[n] = cap || 1000; }); return g; }

// Build the `values` grid for one sheet: header row 1, optional preallocated rows up to fillTo (with a stray
// value at column falseAt to mimic a bootstrap checkbox default), and explicit data rows at given physical rows.
function sheetValues(name, dataByRow, opts) {
  opts = opts || {}; var hdr = headersOf(name); var grid = [hdr.slice()];
  var fillTo = opts.fillTo || 1;
  for (var r = 2; r <= fillTo; r++) { var pre = new Array(hdr.length).fill(''); if (opts.falseAt != null) pre[opts.falseAt] = 'FALSE'; grid.push(pre); }
  Object.keys(dataByRow || {}).forEach(function (rs) {
    var rn = parseInt(rs, 10); while (grid.length < rn) grid.push(opts.falseAt != null ? (function () { var x = new Array(hdr.length).fill(''); x[opts.falseAt] = 'FALSE'; return x; })() : new Array(hdr.length).fill(''));
    var row = new Array(hdr.length).fill(''); var vals = dataByRow[rs];
    Object.keys(vals).forEach(function (k) { var ci = hdr.indexOf(k); if (ci >= 0) row[ci] = vals[k]; });
    grid[rn - 1] = row;
  });
  return grid;
}
// spec: { tab: { data:{ rowNum: {col:val} }, fillTo, falseAt, cap } } ; returns a values:batchGet response shape.
function gResponse(spec) {
  spec = spec || {}; var vr = [];
  TEST_SHEETS.forEach(function (n) { var s = spec[n] || {}; vr.push({ range: "'" + n + "'!A1:AC", values: sheetValues(n, s.data || {}, s) }); });
  return { valueRanges: vr };
}
function buildBefore(spec, cap) { return QA.parseSnapshot(gResponse(spec), { identity: IDENTITY, grid_row_counts: gridMapAll(cap) }); }
// default before-snapshot carrying one FOREIGN row (other owner/request) at physical row 2 on the scoped sheets.
function foreignSpec() {
  return {
    agent_requests: { data: { 2: { agent_request_id: 'foreign-req', user_id: 'someone-else', request_text: 'unrelated', created_at: 'x', state: 'received', status: 'new', request_type: 'manual_intake', source_scope: 'unknown', plan_source: 'deterministic', notes: 'not a qa row' } } },
    conversation_state: { data: { 2: { conversation_id: 'foreign-conv', owner_user_id: 'someone-else', current_state: 'received', updated_at: 'x' } } }
  };
}
var ID_CFG = { now_stamp: '20260622T120000', rand_suffix: 'abc123', qa_owner_id: 'qa-stage3-owner', now: '2026-06-22T12:00:00.000Z', now2: '2026-06-22T12:05:00.000Z' };
function runWith(cfgOverride, spec, cap) {
  var cfg = Object.assign({ qa_owner_id: 'qa-stage3-owner', formula_tests_enabled: true }, ID_CFG, cfgOverride || {});
  var id = QA.buildRunIdentity(cfg);
  return QA.runOffline({ resolved: resolved, metadata: metadataAll(gridMapAll(cap)), headerRows: headerRowsAll(), config: cfg, identity: id, before: buildBefore(spec || foreignSpec(), cap), sheet_ids: sheetIdsAll() });
}
// Mimic how Google returns the AFTER snapshot via values:batchGet (FORMATTED_VALUE): the bootstrap NUMBER format
// #,##0.00#### makes the *_usd columns read back as "-5.00"/"-4.50", booleans read back "TRUE"/"FALSE". This is the
// exact normalization that produced the live QA-018 read-back failure.
function normalizeGoogle(after) {
  var a = JSON.parse(JSON.stringify(after));
  (a.agent_requests ? a.agent_requests.rows : []).forEach(function (r) {
    ['estimated_source_cost_usd', 'estimated_analysis_cost_usd'].forEach(function (c) {
      if (r[c] !== '' && r[c] != null && isFinite(Number(r[c]))) r[c] = Number(r[c]).toFixed(2);
    });
    if (r.approval_required === false || r.approval_required === 'false') r.approval_required = 'FALSE';
    if (r.approval_required === true || r.approval_required === 'true') r.approval_required = 'TRUE';
  });
  return a;
}
// the pre-fix byte/loose comparator, kept ONLY to PROVE the regressions reproduce the live failure.
function oldFieldsEqual(written, readBack) {
  return Object.keys(written).every(function (k) {
    var w = written[k]; var r = (readBack || {})[k];
    if (typeof w === 'boolean') return String(r).toLowerCase() === String(w) || String(r) === String(w);
    if (QA.isFiniteNumber(w)) return String(r) === String(Number(w));
    return String(r == null ? '' : r) === String(w == null ? '' : w);
  });
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
  ar.headers = ar.headers.filter(function (h) { return h !== 'notes'; });
  return QA.validatePlanAgainstContract(clone).ok === false;
})());

A.section('3. run identity — deterministic, every id traceable to qa_run_id, owner/request A!=B');
var id = QA.buildRunIdentity(ID_CFG);
A.eq('qa_run_id has the stage3c-<stamp>-<suffix> shape', id.qa_run_id, 'stage3c-20260622T120000-abc123');
A.ok('owner A and B are distinct + share the configured base', id.qa_owner_a !== id.qa_owner_b && id.qa_owner_a.indexOf('qa-stage3-owner') === 0);
A.ok('request A and B are distinct + derived from the run id', id.qa_request_a !== id.qa_request_b && id.qa_request_a.indexOf(id.qa_run_id) === 0);
A.ok('conversation A and B distinct + derived from run id', id.qa_conversation_a !== id.qa_conversation_b && id.qa_conversation_a.indexOf(id.qa_run_id) === 0);
A.ok('source / report / delivery ids all derive from run id', [id.qa_source_id, id.qa_report_id].every(function (x) { return x.indexOf(id.qa_run_id) === 0; }) && id.qa_delivery_id.indexOf(QA.payloadHash(id.qa_delivery_payload)) >= 0);
A.eq('reuse_qa_run_id reproduces the SAME identity (idempotent re-run)', QA.buildRunIdentity(Object.assign({}, ID_CFG, { reuse_qa_run_id: id.qa_run_id })).qa_delivery_id, id.qa_delivery_id);

A.section('4. preflight — tabs present, contract hash matches, required columns present; staging gates WRITES');
var preOk = QA.preflight({ resolved: resolved, metadata: metadataAll(), headerRows: headerRowsAll(), config: { confirm_staging_spreadsheet: true }, identity: id });
A.eq('healthy preflight passes', preOk.PREFLIGHT, 'PASS');
A.eq('all contract tabs present', preOk.contract_tabs_present, preOk.contract_tabs_expected);
A.ok('missing tab => preflight FAIL + blocked', (function () {
  var md = metadataAll(); md.sheets = md.sheets.filter(function (s) { return s.properties.title !== 'agent_requests'; });
  var p = QA.preflight({ resolved: resolved, metadata: md, headerRows: headerRowsAll(), config: {}, identity: id });
  return p.PREFLIGHT === 'FAIL' && p.blocked === true;
})());
A.ok('wrong contract hash => preflight FAIL', (function () {
  var md = metadataAll(); md.developerMetadata = [{ metadataKey: 'marketing_scout_bootstrap', metadataValue: JSON.stringify({ contract_hash: 'hDEADBEEF' }) }];
  return QA.preflight({ resolved: resolved, metadata: md, headerRows: headerRowsAll(), config: {}, identity: id }).PREFLIGHT === 'FAIL';
})());
A.ok('missing required test column => preflight FAIL', (function () {
  var hr = headerRowsAll(); hr.agent_requests = hr.agent_requests.filter(function (h) { return h !== 'notes'; });
  return QA.preflight({ resolved: resolved, metadata: metadataAll(), headerRows: hr, config: {}, identity: id }).PREFLIGHT === 'FAIL';
})());

// =============================================================================================================
// PHYSICAL ROW ALLOCATION — the live "A1001 exceeds grid limits" defect and its required behaviors (fixes 1-4).
// =============================================================================================================
A.section('5. REGRESSION — header-only sheet with preallocated grid (999 checkbox-default FALSE rows)');
// Reproduce the exact live state: agent_requests has ONLY a real header but 999 preallocated rows each carrying a
// stray FALSE (a bootstrap checkbox default) down to grid capacity 1000. Occupancy must ignore those cells.
var approvalIdx = headersOf('agent_requests').indexOf('approval_required');
var preallocSpec = { agent_requests: { fillTo: 1000, falseAt: approvalIdx, cap: 1000 } };
var preallocBefore = buildBefore(preallocSpec, 1000);
A.eq('occupied count is 0 (preallocated FALSE cells are NOT data)', preallocBefore.agent_requests.count, 0);
A.eq('last_occupied_row is 1 (header only)', preallocBefore.agent_requests.last_occupied_row, 1);
A.eq('next_free_row is 2', preallocBefore.agent_requests.next_free_row, 2);
var preallocPlan = QA.planOperations({ resolved: resolved, identity: id, config: { execute_writes: true, confirm_staging_spreadsheet: true }, before: preallocBefore, sheet_ids: sheetIdsAll() });
var arRanges = preallocPlan.batchBody.data.map(function (d) { return d.range; }).filter(function (r) { return /agent_requests/.test(r); });
A.ok('first agent_requests append targets A2', arRanges.indexOf("'agent_requests'!A2") >= 0);
A.ok('NO write range is A1001 (the live failure is gone)', !arRanges.some(function (r) { return /A1001\b/.test(r); }));
A.ok('no write range exceeds the 1000-row grid', arRanges.every(function (r) { var m = r.match(/!A(\d+)$/); return m && parseInt(m[1], 10) <= 1000; }));

A.section('6. REGRESSION — partially occupied sheet (rows 1..7 occupied) => next data row 8');
var partialData = {}; for (var rr = 2; rr <= 7; rr++) partialData[rr] = { agent_request_id: 'existing-' + rr };
var partialBefore = buildBefore({ agent_requests: { data: partialData, cap: 1000 } }, 1000);
A.eq('last_occupied_row = 7', partialBefore.agent_requests.last_occupied_row, 7);
A.eq('next_free_row = 8', partialBefore.agent_requests.next_free_row, 8);
var partialPlan = QA.planOperations({ resolved: resolved, identity: id, config: { execute_writes: true, confirm_staging_spreadsheet: true }, before: partialBefore, sheet_ids: sheetIdsAll() });
A.ok('first agent_requests append targets A8', partialPlan.batchBody.data.some(function (d) { return d.range === "'agent_requests'!A8"; }));

A.section('7. REGRESSION — trailing empty rows do not move the append location');
var trailingResp = gResponse({ agent_requests: { data: { 2: { agent_request_id: 'a' }, 3: { agent_request_id: 'b' }, 4: { agent_request_id: 'c' } }, cap: 1000 } });
while (trailingResp.valueRanges[0].values.length < 900) trailingResp.valueRanges[0].values.push([]);   // 896 trailing empties
var trailingBefore = QA.parseSnapshot(trailingResp, { identity: IDENTITY, grid_row_counts: gridMapAll(1000) });
A.eq('last_occupied_row = 4 (trailing empties ignored)', trailingBefore.agent_requests.last_occupied_row, 4);
A.eq('next_free_row = 5', trailingBefore.agent_requests.next_free_row, 5);

A.section('8. REGRESSION — sparse physical rows: an existing key on a known row is updated on THAT exact row');
var sparseBefore = buildBefore({ agent_requests: { data: { 6: { agent_request_id: id.qa_request_a, notes: '[MSQA data_mode=manual_test qa_run_id=' + id.qa_run_id + ' owner=' + id.qa_owner_a + ' role=request_a]' } }, cap: 1000 } }, 1000);
var sparsePlan = QA.planOperations({ resolved: resolved, identity: id, config: { execute_writes: true, confirm_staging_spreadsheet: true }, before: sparseBefore, sheet_ids: sheetIdsAll() });
var reqADecision = sparsePlan.decisions.filter(function (d) { return d.tab === 'agent_requests' && d.role === 'request_a'; })[0];
A.eq('request A is an UPDATE (existing key)', reqADecision.decision, 'update');
A.eq('request A is updated at its exact physical row 6', reqADecision.row, 6);
A.ok('the update range is A6 (not a compressed index)', sparsePlan.batchBody.data.some(function (d) { return d.range === "'agent_requests'!A6"; }));

A.section('9. REGRESSION — existing-key upsert creates NO duplicate row');
A.eq('no insert was planned for request A (it matched an existing row)', sparsePlan.decisions.filter(function (d) { return d.tab === 'agent_requests' && d.role === 'request_a' && d.decision === 'insert'; }).length, 0);
A.eq('request B (new key) IS an insert at the next free row', (function () { var d = sparsePlan.decisions.filter(function (x) { return x.tab === 'agent_requests' && x.role === 'request_b'; })[0]; return d.decision; })(), 'insert');

A.section('10. REGRESSION — capacity boundary: occupied == capacity => bounded expansion BEFORE the write');
var capData = {}; for (var cr = 2; cr <= 10; cr++) capData[cr] = { agent_request_id: 'x' + cr };
var capBefore = buildBefore({ agent_requests: { data: capData, cap: 10 } }, 10);
A.eq('next_free_row = 11 (one past the 10-row grid)', capBefore.agent_requests.next_free_row, 11);
var capPlan = QA.planOperations({ resolved: resolved, identity: id, config: { execute_writes: true, confirm_staging_spreadsheet: true }, before: capBefore, sheet_ids: sheetIdsAll() });
A.ok('needs_expansion is true', capPlan.needs_expansion === true);
A.ok('expansion grows ONLY agent_requests (not all sheets)', Object.keys(capPlan.expanded_tabs).length === 1 && !!capPlan.expanded_tabs.agent_requests);
A.ok('expansion is a structural updateSheetProperties growing gridProperties.rowCount', (function () {
  var reqs = capPlan.expansion_body.requests; return reqs.length === 1 && reqs[0].updateSheetProperties && reqs[0].updateSheetProperties.fields === 'gridProperties.rowCount' && reqs[0].updateSheetProperties.properties.gridProperties.rowCount >= 11;
})());
A.ok('expansion only GROWS capacity (never shrinks)', capPlan.expanded_tabs.agent_requests.to > capPlan.expanded_tabs.agent_requests.from);
A.ok('no destructive request in the expansion body', (function () { var r = capPlan.expansion_body.requests[0]; return !('deleteSheet' in r) && !('deleteRange' in r) && !('deleteDimension' in r); })());
A.ok('a header-only sheet at the default 1000 grid needs NO expansion', preallocPlan.needs_expansion === false);

A.section('11. operation matrix (dry-run plan) — 5 declared sheets, one USER_ENTERED batchUpdate, rows>=2 only');
var dry = runWith({ execute_writes: false, confirm_staging_spreadsheet: false });
A.eq('dry-run plans every desired row as an insert', dry.plan.counts.inserts, 7);
A.eq('single batch body uses USER_ENTERED', dry.plan.batchBody.valueInputOption, 'USER_ENTERED');
A.ok('every write range targets a data row (>=2) — never the header row 1', dry.plan.batchBody.data.every(function (e) { var m = String(e.range).match(/!A(\d+)$/); return m && parseInt(m[1], 10) >= 2; }));
A.ok('QA inserts do not collide with the foreign row at physical row 2', dry.plan.batchBody.data.every(function (e) { return e.range !== "'agent_requests'!A2"; }));
A.ok('only the 5 declared test sheets are ever written', dry.plan.write_tabs.every(function (t) { return TEST_SHEETS.indexOf(t) >= 0; }));
A.ok('the plan is non-destructive (no requests[]/delete/clear in the values body)', dry.plan.no_destructive === true && !('requests' in dry.plan.batchBody));

A.section('12. dry-run truthfulness — live-operation markers are NOT_EXECUTED_DRY_RUN, never live-PASS');
A.eq('RESULT=PASS (the PLAN is valid)', dry.summary.RESULT, 'PASS');
A.eq('PREFLIGHT=PASS', dry.summary.PREFLIGHT, 'PASS');
A.eq('SHEETS_READ=PASS', dry.summary.SHEETS_READ, 'PASS');
A.eq('WRITE_PLAN=PASS', dry.summary.WRITE_PLAN, 'PASS');
A.eq('CHANGES_APPLIED=false', dry.summary.CHANGES_APPLIED, false);
A.ok('NEXT_DATA_ROWS reports physical rows (>=2)', Object.keys(dry.summary.NEXT_DATA_ROWS).length === 5 && Object.keys(dry.summary.NEXT_DATA_ROWS).every(function (k) { return dry.summary.NEXT_DATA_ROWS[k] >= 2; }));
A.ok('NO unexecuted live-operation marker is PASS in a dry-run', QA.LIVE_MARKERS.every(function (k) { return dry.summary[k] !== 'PASS'; }));
A.ok('every live-operation marker reads NOT_EXECUTED_DRY_RUN (or SKIPPED if formula tests disabled)', QA.LIVE_MARKERS.every(function (k) { return dry.summary[k] === 'NOT_EXECUTED_DRY_RUN' || dry.summary[k] === 'SKIPPED'; }));

A.section('13. dry-run with formula tests disabled — formula/negative markers are SKIPPED, others NOT_EXECUTED');
var dryNoFt = runWith({ execute_writes: false, confirm_staging_spreadsheet: false, formula_tests_enabled: false });
A.eq('FORMULA_INJECTION_NEUTRALIZATION=SKIPPED', dryNoFt.summary.FORMULA_INJECTION_NEUTRALIZATION, 'SKIPPED');
A.eq('NEGATIVE_NUMBER_PRESERVATION=SKIPPED', dryNoFt.summary.NEGATIVE_NUMBER_PRESERVATION, 'SKIPPED');
A.eq('dry-run RESULT still PASS', dryNoFt.summary.RESULT, 'PASS');

A.section('14. write gating — writes need BOTH execute_writes AND confirm_staging AND a clean preflight');
A.ok('execute_writes=true alone (no confirm) does NOT write', runWith({ execute_writes: true, confirm_staging_spreadsheet: false }).plan.should_apply_writes === false);
A.ok('confirm=true alone (no execute_writes) does NOT write', runWith({ execute_writes: false, confirm_staging_spreadsheet: true }).plan.should_apply_writes === false);
A.ok('a failed preflight blocks writes even with both flags true + marks RESULT=BLOCKED_PREFLIGHT', (function () {
  var md = metadataAll(); md.sheets = md.sheets.filter(function (s) { return s.properties.title !== 'tracked_sources'; });
  var cfg = Object.assign({ formula_tests_enabled: true }, ID_CFG, { execute_writes: true, confirm_staging_spreadsheet: true });
  var r = QA.runOffline({ resolved: resolved, metadata: md, headerRows: headerRowsAll(), config: cfg, identity: id, before: buildBefore(foreignSpec()), sheet_ids: sheetIdsAll() });
  return r.plan.blocked === true && r.plan.should_apply_writes === false && r.summary.RESULT === 'BLOCKED_PREFLIGHT';
})());
A.ok('when blocked, live-operation markers read NOT_APPLICABLE (not PASS)', (function () {
  var md = metadataAll(); md.sheets = md.sheets.filter(function (s) { return s.properties.title !== 'tracked_sources'; });
  var r = QA.runOffline({ resolved: resolved, metadata: md, headerRows: headerRowsAll(), config: Object.assign({ formula_tests_enabled: true }, ID_CFG, { execute_writes: true, confirm_staging_spreadsheet: true }), identity: id, before: buildBefore(foreignSpec()), sheet_ids: sheetIdsAll() });
  return QA.LIVE_MARKERS.every(function (k) { return r.summary[k] === 'NOT_APPLICABLE'; });
})());

A.section('15. live-result truthfulness — markers become PASS only after a real write + after-snapshot verify');
var live = runWith({ execute_writes: true, confirm_staging_spreadsheet: true });
A.eq('RESULT=PASS', live.summary.RESULT, 'PASS');
A.eq('CHANGES_APPLIED=true (mutation executed)', live.summary.CHANGES_APPLIED, true);
A.eq('ACCEPTANCE_VERIFIED=true', live.summary.ACCEPTANCE_VERIFIED, true);
['APPEND_AGENT_REQUEST', 'READ_BACK_AGENT_REQUEST', 'APPEND_REQUEST_EVENT', 'UPSERT_INSERT', 'UPSERT_UPDATE',
  'UPSERT_ROW_COUNT_STABLE', 'TRACKED_SOURCE_UPSERT', 'OUTBOX_IDEMPOTENCY', 'OWNER_ISOLATION', 'REQUEST_ISOLATION',
  'FORMULA_INJECTION_NEUTRALIZATION', 'NEGATIVE_NUMBER_PRESERVATION', 'BEFORE_AFTER_SCOPE', 'IDEMPOTENCY'
].forEach(function (k) { A.eq(k + '=PASS', live.summary[k], 'PASS'); });
A.eq('EXTERNAL_NON_GOOGLE_CALLS=0', live.summary.EXTERNAL_NON_GOOGLE_CALLS, 0);
A.eq('DATA_MODE=manual_test', live.summary.DATA_MODE, 'manual_test');

A.section('15b. mutation markers (D) — dry-run all false; write-accepted-but-verify-fail keeps CHANGES_APPLIED=true');
['WRITE_NODE_EXECUTED', 'WRITE_REQUEST_SUCCEEDED', 'MUTATIONS_EXECUTED', 'AFTER_SNAPSHOT_READ', 'ACCEPTANCE_VERIFIED', 'CHANGES_APPLIED']
  .forEach(function (k) { A.eq('dry-run ' + k + '=false', dry.summary[k], false); });
['WRITE_NODE_EXECUTED', 'WRITE_REQUEST_SUCCEEDED', 'MUTATIONS_EXECUTED', 'AFTER_SNAPSHOT_READ', 'ACCEPTANCE_VERIFIED', 'CHANGES_APPLIED']
  .forEach(function (k) { A.eq('full-acceptance ' + k + '=true', live.summary[k], true); });
A.ok('write accepted but verification fails: CHANGES_APPLIED=true, ACCEPTANCE_VERIFIED=false, RESULT=FAIL', (function () {
  // tamper the real after-snapshot to drop request A's row => READ_BACK fails AFTER a successful write
  var bad = JSON.parse(JSON.stringify(live.after));
  bad.agent_requests.rows = bad.agent_requests.rows.filter(function (r) { return String(r.agent_request_id) !== String(id.qa_request_a); });
  var ver = QA.verifyAll({ resolved: resolved, identity: id, config: { formula_tests_enabled: true }, row_set: live.row_set, before: buildBefore(foreignSpec()), plan: live.plan, after: bad, applied: true });
  var sum = QA.assembleSummary({ preflight: live.preflight, verify: ver, identity: id, config: {}, plan: live.plan, changes_applied: true });
  return sum.WRITE_NODE_EXECUTED === true && sum.WRITE_REQUEST_SUCCEEDED === true && sum.MUTATIONS_EXECUTED === true &&
    sum.AFTER_SNAPSHOT_READ === true && sum.ACCEPTANCE_VERIFIED === false && sum.CHANGES_APPLIED === true && sum.RESULT === 'FAIL';
})());
A.ok('Google write REQUEST FAILED: node ran but write rejected => no mutation, no acceptance, RESULT=FAIL', (function () {
  // the write node executed but Google rejected the values:batchUpdate (non-2xx): nothing was applied, no
  // after-snapshot was read, and the verdict must be FAIL — never a fall-back to the dry-run PASS path.
  var sum = QA.assembleSummary({
    preflight: live.preflight, verify: { markers: live.verify.markers, applied: false }, identity: id, config: {},
    plan: live.plan, write_node_executed: true, write_request_succeeded: false, after_snapshot_read: false, changes_applied: false
  });
  return sum.WRITE_NODE_EXECUTED === true && sum.WRITE_REQUEST_SUCCEEDED === false && sum.MUTATIONS_EXECUTED === false &&
    sum.ACCEPTANCE_VERIFIED === false && sum.CHANGES_APPLIED === false && sum.RESULT === 'FAIL';
})());

A.section('15c. QA-018 REGRESSION — Google-normalized read-back (-5.00/-4.50, FALSE) passes; old byte compare fails');
var liveNorm = normalizeGoogle(live.after);
var raReq = liveNorm.agent_requests.rows.filter(function (r) { return String(r.agent_request_id) === String(id.qa_request_a); })[0];
A.eq('cost reads back FORMATTED "-5.00"', String(raReq.estimated_source_cost_usd), '-5.00');
A.eq('cost reads back FORMATTED "-4.50"', String(raReq.estimated_analysis_cost_usd), '-4.50');
A.ok('OLD byte/loose comparator FAILS on the normalized row (reproduces QA-018)', oldFieldsEqual(live.row_set.sheets.agent_requests.desired[0].values, raReq) === false);
var verNorm = QA.verifyAll({ resolved: resolved, identity: id, config: { formula_tests_enabled: true }, row_set: live.row_set, before: buildBefore(foreignSpec()), plan: live.plan, after: liveNorm, applied: true, typed: live.verify.markers ? undefined : undefined });
A.eq('NEW contract-aware READ_BACK_AGENT_REQUEST=PASS on the normalized row', verNorm.markers.READ_BACK_AGENT_REQUEST, 'PASS');
A.eq('NEW NEGATIVE_NUMBER_PRESERVATION=PASS (compared numerically)', verNorm.markers.NEGATIVE_NUMBER_PRESERVATION, 'PASS');
A.eq('READ_BACK_FAILURES empty on the normalized row', verNorm.markers.READ_BACK_FAILURES.length, 0);
A.eq('BEFORE_AFTER_SCOPE=PASS despite normalization of our OWN rows (QA-019)', verNorm.markers.BEFORE_AFTER_SCOPE, 'PASS');
A.eq('BEFORE_AFTER_FAILURES empty on the normalized run', verNorm.markers.BEFORE_AFTER_FAILURES.length, 0);

A.section('15d. comparison-layer unit tests (blank / boolean / numeric / missing-trailing / timestamp / escape)');
function tinfo(sheet, col) { return QA.columnTypeInfo(resolved, sheet, col); }
A.ok('blank-equivalence: undefined/null/"" all compare equal', QA.cellEquals(undefined, '', {}) === true && QA.cellEquals(null, '', {}) === true && QA.cellEquals('', undefined, {}) === true);
A.ok('blank is NEVER equal to 0', QA.cellEquals('', 0, { numeric: true }) === false);
A.ok('blank is NEVER equal to false', QA.cellEquals('', false, { boolean: true }) === false);
A.ok('boolean: false=="FALSE", true=="TRUE" (case-insensitive)', QA.cellEquals(false, 'FALSE', { boolean: true }) && QA.cellEquals(true, 'true', { boolean: true }));
A.ok('boolean rejects arbitrary truthy strings', QA.cellEquals(true, 'yes', { boolean: true }) === false && QA.cellEquals(true, '1', { boolean: true }) === false);
A.ok('numeric: -5 == "-5.00", -4.5 == "-4.50", 1234.5 == "1,234.50"', QA.cellEquals(-5, '-5.00', { numeric: true }) && QA.cellEquals(-4.5, '-4.50', { numeric: true }) && QA.cellEquals(1234.5, '1,234.50', { numeric: true }));
A.ok('numeric never parses arbitrary free text as a number', QA.cellEquals('hello', 'hello', { numeric: true }) && QA.cellEquals(5, 'five', { numeric: true }) === false);
A.ok('missing trailing cell equals "" for a text column', QA.cellEquals('', undefined, tinfo('agent_requests', 'request_text')));
A.ok('timestamp: same instant in different ISO forms compares equal', QA.cellEquals('2026-06-22T12:00:00.000Z', '2026-06-22T12:00:00Z', tinfo('agent_requests', 'created_at')));
A.ok('agent_requests.created_at classified as timestamp; *_cost_usd as numeric; approval_required as boolean',
  tinfo('agent_requests', 'created_at').timestamp && tinfo('agent_requests', 'estimated_source_cost_usd').numeric && tinfo('agent_requests', 'approval_required').boolean);
A.ok('formula-escape apostrophe tolerated only for formula-lead text', QA.textEquals("'=1+1", '=1+1') && QA.textEquals('=1+1', "'=1+1") && QA.textEquals("O'Brien", "Brien") === false);

A.section('15e. formula SAFETY (separate typed assertion) — stringValue passes; a real formulaValue fails');
var typedSafe = {}; ['query', 'plan_summary', 'result_summary', 'next_action'].forEach(function (f, i) { typedSafe[f] = { userEnteredValue: { stringValue: QA.FORMULA_TESTS[i] } }; });
A.ok('verifyFormulaSafety PASS when every formula cell is a stringValue', QA.verifyFormulaSafety(typedSafe, ['query', 'plan_summary', 'result_summary', 'next_action']).ok === true);
var typedBad = JSON.parse(JSON.stringify(typedSafe)); typedBad.query = { userEnteredValue: { formulaValue: '=1+1' } };
A.ok('verifyFormulaSafety FAIL when any cell is a formulaValue (detects a real formula)', QA.verifyFormulaSafety(typedBad, ['query', 'plan_summary', 'result_summary', 'next_action']).ok === false);
A.ok('a live run with a formulaValue makes FORMULA_INJECTION_NEUTRALIZATION=FAIL', (function () {
  var ver = QA.verifyAll({ resolved: resolved, identity: id, config: { formula_tests_enabled: true }, row_set: live.row_set, before: buildBefore(foreignSpec()), plan: live.plan, after: live.after, applied: true, typed: typedBad });
  return ver.markers.FORMULA_INJECTION_NEUTRALIZATION === 'FAIL';
})());
A.ok('parseTypedRow maps a spreadsheets.get includeGridData row to columns', (function () {
  var resp = { sheets: [{ properties: { title: 'agent_requests' }, data: [{ rowData: [{ values: [{ userEnteredValue: { stringValue: 'X' } }, { userEnteredValue: { numberValue: -5 } }] }] }] }] };
  var t = QA.parseTypedRow(resp, 'agent_requests', headersOf('agent_requests'));
  var h0 = headersOf('agent_requests')[0], h1 = headersOf('agent_requests')[1];
  return t[h0].userEnteredValue.stringValue === 'X' && t[h1].userEnteredValue.numberValue === -5;
})());

A.section('15f. QA-019 REGRESSION — genuine scope violations are caught with structured BEFORE_AFTER_FAILURES');
A.ok('a modified FOREIGN row is reported (foreign_row_modified) and fails scope', (function () {
  var bad = JSON.parse(JSON.stringify(live.after));
  var f = bad.agent_requests.rows.filter(function (r) { return String(r.agent_request_id) === 'foreign-req'; })[0];
  f.request_text = 'TAMPERED';
  var ba = QA.verifyBeforeAfter(resolved, buildBefore(foreignSpec()), bad, id, live.row_set, live.plan);
  return ba.ok === false && ba.failures.some(function (x) { return x.kind === 'foreign_row_modified'; });
})());
A.ok('a missing expected QA row is reported (expected_row_missing)', (function () {
  var bad = JSON.parse(JSON.stringify(live.after));
  bad.tracked_sources.rows = bad.tracked_sources.rows.filter(function (r) { return String(r.source_id) !== String(id.qa_source_id); });
  var ba = QA.verifyBeforeAfter(resolved, buildBefore(foreignSpec()), bad, id, live.row_set, live.plan);
  return ba.ok === false && ba.failures.some(function (x) { return x.kind === 'expected_row_missing' && x.sheet === 'tracked_sources'; });
})());
A.ok('a duplicate QA row is reported (duplicate_qa_row)', (function () {
  var bad = JSON.parse(JSON.stringify(live.after));
  var dup = bad.agent_requests.rows.filter(function (r) { return String(r.agent_request_id) === String(id.qa_request_a); })[0];
  bad.agent_requests.rows.push(JSON.parse(JSON.stringify(dup)));
  var ba = QA.verifyBeforeAfter(resolved, buildBefore(foreignSpec()), bad, id, live.row_set, live.plan);
  return ba.ok === false && ba.failures.some(function (x) { return x.kind === 'duplicate_qa_row'; });
})());

A.section('16. owner + request isolation — strict, fail-closed post-read assertion (no foreign rows)');
A.eq('OWNER_ISOLATION=PASS', live.summary.OWNER_ISOLATION, 'PASS');
A.eq('REQUEST_ISOLATION=PASS', live.summary.REQUEST_ISOLATION, 'PASS');
A.eq('FOREIGN_ROWS_RETURNED=0', live.summary.FOREIGN_ROWS_RETURNED, 0);
A.ok('isolation verifier CAN detect a leak (a foreign-owner row mis-tagged into our run is counted)', (function () {
  var bad = JSON.parse(JSON.stringify(live.after));
  bad.conversation_state.rows.push({ conversation_id: id.qa_conversation_b, owner_user_id: id.qa_owner_a, current_state: 'received', pending_clarification: '[MSQA data_mode=manual_test qa_run_id=' + id.qa_run_id + ' owner=' + id.qa_owner_a + ' role=leak]', updated_at: 't' });
  var iso = QA.verifyIsolation(bad, id, live.row_set);
  return iso.foreign_rows_returned > 0 && iso.owner_isolation === false;
})());

A.section('17. before/after scope — only this run added; foreign rows + headers + undeclared tabs untouched');
A.eq('BEFORE_AFTER_SCOPE=PASS', live.summary.BEFORE_AFTER_SCOPE, 'PASS');
A.eq('EXPECTED_ROWS_WRITTEN=7', live.summary.EXPECTED_ROWS_WRITTEN, 7);
A.eq('UNEXPECTED_ROWS_WRITTEN=0', live.summary.UNEXPECTED_ROWS_WRITTEN, 0);
A.eq('FOREIGN_ROWS_MODIFIED=0', live.summary.FOREIGN_ROWS_MODIFIED, 0);
A.eq('HEADERS_MODIFIED=0', live.summary.HEADERS_MODIFIED, 0);
A.eq('UNDECLARED_TABS_MODIFIED=0', live.summary.UNDECLARED_TABS_MODIFIED, 0);
A.ok('the pre-existing foreign row survives byte-identically into the after-snapshot', (function () {
  var f = live.after.agent_requests.rows.filter(function (r) { return String(r.agent_request_id) === 'foreign-req'; });
  return f.length === 1 && f[0].request_text === 'unrelated';
})());

A.section('18. repeat-run idempotency — reuse_qa_run_id over the real after-state plans ZERO new inserts');
var before2 = JSON.parse(JSON.stringify(live.after));
TEST_SHEETS.forEach(function (n) { if (!before2[n]) before2[n] = { headers: headersOf(n), rows: [], row_numbers: [], count: 0, next_free_row: 2, last_occupied_row: 1, grid_row_count: 1000 }; });
var rerun = QA.runOffline({
  resolved: resolved, metadata: metadataAll(gridMapAll(1000)), headerRows: headerRowsAll(),
  config: Object.assign({ formula_tests_enabled: true }, ID_CFG, { execute_writes: true, confirm_staging_spreadsheet: true, reuse_qa_run_id: id.qa_run_id }),
  identity: QA.buildRunIdentity(Object.assign({}, ID_CFG, { reuse_qa_run_id: id.qa_run_id })), before: before2, sheet_ids: sheetIdsAll()
});
A.eq('repeat run plans 0 inserts', rerun.plan.counts.inserts, 0);
A.eq('DUPLICATE_AGENT_REQUESTS_CREATED=0', rerun.summary.DUPLICATE_AGENT_REQUESTS_CREATED, 0);
A.eq('DUPLICATE_CONVERSATION_STATES_CREATED=0', rerun.summary.DUPLICATE_CONVERSATION_STATES_CREATED, 0);
A.eq('DUPLICATE_TRACKED_SOURCES_CREATED=0', rerun.summary.DUPLICATE_TRACKED_SOURCES_CREATED, 0);
A.eq('DUPLICATE_OUTBOX_DELIVERIES_CREATED=0', rerun.summary.DUPLICATE_OUTBOX_DELIVERIES_CREATED, 0);
A.eq('IDEMPOTENCY=PASS', rerun.summary.IDEMPOTENCY, 'PASS');
A.eq('repeat run still PASS overall', rerun.summary.RESULT, 'PASS');
A.ok('repeat-run updates rewrite their EXACT physical rows (no new rows beyond the originals)', (function () {
  // every update range on the repeat run must match a physical row that existed in the live after-snapshot
  var liveRows = {}; TEST_SHEETS.forEach(function (n) { liveRows[n] = (live.after[n] ? live.after[n].row_numbers : []) || []; });
  return rerun.plan.decisions.filter(function (d) { return d.decision === 'update'; }).every(function (d) { return liveRows[d.tab].indexOf(d.row) >= 0; });
})());
A.ok('outbox delivery is suppressed on repeat (idempotent dedup by delivery_id)', rerun.plan.counts.suppressed >= 1);

A.section('19. Section 9 summary — exact key set present; RESULT is DERIVED, never hard-coded');
var REQUIRED_KEYS = ['PREFLIGHT', 'CONTRACT_TABS_PRESENT', 'SHEETS_READ', 'WRITE_PLAN', 'NEXT_DATA_ROWS', 'GRID_EXPANSIONS',
  'APPEND_AGENT_REQUEST', 'READ_BACK_AGENT_REQUEST', 'APPEND_REQUEST_EVENT', 'UPSERT_INSERT', 'UPSERT_UPDATE',
  'UPSERT_ROW_COUNT_STABLE', 'TRACKED_SOURCE_UPSERT', 'OUTBOX_IDEMPOTENCY', 'OWNER_ISOLATION', 'REQUEST_ISOLATION',
  'FORMULA_INJECTION_NEUTRALIZATION', 'NEGATIVE_NUMBER_PRESERVATION', 'BEFORE_AFTER_SCOPE', 'FOREIGN_ROWS_RETURNED',
  'FOREIGN_ROWS_MODIFIED', 'EXPECTED_ROWS_WRITTEN', 'UNEXPECTED_ROWS_WRITTEN', 'HEADERS_MODIFIED',
  'UNDECLARED_TABS_MODIFIED', 'DUPLICATE_AGENT_REQUESTS_CREATED', 'DUPLICATE_CONVERSATION_STATES_CREATED',
  'DUPLICATE_TRACKED_SOURCES_CREATED', 'DUPLICATE_OUTBOX_DELIVERIES_CREATED', 'IDEMPOTENCY',
  'EXTERNAL_NON_GOOGLE_CALLS', 'WRITE_NODE_EXECUTED', 'WRITE_REQUEST_SUCCEEDED', 'MUTATIONS_EXECUTED',
  'AFTER_SNAPSHOT_READ', 'ACCEPTANCE_VERIFIED', 'CHANGES_APPLIED', 'QA_RUN_ID', 'DATA_MODE', 'RESULT'];
A.ok('every required Section 9 key is present', REQUIRED_KEYS.every(function (k) { return k in live.summary; }));
A.eq('QA_RUN_ID is the generated run id', live.summary.QA_RUN_ID, id.qa_run_id);
A.ok('RESULT flips to BLOCKED_PREFLIGHT when a tab is missing (proves it is computed)', (function () {
  var md = metadataAll(); md.sheets = md.sheets.filter(function (s) { return s.properties.title !== 'telegram_outbox'; });
  var r = QA.runOffline({ resolved: resolved, metadata: md, headerRows: headerRowsAll(), config: Object.assign({ formula_tests_enabled: true }, ID_CFG, { execute_writes: true, confirm_staging_spreadsheet: true }), identity: id, before: buildBefore(foreignSpec()), sheet_ids: sheetIdsAll() });
  return r.summary.RESULT === 'BLOCKED_PREFLIGHT' && r.summary.RESULT !== 'PASS';
})());

// =============================================================================================================
A.section('20. generated workflow — inactive, manual-only, no creds/id, Google-only, deterministic, ops-scoped');
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
A.ok('the Expand node is a structural :batchUpdate that grows rowCount only (no destructive verb)', (function () {
  var n = wf.nodes.find(function (x) { return x.name === 'Expand Grid (spreadsheets:batchUpdate)'; });
  return n && n.parameters.url.indexOf(':batchUpdate') >= 0 && n.parameters.url.indexOf('values:batchUpdate') < 0 && n.parameters.jsonBody.indexOf('expansionBody') >= 0;
})());
A.ok('the Apply node targets values:batchUpdate and writes the plan batchBody', (function () { var n = wf.nodes.find(function (x) { return x.name === 'Apply Writes (values:batchUpdate)'; }); return n && n.parameters.url.indexOf('/values:batchUpdate') >= 0 && n.parameters.jsonBody.indexOf('batchBody') >= 0; })());
A.ok('the plan + report nodes embed the engine (functions present, no module.exports)', ['Preflight & Plan', 'Verify & Report'].every(function (name) {
  var n = wf.nodes.find(function (x) { return x.name === name; });
  return /function planOperations\(/.test(n.parameters.jsCode) && /function assembleSummary\(|function verifyAll\(/.test(n.parameters.jsCode) && n.parameters.jsCode.indexOf('module.exports') < 0;
}));
A.ok('no destructive verb is CONSTRUCTED in any embedded code (delete/clear only appear in a comment)', (function () {
  return wf.nodes.filter(function (n) { return n.type === 'n8n-nodes-base.code'; }).every(function (n) {
    return n.parameters.jsCode.split('\n').every(function (line) {
      if (!/deleteSheet|deleteRange|deleteDimension|values:clear|batchClear/i.test(line)) return true;
      return /^\s*\/\//.test(line);   // any occurrence must be inside a // comment
    });
  });
})());
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
