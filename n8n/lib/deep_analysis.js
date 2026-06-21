'use strict';
// deep_analysis.js — Part 6: bounded deep competitor analysis.
//
// Goes beyond homepages — but only across sources that are actually CONFIGURED and AVAILABLE. The plan
// degrades gracefully (website only -> +history -> +Telegram -> +VK -> full) and never claims Telegram/VK
// analysis when those adapters aren't configured. Every factual conclusion carries a full evidence contract
// (source URL/record/run id + excerpt + timestamp + quality + confidence); recommendations are explicitly
// separated from facts and must reference the findings they derive from. Standalone + deterministic.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

const DIMENSIONS = [
  'offer', 'prices', 'terms', 'positioning', 'audiences', 'pains', 'usp', 'cta', 'trust', 'guarantees',
  'promotions', 'content_themes', 'acquisition_channels', 'weaknesses', 'contradictions', 'recent_changes',
  'differentiation', 'marketing_ideas'
];
const SCOPE_TIERS = ['website_only', 'website_history', 'website_telegram', 'website_vk', 'full'];
const DEEP_PLATFORMS = ['website', 'telegram_channel', 'vk_community'];

// Which requested platforms are actually available (in the allowlist AND, for tg/vk, backed by a tracked
// source for the competitor). Returns selected + unavailable[{platform, reason}] — honest by construction.
function resolveDeepPlatforms(requestedPlatforms, cfg, trackedSources) {
  cfg = cfg || {}; trackedSources = trackedSources || [];
  const allow = (cfg.source_allowlist || []).map(low);
  const req = (requestedPlatforms && requestedPlatforms.length ? requestedPlatforms : ['website']).map(low);
  const selected = []; const unavailable = [];
  for (const p of req) {
    if (DEEP_PLATFORMS.indexOf(p) < 0) { unavailable.push({ platform: p, reason: 'unknown_platform' }); continue; }
    if (allow.indexOf(p) < 0) { unavailable.push({ platform: p, reason: 'platform not in source allowlist / adapter not configured' }); continue; }
    if (p !== 'website') {
      const has = trackedSources.some(s => low(s.platform) === p && low(s.status) === 'active');
      if (!has) { unavailable.push({ platform: p, reason: 'no active tracked ' + p + ' source for this competitor' }); continue; }
    }
    selected.push(p);
  }
  if (selected.indexOf('website') < 0) selected.unshift('website'); // website is the floor
  return { selected: selected, unavailable: unavailable };
}

function scopeTier(selected, historyAvailable) {
  const s = selected || [];
  const hasTg = s.indexOf('telegram_channel') >= 0, hasVk = s.indexOf('vk_community') >= 0;
  if (hasTg && hasVk) return 'full';
  if (hasTg) return 'website_telegram';
  if (hasVk) return 'website_vk';
  if (historyAvailable) return 'website_history';
  return 'website_only';
}

// Build the explicit, approval-gated deep plan with budgets + graceful degradation.
function buildDeepPlan(p) {
  p = p || {};
  const cfg = p.cfg || {};
  const competitors = (p.competitors || []).slice(0, num(p.max_competitors, num(cfg.max_competitors_deep, 3)));
  const tracked = p.tracked_sources || [];
  const res = resolveDeepPlatforms(p.requested_platforms, cfg, tracked);
  const historyAvailable = p.history_available === true;
  const tier = scopeTier(res.selected, historyAvailable);
  const pageLimit = Math.min(num(p.page_limit, num(cfg.deep_page_limit, 6)), num(cfg.deep_page_limit, 6) || 6);
  const monitoredTg = tracked.filter(s => low(s.platform) === 'telegram_channel' && low(s.status) === 'active').map(s => s.ref);
  const monitoredVk = tracked.filter(s => low(s.platform) === 'vk_community' && low(s.status) === 'active').map(s => s.ref);
  // estimate calls: website pages per competitor + 1 per monitored tg/vk source actually selected
  let estCalls = competitors.length * pageLimit;
  if (res.selected.indexOf('telegram_channel') >= 0) estCalls += monitoredTg.length;
  if (res.selected.indexOf('vk_community') >= 0) estCalls += monitoredVk.length;
  estCalls = Math.min(estCalls, num(cfg.max_external_calls, 40));
  return {
    capability: 'deep_competitor_analysis',
    selected_competitors: competitors.map(c => str(c.company_name || c.ref || c)),
    selected_platforms: res.selected,
    page_limit_per_competitor: pageLimit,
    history_available: historyAvailable,
    monitored_telegram: monitoredTg,
    monitored_vk: monitoredVk,
    dimensions: DIMENSIONS,
    est_external_calls: estCalls,
    est_source_budget_usd: Math.min(num(p.est_source_cost, num(cfg.source_budget_usd, 0.20)), num(cfg.source_budget_usd, 0.20)),
    est_llm_budget_usd: Math.min(num(p.est_llm_cost, num(cfg.llm_budget_usd, 0.50)), num(cfg.llm_budget_usd, 0.50)),
    unavailable_sources: res.unavailable,
    scope_tier: tier,
    expected_output: 'deep_competitor_report',
    requires_approval: cfg.require_approval !== false
  };
}

