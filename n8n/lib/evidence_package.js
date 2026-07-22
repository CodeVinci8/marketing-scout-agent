'use strict';
// evidence_package.js — build a BOUNDED, self-contained evidence package from current-run stored facts for a
// Stage-F Claude call. Claude sees ONLY this package (never whole Sheets / whole sites). Guarantees:
//   * stable evidence_ids (ev_<n>) the model must cite; nothing else is citable;
//   * current-run facts kept strictly separate from historical context (mirrors the B1 report scoping);
//   * excerpts capped, duplicates removed, top-N by relevance kept, PII (phone/email) scrubbed from excerpts;
//   * a deterministic package_hash for reuse/caching (same evidence ⇒ reuse a persisted analysis).
// Embeddable: unique ep*-prefixed names, no cross-lib require.

function epStr(v) { return v == null ? '' : String(v); }
function epNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
// F-3 TEXT-SAFETY-001: shorten on a WORD boundary. The old `slice(0, n-1)` cut mid-word, which is how
// «от рыночной стоимости» reached users as «от рыночно». Never emit a fragment of a Russian word.
function epTrim(v, n) {
  var s = epStr(v).replace(/\s+/g, ' ').trim();
  if (!(s.length > n) || !(n > 0)) return s;
  var head = s.slice(0, Math.max(1, n - 1));
  var cut = head.replace(/\s+\S*$/, '') || head;
  return cut.replace(/[\s,;:.–—-]+$/, '') + '…';
}

// Redact public contact data from an excerpt — we analyze positioning/offers, never harvest contacts.
function epScrubPii(s) {
  return epStr(s)
    .replace(/\+?\d[\d\s().-]{9,}\d/g, '[тел]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]');
}

function epHash(s) { // djb2, stable + fast
  s = epStr(s); var h = 5381;
  for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff; }
  return (h >>> 0).toString(16);
}

// buildEvidencePackage(input, opts) -> { package, allowed_evidence_ids, package_hash }
// input: {
//   request: { agent_request_id, niche, region, data_mode, collected_at, requested_sources:[...] },
//   source:  { source_id, kind, source_run_id, quality_status },
//   current_run_facts: { company_name, positioning, offer_summary, prices_terms, cta_text, service_types:[] },
//   evidence: [ { source_url, source_type, excerpt, fact_type, collected_at, quality_status } ],
//   deterministic_scores: { confidence, relevance },
//   limitations: [..],
//   historical_context: [ { source_id, kind, note } ]
// }
function buildEvidencePackage(input, opts) {
  input = input || {}; opts = opts || {};
  var maxItems = epNum(opts.max_evidence_items, 24);
  var maxExcerpt = epNum(opts.max_excerpt_chars, 600);

  var seen = {}, items = [], n = 0;
  var rawEv = Array.isArray(input.evidence) ? input.evidence.slice() : [];
  // highest relevance/quality first so the cap keeps the most useful evidence
  rawEv.sort(function (a, b) { return epNum(b && b.relevance, 0) - epNum(a && a.relevance, 0); });
  for (var i = 0; i < rawEv.length && n < maxItems; i++) {
    var e = rawEv[i] || {};
    var excerpt = epScrubPii(epTrim(e.excerpt, maxExcerpt));
    if (!excerpt) continue;
    var dedupKey = epHash(epStr(e.source_url) + '|' + excerpt.slice(0, 120));
    if (seen[dedupKey]) continue;
    seen[dedupKey] = true;
    n++;
    items.push({
      evidence_id: 'ev_' + n,
      source_url: epStr(e.source_url),
      source_type: epStr(e.source_type || (input.source && input.source.kind) || ''),
      excerpt: excerpt,
      fact_type: epStr(e.fact_type || 'general'),
      collected_at: epStr(e.collected_at || (input.request && input.request.collected_at) || ''),
      quality_status: epStr(e.quality_status || (input.source && input.source.quality_status) || 'accepted')
    });
  }

  var cf = input.current_run_facts || {};
  var pkg = {
    schema: 'evidence_package.v1',
    analysis_request: {
      agent_request_id: epStr((input.request || {}).agent_request_id),
      niche: epStr((input.request || {}).niche),
      region: epStr((input.request || {}).region),
      data_mode: epStr((input.request || {}).data_mode || 'live'),
      requested_sources: Array.isArray((input.request || {}).requested_sources) ? input.request.requested_sources : []
    },
    source_identity: {
      source_id: epStr((input.source || {}).source_id),
      kind: epStr((input.source || {}).kind),
      source_run_id: epStr((input.source || {}).source_run_id),
      quality_status: epStr((input.source || {}).quality_status || 'accepted'),
      collected_at: epStr((input.request || {}).collected_at)
    },
    current_run_facts: {
      company_name: epStr(cf.company_name),
      positioning: epTrim(cf.positioning, 400),
      offer_summary: epTrim(cf.offer_summary, 400),
      prices_terms: epTrim(cf.prices_terms, 300),
      cta_text: epTrim(cf.cta_text, 200),
      service_types: Array.isArray(cf.service_types) ? cf.service_types : []
    },
    deterministic_scores: {
      confidence: epNum((input.deterministic_scores || {}).confidence, null),
      relevance: epNum((input.deterministic_scores || {}).relevance, null)
    },
    evidence_items: items,
    limitations: Array.isArray(input.limitations) ? input.limitations.map(function (x) { return epStr(x); }) : [],
    // historical context is included but explicitly labeled NOT current — mirrors B1 report scoping.
    historical_context: (Array.isArray(input.historical_context) ? input.historical_context : []).map(function (h) {
      return { source_id: epStr(h.source_id), kind: epStr(h.kind), note: epTrim(h.note, 160) };
    })
  };
  var allowed = items.map(function (it) { return it.evidence_id; });
  var package_hash = epHash(JSON.stringify({ f: pkg.current_run_facts, e: items.map(function (i2) { return i2.excerpt; }), s: pkg.source_identity.source_id }));
  return { package: pkg, allowed_evidence_ids: allowed, package_hash: package_hash };
}

