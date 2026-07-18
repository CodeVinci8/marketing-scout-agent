'use strict';
// §9 PROGRESS-ACK-001 / PROGRESS-EDIT-001 — one immediate ack per accepted update, ONE editable progress
// message advanced through real stage transitions, throttled, terminal ✅, edit-failure fallback. $0, offline.
const fs = require('fs');
const path = require('path');
const A = require('./_assert');
const H = require('./wf_harness');
const PT = require('../n8n/lib/progress_tracker.js');

const WF_DIR = path.join(__dirname, '..', 'n8n', 'workflows');
const WF18 = JSON.parse(fs.readFileSync(path.join(WF_DIR, '18_telegram_agent_gateway.json'), 'utf8'));
const WF20 = JSON.parse(fs.readFileSync(path.join(WF_DIR, '20_agent_orchestrator.json'), 'utf8'));

function edges(wf) {
  const out = [];
  for (const [from, conn] of Object.entries(wf.connections || {})) {
    (conn.main || []).forEach((arr, oi) => (arr || []).forEach(c => out.push({ from, to: c.node, out: oi })));
  }
  return out;
}
function hasEdge(wf, from, to, oi) { return edges(wf).some(e => e.from === from && e.to === to && (oi == null || e.out === oi)); }

A.section('progress_tracker lifecycle — one message, same id edited, throttled, terminal states');
{
  let st = PT.initProgress({ agent_request_id: 'r1', chat_id: 'c1' });
  const first = PT.advance(st, 2, { now: 't0' });
  A.eq('first transition CREATES one message', first.action, 'create');
  st = PT.setMessageId(first.state, '77');
  const second = PT.advance(st, 4, { now: 't1' });
  A.eq('later transitions EDIT the same message', second.action, 'edit');
  A.eq('message_id preserved across edits', second.state.message_id, '77');
  const repeat = PT.advance(second.state, 4, { now: 't2' });
  A.eq('re-emitting the same stage is a no-op (no spam)', repeat.action, 'skip');
  A.eq('going backwards never re-sends', PT.advance(second.state, 2, {}).action, 'skip');
  const done = PT.advance(second.state, PT.TOTAL, { now: 't3' });
  A.eq('final stage completes the state', done.state.status, 'complete');
  const failed = PT.fail(second.state, 5, 'источник недоступен', { now: 't4' });
  A.eq('failure EDITS the same message', failed.action, 'edit');
  A.ok('failure text names the stage in Russian', failed.text.indexOf('Сбой на этапе') >= 0);
  A.eq('failed state is terminal', failed.state.status, 'failed');
  A.eq('a failed run never advances again', PT.advance(failed.state, 6, {}).action, 'skip');
  const cancelled = PT.cancel(second.state, { now: 't5' });
  A.ok('cancel rewrites the message', cancelled.text.indexOf('⛔ Отменено') >= 0);
  // edit-failure fallback: clear the id so the NEXT update creates a fresh message
  const fb = PT.applyEditResult(second.state, false);
  A.eq('failed edit falls back to a fresh message', fb.message_id, '');
  A.eq('fallback is counted', fb.fallback_count, 1);
  A.eq('next action after fallback is create', PT.advance(Object.assign({}, fb, { stage: 4 }), 5, {}).action, 'create');
}

A.section('WF18 §9 — immediate ack per accepted update (post-claim, exactly once)');
{
  const run = H.makeRun();
  H.inject(run, 'Resolve Winner', [{ parsed: { kind: 'request', chat_id: 'c1', user_id: 'u1', text: 'Найди брокеров' }, gate: {} }]);
  const rq = H.runCodeNode(run, WF18, 'Command Lane', [{ json: {} }])[0].json;
  A.eq('a new business request gets an immediate ack', rq.lane, 'request_ack');
  A.ok('ack is Russian and generic (no enums)', JSON.parse(rq.telegram_send_body).text.indexOf('Принял запрос') >= 0);
  A.eq('the request still continues to the heavy path', rq.continue_heavy, true);
  const run2 = H.makeRun();
  H.inject(run2, 'Resolve Winner', [{ parsed: { kind: 'callback', chat_id: 'c1', user_id: 'u1', callback_data: 'approve:req_1' }, gate: { callback_query_id: 'cbq9' } }]);
  const ap = H.runCodeNode(run2, WF18, 'Command Lane', [{ json: {} }])[0].json;
  A.eq('an approve callback gets an immediate ack', ap.lane, 'approve_ack');
  A.ok('approve ack mentions launching the analysis', JSON.parse(ap.telegram_send_body).text.indexOf('Запускаю анализ') >= 0);
  A.ok('approve ack also answers the callback (spinner cleared)', JSON.parse(ap.answer_callback_body).callback_query_id === 'cbq9');
  const run3 = H.makeRun();
  H.inject(run3, 'Resolve Winner', [{ parsed: { kind: 'callback', chat_id: 'c1', user_id: 'u1', callback_data: 'reject:req_1' }, gate: { callback_query_id: 'cbq9' } }]);
  const rj = H.runCodeNode(run3, WF18, 'Command Lane', [{ json: {} }])[0].json;
  A.eq('a reject callback gets NO premature launch ack', rj.has_reply, false);
  A.ok('callback ack branch is wired', hasEdge(WF18, 'Command Lane', 'Callback Ack Needed?') && hasEdge(WF18, 'Callback Ack Needed?', 'Answer Command Callback', 0));
  // TELEGRAM-TOLERANT-001: a failed spinner-clear / ack send must NEVER abort the approve→analysis dispatch.
  // Answer Command Callback runs on a parallel branch; Send Command Reply feeds Continue Heavy Path? — both must
  // be fail-open so a stale callback id or a Telegram hiccup cannot cancel a launched analysis (live exec 403).
  const ack = WF18.nodes.find(n => n.name === 'Answer Command Callback');
  const cmdReply = WF18.nodes.find(n => n.name === 'Send Command Reply');
  A.eq('Answer Command Callback is fail-open (never aborts dispatch)', ack.onError, 'continueRegularOutput');
  A.eq('Send Command Reply is fail-open (dispatch survives a failed ack send)', cmdReply.onError, 'continueRegularOutput');
  A.eq('the approve/cancel dispatch continues past the command reply', hasEdge(WF18, 'Send Command Reply', 'Continue Heavy Path?'), true);
}

