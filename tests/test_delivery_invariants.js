'use strict';
// test_delivery_invariants.js — items 4 & 5. Proves the delivery/terminal invariants hold on the CURRENT canonical
// libraries + generated workflows:
//  (4) run_failed is a durable sticky terminal; progress can never remain mid-run; a used approval keyboard is
//      disabled; a missing origin fails CLOSED (never falls back to the owner);
//  (5) terminal success only after BOTH report + XLSX are confirmed; a failed XLSX never yields «✅ Готово»;
//      retry re-sends ONLY the missing artifact.
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const P = require('../n8n/lib/progress_tracker.js');

function wf(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', name), 'utf8')); }
function nodeByName(w, n) { return (w.nodes || []).find(function (x) { return x.name === n; }); }
function mainTargets(w, n, idx) { const c = (w.connections[n] || {}).main || []; return ((c[idx] || []).map(function (e) { return e.node; })); }

// ---- Item 5: delivery ordering — terminal 'delivered' requires BOTH message ids -----------------------------
A.section('delivery ordering: «✅ Готово …отправлены» only when BOTH report + XLSX ids are confirmed');
var noDoc = P.deliveryTerminalEdit({ report_message_id: '695', document_message_id: '', xlsx_expected: true, attempts: 2, max_attempts: 2, analysis: { final_state: 'completed', has_analysis: true, records: 2 } });
A.ok('report sent but XLSX never delivered -> document_failed, NOT delivered', noDoc.delivery_state === 'document_failed');
A.ok('a missing XLSX NEVER produces the success line', noDoc.text.indexOf('✅ Готово. Отчёт и Excel-файл отправлены.') < 0);
var retrying = P.deliveryTerminalEdit({ report_message_id: '695', document_message_id: '', xlsx_expected: true, attempts: 1, max_attempts: 2, analysis: { final_state: 'completed', has_analysis: true, records: 2 } });
A.ok('XLSX attempt remaining -> document_retrying (not terminal, not delivered)', retrying.delivery_state === 'document_retrying' && retrying.is_terminal === false);
var both = P.deliveryTerminalEdit({ report_message_id: '695', document_message_id: '696', xlsx_expected: true, analysis: { final_state: 'completed', has_analysis: true, records: 2 }, ai: { expected: false } });
A.eq('both ids confirmed -> delivered', both.delivery_state, 'delivered');

A.section('WF20 wiring: report send precedes XLSX; the terminal is downstream of the confirmed XLSX send; retry re-sends only the file');
var w20 = wf('20_agent_orchestrator.json');
A.ok('Send Telegram Report -> Progress: Report Sent (report confirmed first)', mainTargets(w20, 'Send Telegram Report', 0).indexOf('Progress: Report Sent') >= 0);
A.ok('XLSX Sent? -> Progress: Done (terminal only after the send resolves)', mainTargets(w20, 'XLSX Sent?', 0).indexOf('Progress: Done') >= 0);
A.ok('XLSX Sent? failure -> Progress: Retrying (retry path), not the terminal success', mainTargets(w20, 'XLSX Sent?', 1).indexOf('Progress: Retrying') >= 0);
A.ok('the retry sends the DOCUMENT again (Send Report XLSX Retry), never the report', !!nodeByName(w20, 'Send Report XLSX Retry') && mainTargets(w20, 'Send Report XLSX Retry', 0).indexOf('Progress: Done') >= 0);
A.ok('retry node is a sendDocument, not a report sendMessage', /sendDocument/.test(JSON.stringify(nodeByName(w20, 'Send Report XLSX Retry').parameters)));

// ---- Item 4: run_failed durable + sticky; progress never stuck mid-run --------------------------------------
A.section('run_failed is a durable, sticky terminal (progress can never remain at an intermediate stage)');
A.ok('run_failed is terminal', P.isTerminalDelivery('run_failed'));
A.ok('run_failed cannot be moved backward or overwritten by success', P.advanceDelivery('run_failed', 'delivered').state === 'run_failed');
A.ok('every required report-chain child routes its error to the honest terminal (no stuck mid-run)',
  ['Run WF16 Quality Gate', 'Run WF08 Analyzer', 'Run WF10 Aggregator', 'Run WF12 Report'].every(function (n) {
    return (nodeByName(w20, n) || {}).onError === 'continueErrorOutput' && mainTargets(w20, n, 1).indexOf('Progress: Failed (Terminal)') >= 0;
  }));

// ---- Item 4: missing origin fails CLOSED — never a hardcoded owner fallback ----------------------------------
A.section('missing origin fails closed: delivery chat comes from the request/gate, never a hardcoded owner');
var progDone = nodeByName(w20, 'Progress: Done');
var pdJs = (progDone.parameters || {}).jsCode || '';
A.ok('terminal edit is SKIPPED when there is no progress message id (no blind send)', /if\(!mid\)\{return \[\{json:\{progress_skipped:true/.test(pdJs));
A.ok('chat is read from the approved request/gate, not a constant owner id', /Approval & Budget Gate.*request.*chat_id/.test(pdJs) || /chat=String\(\(g\.request/.test(pdJs));
// no delivery node hardcodes an owner chat id or an owner-fallback env
A.ok('no MS_OWNER-style owner-chat env fallback', !/MS_OWNER/.test(JSON.stringify(w20)));
// the ACTUAL delivery-chat resolutions (report + XLSX + terminal) must read request.chat_id and NEVER
// fall back to owner_user_id (a `|| ...owner_user_id` operand right after the chat expression).
// collect every line that assigns `chat` — the delivery-chat resolution may span a couple of try statements.
function chatLines(node) {
  const js = (nodeByName(w20, node).parameters || {}).jsCode || '';
  return js.split('\n').filter(function (l) { return /(^|[^_a-zA-Z])chat\s*=/.test(l); }).join(' ~ ');
}
['Build Delivery Outbox', 'Build Report XLSX', 'Progress: Done', 'Progress: Failed (Terminal)'].forEach(function (n) {
  const lines = chatLines(n);
  A.ok(n + ': chat resolves from request.chat_id', /chat_id/.test(lines));
  A.ok(n + ': chat NEVER falls back to owner_user_id', !/\|\|\s*[a-zA-Z_.]*owner_user_id/.test(lines));
});
// report and XLSX use the SAME origin resolution (both request.chat_id, neither owner)
A.ok('report and XLSX use the same request-origin chat (no owner)', /request.*chat_id/.test(chatLines('Build Report XLSX')) && !/owner_user_id/.test(chatLines('Build Report XLSX')));

// ---- Item 4: used approval keyboard is disabled -------------------------------------------------------------
A.section('a used approval keyboard is disabled (editMessageReplyMarkup), gated + fail-open');
var w18 = wf('18_telegram_agent_gateway.json');
var diskbd = nodeByName(w18, 'Disable Used Keyboard');
A.ok('Disable Used Keyboard node exists and uses editMessageReplyMarkup', !!diskbd && /editMessageReplyMarkup/.test(JSON.stringify(diskbd.parameters)));
A.ok('keyboard removal is fail-open (never blocks dispatch)', diskbd.onError === 'continueRegularOutput');
A.ok('it is GATED on edit_markup_body (fires only on an accepted approve)', /edit_markup_body/.test(JSON.stringify((nodeByName(w18, 'Disable Keyboard?') || {}).parameters)));
A.ok('Command Lane -> Disable Keyboard? -> Disable Used Keyboard', mainTargets(w18, 'Command Lane', 0).indexOf('Disable Keyboard?') >= 0 && mainTargets(w18, 'Disable Keyboard?', 0).indexOf('Disable Used Keyboard') >= 0);
A.ok('the approve path emits an empty-inline-keyboard edit_markup_body', /edit_markup_body.*inline_keyboard:\[\]/.test((nodeByName(w18, 'Command Lane').parameters || {}).jsCode || ''));

A.report('delivery-invariants');
