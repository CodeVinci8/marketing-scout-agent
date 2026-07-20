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

// STAGE-F §8 — the ONE canonical terminal outcome per source. Website (WF04) already declares these; Telegram
// (WF11) and VK (WF26) predate the contract, so their outcome is DERIVED here from the normalized counts + error
// signals. Exactly one per source, so outcome / cost / next action / Telegram / Sheets / XLSX cannot disagree.
const SOURCE_OUTCOMES = {
  COLLECTED: 'collected_with_data', REFRESHED: 'refreshed_with_data', REUSED: 'reused_snapshot',
  BLOCKED: 'blocked', ACCESS_DENIED: 'access_denied', PROVIDER_FAILED: 'provider_failed',
  TIMEOUT: 'timeout', EMPTY: 'empty_response', UNSUPPORTED: 'unsupported_content',
  NO_RELEVANT: 'no_relevant_content', QUALITY_REJECTED: 'quality_rejected'
};
const SOURCE_OUTCOME_SET = Object.keys(SOURCE_OUTCOMES).map(k => SOURCE_OUTCOMES[k]);
// Russian labels + a bounded next-action per outcome — user-facing surfaces render from THIS map, never a raw enum.
const SOURCE_OUTCOME_RU = {
  collected_with_data: 'собраны свежие данные', refreshed_with_data: 'данные обновлены (повторный сбор)',
  reused_snapshot: 'использован сохранённый снимок', blocked: 'источник заблокирован (защита от ботов)',
  access_denied: 'доступ к источнику закрыт', provider_failed: 'сбой поставщика данных',
  timeout: 'источник не ответил вовремя', empty_response: 'источник не вернул данных',
  unsupported_content: 'неподдерживаемый тип содержимого', no_relevant_content: 'подходящих данных не найдено',
  quality_rejected: 'данные отклонены контролем качества'
};
function sourceOutcomeRu(o) { return SOURCE_OUTCOME_RU[str(o)] || 'состояние источника не определено'; }
// A retryable outcome may succeed later (a transient block/timeout/provider blip); a structural one will not.
function sourceOutcomeRetryable(o) {
  return ['blocked', 'provider_failed', 'timeout', 'empty_response'].indexOf(str(o)) >= 0;
}
function sourceOutcomeHasData(o) {
  return ['collected_with_data', 'refreshed_with_data', 'reused_snapshot'].indexOf(str(o)) >= 0;
}

// Map a collector's freeform error strings onto an access/provider failure outcome. An error we cannot classify
// is still a failure (provider_failed) — never silently treated as success.
function classifyErrorOutcome(errors) {
  const blob = [].concat(errors || []).map(str).join(' ').toLowerCase();
  if (!blob) return '';
  if (/timeout|timed out|etimedout|deadline|esockettimedout/.test(blob)) return SOURCE_OUTCOMES.TIMEOUT;
  if (/(^|\D)429(\D|$)|rate.?limit|waf|captcha|cloudflare|challenge|too many requests|\bblocked\b/.test(blob)) return SOURCE_OUTCOMES.BLOCKED;
  if (/(^|\D)40[13](\D|$)|forbidden|unauthor|access.?denied|robots|login required|private/.test(blob)) return SOURCE_OUTCOMES.ACCESS_DENIED;
  if (/unsupported|content.?type|not.?html|binary|mime/.test(blob)) return SOURCE_OUTCOMES.UNSUPPORTED;
  return SOURCE_OUTCOMES.PROVIDER_FAILED;
}

// deriveSourceOutcome(a) -> the ONE terminal outcome for a normalized adapter result.
// Priority: connector-declared valid outcome > quality rejection > access/provider failure > reuse > has-data >
// came-back-but-nothing-usable > nothing-came-back. items_relevant is a DOWNSTREAM (WF16) verdict and is NOT used
// here, so a healthy collect is never mislabeled no_relevant just because relevance hasn't been scored yet.
function deriveSourceOutcome(a) {
  a = a || {};
  const declared = str(a.source_outcome);
  if (SOURCE_OUTCOME_SET.indexOf(declared) >= 0) return declared;      // website speaks the contract already
  if (a.quarantined === true || str(a.status) === 'quarantined') return SOURCE_OUTCOMES.QUALITY_REJECTED;
  const errs = [].concat(a.errors || []).map(str).filter(Boolean);
  const written = num(a.items_written, 0), received = num(a.items_received, 0);
  const mode = str(a.execution_mode);
  if (errs.length && written === 0) return classifyErrorOutcome(errs) || SOURCE_OUTCOMES.PROVIDER_FAILED;
  if (mode === 'reuse' || (num(a.reused_count, 0) > 0 && written === 0)) return SOURCE_OUTCOMES.REUSED;
  if (written > 0) return mode === 'refresh' ? SOURCE_OUTCOMES.REFRESHED : SOURCE_OUTCOMES.COLLECTED;
  if (received > 0) return SOURCE_OUTCOMES.NO_RELEVANT;                 // came back, nothing usable persisted
  return SOURCE_OUTCOMES.EMPTY;                                        // nothing came back at all
}

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

  const result = {
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
    // SOURCE-REUSE-001 / STAGE-F §8: typed execution mode + ONE canonical terminal outcome + reuse lineage.
    // A connector that already declares them (website WF04) is authoritative; Telegram/VK/Avito get the outcome
    // DERIVED from these normalized counts so exactly one terminal outcome exists per source.
    execution_mode: str(raw.execution_mode),
    source_outcome: str(raw.source_outcome),
    reused_count: num(raw.reused_count, 0),
    original_snapshot_run_id: str(raw.original_snapshot_run_id),
    original_snapshot_collected_at: str(raw.original_snapshot_collected_at)
  };
  result.source_outcome = deriveSourceOutcome(result);
  // Backfill the execution mode from the outcome when the connector didn't declare one (never overwrite a real one).
  if (!result.execution_mode) {
    result.execution_mode = result.source_outcome === SOURCE_OUTCOMES.REUSED ? 'reuse'
      : result.source_outcome === SOURCE_OUTCOMES.REFRESHED ? 'refresh' : 'collect';
  }
  result.outcome_label_ru = sourceOutcomeRu(result.source_outcome);
  result.outcome_has_data = sourceOutcomeHasData(result.source_outcome);
  result.outcome_retryable = sourceOutcomeRetryable(result.source_outcome);
  return result;
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

module.exports = {
  FAMILIES, normalizeAdapterResult, rollupCollection,
  SOURCE_OUTCOMES, SOURCE_OUTCOME_SET, SOURCE_OUTCOME_RU,
  deriveSourceOutcome, classifyErrorOutcome, sourceOutcomeRu, sourceOutcomeRetryable, sourceOutcomeHasData
};