A.section('WF20 §9 — the ONE progress message is edited on the real main line');
{
  A.ok('progress message created once at gate-allowed', hasEdge(WF20, 'Gate Allowed?', 'Build Progress Update', 0) && hasEdge(WF20, 'Build Progress Update', 'Send Progress'));
  const sp = WF20.nodes.find(n => n.name === 'Send Progress');
  A.eq('progress send failure never kills the run', sp.onError, 'continueRegularOutput');
  // main line passes through the stage editors in order
  A.ok('quality-gate edit precedes WF16', hasEdge(WF20, 'Progress: Quality Gate', 'Edit Progress (Quality Gate)') && hasEdge(WF20, 'Edit Progress (Quality Gate)', 'Run WF16 Quality Gate'));
  A.ok('analysis edit precedes WF08', hasEdge(WF20, 'Run WF16 Quality Gate', 'Progress: Analysis') && hasEdge(WF20, 'Edit Progress (Analysis)', 'Run WF08 Analyzer'));
  A.ok('comparison edit precedes WF10', hasEdge(WF20, 'Run WF08 Analyzer', 'Progress: Comparison') && hasEdge(WF20, 'Edit Progress (Comparison)', 'Run WF10 Aggregator'));
  A.ok('report edit precedes WF12', hasEdge(WF20, 'Run WF10 Aggregator', 'Progress: Report') && hasEdge(WF20, 'Edit Progress (Report)', 'Run WF12 Report'));
  // REPORT-TRUTH-C: the terminal ✅ edit follows the LAST delivery step — the XLSX branch (send or explicit
  // skip), never the text send, so «Анализ завершён» can no longer race ahead of the workbook.
  A.ok('terminal ✅ edit follows the XLSX delivery (send or skip)',
    hasEdge(WF20, 'Send Report XLSX', 'Progress: Done') && hasEdge(WF20, 'XLSX Ready?', 'Progress: Done')
    && !hasEdge(WF20, 'Send Telegram Report', 'Progress: Done') && hasEdge(WF20, 'Progress: Done', 'Edit Progress (Done)'));
  for (const nm of ['Edit Progress (Quality Gate)', 'Edit Progress (Analysis)', 'Edit Progress (Comparison)', 'Edit Progress (Report)', 'Edit Progress (Done)']) {
    const nd = WF20.nodes.find(n => n.name === nm);
    A.eq(nm + ' uses editMessageText', nd.parameters.url.indexOf('editMessageText') >= 0, true);
    A.eq(nm + ' degrades on Telegram errors', nd.onError, 'continueRegularOutput');
  }
  // real editor behavior: same message id, distinct stages, skip without id
  function editor(name, midResp) {
    const run = H.makeRun();
    H.inject(run, 'Approval & Budget Gate', [{ request: { agent_request_id: 'r1', chat_id: 'c1' } }]);
    H.inject(run, 'Send Progress', [midResp]);
    return H.runCodeNode(run, WF20, name, [{ json: {} }])[0].json;
  }
  const e1 = editor('Progress: Quality Gate', { ok: true, result: { message_id: 88 } });
  A.eq('editor targets the captured message_id', JSON.parse(e1.telegram_edit_body).message_id, 88);
  A.ok('editor text is a Russian stage with the progress bar', JSON.parse(e1.telegram_edit_body).text.indexOf('Этап 4/10') >= 0);
  const e2 = editor('Progress: Report', { ok: true, result: { message_id: 88 } });
  A.eq('later editor edits the SAME message', JSON.parse(e2.telegram_edit_body).message_id, 88);
  A.ok('stages differ (real transitions, no repeat spam)', JSON.parse(e2.telegram_edit_body).text !== JSON.parse(e1.telegram_edit_body).text);
  // REPORT-TRUTH-C: the terminal text is state-aware — it claims report+XLSX only when a summary with data
  // exists and the workbook was actually built (xlsx_skipped false on the incoming item).
  const doneRun = H.makeRun();
  H.inject(doneRun, 'Approval & Budget Gate', [{ request: { agent_request_id: 'r1', chat_id: 'c1' } }]);
  H.inject(doneRun, 'Send Progress', [{ ok: true, result: { message_id: 88 } }]);
  H.inject(doneRun, 'Build Execution Summary', [{ summary: { final_state: 'completed', records_reported: 5 } }]);
  const done = H.runCodeNode(doneRun, WF20, 'Progress: Done', [{ json: { xlsx_skipped: false } }])[0].json;
  A.ok('terminal edit is the completed state', JSON.parse(done.telegram_edit_body).text.indexOf('✅ Анализ завершён') >= 0);
  const doneEmptyRun = H.makeRun();
  H.inject(doneEmptyRun, 'Approval & Budget Gate', [{ request: { agent_request_id: 'r1', chat_id: 'c1' } }]);
  H.inject(doneEmptyRun, 'Send Progress', [{ ok: true, result: { message_id: 88 } }]);
  H.inject(doneEmptyRun, 'Build Execution Summary', [{ summary: { final_state: 'reporting', records_reported: 0 } }]);
  const doneEmpty = H.runCodeNode(doneEmptyRun, WF20, 'Progress: Done', [{ json: { xlsx_skipped: true } }])[0].json;
  A.ok('empty run never claims a delivered workbook (live exec 1048 defect)',
    JSON.parse(doneEmpty.telegram_edit_body).text.indexOf('Excel') < 0 && JSON.parse(doneEmpty.telegram_edit_body).text.indexOf('данных не собрано') >= 0);
  const skipped = editor('Progress: Analysis', { ok: false });
  A.eq('missing message_id skips the edit silently', skipped.progress_skipped, true);
  // no internal leakage in any stage name
  for (const stg of PT.STAGES) A.ok('stage «' + stg + '» leaks no internals', !/wf\d|workflow|adapter|env|error|exec/i.test(stg));
}

