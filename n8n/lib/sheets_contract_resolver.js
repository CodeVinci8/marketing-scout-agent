'use strict';
// sheets_contract_resolver.js — resolves the Stage 3 Google Sheets staging contract into a single, validated,
// deterministic structure consumed by the bootstrap planner and the workflow generator.
//
// Sources of truth (all offline, no secrets, no network):
//   - config/sheets_contracts.json  : sheet_order + ordered headers + identity_columns + scope/retention/required
//   - config/sheets_ui_contracts.json: per-sheet dropdown/checkbox rules + canonical_enums (with provenance)
//   - config/taxonomy.json          : canonical semantic enums (taxonomy:<key> dropdown sources)
//
// It NEVER invents an enum value or a header. Every dropdown enum_ref must resolve; every header set must be
// non-empty and unique; required_columns must be a subset of headers. resolve() returns { ok, findings, resolved };
// resolveOrThrow() throws on the first failure. The resolved structure carries a deterministic contract_hash so a
// second correct bootstrap run produces zero mutations (see n8n/lib/sheets_bootstrap_planner.js).
//
// This module reads repository files; it is used at generation/test time only and is NOT embedded in the n8n
// runtime (n8n Code nodes cannot require local files). The generator bakes resolve()'s output into the workflow.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const F_CONTRACTS = path.join(ROOT, 'config', 'sheets_contracts.json');
const F_UI = path.join(ROOT, 'config', 'sheets_ui_contracts.json');
const F_TAXONOMY = path.join(ROOT, 'config', 'taxonomy.json');

// Bumped when the *formatting* or *validation* derivation rules change in a way that should force a one-time
// re-apply on the next bootstrap run (the planner folds these into the spreadsheet's developerMetadata marker).
const FMT_VERSION = 'fmt-v1';
const VALIDATION_VERSION = 'val-v1';
const CONTRACT_VERSION = 'bootstrap-contract-v1';

const EXPECTED_TAB_COUNT = 41;

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function loadRepo() {
  return { contracts: readJSON(F_CONTRACTS), ui: readJSON(F_UI), taxonomy: readJSON(F_TAXONOMY) };
}

// djb2 — stable, dependency-free hash so the planner stays embeddable and the hash is reproducible everywhere.
function djb2(s) {
  s = String(s == null ? '' : s);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}

// Deterministic stringify: object keys sorted, so the hash is independent of source key order.
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// Build the canonical enum registry keyed by enum_ref. taxonomy:<key> -> config/taxonomy.json array.
// canonical:<name> -> config/sheets_ui_contracts.json canonical_enums entry (values + strict + source).
function buildEnumRegistry(ui, taxonomy) {
  const reg = {};
  const tk = taxonomy || {};
  // taxonomy refs are resolved lazily by resolveEnum so we don't need to enumerate every taxonomy key here,
  // but we expose the canonical ones for visibility / the embedded snapshot.
  const TAXONOMY_KEYS = ['record_type', 'entity_type', 'activity_subtype', 'market_signal_subtype', 'service',
    'valid_routes', 'quality_status', 'data_mode', 'cost_status', 'quality_flags'];
  TAXONOMY_KEYS.forEach(k => {
    if (Array.isArray(tk[k])) reg['taxonomy:' + k] = { values: tk[k].slice(), strict: (k === 'service' || k === 'record_type' || k === 'entity_type' || k === 'activity_subtype') ? false : true, source: 'config/taxonomy.json:' + k + ' (' + (tk.taxonomy_version || '') + ')' };
  });
  const ce = (ui && ui.canonical_enums) || {};
  Object.keys(ce).forEach(name => {
    const e = ce[name];
    reg['canonical:' + name] = { values: (e.values || []).slice(), strict: e.strict !== false, source: e.source || '' };
  });
  return reg;
}

// Resolve a single enum_ref against the registry + taxonomy (taxonomy keys not in the curated list still resolve).
function resolveEnum(ref, registry, taxonomy) {
  if (registry[ref]) return registry[ref];
  const idx = String(ref).indexOf(':');
  if (idx < 0) return null;
  const kind = ref.slice(0, idx), name = ref.slice(idx + 1);
  if (kind === 'taxonomy' && taxonomy && Array.isArray(taxonomy[name])) {
    return { values: taxonomy[name].slice(), strict: true, source: 'config/taxonomy.json:' + name };
  }
  return null;
}

