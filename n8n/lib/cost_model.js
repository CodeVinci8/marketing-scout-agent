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

var COST_PRICE_DEFAULTS = {
  cost_firecrawl_page_usd: 0.01,
  cost_apify_search_usd: 0.01,
  cost_claude_call_usd: 0.02
};

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
  var llmOn = cfg.enable_claude !== false && (
    cfg.enable_llm_analysis === true || cfg.enable_llm_summary === true ||
    plan.enable_llm_analysis === true || plan.enable_llm_summary === true);
  var claude_calls = 0;
  if (llmOn) {
    var perRecord = Math.min(costNum(plan.max_items, 10), 12);
    claude_calls = perRecord + 2;
  }
  return {
    firecrawl_pages: firecrawl_pages, firecrawl_searches: firecrawl_searches, firecrawl_scrapes: firecrawl_scrapes,
    apify_searches: apify_searches, claude_calls: claude_calls, llm_enabled: llmOn
  };
}

// -> { projected_cost_usd, reliable, hard_cap_usd, breakdown }
// reliable=false (omit the number in UX) when the plan has no sources or a needed unit price is not a
// positive finite number — a dollar amount is shown only when it is grounded in the actual planned calls.
function projectRequestCost(plan, cfg) {
  plan = plan || {}; cfg = cfg || {};
  var calls = plannedProviderCalls(plan, cfg);
  var pFire = costNum(cfg.cost_firecrawl_page_usd, COST_PRICE_DEFAULTS.cost_firecrawl_page_usd);
  var pApify = costNum(cfg.cost_apify_search_usd, COST_PRICE_DEFAULTS.cost_apify_search_usd);
  var pClaude = costNum(cfg.cost_claude_call_usd, COST_PRICE_DEFAULTS.cost_claude_call_usd);
  var firecrawlUnits = costNum(calls.firecrawl_pages, 0) + costNum(calls.firecrawl_searches, 0) + costNum(calls.firecrawl_scrapes, 0);
  var reliable = true;
  if (firecrawlUnits > 0 && !(pFire > 0)) reliable = false;
  if (calls.apify_searches > 0 && !(pApify > 0)) reliable = false;
  if (calls.claude_calls > 0 && !(pClaude > 0)) reliable = false;
  var sources = Array.isArray(plan.sources) ? plan.sources : String(plan.sources || '').split(',').filter(Boolean);
  var isDiscovery = /discovery/.test(String(plan.intent || '')) || plan.discovery === true;
  if (!sources.length && !isDiscovery) reliable = false; // discovery is a valid runnable shape with no source list
  var breakdown = {
    firecrawl_usd: costRound(firecrawlUnits * pFire),
    apify_usd: costRound(calls.apify_searches * pApify),
    claude_usd: costRound(calls.claude_calls * pClaude)
  };
  var projected = costRound(breakdown.firecrawl_usd + breakdown.apify_usd + breakdown.claude_usd);
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
    reliable: reliable,
    hard_cap_usd: costRound(costNum(cfg.source_budget_usd, 0) + costNum(cfg.llm_budget_usd, 0)),
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
  var firecrawlUnits = costNum(usage.firecrawl_pages, 0) + costNum(usage.firecrawl_searches, 0) + costNum(usage.firecrawl_scrapes, 0);
  var actual = costRound(firecrawlUnits * pFire + costNum(usage.apify_searches, 0) * pApify + llm);
  var cap = costRound(costNum(cfg.source_budget_usd, 0) + costNum(cfg.llm_budget_usd, 0));
  return {
    actual_cost_usd: actual,
    hard_cap_usd: cap,
    remaining_budget_usd: costRound(Math.max(0, cap - actual))
  };
}

module.exports = { COST_PRICE_DEFAULTS, plannedProviderCalls, projectRequestCost, actualRequestCost, costRound };
