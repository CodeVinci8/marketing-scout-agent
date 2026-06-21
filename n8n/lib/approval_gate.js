'use strict';
// approval_gate.js — Stage 4 approval & budget gate (B5).
//
// The single chokepoint every paid/external call passes through. It fails CLOSED: a call proceeds only
// when the request is approved, not cancelled, the source is allowlisted, item/call ceilings and the
// source + LLM budgets all hold, and this exact unit of work has not already been completed (idempotency
// key). A blocked gate returns a useful reason; it never throws and never leaks token values.

function str(v) { return v == null ? '' : String(v).trim(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }

const GATE_TERMINAL = ['completed', 'partial', 'failed', 'cancelled']; // local: avoids clash when co-embedded with agent_state.TERMINAL

// Deterministic idempotency key for one unit of external work (a source call within a request).
function idempotencyKey(agentRequestId, source, attempt) {
  return [str(agentRequestId) || 'req', str(source).toLowerCase() || 'src', 'a' + (num(attempt, 1))].join('::');
}

// ctx: { state, cancelled, approved, completed_keys:[], external_calls_made, source_spend_usd, llm_spend_usd }
// plan: { source, est_items, est_external_calls, est_source_cost_usd, est_llm_cost_usd }
// cfg:  resolved agent_config (limits + budgets + allowlist + require_approval)
function evaluateGate(plan, ctx, cfg) {
  plan = plan || {}; ctx = ctx || {}; cfg = cfg || {};
  const source = str(plan.source).toLowerCase();
  const key = idempotencyKey(ctx.agent_request_id || plan.agent_request_id, source, plan.attempt);
  const reasons = [];

  // 1. lifecycle: cancelled or terminal => hard stop
  if (ctx.cancelled === true || GATE_TERMINAL.indexOf(str(ctx.state)) >= 0) reasons.push('request_not_active');
  // 2. approval (when required)
  if (cfg.require_approval !== false && ctx.approved !== true) reasons.push('not_approved');
  // 3. source allowlist
  if ((cfg.source_allowlist || []).indexOf(source) < 0) reasons.push('source_not_allowed');
  // 4. idempotency: this unit already completed
  if ((ctx.completed_keys || []).indexOf(key) >= 0) reasons.push('already_completed');
  // 5. item ceiling
  if (num(plan.est_items, 0) > num(cfg.max_items_per_source, Infinity)) reasons.push('over_item_limit');
  // 6. external-call ceiling (cumulative)
  if (num(ctx.external_calls_made, 0) + num(plan.est_external_calls, 0) > num(cfg.max_external_calls, Infinity)) reasons.push('over_call_limit');
  // 7. source budget (cumulative)
  if (num(ctx.source_spend_usd, 0) + num(plan.est_source_cost_usd, 0) > num(cfg.source_budget_usd, Infinity)) reasons.push('over_source_budget');
  // 8. LLM budget (cumulative)
  if (num(ctx.llm_spend_usd, 0) + num(plan.est_llm_cost_usd, 0) > num(cfg.llm_budget_usd, Infinity)) reasons.push('over_llm_budget');

  return {
    allowed: reasons.length === 0,
    reason: reasons.join('; '),
    idempotency_key: key,
    source: source
  };
}

module.exports = { idempotencyKey, evaluateGate };