function pushFail(findings, code, detail) { findings.push({ ok: false, code: code, detail: detail }); }

// Resolve the whole contract. Returns { ok, findings, resolved }. resolved is null when ok===false.
function resolve(input) {
  const repo = input || loadRepo();
  const contracts = repo.contracts, ui = repo.ui, taxonomy = repo.taxonomy;
  const findings = [];

  const order = Array.isArray(contracts.sheet_order) ? contracts.sheet_order : [];
  const headers = contracts.headers || {};
  const identity = contracts.identity_columns || {};
  const tabs = contracts.tabs || {};
  const scopeCols = Array.isArray(contracts.scope_columns) ? contracts.scope_columns : [];
  const uiSheets = (ui && ui.sheets) || {};
  const registry = buildEnumRegistry(ui, taxonomy);

  // (1) exactly 40 declared contract sheets
  if (order.length !== EXPECTED_TAB_COUNT) pushFail(findings, 'tab_count', 'sheet_order has ' + order.length + ', expected ' + EXPECTED_TAB_COUNT);

  // (2) sheet names unique
  const seen = {};
  order.forEach(t => { if (seen[t]) pushFail(findings, 'duplicate_sheet', t); seen[t] = true; });

  // (3) every contract tab declared in tabs{} appears in sheet_order and vice versa (no orphan headers/tabs)
  Object.keys(tabs).forEach(t => { if (order.indexOf(t) < 0) pushFail(findings, 'tab_not_ordered', t); });
  order.forEach(t => { if (!tabs[t]) pushFail(findings, 'order_not_a_tab', t); });

  const resolvedSheets = [];
  let resolvedHeaderSets = 0;

  order.forEach((name, i) => {
    const hdr = headers[name];
    const tab = tabs[name] || {};

    // (4) headers present + non-empty + no empty token + no duplicates
    if (!Array.isArray(hdr) || hdr.length === 0) { pushFail(findings, 'no_headers', name); return; }
    let okHeaders = true;
    hdr.forEach(h => { if (h == null || String(h).trim() === '') { pushFail(findings, 'empty_header', name); okHeaders = false; } });
    const hseen = {};
    hdr.forEach(h => { if (hseen[h]) { pushFail(findings, 'duplicate_header', name + ' :: ' + h); okHeaders = false; } hseen[h] = true; });

    // (5) required_columns must be a subset of headers
    (tab.required_columns || []).forEach(rc => { if (hdr.indexOf(rc) < 0) pushFail(findings, 'required_not_in_headers', name + ' :: ' + rc); });

    // UI rules: dropdowns/checkboxes must reference real columns + resolvable enums
    const uiSheet = uiSheets[name] || { dropdowns: {}, checkboxes: [] };
    const colset = {}; hdr.forEach(h => { colset[h] = true; });
    const dropdowns = {};
    Object.keys(uiSheet.dropdowns || {}).forEach(col => {
      if (!colset[col]) { pushFail(findings, 'dropdown_col_missing', name + ' :: ' + col); return; }
      const rule = uiSheet.dropdowns[col];
      const enum_ref = typeof rule === 'string' ? rule : rule.enum_ref;
      const e = resolveEnum(enum_ref, registry, taxonomy);
      if (!e) { pushFail(findings, 'unresolved_enum', name + ' :: ' + col + ' :: ' + enum_ref); return; }
      const strict = (rule && typeof rule === 'object' && typeof rule.strict === 'boolean') ? rule.strict : e.strict;
      if (!e.values.length) { pushFail(findings, 'empty_enum', name + ' :: ' + col + ' :: ' + enum_ref); return; }
      dropdowns[col] = { enum_ref: enum_ref, values: e.values.slice(), strict: strict, source: e.source };
    });
    const checkboxes = [];
    (uiSheet.checkboxes || []).forEach(col => {
      if (!colset[col]) { pushFail(findings, 'checkbox_col_missing', name + ' :: ' + col); return; }
      checkboxes.push(col);
    });

    resolvedHeaderSets++;
    resolvedSheets.push({
      sheet_name: name,
      sheet_order: i + 1,
      headers: hdr.slice(),
      identity_columns: (identity[name] || []).slice(),
      scope_columns: scopeCols.filter(c => colset[c]),
      retention_class: tab.retention_class || '',
      required_columns: (tab.required_columns || []).slice(),
      owner_scoped: !!tab.owner_scoped,
      request_scoped: !!tab.request_scoped,
      ui_columns: { dropdowns: dropdowns, checkboxes: checkboxes }
    });
  });

  // UI sheets that name a non-contract sheet
  Object.keys(uiSheets).forEach(t => { if (order.indexOf(t) < 0) pushFail(findings, 'ui_sheet_not_in_contract', t); });

  const ok = findings.length === 0;
  if (!ok) return { ok: false, findings: findings, resolved: null };

  const resolved = {
    contract_version: CONTRACT_VERSION,
    fmt_version: FMT_VERSION,
    validation_version: VALIDATION_VERSION,
    taxonomy_version: (taxonomy && taxonomy.taxonomy_version) || '',
    scope_columns: scopeCols.slice(),
    sheet_count: resolvedSheets.length,
    sheets: resolvedSheets,
    enums: registry,
    summary: { DECLARED_TABS: order.length, RESOLVED_HEADER_SETS: resolvedHeaderSets, UNRESOLVED_HEADER_SETS: order.length - resolvedHeaderSets }
  };
  resolved.contract_hash = computeContractHash(resolved);
  return { ok: true, findings: [], resolved: resolved };
}

