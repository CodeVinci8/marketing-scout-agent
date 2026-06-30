// test_idempotency_persist.js — IDEMP-003: the idempotency key must be persisted on parsed so the agent_requests
// row and the agent_request_events claim event store the SAME stable key (a re-delivered update_id is a duplicate).
// Offline, $0.
'use strict';
const A = require('./_assert');
const tio = require('../n8n/lib/telegram_io.js');

function decide(updateId) {
  return tio.ingressDecision({
    update: { body: { update_id: updateId, message: { message_id: updateId, date: 1, from: { id: 5, is_bot: false }, chat: { id: 5, type: 'private' }, text: 'analyse competitors' } } },
    headers: { 'x-telegram-bot-api-secret-token': 's' }, expectedSecret: 's',
    cfg: { enable_telegram: true, telegram_allowed_user_ids: ['5'] }
  });
}

A.section('idempotency key is stable, non-empty, and present on BOTH gate and parsed');
const d = decide(123456);
A.ok('gate key is non-empty', !!d.idempotency_key);
A.eq('parsed.idempotency_key equals gate.idempotency_key', d.parsed.idempotency_key, d.idempotency_key);
A.eq('key is update_id+chat scoped (re-delivery stable)', d.idempotency_key, 'tg::123456::5');

A.section('a re-delivered update_id yields the IDENTICAL key (so the persisted claim matches on re-read)');
A.eq('same update_id -> same key', decide(123456).parsed.idempotency_key, decide(123456).idempotency_key);
A.ok('different update_id -> different key', decide(123456).idempotency_key !== decide(999999).idempotency_key);

A.section('WF18 persists the parsed idempotency key into both the request row and the claim event');
{
  const WF18 = require('../n8n/workflows/18_telegram_agent_gateway.json');
  const ev = WF18.nodes.find(n => n.name === 'Shape Agent Request Event Row');
  A.ok('event row carries idempotency_key from the request', /idempotency_key\s*:\s*\(d\.request[\s\S]{0,40}idempotency_key/.test(String(ev.parameters.jsCode)));
  // the request record is built (from the parsed key) by one of the intake Code nodes; assert SOME WF18 node binds
  // the request idempotency_key to the parsed key (p.idempotency_key), so it is no longer empty.
  const bindsParsedKey = WF18.nodes.some(n => n.type === 'n8n-nodes-base.code' && /idempotency_key\s*:\s*p\.idempotency_key/.test(String((n.parameters || {}).jsCode || '')));
  A.ok('a WF18 intake node binds the request idempotency_key to p.idempotency_key', bindsParsedKey);
}

console.log('\nIDEMP_KEY_PERSISTED=PASS');
A.report('idempotency-persist');
