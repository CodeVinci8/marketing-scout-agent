'use strict';
// test_two_user_fixture.js — item 6. A production-shaped, deterministic TWO-USER fixture that ties the canonical
// pieces together and proves the cross-cutting guarantees for two allowed users at once:
//   (1) recipient isolation           — A's run never reaches B and vice-versa;
//   (2) stable origin across workflows — the origin chat threads WF18 -> WF19 -> WF20 -> delivery unchanged;
//   (3) callback deduplication         — 7 taps per user => 1 accepted action each, no cross-user collision;
//   (4) retry safety                   — an XLSX retry keeps the SAME recipient and never becomes a new run;
//   (5) truthful AI state              — ai_expected && !ai_delivered => the honest no-AI terminal, per user;
//   (6) Telegram/XLSX evidence parity  — the Telegram "confirmed fragments" count == the XLSX evidence rows.
// User B is Telegram user 219246148 (the operator-named second user); User A (the owner) is SYNTHETIC. No tokens,
// credentials, or unrelated real ids are stored. Fully offline, $0, deterministic (no clocks/sleeps in asserts).
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const io = require('../n8n/lib/telegram_io.js');
const IC = require('../n8n/lib/idempotency_claim.js');
const P = require('../n8n/lib/progress_tracker.js');
const CR = require('../n8n/lib/compact_report_ru.js');

const OWNER = '900000001';        // SYNTHETIC owner (User A)
const USER_B = '219246148';       // operator-named second user (User B)

function cb(update_id, cbid, data, mid, uid) {
  return io.parseUpdate({ update_id: update_id, callback_query: { id: cbid, data: data, from: { id: uid, is_bot: false }, message: { message_id: mid, chat: { id: uid, type: 'private' } } } });
}
function msg(update_id, text, uid) {
  return io.parseUpdate({ update_id: update_id, message: { message_id: update_id, text: text, from: { id: uid }, chat: { id: uid, type: 'private' } } });
}

A.section('(1) recipient isolation — each user has a distinct origin/idempotency identity');
const aReq = msg(7001, 'Проанализируй https://crediti.ru/', OWNER);
const bReq = msg(7002, 'Проанализируй https://lf-c.ru/', USER_B);
A.ok('A and B parse to their own chat/user', aReq.chat_id === OWNER && bReq.chat_id === USER_B);
A.ok('A and B message idempotency keys differ', io.updateIdempotencyKey(aReq) !== io.updateIdempotencyKey(bReq));

A.section('(3) callback dedup — 7 taps per user => 1 winner each, and A never collides with B');
function sevenTaps(uid, mid) {
  const clicks = []; for (let i = 0; i < 7; i++) clicks.push(cb(8000 + i + (uid === OWNER ? 0 : 100), 'q' + uid + i, 'approve:req_' + uid, mid, uid));
  const key = io.updateIdempotencyKey(clicks[0]);
  const rows = clicks.map(function (c, i) { const r = IC.claimEventRow({ claim_token: 'req_' + uid + '_' + i, idempotency_key: io.updateIdempotencyKey(c), ts: '2026-07-29T12:0' + i + ':00Z' }); r.row_number = i + 1; return r; });
  let winners = 0; clicks.forEach(function (c, i) { if (IC.resolveClaimWinner(rows.slice(0, i + 1), key, 'req_' + uid + '_' + i).is_winner) winners++; });
  return { key: key, winners: winners };
}
const aTaps = sevenTaps(OWNER, 500), bTaps = sevenTaps(USER_B, 600);
A.eq('User A: 7 taps -> exactly 1 accepted action', aTaps.winners, 1);
A.eq('User B: 7 taps -> exactly 1 accepted action', bTaps.winners, 1);
A.ok('A and B callback keys never collide', aTaps.key !== bTaps.key);

