'use strict';
// runtime_integrity_lib.js — canonical, PURE evaluator for post-deploy runtime integrity.
//
// Two real production hazards, both observed on this installation, motivate this guard. Neither is visible to
// `/healthz`, to the workflow inventory, or to `RestartCount`:
//
//   H1 DEACTIVATED_BY_IMPORT — `n8n import:workflow` DEACTIVATES the workflow it imports. Observed twice
//      (sessions 70 and 71: active 17 -> 16). If the deploy stops there, a callable/active workflow is silently
//      off. Guard: the active count and the per-workflow active flag must be re-asserted AFTER import.
//
//   H2 RUNTIME_WEBHOOK_MISSING — a CLI import does not notify the RUNNING n8n process. An active webhook-trigger
//      workflow can therefore have `active=1` in the DB while `webhook_entity` holds NO row and the real path
//      returns 404. Observed in session 70: the Telegram gateway was dead for ~3h while `/healthz` returned ok,
//      the inventory read 90/17 and RestartCount was 0. Telegram had been queuing real user messages. Only a
//      registration check plus a real POST exposes it; the fix is a controlled restart.
//
// Pure so it is unit-testable without a live n8n: the CLI collects the probe, this decides the verdict.

// A workflow needs a runtime webhook registration when it is ACTIVE and owns a webhook-trigger node.
function riNeedsWebhook(wf) {
  if (!wf || !wf.active) return false;
  return (wf.nodes || []).some(function (n) {
    return String(n.type || '').toLowerCase().indexOf('webhook') >= 0 && String(n.type || '').indexOf('respond') < 0;
  });
}

// riWebhookPaths(wf) -> the paths this workflow's webhook nodes should serve.
function riWebhookPaths(wf) {
  return (wf.nodes || [])
    .filter(function (n) { return String(n.type || '') === 'n8n-nodes-base.webhook'; })
    .map(function (n) { return String((n.parameters || {}).path || ''); })
    .filter(Boolean);
}

// evaluateRuntimeIntegrity(probe, expected) -> { ok, restart_required, failures[], warnings[] }
//
// probe = {
//   health_ok, total, active,
//   workflows:        [{ id, name, active, nodes:[...] }]   (fresh exports of the workflows that matter)
//   registered_webhooks: [{ method, path, workflowId }]     (webhook_entity rows)
//   webhook_post:     { path, status }                      (a REAL POST at the ingress path; null if not probed)
// }
// expected = { total, active, must_be_active: [ids] }
function evaluateRuntimeIntegrity(probe, expected) {
  probe = probe || {}; expected = expected || {};
  var failures = [], warnings = [], restart = false;

  if (!probe.health_ok) failures.push({ code: 'HEALTH_NOT_OK', detail: 'n8n /healthz did not report status ok' });

  if (expected.total != null && Number(probe.total) !== Number(expected.total)) {
    failures.push({ code: 'INVENTORY_TOTAL_MISMATCH', detail: 'expected ' + expected.total + ' workflows, found ' + probe.total });
  }
  if (expected.active != null && Number(probe.active) !== Number(expected.active)) {
    failures.push({ code: 'ACTIVE_COUNT_MISMATCH', detail: 'expected ' + expected.active + ' active, found ' + probe.active +
      ' — `n8n import:workflow` deactivates on import; republish with `update:workflow --active=true`' });
  }

  var wfs = probe.workflows || [];
  (expected.must_be_active || []).forEach(function (id) {
    var wf = wfs.filter(function (w) { return String(w.id) === String(id); })[0];
    if (!wf) { warnings.push({ code: 'WORKFLOW_NOT_PROBED', detail: String(id) }); return; }
    if (!wf.active) failures.push({ code: 'DEACTIVATED_BY_IMPORT', detail: String(id) + ' (' + (wf.name || '') + ') is INACTIVE but must be active' });
  });

  // H2 — an active webhook-trigger workflow with no runtime registration.
  var reg = probe.registered_webhooks || [];
  wfs.filter(riNeedsWebhook).forEach(function (wf) {
    riWebhookPaths(wf).forEach(function (p) {
      var hit = reg.filter(function (r) { return String(r.path) === p; })[0];
      if (!hit) {
        restart = true;
        failures.push({ code: 'RUNTIME_WEBHOOK_MISSING', detail: 'workflow ' + wf.id + ' is active and owns webhook path "' + p +
          '" but webhook_entity has NO row — the running process never re-registered it. A controlled n8n restart is required.' });
      } else if (String(hit.workflowId) !== String(wf.id)) {
        failures.push({ code: 'WEBHOOK_BOUND_TO_WRONG_WORKFLOW', detail: 'path "' + p + '" is registered to ' + hit.workflowId + ', expected ' + wf.id });
      }
    });
  });

  // A real request is the only proof the path is actually served.
  var post = probe.webhook_post;
  if (post && Number(post.status) === 404) {
    restart = true;
    failures.push({ code: 'WEBHOOK_NOT_SERVED', detail: 'POST ' + post.path + ' returned 404 — the ingress is dead even though health/inventory look green.' });
  }
  if (!post) warnings.push({ code: 'WEBHOOK_NOT_PROBED', detail: 'no real POST was made; registration alone is not proof of service' });

  return { ok: failures.length === 0, restart_required: restart, failures: failures, warnings: warnings };
}

function formatIntegrityReport(v) {
  var lines = [];
  lines.push(v.ok ? 'RUNTIME INTEGRITY: OK' : 'RUNTIME INTEGRITY: FAIL (' + v.failures.length + ')');
  v.failures.forEach(function (f) { lines.push('  FAIL ' + f.code + ': ' + f.detail); });
  v.warnings.forEach(function (w) { lines.push('  warn ' + w.code + ': ' + w.detail); });
  if (v.restart_required) lines.push('  ACTION REQUIRED: controlled `docker restart n8n-n8n-1`, then re-run this check.');
  return lines.join('\n');
}

module.exports = { evaluateRuntimeIntegrity, formatIntegrityReport, riNeedsWebhook, riWebhookPaths };
