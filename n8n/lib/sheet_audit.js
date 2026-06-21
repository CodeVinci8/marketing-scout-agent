'use strict';
// sheet_audit.js — runtime Google Sheets content auditor + before/after request verifier (Sections 17 / 18).
//
// READ-ONLY: never mutates a sheet. Given a tab's declared contract + actual rows, it checks required columns,
// scope columns, owner isolation and formula-injection neutralization. The before/after verifier proves a run
// wrote exactly the rows it claimed for THIS request and touched no other owner/request (no cross-contamination).
// Pure + deterministic, $0, offline. Self-contained (no cross-require) so it embeds into a workflow if needed.

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function arr(v) { return Array.isArray(v) ? v : []; }
const DANGEROUS_LEAD = /^[=+\-@\t\r]/;
function isFiniteNumberLike(v) { return /^[+\-]?(\d+\.?\d*|\.\d+)$/.test(str(v).trim()); }
// a cell is unsafe if it starts with a formula lead char AND is not a plain finite number AND is not neutralized
function isUnsafeCell(v) { const s = str(v); return DANGEROUS_LEAD.test(s) && !isFiniteNumberLike(s) && s.charAt(0) !== "'"; }

// auditRows(tabName, rows, contract, opts) -> { ok, findings, row_count, ... }
function auditRows(tabName, rows, contract, opts) {
  opts = opts || {};
  const tabs = (contract && contract.tabs) || {};
  const spec = tabs[tabName];
  const findings = [];
  if (!spec) return { ok: false, findings: [{ kind: 'undeclared_tab', tab: tabName }], row_count: arr(rows).length };
  const required = arr(spec.required_columns);
  let missing_columns = 0, owner_violations = 0, request_violations = 0, injection_cells = 0, foreign_rows = 0;

  arr(rows).forEach((row, i) => {
    row = row || {};
    required.forEach(c => { if (!(c in row) || str(row[c]) === '') { missing_columns++; findings.push({ kind: 'missing_required', tab: tabName, row: i, column: c }); } });
    if (spec.owner_scoped && str(row.owner_user_id) === '') { owner_violations++; findings.push({ kind: 'missing_owner_scope', tab: tabName, row: i }); }
    if (spec.request_scoped && str(row.agent_request_id) === '') { request_violations++; findings.push({ kind: 'missing_request_scope', tab: tabName, row: i }); }
    if (opts.owner_user_id != null && spec.owner_scoped && str(row.owner_user_id) !== '' && str(row.owner_user_id) !== str(opts.owner_user_id)) { foreign_rows++; findings.push({ kind: 'foreign_owner_row', tab: tabName, row: i, owner: str(row.owner_user_id) }); }
    Object.keys(row).forEach(k => { if (isUnsafeCell(row[k])) { injection_cells++; findings.push({ kind: 'unneutralized_formula', tab: tabName, row: i, column: k, value: str(row[k]).slice(0, 24) }); } });
  });

  return {
    ok: findings.length === 0, tab: tabName, row_count: arr(rows).length, findings: findings,
    missing_columns: missing_columns, owner_violations: owner_violations, request_violations: request_violations,
    injection_cells: injection_cells, foreign_rows: foreign_rows
  };
}

// auditAll(snapshot, contract, opts) -> audit every tab present in the snapshot ({tab: rows[]})
function auditAll(snapshot, contract, opts) {
  snapshot = snapshot || {};
  const per_tab = {}; let ok = true; let total_findings = 0;
  Object.keys(snapshot).forEach(tab => { const r = auditRows(tab, snapshot[tab], contract, opts); per_tab[tab] = r; if (!r.ok) ok = false; total_findings += r.findings.length; });
  return { ok: ok, total_findings: total_findings, per_tab: per_tab };
}

// before/after request verification: prove the run added rows for THIS request and changed nothing for others.
// rowsBefore/rowsAfter are the tab's rows at the two checkpoints. Identity is the row's agent_request_id.
function verifyRequest(tabName, rowsBefore, rowsAfter, opts) {
  opts = opts || {};
  const arid = str(opts.agent_request_id);
  const owner = opts.owner_user_id != null ? str(opts.owner_user_id) : null;
  const before = arr(rowsBefore), after = arr(rowsAfter);
  const mine = (r) => str((r || {}).agent_request_id) === arid;
  const others = (r) => str((r || {}).agent_request_id) !== arid;
  const beforeMine = before.filter(mine).length, afterMine = after.filter(mine).length;
  const beforeOthers = before.filter(others), afterOthers = after.filter(others);
  // foreign rows must be byte-identical before vs after (no other request/owner touched)
  const foreignBefore = JSON.stringify(beforeOthers);
  const foreignAfter = JSON.stringify(afterOthers);
  const foreign_untouched = foreignBefore === foreignAfter;
  let foreign_owner_leak = false;
  if (owner != null) foreign_owner_leak = after.some(r => mine(r) && str(r.owner_user_id) !== owner && str(r.owner_user_id) !== '');
  const added = afterMine - beforeMine;
  const expected = opts.expected_added;
  const added_as_expected = expected == null ? added >= 0 : added === expected;
  return {
    tab: tabName, agent_request_id: arid, rows_added_for_request: added,
    request_rows_before: beforeMine, request_rows_after: afterMine,
    foreign_rows_untouched: foreign_untouched, foreign_owner_leak: foreign_owner_leak,
    added_as_expected: added_as_expected,
    ok: foreign_untouched && !foreign_owner_leak && added_as_expected
  };
}

// verify a set of tabs at once for one request
function verifyRun(beforeSnap, afterSnap, opts) {
  beforeSnap = beforeSnap || {}; afterSnap = afterSnap || {};
  const tabs = Object.keys(afterSnap);
  const per_tab = {}; let ok = true;
  tabs.forEach(tab => { const v = verifyRequest(tab, beforeSnap[tab] || [], afterSnap[tab] || [], opts); per_tab[tab] = v; if (!v.ok) ok = false; });
  return { ok: ok, per_tab: per_tab };
}

module.exports = { auditRows, auditAll, verifyRequest, verifyRun, isUnsafeCell };
