'use strict';
// test_terminal_on_error.js — TERMINAL-ON-ERROR-001. A required report-chain stage that THROWS (live-observed:
// exec 1439/1444 — WF12 "Append agent_requests" hit a Google Sheets 429 and WF20 aborted at ~7/10, leaving the
// user with neither a report nor an honest failure) must now yield an HONEST terminal that names a verified reason,
// never says «✅ Готово», never claims a report/file was sent, and preserves the request for retry. Covers the
// canonical library behaviour AND the WF20 topology wiring (error outputs routed to the terminal handler).
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const P = require('../n8n/lib/progress_tracker.js');

A.section('deliveryErrorEdit — honest terminal for the real 429 (Google Sheets quota) failure');
let e429 = P.deliveryErrorEdit({ stage: 7, http_code: '429', error_message: 'The service is receiving too many requests from you' });
A.eq('429 -> run_failed', e429.delivery_state, 'run_failed');
A.ok('names the quota reason', /перегружен|лимит запросов/.test(e429.text));
A.ok('NEVER says «✅ Готово»', e429.text.indexOf('✅ Готово') < 0);
A.ok('NEVER claims a successful send (no ✅) and states NOT sent', e429.text.indexOf('✅') < 0 && /не отправлен/.test(e429.text));
A.ok('states the request is preserved for retry', /запрос сохранён|можно повторить/.test(e429.text));
A.eq('run_failed is terminal', e429.is_terminal, true);

A.section('deliveryErrorEdit — reason is DERIVED from the real error, never invented');
A.ok('timeout -> time-out reason', /время ожидания/.test(P.deliveryErrorEdit({ error_message: 'ETIMEDOUT' }).text));
A.ok('401 -> access reason', /доступ/.test(P.deliveryErrorEdit({ http_code: '401' }).text));
A.ok('unknown -> generic technical reason', /техническая ошибка/.test(P.deliveryErrorEdit({ error_message: 'boom' }).text));

A.section('run_failed is a declared, sticky terminal (a duplicate/late item cannot move off it)');
A.ok('run_failed classified terminal', P.isTerminalDelivery('run_failed'));
A.ok('run_failed is sticky', P.advanceDelivery('run_failed', 'processing').duplicate === true);
A.ok('run_failed cannot be overwritten by a success', P.advanceDelivery('run_failed', 'delivered').state === 'run_failed');
A.ok('run_failed declared in the state list', P.DELIVERY_STATES.indexOf('run_failed') >= 0);

A.section('a run_failed terminal must never collide with a success string');
A.ok('run_failed text != delivered text', P.deliveryText('run_failed') !== P.deliveryText('delivered'));

// ---- WF20 topology: the error outputs are actually wired to the honest terminal handler --------------------
A.section('WF20 topology — required report-chain children route their ERROR output to the terminal handler');
const wf20 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '20_agent_orchestrator.json'), 'utf8'));
const byName = {}; wf20.nodes.forEach(function (n) { byName[n.name] = n; });
A.ok('Progress: Failed (Terminal) node exists', !!byName['Progress: Failed (Terminal)']);
A.ok('Edit Progress (Failed) node exists', !!byName['Edit Progress (Failed)']);
['Run WF16 Quality Gate', 'Run WF08 Analyzer', 'Run WF10 Aggregator', 'Run WF12 Report'].forEach(function (nm) {
  A.eq(nm + ' uses continueErrorOutput', byName[nm] && byName[nm].onError, 'continueErrorOutput');
  const conn = (wf20.connections[nm] || {}).main || [];
  // output 0 = success path (must be present), output 1 = error path -> terminal handler
  const errTargets = ((conn[1] || []).map(function (e) { return e.node; }));
  A.ok(nm + ' error output -> Progress: Failed (Terminal)', errTargets.indexOf('Progress: Failed (Terminal)') >= 0);
  const okTargets = ((conn[0] || []).map(function (e) { return e.node; }));
  A.ok(nm + ' success output preserved (non-empty, not the terminal)', okTargets.length > 0 && okTargets.indexOf('Progress: Failed (Terminal)') < 0);
});
A.section('the terminal handler edits the ONE progress message');
const failConn = (wf20.connections['Progress: Failed (Terminal)'] || {}).main || [];
A.ok('Progress: Failed (Terminal) -> Edit Progress (Failed)', ((failConn[0] || []).map(function (e) { return e.node; })).indexOf('Edit Progress (Failed)') >= 0);
const failJs = (byName['Progress: Failed (Terminal)'].parameters || {}).jsCode || '';
// The DRIVER (last block after the embedded library) builds its terminal from deliveryErrorEdit and edits the
// same progress message — it derives the message from `ed.text` (the error edit), so the output can only be a
// run_failed terminal. (The embedded lib legitimately DEFINES every terminal function/string; assert on the driver.)
const driver = failJs.slice(failJs.lastIndexOf('deliveryErrorEdit('));
A.ok('driver builds the terminal from deliveryErrorEdit', /deliveryErrorEdit\(\{[^}]*error_message/.test(failJs));
A.ok('driver edits the ONE progress message from the error edit', /ed\.text/.test(driver) && /telegram_edit_body/.test(driver));

A.report('terminal-on-error');
