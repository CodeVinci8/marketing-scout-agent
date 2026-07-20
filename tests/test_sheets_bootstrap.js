'use strict';
// test_sheets_bootstrap.js — offline regression for the Stage 3 Google Sheets staging bootstrap.
// Covers Section 14 of the spec: resolver, pure planner (create/blank/match/mismatch/order/freeze/filter/widths/
// dropdowns/checkboxes/free-text/validation-rows/idempotency), and the generated QA workflow (inactive, manual
// trigger only, no credential id, no real spreadsheet id, no destructive request, deterministic / no drift).
// $0, no network, no Google call — every Google interaction is simulated in-memory.
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const R = require('../n8n/lib/sheets_contract_resolver.js');
const P = require('../n8n/lib/sheets_bootstrap_planner.js');
const GEN = require('../tools/gen_sheets_bootstrap_workflow.js');
const TAX = require('../config/sheets_ui_contracts.json');
const TAXONOMY = require('../config/taxonomy.json');

const resolved = R.resolveOrThrow();

// ---- helpers: turn an in-memory sheet model into the API response shapes the planner consumes ----------------
function makeSheet(id, title, index, headerRow, frozen) {
  return { sheetId: id, title: title, index: index, rowCount: 1000, columnCount: 26, frozenRowCount: frozen || 0, headerRow: headerRow || [] };
}
function getMeta(model) {
  return {
    sheets: model.sheets.map(function (s) { return { properties: { sheetId: s.sheetId, title: s.title, index: s.index, gridProperties: { rowCount: s.rowCount, columnCount: s.columnCount, frozenRowCount: s.frozenRowCount } } }; }),
    developerMetadata: model.marker ? [{ metadataKey: P.MARKER_KEY, metadataValue: JSON.stringify(model.marker) }] : []
  };
}
function getHeaders(model) { const h = {}; model.sheets.forEach(function (s) { h[s.title] = s.headerRow.slice(); }); return h; }
function planOn(model, config) { return P.plan({ resolved: resolved, config: config, spreadsheet: getMeta(model), headerRows: getHeaders(model) }); }
function markerValue() { return { contract_hash: resolved.contract_hash, fmt_version: resolved.fmt_version, validation_version: resolved.validation_version, applied_at: 't' }; }

// =============================================================================================================
A.section('1. resolver — exactly 47 resolved sheets, ordered, non-empty unique headers');
A.eq('DECLARED_TABS=47', resolved.summary.DECLARED_TABS, 47);
A.eq('RESOLVED_HEADER_SETS=47', resolved.summary.RESOLVED_HEADER_SETS, 47);
A.eq('UNRESOLVED_HEADER_SETS=0', resolved.summary.UNRESOLVED_HEADER_SETS, 0);
A.eq('sheet_count=47', resolved.sheet_count, 47);
A.ok('every sheet has a non-empty header set', resolved.sheets.every(function (s) { return s.headers.length > 0; }));
A.ok('no empty header token anywhere', resolved.sheets.every(function (s) { return s.headers.every(function (h) { return String(h).trim() !== ''; }); }));
A.ok('no duplicate header within any sheet', resolved.sheets.every(function (s) { return new Set(s.headers).size === s.headers.length; }));
A.ok('sheet names are unique', new Set(resolved.sheets.map(function (s) { return s.sheet_name; })).size === 47);
A.ok('sheet_order is 1..47 contiguous', resolved.sheets.every(function (s, i) { return s.sheet_order === i + 1; }));
A.ok('required_columns are a subset of headers', resolved.sheets.every(function (s) { return s.required_columns.every(function (rc) { return s.headers.indexOf(rc) >= 0; }); }));
A.ok('contract_hash is deterministic + stable', resolved.contract_hash === R.resolveOrThrow().contract_hash && /^h/.test(resolved.contract_hash));

