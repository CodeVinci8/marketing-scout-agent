'use strict';
// retention_policy.js — data retention with hard protections + dry-run-by-default cleanup (Section 14).
//
// Classifies stored rows as KEEP vs eligible-for-deletion using each tab's declared retention class/days from the
// sheets contract. Deletion is NEVER performed by default: plan() runs dry-run unless enable_delete===true. Hard
// protections always win: active requests, recent reports, evidence/attachments bound to a retained report,
// current monitoring baselines, durable user preferences, and unsent outbox entries are never deletable.
// Pure + deterministic, $0, offline. Self-contained (no cross-require).

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function num(v) { const n = Number(v); return isFinite(n) ? n : null; }

function ageDays(rowTs, now) {
  const t = Date.parse(str(rowTs)); const n = Date.parse(str(now));
  if (isNaN(t) || isNaN(n)) return null;
  return (n - t) / 86400000;
}
// best-effort timestamp pick from common columns
function rowTimestamp(row) {
  return str(row.created_at || row.generated_at || row.ts || row.updated_at || row.collected_at || row.added_at || row.last_checked_at || '');
}

// Is this row PROTECTED regardless of age? ctx carries the live sets that confer protection.
function isProtected(tabName, row, spec, ctx) {
  const when = arr(spec.protected_when);
  ctx = ctx || {};
  // GLOBAL safety floor (applies to every tab regardless of protected_when): a row belonging to an active
  // request, or referencing a report we are retaining, is never deletable. Prevents deleting in-flight work or
  // the evidence/attachments behind a kept report.
  if (str(row.agent_request_id) !== '' && (ctx.active_request_ids || {})[str(row.agent_request_id)]) return { protected: true, reason: 'request_active' };
  if (str(row.report_id) !== '' && (ctx.retained_report_ids || {})[str(row.report_id)]) return { protected: true, reason: 'report_retained' };
  if (when.indexOf('always') >= 0) return { protected: true, reason: spec.retention_class };
  if (when.indexOf('recent_report') >= 0) {
    const age = ageDays(rowTimestamp(row), ctx.now);
    if (age != null && age <= (ctx.recent_report_days || 30)) return { protected: true, reason: 'recent_report' };
    if ((ctx.retained_report_ids || {})[str(row.report_id)]) return { protected: true, reason: 'report_retained' };
  }
  if (when.indexOf('monitoring_baseline') >= 0) {
    // a tracked_sources / vk_post_state row that is the CURRENT baseline (active / latest) is never deleted
    if (low(row.status) === 'active' || low(row.status) === 'paused' || (ctx.baseline_keys || {})[str(row.source_id || row.post_id)]) return { protected: true, reason: 'monitoring_baseline' };
  }
  if (when.indexOf('unsent') >= 0 && low(row.send_status) !== 'sent') return { protected: true, reason: 'unsent_outbox' };
  return { protected: false, reason: '' };
}

// classify rows of ONE tab. Returns keep/eligible with reasons. Never deletes here (pure classification).
function classifyTab(tabName, rows, contract, ctx) {
  ctx = ctx || {};
  const spec = ((contract && contract.tabs) || {})[tabName];
  if (!spec) return { tab: tabName, error: 'undeclared_tab', keep: arr(rows), eligible: [] };
  const cls = spec.retention_class;
  const keep = [], eligible = [];
  arr(rows).forEach((row, i) => {
    row = row || {};
    // durable/permanent classes are never age-eligible
    if (cls === 'durable' || cls === 'permanent') { keep.push({ row: i, reason: cls }); return; }
    const prot = isProtected(tabName, row, spec, ctx);
    if (prot.protected) { keep.push({ row: i, reason: 'protected:' + prot.reason }); return; }
    const days = num(spec.retention_days);
    const age = ageDays(rowTimestamp(row), ctx.now);
    if (days == null) { keep.push({ row: i, reason: 'no_retention_window' }); return; }
    if (age == null) { keep.push({ row: i, reason: 'no_timestamp' }); return; }  // never delete an undateable row
    if (age > days) eligible.push({ row: i, reason: 'age_' + Math.floor(age) + 'd_over_' + days + 'd', age_days: Math.floor(age) });
    else keep.push({ row: i, reason: 'within_window' });
  });
  return { tab: tabName, retention_class: cls, retention_days: spec.retention_days, kept: keep.length, eligible: eligible, eligible_count: eligible.length };
}

// plan(snapshot, contract, ctx, opts) -> retention plan. DRY-RUN unless opts.enable_delete === true.
function plan(snapshot, contract, ctx, opts) {
  snapshot = snapshot || {}; opts = opts || {};
  const enable = opts.enable_delete === true;
  const per_tab = {}; let total_eligible = 0, total_kept = 0;
  Object.keys(snapshot).forEach(tab => {
    const c = classifyTab(tab, snapshot[tab], contract, ctx);
    per_tab[tab] = c;
    total_eligible += (c.eligible_count || 0);
    total_kept += (c.kept || 0);
  });
  return {
    dry_run: !enable,
    enable_delete: enable,
    total_eligible_for_deletion: total_eligible,
    total_kept: total_kept,
    // deletions are only ever populated when explicitly enabled; default is a safe audit-only plan
    would_delete: enable ? per_tab : {},
    audit: per_tab,
    note: enable ? 'DELETE ENABLED — caller may remove the eligible rows' : 'dry-run: no deletion; set enable_delete=true (operator confirmation) to act'
  };
}

module.exports = { ageDays, rowTimestamp, isProtected, classifyTab, plan };
