'use strict';
// test_callback_dedup.js — CALLBACK-DEDUP-001. Seven rapid clicks of ONE inline button (live-observed:
// cb:intent:rerun_request, execs 1456–1464) must collapse to exactly ONE accepted action → one plan, one run,
// one report, one XLSX, one terminal. Telegram assigns a UNIQUE update_id AND callback_query.id to EVERY click,
// so the fix scopes a callback's idempotency by the ACTION (callback_data + source message + user + chat), not by
// the per-click update_id. The existing claim/winner protocol (idempotency_claim.resolveClaimWinner) then makes
// exactly one click the winner; every other terminates before request/plan/dispatch.
const A = require('./_assert.js');
const io = require('../n8n/lib/telegram_io.js');
const IC = require('../n8n/lib/idempotency_claim.js');

function cbUpdate(update_id, cbid, data, mid, uid, chat) {
  return { update_id: update_id, callback_query: { id: cbid, data: data, from: { id: uid, is_bot: false }, message: { message_id: mid, chat: { id: chat, type: 'private' } } } };
}

A.section('7 rapid clicks of the SAME button collapse to ONE idempotency key');
const clicks = [];
for (let i = 0; i < 7; i++) clicks.push(io.parseUpdate(cbUpdate(1000 + i, 'cbq' + i, 'intent:rerun_request', 683, '1188830082', '1188830082')));
const keys = clicks.map(function (p) { return io.updateIdempotencyKey(p); });
A.eq('7 distinct update_ids/callback_query.ids -> 1 idempotency key', new Set(keys).size, 1);
A.ok('the key is action-scoped (cb::data::message::user::chat)', /^cb::intent:rerun_request::m683::1188830082::1188830082$/.test(keys[0]));

A.section('claim/winner protocol: exactly ONE winner, six duplicates (no second plan/run)');
// each click mints a claim token and appends a claim row in click order (n8n serializes WF18); the post-append
// read sees all prior claims. Simulate the appended agent_request_events rows.
const key = keys[0];
const rows = clicks.map(function (p, i) {
  const r = IC.claimEventRow({ claim_token: 'req_' + p.update_id, idempotency_key: io.updateIdempotencyKey(p), ts: '2026-07-29T11:5' + i + ':00Z' });
  r.row_number = i + 1; // physical append order
  return r;
});
let winners = 0, duplicates = 0;
clicks.forEach(function (p, i) {
  // each execution re-reads all rows appended so far (rows[0..i]) then resolves
  const seen = rows.slice(0, i + 1);
  const res = IC.resolveClaimWinner(seen, key, 'req_' + p.update_id);
  if (res.is_winner) winners++; else duplicates++;
});
A.eq('exactly one winner across the 7 clicks', winners, 1);
A.eq('the other six are duplicates (terminate before plan/run)', duplicates, 6);
A.ok('the winner is the FIRST click (lowest row_number)', IC.resolveClaimWinner(rows, key, 'req_1000').is_winner === true);
A.ok('a later click is NOT the winner', IC.resolveClaimWinner(rows, key, 'req_1006').is_winner === false);

A.section('a genuinely different action is NOT blocked (own key, own winner)');
const freshRerun = io.parseUpdate(cbUpdate(2000, 'z', 'intent:rerun_request', 999 /* NEW report message */, '1188830082', '1188830082'));
A.ok('a rerun button on a NEW report message has a different key', io.updateIdempotencyKey(freshRerun) !== key);
const approveA = io.parseUpdate(cbUpdate(3000, 'a', 'approve:req_A', 700, '1188830082', '1188830082'));
const approveB = io.parseUpdate(cbUpdate(3001, 'b', 'approve:req_B', 701, '1188830082', '1188830082'));
A.ok('different target request -> different key', io.updateIdempotencyKey(approveA) !== io.updateIdempotencyKey(approveB));

A.section('two users pressing the same-looking button stay isolated');
const userA = io.updateIdempotencyKey(io.parseUpdate(cbUpdate(4000, 'a', 'intent:rerun_request', 683, '1188830082', '1188830082')));
const userB = io.updateIdempotencyKey(io.parseUpdate(cbUpdate(4001, 'b', 'intent:rerun_request', 683, '219246148', '219246148')));
A.ok('User A and User B rerun keys differ (no cross-user collision)', userA !== userB);

A.section('a re-delivered message (retry) is NOT a new analytical run; message key stays update-scoped');
const m1 = io.updateIdempotencyKey(io.parseUpdate({ update_id: 5000, message: { message_id: 1, text: 'привет', from: { id: 1 }, chat: { id: 1, type: 'private' } } }));
const m1again = io.updateIdempotencyKey(io.parseUpdate({ update_id: 5000, message: { message_id: 1, text: 'привет', from: { id: 1 }, chat: { id: 1, type: 'private' } } }));
A.ok('a re-delivered update_id maps to the SAME key (one request)', m1 === m1again);
A.ok('message key remains tg-scoped', /^tg::/.test(m1));

A.report('callback-dedup');
