'use strict';
// gen_sheets_bootstrap_workflow.js — deterministically generates the inactive QA staging-bootstrap workflow
// ops/n8n/workflows/qa_stage3_sheets_bootstrap.json.
//
// The generated workflow: Manual Trigger only (no webhook), embeds a frozen snapshot of the resolved contract +
// the pure planner (so it needs NO repository access at runtime), reads the staging spreadsheet via the official
// Google Sheets API (spreadsheets.get + values.batchGet) using HTTP Request nodes bound to the existing Google
// Service Account credential, runs the planner, and — only when apply_changes=true and there is no dangerous
// header mismatch — sends a single spreadsheets.batchUpdate. It carries NO real spreadsheet id and NO credential
// id (the operator pastes the staging id and selects the credential in the n8n UI). It lives under ops/ so it is
// excluded from the production runtime manifest and the production workflow validators.
//
// Determinism: fixed node ids/positions, no timestamps, stable JSON. Re-running produces a byte-identical file.
// Usage: node tools/gen_sheets_bootstrap_workflow.js   (add --check to fail if the on-disk file would change)

const fs = require('fs');
const path = require('path');
const resolver = require('../n8n/lib/sheets_contract_resolver.js');

const ROOT = path.join(__dirname, '..');
const PLANNER_PATH = path.join(ROOT, 'n8n', 'lib', 'sheets_bootstrap_planner.js');
const OUT_DIR = path.join(ROOT, 'ops', 'n8n', 'workflows');
const OUT_FILE = path.join(OUT_DIR, 'qa_stage3_sheets_bootstrap.json');

const CRED_NAME = 'Google Sheets - Marketing Scout Service Account';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets/';