A.section('2. resolver — dropdown options equal canonical repository enums (no invented values)');
function ddOf(sheet, col) { return (resolved.sheets.find(function (s) { return s.sheet_name === sheet; }).ui_columns.dropdowns[col]); }
A.eq('public_lead_signals.service_type == taxonomy.service', ddOf('public_lead_signals', 'service_type').values, TAXONOMY.service);
A.eq('monitor_queue.route == taxonomy.valid_routes', ddOf('monitor_queue', 'route').values, TAXONOMY.valid_routes);
A.eq('agent_requests.state == canonical agent_state', ddOf('agent_requests', 'state').values, TAX.canonical_enums.agent_state.values);
A.eq('market_intelligence_reports.report_type == canonical report_type', ddOf('market_intelligence_reports', 'report_type').values, TAX.canonical_enums.report_type.values);
A.ok('every dropdown records a provenance source', resolved.sheets.every(function (s) { return Object.keys(s.ui_columns.dropdowns).every(function (c) { return !!s.ui_columns.dropdowns[c].source; }); }));
A.ok('closed enums are strict (send_status)', ddOf('telegram_outbox', 'send_status').strict === true);
A.ok('legacy-bearing enums are non-strict (service_type)', ddOf('public_lead_signals', 'service_type').strict === false);

A.section('3. resolver — free-text / id / hash / url / timestamp columns get NO validation');
var freeText = [['raw_market_records', 'text_context'], ['raw_market_records', 'notes'], ['public_lead_signals', 'evidence_text'],
  ['url_registry', 'normalized_source_url'], ['public_lead_signals', 'lead_signal_id'], ['vk_posts', 'content_hash'],
  ['conversation_messages', 'created_at'], ['market_intelligence_reports', 'notes']];
A.ok('free-text/id/hash/url/timestamp columns have neither dropdown nor checkbox', freeText.every(function (pair) {
  var s = resolved.sheets.find(function (x) { return x.sheet_name === pair[0]; });
  return !s.ui_columns.dropdowns[pair[1]] && s.ui_columns.checkboxes.indexOf(pair[1]) < 0;
}));

A.section('4. resolver — failure modes (fails closed; never silently invents)');
function resolveMutated(mut) { var repo = R.loadRepo(); repo = JSON.parse(JSON.stringify(repo)); mut(repo); return R.resolve(repo); }
A.ok('unknown enum source fails validation', resolveMutated(function (repo) { repo.ui.sheets.agent_requests.dropdowns.state = 'canonical:does_not_exist'; }).ok === false);
A.ok('duplicate header fails validation', resolveMutated(function (repo) { repo.contracts.headers.url_registry.push('note'); }).ok === false);
A.ok('empty header token fails validation', resolveMutated(function (repo) { repo.contracts.headers.url_registry[0] = ''; }).ok === false);
A.ok('required_columns not in headers fails validation', resolveMutated(function (repo) { repo.contracts.tabs.url_registry.required_columns = ['nonexistent_col']; }).ok === false);
A.ok('wrong tab count fails validation', resolveMutated(function (repo) { repo.contracts.sheet_order.pop(); }).ok === false);
A.ok('dropdown referencing a missing column fails validation', resolveMutated(function (repo) { repo.ui.sheets.url_registry.dropdowns = { not_a_col: 'taxonomy:service' }; }).ok === false);

// =============================================================================================================
A.section('5. planner — fresh empty staging spreadsheet (only __qa_connection)');
function freshModel() { return { sheets: [makeSheet(777, '__qa_connection', 0, ['check', 'ts', 'ok'], 0)], marker: null }; }
var dry = planOn(freshModel(), { apply_changes: false });
A.ok('dry-run sets dry_run=true', dry.dry_run === true);
A.eq('dry-run plans 47 creates (preview)', dry.summary.CREATED_TABS, 47);
A.eq('extra __qa_connection recognised + preserved', dry.summary.EXTRA_PRESERVED_TABS, ['__qa_connection']);
A.eq('helper validation sheet not required', dry.summary.HELPER_VALIDATION_SHEET_CREATED, false);

