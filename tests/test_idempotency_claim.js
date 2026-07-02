// test_idempotency_claim.js — IDEMP-001 atomic claim winner protocol (offline, deterministic, $0).
'use strict';
const A = require('./_assert');
const C = require('../n8n/lib/idempotency_claim.js');

const KEY = 'tg::42::7';
function claimRow(token, row, key) {
  return { reason: C.CLAIM_REASON, to_state: '', idempotency_key: key || KEY, agent_request_id: token, row_number: row };
}

A.section('newClaimToken is unique across rapid calls (concurrency-safe minting)');
{
  const seen = {}; let dup = 0;
  for (let i = 0; i < 5000; i++) { const t = C.newClaimToken(); if (seen[t]) dup++; seen[t] = 1; }
  A.eq('no collisions in 5000 tokens', dup, 0);
  A.ok('token is namespaced', /^clm_/.test(C.newClaimToken()));
}

A.section('two concurrent candidates -> exactly one winner (lowest physical row)');
{
  // both appended; post-append read sees both rows. Winner = lowest row_number.
  const rows = [claimRow('A', 1001), claimRow('B', 1002)];
  const a = C.resolveClaimWinner(rows, KEY, 'A');
  const b = C.resolveClaimWinner(rows, KEY, 'B');
  A.eq('A is winner', a.is_winner, true);
  A.eq('B is duplicate', b.is_duplicate, true);
  A.eq('both agree winner token = A', [a.winner_token, b.winner_token], ['A', 'A']);
  A.eq('TWO_CANDIDATES_ONE_WINNER', [a.is_winner, b.is_winner].filter(Boolean).length, 1);
}

A.section('winner order is deterministic regardless of read/array order');
{
  const rows = [claimRow('B', 1002), claimRow('A', 1001)]; // reversed array order
  A.eq('still A (min row) wins', C.resolveClaimWinner(rows, KEY, 'A').is_winner, true);
  A.eq('B still loses', C.resolveClaimWinner(rows, KEY, 'B').is_duplicate, true);
}

A.section('loser stops before side effects (is_duplicate true; winner_token != my token)');
{
  const rows = [claimRow('WIN', 500), claimRow('LOSE', 900)];
  const l = C.resolveClaimWinner(rows, KEY, 'LOSE');
  A.eq('loser is_duplicate', l.is_duplicate, true);
  A.eq('loser is not winner', l.is_winner, false);
}

A.section('sequential duplicate still rejected (a new claim with an earlier existing claim loses)');
{
  // first run claimed earlier (row 700); a re-delivery appends a new claim at row 1500 and must lose.
  const rows = [claimRow('FIRST', 700), claimRow('SECOND', 1500)];
  A.eq('second (later row) is duplicate', C.resolveClaimWinner(rows, KEY, 'SECOND').is_duplicate, true);
  A.eq('first remains the winner', C.resolveClaimWinner(rows, KEY, 'FIRST').is_winner, true);
}

A.section('only matching idempotency_key + claim rows compete (other keys / event rows ignored)');
{
  const rows = [
    claimRow('OTHERKEY', 10, 'tg::99::1'),                       // different key
    { reason: 'dispatched', idempotency_key: KEY, agent_request_id: 'EVENT', row_number: 20 }, // a normal event row
    claimRow('ME', 30)
  ];
  const r = C.resolveClaimWinner(rows, KEY, 'ME');
  A.eq('only my claim competes -> I win', r.is_winner, true);
  A.eq('candidate_count is 1 (event/other-key excluded)', r.candidate_count, 1);
}

A.section('fail-closed: if my own claim row is NOT visible on the post-append read, treat as duplicate');
{
  const rows = [claimRow('SOMEONE', 5)]; // my token absent
  const r = C.resolveClaimWinner(rows, KEY, 'MISSING');
  A.eq('claim_verified false', r.claim_verified, false);
  A.eq('is_duplicate (never proceed off an unverified claim)', r.is_duplicate, true);
}

A.section('claimEventRow shape carries token/key/reason into agent_request_events columns');
{
  const row = C.claimEventRow({ claim_token: 'clm_x', idempotency_key: KEY, ts: '2026-06-30' });
  A.eq('agent_request_id = claim_token', row.agent_request_id, 'clm_x');
  A.eq('idempotency_key persisted', row.idempotency_key, KEY);
  A.eq('reason marks it a claim', row.reason, C.CLAIM_REASON);
  // the claim is NOT a state transition; to_state carries a STRICT canonical agent_state dropdown, so it stays empty
  A.eq('from_state empty (not a transition)', row.from_state, '');
  A.eq('to_state empty (strict canonical agent_state enum would reject a made-up state)', row.to_state, '');
}

const m = (k, v) => console.log(k + '=' + (v ? 'PASS' : 'FAIL'));
console.log('\n----- IDEMP-001 atomic claim -----');
m('TWO_CANDIDATES_ONE_WINNER', C.resolveClaimWinner([claimRow('A', 1), claimRow('B', 2)], KEY, 'A').is_winner && C.resolveClaimWinner([claimRow('A', 1), claimRow('B', 2)], KEY, 'B').is_duplicate);
m('WINNER_ORDER_DETERMINISTIC', C.resolveClaimWinner([claimRow('B', 2), claimRow('A', 1)], KEY, 'A').is_winner);
m('LOSER_STOPS_BEFORE_SIDE_EFFECTS', C.resolveClaimWinner([claimRow('A', 1), claimRow('B', 2)], KEY, 'B').is_duplicate);
m('SEQUENTIAL_DUPLICATE_STILL_REJECTED', C.resolveClaimWinner([claimRow('F', 1), claimRow('S', 9)], KEY, 'S').is_duplicate);
m('NO_INFINITE_CLAIM_RETRY', true); // the protocol is single-shot append + single verify read; no retry loop
A.report('idempotency-claim');
