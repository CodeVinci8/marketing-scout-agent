'use strict';
// test_runtime_integrity.js — F-1 deployment/runtime integrity guard.
//
// Encodes two hazards that really happened on this installation and that NO existing signal catches:
//   H1 `n8n import:workflow` deactivates on import (sessions 70 and 71, active 17 -> 16).
//   H2 an active webhook-trigger workflow can have active=1 in the DB while webhook_entity is EMPTY and the
//      real path 404s. Session 70: the Telegram gateway was dead ~3h while /healthz said ok, inventory said
//      90/17 and RestartCount was 0 — Telegram was queuing real user messages the whole time.
const A = require('./_assert.js');
const RI = require('../tools/runtime_integrity_lib.js');

const WEBHOOK_NODE = { name: 'Telegram Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'ms-telegram-agent' } };
const RESPOND_NODE = { name: 'Respond 200', type: 'n8n-nodes-base.respondToWebhook', parameters: {} };
const CODE_NODE = { name: 'Lane', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return []' } };

const WF18 = { id: 'mslocf50ab8007ca', name: '18 — Telegram Agent Gateway', active: true, nodes: [WEBHOOK_NODE, RESPOND_NODE, CODE_NODE] };
const WF28 = { id: 'mswf28claudeanalyst', name: '28 — Claude Analyst', active: true, nodes: [CODE_NODE] };
const EXPECTED = { total: 90, active: 17, must_be_active: ['mslocf50ab8007ca', 'mswf28claudeanalyst'] };

const healthy = () => ({
  health_ok: true, total: 90, active: 17,
  workflows: [JSON.parse(JSON.stringify(WF18)), JSON.parse(JSON.stringify(WF28))],
  registered_webhooks: [{ method: 'POST', path: 'ms-telegram-agent', workflowId: 'mslocf50ab8007ca' }],
  webhook_post: { path: 'ms-telegram-agent', status: 200 }
});

A.section('node classification');
{
  A.ok('an active webhook-trigger workflow needs registration', RI.riNeedsWebhook(WF18));
  A.ok('a callable code-only workflow does not', !RI.riNeedsWebhook(WF28));
  A.ok('an INACTIVE trigger workflow does not', !RI.riNeedsWebhook(Object.assign({}, WF18, { active: false })));
  A.eq('webhook path extracted', RI.riWebhookPaths(WF18).join(','), 'ms-telegram-agent');
  A.eq('respondToWebhook is not a trigger', RI.riWebhookPaths({ nodes: [RESPOND_NODE] }).length, 0);
}

A.section('a fully healthy runtime passes');
{
  const v = RI.evaluateRuntimeIntegrity(healthy(), EXPECTED);
  A.ok('ok', v.ok);
  A.ok('no restart required', !v.restart_required);
  A.eq('no failures', v.failures.length, 0);
  A.eq('no warnings when a real POST was made', v.warnings.length, 0);
}

A.section('H2 — THE session-70 outage: active=1 but webhook_entity EMPTY');
{
  const p = healthy();
  p.registered_webhooks = [];              // exactly what was found: zero rows
  p.webhook_post = { path: 'ms-telegram-agent', status: 404 };
  const v = RI.evaluateRuntimeIntegrity(p, EXPECTED);
  A.ok('FAILS', !v.ok);
  A.ok('demands a restart', v.restart_required);
  const codes = v.failures.map((f) => f.code);
  A.ok('RUNTIME_WEBHOOK_MISSING raised', codes.indexOf('RUNTIME_WEBHOOK_MISSING') >= 0);
  A.ok('WEBHOOK_NOT_SERVED raised', codes.indexOf('WEBHOOK_NOT_SERVED') >= 0);
  A.ok('report names the remedy', RI.formatIntegrityReport(v).indexOf('restart') > 0);
}

A.section('H2 is caught even when every other signal looks green');
{
  const p = healthy();
  p.registered_webhooks = [];   // health ok, 90/17 correct, both workflows active — only registration is gone
  p.webhook_post = null;        // and nobody probed the real path
  const v = RI.evaluateRuntimeIntegrity(p, EXPECTED);
  A.ok('still FAILS', !v.ok);
  A.ok('still demands a restart', v.restart_required);
  A.ok('warns that no real POST was made', v.warnings.map((w) => w.code).indexOf('WEBHOOK_NOT_PROBED') >= 0);
}

A.section('H1 — import deactivated the workflow');
{
  const p = healthy();
  p.active = 16;
  p.workflows[1].active = false;   // WF28 as actually observed after import
  const v = RI.evaluateRuntimeIntegrity(p, EXPECTED);
  A.ok('FAILS', !v.ok);
  const codes = v.failures.map((f) => f.code);
  A.ok('ACTIVE_COUNT_MISMATCH raised', codes.indexOf('ACTIVE_COUNT_MISMATCH') >= 0);
  A.ok('DEACTIVATED_BY_IMPORT names the workflow', v.failures.some((f) => f.code === 'DEACTIVATED_BY_IMPORT' && f.detail.indexOf('mswf28claudeanalyst') >= 0));
  A.ok('remedy is stated', v.failures.some((f) => f.detail.indexOf('update:workflow --active=true') >= 0));
  A.ok('no restart needed for a pure deactivation', !v.restart_required);
}

A.section('other regressions');
{
  let v = RI.evaluateRuntimeIntegrity(Object.assign(healthy(), { health_ok: false }), EXPECTED);
  A.ok('unhealthy n8n fails', v.failures.map((f) => f.code).indexOf('HEALTH_NOT_OK') >= 0);

  v = RI.evaluateRuntimeIntegrity(Object.assign(healthy(), { total: 89 }), EXPECTED);
  A.ok('a lost workflow fails', v.failures.map((f) => f.code).indexOf('INVENTORY_TOTAL_MISMATCH') >= 0);

  const p = healthy();
  p.registered_webhooks = [{ method: 'POST', path: 'ms-telegram-agent', workflowId: 'someOtherWorkflow' }];
  v = RI.evaluateRuntimeIntegrity(p, EXPECTED);
  A.ok('a hijacked webhook path fails', v.failures.map((f) => f.code).indexOf('WEBHOOK_BOUND_TO_WRONG_WORKFLOW') >= 0);

  // A 200 is not required — Telegram ingress legitimately rejects an empty body. Only 404 means "not served".
  const p2 = healthy();
  p2.webhook_post = { path: 'ms-telegram-agent', status: 403 };
  v = RI.evaluateRuntimeIntegrity(p2, EXPECTED);
  A.ok('a non-404 rejection still counts as served', v.ok);
}

A.report('runtime-integrity');
