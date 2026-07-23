'use strict';
// analysis_router.js — F-7 ANALYSIS-ROUTE-001. THE canonical decision of which Stage-F analysis actually runs.
//
// Before this module, `analysis_mode` was a LABEL: request_planner set it (2 named sources -> 'comparison',
// >=3 -> 'synthesis'), plan_render_ru PROMISED «сравнение указанных источников» in the approval message, the
// progress UI showed «Сравниваю результаты» — and WF28 unconditionally called analyzeSource once per source.
// `analysis_type` only ever entered the CACHE KEY. So a user who named two competitors was told, in writing,
// that a comparison would be produced, and never received one.
//
// Two invariants this module exists to enforce:
//   1. A mode is only honoured when the evidence can actually support it. Comparison needs >=2 sources that
//      genuinely contribute evidence; synthesis needs >=3. One source can NEVER masquerade as a comparison.
//   2. When the evidence cannot support the requested mode, we DOWNGRADE explicitly and say why, rather than
//      silently producing a single-source analysis under a comparison label.
//
// "Contributing" is deliberately strict: a target only counts if it carries at least one citable evidence item.
// A source that collected nothing must not inflate the mode — that is how a one-source report would acquire a
// market-wide voice.
//
// PURE. No I/O, no provider calls. Embeddable: ar*-prefixed names.

function arStr(v) { return v == null ? '' : String(v); }
function arLow(v) { return arStr(v).trim().toLowerCase(); }

// Canonical Stage-F execution modes. `single_source` is the legacy alias of `source_analysis` (cache lineage).
var AR_MODE_SOURCE = 'source_analysis';
var AR_MODE_COMPARISON = 'comparison';
var AR_MODE_SYNTHESIS = 'synthesis';
var AR_MODE_CHANGE = 'change_report';
var AR_MODE_CANDIDATE = 'candidate';
var AR_MODE_LEAD = 'public_lead';

var AR_MIN_SOURCES = {};
AR_MIN_SOURCES[AR_MODE_COMPARISON] = 2;
AR_MIN_SOURCES[AR_MODE_SYNTHESIS] = 3;

// Which canonical implementation serves a resolved mode.
var AR_IMPL = {};
AR_IMPL[AR_MODE_SOURCE] = 'analyzeSource';
AR_IMPL[AR_MODE_CHANGE] = 'analyzeSource';
AR_IMPL[AR_MODE_COMPARISON] = 'analyzeComparison';
AR_IMPL[AR_MODE_SYNTHESIS] = 'analyzeComparison';
AR_IMPL[AR_MODE_CANDIDATE] = 'enrichCandidate';
AR_IMPL[AR_MODE_LEAD] = 'interpretPublicLead';

// Multi-source modes share the synthesis contract (ccSynthesisTool / CC_SYNTHESIS_SCHEMA).
function arIsMultiSource(mode) { return mode === AR_MODE_COMPARISON || mode === AR_MODE_SYNTHESIS; }

// arNormalizeMode — tolerate the legacy alias and unknown values without throwing.
function arNormalizeMode(v) {
  var m = arLow(v);
  if (!m || m === 'single_source') return AR_MODE_SOURCE;
  if (AR_IMPL[m]) return m;
  return AR_MODE_SOURCE;
}

// arCountContributing(targets) -> number of targets that carry at least one citable evidence item.
// Accepts either the bridge's target shape ({evidence_input:{evidence:[…]}}) or a plain {evidence:[…]}.
function arCountContributing(targets) {
  return arContributing(targets).length;
}
// arSourceIdentity(target) -> the canonical identity of the REAL source behind a target.
//
// analysis_bridge can emit MORE THAN ONE target for the same real competitor: offers are grouped by competitor
// NAME while evidence-only rows are keyed by HOST, so «Залог 24» and «zalog24h.ru» arrive as two targets for one
// company. Counting raw targets would therefore let a SINGLE source present itself as a two-source comparison —
// precisely the invariant F-7 exists to prevent. Identity prefers the collector's run id (same collection run =
// same source), then the host/source id, then the company name.
// analysis_bridge already consolidated split records under one target per real source (BRIDGE-IDENTITY-001),
// so this is a SAFETY dedup only. It must use the SAME per-source signals the bridge does — a batch source_run_id
// (WF04/WF10 aggregate many URLs under one run id, e.g. wf10_<ts>) is NOT a per-source identity and merging on it
// collapsed a real two-source comparison to one (live: req_17847633957, exec 1303). Identity = canonical source
// id / domain-shaped key, else normalized company name.
function arSourceIdentity(t) {
  var ei = (t && (t.evidence_input || t)) || {};
  var src = ei.source || {};
  var facts = ei.current_run_facts || {};
  var id = arLow(src.source_id || t.source_key);
  if (id) return 'id:' + id;
  return 'name:' + arLow(facts.company_name);
}

// Contributing = carries citable evidence AND is a DISTINCT real source. The first target for an identity wins,
// so the richer competitor-keyed target is kept over a duplicate.
function arContributing(targets) {
  var seen = {}, out = [];
  (Array.isArray(targets) ? targets : []).forEach(function (t) {
    if (!t) return;
    var ei = t.evidence_input || t;
    var ev = (ei && ei.evidence) || [];
    if (!Array.isArray(ev) || ev.length === 0) return;
    var key = arSourceIdentity(t);
    if (seen[key]) return;
    seen[key] = true;
    out.push(t);
  });
  return out;
}