A.section('6/7/10/11. planner — first apply creates, inits headers, freezes, filters, dropdowns, checkboxes');
var m1 = freshModel();
var a1 = planOn(m1, { apply_changes: true, now: 't1' });
A.ok('first apply plans required mutations', a1.mutations_planned > 0 && a1.requests.length === a1.mutations_planned);
A.eq('creates exactly the 47 missing contract sheets', a1.create_requests.length, 47);
A.ok('every created sheet is frozen at row 1 via addSheet', a1.create_requests.every(function (r) { return r.addSheet.properties.gridProperties.frozenRowCount === 1; }));
A.ok('created sheets assigned real (non-negative) sheetIds', a1.create_requests.every(function (r) { return r.addSheet.properties.sheetId > 0; }));
A.eq('one basic filter per contract sheet', a1.requests.filter(function (r) { return r.setBasicFilter; }).length, 47);
A.ok('a dropdown count > 0 and matches resolver totals', a1.summary.DROPDOWN_COLUMNS_CONFIGURED === 163);
A.ok('a checkbox count > 0 and matches resolver totals', a1.summary.CHECKBOX_COLUMNS_CONFIGURED === 33);
A.ok('marker write is included on first apply', !!a1.marker_request);

A.section('8/12. planner — header writes only init row 1; widths deterministic + semantic');
A.ok('every header write targets row 1 (rowIndex 0) only — never clears body', a1.requests.filter(function (r) { return r.updateCells; }).every(function (r) { return r.updateCells.start.rowIndex === 0; }));
A.ok('width rule is deterministic + reusable', P.widthFor('source_url') === P.widthFor('canonical_url') && P.widthFor('source_url') === 320 && P.widthFor('quality_score') === 90 && P.widthFor('agent_request_id') === 160);
A.ok('long-text columns are flagged wide', P.isLongText('llm_summary_ru') && P.isLongText('notes') && !P.isLongText('platform'));

A.section('9. planner — DANGEROUS non-empty header mismatch aborts ALL mutations');
var mBad = { sheets: [makeSheet(1, 'url_registry', 0, ['WRONG_FIRST_COL', 'source_url'], 1)], marker: null };
var aBad = planOn(mBad, { apply_changes: true, now: 't' });
A.ok('blocked is true', aBad.blocked === true);
A.eq('zero mutations planned when blocked', aBad.mutations_planned, 0);
A.eq('no create requests survive a block', aBad.create_requests.length, 0);
A.eq('dangerous mismatch report shape', Object.keys(aBad.dangerous_mismatches[0]).sort(), ['actual_headers', 'expected_headers', 'sheet']);
A.eq('mismatch names the offending sheet', aBad.dangerous_mismatches[0].sheet, 'url_registry');

A.section('7b. planner — completely blank existing sheet is initialised; exact-prefix older schema is APPENDED');
var urlHeaders = resolved.sheets.find(function (s) { return s.sheet_name === 'url_registry'; }).headers;
var mBlank = { sheets: [makeSheet(1, 'url_registry', 0, [], 1)], marker: markerValue() };
var aBlank = planOn(mBlank, { apply_changes: true, apply_formatting: false, apply_validations: false, now: 't' });
A.eq('blank existing sheet counted as initialised', aBlank.summary.BLANK_TABS_INITIALIZED, 1);
var blankWrite = aBlank.requests.filter(function (r) { return r.updateCells && r.updateCells.start.sheetId === 1; })[0];
A.eq('blank init writes full header row from column 0', blankWrite.updateCells.start.columnIndex, 0);
var mPrefix = { sheets: [makeSheet(1, 'url_registry', 0, urlHeaders.slice(0, 8), 1)], marker: markerValue() };
var aPrefix = planOn(mPrefix, { apply_changes: true, apply_formatting: false, apply_validations: false, now: 't' });
A.eq('older-schema prefix is appended, not overwritten', aPrefix.summary.HEADERS_APPENDED, 1);
var appendWrite = aPrefix.requests.filter(function (r) { return r.updateCells && r.updateCells.start.sheetId === 1; })[0];
A.eq('append starts to the RIGHT of existing columns (col 8)', appendWrite.updateCells.start.columnIndex, 8);
A.eq('append writes exactly the 2 missing trailing headers', appendWrite.updateCells.rows[0].values.map(function (v) { return v.userEnteredValue.stringValue; }), urlHeaders.slice(8));

