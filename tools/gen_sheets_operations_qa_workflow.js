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

const ROOT = path.join(__dirname, '..');
const ENGINE_PATH = path.join(ROOT, 'n8n', 'lib', 'sheets_operations_qa.js');
const OUT_DIR = path.join(ROOT, 'ops', 'n8n', 'workflows');
const OUT_FILE = path.join(OUT_DIR, 'qa_stage3_sheets_operations_acceptance.json');

const CRED_NAME = 'Google Sheets - Marketing Scout Service Account';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets/';
const TEST_SHEETS = ['agent_requests', 'agent_request_events', 'conversation_state', 'tracked_sources', 'telegram_outbox'];

// ----- embed the engine source (strip its module.exports so it runs inline inside an n8n Code node) ------------
function engineSource() {
  let src = fs.readFileSync(ENGINE_PATH, 'utf8');
  src = src.replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '\n');
  return src.trim();
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
  const ENGINE = engineSource();

  // fail generation if any field used by the QA workflow is not declared in the relevant sheet contract
  // (the engine validates its plan against the embedded resolved snapshot — re-run it here at generation time).
  const engineMod = require(ENGINE_PATH);
  const vp = engineMod.validatePlanAgainstContract(resolved);
  if (!vp.ok) {
    throw new Error('QA plan is not contract-clean — fix the contract or the QA plan:\n  ' +
      vp.findings.map(f => f.code + ': ' + f.detail).join('\n  '));
  }

  const snapshot = { resolved: resolved };
  const sourceHash = resolver.djb2(resolver.stableStringify(resolved) + '|' + ENGINE);
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
    "const config = {",
    "  execute_writes: asBool(cfg.execute_writes, false),",
    "  confirm_staging_spreadsheet: asBool(cfg.confirm_staging_spreadsheet, false),",
    "  qa_owner_id: String(cfg.qa_owner_id == null || cfg.qa_owner_id === '' ? 'qa-stage3-owner' : cfg.qa_owner_id),",
    "  formula_tests_enabled: asBool(cfg.formula_tests_enabled, true),",
    "  reuse_qa_run_id: String(cfg.reuse_qa_run_id == null ? '' : cfg.reuse_qa_run_id).trim(),",
    "  now_stamp: stamp, rand_suffix: rand,",
    "  now: d.toISOString(), now2: new Date(d.getTime() + 1000).toISOString()",
    "};",
    "const identity = buildRunIdentity(config);",
    "const snapshot = " + snapshotJson + ";",
    "snapshot.source_hash = '" + sourceHash + "';",
    "const TEST_SHEETS = " + JSON.stringify(TEST_SHEETS) + ";",
    "const test_sheets = TEST_SHEETS.map(function (n) { const cs = (snapshot.resolved.sheets || []).filter(function (s) { return s.sheet_name === n; })[0]; return { name: n, ncols: cs ? cs.headers.length : 0 }; });",
    "return [{ json: { spreadsheet_id: sid, config: config, identity: identity, snapshot: snapshot, test_sheets: test_sheets } }];"
  ].join('\n');
  const nInit = code('msq-03-init', 'Init, Guard & Embed Engine', [60, 0], ENGINE + '\n' + initJs);

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
    "const before = parseSnapshot(beforeResp);",
    "const set = buildQaRowSet(id, config);",
    "const pre = preflight({ resolved: resolved, metadata: meta, headerRows: headerRows, config: config, identity: id, row_set: set });",
    "const plan = planOperations({ resolved: resolved, identity: id, config: config, row_set: set, before: before, preflight: pre });",
    "return [{ json: {",
    "  should_apply: plan.should_apply_writes, blocked: plan.blocked, dry_run: !plan.should_apply_writes,",
    "  mutations_planned: (plan.batchBody.data || []).length, batchBody: plan.batchBody,",
    "  preflight: pre, qa_run_id: id.qa_run_id",
    "} }];"
  ].join('\n');
  const nPlan = code('msq-09-plan', 'Preflight & Plan', [1380, 0], ENGINE + '\n' + planGlue);

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

  // -- node 11: apply writes (single values:batchUpdate, USER_ENTERED, no destructive request) [TRUE branch]
  const buUrl = "={{ '" + SHEETS_BASE + "' + encodeURIComponent($('Init, Guard & Embed Engine').first().json.spreadsheet_id) + '/values:batchUpdate' }}";
  const nApply = httpPost('msq-11-apply', 'Apply Writes (values:batchUpdate)', [1820, -140], buUrl, '={{ JSON.stringify($json.batchBody) }}');

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
  const nAfterRanges = code('msq-12-afterranges', 'Build After Ranges', [2040, -140], afterRangesJs);

  // -- node 13: get AFTER snapshot
  const nAfter = httpGet('msq-13-getafter', 'Get After Snapshot', [2260, -140], '={{ $json.url }}');

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
    "const before = parseSnapshot(beforeResp);",
    "const set = buildQaRowSet(id, config);",
    "const pre = preflight({ resolved: resolved, metadata: meta, headerRows: headerRows, config: config, identity: id, row_set: set });",
    "const plan = planOperations({ resolved: resolved, identity: id, config: config, row_set: set, before: before, preflight: pre });",
    "let after = null, applied = false;",
    "try { const a = $('Get After Snapshot').first().json; if (a && a.valueRanges) { after = parseSnapshot(a); applied = true; } } catch (e) { after = null; applied = false; }",
    "const ver = verifyAll({ resolved: resolved, identity: id, config: config, row_set: set, before: before, plan: plan, after: applied ? after : null });",
    "const summary = assembleSummary({ preflight: pre, verify: ver, identity: id, config: config, plan: plan, changes_applied: applied, sheets_read: true });",
    "summary.SOURCE_HASH = init.snapshot.source_hash;",
    "return [{ json: summary }];"
  ].join('\n');
  const nReport = code('msq-14-report', 'Verify & Report', [2480, 0], ENGINE + '\n' + reportGlue);

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
    '   A dry-run plans + verifies against a simulated projection and sends NOTHING.',
    '3. On the 4 HTTP Request nodes, select the existing credential:',
    '   "' + CRED_NAME + '".',
    '   Enable "Set up for use in HTTP Request node" and restrict allowed domains to',
    '   https://sheets.googleapis.com. No NEW credential is created.',
    '4. To perform the live staging write, set BOTH execute_writes = true AND',
    '   confirm_staging_spreadsheet = true, then run again. Writes are blocked unless BOTH are true',
    '   and preflight passed (40 tabs, matching contract hash, required test columns present).',
    '5. To prove idempotency, copy QA_RUN_ID from the Report into reuse_qa_run_id and run again:',
    '   the Report must show every DUPLICATE_* = 0 and IDEMPOTENCY = PASS.',
    '',
    'Docs: docs/STAGE3_SHEETS_OPERATIONS_ACCEPTANCE.md. Keep this workflow INACTIVE.'
  ].join('\n'), 5);
  const s2 = sticky('msq-note-engine', [1380, 240], 560, 240, [
    'ENGINE (embedded, drift-proof):',
    'A frozen snapshot of the resolved Sheets contract (config/sheets_contracts.json +',
    'config/sheets_ui_contracts.json + config/taxonomy.json) and the pure engine',
    'n8n/lib/sheets_operations_qa.js are embedded by tools/gen_sheets_operations_qa_workflow.js.',
    'Edit the contract or engine and REGENERATE — never hand-edit this workflow.',
    '',
    'Every write is one values:batchUpdate (USER_ENTERED) targeting explicit data-row ranges (row >= 2);',
    'the header row is never written and only the 5 declared test sheets are ever targeted. Formula',
    'injection is neutralized (apostrophe prefix); finite negatives (-5, -4.5) stay numeric.'
  ].join('\n'), 4);

  const nodes = [nManual, nConfig, nInit, nMeta, nHeaderRanges, nHeaders, nBeforeRanges, nBefore, nPlan, nIf, nApply, nAfterRanges, nAfter, nReport, s1, s2];

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
    conn('Apply Writes?', 'Apply Writes (values:batchUpdate)', 0), // TRUE
    conn('Apply Writes?', 'Verify & Report', 1),                   // FALSE (dry-run)
    conn('Apply Writes (values:batchUpdate)', 'Build After Ranges'),
    conn('Build After Ranges', 'Get After Snapshot'),
    conn('Get After Snapshot', 'Verify & Report')
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

module.exports = { build, render, OUT_FILE, engineSource, TEST_SHEETS };