// Render the package as the compact English user message. Structure is English; evidence excerpts stay verbatim
// (may be Russian). Ends WITHOUT the tool instruction (the adapter appends that).
function renderPackagePrompt(pkg) {
  pkg = pkg || {};
  var L = [];
  var r = pkg.analysis_request || {}, s = pkg.source_identity || {}, f = pkg.current_run_facts || {};
  L.push('ANALYSIS REQUEST: niche=' + epStr(r.niche) + ' region=' + epStr(r.region) + ' mode=' + epStr(r.data_mode));
  L.push('SOURCE: ' + epStr(s.source_id) + ' (' + epStr(s.kind) + ', quality=' + epStr(s.quality_status) + ')');
  L.push('CURRENT-RUN FACTS (deterministic extraction — authoritative):');
  L.push('  company=' + epStr(f.company_name));
  if (f.positioning) L.push('  positioning=' + f.positioning);
  if (f.offer_summary) L.push('  offer=' + f.offer_summary);
  if (f.prices_terms) L.push('  prices/terms=' + f.prices_terms);
  if (f.cta_text) L.push('  cta=' + f.cta_text);
  if ((f.service_types || []).length) L.push('  service_types=' + f.service_types.join(', '));
  L.push('EVIDENCE ITEMS (cite these evidence_id values ONLY):');
  (pkg.evidence_items || []).forEach(function (e) {
    L.push('  [' + e.evidence_id + '] (' + e.source_type + ' ' + e.source_url + ', ' + e.fact_type + ') "' + e.excerpt + '"');
  });
  if ((pkg.limitations || []).length) L.push('KNOWN LIMITATIONS: ' + pkg.limitations.join('; '));
  if ((pkg.historical_context || []).length) {
    L.push('HISTORICAL CONTEXT (NOT results of this run — do not present as current):');
    pkg.historical_context.forEach(function (h) { L.push('  - ' + h.source_id + ' (' + h.kind + ') ' + h.note); });
  }
  return L.join('\n');
}

module.exports = { buildEvidencePackage, renderPackagePrompt, epScrubPii, epHash };