A.section('8b. planner — already-correct headers produce no write; existing unfrozen sheet gets a freeze');
var mMatch = { sheets: [makeSheet(1, 'url_registry', 0, urlHeaders.slice(), 0)], marker: markerValue() };
var aMatch = planOn(mMatch, { apply_changes: true, apply_formatting: false, apply_validations: false, now: 't' });
A.ok('matching header is not rewritten', aMatch.requests.filter(function (r) { return r.updateCells && r.updateCells.start.sheetId === 1; }).length === 0);
A.eq('matching header counted', aMatch.summary.MATCHING_HEADERS, 1);
A.ok('unfrozen existing sheet gets a freeze request', aMatch.requests.some(function (r) { return r.updateSheetProperties && r.updateSheetProperties.properties.sheetId === 1 && r.updateSheetProperties.fields === 'gridProperties.frozenRowCount'; }));

A.section('14. planner — booleans use checkboxes; no true/false text dropdown; validations from row 2');
A.ok('outreach_allowed is a checkbox (BOOLEAN validation), not a dropdown', (function () {
  var pls = resolved.sheets.find(function (s) { return s.sheet_name === 'public_lead_signals'; });
  return pls.ui_columns.checkboxes.indexOf('outreach_allowed') >= 0 && !pls.ui_columns.dropdowns.outreach_allowed;
})());
A.ok('every checkbox emits a BOOLEAN data-validation rule', a1.requests.filter(function (r) { return r.setDataValidation && r.setDataValidation.rule.condition.type === 'BOOLEAN'; }).length === 33);
A.ok('no dropdown is a true/false text list', a1.requests.filter(function (r) { return r.setDataValidation && r.setDataValidation.rule.condition.type === 'ONE_OF_LIST'; }).every(function (r) {
  var vals = r.setDataValidation.rule.condition.values.map(function (v) { return String(v.userEnteredValue).toLowerCase(); }).sort();
  return JSON.stringify(vals) !== JSON.stringify(['false', 'true']);
}));
A.ok('every data validation begins at row 2 (startRowIndex===1) — never the header', a1.requests.filter(function (r) { return r.setDataValidation; }).every(function (r) { return r.setDataValidation.range.startRowIndex === 1; }));
A.ok('checkbox validation is non-coercive (strict=false → blanks stay blank)', a1.requests.filter(function (r) { return r.setDataValidation && r.setDataValidation.rule.condition.type === 'BOOLEAN'; }).every(function (r) { return r.setDataValidation.rule.strict === false; }));

A.section('26. planner — NO destructive request is EVER planned');
var DESTRUCTIVE = ['deleteSheet', 'deleteRange', 'deleteDimension', 'deleteDimensionGroup', 'deleteProtectedRange', 'deleteDeveloperMetadata', 'deleteNamedRange', 'cutPaste', 'clearBasicFilter', 'autoFill', 'deleteDuplicates', 'deleteFilterView'];
A.ok('first apply contains no destructive request type', a1.requests.every(function (r) { return DESTRUCTIVE.every(function (k) { return !(k in r); }); }));
A.ok('no updateCells ever targets a body row (only header row 0)', a1.requests.filter(function (r) { return r.updateCells; }).every(function (r) { return r.updateCells.start.rowIndex === 0; }));

