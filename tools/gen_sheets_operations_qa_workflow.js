'use strict';
// gen_sheets_operations_qa_workflow.js — deterministically generates the INACTIVE, manual-only Stage 3C Google
// Sheets OPERATIONS acceptance workflow ops/n8n/workflows/qa_stage3_sheets_operations_acceptance.json.
//
// This is a QA / acceptance harness for the EXISTING persistence layer — NOT a product feature. It proves,
// against a SEPARATE staging spreadsheet, that the project can read, append, filtered-read-back, insert-upsert,
// update-upsert, dedup-idempotently, isolate by owner/request, neutralize formula injection, preserve negative
// numbers, and touch nothing outside its own generated QA run.
//
// The generated workflow: Manual Trigger only (no webhook), embeds a frozen snapshot of the resolved Sheets
// contract + the pure engine n8n/lib/sheets_operations_qa.js (so it needs NO repository access at runtime),
// reads the staging spreadsheet via the official Google Sheets API (spreadsheets.get + values:batchGet) using
// HTTP Request nodes bound to the existing Google Service Account credential, plans every operation, and — only
// when BOTH execute_writes=true AND confirm_staging_spreadsheet=true and preflight passed — sends a single
// values:batchUpdate (USER_ENTERED, no destructive request). It carries NO real spreadsheet id and NO credential
// id (the operator pastes the staging id and selects the credential in the n8n UI). It lives under ops/ so it is
// excluded from the production runtime manifest and the production workflow/sheet-contract validators.
//
// Determinism: fixed node ids/positions, no timestamps in the file (the qa_run_id timestamp/random suffix is
// computed at RUNTIME inside the Init Code node, not baked as a literal). Re-running produces a byte-identical
// file. Usage: node tools/gen_sheets_operations_qa_workflow.js   (add --check to fail if the file would change)

const fs = require('fs');
const path = require('path');
const resolver = require('../n8n/lib/sheets_contract_resolver.js');
const embed = require('./embed_lib.js');

const ROOT = path.join(__dirname, '..');
const ENGINE_PATH = path.join(ROOT, 'n8n', 'lib', 'sheets_operations_qa.js');
const OUT_DIR = path.join(ROOT, 'ops', 'n8n', 'workflows');
const OUT_FILE = path.join(OUT_DIR, 'qa_stage3_sheets_operations_acceptance.json');

const CRED_NAME = 'Google Sheets - Marketing Scout Service Account';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets/';
const TEST_SHEETS = ['agent_requests', 'agent_request_events', 'conversation_state', 'tracked_sources', 'telegram_outbox'];

// ----- embed the engine inside each n8n Code node as an ISOLATED module (IIFE) -----------------------------------
// The engine is a pure module. n8n Code nodes cannot require() local files, so the generator inlines it. Earlier
// the stripped core was concatenated directly into the node scope, which leaked the engine's private top-level
// `var MS_TZ` into the SAME lexical scope as the node glue's own `const MS_TZ` => SyntaxError. We now embed the
// engine via embed_lib.isolatedModule(): the core runs inside an IIFE that returns ONLY its declared exports,
// which are destructured into the node scope. Private constants (MS_TZ et al.) stay inside the IIFE forever.
function engineCore() {
  return embed.stripCore(fs.readFileSync(ENGINE_PATH, 'utf8'));
}
function engineExportNames() {
  return Object.keys(require(ENGINE_PATH)).sort();
}
// Build a Code-node body: strict-mode glue + isolated engine module + the node's own glue.
function nodeBody(engineModule, glue) {
  return "'use strict';\n" + engineModule + '\n' + glue;
}

