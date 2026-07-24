'use strict';
// cost_model.js — §7 real per-request cost: projection from the ACTUAL planned provider calls, the technical
// hard cap, and post-run actuals. The user-facing approval message may show ONLY the projection (an estimate
// based on planned calls) — never the global/emergency hard cap (that stays in operator diagnostics/rows).
//
// Unit prices are operator-controlled config (agent_config: MS_COST_FIRECRAWL_PAGE_USD /
// MS_COST_APIFY_SEARCH_USD / MS_COST_CLAUDE_CALL_USD), not constants scattered through workflow code.
// Observed reality (2026-07): Firecrawl ≈ 1 credit per page, Apify search ≈ $0.01, a small Claude
// sonnet call ≈ $0.01-0.02; a normal request lands well under $1 — nowhere near the $8 test ceiling.
//
// Embeddable: unique cost*-prefixed top-level names, no cross-lib require.

function costNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function costRound(v) { return Math.round(costNum(v, 0) * 100) / 100; }
// COST-SPLIT-001: ACTUALS keep 4-decimal precision — real per-call analysis costs are sub-cent (live: $0.0132),
// and rounding them to cents would erase the very components the split exists to show. Projections stay 2dp.
function costRound4(v) { return Math.round(costNum(v, 0) * 10000) / 10000; }

var COST_PRICE_DEFAULTS = {
  cost_firecrawl_page_usd: 0.01,
  cost_apify_search_usd: 0.01,
  cost_claude_call_usd: 0.02,
  // Stage F MEASURED: one evidence-bound WF28 source analysis = $0.063 clean / $0.084 with one repair (the
  // gateway injects hidden context and always runs extended thinking). See docs/STAGE_F_API_CAPABILITY_MATRIX.md.
  cost_claude_analysis_usd: 0.07,
  // WF12's per-report Claude SUMMARY call — runs once per delivered report whenever Claude is usable, INDEPENDENT
  // of deep-analysis reuse (live exec 1072: deep analysis reused $0, summary still ran $0.012). Modelled only in
  // the execution-aware projection (opts.preflight), so a plain projectRequestCost(plan,cfg) is byte-identical.
  cost_claude_summary_usd: 0.015
};

