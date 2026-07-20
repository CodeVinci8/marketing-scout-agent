// quality_gate.js — Stage C Hardening WF16 run-level + source-level health scoring engine.
//
// Pure, deterministic, NO network. Computes the source_health row that gates WF10/WF12 report generation.
// The WF16 workflow node embeds a mirror of computeRunHealth(); the offline harness runs the real node code.
//
// Scoring dimensions (weights, total 100):
//   transport_health        15
//   structural_validity     20
//   semantic_reliability    25
//   evidence_completeness   20
//   freshness               10
//   observability_cost      10
//
// quality_status: healthy >=80 & no critical flags; degraded 50-79 or recoverable; quarantined <50 or critical.
'use strict';

const QRULE_VERSION = 'qrule-v1.0';

// Flags that, if present, force quarantined regardless of numeric score.
const CRITICAL_FLAGS = [
  'semantic_validation_failed',
  'system_event_contamination',
  'no_detail_records',
  'search_cards_only',
  'broken_brand',
  'approval_gate_missing',
  'no_compatible_baseline'
];

function num(v, d) { const n = Number(v); return isNaN(n) ? (d == null ? 0 : d) : n; }
function rate(n, d) { d = num(d); return d > 0 ? (num(n) / d) : 0; }
function pct(x) { return Math.round(x * 1000) / 10; }

