'use strict';
// test_progress_tracker.js — one editable progress message per request: create-then-edit, throttle, no
// backwards transition, repeated-stage suppression, cancellation, failure naming, edit fallback, duplicate-run
// safety, and final delivery kept separate + idempotent (Sections 10 / 21).
const A = require('./_assert.js');
const P = require('../n8n/lib/progress_tracker.js');

A.section('first update creates exactly one message; thereafter edits the same one');
let st = P.initProgress({ agent_request_id: 'req_aaa', chat_id: '555' });
A.eq('starts at stage 0', st.stage, 0);
let r1 = P.advance(st, 1, { now: '2026-06-21T10:00:00Z' });
A.eq('stage 1 -> create', r1.action, 'create');
A.ok('create text names stage 1', /1\/10/.test(r1.text) && /План подтверждён/.test(r1.text));
A.ok('request id NOT in visible text', r1.text.indexOf('req_aaa') < 0);
A.eq('request id is in meta', r1.meta.request_id, 'req_aaa');
// adopt the telegram message id, then advance -> edit
st = P.setMessageId(r1.state, 'msg_1');
let r2 = P.advance(st, 2, { now: '2026-06-21T10:00:05Z' });
A.eq('stage 2 -> edit (same message)', r2.action, 'edit');
A.eq('message id preserved', r2.state.message_id, 'msg_1');

A.section('no backwards transition + repeated same stage suppressed');
st = r2.state;
let back = P.advance(st, 1, { now: '2026-06-21T10:00:06Z' });
A.eq('going back to stage 1 -> skip', back.action, 'skip');
A.eq('stage stays at 2', back.state.stage, 2);
let same = P.advance(st, 2, { now: '2026-06-21T10:00:07Z' });
A.eq('same stage -> skip', same.action, 'skip');
A.ok('skip marked throttled', same.throttled === true);

A.section('forward advance to completion');
let cur = r2.state;
for (let s = 3; s <= 10; s++) { const r = P.advance(cur, s, { now: '2026-06-21T10:01:0' + (s % 10) + 'Z' }); A.eq('stage ' + s + ' -> edit', r.action, 'edit'); cur = r.state; }
A.eq('final stage 10', cur.stage, 10);
A.eq('status complete at 10', cur.status, 'complete');
A.ok('final stage names Готово', /Готово/.test(P.advance(r2.state, 10).text));

A.section('cancellation rewrites the same message immediately + names the stage');
let cst = P.setMessageId(P.advance(P.initProgress({ agent_request_id: 'req_c' }), 3).state, 'msg_c');
let canc = P.cancel(cst, { now: 'now' });
A.eq('cancel edits the existing message', canc.action, 'edit');
A.ok('cancel text names stage', /Отменено на этапе 3\/10/.test(canc.text));
A.eq('status cancelled', canc.state.status, 'cancelled');
// after cancellation, further advances are suppressed
A.eq('advance after cancel -> skip', P.advance(canc.state, 4).action, 'skip');

A.section('failure names the failed stage + keeps prior report');
let fst = P.setMessageId(P.advance(P.initProgress({ agent_request_id: 'req_f' }), 4).state, 'msg_f');
let fl = P.fail(fst, 5, 'источник недоступен', { now: 'now' });
A.ok('failure names stage 5', /Сбой на этапе 5\/10/.test(fl.text));
A.ok('failure names the error', /источник недоступен/.test(fl.text));
A.ok('failure reassures prior report kept', /Прошлый отчёт сохранён/.test(fl.text));
A.eq('status failed', fl.state.status, 'failed');

A.section('edit failure falls back to ONE replacement message (retry never duplicates)');
let est = P.setMessageId(P.advance(P.initProgress({ agent_request_id: 'req_e' }), 2).state, 'msg_e');
let afterFail = P.applyEditResult(est, false);
A.eq('failed edit clears message id', afterFail.message_id, '');
A.eq('fallback counted', afterFail.fallback_count, 1);
let resend = P.advance(afterFail, 3, { now: 'now' });
A.eq('next update after fallback -> create one replacement', resend.action, 'create');
let afterOk = P.applyEditResult(P.setMessageId(resend.state, 'msg_e2'), true);
A.eq('successful edit keeps message id', afterOk.message_id, 'msg_e2');

A.section('final report delivery is SEPARATE and idempotent (progress != delivery)');
let dst = cur; // completed progress
A.ok('progress out is_final_delivery=false', P.advance(r2.state, 5).is_final_delivery === false);
A.ok('can deliver first time', P.canDeliver(dst, 'deliv_1'));
let delivered = P.markDelivered(dst, 'deliv_1');
A.ok('cannot deliver same id twice', !P.canDeliver(delivered, 'deliv_1'));
A.ok('different delivery id allowed', P.canDeliver(delivered, 'deliv_2'));

A.report('progress-tracker');
