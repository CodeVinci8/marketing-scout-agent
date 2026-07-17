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
  telegram: { family: 'social', platform: 'telegram', first_class: false, optional: true },
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
    next_state: next_state,
    // SOURCE-REUSE-001: typed execution mode + outcome + reuse lineage from the connector's run summary.
    // Empty when the connector predates the contract — consumers must treat '' as "collect" era, not as reuse.
    execution_mode: str(raw.execution_mode),
    source_outcome: str(raw.source_outcome),
    reused_count: num(raw.reused_count, 0),
    original_snapshot_run_id: str(raw.original_snapshot_run_id),
    original_snapshot_collected_at: str(raw.original_snapshot_collected_at)
  };
}

// Roll several adapter results into the request-level collection outcome.
// B6: the TERMINAL status is decided ONLY by the sources the user actually REQUESTED. Optional/unrequested
// branches the orchestrator may add (e.g. a preset TG/VK) can neither downgrade a successful requested run to
// partial nor rescue a failed one. `requestedSources` = the plan's source keys (website/telegram/vk/avito/…);
// when omitted, behaviour falls back to "all results decide" (legacy). Outcome semantics over the DECIDING set:
//   complete = every requested source ok · partial = some ok, some failed/quarantined (names the failed) ·
//   failed = all requested sources errored · no_data = requested sources ran but yielded nothing (no error).
function rollupCollection(results, requestedSources) {
  results = Array.isArray(results) ? results.filter(Boolean) : [];
  const req = Array.isArray(requestedSources) ? requestedSources.map(s => str(s).toLowerCase()).filter(Boolean) : null;
  const deciding = (req && req.length) ? results.filter(r => req.indexOf(str(r.source).toLowerCase()) >= 0) : results;
  const ok = deciding.filter(r => r.status === 'ok');
  const failed = deciding.filter(r => r.status === 'failed');
  const quarantined = deciding.filter(r => r.quarantined);
  const written = deciding.reduce((a, r) => a + num(r.items_written, 0), 0);
  const failed_sources = failed.concat(quarantined).map(r => str(r.source).toLowerCase())
    .filter((v, i, a) => v && a.indexOf(v) === i);
  let outcome;
  if (deciding.length === 0) outcome = 'no_data';                       // nothing requested produced a result
  else if (ok.length === 0 && failed.length > 0) outcome = 'failed';    // a requested source ERRORED and none ok
  else if (ok.length === 0) outcome = 'no_data';                        // ran but nothing usable (empty/quarantined), no hard error
  else if (failed.length || quarantined.length || ok.length < deciding.length) outcome = 'partial';
  else outcome = 'complete';
  return {
    outcome: outcome,
    sources_total: results.length,                 // everything that ran (incl. optional)
    sources_requested: deciding.length,            // the requested subset that decides the outcome
    sources_ok: ok.length,
    sources_failed: failed.length,
    sources_quarantined: quarantined.length,
    failed_sources: failed_sources,                // requested source KEYS that failed (for the user message)
    items_written: written
  };
}

module.exports = { FAMILIES, normalizeAdapterResult, rollupCollection };