// ---- evidence contract ------------------------------------------------------------------------------------
function deepFinding(dimension, value, evidence) {
  evidence = evidence || {};
  return {
    finding_id: 'f_' + low(dimension) + '_' + (str(evidence.source_record_id) || str(evidence.source_run_id) || 'x').replace(/[^a-z0-9]+/gi, '').slice(0, 24),
    dimension: low(dimension), type: 'fact', value: value,
    evidence: {
      source_url: str(evidence.source_url), source_record_id: str(evidence.source_record_id),
      source_run_id: str(evidence.source_run_id), excerpt: str(evidence.excerpt) || str(evidence.field),
      collected_at: str(evidence.collected_at), quality_status: str(evidence.quality_status) || 'unknown',
      confidence: num(evidence.confidence, 0.6)
    }
  };
}
// A finding may be a FACT only with a real evidence anchor. Otherwise it is rejected (cannot be a fact).
function validateFinding(f) {
  if (!f || typeof f !== 'object') return { valid: false, reason: 'not_object' };
  if (DIMENSIONS.indexOf(low(f.dimension)) < 0) return { valid: false, reason: 'unknown_dimension' };
  const e = f.evidence || {};
  if (!str(e.source_url) && !str(e.source_record_id)) return { valid: false, reason: 'no_source_anchor' };
  if (!str(e.source_run_id)) return { valid: false, reason: 'no_source_run_id' };
  if (!str(e.excerpt)) return { valid: false, reason: 'no_evidence_excerpt' };
  return { valid: true, reason: '' };
}

function deepRecommendation(text, derivedFromFindingIds, confidence) {
  const ids = (derivedFromFindingIds || []).map(str).filter(Boolean);
  return { type: 'recommendation', text: str(text), derived_from: ids, confidence: num(confidence, 0.5) };
}

// Separate facts from recommendations. Only evidence-backed findings become facts; a recommendation that does
// not reference at least one (valid) finding is held back as an orphan (it can never present as a fact).
function assembleDeepReport(competitor, findings, recommendations) {
  findings = findings || []; recommendations = recommendations || [];
  const facts = []; const invalid = [];
  for (const f of findings) { const v = validateFinding(f); if (v.valid) facts.push(f); else invalid.push({ finding: f, reason: v.reason }); }
  const validIds = {}; facts.forEach(f => { validIds[f.finding_id] = 1; });
  const recs = []; const orphans = [];
  for (const r of recommendations) {
    const refs = (r.derived_from || []).filter(id => validIds[id]);
    if (refs.length) recs.push(Object.assign({}, r, { type: 'recommendation', derived_from: refs }));
    else orphans.push(Object.assign({}, r, { reason: 'no_supporting_finding' }));
  }
  return {
    competitor: str(competitor),
    facts: facts, invalid_findings: invalid,
    recommendations: recs, orphan_recommendations: orphans,
    fact_count: facts.length, recommendation_count: recs.length
  };
}

module.exports = {
  DIMENSIONS, SCOPE_TIERS, DEEP_PLATFORMS, resolveDeepPlatforms, scopeTier, buildDeepPlan,
  deepFinding, validateFinding, deepRecommendation, assembleDeepReport, str, low, num
};
