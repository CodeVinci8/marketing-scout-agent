'use strict';
// parse_outcome.js — PARSE-OUTCOME-001. The ONE mapping from "how did the LLM parse go?" to a quality verdict.
//
// OPERATOR DECISION (2026-07-17): a single successful bounded repair is an ACCEPTABLE result when — and only
// when — the repaired payload passed full local schema validation, required fields are present, evidence
// references are valid, structural/semantic rules pass, no forbidden data is present, and no second repair was
// needed. Such a result is marked repaired / accepted_with_repair, audited, and CONFIDENCE-CAPPED — but it is NOT
// placed into pending human review and NOT quarantined merely because a repair was used.
//
// Why this existed as a defect: WF04 stamped `repair_used === true` -> quality_status='degraded' ->
// review_status='pending'. Live (autolombardn1.ru, WF04 exec 929) the repair SUCCEEDED and produced excellent data
// (company, full offer text, service, valid evidence url) — yet the record was degraded+pending, so WF16 derived
// report_candidate=false, raised the CRITICAL `no_detail_records` flag, quarantined a score-81 run, and WF10
// dropped it. The report was empty and WF28 never ran. Meanwhile WF28 (Stage F) already treats a successful repair
// as shippable (`quality_status='repaired'`, enriched=true, live-proven exec 834). Two of our own contracts
// disagreed; this lib is the single place they now agree.
//
// A FAILED repair, invalid evidence, semantic failure, malformed result or fallback-only result stays FAIL-CLOSED.
//
// Embeddable: unique po*-prefixed names, no cross-lib require.

function poStr(v) { return v == null ? '' : String(v); }
function poLow(v) { return poStr(v).trim().toLowerCase(); }
function poBool(v) { return v === true || poLow(v) === 'true'; }

// The canonical parse outcomes. Anything else is unknown -> treated as invalid (fail-closed).
var PARSE_OUTCOMES = {
  PRIMARY_VALID: 'primary_valid',                 // first parse validated cleanly
  REPAIRED_VALID: 'repaired_valid',               // ONE repair, payload fully validated
  DETERMINISTIC_FALLBACK: 'deterministic_fallback', // no successful LLM parse; deterministic facts only
  INVALID: 'invalid',                             // malformed / failed validation / repair failed
  PROVIDER_FAILED: 'provider_failed'              // transport/provider error; nothing was parsed
};
// Quality verdicts this lib may assign. 'accepted_with_repair' is the new, audited middle state.
var PO_QUALITY = {
  HEALTHY: 'healthy',
  ACCEPTED_WITH_REPAIR: 'accepted_with_repair',
  DEGRADED: 'degraded',
  QUARANTINED: 'quarantined'
};
// A repaired result is trustworthy enough to report, but never as trustworthy as a clean primary parse. ONE
// documented rule: cap it. (The evidence is identical; only our confidence in the extraction is lower.)
var PO_REPAIRED_CONFIDENCE_CAP = 75;
// The contract is ONE bounded repair. A second repair is never "accepted_with_repair".
var PO_MAX_REPAIRS = 1;

// Quality verdicts that may enter a report / feed Claude.
function poIsAccepted(q) { return q === PO_QUALITY.HEALTHY || q === PO_QUALITY.ACCEPTED_WITH_REPAIR; }
function poIsRepaired(q) { return q === PO_QUALITY.ACCEPTED_WITH_REPAIR; }

