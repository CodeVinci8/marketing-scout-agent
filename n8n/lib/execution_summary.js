'use strict';
// execution_summary.js — Stage 4 single canonical execution summary (B9).
//
// One diagnostic record for the whole request. It replaces eyeballing dozens of node outputs: from the
// request state, the collection rollup, the analysis/aggregation/report facts and the delivery status it
// produces a flat summary + a single "next operator action". Costs that are genuinely unknown stay
// 'unknown' (never fabricated $0).

function str(v) { return v == null ? '' : String(v).trim(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

function buildExecutionSummary(parts) {
  parts = parts || {};
  const req = parts.request || {};
  const roll = parts.collection || {};
  const adapters = Array.isArray(parts.adapters) ? parts.adapters : [];
  const analysis = parts.analysis || {};
  const aggregation = parts.aggregation || {};
  const report = parts.report || {};
  const delivery = parts.delivery || {};

  const state = str(req.state) || 'received';
  const sourcesRequested = (parts.plan && parts.plan.sources) || adapters.map(a => a.source);
  const llmPrimary = num(analysis.llm_primary_calls, 0) + num(report.llm_primary_calls, 0);
  const llmRepair = num(analysis.llm_repair_calls, 0) + num(report.llm_repair_calls, 0);
  const sourceCostKnown = adapters.every(a => a.cost_status && a.cost_status !== 'unknown') && adapters.length > 0;
  const llmCostKnown = (analysis.llm_cost_status && analysis.llm_cost_status !== 'unknown') || llmPrimary === 0;

  const blocking = [];
  if (!parts.config_complete) blocking.push('central config incomplete');
  [].concat(parts.errors || []).map(str).filter(Boolean).forEach(e => blocking.push(e));

  // single recommended next action
  let next_action;
  if (state === 'cancelled') next_action = 'none — request cancelled by user';
  else if (state === 'completed') next_action = 'none — report delivered';
  else if (state === 'partial') next_action = 'review partial report; some sources failed/quarantined';
  else if (state === 'failed') next_action = blocking.length ? ('resolve: ' + blocking[0]) : 'inspect failed state events';
  else if (roll.outcome === 'no_data') next_action = 'broaden sources/filters — no eligible data collected';
  else next_action = 'request in progress (' + state + ')';

  return {
    agent_request_id: str(req.agent_request_id),
    final_state: state,
    sources_requested: sourcesRequested.join(', '),
    sources_completed: num(roll.sources_ok, adapters.filter(a => a.status === 'ok').length),
    sources_failed: num(roll.sources_failed, adapters.filter(a => a.status === 'failed').length),
    sources_quarantined: num(roll.sources_quarantined, adapters.filter(a => a.quarantined).length),
    records_received: num(roll.items_written, adapters.reduce((a, r) => a + num(r.items_received, 0), 0)),
    records_unique: num(analysis.records_unique, 0),
    records_eligible: num(analysis.records_eligible, 0),
    records_analyzed: num(analysis.records_analyzed, 0),
    records_reported: num(aggregation.rows_after_filters, num(report.rows_after_filters, 0)),
    external_calls: adapters.reduce((a, r) => a + num(r.external_calls, 0), 0),
    llm_primary_calls: llmPrimary,
    llm_repair_calls: llmRepair,
    source_cost_status: sourceCostKnown ? 'known' : 'unknown',
    llm_cost_status: llmCostKnown ? 'known' : 'unknown',
    report_id: str(report.report_id),
    delivery_status: str(delivery.send_status) || 'none',
    blocking_errors: blocking.join('; '),
    next_operator_action: next_action
  };
}

module.exports = { buildExecutionSummary };
