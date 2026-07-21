'use strict';
// analysis_bridge.js — turn the DETERMINISTIC WF12 report bundle into bounded, per-logical-source evidence inputs
// for WF28, and fold the returned typed analyses back onto the run.
//
// This is the seam between the deterministic pipeline and the Claude analyst. Rules it enforces (Stage F §2):
//   * ONE call per LOGICAL SOURCE (a competitor/channel/community) — never per row. Hard-capped by max_targets.
//   * Only CURRENT-RUN facts become facts. The bundle is already request-scoped (B1); historical material is
//     passed separately and labelled, never merged into current_run_facts.
//   * Every evidence item carries a real source URL; items with no citable text are dropped (Claude may only cite
//     evidence_ids that exist, so evidence with no excerpt is worse than useless).
//   * No target with zero evidence is ever sent — an empty package would burn a paid call to analyze nothing.
//   * Excerpt bounding/dedup/PII-scrubbing is delegated to evidence_package.js inside WF28 (one implementation).
//
// Embeddable: unique ab*-prefixed names, no cross-lib require.

function abStr(v) { return v == null ? '' : String(v); }
function abNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function abTrim(v, n) { var s = abStr(v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Infer the logical source kind from its URL. The bundle aggregates every platform into one competitor list, but
// an analysis must know whether it is reading a site, a Telegram channel or a VK community.
function abSourceKind(url) {
  var u = abStr(url).toLowerCase();
  if (/(^|\/\/|\.)t\.me\//.test(u) || /telegram\.me\//.test(u)) return 'telegram';
  if (/(^|\/\/|\.)vk\.com\//.test(u)) return 'vk';
  if (/(^|\/\/|\.)avito\./.test(u)) return 'avito';
  if (u) return 'website';
  return '';
}
// A stable, human-meaningful source id: the host (+ first path segment for channel/community URLs).
function abSourceId(url, fallback) {
  var u = abStr(url);
  var m = u.match(/^https?:\/\/([^\/?#]+)([^?#]*)/i);
  if (!m) return abStr(fallback);
  var host = m[1].replace(/^www\./i, '');
  var seg = abStr(m[2]).split('/').filter(Boolean)[0] || '';
  if (/^(t\.me|telegram\.me|vk\.com)$/i.test(host) && seg) return host + '/' + seg;
  return host || abStr(fallback);
}
function abFirstUrl(v) { return abStr(v).split(/[;,\s]+/).filter(Boolean)[0] || ''; }

// buildAnalysisTargets(bundle, ctx, opts) -> { targets:[{source_key, source_kind, evidence_input}], reason, considered }
// ctx: { agent_request_id, owner_user_id, chat_id, report_id, niche, region, data_mode, requested_sources[] }
function buildAnalysisTargets(bundle, ctx, opts) {
  bundle = bundle || {}; ctx = ctx || {}; opts = opts || {};
  var maxTargets = abNum(opts.max_targets, 5); if (!(maxTargets > 0)) maxTargets = 5;
  var maxEvPer = abNum(opts.max_evidence_per_target, 12);

  var competitors = Array.isArray(bundle.competitors) ? bundle.competitors : [];
  var offers = Array.isArray(bundle.offers) ? bundle.offers : [];
  var quality = Array.isArray(bundle.source_quality) ? bundle.source_quality : [];
  var bundleEvidence = Array.isArray(bundle.evidence) ? bundle.evidence : [];

  // Run-level limitations are honest context for the model: degraded/quarantined sources bound what may be claimed.
  var limitations = [];
  quality.forEach(function (q) {
    var st = abStr(q && q.status).toLowerCase();
    if (st && ['healthy', 'ok', 'accepted', 'active'].indexOf(st) < 0) {
      limitations.push('source "' + abStr(q.source || q.platform) + '" quality=' + st);
    }
  });
  if (abStr((bundle.summary || {}).quality_status).toLowerCase() === 'degraded') limitations.push('run quality: degraded');

  var byName = {};
  competitors.forEach(function (c) {
    var name = abStr(c && c.competitor).trim();
    if (!name) return;
    var url = abFirstUrl(c.source_url);
    var key = abSourceId(url, name) || name;
    if (!byName[key]) {
      byName[key] = {
        source_key: key, source_kind: abSourceKind(url) || 'website', company_name: name,
        source_url: url, source_run_id: abStr(c.source_run_id), quality_status: abStr(c.quality) || 'accepted',
        positioning: abStr(c.positioning), score: abNum(c.score, null), last_checked: abStr(c.last_checked),
        evidence: [], offers: []
      };
    }
    var t = byName[key];
    // Deterministic positioning IS current-run evidence — it was extracted from the fetched page this run.
    if (t.positioning) {
      t.evidence.push({ source_url: url, source_type: t.source_kind, excerpt: t.positioning,
        fact_type: 'positioning', collected_at: abStr(c.last_checked), quality_status: t.quality_status, relevance: 90 });
    }
  });

  offers.forEach(function (o) {
    var name = abStr(o && o.competitor).trim();
    if (!name) return;
    var url = abFirstUrl(o.evidence_url);
    var key = abSourceId(url, name) || name;
    var t = byName[key];
    if (!t) { // an offer whose competitor row was dropped still identifies a logical source
      t = byName[key] = { source_key: key, source_kind: abSourceKind(url) || 'website', company_name: name,
        source_url: url, source_run_id: abStr(o.source_run_id), quality_status: 'accepted', positioning: '',
        score: null, last_checked: abStr(o.collected_at), evidence: [], offers: [] };
    }
    var parts = [];
    if (abStr(o.offer)) parts.push(abStr(o.offer));
    if (abStr(o.price_rate)) parts.push('условия: ' + abStr(o.price_rate));
    if (abStr(o.term)) parts.push('срок: ' + abStr(o.term));
    if (abStr(o.cta)) parts.push('призыв: ' + abStr(o.cta));
    var excerpt = parts.join(' — ');
    if (!excerpt) return;
    t.offers.push({ offer: abStr(o.offer), price_rate: abStr(o.price_rate), cta: abStr(o.cta) });
    t.evidence.push({ source_url: url || t.source_url, source_type: t.source_kind, excerpt: excerpt,
      fact_type: 'offer', collected_at: abStr(o.collected_at), quality_status: 'accepted', relevance: 80 });
  });

  // Explicit evidence rows carried by the bundle.
  //
  // SOCIAL-BRIDGE-001: this used to require an EXISTING target (`if (!t) return`), which silently discarded every
  // social post — a Telegram channel or VK community deliberately never becomes a competitor profile
  // (DEC-133/DEC-135), so `byName` was empty and 22 relevant, quality-gated posts produced ZERO analysis targets
  // (production req_76722076, executions 1096/1101: WF28 was never called and the user was told no competitor
  // profiles were found). Evidence with a real source and a citable excerpt is now enough to CREATE a target:
  // a full competitor profile is optional. Website evidence still attaches to its profile exactly as before,
  // because a matching key is looked up first.
  bundleEvidence.forEach(function (e) {
    if (!e || !abStr(e.excerpt)) return;
    var url = abFirstUrl(e.url);
    // Prefer the producer's explicit logical-source key (WF12 social evidence sets it); else derive it.
    var key = abStr(e.source_key) || abSourceId(url, abStr(e.competitor)) || abStr(e.competitor);
    if (!key) return;
    var t = byName[key];
    if (!t) {
      // A source known ONLY through its evidence — the social case. It has no profile, no offers and no
      // deterministic score, and it must not pretend otherwise: company_name is the channel/community name.
      var kind = abStr(e.source_kind) || abStr(e.platform) || abSourceKind(url) || 'website';
      t = byName[key] = {
        source_key: key, source_kind: kind,
        company_name: abStr(e.source_name) || abStr(e.competitor) || key,
        source_url: abStr(e.profile_url) || url, source_run_id: abStr(e.source_run_id),
        quality_status: abStr(e.source_quality) || 'accepted', positioning: '',
        score: null, last_checked: abStr(e.collected_at), evidence: [], offers: [],
        evidence_only: true
      };
    }
    t.evidence.push({ source_url: url, source_type: abStr(e.source_kind) || abStr(e.platform) || t.source_kind,
      excerpt: abStr(e.excerpt), evidence_id: abStr(e.evidence_id),
      fact_type: abStr(e.finding) || 'general', collected_at: abStr(e.collected_at),
      quality_status: abStr(e.source_quality) || 'accepted', relevance: 70 });
  });

  var all = Object.keys(byName).map(function (k) { return byName[k]; });
  var considered = all.length;
  // Only sources with real citable evidence, richest first, hard-capped: never a per-row call explosion.
  var eligible = all.filter(function (t) { return t.evidence.length > 0; })
    .sort(function (a, b) { return b.evidence.length - a.evidence.length; })
    .slice(0, maxTargets);

  var targets = eligible.map(function (t) {
    // SOCIAL-BRIDGE-001: an evidence-only social source is ONE channel/community with no competitor profile.
    // State that bound explicitly so the analyst cannot generalise it into a market claim, and so a silent
    // comment section is never read as "the audience has no questions".
    var lim = limitations.slice(0, 6);
    if (t.evidence_only) {
      lim = lim.concat([
        'источник «' + t.source_key + '» проанализирован только по его публичным постам: карточки конкурента с офферами и ценами нет',
        'выводы описывают только этот источник и не переносятся на рынок в целом',
        'отсутствие комментариев/реакций не означает отсутствия интереса аудитории'
      ]).slice(0, 9);
    }
    return {
      source_key: t.source_key,
      source_kind: t.source_kind,
      evidence_input: {
        request: {
          agent_request_id: abStr(ctx.agent_request_id), niche: abStr(ctx.niche), region: abStr(ctx.region),
          data_mode: abStr(ctx.data_mode) || 'live', collected_at: t.last_checked,
          requested_sources: Array.isArray(ctx.requested_sources) ? ctx.requested_sources : []
        },
        source: { source_id: t.source_key, kind: t.source_kind, source_run_id: t.source_run_id, quality_status: t.quality_status },
        current_run_facts: {
          company_name: t.company_name,
          positioning: t.positioning,
          offer_summary: t.offers.map(function (o) { return o.offer; }).filter(Boolean).join(' | '),
          prices_terms: t.offers.map(function (o) { return o.price_rate; }).filter(Boolean).join(' | '),
          cta_text: t.offers.map(function (o) { return o.cta; }).filter(Boolean).join(' | '),
          service_types: []
        },
        evidence: t.evidence.slice(0, maxEvPer),
        deterministic_scores: { confidence: t.score, relevance: null },
        limitations: lim,
        // Current-run only: this bundle is already request-scoped (B1). Nothing historical is presented as current.
        historical_context: Array.isArray(opts.historical_context) ? opts.historical_context : []
      }
    };
  });

  var reason = targets.length ? 'ok' : (considered ? 'no_citable_evidence' : 'no_sources');
  return { targets: targets, reason: reason, considered: considered };
}

// Fold WF28's typed returns into one run-level view. Tolerates a crashed/absent child (fail-open by contract:
// a missing analysis degrades the report to deterministic, it never blocks delivery).
function collectAnalyses(returns) {
  var rows = (Array.isArray(returns) ? returns : []).filter(function (r) { return r && (r.analysis_id || r.analysis); });
  var enriched = rows.filter(function (r) { return r.enriched === true && r.analysis && Object.keys(r.analysis).length; });
  var cost = 0, repairCost = 0, reused = 0, repaired = 0, fallbacks = 0;
  var reuseLineage = [], cacheDecisions = [], model = '';
  var tokensIn = 0, tokensOut = 0, latencyMax = 0;
  rows.forEach(function (r) {
    cost += abNum(r.cost_usd, 0);
    repairCost += abNum(r.repair_cost_usd, 0);
    tokensIn += abNum(r.tokens_in, 0); tokensOut += abNum(r.tokens_out, 0);
    if (abNum(r.latency_ms, 0) > latencyMax) latencyMax = abNum(r.latency_ms, 0);
    if (abStr(r.mode) === 'reuse') {
      reused++;
      // REUSE-OBS-001: a reused analysis must NAME the analysis it came from — this is the run-level audit record.
      reuseLineage.push({ analysis_id: abStr(r.analysis_id), reused_from_analysis_id: abStr(r.reused_from_analysis_id),
        reused_from_created_at: abStr(r.reused_from_created_at) });
    }
    if (abStr(r.cache_decision)) cacheDecisions.push({ analysis_id: abStr(r.analysis_id),
      decision: abStr(r.cache_decision), reason: abStr(r.cache_reason) });
    if (!model && abStr(r.model)) model = abStr(r.model);
    if (r.repair_used === true) repaired++;
    if (r.fallback_used === true) fallbacks++;
  });
  return {
    analyses: enriched,
    analysis_ids: rows.map(function (r) { return abStr(r.analysis_id); }).filter(Boolean),
    any_enriched: enriched.length > 0,
    count_total: rows.length, count_enriched: enriched.length,
    count_reused: reused, count_repaired: repaired, count_fallback: fallbacks,
    // WIP3-A: truthful WF28 provider-call counts. A reuse (cache hit) makes ZERO provider calls; every other
    // analysis (enriched OR deterministic-fallback) made exactly one PRIMARY attempt; a repaired analysis made
    // one additional repair call. These are the canonical llm_primary_calls / llm_repair_calls for the summary.
    llm_primary_calls: rows.length - reused,
    llm_repair_calls: repaired,
    analysis_cost_usd: Math.round(cost * 1e6) / 1e6,
    // COST-SPLIT-001: the repair share of the analysis cost, its own canonical component downstream.
    analysis_repair_cost_usd: Math.round(repairCost * 1e6) / 1e6,
    reuse_lineage: reuseLineage, cache_decisions: cacheDecisions.slice(0, 10), model: model,
    // REPORT-TRUTH-D: token/latency telemetry travels to the hidden tech sheet.
    tokens_in: tokensIn, tokens_out: tokensOut, latency_ms: latencyMax
  };
}

module.exports = { buildAnalysisTargets, collectAnalyses, abSourceKind, abSourceId };
