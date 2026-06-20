'use strict';
// source_adapter.js — Stage 4 source adapter contract (B6).
//
// Every collector (website/Firecrawl WF04, Avito WF09, VK WF11, ...) is wrapped to return ONE canonical
// shape so the orchestrator never reaches into source-specific fields. normalizeAdapterResult() maps a
// raw collector summary onto the contract and decides the next orchestration state from the outcome.
// For the MVP the website family is first-class; Avito is an experimental search-card discovery adapter;
// VK is optional and its absence must not break the website E2E.

function str(v) { return v == null ? '' : String(v).trim(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

const FAMILIES = {
  website: { family: 'website', platform: 'website', first_class: true },
  avito: { family: 'classifieds', platform: 'avito', first_class: false, experimental: true },
  vk: { family: 'social', platform: 'vk', first_class: false, optional: true }
};

// raw: a collector's live_source_runs-shaped summary (already produced by WF04/WF09/WF11).
// Returns the canonical adapter result + the orchestration state this outcome implies.
function normalizeAdapterResult(sourceKey, raw, ctx) {
  raw = raw || {}; ctx = ctx || {};
  const fam = FAMILIES[str(sourceKey).toLowerCase()] || { family: 'unknown', platform: str(sourceKey).toLowerCase(), first_class: false };
  const received = num(raw.items_received, num(raw.items_collected, 0));
  const written = num(raw.items_written, num(raw.records_written, received));
  const relevant = num(raw.items_relevant, 0);
  const quarantined = (str(raw.quality_status).toLowerCase() === 'quarantined') || raw.quarantined === true || str(raw.critical_flags) !== '';
  const errors = [].concat(raw.errors || []).map(str).filter(Boolean);
  if (raw.error) errors.unshift(str(raw.error));

  let next_state, status;
  if (quarantined) { status = 'quarantined'; next_state = 'quality_check'; }
  else if (errors.length && written === 0) { status = 'failed'; next_state = 'failed'; }
  else if (written === 0) { status = 'empty'; next_state = 'quality_check'; }
  else { status = 'ok'; next_state = 'quality_check'; }

  return {
    agent_request_id: str(raw.agent_request_id) || str(ctx.agent_request_id),
    source: str(sourceKey).toLowerCase(),
    source_family: fam.family,
    platform: str(raw.platform) || fam.platform,
    data_mode: str(raw.data_mode) || 'live',
    source_run_id: str(raw.source_run_id) || str(raw.run_id),
    workflow_run_id: str(raw.workflow_run_id),
    items_requested: num(raw.items_requested, num(ctx.requested, 0)),
    items_received: received,
    items_written: written,
    items_relevant: relevant,
    external_calls: num(raw.external_calls, num(raw.api_calls, 0)),
    cost_status: str(raw.cost_status) || 'unknown',      // never fake $0
    cost_usd: (raw.cost_usd === undefined || raw.cost_usd === null) ? null : num(raw.cost_usd, null),
    quarantined: quarantined,
    first_class: !!fam.first_class,
    experimental: !!fam.experimental,
    optional: !!fam.optional,
    status: status,
    errors: errors,
    next_state: next_state
  };
}

// Roll several adapter results into the request-level collection outcome: completed / partial / no_data.
function rollupCollection(results) {
  results = Array.isArray(results) ? results.filter(Boolean) : [];
  const ok = results.filter(r => r.status === 'ok');
  const failed = results.filter(r => r.status === 'failed');
  const quarantined = results.filter(r => r.quarantined);
  const written = results.reduce((a, r) => a + num(r.items_written, 0), 0);
  let outcome;
  if (results.length === 0) outcome = 'no_data';
  else if (ok.length === 0) outcome = 'no_data';               // all failed / empty / quarantined
  else if (failed.length || quarantined.length || ok.length < results.length) outcome = 'partial';
  else outcome = 'complete';
  return {
    outcome: outcome,
    sources_total: results.length,
    sources_ok: ok.length,
    sources_failed: failed.length,
    sources_quarantined: quarantined.length,
    items_written: written
  };
}

module.exports = { FAMILIES, normalizeAdapterResult, rollupCollection };
