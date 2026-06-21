// lineage.js — canonical identity & lineage contract for the Marketing Scout pipeline (Stage 3 closure, DEC-147).
//
// One source connector run creates exactly ONE canonical `source_run_id`. That same value must travel through
// raw records, snapshots, source_health, analyzer outputs, aggregation lineage and reports. A workflow-local
// execution id (e.g. WF04's `wf04_<stamp>`) must NEVER silently replace it — it is recorded separately as
// `workflow_run_id`. Joins must key on `source_run_id` (with a documented, explicit fallback), never on an
// ambiguous alias.
//
// This module is the single source of truth for: the canonical field names, the join-key resolver, and the
// Sheets boolean/empty coercion that downstream quality gates depend on. The relevant n8n Code nodes embed an
// equivalent (drift-proven by the offline harness), and the offline suite imports this directly.
'use strict';

// Canonical identity fields enforced across workflows (§2.1).
var CANONICAL_IDENTITY_FIELDS = [
  'agent_request_id',   // the originating request (Telegram/operator). Stable across the whole fan-out.
  'source_run_id',      // ONE per source-connector execution. THE canonical join key for lineage.
  'workflow_run_id',    // workflow-local execution id; observability only, never a join key for lineage.
  'source_record_id',   // stable id of a single canonical raw record produced by a connector.
  'analysis_run_id',    // one per analyzer (WF08) execution.
  'aggregation_run_id', // one per aggregator (WF10) execution.
  'report_id',          // one per report (WF12) build.
  'data_mode'           // fixture | manual_test | live — gates report eligibility downstream.
];

function str(v) { return v == null ? '' : String(v).trim(); }

// Resolve the canonical join key for a row. Primary: source_run_id. Documented fallbacks (legacy rows only):
// run_id (older connectors aliased it), then agent_request_id. Never invents a value.
function canonicalSourceRunId(row) {
  row = row || {};
  return str(row.source_run_id) || str(row.run_id) || str(row.agent_request_id);
}

// Two rows are joinable on lineage iff they resolve to the same non-empty canonical source_run_id.
function sameSourceRun(a, b) {
  var ka = canonicalSourceRunId(a), kb = canonicalSourceRunId(b);
  return ka !== '' && ka === kb;
}

// Coerce a value read from Google Sheets to a strict boolean, preserving the explicit-empty case.
//  - real booleans pass through;
//  - the strings 'true'/'false'/'TRUE'/'FALSE'/'yes'/'no'/'1'/'0' map as expected;
//  - empty string / null / undefined => the provided default (undefined by default), so an UNSET cell is
//    distinguishable from an explicit FALSE. Quality gates that previously used `x !== false` silently treated
//    the Sheets string 'FALSE' as truthy — this is the fix for that class of defect (§2.3).
function coerceSheetBool(v, dflt) {
  if (v === true || v === false) return v;
  var s = str(v).toLowerCase();
  if (s === '') return dflt;
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;
  return dflt;
}

// Stamp a row with canonical identity fields without clobbering values already present.
function applyLineage(row, ids) {
  row = row || {}; ids = ids || {};
  for (var i = 0; i < CANONICAL_IDENTITY_FIELDS.length; i++) {
    var f = CANONICAL_IDENTITY_FIELDS[i];
    if (ids[f] !== undefined && (row[f] === undefined || row[f] === '' || row[f] === null)) row[f] = ids[f];
  }
  return row;
}

module.exports = {
  CANONICAL_IDENTITY_FIELDS: CANONICAL_IDENTITY_FIELDS,
  canonicalSourceRunId: canonicalSourceRunId,
  sameSourceRun: sameSourceRun,
  coerceSheetBool: coerceSheetBool,
  applyLineage: applyLineage
};