// ----- node helpers -------------------------------------------------------------------------------------------
function code(id, name, pos, jsCode) {
  return { id: id, name: name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { mode: 'runOnceForAllItems', jsCode: jsCode } };
}
function httpGet(id, name, pos, urlExpr) {
  return {
    id: id, name: name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos,
    parameters: {
      method: 'GET', url: urlExpr, authentication: 'predefinedCredentialType', nodeCredentialType: 'googleApi',
      options: {}
    }
  };
}
function httpPost(id, name, pos, urlExpr, bodyExpr) {
  return {
    id: id, name: name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos,
    parameters: {
      method: 'POST', url: urlExpr, authentication: 'predefinedCredentialType', nodeCredentialType: 'googleApi',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true, specifyBody: 'json', jsonBody: bodyExpr, options: {}
    }
  };
}
function sticky(id, pos, w, h, content, color) {
  return { id: id, name: 'Note ' + id, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: pos, parameters: { content: content, width: w, height: h, color: color } };
}
function conn(from, to, fromOut) { return { from: from, to: to, out: fromOut || 0 }; }

function build() {
  const resolved = resolver.resolveOrThrow();
  const ENGINE_CORE = engineCore();
  const ENGINE_EXPORTS = engineExportNames();
  // The isolated engine module is identical in every node; its private constants (MS_TZ, etc.) never leak.
  const ENGINE = embed.isolatedModule('__sheetsOpsQa', ENGINE_CORE, ENGINE_EXPORTS);

  // fail generation if any field used by the QA workflow is not declared in the relevant sheet contract
  // (the engine validates its plan against the embedded resolved snapshot — re-run it here at generation time).
  const engineMod = require(ENGINE_PATH);
  const vp = engineMod.validatePlanAgainstContract(resolved);
  if (!vp.ok) {
    throw new Error('QA plan is not contract-clean — fix the contract or the QA plan:\n  ' +
      vp.findings.map(f => f.code + ': ' + f.detail).join('\n  '));
  }

  const snapshot = { resolved: resolved };
  // hash over the (stripped) engine core so the marker tracks real engine changes, independent of the wrapper.
  const sourceHash = resolver.djb2(resolver.stableStringify(resolved) + '|' + ENGINE_CORE);
  const snapshotJson = JSON.stringify(snapshot);

  // -- node 1: manual trigger
  const nManual = { id: 'msq-01-trigger', name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-380, 0], parameters: {} };

  // -- node 2: config (Set)
  const nConfig = {
    id: 'msq-02-config', name: 'Set QA Config', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [-160, 0],
    parameters: {
      mode: 'manual', assignments: { assignments: [
        { id: 'a-sid', name: 'spreadsheet_id', value: 'PASTE_STAGING_SPREADSHEET_ID', type: 'string' },
        { id: 'a-exec', name: 'execute_writes', value: false, type: 'boolean' },
        { id: 'a-confirm', name: 'confirm_staging_spreadsheet', value: false, type: 'boolean' },
        { id: 'a-owner', name: 'qa_owner_id', value: 'qa-stage3-owner', type: 'string' },
        { id: 'a-formula', name: 'formula_tests_enabled', value: true, type: 'boolean' },
        { id: 'a-reuse', name: 'reuse_qa_run_id', value: '', type: 'string' }
      ] }, options: {}
    }
  };

  // -- node 3: init/guard/embed engine + build run identity
  const initJs = [
    "",
    "// ---------- glue: guard destination, normalize config, build the traceable run identity, embed snapshot ----------",
    "const cfg = $input.first().json;",
    "const sid = String(cfg.spreadsheet_id == null ? '' : cfg.spreadsheet_id).trim();",
    "if (!sid || sid === 'PASTE_STAGING_SPREADSHEET_ID') {",
    "  throw new Error('Set spreadsheet_id in \"Set QA Config\" to your SEPARATE STAGING spreadsheet ID — never a production sheet.');",
    "}",
    "function asBool(v, dflt) { if (v === true || v === false) return v; const s = String(v).trim().toLowerCase(); if (s === 'true') return true; if (s === 'false') return false; return dflt; }",
    "const d = new Date();",
    "function pad(n) { return String(n).padStart(2, '0'); }",
    "const stamp = d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());",
    "const rand = (Math.random().toString(36).slice(2, 8) + '000000').slice(0, 6);",
    "// system timestamps use the product timezone (Europe/Moscow by default) as RFC3339 with the IANA offset",
    "// (mirrors n8n/lib/ms_time.js — NOT a hard-coded +3 shift). Override via MS_TIMEZONE in the env.",
    "const MS_TZ = String((typeof $env !== 'undefined' && $env.MS_TIMEZONE) || cfg.timezone || 'Europe/Moscow').trim() || 'Europe/Moscow';",
    "function msRFC3339(date) {",
    "  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: MS_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });",
    "  const map = {}; dtf.formatToParts(date).forEach(function (p) { map[p.type] = p.value; });",
    "  const asUTC = Date.UTC(+map.year, (+map.month) - 1, +map.day, (+map.hour) % 24, +map.minute, +map.second);",
    "  const off = Math.round((asUTC - date.getTime()) / 60000); const sign = off < 0 ? '-' : '+'; const a = Math.abs(off);",
    "  const local = new Date(date.getTime() + off * 60000);",
    "  return local.getUTCFullYear() + '-' + pad(local.getUTCMonth() + 1) + '-' + pad(local.getUTCDate()) + 'T' + pad(local.getUTCHours()) + ':' + pad(local.getUTCMinutes()) + ':' + pad(local.getUTCSeconds()) + '.' + String(local.getUTCMilliseconds()).padStart(3, '0') + sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);",
    "}",
    "const config = {",
    "  execute_writes: asBool(cfg.execute_writes, false),",
    "  confirm_staging_spreadsheet: asBool(cfg.confirm_staging_spreadsheet, false),",
    "  qa_owner_id: String(cfg.qa_owner_id == null || cfg.qa_owner_id === '' ? 'qa-stage3-owner' : cfg.qa_owner_id),",
    "  formula_tests_enabled: asBool(cfg.formula_tests_enabled, true),",
    "  reuse_qa_run_id: String(cfg.reuse_qa_run_id == null ? '' : cfg.reuse_qa_run_id).trim(),",
    "  timezone: MS_TZ, now_stamp: stamp, rand_suffix: rand,",
    "  now: msRFC3339(d), now2: msRFC3339(new Date(d.getTime() + 1000))",
    "};",
    "const identity = buildRunIdentity(config);",
    "const snapshot = " + snapshotJson + ";",
    "snapshot.source_hash = '" + sourceHash + "';",
    "const TEST_SHEETS = " + JSON.stringify(TEST_SHEETS) + ";",
    "const test_sheets = TEST_SHEETS.map(function (n) { const cs = (snapshot.resolved.sheets || []).filter(function (s) { return s.sheet_name === n; })[0]; return { name: n, ncols: cs ? cs.headers.length : 0 }; });",
    "return [{ json: { spreadsheet_id: sid, config: config, identity: identity, snapshot: snapshot, test_sheets: test_sheets } }];"
  ].join('\n');
  const nInit = code('msq-03-init', 'Init, Guard & Embed Engine', [60, 0], nodeBody(ENGINE, initJs));

  // -- node 4: get metadata (proves all 40 contract tabs present + carries the bootstrap developerMetadata marker)
  const metaUrl = "={{ '" + SHEETS_BASE + "' + encodeURIComponent($json.spreadsheet_id) + '?fields=' + encodeURIComponent('sheets.properties,developerMetadata') + '&includeGridData=false' }}";
  const nMeta = httpGet('msq-04-getmeta', 'Get Spreadsheet Metadata', [280, 0], metaUrl);

  // -- node 5: build header ranges (row 1 of each of the 5 test sheets — preflight verifies required columns)
  const headerRangesJs = [
    "// Build a values:batchGet URL that fetches row 1 (the header row) of every test sheet.",
    "const init = $('Init, Guard & Embed Engine').first().json;",
    "const sid = init.spreadsheet_id;",
    "function q(t) { return \"'\" + String(t).replace(/'/g, \"''\") + \"'!1:1\"; }",
    "let url = '" + SHEETS_BASE + "' + encodeURIComponent(sid) + '/values:batchGet?majorDimension=ROWS';",
    "(init.test_sheets || []).forEach(function (ts) { url += '&ranges=' + encodeURIComponent(q(ts.name)); });",
    "return [{ json: { url: url } }];"
  ].join('\n');
  const nHeaderRanges = code('msq-05-headerranges', 'Build Header Ranges', [500, 0], headerRangesJs);

  // -- node 6: get header rows
  const nHeaders = httpGet('msq-06-getheaders', 'Get Header Rows', [720, 0], '={{ $json.url }}');

  // -- node 7: build BEFORE ranges (full table A1:lastcol of each of the 5 test sheets)
  const beforeRangesJs = [
    "// Build a values:batchGet URL that fetches the full table (A1:lastCol) of every test sheet — BEFORE snapshot.",
    "const init = $('Init, Guard & Embed Engine').first().json;",
    "const sid = init.spreadsheet_id;",
    "function col(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s || 'A'; }",
    "function q(t, nc) { return \"'\" + String(t).replace(/'/g, \"''\") + \"'!A1:\" + col(nc || 26); }",
    "let url = '" + SHEETS_BASE + "' + encodeURIComponent(sid) + '/values:batchGet?majorDimension=ROWS';",
    "(init.test_sheets || []).forEach(function (ts) { url += '&ranges=' + encodeURIComponent(q(ts.name, ts.ncols)); });",
    "return [{ json: { url: url } }];"
  ].join('\n');
  const nBeforeRanges = code('msq-07-beforeranges', 'Build Before Ranges', [940, 0], beforeRangesJs);

  // -- node 8: get BEFORE snapshot
  const nBefore = httpGet('msq-08-getbefore', 'Get Before Snapshot', [1160, 0], '={{ $json.url }}');

  // -- shared glue: build identity / grid-capacity / sheetId maps for the 5 test sheets from the metadata. -----
  // Occupancy is keyed on identity columns (so preallocated checkbox-default cells never count as occupied);
  // gridRowCounts is the per-sheet capacity used ONLY as a boundary; sheetIds drives the bounded expansion.
  const MAPS_GLUE = [
    "const planMeta = sheetPlanMeta();",
    "const identity = {}; Object.keys(planMeta).forEach(function (n) { identity[n] = planMeta[n].identity_cols; });",
    "const gridRowCounts = {}, sheetIds = {};",
    "(meta.sheets || []).forEach(function (s) { var p = s.properties || s; var t = String(p.title); if (identity[t]) { sheetIds[t] = p.sheetId; gridRowCounts[t] = (p.gridProperties && p.gridProperties.rowCount) || 0; } });"
  ].join('\n');

  // -- node 9: preflight + plan (pure engine; produces the single USER_ENTERED values:batchUpdate body + gate)
  const planGlue = [
    "",
    "// ---------- glue: assemble engine input from the API responses, run preflight + planOperations ----------",
    "const init = $('Init, Guard & Embed Engine').first().json;",
    "const meta = $('Get Spreadsheet Metadata').first().json;",
    "const headerResp = $('Get Header Rows').first().json;",
    "const beforeResp = $input.first().json;",
    "const resolved = init.snapshot.resolved, config = init.config, id = init.identity;",
    "const headerRows = {};",
    "(headerResp.valueRanges || []).forEach(function (vr) { headerRows[titleFromRange(vr.range)] = (vr.values && vr.values[0]) ? vr.values[0] : []; });",
    MAPS_GLUE,
    "// derive PHYSICAL occupied rows from the actual values (never from grid capacity / a logical count).",
    "const before = parseSnapshot(beforeResp, { identity: identity, grid_row_counts: gridRowCounts });",
    "const set = buildQaRowSet(id, config);",
    "const pre = preflight({ resolved: resolved, metadata: meta, headerRows: headerRows, config: config, identity: id, row_set: set });",
    "const plan = planOperations({ resolved: resolved, identity: id, config: config, row_set: set, before: before, preflight: pre, sheet_ids: sheetIds });",
    "return [{ json: {",
    "  should_apply: plan.should_apply_writes, blocked: plan.blocked, dry_run: !plan.should_apply_writes,",
    "  mutations_planned: (plan.batchBody.data || []).length, batchBody: plan.batchBody,",
    "  needs_expansion: plan.needs_expansion === true, expansionBody: plan.expansion_body || { requests: [] },",
    "  expanded_tabs: plan.expanded_tabs, next_data_rows: plan.next_data_rows,",
    "  request_a_row: (plan.decisions.filter(function (d) { return d.tab === 'agent_requests' && d.role === 'request_a'; })[0] || {}).row || 0,",
    "  preflight: pre, qa_run_id: id.qa_run_id",
    "} }];"
  ].join('\n');
  const nPlan = code('msq-09-plan', 'Preflight & Plan', [1380, 0], nodeBody(ENGINE, planGlue));

  // -- node 10: IF should_apply (writes require execute_writes=true AND confirm_staging=true AND preflight pass)
  const nIf = {
    id: 'msq-10-if', name: 'Apply Writes?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [1600, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ id: 'cond-apply', leftValue: '={{ $json.should_apply }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }, options: {}
    }
  };

  // -- node 10b: IF needs_expansion (a target row exceeds the sheet's grid capacity) [only on the apply branch]
  const nExpandIf = {
    id: 'msq-10b-expandif', name: 'Expand Grid?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [1820, -200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ id: 'cond-exp', leftValue: '={{ $json.needs_expansion }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }, options: {}
    }
  };

  // -- node 10c: expand ONLY the affected sheet(s) first — structural spreadsheets:batchUpdate that GROWS
  //    gridProperties.rowCount (never deletes/clears/shrinks). Bounded: at most one structural call. [TRUE only]
  const expandUrl = "={{ '" + SHEETS_BASE + "' + encodeURIComponent($('Init, Guard & Embed Engine').first().json.spreadsheet_id) + ':batchUpdate' }}";
  const nExpand = httpPost('msq-10c-expand', 'Expand Grid (spreadsheets:batchUpdate)', [2040, -320], expandUrl, "={{ JSON.stringify($('Preflight & Plan').first().json.expansionBody) }}");

  // -- node 11: apply writes (single values:batchUpdate, USER_ENTERED, no destructive request) [apply branch]
  const buUrl = "={{ '" + SHEETS_BASE + "' + encodeURIComponent($('Init, Guard & Embed Engine').first().json.spreadsheet_id) + '/values:batchUpdate' }}";
  const nApply = httpPost('msq-11-apply', 'Apply Writes (values:batchUpdate)', [2040, -120], buUrl, "={{ JSON.stringify($('Preflight & Plan').first().json.batchBody) }}");

  // -- node 12: build AFTER ranges (re-read the full table of every test sheet AFTER the write)
  const afterRangesJs = [
    "// Build a values:batchGet URL that re-reads the full table (A1:lastCol) of every test sheet — AFTER snapshot.",
    "const init = $('Init, Guard & Embed Engine').first().json;",
    "const sid = init.spreadsheet_id;",
    "function col(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s || 'A'; }",
    "function q(t, nc) { return \"'\" + String(t).replace(/'/g, \"''\") + \"'!A1:\" + col(nc || 26); }",
    "let url = '" + SHEETS_BASE + "' + encodeURIComponent(sid) + '/values:batchGet?majorDimension=ROWS';",
    "(init.test_sheets || []).forEach(function (ts) { url += '&ranges=' + encodeURIComponent(q(ts.name, ts.ncols)); });",
    "return [{ json: { url: url } }];"
  ].join('\n');
  const nAfterRanges = code('msq-12-afterranges', 'Build After Ranges', [2260, -120], afterRangesJs);

  // -- node 13: get AFTER snapshot
  const nAfter = httpGet('msq-13-getafter', 'Get After Snapshot', [2480, -120], '={{ $json.url }}');

  // -- node 13b: build a bounded TYPED read URL (spreadsheets.get?includeGridData) for request A's row only,
  //    so formula safety can distinguish userEnteredValue.stringValue from .formulaValue (separate from read-back).
  const typeRangeJs = [
    "// Build a bounded spreadsheets.get (includeGridData) URL for ONLY request A's row on agent_requests.",
    "const init = $('Init, Guard & Embed Engine').first().json;",
    "const sid = init.spreadsheet_id;",
    "const plan = $('Preflight & Plan').first().json;",
    "const row = plan.request_a_row || 2;",
    "function col(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s || 'A'; }",
    "const ar = (init.test_sheets || []).filter(function (t) { return t.name === 'agent_requests'; })[0] || { ncols: 29 };",
    "const range = \"'agent_requests'!A\" + row + ':' + col(ar.ncols) + row;",
    "const fields = 'sheets(properties.title,data.rowData.values(userEnteredValue,effectiveValue,formattedValue))';",
    "const url = '" + SHEETS_BASE + "' + encodeURIComponent(sid) + '?ranges=' + encodeURIComponent(range) + '&includeGridData=true&fields=' + encodeURIComponent(fields);",
    "return [{ json: { url: url } }];"
  ].join('\n');
  const nTypeRange = code('msq-13b-typerange', 'Build Request-A Type Range', [2700, -120], typeRangeJs);

  // -- node 13c: typed read (spreadsheets.get includeGridData) of request A's row
  const nTyped = httpGet('msq-13c-gettypes', 'Get Request-A Cell Types', [2920, -120], '={{ $json.url }}');

  // -- node 14: verify + assemble the single machine-readable summary (both branches converge here)
  const reportGlue = [
    "",
    "// ---------- glue: recompute the plan deterministically, pull the real AFTER snapshot if writes ran, verify ----------",
    "const init = $('Init, Guard & Embed Engine').first().json;",
    "const meta = $('Get Spreadsheet Metadata').first().json;",
    "const headerResp = $('Get Header Rows').first().json;",
    "const beforeResp = $('Get Before Snapshot').first().json;",
    "const resolved = init.snapshot.resolved, config = init.config, id = init.identity;",
    "const headerRows = {};",
    "(headerResp.valueRanges || []).forEach(function (vr) { headerRows[titleFromRange(vr.range)] = (vr.values && vr.values[0]) ? vr.values[0] : []; });",
    MAPS_GLUE,
    "const before = parseSnapshot(beforeResp, { identity: identity, grid_row_counts: gridRowCounts });",
    "const set = buildQaRowSet(id, config);",
    "const pre = preflight({ resolved: resolved, metadata: meta, headerRows: headerRows, config: config, identity: id, row_set: set });",
    "const plan = planOperations({ resolved: resolved, identity: id, config: config, row_set: set, before: before, preflight: pre, sheet_ids: sheetIds });",
    "// applied === a real, successful values write happened AND a real after-snapshot read came back.",
    "let after = null, applied = false;",
    "try { const a = $('Get After Snapshot').first().json; if (a && a.valueRanges) { after = parseSnapshot(a, { identity: identity, grid_row_counts: gridRowCounts }); applied = true; } } catch (e) { after = null; applied = false; }",
    "// typed read (formula safety): parse request A's row cell types when the write executed.",
    "let typed = null;",
    "try { const tr = $('Get Request-A Cell Types').first().json; if (applied && tr && tr.sheets) typed = parseTypedRow(tr, 'agent_requests', headerRows.agent_requests || []); } catch (e) { typed = null; }",
    "const ver = verifyAll({ resolved: resolved, identity: id, config: config, row_set: set, before: before, plan: plan, after: applied ? after : null, applied: applied, typed: typed });",
    "const summary = assembleSummary({ preflight: pre, verify: ver, identity: id, config: config, plan: plan, changes_applied: applied, sheets_read: true });",
    "summary.SOURCE_HASH = init.snapshot.source_hash;",
    "summary.READ_BACK_FAILURES = ver.markers.READ_BACK_FAILURES || [];",
    "summary.BEFORE_AFTER_FAILURES = ver.markers.BEFORE_AFTER_FAILURES || [];",
    "summary.FORMULA_SAFETY_DETAILS = ver.markers.FORMULA_SAFETY_DETAILS || null;",
    "return [{ json: summary }];"
  ].join('\n');
  const nReport = code('msq-14-report', 'Verify & Report', [3140, 0], nodeBody(ENGINE, reportGlue));

  // -- sticky notes
  const s1 = sticky('msq-note-setup', [-380, 240], 560, 460, [
    'STAGE 3C — GOOGLE SHEETS OPERATIONS ACCEPTANCE (QA harness, inactive)',
    '',
    'This is an ACCEPTANCE HARNESS for the existing persistence layer, not a product feature.',
    'It writes ONLY clearly tagged manual_test rows for one generated qa_run_id, and NEVER deletes,',
    'clears, or touches another owner/request. No Telegram / Apify / Firecrawl / VK / Claude call is made.',
    '',
    'BEFORE RUNNING:',
    '1. In "Set QA Config" paste the SEPARATE STAGING spreadsheet ID (never a production sheet).',
    '   Run the Stage 3 bootstrap workflow against it first so all 40 tabs + the contract-hash marker exist.',
    '2. Keep execute_writes = false AND confirm_staging_spreadsheet = false for the first run (dry-run).',
    '   A dry-run plans + verifies the PLAN and sends NOTHING. In a dry-run the live-operation markers read',
    '   NOT_EXECUTED_DRY_RUN (not PASS); only PREFLIGHT/SHEETS_READ/WRITE_PLAN can be PASS and CHANGES_APPLIED=false.',
    '3. On every HTTP Request node, select the existing credential:',
    '   "' + CRED_NAME + '".',
    '   Enable "Set up for use in HTTP Request node" and restrict allowed domains to',
    '   https://sheets.googleapis.com. No NEW credential is created.',
    '4. To perform the live staging write, set BOTH execute_writes = true AND',
    '   confirm_staging_spreadsheet = true, then run again. Writes are blocked unless BOTH are true',
    '   and preflight passed (40 tabs, matching contract hash, required test columns present).',
    '   Live-operation markers become PASS only after the write succeeds AND the after-snapshot is re-read +',
    '   verified; CHANGES_APPLIED = true only then.',
    '5. To prove idempotency, copy QA_RUN_ID from the Report into reuse_qa_run_id and run again:',
    '   the Report must show every DUPLICATE_* = 0 and IDEMPOTENCY = PASS.',
    '',
    'Docs: docs/STAGE3_SHEETS_OPERATIONS_ACCEPTANCE.md. Keep this workflow INACTIVE.'
  ].join('\n'), 5);
  const s2 = sticky('msq-note-engine', [1380, 260], 620, 280, [
    'ENGINE (embedded, drift-proof):',
    'A frozen snapshot of the resolved Sheets contract (config/sheets_contracts.json +',
    'config/sheets_ui_contracts.json + config/taxonomy.json) and the pure engine',
    'n8n/lib/sheets_operations_qa.js are embedded by tools/gen_sheets_operations_qa_workflow.js.',
    'Edit the contract or engine and REGENERATE — never hand-edit this workflow.',
    '',
    'Row allocation is derived from PHYSICAL occupied rows in the actual before-snapshot (occupancy keyed on',
    'identity columns, so preallocated checkbox/format cells and trailing empty rows never count). Grid',
    'rowCount is used ONLY as a capacity limit. If a target row exceeds capacity, "Expand Grid" grows ONLY',
    'the affected sheet (updateSheetProperties, rowCount up only) before the values write.',
    '',
    'Every write is one values:batchUpdate (USER_ENTERED) to explicit data rows (>= 2); the header row is',
    'never written and only the 5 declared test sheets are targeted. No deleteSheet/deleteRange/values.clear.',
    '',
    'READ-BACK is contract-aware (numeric *_usd columns read FORMATTED e.g. "-5.00" / "-5,00" => compared numerically;',
    'booleans TRUE/FALSE; blanks; timestamps as instants; formula-escape apostrophe tolerated). FORMULA SAFETY',
    'is a SEPARATE typed read (spreadsheets.get includeGridData) proving stringValue, never formulaValue.'
  ].join('\n'), 4);

  const nodes = [nManual, nConfig, nInit, nMeta, nHeaderRanges, nHeaders, nBeforeRanges, nBefore, nPlan, nIf, nExpandIf, nExpand, nApply, nAfterRanges, nAfter, nTypeRange, nTyped, nReport, s1, s2];

  // -- connections
  const wires = [
    conn('Manual Trigger', 'Set QA Config'),
    conn('Set QA Config', 'Init, Guard & Embed Engine'),
    conn('Init, Guard & Embed Engine', 'Get Spreadsheet Metadata'),
    conn('Get Spreadsheet Metadata', 'Build Header Ranges'),
    conn('Build Header Ranges', 'Get Header Rows'),
    conn('Get Header Rows', 'Build Before Ranges'),
    conn('Build Before Ranges', 'Get Before Snapshot'),
    conn('Get Before Snapshot', 'Preflight & Plan'),
    conn('Preflight & Plan', 'Apply Writes?'),
    conn('Apply Writes?', 'Expand Grid?', 0),                      // TRUE -> consider capacity expansion
    conn('Apply Writes?', 'Verify & Report', 1),                   // FALSE (dry-run) -> report
    conn('Expand Grid?', 'Expand Grid (spreadsheets:batchUpdate)', 0), // TRUE -> expand affected sheet(s) first
    conn('Expand Grid?', 'Apply Writes (values:batchUpdate)', 1),  // FALSE -> straight to the values write
    conn('Expand Grid (spreadsheets:batchUpdate)', 'Apply Writes (values:batchUpdate)'),
    conn('Apply Writes (values:batchUpdate)', 'Build After Ranges'),
    conn('Build After Ranges', 'Get After Snapshot'),
    conn('Get After Snapshot', 'Build Request-A Type Range'),      // typed read for formula safety
    conn('Build Request-A Type Range', 'Get Request-A Cell Types'),
    conn('Get Request-A Cell Types', 'Verify & Report')
  ];
  const connections = {};
  wires.forEach(function (w) {
    connections[w.from] = connections[w.from] || { main: [] };
    while (connections[w.from].main.length <= w.out) connections[w.from].main.push([]);
    connections[w.from].main[w.out].push({ node: w.to, type: 'main', index: 0 });
  });

  const workflow = {
    name: 'QA - Stage 3 Google Sheets Operations Acceptance',
    nodes: nodes,
    connections: connections,
    active: false,
    settings: { executionOrder: 'v1' },
    versionId: 'qa-stage3-sheets-operations-acceptance-v1',
    meta: { templateCredsSetupCompleted: false, instanceId: '' },
    id: 'qa_stage3_sheets_operations_acceptance',
    tags: [],
    pinData: {}
  };
  return { workflow: workflow, sourceHash: sourceHash, resolved: resolved };
}

function render(workflow) { return JSON.stringify(workflow, null, 2) + '\n'; }

if (require.main === module) {
  const checkOnly = process.argv.indexOf('--check') >= 0;
  const built = build();
  const out = render(built.workflow);
  const exists = fs.existsSync(OUT_FILE);
  const current = exists ? fs.readFileSync(OUT_FILE, 'utf8') : null;
  if (checkOnly) {
    if (current !== out) { console.error('DRIFT: ' + OUT_FILE + ' is out of date — run: node tools/gen_sheets_operations_qa_workflow.js'); process.exit(1); }
    console.log('OK: generated workflow is up to date (source_hash=' + built.sourceHash + ').');
    process.exit(0);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, out);
  console.log('Wrote ' + path.relative(ROOT, OUT_FILE) + ' (' + built.workflow.nodes.length + ' nodes, source_hash=' + built.sourceHash + ', active=false).');
}

module.exports = { build, render, OUT_FILE, engineCore, engineExportNames, TEST_SHEETS };