// ----- embed the planner source (strip its module.exports so it runs inline inside an n8n Code node) -----------
function plannerSource() {
  let src = fs.readFileSync(PLANNER_PATH, 'utf8');
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
  const PLANNER = plannerSource();
  const snapshot = { resolved: resolved };
  const sourceHash = resolver.djb2(resolver.stableStringify(resolved) + '|' + PLANNER);
  const snapshotJson = JSON.stringify(snapshot);

  // -- node 1: manual trigger
  const nManual = { id: 'msb-01-trigger', name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-360, 0], parameters: {} };

  // -- node 2: config (Set)
  const nConfig = {
    id: 'msb-02-config', name: 'Set Bootstrap Config', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [-140, 0],
    parameters: {
      mode: 'manual', assignments: { assignments: [
        { id: 'a-sid', name: 'spreadsheet_id', value: 'PASTE_STAGING_SPREADSHEET_ID', type: 'string' },
        { id: 'a-apply', name: 'apply_changes', value: false, type: 'boolean' },
        { id: 'a-fmt', name: 'apply_formatting', value: true, type: 'boolean' },
        { id: 'a-val', name: 'apply_validations', value: true, type: 'boolean' }
      ] }, options: {}
    }
  };

  // -- node 3: init/guard/embed
  const initJs = [
    "// Guard the destination + normalize config, then embed the frozen contract snapshot (no repo access at runtime).",
    "const cfg = $input.first().json;",
    "const sid = String(cfg.spreadsheet_id == null ? '' : cfg.spreadsheet_id).trim();",
    "if (!sid || sid === 'PASTE_STAGING_SPREADSHEET_ID') {",
    "  throw new Error('Set spreadsheet_id in \"Set Bootstrap Config\" to your STAGING spreadsheet ID — never a production sheet.');",
    "}",
    "function asBool(v, dflt) { if (v === true || v === false) return v; const s = String(v).trim().toLowerCase(); if (s === 'true') return true; if (s === 'false') return false; return dflt; }",
    "const config = {",
    "  apply_changes: asBool(cfg.apply_changes, false),",
    "  apply_formatting: asBool(cfg.apply_formatting, true),",
    "  apply_validations: asBool(cfg.apply_validations, true),",
    "  now: new Date().toISOString()",
    "};",
    "const snapshot = " + snapshotJson + ";",
    "snapshot.source_hash = '" + sourceHash + "';",
    "return [{ json: { spreadsheet_id: sid, config: config, snapshot: snapshot } }];"
  ].join('\n');
  const nInit = code('msb-03-init', 'Init, Guard & Embed Contract', [80, 0], initJs);

  // -- node 4: get metadata
  const metaUrl = "={{ '" + SHEETS_BASE + "' + encodeURIComponent($json.spreadsheet_id) + '?fields=' + encodeURIComponent('sheets.properties,developerMetadata') + '&includeGridData=false' }}";
  const nMeta = httpGet('msb-04-getmeta', 'Get Spreadsheet Metadata', [300, 0], metaUrl);

  // -- node 5: build header ranges
  const rangesJs = [
    "// Build a values.batchGet URL that fetches row 1 (the header row) of every existing sheet.",
    "const meta = $input.first().json;",
    "const sid = $('Init, Guard & Embed Contract').first().json.spreadsheet_id;",
    "const props = (meta.sheets || []).map(function (s) { return s.properties || s; });",
    "function q(t) { return \"'\" + String(t).replace(/'/g, \"''\") + \"'!1:1\"; }",
    "let url = '" + SHEETS_BASE + "' + encodeURIComponent(sid) + '/values:batchGet?majorDimension=ROWS';",
    "props.forEach(function (p) { url += '&ranges=' + encodeURIComponent(q(p.title)); });",
    "return [{ json: { url: url } }];"
  ].join('\n');
  const nRanges = code('msb-05-ranges', 'Build Header Ranges', [520, 0], rangesJs);

  // -- node 6: get header rows
  const nHeaders = httpGet('msb-06-getheaders', 'Get Header Rows', [740, 0], '={{ $json.url }}');

  // -- node 7: plan
  const planGlue = [
    "",
    "// ---------- glue: assemble planner input from the API responses and run the pure planner ----------",
    "const init = $('Init, Guard & Embed Contract').first().json;",
    "const meta = $('Get Spreadsheet Metadata').first().json;",
    "const headerResp = $input.first().json;",
    "const headerRows = {};",
    "(headerResp.valueRanges || []).forEach(function (vr) {",
    "  const rng = String(vr.range || '');",
    "  const bang = rng.lastIndexOf('!');",
    "  let title = bang >= 0 ? rng.slice(0, bang) : rng;",
    "  if (title.charAt(0) === \"'\" && title.charAt(title.length - 1) === \"'\") title = title.slice(1, -1).replace(/''/g, \"'\");",
    "  headerRows[title] = (vr.values && vr.values[0]) ? vr.values[0] : [];",
    "});",
    "const result = plan({ resolved: init.snapshot.resolved, config: init.config, spreadsheet: meta, headerRows: headerRows });",
    "const report = Object.assign({}, result.summary);",
    "report.dry_run = result.dry_run;",
    "report.blocked = result.blocked;",
    "report.mutations_planned = result.mutations_planned;",
    "report.dangerous_mismatches = result.dangerous_mismatches;",
    "report.buckets = result.buckets;",
    "report.SOURCE_HASH = init.snapshot.source_hash;",
    "const should_apply = init.config.apply_changes === true && !result.blocked && result.mutations_planned > 0;",
    "return [{ json: { should_apply: should_apply, blocked: result.blocked, dry_run: result.dry_run, mutations_planned: result.mutations_planned, batchBody: { requests: result.requests }, report: report } }];"
  ].join('\n');
  const nPlan = code('msb-07-plan', 'Plan Bootstrap', [960, 0], PLANNER + '\n' + planGlue);

  // -- node 8: IF apply
  const nIf = {
    id: 'msb-08-if', name: 'Apply Changes?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [1180, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ id: 'cond-apply', leftValue: '={{ $json.should_apply }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }, options: {}
    }
  };

  // -- node 9: apply batchUpdate
  const buUrl = "={{ '" + SHEETS_BASE + "' + encodeURIComponent($('Init, Guard & Embed Contract').first().json.spreadsheet_id) + ':batchUpdate' }}";
  const nApply = httpPost('msb-09-apply', 'Apply Bootstrap (batchUpdate)', [1400, -120], buUrl, '={{ JSON.stringify($json.batchBody) }}');

  // -- node 10: report
  const reportJs = [
    "// Single machine-readable summary item (Section 13). Counts come from the planner, never hard-coded.",
    "const p = $('Plan Bootstrap').first().json;",
    "const report = p.report || {};",
    "let applied = false;",
    "try { applied = !!$('Apply Bootstrap (batchUpdate)').first().json; } catch (e) { applied = false; }",
    "report.CHANGES_APPLIED = applied && !p.blocked;",
    "report.RESULT = p.blocked ? 'BLOCKED_HEADER_MISMATCH' : 'PASS';",
    "return [{ json: report }];"
  ].join('\n');
  const nReport = code('msb-10-report', 'Report', [1620, 0], reportJs);

  // -- sticky notes
  const s1 = sticky('msb-note-setup', [-360, 220], 520, 360, [
    'STAGE 3 — GOOGLE SHEETS STAGING BOOTSTRAP (QA, inactive)',
    '',
    'BEFORE RUNNING:',
    '1. In "Set Bootstrap Config" paste the STAGING spreadsheet ID (never a production sheet).',
    '2. Keep apply_changes = false for the first run (dry-run). It reads only — no mutation.',
    '3. On the 4 HTTP Request nodes, select the existing credential:',
    '   "' + CRED_NAME + '".',
    '   Enable "Set up for use in HTTP Request node" on that Google Service Account credential and',
    '   restrict allowed domains to https://sheets.googleapis.com. No NEW credential is needed.',
    '4. Review the Report item. To apply, set apply_changes = true and run again.',
    '5. Run a third time to confirm idempotency (Report shows mutations_planned = 0).',
    '',
    'Docs: docs/STAGE3_SHEETS_BOOTSTRAP.md. Keep this workflow INACTIVE.'
  ].join('\n'), 5);
  const s2 = sticky('msb-note-engine', [960, 220], 520, 200, [
    'PLANNER (embedded, drift-proof):',
    'A frozen snapshot of config/sheets_contracts.json + config/sheets_ui_contracts.json + config/taxonomy.json',
    'and the pure planner n8n/lib/sheets_bootstrap_planner.js are embedded here by',
    'tools/gen_sheets_bootstrap_workflow.js. Edit the contracts/planner and REGENERATE — never hand-edit.',
    'Dry-run plans but never sends. A dangerous non-empty header mismatch aborts ALL mutations.'
  ].join('\n'), 4);

  const nodes = [nManual, nConfig, nInit, nMeta, nRanges, nHeaders, nPlan, nIf, nApply, nReport, s1, s2];

  // -- connections
  const wires = [
    conn('Manual Trigger', 'Set Bootstrap Config'),
    conn('Set Bootstrap Config', 'Init, Guard & Embed Contract'),
    conn('Init, Guard & Embed Contract', 'Get Spreadsheet Metadata'),
    conn('Get Spreadsheet Metadata', 'Build Header Ranges'),
    conn('Build Header Ranges', 'Get Header Rows'),
    conn('Get Header Rows', 'Plan Bootstrap'),
    conn('Plan Bootstrap', 'Apply Changes?'),
    conn('Apply Changes?', 'Apply Bootstrap (batchUpdate)', 0), // TRUE
    conn('Apply Changes?', 'Report', 1),                        // FALSE
    conn('Apply Bootstrap (batchUpdate)', 'Report')
  ];
  const connections = {};
  wires.forEach(function (w) {
    connections[w.from] = connections[w.from] || { main: [] };
    while (connections[w.from].main.length <= w.out) connections[w.from].main.push([]);
    connections[w.from].main[w.out].push({ node: w.to, type: 'main', index: 0 });
  });

  const workflow = {
    name: 'QA - Stage 3 Google Sheets Staging Bootstrap',
    nodes: nodes,
    connections: connections,
    active: false,
    settings: { executionOrder: 'v1' },
    versionId: 'qa-stage3-sheets-bootstrap-v1',
    meta: { templateCredsSetupCompleted: false, instanceId: '' },
    id: 'qa_stage3_sheets_bootstrap',
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
    if (current !== out) { console.error('DRIFT: ' + OUT_FILE + ' is out of date — run: node tools/gen_sheets_bootstrap_workflow.js'); process.exit(1); }
    console.log('OK: generated workflow is up to date (source_hash=' + built.sourceHash + ').');
    process.exit(0);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, out);
  console.log('Wrote ' + path.relative(ROOT, OUT_FILE) + ' (' + built.workflow.nodes.length + ' nodes, source_hash=' + built.sourceHash + ', active=false).');
}

module.exports = { build, render, OUT_FILE, plannerSource };