// COST-REUSE-001: an execution-aware preflight. Given the owner's stored source snapshots, decide per planned
// website source whether the run will REUSE a fresh snapshot (collection $0, cached analysis very likely reused)
// or COLLECT. This is a bounded, FREE prediction for the approval estimate — the executor still makes the binding
// decision. Conservative by construction: it only predicts reuse for a fresh ACCEPTED snapshot on a reusable route.
//   decideFn: the canonical source_execution_policy.decideSourceExecution (injected — cost_model stays require-free).
//   -> { data_mode:'reuse'|'mixed'|'collect', expect_source_reuse, expect_analysis_reuse, snapshot_collected_at, per_source[] }
function sourceReusePreflight(plan, cfg, snapshots, decideFn, opts) {
  plan = plan || {}; cfg = cfg || {}; opts = opts || {};
  var sources = (Array.isArray(plan.sources) ? plan.sources : String(plan.sources || '').split(','))
    .map(function (s) { return String(s || '').trim().toLowerCase(); }).filter(Boolean);
  // Only website collection reuses via url_registry snapshots today; tg/vk/avito always predict collect here.
  var webTargets = (Array.isArray(plan.urls) ? plan.urls : (Array.isArray(plan.website_targets) ? plan.website_targets : []))
    .filter(Boolean);
  if (!webTargets.length && sources.indexOf('website') >= 0) webTargets = (cfg.website_competitor_urls || []).slice();
  var refresh = plan.force_reprocess === true || String(plan.force_reprocess) === 'true';
  var per = [], reused = 0, newest = '';
  if (typeof decideFn === 'function') {
    webTargets.forEach(function (u) {
      var d = decideFn({ source_url: u, snapshots: snapshots || [], owner_user_id: opts.owner_user_id,
        requested_refresh: refresh, freshness_days: costNum(cfg.source_freshness_days, 0) || undefined, now: opts.now }) || {};
      var isReuse = d.mode === 'reuse';
      if (isReuse) { reused++; if (String(d.snapshot_collected_at || '') > newest) newest = String(d.snapshot_collected_at || ''); }
      per.push({ source_url: u, mode: d.mode || 'collect', snapshot_collected_at: String(d.snapshot_collected_at || '') });
    });
  }
  var total = webTargets.length;
  var mode = (total && reused >= total) ? 'reuse' : (reused > 0 ? 'mixed' : 'collect');
  // COST-REUSE-002 (Stage-F residual-risk #1): source-snapshot reuse makes a deep-analysis cache hit POSSIBLE, not
  // CERTAIN. The analysis cache key is owner+analysis_type+evidence_hash+schema+prompt+model and needs a
  // non-fallback row to actually exist (llm_telemetry.findReusableAnalysis) — the SAME evidence still MISSES when
  // the report mode, the model, or the schema/prompt version differ, or when the snapshot was never analysed
  // (live-proven: exec 1004, same evidence hash under change_report → fresh paid call). At approval time we cannot
  // cheaply confirm the hit (it needs the built evidence package + hash + an llm_analysis_results read), so we
  // PREDICT analysis reuse ONLY when the caller passes explicit proof via opts.analysis_reuse_confirmed. Absent
  // that proof the estimate honestly quotes the deep-analysis cost and never promises a guaranteed $0.
  var claudeOn = cfg.claude_available !== false && cfg.enable_claude !== false;
  var sourceReuse = !refresh && total > 0 && reused >= total;
  var analysisReusePossible = sourceReuse && claudeOn;
  return {
    data_mode: refresh ? 'refresh' : mode,
    expect_source_reuse: sourceReuse,
    // Only a CONFIRMED cache hit zeroes the deep-analysis cost; the "possible" flag drives honest hedge wording.
    expect_analysis_reuse: analysisReusePossible && opts.analysis_reuse_confirmed === true,
    analysis_reuse_possible: analysisReusePossible,
    snapshot_collected_at: newest, per_source: per
  };
}