A.section('PROGRESS-UNIFY-001 — WF20 reuses the WF18 ack as its ONE message (no "Принято!"+"завершён" pair)');
{
  function buildProgress(callerJson) {
    const run = H.makeRun();
    H.inject(run, 'Approval & Budget Gate', [{ request: { agent_request_id: 'r1', chat_id: 'c1' } }]);
    H.inject(run, 'When Called by Agent', [callerJson]);
    return H.runCodeNode(run, WF20, 'Build Progress Update', [{ json: {} }])[0].json;
  }
  // WF18 passed the ack message_id -> WF20 EDITS that message (no second message)
  const seeded = buildProgress({ agent_request_id: 'r1', chat_id: 'c1', progress_message_id: 4242 });
  A.eq('seeded run edits (not sends)', seeded.tg_method, 'editMessageText');
  A.eq('seeded run targets the WF18 ack message_id', JSON.parse(seeded.telegram_send_body).message_id, 4242);
  A.eq('Send Progress node method is dynamic ($json.tg_method)', WF20.nodes.find(n => n.name === 'Send Progress').parameters.url.indexOf('{{ $json.tg_method }}') >= 0, true);
  // no ack passed (manual run / ack send failed) -> WF20 falls back to sending its own message (never worse)
  const unseeded = buildProgress({ agent_request_id: 'r1', chat_id: 'c1', progress_message_id: '' });
  A.eq('unseeded run sends a new message (fallback)', unseeded.tg_method, 'sendMessage');
  A.ok('unseeded new-message body has no message_id', JSON.parse(unseeded.telegram_send_body).message_id === undefined);
  // editors prefer the caller ack id over the Send Progress response, so the SAME message is edited throughout
  const run = H.makeRun();
  H.inject(run, 'Approval & Budget Gate', [{ request: { agent_request_id: 'r1', chat_id: 'c1' } }]);
  H.inject(run, 'When Called by Agent', [{ progress_message_id: 4242 }]);
  H.inject(run, 'Send Progress', [{ ok: true, result: { message_id: 4242 } }]);
  const ed = H.runCodeNode(run, WF20, 'Progress: Analysis', [{ json: {} }])[0].json;
  A.eq('stage editor edits the SAME ack message id', JSON.parse(ed.telegram_edit_body).message_id, 4242);
}

A.report('progress-lifecycle');