// classifyParseOutcome(rec) -> one of PARSE_OUTCOMES.
// rec: { processing_status, parse_method, repair_used, repair_status, repair_count, validation_ok,
//        evidence_valid, has_evidence }
function classifyParseOutcome(rec) {
  rec = rec || {};
  var ps = poLow(rec.processing_status);
  var pm = poLow(rec.parse_method);
  var repairStatus = poLow(rec.repair_status);
  var repairUsed = poBool(rec.repair_used);
  var repairs = Number(rec.repair_count);
  if (!isFinite(repairs)) repairs = repairUsed ? 1 : 0;

  if (ps === 'provider_failed' || pm === 'firecrawl_error' || poLow(rec.access_failure) === 'true') return PARSE_OUTCOMES.PROVIDER_FAILED;
  if (ps === 'technical_error') return PARSE_OUTCOMES.INVALID;
  // an explicit deterministic fallback never claims a successful LLM parse
  if (pm === 'deterministic_competitor_fallback' || pm === 'deterministic_fallback' || repairStatus === 'failed_fallback') {
    return PARSE_OUTCOMES.DETERMINISTIC_FALLBACK;
  }
  // hard local gates — these fail closed regardless of how the parse got here
  if (rec.validation_ok === false || rec.evidence_valid === false) return PARSE_OUTCOMES.INVALID;
  if (rec.has_evidence === false) return PARSE_OUTCOMES.INVALID;
  if (repairUsed || pm === 'repaired_json') {
    if (repairStatus === 'failed' || repairs > PO_MAX_REPAIRS) return PARSE_OUTCOMES.INVALID; // >1 repair is never accepted
    return PARSE_OUTCOMES.REPAIRED_VALID;
  }
  if (ps === 'parsed_success' || pm === 'primary_json' || pm === '') return PARSE_OUTCOMES.PRIMARY_VALID;
  return PARSE_OUTCOMES.PRIMARY_VALID;
}

// qualityForOutcome(outcome, opts) -> { quality_status, review_status, report_candidate, flags[],
//                                       confidence_cap, repair_used, repair_success }
// `report_candidate` here is the PARSE dimension only — business relevance, access status and evidence quality are
// decided elsewhere and still apply. Repair status alone must never decide relevance or source health.
function qualityForOutcome(outcome, opts) {
  opts = opts || {};
  var isCompetitor = opts.is_competitor !== false;
  switch (outcome) {
    case PARSE_OUTCOMES.PRIMARY_VALID:
      return { quality_status: PO_QUALITY.HEALTHY, review_status: 'confirmed', report_candidate: isCompetitor,
        flags: [], confidence_cap: null, repair_used: false, repair_success: false };
    case PARSE_OUTCOMES.REPAIRED_VALID:
      // audited + capped, but reportable: the payload passed the SAME local validation as a primary parse.
      return { quality_status: PO_QUALITY.ACCEPTED_WITH_REPAIR, review_status: 'confirmed', report_candidate: isCompetitor,
        flags: ['repaired_parse'], confidence_cap: PO_REPAIRED_CONFIDENCE_CAP, repair_used: true, repair_success: true };
    case PARSE_OUTCOMES.DETERMINISTIC_FALLBACK:
      // deterministic facts may still ship, but we never claim a successful enrichment.
      return { quality_status: PO_QUALITY.DEGRADED, review_status: 'pending', report_candidate: false,
        flags: ['deterministic_fallback'], confidence_cap: 50, repair_used: false, repair_success: false };
    case PARSE_OUTCOMES.PROVIDER_FAILED:
      return { quality_status: PO_QUALITY.QUARANTINED, review_status: 'pending', report_candidate: false,
        flags: ['provider_failed'], confidence_cap: 10, repair_used: false, repair_success: false };
    default: // INVALID
      return { quality_status: PO_QUALITY.QUARANTINED, review_status: 'pending', report_candidate: false,
        flags: ['parse_invalid'], confidence_cap: 10, repair_used: false, repair_success: false };
  }
}

// Apply the documented confidence rule. A repaired result is capped, never boosted.
function poCapConfidence(score, outcome) {
  var n = Number(score); if (!isFinite(n)) n = 0;
  var q = qualityForOutcome(outcome, {});
  if (q.confidence_cap == null) return n;
  return Math.min(n, q.confidence_cap);
}

module.exports = {
  PARSE_OUTCOMES, PO_QUALITY, PO_REPAIRED_CONFIDENCE_CAP, PO_MAX_REPAIRS,
  classifyParseOutcome, qualityForOutcome, poCapConfidence, poIsAccepted, poIsRepaired
};