A.section('3b/5b. order — contract sheets occupy first 47, extras preserved AFTER in relative order');
// two extras besides __qa_connection, in a deliberate order
var mExtras = { sheets: [makeSheet(50, 'zeta_extra', 0, ['a'], 1), makeSheet(51, '__qa_connection', 1, ['c'], 1), makeSheet(52, 'alpha_extra', 2, ['b'], 1)], marker: null };
var aExtras = planOn(mExtras, { apply_changes: true, now: 't' });
A.eq('all three extras preserved', aExtras.summary.EXTRA_PRESERVED_TABS.slice().sort(), ['__qa_connection', 'alpha_extra', 'zeta_extra']);
// simulate the full apply, then assert final ordering
var sim = { sheets: mExtras.sheets.map(function (s) { return Object.assign({}, s); }), marker: null };
P.simulateApply(sim, aExtras.requests, markerValue());
var ordered = sim.sheets.slice().sort(function (a, b) { return a.index - b.index; }).map(function (s) { return s.title; });
A.ok('first 47 visible sheets are the contract sheets in contract order', JSON.stringify(ordered.slice(0, 47)) === JSON.stringify(resolved.sheets.map(function (s) { return s.sheet_name; })));
A.eq('extras follow contract sheets, original relative order preserved', ordered.slice(47), ['zeta_extra', '__qa_connection', 'alpha_extra']);
A.ok('__qa_connection content untouched after bootstrap', JSON.stringify(sim.sheets.find(function (s) { return s.title === '__qa_connection'; }).headerRow) === JSON.stringify(['c']));

A.section('12/19/21. idempotency — full apply then a second apply plans ZERO mutations');
var model = freshModel();
var first = planOn(model, { apply_changes: true, now: 't1' });
P.simulateApply(model, first.requests, markerValue());
var second = planOn(model, { apply_changes: true, now: 't2' });
var keys = P.toSecondRunKeys(second);
A.eq('SECOND_RUN_CREATED=0', keys.SECOND_RUN_CREATED, 0);
A.eq('SECOND_RUN_HEADERS_WRITTEN=0', keys.SECOND_RUN_HEADERS_WRITTEN, 0);
A.eq('SECOND_RUN_REORDERED=0', keys.SECOND_RUN_REORDERED, 0);
A.eq('SECOND_RUN_FORMATTING_CHANGED=0', keys.SECOND_RUN_FORMATTING_CHANGED, 0);
A.eq('SECOND_RUN_VALIDATIONS_CHANGED=0', keys.SECOND_RUN_VALIDATIONS_CHANGED, 0);
A.eq('SECOND_RUN_HEADER_MISMATCHES=0', keys.SECOND_RUN_HEADER_MISMATCHES, 0);
A.eq('IDEMPOTENCY=PASS', keys.IDEMPOTENCY, 'PASS');
A.eq('second apply has zero requests', second.requests.length, 0);
A.ok('a re-dry-run on a correct sheet also plans nothing', planOn(model, { apply_changes: false }).mutations_planned === 0);
// the post-apply model is fully correct
A.ok('all 47 contract sheets exist, frozen, ordered, with exact headers', resolved.sheets.every(function (cs, i) {
  var sh = model.sheets.find(function (s) { return s.title === cs.sheet_name; });
  return sh && sh.index === i && sh.frozenRowCount === 1 && JSON.stringify(sh.headerRow) === JSON.stringify(cs.headers);
}));

A.section('13. machine-readable summary — required Section 13 keys present, counts not hard-coded');
var SUMMARY_KEYS = ['DECLARED_TABS', 'EXISTING_CONTRACT_TABS', 'CREATED_TABS', 'BLANK_TABS_INITIALIZED', 'MATCHING_HEADERS',
  'HEADER_MISMATCHES', 'MISSING_TABS', 'CONTRACT_TABS_ORDERED', 'ORDER_MISMATCHES', 'FORMATTED_SHEETS',
  'DROPDOWN_COLUMNS_CONFIGURED', 'CHECKBOX_COLUMNS_CONFIGURED', 'VALIDATION_MISMATCHES', 'EXTRA_PRESERVED_TABS',
  'HELPER_VALIDATION_SHEET_CREATED', 'CHANGES_APPLIED', 'CONTRACT_HASH', 'RESULT'];
