// report_gate.js — Stage C Closure Patch 2: the source_health gate consumed by WF10 + WF12.
//
// Pure, deterministic, NO network, $0. Turns a set of WF16 `source_health` rows into the run-level
// eligibility decisions that WF10 (aggregation) and WF12 (stakeholder report) MUST enforce before a run
// can appear as production market intelligence. WF10/WF12 each embed a mirror of these functions; the
// offline harness runs the real node code and asserts it equals this library (drift-proof, like WF16).
//
// A source run is EXCLUDED by default when any of these hold (section 4 of the closure brief):
//   report_eligible=false, quality_status=quarantined, data_mode=fixture, data_mode=manual_test,
//   review_status=pending, semantic validation failed, stale beyond the freshness window,
//   no compatible baseline (for trend comparison only — handled by selectBaseline).
// Degraded data is excluded by default and may be included ONLY through an explicit operator opt-in
// (allow_degraded_report=true), and then it MUST carry a visible quality warning. Fixture / manual_test
// data may be included ONLY when the operator explicitly generates a fixture report (allow_fixture_report)
// and then a TEST/FIXTURE watermark MUST be shown.
'use strict';

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function bool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = low(v);
  return s === 'true' || s === 'yes' || s === '1';
}

// Run-level exclusion reasons we surface to the operator (stable enum).
const EXCLUDE = {
  FIXTURE: 'data_mode=fixture',
  MANUAL_TEST: 'data_mode=manual_test',
  QUARANTINED: 'quality_status=quarantined',
  PENDING: 'review_status=pending',
  SEMANTIC: 'semantic_validation_failed',
  STALE: 'stale_source',
  NOT_ELIGIBLE: 'report_eligible=false',
  DEGRADED_NO_OPTIN: 'degraded_without_opt_in'
};

// Decide eligibility for ONE source_health row given the report/aggregation config.
function decideRun(h, cfg) {
  h = h || {};
  cfg = cfg || {};
  const allowDegraded = cfg.allow_degraded_report === true;
  const allowFixture = cfg.allow_fixture_report === true;
  const id = str(h.source_run_id);
  const data_mode = low(h.data_mode) || 'live';
  const quality_status = low(h.quality_status);
  const review_status = low(h.review_status);
  const flags = low(h.quality_flags);
  const reportEligibleFlag = (h.report_eligible === undefined) ? null : bool(h.report_eligible);

  const reasons = [];
  let degraded_included = false;
  let warning = '';

  if (data_mode === 'fixture') { if (allowFixture) warning = 'fixture'; else reasons.push(EXCLUDE.FIXTURE); }
  if (data_mode === 'manual_test') { if (allowFixture) warning = warning || 'manual_test'; else reasons.push(EXCLUDE.MANUAL_TEST); }
  if (quality_status === 'quarantined') reasons.push(EXCLUDE.QUARANTINED);
  if (review_status === 'pending' || /(^|; )pending_review/.test(flags)) reasons.push(EXCLUDE.PENDING);
  if (/semantic_validation_failed/.test(flags)) reasons.push(EXCLUDE.SEMANTIC);
  if (/(^|; )stale_source/.test(flags)) reasons.push(EXCLUDE.STALE);

  if (quality_status === 'degraded') {
    if (allowDegraded) { degraded_included = true; warning = warning || 'degraded'; }
    else reasons.push(EXCLUDE.DEGRADED_NO_OPTIN);
  }

  // WF16's own report_eligible=false is authoritative, UNLESS an explicit opt-in path (degraded/fixture)
  // is covering this run. This keeps WF16 the single source of truth while honoring operator overrides.
  const optedIn = degraded_included || (allowFixture && (data_mode === 'fixture' || data_mode === 'manual_test'));
  if (reportEligibleFlag === false && !optedIn && reasons.indexOf(EXCLUDE.NOT_ELIGIBLE) < 0) {
    reasons.push(EXCLUDE.NOT_ELIGIBLE);
  }

  const eligible = reasons.length === 0;
  return {
    source_run_id: id,
    eligible: eligible,
    degraded_included: eligible && degraded_included,
    quality_status: quality_status,
    data_mode: data_mode,
    review_status: review_status || (/(^|; )pending_review/.test(flags) ? 'pending' : ''),
    warning: eligible ? warning : '',
    reason: reasons.join('; ')
  };
}