// Planned provider calls for ONE approved request, derived from the plan's sources and the operator's
// configured targets (site list / query list). telegram public preview and vk have no per-call fee.
function plannedProviderCalls(plan, cfg) {
  plan = plan || {}; cfg = cfg || {};
  var sources = (Array.isArray(plan.sources) ? plan.sources : String(plan.sources || '').split(','))
    .map(function (s) { return String(s || '').trim().toLowerCase(); }).filter(Boolean);
  var has = function (s) { return sources.indexOf(s) >= 0; };
  // Firecrawl SCRAPE pages: for an EXPLICIT website request the unit is the supplied site(s), not the operator's
  // preset list — one supplied site is ONE page, not the default 3 (B3). Non-explicit website scans fall back to
  // the configured competitor list.
  var explicitSites = (Array.isArray(plan.urls) ? plan.urls : (Array.isArray(plan.website_targets) ? plan.website_targets : []))
    .filter(Boolean);
  var firecrawl_pages = has('website')
    ? (explicitSites.length || (cfg.website_competitor_urls || []).length || 3)
    : 0;
  var apify_searches = has('avito') ? ((cfg.avito_queries || []).length || 3) : 0;
  // Discovery = Firecrawl SEARCH queries + a bounded Firecrawl SCRAPE validation of the top candidates (B3).
  var isDiscovery = /discovery/.test(String(plan.intent || '')) || plan.discovery === true;
  var firecrawl_searches = isDiscovery ? ((cfg.discovery_queries || []).length || costNum(plan.discovery_query_count, 4)) : 0;
  var firecrawl_scrapes = isDiscovery ? Math.min(costNum(plan.validate_top_n, cfg.discovery_validate_top_n || 3), 5) : 0;
  // Claude enrichment cost is counted ONLY when LLM enrichment is actually enabled for the run. Before Stage F
  // every enrichment flag is false, so Claude does NOT run and MUST NOT appear in the estimate (B3). Note this is
  // gated on the *enrichment* flags, not the coarse enable_claude master switch (which may be true while Stage F
  // is still off).
  // Claude is a real planned call ONLY when: the master switch is on, an enrichment flag is set, AND Claude auth is
  // actually usable. CAP-CLAUDE-001: production auth is an n8n CREDENTIAL, so `claude_key_present` (env-derived) is
  // false in production even though Claude works — gating on it alone silently dropped the AI component from an
  // estimate for work that WILL run. `claude_available` (llm_capability.js: telemetry proof > env key > operator
  // declaration) is the authoritative input and wins whenever the caller supplies it; we fall back to
  // claude_key_present for callers that don't resolve a capability. Either omitted => treated as available, so a
  // unit test that only sets the flags still models Stage-F cost (COST-LLM-001 semantics preserved).
  var authOk = (cfg.claude_available != null) ? (cfg.claude_available !== false) : (cfg.claude_key_present !== false);
  var llmOn = cfg.enable_claude !== false && authOk && (
    cfg.enable_llm_analysis === true || cfg.enable_llm_summary === true ||
    plan.enable_llm_analysis === true || plan.enable_llm_summary === true);
  // WF08's LEGACY per-record classifier: one Claude call PER RECORD. It now has its own default-OFF gate
  // (WF08-LLM-GATE-001), so the Stage-F rollout does not silently quote — or spend — 12 per-record calls.
  var claude_calls = 0;
  if (llmOn && cfg.enable_wf08_llm === true) {
    var perRecord = Math.min(costNum(plan.max_items, 10), 12);
    claude_calls = perRecord + 2;
  }
  // Stage F (WF28): ONE evidence-bound analysis per LOGICAL SOURCE, plus one synthesis when >1 source is compared.
  // Bounded by llm_max_analyses_per_run so the fan-out can never explode per row.
  var claude_analysis_calls = 0, claude_synthesis_calls = 0;
  if (llmOn) {
    var webTargets = has('website') ? (explicitSites.length || (cfg.website_competitor_urls || []).length || 3) : 0;
    var tgTargets = has('telegram') ? ((plan.telegram_channels || []).length || (cfg.telegram_channels || []).length || 1) : 0;
    var vkTargets = has('vk') ? ((plan.vk_communities || []).length || (cfg.vk_communities || []).length || 1) : 0;
    var avTargets = has('avito') ? 1 : 0;
    var cap = costNum(cfg.llm_max_analyses_per_run, 5); if (!(cap > 0)) cap = 5;
    claude_analysis_calls = Math.min(webTargets + tgTargets + vkTargets + avTargets, cap);
    claude_synthesis_calls = claude_analysis_calls >= 2 ? 1 : 0;
  }
  return {
    firecrawl_pages: firecrawl_pages, firecrawl_searches: firecrawl_searches, firecrawl_scrapes: firecrawl_scrapes,
    apify_searches: apify_searches, claude_calls: claude_calls,
    claude_analysis_calls: claude_analysis_calls, claude_synthesis_calls: claude_synthesis_calls,
    llm_enabled: llmOn, llm_auth_ok: authOk
  };
}