// resolveAnalysisMode({ requested_mode, targets }) -> {
//   mode, impl, multi_source, contributing, requested_mode, downgraded, reason, reason_ru
// }
//
// The returned `mode` is what MUST be executed, persisted, cached and rendered — never the requested label.
function resolveAnalysisMode(input) {
  input = input || {};
  var requested = arNormalizeMode(input.requested_mode);
  var contributing = arCountContributing(input.targets);

  var mode = requested, downgraded = false, reason = 'ok', reasonRu = '';

  if (arIsMultiSource(requested)) {
    var need = AR_MIN_SOURCES[requested];
    if (contributing < need) {
      downgraded = true;
      // Synthesis with exactly 2 contributing sources is still a genuine comparison — degrade one step, not
      // all the way to a single-source analysis, so the user keeps the strongest honest result.
      if (requested === AR_MODE_SYNTHESIS && contributing >= AR_MIN_SOURCES[AR_MODE_COMPARISON]) {
        mode = AR_MODE_COMPARISON;
        reason = 'insufficient_sources_for_synthesis';
        reasonRu = 'источников с данными меньше трёх — построено сравнение двух источников';
      } else {
        mode = AR_MODE_SOURCE;
        reason = contributing <= 1 ? 'insufficient_sources_for_comparison' : 'insufficient_sources';
        reasonRu = contributing === 1
          ? 'данные удалось собрать только по одному источнику — сравнение не строилось'
          : 'недостаточно источников с данными для сравнения';
      }
    }
  }

  return {
    mode: mode,
    impl: AR_IMPL[mode] || 'analyzeSource',
    multi_source: arIsMultiSource(mode),
    contributing: contributing,
    requested_mode: requested,
    downgraded: downgraded,
    reason: reason,
    reason_ru: reasonRu
  };
}

// arBuildMultiSourcePackage(targets, ctx) -> the MULTI-source evidence package analyzeComparison expects.
//
// Source identity, role, domain, run id, quality and every evidence id are preserved verbatim: a comparison
// claim must remain traceable to the exact source it came from, and the renderer needs the same ids back.
// Evidence ids are re-issued as ev_N across the WHOLE package (they must be unique per package) while the
// per-source mapping is retained so a claim can still be attributed.
function arBuildMultiSourcePackage(targets, ctx) {
  ctx = ctx || {};
  var contributing = arContributing(targets);
  var sources = [], evidence = [], allowed = [], n = 0;

  contributing.forEach(function (t) {
    var ei = t.evidence_input || t;
    var src = ei.source || {};
    var facts = ei.current_run_facts || {};
    var ids = [];
    (ei.evidence || []).forEach(function (e) {
      n += 1;
      var id = 'ev_' + n;
      ids.push(id);
      allowed.push(id);
      evidence.push({
        evidence_id: id,
        source_id: arStr(src.source_id || t.source_key),
        source_type: arStr(src.kind || t.source_kind),
        source_url: arStr(e && (e.source_url || e.url)),
        excerpt: arStr(e && (e.excerpt || e.text || e.quote)),
        fact_type: arStr(e && e.fact_type),
        collected_at: arStr(e && e.collected_at),
        quality_status: arStr(e && e.quality_status)
      });
    });
    sources.push({
      source_id: arStr(src.source_id || t.source_key),
      source_name: arStr(facts.company_name) || arStr(src.source_id || t.source_key),
      source_type: arStr(src.kind || t.source_kind),
      source_run_id: arStr(src.source_run_id),
      quality_status: arStr(src.quality_status),
      source_role: arStr(t.source_role || (ei.source_role || '')),
      positioning: arStr(facts.positioning),
      offer_summary: arStr(facts.offer_summary),
      prices_terms: arStr(facts.prices_terms),
      cta_text: arStr(facts.cta_text),
      evidence_ids: ids
    });
  });

  // Union of the per-source limitations, deduped, plus the mode-scoping limitation.
  var lims = {};
  contributing.forEach(function (t) {
    var ei = t.evidence_input || t;
    (ei.limitations || []).forEach(function (l) { if (l) lims[arStr(l)] = true; });
  });

  var first = (contributing[0] && (contributing[0].evidence_input || contributing[0])) || {};
  var req = first.request || {};

  return {
    package: {
      schema: 'evidence_package.multi.v1',
      analysis_request: {
        agent_request_id: arStr(ctx.agent_request_id || req.agent_request_id),
        niche: arStr(ctx.niche || req.niche),
        region: arStr(ctx.region || req.region),
        data_mode: arStr(ctx.data_mode || req.data_mode) || 'live',
        analysis_mode: arStr(ctx.analysis_mode || ''),
        requested_sources: Array.isArray(req.requested_sources) ? req.requested_sources : []
      },
      sources: sources,
      evidence_items: evidence,
      limitations: Object.keys(lims).slice(0, 12)
    },
    allowed_evidence_ids: allowed,
    source_count: sources.length
  };
}

module.exports = {
  AR_MODE_SOURCE, AR_MODE_COMPARISON, AR_MODE_SYNTHESIS, AR_MODE_CHANGE, AR_MODE_CANDIDATE, AR_MODE_LEAD,
  AR_MIN_SOURCES, AR_IMPL,
  resolveAnalysisMode, arNormalizeMode, arCountContributing, arContributing, arIsMultiSource, arSourceIdentity,
  arBuildMultiSourcePackage
};