// Build the eligibility index for a set of source_health rows.
function buildEligibility(healthRows, cfg) {
  healthRows = Array.isArray(healthRows) ? healthRows.filter(Boolean) : [];
  const decisions = healthRows.map(function (h) { return decideRun(h, cfg); });
  const index = {};
  decisions.forEach(function (d) { if (d.source_run_id) index[d.source_run_id] = d; });
  const eligible = decisions.filter(function (d) { return d.eligible; });
  const warnings = eligible.filter(function (d) { return d.warning; })
    .map(function (d) { return { source_run_id: d.source_run_id, warning: d.warning }; });
  return {
    decisions: decisions,
    index: index,
    eligible_run_ids: eligible.map(function (d) { return d.source_run_id; }),
    degraded_run_ids: eligible.filter(function (d) { return d.degraded_included; }).map(function (d) { return d.source_run_id; }),
    excluded_run_ids: decisions.filter(function (d) { return !d.eligible; }).map(function (d) { return d.source_run_id; }),
    warnings: warnings,
    has_warning: warnings.length > 0,
    has_fixture_warning: warnings.some(function (w) { return w.warning === 'fixture' || w.warning === 'manual_test'; }),
    has_degraded_included: eligible.some(function (d) { return d.degraded_included; })
  };
}

// Per-record gate: a record may enter intelligence only when its source run is eligible AND the record
// itself is not pending review / not an LLM-uncertain deterministic guess / not unopted fixture data.
function rowEligible(row, elig, cfg) {
  row = row || {};
  cfg = cfg || {};
  const allowFixture = cfg.allow_fixture_report === true;
  const id = str(row.source_run_id);
  const review = low(row.review_status);
  const parse = low(row.parse_method);
  const dm = low(row.data_mode);

  if (elig && elig.index && id && Object.prototype.hasOwnProperty.call(elig.index, id)) {
    const d = elig.index[id];
    if (!d.eligible) return { eligible: false, reason: 'run_excluded:' + d.reason, warning: '' };
  } else if (cfg.require_source_health === true && id) {
    return { eligible: false, reason: 'no_source_health', warning: '' };
  }
  if (review === 'pending') return { eligible: false, reason: EXCLUDE.PENDING, warning: '' };
  if (parse === 'deterministic_uncertain_no_llm') return { eligible: false, reason: 'parse_method=deterministic_uncertain_no_llm', warning: '' };
  if ((dm === 'fixture' || dm === 'manual_test') && !allowFixture) return { eligible: false, reason: 'data_mode=' + dm, warning: '' };
  const d = (elig && elig.index && id) ? elig.index[id] : null;
  return { eligible: true, reason: '', warning: (d && d.warning) || '' };
}

// WF12 trend baseline: pick the most recent PRIOR run that is comparable to the current snapshot.
// Compatible = same niche/region/service filters, live/compatible data_mode, report eligible, non-empty,
// and within a comparable time window. When none qualifies -> trend_status=no_compatible_baseline and
// items must NOT all be marked NEW.
function selectBaseline(candidates, current, cfg) {
  candidates = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  current = current || {};
  cfg = cfg || {};
  const cn = low(current.niche_id), cr = low(current.region), cs = low(current.service_filter);
  const curWin = Number(current.time_window_days) || Number(cfg.time_window_days) || 30;
  const compat = candidates.filter(function (b) {
    if (str(b.run_stamp) === str(current.run_stamp)) return false;     // not the current run
    if (cn && low(b.niche_id) && low(b.niche_id) !== cn) return false;
    if (cr && low(b.region) && low(b.region) !== cr) return false;
    if (cs && low(b.service_filter) && low(b.service_filter) !== cs) return false;
    if (b.data_mode && ['live', 'production'].indexOf(low(b.data_mode)) < 0) return false; // fixture/manual baselines excluded
    if (b.report_eligible === false) return false;
    if (Number(b.rows_after_filters) <= 0) return false;               // empty snapshot is not a baseline
    if (b.time_window_days && Number(b.time_window_days) !== curWin) return false; // comparable window
    return true;
  });
  compat.sort(function (a, b) { return str(a.run_stamp) < str(b.run_stamp) ? -1 : 1; });
  const baseline = compat.length ? compat[compat.length - 1] : null;
  return {
    baseline: baseline,
    trend_status: baseline ? 'baseline_selected' : 'no_compatible_baseline',
    baseline_run_stamp: baseline ? str(baseline.run_stamp) : ''
  };
}

// Render a trend marker for a frequency vs an optional previous frequency. NEVER produce a dangling
// "(x34 =)" — when there is no compatible baseline the marker is empty; an unchanged value renders no
// bare "=" suffix. (Closure C1-D1 / S3-D7.)
function trendMarker(freq, prevFreq, hasBaseline) {
  freq = Number(freq) || 0;
  if (!hasBaseline) return '';            // no baseline -> no suffix at all (not "NEW", not "=")
  if (prevFreq === undefined || prevFreq === null) return 'new';
  if (freq > prevFreq) return 'up';
  if (freq < prevFreq) return 'down';
  return 'flat';                          // unchanged -> a word, never a bare "="
}

// Compose the "(xN)" / "(xN, up)" suffix safely. Empty/whitespace markers never leave a dangling token.
function freqSuffix(freq, marker) {
  freq = Number(freq) || 0;
  const m = str(marker);
  return m ? ('(x' + freq + ', ' + m + ')') : ('(x' + freq + ')');
}

module.exports = {
  EXCLUDE, decideRun, buildEligibility, rowEligible, selectBaseline, trendMarker, freqSuffix
};