// -> { projected_cost_usd, reliable, hard_cap_usd, breakdown }
// reliable=false (omit the number in UX) when the plan has no sources or a needed unit price is not a
// positive finite number — a dollar amount is shown only when it is grounded in the actual planned calls.
function projectRequestCost(plan, cfg, opts) {
  plan = plan || {}; cfg = cfg || {}; opts = opts || {};
  var pf = opts.preflight || null;   // COST-REUSE-001: execution-aware adjustments (opt-in; WF19 supplies it)
  var calls = plannedProviderCalls(plan, cfg);
  // Reuse zeroes the paid collection and the deep-analysis call for the affected sources — the estimate then
  // reflects what the run will ACTUALLY spend, not a mechanical fresh-collection figure.
  var reuseCollection = !!(pf && pf.expect_source_reuse);
  var reuseAnalysis = !!(pf && pf.expect_analysis_reuse);
  if (reuseCollection) { calls.firecrawl_pages = 0; }
  if (reuseAnalysis) { calls.claude_analysis_calls = 0; calls.claude_synthesis_calls = 0; }
  var pFire = costNum(cfg.cost_firecrawl_page_usd, COST_PRICE_DEFAULTS.cost_firecrawl_page_usd);
  var pApify = costNum(cfg.cost_apify_search_usd, COST_PRICE_DEFAULTS.cost_apify_search_usd);
  var pClaude = costNum(cfg.cost_claude_call_usd, COST_PRICE_DEFAULTS.cost_claude_call_usd);
  var pAnalysis = costNum(cfg.cost_claude_analysis_usd, COST_PRICE_DEFAULTS.cost_claude_analysis_usd);
  var pSummary = costNum(cfg.cost_claude_summary_usd, COST_PRICE_DEFAULTS.cost_claude_summary_usd);
  var firecrawlUnits = costNum(calls.firecrawl_pages, 0) + costNum(calls.firecrawl_searches, 0) + costNum(calls.firecrawl_scrapes, 0);
  var analysisUnits = costNum(calls.claude_analysis_calls, 0) + costNum(calls.claude_synthesis_calls, 0);
  // The WF12 summary is a real per-report AI call — modelled ONLY when a preflight is supplied (execution-aware),
  // so plain projectRequestCost(plan,cfg) stays byte-identical to its prior behaviour.
  var summaryCalls = (pf && calls.llm_enabled) ? 1 : 0;
  var reliable = true;
  if (firecrawlUnits > 0 && !(pFire > 0)) reliable = false;
  if (calls.apify_searches > 0 && !(pApify > 0)) reliable = false;
  if (calls.claude_calls > 0 && !(pClaude > 0)) reliable = false;
  if (analysisUnits > 0 && !(pAnalysis > 0)) reliable = false;
  var sources = Array.isArray(plan.sources) ? plan.sources : String(plan.sources || '').split(',').filter(Boolean);
  var isDiscovery = /discovery/.test(String(plan.intent || '')) || plan.discovery === true;
  if (!sources.length && !isDiscovery) reliable = false; // discovery is a valid runnable shape with no source list
  var breakdown = {
    firecrawl_usd: costRound(firecrawlUnits * pFire),
    apify_usd: costRound(calls.apify_searches * pApify),
    claude_usd: costRound(calls.claude_calls * pClaude),
    // Stage F: the evidence-bound WF28 analyses/synthesis, priced from MEASURED per-call cost.
    claude_analysis_usd: costRound(analysisUnits * pAnalysis),
    // WF12 per-report summary — present only in execution-aware mode.
    summary_ai_usd: costRound(summaryCalls * pSummary)
  };
  // The two components the user actually cares about, kept separate in UX: collection vs AI.
  breakdown.collection_usd = costRound(breakdown.firecrawl_usd + breakdown.apify_usd);
  breakdown.ai_usd = costRound(breakdown.claude_usd + breakdown.claude_analysis_usd + breakdown.summary_ai_usd);
  var projected = costRound(breakdown.collection_usd + breakdown.ai_usd);
  // Low/high band (B3): the low is the planned estimate; the high adds a reserve for a variable page count / one
  // provider retry (operator-tunable margin, default 50%), so the shown range brackets realistic actual cost.
  var margin = costNum(cfg.cost_reserve_margin, 0.5); if (!(margin >= 0)) margin = 0.5;
  var costLow = projected;
  var costHigh = costRound(projected * (1 + margin));
  return {
    projected_cost_usd: projected,
    cost_low_usd: costLow,
    cost_high_usd: costHigh,
    llm_enabled: calls.llm_enabled === true,
    // Distinguishes "AI is switched off" from "AI is switched on but its credential is missing/failing" — the
    // renderer must never promise AI analysis in the second case (§4).
    llm_auth_ok: calls.llm_auth_ok !== false,
    llm_requested: cfg.enable_llm_analysis === true || cfg.enable_llm_summary === true ||
      plan.enable_llm_analysis === true || plan.enable_llm_summary === true,
    reserve_margin: margin,
    reliable: reliable,
    hard_cap_usd: costRound(costNum(cfg.source_budget_usd, 0) + costNum(cfg.llm_budget_usd, 0)),
    // COST-REUSE-001: execution-aware state carried to the renderer (empty when no preflight was supplied).
    data_mode: pf ? String(pf.data_mode || 'collect') : '',
    reuse_collection: reuseCollection,
    reuse_analysis: reuseAnalysis,
    // COST-REUSE-002: source is reused but a matching saved analysis is NOT confirmed — the deep-analysis cost
    // stays quoted; the renderer marks it as spend-only-if-no-saved-analysis rather than a promised $0.
    reuse_analysis_possible: !!(pf && pf.analysis_reuse_possible) && !reuseAnalysis,
    snapshot_collected_at: pf ? String(pf.snapshot_collected_at || '') : '',
    planned_calls: calls,
    breakdown: breakdown
  };
}