// Hash everything that, if changed, must trigger a one-time re-apply: headers, order, dropdown values/strictness,
// checkboxes, scope, plus the fmt/validation/contract versions. Independent of source key order.
function computeContractHash(resolved) {
  const material = {
    contract_version: resolved.contract_version,
    fmt_version: resolved.fmt_version,
    validation_version: resolved.validation_version,
    sheets: resolved.sheets.map(s => ({
      n: s.sheet_name, o: s.sheet_order, h: s.headers,
      d: Object.keys(s.ui_columns.dropdowns).sort().map(c => [c, s.ui_columns.dropdowns[c].values, s.ui_columns.dropdowns[c].strict]),
      c: s.ui_columns.checkboxes.slice().sort()
    }))
  };
  return djb2(stableStringify(material));
}

function resolveOrThrow(input) {
  const r = resolve(input);
  if (!r.ok) {
    const msg = r.findings.map(f => f.code + ': ' + f.detail).join('\n  ');
    throw new Error('sheets contract resolution failed:\n  ' + msg);
  }
  return r.resolved;
}

module.exports = {
  FMT_VERSION, VALIDATION_VERSION, CONTRACT_VERSION, EXPECTED_TAB_COUNT,
  loadRepo, buildEnumRegistry, resolveEnum, resolve, resolveOrThrow, computeContractHash, djb2, stableStringify
};

if (require.main === module) {
  const r = resolve();
  if (!r.ok) {
    console.log('===== sheets_contract_resolver — FAIL =====');
    r.findings.forEach(f => console.log('  FAIL  ' + f.code + ': ' + f.detail));
    console.log('\nDECLARED_TABS=' + ((loadRepo().contracts.sheet_order || []).length));
    process.exit(1);
  }
  const res = r.resolved;
  console.log('===== sheets_contract_resolver =====');
  console.log('DECLARED_TABS=' + res.summary.DECLARED_TABS);
  console.log('RESOLVED_HEADER_SETS=' + res.summary.RESOLVED_HEADER_SETS);
  console.log('UNRESOLVED_HEADER_SETS=' + res.summary.UNRESOLVED_HEADER_SETS);
  console.log('CONTRACT_HASH=' + res.contract_hash);
  let dd = 0, cb = 0;
  res.sheets.forEach(s => { dd += Object.keys(s.ui_columns.dropdowns).length; cb += s.ui_columns.checkboxes.length; });
  console.log('DROPDOWN_COLUMNS=' + dd + '  CHECKBOX_COLUMNS=' + cb + '  ENUMS=' + Object.keys(res.enums).length);
  process.exit(0);
}