A.ok('every required summary key is present', SUMMARY_KEYS.every(function (k) { return k in a1.summary; }));
A.eq('CONTRACT_TABS_ORDERED=47', a1.summary.CONTRACT_TABS_ORDERED, 47);
A.eq('summary CONTRACT_HASH matches resolver', a1.summary.CONTRACT_HASH, resolved.contract_hash);
A.eq('second-run FORMATTED_SHEETS=0 (gated by marker)', second.summary.FORMATTED_SHEETS, 0);
A.eq('second-run DROPDOWN_COLUMNS_CONFIGURED=0', second.summary.DROPDOWN_COLUMNS_CONFIGURED, 0);

// =============================================================================================================
A.section('22-29. generated QA workflow — inactive, manual-only, no creds/id, no drift, manifest-excluded');
var built = GEN.build();
var wf = built.workflow;
A.eq('workflow is inactive', wf.active, false);
A.ok('exactly one trigger, and it is a manual trigger', wf.nodes.filter(function (n) { return /Trigger$/.test(n.type) || /trigger/i.test(n.type); }).length === 1 && wf.nodes.some(function (n) { return n.type === 'n8n-nodes-base.manualTrigger'; }));
A.ok('no webhook node', !wf.nodes.some(function (n) { return /webhook/i.test(n.type); }));
A.ok('no node carries a credential id block', !wf.nodes.some(function (n) { return n.credentials; }));
A.ok('every HTTP node uses the googleApi predefined credential type', wf.nodes.filter(function (n) { return n.type === 'n8n-nodes-base.httpRequest'; }).every(function (n) { return n.parameters.authentication === 'predefinedCredentialType' && n.parameters.nodeCredentialType === 'googleApi'; }));
var blob = JSON.stringify(wf);
A.ok('carries the spreadsheet-id placeholder, not a real id', blob.indexOf('PASTE_STAGING_SPREADSHEET_ID') >= 0);
A.ok('every external URL is on sheets.googleapis.com only', (blob.match(/https:\/\/[a-z0-9.]+\.[a-z]+/gi) || []).every(function (u) { return u.indexOf('sheets.googleapis.com') >= 0; }));
A.ok('the plan node embeds the planner (no module.exports, plan() present)', (function () { var n = wf.nodes.find(function (x) { return x.name === 'Plan Bootstrap'; }); return /function plan\(input\)/.test(n.parameters.jsCode) && n.parameters.jsCode.indexOf('module.exports') < 0; })());
A.ok('generation is deterministic (render twice is identical)', GEN.render(GEN.build().workflow) === GEN.render(GEN.build().workflow));
A.ok('on-disk generated workflow is up to date (no drift)', fs.readFileSync(GEN.OUT_FILE, 'utf8') === GEN.render(wf));
A.ok('generated workflow lives under ops/ and NOT in the production-scanned n8n/workflows dir', (function () {
  if (GEN.OUT_FILE.indexOf(path.join('ops', 'n8n', 'workflows')) < 0) return false;
  var prodDir = path.join(__dirname, '..', 'n8n', 'workflows');
  return fs.readdirSync(prodDir).indexOf('qa_stage3_sheets_bootstrap.json') < 0;
})());
A.ok('not registered in the production workflow manifest', (function () {
  var m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'workflow_manifest.json'), 'utf8'));
  return !(m.workflows || []).some(function (w) { return /qa_stage3_sheets_bootstrap/.test(String(w.file)); });
})());

A.section('18. hidden helper validation sheet — only created when required (not required here)');
A.eq('no helper sheet is created (all enums fit ONE_OF_LIST directly)', a1.summary.HELPER_VALIDATION_SHEET_CREATED, false);
A.ok('no __validation_lists sheet is planned', !a1.create_requests.some(function (r) { return r.addSheet.properties.title === '__validation_lists'; }));

A.report('sheets-bootstrap');
