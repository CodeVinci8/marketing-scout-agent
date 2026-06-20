'use strict';
// agent_state.js — Stage 4 durable request state machine (B4).
//
// A single request walks a fixed lifecycle. Transitions are validated (no skipping mandatory states),
// every transition is an event that is persisted (the orchestrator appends to agent_request_events),
// terminal states are absorbing, and — critically — no external/paid call may run once a request is
// cancelled or finished. Pure + deterministic; the orchestrator embeds a mirror of this.

const STATES = [
  'received', 'classified', 'awaiting_approval', 'approved', 'collecting', 'quality_check',
  'analyzing', 'aggregating', 'reporting', 'delivering', 'completed', 'partial', 'failed', 'cancelled'
];

const TERMINAL = ['completed', 'partial', 'failed', 'cancelled'];

// The mandatory happy-path order. quality_check/analyzing/aggregating/reporting/delivering may be
// collapsed into a terminal failure/cancel, but may not be skipped forward on the success path.
const NEXT = {
  received: ['classified', 'cancelled', 'failed'],
  classified: ['awaiting_approval', 'cancelled', 'failed'],
  awaiting_approval: ['approved', 'cancelled', 'failed'],
  approved: ['collecting', 'cancelled', 'failed'],
  collecting: ['quality_check', 'partial', 'cancelled', 'failed'],
  quality_check: ['analyzing', 'partial', 'cancelled', 'failed'],
  analyzing: ['aggregating', 'partial', 'cancelled', 'failed'],
  aggregating: ['reporting', 'partial', 'cancelled', 'failed'],
  reporting: ['delivering', 'partial', 'cancelled', 'failed'],
  delivering: ['completed', 'partial', 'failed'],
  completed: [], partial: [], failed: [], cancelled: []
};

function isTerminal(state) { return TERMINAL.indexOf(String(state)) >= 0; }

// Validate a single transition. cancelled is reachable from any non-terminal state (user /cancel).
function canTransition(from, to) {
  from = String(from); to = String(to);
  if (STATES.indexOf(from) < 0 || STATES.indexOf(to) < 0) return false;
  if (isTerminal(from)) return false;                 // terminal is absorbing
  if (to === 'cancelled') return true;                // user can cancel any live request
  return (NEXT[from] || []).indexOf(to) >= 0;
}

// Apply a transition, returning the new state record + the event to persist. Invalid transitions are
// rejected (state unchanged, ok=false) rather than throwing, so the orchestrator records a clear event.
function transition(record, to, meta) {
  record = record || {};
  const from = String(record.state || 'received');
  const ts = (meta && meta.ts) || '';
  if (!canTransition(from, to)) {
    return {
      ok: false, state: from,
      event: { agent_request_id: record.agent_request_id || '', from_state: from, to_state: String(to), accepted: false, reason: 'invalid_transition', ts: ts }
    };
  }
  const next = Object.assign({}, record, { state: to, prev_state: from });
  return {
    ok: true, state: to, record: next,
    event: { agent_request_id: record.agent_request_id || '', from_state: from, to_state: to, accepted: true, reason: (meta && meta.reason) || '', ts: ts }
  };
}

// Hard guard used by the approval/budget gate: once cancelled/terminal, NO external call may proceed.
function canMakeExternalCall(state) {
  const s = String(state);
  if (s === 'cancelled' || isTerminal(s)) return false;
  // external work only happens in the collection/analysis window after approval
  return ['approved', 'collecting', 'quality_check', 'analyzing', 'aggregating', 'reporting'].indexOf(s) >= 0;
}

module.exports = { STATES, TERMINAL, NEXT, isTerminal, canTransition, transition, canMakeExternalCall };
