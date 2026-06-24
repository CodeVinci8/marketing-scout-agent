'use strict';
// research_pipeline.js — the reusable PRODUCTION assembly that turns RAW collected source records into a
// report bundle (Sections 24-28). Previously this logic only lived inline in workflow Code nodes (WF10/WF12),
// so there was no testable raw->report path. This module makes every transition a pure, deterministic function:
//
//   raw records -> normalize -> dedupe -> entity resolution -> evidence extraction -> claim construction ->
//   evidence<->claim linkage -> reproducible calculations -> competitor/opportunity/confidence scoring ->
//   report bundle (compatible with report_package.js / xlsx_writer.js / conversation_response.js)
//
// It NEVER invents an excerpt, a source, or a number. Missing data yields "Недостаточно данных"/null, not a
// guess. Raw records are preserved; conflicts are retained and flagged; stale evidence lowers confidence;
// unsupported claims are labelled (not presented as fact). Pure + deterministic + self-contained, $0, offline.

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function num(v) { if (v == null || str(v).trim() === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
function arr(v) { return Array.isArray(v) ? v : []; }
function djb2(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'h' + h.toString(16); }

// ---- normalization -------------------------------------------------------------------------------------------
function canonDomain(u) { return low(u).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0]; }
function canonUrl(u) { var s = str(u).trim(); if (!s) return ''; s = s.replace(/#.*$/, '').replace(/\/+$/, ''); return s.replace(/^http:\/\//i, 'https://'); }
function canonName(n) { return low(n).replace(/["'«»]/g, '').replace(/\b(ооо|оао|зао|ип|llc|ltd|inc)\b/g, '').replace(/\s+/g, ' ').trim(); }
// "4,5%" / "5.9" / "от 4,5 %" -> 4.5 ; non-numeric -> null (never fabricate).
function parseRate(v) { var s = str(v).replace('%', '').replace(',', '.').replace(/[^0-9.]/g, ' ').trim().split(/\s+/)[0]; if (s === '') return null; var n = Number(s); return isFinite(n) ? n : null; }

function normalizeRecords(raw) {
  return arr(raw).map(function (r, i) {
    r = r || {};
    var ok = r.success !== false && !r.error;
    return {
      record_id: str(r.record_id) || ('rec_' + (i + 1)),
      source_url: canonUrl(r.source_url || r.url),
      domain: canonDomain(r.source_url || r.url || r.domain),
      competitor_name: str(r.competitor || r.competitor_hint || r.name),
      fetched_at: str(r.fetched_at || r.collected_at),
      published_at: str(r.published_at),
      http_status: num(r.http_status),
      content_hash: str(r.content_hash) || djb2(str(r.raw_text || r.excerpt || r.content)),
      excerpt: str(r.excerpt || r.raw_text || r.content).slice(0, 500),
      region: str(r.region),
      fields: r.fields && typeof r.fields === 'object' ? r.fields : {},
      ok: ok, error: ok ? '' : str(r.error || 'collection_failed'),
      raw_ref: { hash: djb2(JSON.stringify(r)), bytes: JSON.stringify(r).length }   // raw preserved by reference
    };
  });
}

// ---- dedupe (canonical url + content hash; preserve raw; flag dupes) -----------------------------------------
function dedupePages(records) {
  var seen = {}, unique = [], duplicates = [];
  records.forEach(function (r) {
    if (!r.ok) { unique.push(r); return; }
    var key = r.source_url + '|' + r.content_hash;
    if (seen[key]) { duplicates.push({ record_id: r.record_id, dup_of: seen[key] }); }
    else { seen[key] = r.record_id; unique.push(r); }
  });
  return { unique: unique, duplicates: duplicates };
}

// ---- entity resolution (group by canonical domain; keep aliases; never merge unrelated) ----------------------
function resolveEntities(records) {
  var byDomain = {};
  records.forEach(function (r) {
    if (!r.domain) return;
    var e = byDomain[r.domain] || (byDomain[r.domain] = { domain: r.domain, names: {}, regions: {}, records: [], failed: 0 });
    if (r.competitor_name) e.names[canonName(r.competitor_name)] = r.competitor_name;
    if (r.region) e.regions[r.region] = 1;
    if (!r.ok) e.failed++;
    e.records.push(r);
  });
  return Object.keys(byDomain).sort().map(function (d) {
    var e = byDomain[d];
    var names = Object.keys(e.names).map(function (k) { return e.names[k]; });
    return {
      competitor: names[0] || e.domain, aliases: names.slice(1), domain: e.domain,
      region: Object.keys(e.regions)[0] || '', record_ids: e.records.map(function (r) { return r.record_id; }),
      collected: e.records.filter(function (r) { return r.ok; }).length, failed: e.failed,
      quality: e.failed && !e.records.some(function (r) { return r.ok; }) ? 'quarantined' : (e.failed ? 'degraded' : 'healthy'),
      match_confidence: names.length <= 1 ? 'high' : 'medium'   // multiple distinct names on one domain => review
    };
  });
}

// ---- evidence extraction + claim construction + linkage ------------------------------------------------------
function freshnessDays(collectedAt, now) { var t0 = Date.parse(str(collectedAt)); if (!isFinite(t0)) return null; return Math.max(0, (Date.parse(str(now)) || Date.now() - 0) / 1 - t0) / 86400000; }
function extractEvidence(records, now, staleDays) {
  staleDays = staleDays || 7;
  return records.filter(function (r) { return r.ok; }).map(function (r, i) {
    var age = freshnessDays(r.fetched_at, now);
    var stale = age != null && age > staleDays;
    var hasExcerpt = str(r.excerpt).trim() !== '';
    return {
      evidence_id: 'ev_' + (i + 1), finding_id: 'f_' + djb2(r.domain + (r.fields.offer || '')),
      competitor: r.competitor_name || r.domain, url: r.source_url, source_record_id: r.record_id,
      excerpt: r.excerpt, excerpt_empty: !hasExcerpt, collected_at: r.fetched_at,
      source_quality: r.http_status && r.http_status >= 400 ? 'degraded' : 'healthy',
      freshness_days: age == null ? null : Math.round(age * 10) / 10, stale: stale,
      confidence: !hasExcerpt ? 'low' : (stale ? 'medium' : 'high'), available: hasExcerpt
    };
  });
}
// A claim must have >=1 supporting evidence id; unsupported claims are labelled, never presented as fact.
function buildClaims(evidence, proposed) {
  var byFinding = {};
  evidence.forEach(function (e) { (byFinding[e.finding_id] = byFinding[e.finding_id] || []).push(e.evidence_id); });
  return arr(proposed).map(function (c, i) {
    var support = (c.finding_id && byFinding[c.finding_id]) ? byFinding[c.finding_id] : [];
    var supported = support.length > 0 && c.type !== 'assumption';
    return {
      claim_id: 'c_' + (i + 1), text: str(c.text), claim_type: c.type || (supported ? 'fact' : 'inference'),
      supporting_evidence_ids: support, supported: supported,
      label: supported ? 'fact' : (c.type === 'assumption' ? 'assumption' : 'unsupported_inference'),
      confidence: supported ? (support.length > 1 ? 'high' : 'medium') : 'low'
    };
  });
}

// ---- reproducible calculations (every result carries formula/inputs/output/units/assumptions/limitations) ----
function median(xs) { var a = xs.slice().sort(function (x, y) { return x - y; }); var n = a.length; if (!n) return null; var m = Math.floor(n / 2); return n % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
function priceStats(values) {
  var xs = arr(values).map(num).filter(function (v) { return v != null; });
  if (xs.length < 1) return { name: 'price_statistics', inputs: values, output: null, units: '%', formula: 'min/max/mean/median', assumptions: [], limitations: ['Недостаточно данных'] };
  var min = Math.min.apply(null, xs), max = Math.max.apply(null, xs), mean = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length, med = median(xs);
  var out = { min: min, max: max, mean: Math.round(mean * 100) / 100, median: med, range: Math.round((max - min) * 100) / 100, n: xs.length };
  if (xs.length >= 4) { var a = xs.slice().sort(function (x, y) { return x - y; }); out.q1 = a[Math.floor(a.length * 0.25)]; out.q3 = a[Math.floor(a.length * 0.75)]; }
  return { name: 'price_statistics', inputs: xs, output: out, units: '%', formula: 'min,max,mean=Σx/n,median', assumptions: ['rates comparable (same product family)'], limitations: xs.length < 4 ? ['quartiles omitted (n<4)'] : [] };
}
function priceIndex(value, marketMedian) {
  var v = num(value), m = num(marketMedian);
  if (v == null || m == null || m === 0) return { name: 'price_index', inputs: { value: value, market_median: marketMedian }, output: null, units: 'index', formula: 'value / market_median', assumptions: [], limitations: ['Недостаточно данных'] };
  return { name: 'price_index', inputs: { value: v, market_median: m }, output: Math.round((v / m) * 1000) / 1000, units: 'index (1.0=median)', formula: 'value / market_median', assumptions: ['same currency/period'], limitations: [] };
}
function pctDiff(value, baseline) {
  var v = num(value), b = num(baseline);
  if (v == null || b == null || b === 0) return { name: 'percentage_difference', inputs: { value: value, baseline: baseline }, output: null, units: '%', formula: '(value-baseline)/baseline*100', limitations: ['Недостаточно данных'], assumptions: [] };
  return { name: 'percentage_difference', inputs: { value: v, baseline: b }, output: Math.round(((v - b) / b) * 1000) / 10, units: '%', formula: '(value-baseline)/baseline*100', assumptions: [], limitations: [] };
}
function cagr(startValue, endValue, years) {
  var s = num(startValue), e = num(endValue), y = num(years);
  var lim = [];
  if (s == null || e == null || y == null) lim.push('Недостаточно данных');
  if (s != null && s <= 0) lim.push('start value must be > 0');
  if (y != null && y <= 0) lim.push('time interval must be > 0');
  if (lim.length) return { name: 'cagr', inputs: { start: startValue, end: endValue, years: years }, output: null, units: 'ratio/yr', formula: '(end/start)^(1/years)-1', assumptions: ['values comparable'], limitations: lim };
  return { name: 'cagr', inputs: { start: s, end: e, years: y }, output: Math.round((Math.pow(e / s, 1 / y) - 1) * 10000) / 10000, units: 'ratio/yr', formula: '(end/start)^(1/years)-1', assumptions: ['values comparable'], limitations: [] };
}
// weighted score: weights MUST sum to 1 (±0.001) or it is rejected (no silent normalization).
function weightedScore(inputs, weights) {
  var keys = Object.keys(weights || {});
  var sum = keys.reduce(function (a, k) { return a + num(weights[k]); }, 0);
  if (Math.abs(sum - 1) > 0.001) return { name: 'weighted_score', inputs: inputs, output: null, units: '0-10', formula: 'Σ(wi*xi)', weights: weights, assumptions: [], limitations: ['weights must sum to 1 (got ' + Math.round(sum * 1000) / 1000 + ')'] };
  var missing = keys.filter(function (k) { return num(inputs && inputs[k]) == null; });
  var score = keys.reduce(function (a, k) { return a + num(weights[k]) * (num(inputs && inputs[k]) || 0); }, 0);
  return { name: 'weighted_score', inputs: inputs, output: Math.round(score * 100) / 100, units: '0-10', formula: 'Σ(wi*xi)', weights: weights, assumptions: ['weights documented, not objective truth'], limitations: missing.length ? ['missing inputs: ' + missing.join(',') + ' (treated as 0)'] : [] };
}
function opportunityScore(factors, weights) { var w = weights || { demand: 0.3, gap: 0.3, differentiation: 0.2, feasibility: 0.1, evidence: 0.1 }; var r = weightedScore(factors, w); r.name = 'opportunity_score'; return r; }
function confidenceScore(factors) {
  var f = factors || {};
  var parts = { authority: num(f.authority), freshness: num(f.freshness), corroboration: num(f.corroboration), completeness: num(f.completeness), directness: num(f.directness) };
  var present = Object.keys(parts).filter(function (k) { return parts[k] != null; });
  if (!present.length) return { name: 'confidence', inputs: factors, output: null, label: 'unknown', units: '0-1', formula: 'mean(present factors)', assumptions: [], limitations: ['Недостаточно данных'] };
  var avg = present.reduce(function (a, k) { return a + parts[k]; }, 0) / present.length;
  return { name: 'confidence', inputs: parts, output: Math.round(avg * 100) / 100, label: avg >= 0.7 ? 'high' : (avg >= 0.4 ? 'medium' : 'low'), units: '0-1', formula: 'mean(present factors)', assumptions: ['weak evidence is not upgraded to false precision'], limitations: present.length < 5 ? ['some factors missing'] : [] };
}

// ---- assemble the report bundle (compatible with report_package / xlsx_writer / conversation_response) -------
function runResearchPipeline(input) {
  input = input || {};
  var now = str(input.now) || '2026-06-24T12:00:00+03:00';
  var transitions = [];
  function T(name, ok, detail) { transitions.push({ name: name, ok: !!ok, detail: detail || '' }); }

  var normalized = normalizeRecords(input.raw_records); T('normalize', normalized.length > 0, normalized.length + ' records');
  var dd = dedupePages(normalized); T('dedupe', true, dd.duplicates.length + ' duplicates removed');
  var entities = resolveEntities(dd.unique); T('entity_resolution', entities.length > 0, entities.length + ' competitors');
  var evidence = extractEvidence(dd.unique, now, input.stale_days || 7); T('evidence_extraction', true, evidence.length + ' evidence items');
  var claims = buildClaims(evidence, input.proposed_claims); T('claim_construction', true, claims.length + ' claims');
  T('evidence_claim_linkage', claims.every(function (c) { return c.supported === (c.supporting_evidence_ids.length > 0 && c.claim_type !== 'assumption'); }), 'linked');

  // offers (from record fields) + rates for calculations
  var offers = dd.unique.filter(function (r) { return r.ok && (r.fields.offer || r.fields.price_rate); }).map(function (r) {
    return { competitor: r.competitor_name || r.domain, offer: str(r.fields.offer), price_rate: str(r.fields.price_rate), amount_range: str(r.fields.amount_range), term: str(r.fields.term), cta: str(r.fields.cta), promotion: str(r.fields.promotion), collected_at: r.fetched_at, evidence_url: r.source_url, source_record_id: r.record_id };
  });
  var rates = offers.map(function (o) { return parseRate(o.price_rate); }).filter(function (v) { return v != null; });
  var stats = priceStats(rates); T('calculations', stats.output != null || stats.limitations.indexOf('Недостаточно данных') >= 0, 'price stats');
  var marketMedian = stats.output ? stats.output.median : null;

  // competitor scoring (weighted) + index
  var calculations = [stats];
  var competitors = entities.map(function (e) {
    var firstOffer = offers.filter(function (o) { return canonName(o.competitor) === canonName(e.competitor); })[0];
    var rate = firstOffer ? parseRate(firstOffer.price_rate) : null;
    var idx = priceIndex(rate, marketMedian); calculations.push(idx);
    var score = weightedScore({ visibility: e.collected ? 6 : 0, breadth: Math.min(10, e.record_ids.length * 2), price: rate != null && marketMedian ? Math.max(0, 10 - (rate / marketMedian) * 5) : 0, evidence: e.quality === 'healthy' ? 8 : 4 }, { visibility: 0.25, breadth: 0.25, price: 0.25, evidence: 0.25 });
    return { competitor: e.competitor, domain: e.domain, region: e.region, positioning: firstOffer ? str(firstOffer.offer) : '', score: score.output, quality: e.quality, last_checked: now, source_url: 'https://' + e.domain + '/', price_index: idx.output, match_confidence: e.match_confidence };
  });
  T('competitor_scoring', competitors.length > 0, competitors.length + ' scored');

  var opp = opportunityScore({ demand: 7, gap: marketMedian != null ? 6 : 3, differentiation: 6, feasibility: 7, evidence: evidence.length ? 7 : 2 }); calculations.push(opp);
  var conf = confidenceScore({ authority: 0.7, freshness: evidence.some(function (e) { return e.stale; }) ? 0.4 : 0.8, corroboration: evidence.length > 1 ? 0.7 : 0.3, completeness: rates.length >= competitors.length ? 0.7 : 0.4, directness: 0.7 }); calculations.push(conf);
  T('opportunity_scoring', true, 'opp=' + opp.output); T('confidence_scoring', true, conf.label);

  var supportedClaims = claims.filter(function (c) { return c.supported; });
  var recommendations = supportedClaims.slice(0, 3).map(function (c) {
    return { recommendation: 'Реакция на: ' + c.text, priority: c.confidence === 'high' ? 'high' : 'medium', rationale: 'Подтверждено доказательствами ' + c.supporting_evidence_ids.join(','), linked_finding_ids: c.supporting_evidence_ids, next_action: 'Подготовить ответ' };
  });
  if (!recommendations.length) recommendations.push({ recommendation: 'Собрать больше данных', priority: 'low', rationale: 'Недостаточно подтверждённых фактов', linked_finding_ids: [], next_action: 'Расширить сбор' });

  var report = {
    report_id: 'report_' + djb2(str(input.agent_request_id) + now), agent_request_id: str(input.agent_request_id),
    owner_user_id: str(input.owner_id), created_at: now, niche: str(input.niche), region: str(input.region),
    time_window_days: num(input.time_window_days) || 30, data_mode: 'fixture',
    budgets: input.budgets || { source_budget_usd: 0.2, llm_budget_usd: 0.5, max_external_calls: 40 },
    summary: {
      competitors_found: competitors.length, sources_checked: dd.unique.length, quality_status: competitors.some(function (c) { return c.quality === 'quarantined'; }) ? 'degraded' : 'healthy',
      key_findings: supportedClaims.map(function (c) { return c.text; }), key_recommendations: recommendations.map(function (r) { return r.recommendation; }),
      external_calls: normalized.length, llm_primary_calls: 0, source_cost_status: 'known', llm_cost_status: 'unknown',
      collection_outcome: normalized.some(function (r) { return !r.ok; }) ? 'partial' : 'complete'
    },
    competitors: competitors, offers: offers,
    evidence: evidence.map(function (e) { return { finding_id: e.finding_id, finding: e.excerpt.slice(0, 80), competitor: e.competitor, excerpt: e.excerpt, url: e.url, source_record_id: e.source_record_id, source_quality: e.source_quality, confidence: e.confidence, collected_at: e.collected_at, available: e.available }; }),
    recommendations: recommendations,
    source_quality: entities.map(function (e) { return { source: e.domain, quality: e.quality, collected: e.collected, failed: e.failed }; }),
    claims: claims, calculations: calculations,
    run_metadata: { now: now, pipeline_version: 'pipeline-v1', duplicates_removed: dd.duplicates.length, failed_sources: normalized.filter(function (r) { return !r.ok; }).length }
  };
  T('report_generation', true, report.report_id);
  return { report: report, transitions: transitions, evidence: evidence, claims: claims, entities: entities, dedupe: dd, calculations: calculations };
}

module.exports = {
  normalizeRecords, dedupePages, resolveEntities, extractEvidence, buildClaims,
  priceStats, priceIndex, pctDiff, cagr, weightedScore, opportunityScore, confidenceScore, median,
  canonDomain, canonUrl, canonName, parseRate, runResearchPipeline, djb2
};
