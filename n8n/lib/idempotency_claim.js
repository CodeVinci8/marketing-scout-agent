// idempotency_claim.js — atomic exactly-once claim for the WF18 accepted path (IDEMP-001).
//
// The original "read existing claims -> if absent -> append" is a read-then-write race: two genuinely concurrent
// updates with the same idempotency_key both read "absent" and both proceed. This implements an append-then-verify
// winner protocol that is correct WITHOUT relying on N8N_CONCURRENCY=1:
//   1. every execution mints a unique claim_token;
//   2. it APPENDS a claim_candidate row FIRST (into agent_request_events, reason='idempotency_claim'), so the row
//      physically exists before the decision;
//   3. it RE-READS agent_request_events and, among the claim rows for this idempotency_key, the one with the
//      LOWEST physical row_number is the deterministic winner (append order is monotonic; a loser always appends a
//      higher row and therefore always observes the winner's lower row on its post-append read);
//   4. exactly one execution is the winner; every other terminates BEFORE WF19 / request creation / plan creation /
//      state mutation / user-visible send.
// A client timestamp is NOT the winner criterion (clocks can tie/skew); physical row order is. The claim rows live
// in the existing agent_request_events sheet (reason='idempotency_claim'), so no schema migration or new sheet.
'use strict';

function str(v) { return v == null ? '' : String(v).trim(); }

// reason marker that distinguishes a claim row from a normal state-transition event row. The claim row is NOT a
// state transition, so from_state/to_state stay EMPTY — the agent_request_events to_state column carries a strict
// canonical agent_state dropdown (config/sheets_ui_contracts.json) and a made-up state would violate it.
var CLAIM_REASON = 'idempotency_claim';

// Mint a unique-enough claim token without crypto (n8n Code sandbox disallows require('crypto')). Two concurrent
// executions in the same millisecond still differ via the two independent Math.random() draws.
function newClaimToken() {
  var r = function () { return Math.floor(Math.random() * 2176782336).toString(36); }; // 36^6
  return 'clm_' + Date.now().toString(36) + '_' + r() + r();
}

// Build the claim_candidate row for agent_request_events. The claim_token is carried in agent_request_id (so the
// winner is identified by row_number -> agent_request_id), the key in idempotency_key, the marker in reason.
function claimEventRow(args) {
  args = args || {};
  return {
    agent_request_id: str(args.claim_token),
    from_state: '',
    to_state: '',
    accepted: '',
    reason: CLAIM_REASON,
    idempotency_key: str(args.idempotency_key),
    ts: str(args.ts) || new Date().toISOString()
  };
}

// Resolve the winner from the POST-APPEND read of agent_request_events. `rows` are the projected rows (each with a
// numeric row_number, as extractTab produces). Only claim rows (reason=CLAIM_REASON) for THIS idempotency_key
// compete; the winner is the lowest row_number; is_duplicate is true for every non-winner (sequential OR concurrent).
function resolveClaimWinner(rows, idempotencyKey, myToken) {
  var key = str(idempotencyKey);
  var mine = str(myToken);
  var candidates = (rows || [])
    .filter(function (r) { return r && str(r.reason) === CLAIM_REASON && str(r.idempotency_key) === key; })
    .map(function (r) { return { token: str(r.agent_request_id), row: Number(r.row_number) }; })
    .filter(function (c) { return c.token && isFinite(c.row); });
  candidates.sort(function (a, b) { return a.row - b.row; });
  var winner = candidates.length ? candidates[0] : null;
  var winner_token = winner ? winner.token : '';
  var my_present = candidates.some(function (c) { return c.token === mine; });
  var is_winner = !!winner && winner_token === mine;
  return {
    winner_token: winner_token,
    is_winner: is_winner,
    is_duplicate: !is_winner,
    candidate_count: candidates.length,
    my_claim_present: my_present,
    // a fail-closed sanity flag: my own claim row MUST be visible on my post-append read; if it is not, treat as a
    // duplicate (never proceed off an unverified claim).
    claim_verified: my_present
  };
}

module.exports = { newClaimToken, claimEventRow, resolveClaimWinner, CLAIM_REASON, str };