// records: array of NORMALIZED record descriptors. Each may carry:
//   structurally_valid, unique, duplicate, hard_skipped, irrelevant, report_candidate,
//   placeholder_title, missing_description, missing_seller_identity, missing_published_at,
//   exact_evidence_url (bool), unknown_service, generic_offer, primary_parse_failure, repaired,
//   fallback, raw_markdown_fallback, degraded, pending_review, system_event, fixture, manual_test,
//   published_at (iso), within_window (bool|undefined)
//
// run: a live_source_runs-shaped object (items_received, external_calls, llm_calls, cost fields, data_mode...).
// cfg: { now_iso, freshness_window_days, allow_degraded_report, source_run_id, agent_request_id }
function computeRunHealth(run, records, cfg) {
  run = run || {};
  records = records || [];
  cfg = cfg || {};
  const win = num(cfg.freshness_window_days, 30);
  const nowMs = cfg.now_iso ? Date.parse(cfg.now_iso) : Date.now();
  const data_mode = String(run.data_mode || cfg.data_mode || 'live').toLowerCase();

  const total = records.length;
  let search_card = 0;
  let detail_records = 0;
  let structurally_valid = 0, invalid = 0, unique = 0, duplicate = 0, hard_skipped = 0, irrelevant = 0,
    report_candidate = 0, placeholder = 0, missing_desc = 0, missing_id = 0, missing_pub = 0,
    has_evidence_url = 0, unknown_service = 0, generic_offer = 0, parse_failure = 0, repaired = 0,
    fallback = 0, raw_md_fallback = 0, degraded = 0, pending = 0, sysevent = 0, stale = 0, fresh_known = 0;
  let newest = null, oldest = null;

  for (const r of records) {
    if (r.structurally_valid === false) invalid++; else structurally_valid++;
    if (r.duplicate === true) duplicate++; else if (r.unique !== false) unique++;
    if (r.hard_skipped === true) hard_skipped++;
    if (r.irrelevant === true) irrelevant++;
    if (r.report_candidate === true) report_candidate++;
    if (r.search_card === true) search_card++;
    if (!(r.search_card === true) && r.is_detail !== false &&
        !(r.placeholder_title === true && r.missing_description === true)) detail_records++;
    if (r.placeholder_title === true) placeholder++;
    if (r.missing_description === true) missing_desc++;
    if (r.missing_seller_identity === true) missing_id++;
    if (r.missing_published_at === true) missing_pub++;
    if (r.exact_evidence_url === true) has_evidence_url++;
    if (r.unknown_service === true) unknown_service++;
    if (r.generic_offer === true) generic_offer++;
    if (r.primary_parse_failure === true) parse_failure++;
    if (r.repaired === true) repaired++;
    if (r.fallback === true) fallback++;
    if (r.raw_markdown_fallback === true) raw_md_fallback++;
    if (r.degraded === true) degraded++;
    if (r.pending_review === true) pending++;
    if (r.system_event === true) sysevent++;
    const p = Date.parse(r.published_at);
    if (!isNaN(p)) {
      fresh_known++;
      if (newest === null || p > newest) newest = p;
      if (oldest === null || p < oldest) oldest = p;
      const age = Math.floor((nowMs - p) / 86400000);
      const within = (r.within_window != null) ? r.within_window : (age <= win);
      if (!within) stale++;
    }
  }

  const items_received = num(run.items_received, total);
  const noData = (total === 0 && items_received === 0);

  // ---- rates ----
  const rates = {
    structurally_valid_rate: pct(rate(structurally_valid, total)),
    invalid_rate: pct(rate(invalid, total)),
    duplicate_rate: pct(rate(duplicate, total)),
    hard_skip_rate: pct(rate(hard_skipped, total)),
    irrelevant_rate: pct(rate(irrelevant, total)),
    unknown_service_rate: pct(rate(unknown_service, total)),
    generic_offer_rate: pct(rate(generic_offer, total)),
    placeholder_title_rate: pct(rate(placeholder, total)),
    missing_description_rate: pct(rate(missing_desc, total)),
    missing_identity_rate: pct(rate(missing_id, total)),
    missing_published_at_rate: pct(rate(missing_pub, total)),
    exact_evidence_url_rate: pct(rate(has_evidence_url, total)),
    primary_parse_failure_rate: pct(rate(parse_failure, total)),
    repair_rate: pct(rate(repaired, total)),
    fallback_rate: pct(rate(fallback, total)),
    degraded_record_rate: pct(rate(degraded, total)),
    pending_review_rate: pct(rate(pending, total)),
    stale_rate: pct(rate(stale, total))
  };

  // ---- quality flags ----
  const flags = [];
  if (data_mode === 'fixture') flags.push('fixture_data');
  if (data_mode === 'manual_test') flags.push('manual_test_data');
  if (total > 0 && stale === fresh_known && fresh_known > 0) flags.push('stale_source');
  if (total > 0 && placeholder === total) flags.push('placeholder_titles');
  else if (placeholder > 0) flags.push('placeholder_titles');
  if (total > 0 && report_candidate === 0 && ((search_card > 0 && (search_card + irrelevant + hard_skipped) >= total) || (placeholder + missing_desc) >= total)) flags.push('search_cards_only');
  // DETAIL-QUALITY-001: this flag is CRITICAL (it quarantines the run), so it must mean what it says — the run
  // produced NO detail record. It previously fired on `report_candidate===0 && degraded>0`, which is a statement
  // about ELIGIBILITY, not about record existence: a genuine detail record that was merely pending or degraded
  // quarantined a score-81 run and told the operator to investigate a flag that was not true (live: WF16 exec 930,
  // autolombardn1.ru — is_detail=true, search_card=false, repaired but valid).
  // Detail presence is judged from the RECORD's own shape, never from a downstream eligibility verdict:
  // a search card, or a placeholder title with no description (the Avito search-card shape), is not a detail
  // record; anything else that reached us is. Low quality / pending / repaired all still raise their OWN flags.
  if (total > 0 && detail_records === 0 && hard_skipped < total) flags.push('no_detail_records');
  if (rates.missing_identity_rate >= 60) flags.push('missing_seller_identity');
  if (rates.missing_description_rate >= 60) flags.push('missing_descriptions');
  if (rates.missing_published_at_rate >= 60) flags.push('missing_published_at');
  if (rates.exact_evidence_url_rate < 100 && total > 0) flags.push('missing_exact_evidence_url');
  if (rates.unknown_service_rate >= 50) flags.push('high_unknown_service_rate');
  if (rates.generic_offer_rate >= 50) flags.push('high_generic_offer_rate');
  if (rates.repair_rate >= 40) flags.push('high_repair_rate');
  if (fallback > 0) flags.push('deterministic_fallback');
  if (raw_md_fallback > 0) flags.push('raw_markdown_fallback');
  if (run.broken_brand === true) flags.push('broken_brand');
  if (run.taxonomy_drift === true || unknown_service > 0 && rates.unknown_service_rate >= 50) flags.push('taxonomy_drift');
  if (sysevent > 0) flags.push('system_event_contamination');
  if (pending > 0) flags.push('pending_review');
  if (num(run.semantic_validation_failed_count) > 0) flags.push('semantic_validation_failed');
  const source_cost_status = String(run.source_cost_status || (num(run.external_calls) > 0 ? 'unknown' : 'not_applicable')).toLowerCase();
  const llm_cost_status = String(run.llm_cost_status || (num(run.llm_calls) > 0 ? 'unknown' : 'not_applicable')).toLowerCase();
  if (source_cost_status === 'unknown' || llm_cost_status === 'unknown') flags.push('cost_unknown');
  if (run.approval_gate_missing === true) flags.push('approval_gate_missing');
  if (noData) flags.push('no_compatible_baseline');

  // ---- dimension scores ----
  // transport_health (15): items arrived and external transport did not fail.
  let d_transport;
  if (noData) d_transport = 0;
  else if (run.transport_failed === true) d_transport = 5;
  else d_transport = 15;

  // structural_validity (20)
  const d_structural = noData ? 0 : Math.round((rate(structurally_valid, total)) * 20);

  // semantic_reliability (25): low parse-failure, low repair, low unknown-service, low generic-offer, no sysevent.
  let semFactor = 1;
  semFactor -= rate(parse_failure, total) * 0.5;
  semFactor -= Math.max(0, rate(repaired, total) - 0.2) * 0.5;
  semFactor -= rate(unknown_service, total) * 0.3;
  semFactor -= rate(generic_offer, total) * 0.3;
  semFactor -= rate(sysevent, total) * 0.6;
  semFactor -= rate(pending, total) * 0.3;
  if (semFactor < 0) semFactor = 0;
  const d_semantic = noData ? 0 : Math.round(semFactor * 25);

  // evidence_completeness (20)
  let evFactor = rate(has_evidence_url, total) * 0.4 + (1 - rate(placeholder, total)) * 0.3 + (1 - rate(missing_desc, total)) * 0.3;
  if (evFactor < 0) evFactor = 0; if (evFactor > 1) evFactor = 1;
  const d_evidence = noData ? 0 : Math.round(evFactor * 20);

  // freshness (10)
  const d_freshness = (fresh_known === 0) ? (noData ? 0 : 5) : Math.round((1 - rate(stale, fresh_known)) * 10);

  // observability_cost (10): cost recovered or not-applicable, approval gate present.
  let d_cost = 10;
  if (source_cost_status === 'unknown') d_cost -= 4;
  if (llm_cost_status === 'unknown') d_cost -= 3;
  if (run.approval_gate_missing === true) d_cost -= 3;
  if (d_cost < 0) d_cost = 0;

  const quality_score = noData ? 0 : (d_transport + d_structural + d_semantic + d_evidence + d_freshness + d_cost);

  // ---- critical flag intersection ----
  const hasCritical = flags.some(function (f) { return CRITICAL_FLAGS.indexOf(f) >= 0; });
  // fixture/manual_test are not "critical" for scoring but force report ineligibility below.

  let quality_status;
  if (noData) quality_status = 'quarantined';
  else if (hasCritical || quality_score < 50) quality_status = 'quarantined';
  else if (quality_score >= 80) quality_status = 'healthy';
  else quality_status = 'degraded';

  // ---- eligibility ----
  const isProductionMode = (data_mode === 'live');
  let report_eligible = isProductionMode && quality_status !== 'quarantined' && !noData;
  // degraded allowed into reports only with explicit config + visible warning.
  if (quality_status === 'degraded') {
    report_eligible = isProductionMode && cfg.allow_degraded_report === true;
    if (report_eligible) flags.push('report_quality_warning');
  }
  let llm_eligible = !noData && quality_status !== 'quarantined' && unique > 0;
  // duplicate-only or irrelevant-only batches are not worth LLM spend.
  if (unique === 0 || (irrelevant + hard_skipped) >= total) llm_eligible = false;
  // a run whose records are all pending review is never report/LLM eligible (Obj4 #4).
  if (total > 0 && pending === total) { report_eligible = false; llm_eligible = false; }

  // ---- operator next action ----
  let operator_next_action;
  if (noData) operator_next_action = 'No data: re-run the source connector with a valid allowlist/run filter before any report. Do NOT treat as a baseline.';
  else if (quality_status === 'quarantined') operator_next_action = 'QUARANTINED: exclude from stakeholder report. Investigate critical flags (' + flags.filter(f => CRITICAL_FLAGS.indexOf(f) >= 0).join(', ') + '). Fix source/enrichment, then re-run.';
  else if (quality_status === 'degraded') operator_next_action = 'DEGRADED: excluded from report by default. Enable allow_degraded_report only with a visible TEST/QUALITY warning, or improve evidence/freshness and re-run.';
  else operator_next_action = 'HEALTHY: eligible for stakeholder intelligence and (where unique>0) LLM analysis.';

  return {
    quality_evaluation_id: 'qhealth_' + String(cfg.source_run_id || run.run_id || run.source_run_id || 'run') + '_' + (cfg.stamp || ''),
    evaluated_at: cfg.now_iso || new Date().toISOString(),
    source_run_id: run.source_run_id || run.run_id || cfg.source_run_id || '',
    agent_request_id: run.agent_request_id || cfg.agent_request_id || '',
    workflow: run.workflow || '',
    source_family: run.source_family || '',
    platform: run.platform || '',
    source_key: run.source_key || run.source_allowlist || '',
    data_mode: data_mode,
    items_received: items_received,
    structurally_valid_items: structurally_valid,
    invalid_items: invalid,
    unique_items: unique,
    duplicate_items: duplicate,
    hard_skipped_items: hard_skipped,
    irrelevant_items: irrelevant,
    report_candidate_items: report_candidate,
    newest_published_at: newest ? new Date(newest).toISOString() : '',
    oldest_published_at: oldest ? new Date(oldest).toISOString() : '',
    source_staleness_days: newest ? Math.floor((nowMs - newest) / 86400000) : null,
    external_calls: num(run.external_calls),
    llm_calls: num(run.llm_calls),
    actual_source_cost_usd: (source_cost_status === 'known') ? num(run.actual_source_cost_usd) : null,
    actual_llm_cost_usd: (llm_cost_status === 'known') ? num(run.actual_llm_cost_usd) : null,
    source_cost_status: source_cost_status,
    llm_cost_status: llm_cost_status,
    cost_per_unique_record: (llm_cost_status === 'known' && unique > 0) ? Math.round((num(run.actual_llm_cost_usd) / unique) * 10000) / 10000 : null,
    dimension_scores: { transport: d_transport, structural: d_structural, semantic: d_semantic, evidence: d_evidence, freshness: d_freshness, observability_cost: d_cost },
    quality_score: quality_score,
    quality_status: quality_status,
    report_eligible: report_eligible,
    llm_eligible: llm_eligible,
    quality_flags: Array.from(new Set(flags)),
    operator_next_action: operator_next_action,
    taxonomy_version: cfg.taxonomy_version || 'semantic-v2.0',
    quality_rule_version: QRULE_VERSION,
    rates: rates
  };
}

module.exports = { computeRunHealth, QRULE_VERSION, CRITICAL_FLAGS };