// Post-run actuals from observed provider usage (adapter external_calls per source + measured LLM usage).
// measured_llm_cost_usd (from real usage tokens, e.g. WF12 merge) wins over the per-call estimate.
function actualRequestCost(usage, cfg) {
  usage = usage || {}; cfg = cfg || {};
  var pFire = costNum(cfg.cost_firecrawl_page_usd, COST_PRICE_DEFAULTS.cost_firecrawl_page_usd);
  var pApify = costNum(cfg.cost_apify_search_usd, COST_PRICE_DEFAULTS.cost_apify_search_usd);
  var pClaude = costNum(cfg.cost_claude_call_usd, COST_PRICE_DEFAULTS.cost_claude_call_usd);
  var llm = costNum(usage.measured_llm_cost_usd, NaN);
  if (!isFinite(llm)) llm = costNum(usage.claude_calls, 0) * pClaude;
  // Stage F: WF28 reports its REAL cost from response usage tokens (never an estimate) — add it as its own
  // component so the persisted actual is comparable to the projection the user approved.
  var analysisActual = costNum(usage.claude_analysis_cost_usd, 0);
  // COST-SPLIT-001: repair is the share of the deep-analysis cost spent on the bounded repair call. It is a
  // component OF analysisActual (never added twice) — split out so "AI cost" can be reported honestly per part:
  // collection / summary AI / deep analysis AI / repair / total. Deterministic extraction is $0 by design.
  var repairActual = Math.min(costNum(usage.claude_repair_cost_usd, 0), analysisActual);
  var firecrawlUnits = costNum(usage.firecrawl_pages, 0) + costNum(usage.firecrawl_searches, 0) + costNum(usage.firecrawl_scrapes, 0);
  var collection = costRound4(firecrawlUnits * pFire + costNum(usage.apify_searches, 0) * pApify);
  var ai = costRound4(llm + analysisActual);
  var actual = costRound4(collection + ai);
  var cap = costRound(costNum(cfg.source_budget_usd, 0) + costNum(cfg.llm_budget_usd, 0));
  return {
    actual_cost_usd: actual,
    actual_collection_usd: collection,
    actual_ai_usd: ai,
    actual_summary_ai_usd: costRound4(llm),
    actual_deep_analysis_usd: costRound4(Math.max(0, analysisActual - repairActual)),
    actual_repair_usd: costRound4(repairActual),
    hard_cap_usd: cap,
    remaining_budget_usd: costRound4(Math.max(0, cap - actual))
  };
}

module.exports = { COST_PRICE_DEFAULTS, plannedProviderCalls, projectRequestCost, actualRequestCost, costRound, sourceReusePreflight };
