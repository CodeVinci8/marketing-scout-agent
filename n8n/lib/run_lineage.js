'use strict';
// run_lineage.js — RUN-LINEAGE-001. ONE resolver for "which run/request/owner does this row belong to?".
//
// This defect class has now cost five separate live failures, each one a silent zero-row report:
//   ISO-ARID-001  — WF10 strict-compared an absent agent_request_id            (28 -> 0 rows)
//   ISO-RUNID-001 — WF10 read source_run_id||agent_request_id; WF04 writes run_id (308 -> 0 rows)
//   data_mode     — WF10 strict-compared an empty data_mode                    (all rows dropped)
//   no_lineage    — report_gate reads ONLY source_run_id; queue rows carry run_id (row excluded)
//   region        — an inferred default overrode an explicit user scope        (fixed in scope_policy)
// Every one was the same shape: a consumer strict-compares a field its producer never populates, and the pipeline
// silently returns nothing while telling the user there is no data. The cure is not another local fallback in the
// next workflow — it is ONE resolver every consumer shares.
//
// Rules:
//   * an EMPTY optional field is not a mismatch when another canonical field carries the same identity;
//   * owner isolation is mandatory and is NEVER relaxed by this resolver;
//   * the current run may not be satisfied by an unrelated historical row;
//   * malformed/absent lineage fails safely AND is observable (resolved_from tells you what matched).
//
// Embeddable: unique rl*-prefixed names, no cross-lib require.

function rlStr(v) { return v == null ? '' : String(v).trim(); }
function rlLow(v) { return rlStr(v).toLowerCase(); }

// A source run id is `<request>::<source>::<slot>`; its family root is the request id.
function rlFamilyRoot(id) {
  var s = rlStr(id);
  var i = s.indexOf('::');
  return i > 0 ? s.slice(0, i) : s;
}

// resolveRunLineage(row) -> { source_run_id, agent_request_id, run_id, family_root, owner_user_id, data_mode,
//                             source_id, has_lineage, resolved_from }
// ONLY the explicitly supported canonical/legacy fields are consulted — in one documented order.
function resolveRunLineage(row) {
  row = row || {};
  var srid = rlStr(row.source_run_id);
  var arid = rlStr(row.agent_request_id);
  var rid = rlStr(row.run_id);
  var from = [];
  if (srid) from.push('source_run_id');
  if (arid) from.push('agent_request_id');
  if (rid) from.push('run_id');

  // The most specific run identity available. WF04's queue rows carry it ONLY in run_id.
  var sourceRun = srid || rid || '';
  // The request family: an explicit agent_request_id wins; otherwise derive it from whichever run id we have.
  var request = arid || rlFamilyRoot(srid || rid) || '';
  var family = rlFamilyRoot(sourceRun || request);

  return {
    source_run_id: sourceRun,
    agent_request_id: request,
    run_id: rid,
    family_root: family,
    owner_user_id: rlStr(row.owner_user_id),
    data_mode: rlLow(row.data_mode),
    source_id: rlStr(row.source_url || row.normalized_source_url || row.source_id || row.source_key),
    has_lineage: !!(sourceRun || request),
    resolved_from: from.join('|') || 'none'
  };
}

// Does `row` belong to the run identified by `filter`? `filter` may be a request id (req_x) or a source run id
// (req_x::website::a1); a row matches its own request family either way.
function rlFamilyMatch(rowLineage, filter) {
  var f = rlStr(filter);
  if (!f) return true;                       // no filter = no constraint
  if (!rowLineage || !rowLineage.has_lineage) return false;   // fail safe, but ONLY when genuinely absent
  var ids = [rowLineage.source_run_id, rowLineage.agent_request_id, rowLineage.run_id].filter(Boolean);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (id === f) return true;
    if (id.indexOf(f + '::') === 0) return true;   // row is a source run inside the requested family
    if (f.indexOf(id + '::') === 0) return true;   // filter is a source run inside the row's family
  }
  return false;
}

// Owner isolation. An unowned (system) row is visible to its own run; a row owned by SOMEONE ELSE never is.
function rlOwnerMatch(rowLineage, owner) {
  var o = rlStr(owner);
  if (!o) return true;
  var ro = rlStr(rowLineage && rowLineage.owner_user_id);
  if (!ro) return true;          // unowned/system row — isolation is enforced by the run family above
  return ro === o;
}

// The one predicate a consumer should call: does this row belong to THIS run, for THIS owner?
// opts: { source_run_id_filter, agent_request_id_filter, owner_user_id, data_mode_filter }
function rlRowInScope(row, opts) {
  opts = opts || {};
  var lin = resolveRunLineage(row);
  if (!rlOwnerMatch(lin, opts.owner_user_id)) return { in_scope: false, reason: 'owner_mismatch', lineage: lin };
  if (rlStr(opts.source_run_id_filter) && !rlFamilyMatch(lin, opts.source_run_id_filter)) return { in_scope: false, reason: 'source_run_mismatch', lineage: lin };
  if (rlStr(opts.agent_request_id_filter) && !rlFamilyMatch(lin, opts.agent_request_id_filter)) return { in_scope: false, reason: 'request_mismatch', lineage: lin };
  // ABSENT is not a MISMATCH: a row that never recorded a data_mode is not evidence of the wrong mode.
  if (rlStr(opts.data_mode_filter) && lin.data_mode && lin.data_mode !== rlLow(opts.data_mode_filter)) {
    return { in_scope: false, reason: 'data_mode_mismatch', lineage: lin };
  }
  return { in_scope: true, reason: '', lineage: lin };
}

module.exports = { resolveRunLineage, rlFamilyMatch, rlOwnerMatch, rlRowInScope, rlFamilyRoot };
