'use strict';
// llm_cost.js — Stage F token→cost from ACTUAL response usage (the gateway inflates input with hidden context,
// so estimate conservatively and always persist actuals). Per-Mtok prices are operator-configurable
// (agent_config: MS_LLM_INPUT_PER_MTOK / MS_LLM_OUTPUT_PER_MTOK) with claude-sonnet-class defaults. A single
// Stage-F analysis call is ~2000 input + ~500 output ≈ $0.014 at defaults — bounded and cheap, but the count
// varies so the truth is the response usage. Embeddable: unique lc*-prefixed names, no cross-lib require.

function lcNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function lcRound(v) { return Math.round(lcNum(v, 0) * 1e6) / 1e6; }

var LC_PRICE_DEFAULTS = { input_per_mtok: 3.0, output_per_mtok: 15.0 };

function lcPrices(cfg) {
  cfg = cfg || {};
  return {
    input_per_mtok: lcNum(cfg.llm_input_per_mtok, LC_PRICE_DEFAULTS.input_per_mtok),
    output_per_mtok: lcNum(cfg.llm_output_per_mtok, LC_PRICE_DEFAULTS.output_per_mtok)
  };
}

// costFromUsage(usage, cfg) -> { input_tokens, output_tokens, cache_read_tokens, cost_usd }
// Cache-read tokens (when the gateway ever supports them) are billed at input price; cache tokens are 0 today.
function costFromUsage(usage, cfg) {
  usage = usage || {};
  var p = lcPrices(cfg);
  var inTok = lcNum(usage.input_tokens, 0);
  var outTok = lcNum(usage.output_tokens, 0);
  var cost = lcRound(inTok / 1e6 * p.input_per_mtok + outTok / 1e6 * p.output_per_mtok);
  return {
    input_tokens: inTok, output_tokens: outTok,
    cache_creation_input_tokens: lcNum(usage.cache_creation_input_tokens, 0),
    cache_read_input_tokens: lcNum(usage.cache_read_input_tokens, 0),
    cost_usd: cost
  };
}

// Conservative pre-call estimate from a counted input-token figure (count_tokens of OUR content) plus a fixed
// gateway-overhead allowance and an expected output. Used to gate a call against the per-request LLM budget.
function estimateCost(countedInputTokens, expectedOutputTokens, cfg) {
  cfg = cfg || {};
  var p = lcPrices(cfg);
  var overhead = lcNum(cfg.llm_gateway_overhead_tokens, 2200); // measured injected context, upper-ish bound
  var inTok = lcNum(countedInputTokens, 0) + overhead;
  var outTok = lcNum(expectedOutputTokens, 700);
  return { est_input_tokens: inTok, est_output_tokens: outTok, est_cost_usd: lcRound(inTok / 1e6 * p.input_per_mtok + outTok / 1e6 * p.output_per_mtok) };
}

// sumCosts([{cost_usd}, ...]) -> total rounded
function sumCosts(rows) {
  var t = 0; (rows || []).forEach(function (r) { t += lcNum(r && r.cost_usd, 0); });
  return lcRound(t);
}

module.exports = { LC_PRICE_DEFAULTS, lcPrices, costFromUsage, estimateCost, sumCosts };
