'use strict';
// execution_summary.js — Stage 4 single canonical execution summary (B9).
//
// One diagnostic record for the whole request. It replaces eyeballing dozens of node outputs: from the
// request state, the collection rollup, the analysis/aggregation/report facts and the delivery status it
// produces a flat summary + a single "next operator action". Costs that are genuinely unknown stay
// 'unknown' (never fabricated $0).

function str(v) { return v == null ? '' : String(v).trim(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

// REPORT-TRUTH-E (WF04→WF20 contract): classify ONE adapter into exactly one deterministic collection bucket from
// its TYPED execution_mode / source_outcome / status — NEVER from external-call counts. A freshly collected source
// can cost many external calls; a reused source costs none; the two must never be conflated. Buckets:
//   reused   — answered from a saved accepted snapshot ($0 collection)
//   fresh    — freshly collected (or refreshed) THIS run, with data
//   rejected — failed / quarantined / ran-but-produced-nothing-usable (did NOT contribute evidence)
// "Contributing" downstream = reused ∪ fresh.
function classifyAdapterSource(a) {
  a = a || {};
  const mode = str(a.execution_mode).toLowerCase();
  const outcome = str(a.source_outcome).toLowerCase();
  const status = str(a.status).toLowerCase();
  if (a.quarantined === true || status === 'quarantined' || status === 'failed') return 'rejected';
  if (mode === 'reuse' || outcome === 'reused_snapshot') return 'reused';
  const hasData = a.outcome_has_data === true || num(a.items_written, 0) > 0
    || outcome === 'collected_with_data' || outcome === 'refreshed_with_data' || status === 'ok';
  return hasData ? 'fresh' : 'rejected';
}
// Deterministic source accounting over ALL adapters: counts + identities for reused / fresh / rejected /
// contributing, plus the SEPARATE external-call total. These are the structured fields the report renders — the
// data-mode («свежий сбор» / «повторное использование» / «смешанный») is derived from these, never from call counts.
function sourceAccounting(adapters) {
  adapters = Array.isArray(adapters) ? adapters.filter(Boolean) : [];
  const buckets = { reused: [], fresh: [], rejected: [] };
  adapters.forEach(a => { buckets[classifyAdapterSource(a)].push(str(a.source) || str(a.source_run_id) || 'source'); });
  const uniq = arr => arr.filter((v, i) => arr.indexOf(v) === i);
  const fresh = uniq(buckets.fresh), reused = uniq(buckets.reused), rejected = uniq(buckets.rejected);
  const contributing = uniq(buckets.fresh.concat(buckets.reused));
  return {
    sources_fresh: buckets.fresh.length, fresh_sources: fresh,
    sources_reused: buckets.reused.length, reused_source_keys: reused,
    sources_rejected: buckets.rejected.length, rejected_sources: rejected,
    sources_contributing: contributing.length, contributing_source_keys: contributing,
    external_calls: adapters.reduce((s, a) => s + num(a.external_calls, 0), 0)
  };
}

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
  else if (roll.outcome === 'no_data') next_action = 'broaden sources/filters — no eligible data collected';
  else if (state === 'partial') next_action = 'review partial report; some sources failed/quarantined';
  else if (state === 'failed') next_action = blocking.length ? ('resolve: ' + blocking[0]) : 'inspect failed state events';
  else next_action = 'request in progress (' + state + ')';

  const acct = sourceAccounting(adapters);

  return {
    agent_request_id: str(req.agent_request_id),
    final_state: state,
    sources_requested: sourcesRequested.join(', '),
    // B6: requested source KEYS that failed/quarantined — the delivery layer names them for the user.
    failed_sources: (Array.isArray(req.failed_sources) ? req.failed_sources : (roll.failed_sources || [])),
    sources_completed: num(roll.sources_ok, adapters.filter(a => a.status === 'ok').length),
    sources_failed: num(roll.sources_failed, adapters.filter(a => a.status === 'failed').length),
    sources_quarantined: num(roll.sources_quarantined, adapters.filter(a => a.quarantined).length),
    // WIP3-A checked_sources: unique admitted sources actually used for THIS request — a source that produced
    // data or was accepted/reused, keyed by source_run_id (fallback: source key). A social source_analysis that
    // yields 0 competitor-profile rows still checked 1 source; this must never read 0 for a real collection.
    sources_checked: (function () {
      var seen = {};
      adapters.forEach(function (a) {
        if (!a) return;
        var admitted = a.status === 'ok' || a.execution_mode === 'reuse' || a.source_outcome === 'reused_snapshot' || a.outcome_has_data === true || num(a.items_written, 0) > 0;
        if (admitted) seen[str(a.source_run_id) || str(a.source) || JSON.stringify(a)] = true;
      });
      return Object.keys(seen).length;
    })(),
    records_received: num(roll.items_written, adapters.reduce((a, r) => a + num(r.items_received, 0), 0)),
    records_unique: num(analysis.records_unique, 0),
    records_eligible: num(analysis.records_eligible, 0),
    records_analyzed: num(analysis.records_analyzed, 0),
    records_reported: num(aggregation.rows_after_filters, num(report.rows_after_filters, 0)),
    // external COLLECTION calls (Firecrawl pages / Apify searches …). A COUNT OF CALLS — deliberately distinct from
    // the count of freshly collected SOURCES (sources_fresh): one source may cost several calls, a reused source none.
    external_calls: acct.external_calls,
    // REPORT-TRUTH-E (WF04→WF20): deterministic, call-count-independent source accounting. reuse/fresh/mixed is
    // derived downstream from THESE, never from external_calls. Identities travel alongside the counts so the report
    // can name which sources were reused vs freshly collected vs rejected.
    sources_fresh: acct.sources_fresh, fresh_sources: acct.fresh_sources,
    sources_reused: acct.sources_reused, reused_source_keys: acct.reused_source_keys,
    sources_rejected: acct.sources_rejected, rejected_sources: acct.rejected_sources,
    sources_contributing: acct.sources_contributing, contributing_source_keys: acct.contributing_source_keys,
    // SOURCE-REUSE-001: sources answered from a saved accepted snapshot ($0 collection). The delivery layer MUST
    // tell the user saved data was used and when it was really collected — a reuse must never look like a fresh scrape.
    reused_sources: adapters
      .filter(a => a && (a.source_outcome === 'reused_snapshot' || a.execution_mode === 'reuse'))
      .map(a => ({
        source: str(a.source),
        original_run_id: str(a.original_snapshot_run_id),
        original_collected_at: str(a.original_snapshot_collected_at)
      })),
    // STAGE-F §8: ONE canonical terminal outcome per source (website/telegram/vk/avito), so the Telegram
    // message, Sheets and the XLSX all render the same verdict + next action — never a raw enum, never disagreement.
    source_outcomes: adapters.filter(Boolean).map(a => ({
      source: str(a.source), outcome: str(a.source_outcome), label_ru: str(a.outcome_label_ru),
      has_data: a.outcome_has_data === true, retryable: a.outcome_retryable === true,
      items: num(a.items_written, 0), external_calls: num(a.external_calls, 0), cost_status: str(a.cost_status)
    })),
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

module.exports = { buildExecutionSummary, classifyAdapterSource, sourceAccounting };