A.section('(2) stable origin across workflows — WF18->WF19->WF20 thread the request chat/owner (no owner fallback)');
const wf18 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '18_telegram_agent_gateway.json'), 'utf8'));
const wf18str = JSON.stringify(wf18);
A.ok('WF18->WF19 passes chat_id from the request', /Run WF19/.test(wf18str) && /chat_id[\s\S]{0,80}request\.chat_id/.test(wf18str));
A.ok('WF18->WF19 passes owner_user_id from the request', /owner_user_id[\s\S]{0,80}request\.user_id/.test(wf18str));
const wf20 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '20_agent_orchestrator.json'), 'utf8'));
function nodeJs(w, n) { const x = (w.nodes || []).find(function (y) { return y.name === n; }); return (x && x.parameters && x.parameters.jsCode) || ''; }
['Build Delivery Outbox', 'Build Report XLSX'].forEach(function (n) {
  const chatLines = nodeJs(wf20, n).split('\n').filter(function (l) { return /(^|[^_a-zA-Z])chat\s*=/.test(l); }).join(' ~ ');
  A.ok(n + ': delivery chat == request origin, never owner_user_id', /chat_id/.test(chatLines) && !/\|\|\s*[a-zA-Z_.]*owner_user_id/.test(chatLines));
});

A.section('(4) retry safety — an XLSX retry keeps the SAME recipient and is not a new analytical run');
function terminalFor(chat, hasDoc, attempts) {
  return P.deliveryTerminalEdit({ report_message_id: 'r_' + chat, document_message_id: hasDoc ? 'd_' + chat : '', xlsx_expected: true, attempts: attempts, max_attempts: 2, analysis: { final_state: 'completed', has_analysis: true, records: 2 }, ai: { expected: true, delivered: true } });
}
A.ok('A: report sent, XLSX pending (attempt<max) -> retry, NOT delivered', terminalFor(OWNER, false, 1).delivery_state === 'document_retrying');
A.ok('A: after XLSX confirmed -> delivered (same run, both ids)', terminalFor(OWNER, true, 1).delivery_state === 'delivered');
// the retry re-sends only the document — the recipient (chat) is derived from the SAME request, so it cannot drift
A.ok('retry recipient is stable (document body carries the run chat, not a new one)', /chat_id:chat/.test(nodeJs(wf20, 'Build Report XLSX')));

A.section('(5) truthful AI state — per user, promised-but-undelivered AI never shows plain success');
[OWNER, USER_B].forEach(function (u) {
  const noAi = P.deliveryTerminalEdit({ report_message_id: 'r_' + u, document_message_id: 'd_' + u, xlsx_expected: true, analysis: { final_state: 'reporting', has_analysis: false, records: 2 }, ai: { expected: true, delivered: false, reason: 'server_error' } });
  A.ok(u + ': AI promised but failed -> honest delivered_no_ai (not «✅ Готово …отправлены»)', noAi.delivery_state === 'delivered_no_ai' && noAi.text.indexOf('✅ Готово. Отчёт и Excel-файл отправлены.') < 0);
});

A.section('(6) Telegram/XLSX evidence parity — the confirmed-fragments count matches the evidence rows');
const bundle = {
  analysis_mode: 'source_analysis', niche: 'credit_brokerage',
  competitors: [{ company_name: 'crediti.ru' }],
  offers: [{ title: 'ПТС кредит' }],
  evidence: [
    { evidence_id: 'ev_1', url: 'https://crediti.ru/', excerpt: 'ставка 0.08%' },
    { evidence_id: 'ev_2', url: 'https://crediti.ru/uslugi', excerpt: 'залог ПТС' },
    { evidence_id: 'ev_3', url: 'https://crediti.ru/about', excerpt: 'офис в Москве' }
  ]
};
const summary = { records_reported: 3, final_state: 'completed', analysis_mode: 'source_analysis' };
const body = CR.crCompactReportRu({ bundle: bundle, analyses: [], summary: summary, cost_line: 'Стоимость: $0.02', next_action: 'x', state: 'completed' }).text;
const m = body.match(/Основано на (\d+) подтверждённых фрагментах/);
const tgCount = m ? Number(m[1]) : -1;
A.ok('Telegram states a confirmed-fragments count', tgCount >= 0);
A.eq('Telegram confirmed-fragments count == bundle.evidence rows (the XLSX «Доказательства» source)', tgCount, bundle.evidence.length);

A.report('two-user-fixture');
