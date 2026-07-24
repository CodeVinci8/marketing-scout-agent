'use strict';
// analysis_report_ru.js — render WF28's typed analyses as the Russian Stage-F report sections, and as the
// Stage-F XLSX sheet data. This EXTENDS the deterministic report; it never replaces it.
//
// Contract (Stage F §5):
//   «Подтверждённые факты»        — deterministic collected facts (offers/prices/CTA) are AUTHORITATIVE and come
//                                   first; Claude's kind=fact items follow, each evidence-cited.
//   «Аналитические выводы»        — ONLY kind=inference. Interpretation, never presented as fact.
//   «Рекомендации»                — ONLY kind=recommendation + recommended_actions. Never presented as fact.
//   «Доказательства и ограничения» — the numbered source URLs every claim cites, plus unknowns, data limits and an
//                                   honest note when the AI part degraded.
//
// Hard rules enforced here:
//   * A claim with NO citable evidence id is DROPPED — never rendered. (No claim without an allowed evidence id.)
//   * Internal ev_N ids never reach the user: they are remapped to visible [1],[2]… markers backed by real URLs.
//   * No JSON, no tool names, no English enum labels, no policy ids, no thinking, no provider messages, no
//     analysis_id/telemetry — those live in rows and the hidden technical sheet only.
//   * A degraded/fallback analysis contributes NOTHING to the narrative; it only produces an honest short note.
//
// Embeddable: unique ar*-prefixed names, no cross-lib require.

function arStr(v) { return v == null ? '' : String(v); }
function arNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function arTrim(v, n) { var s = arStr(v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Internal English enums -> Russian labels. An unknown value falls back to a generic label, NEVER the raw id.
var AR_DIMENSION_RU = {
  positioning: 'позиционирование', products_services: 'продукты и услуги', offers: 'офферы',
  prices_terms: 'цены и условия', cta_touchpoints: 'призывы к действию', target_audience: 'аудитория',
  pains: 'боли клиентов', objections: 'возражения', advertising_angles: 'рекламные заходы',
  content_angles: 'контент-заходы', strengths: 'сильные стороны', weaknesses: 'слабые стороны',
  trust_signals: 'сигналы доверия', market_gaps: 'ниши и пробелы', risks: 'риски'
};
var AR_PRIORITY_RU = { high: 'высокий', medium: 'средний', low: 'низкий' };
// Dimensions that belong on the «Боли и сигналы» sheet.
var AR_PAIN_DIMENSIONS = ['pains', 'objections'];

// REPORT-TRUTH-E (defect 7): a comparison/synthesis `aspect` is a raw English key from the analyst tool
// (positioning/offers/prices/cta/strengths/weaknesses/audience) — never show it to the user. Unknown keys are
// title-cased so a new aspect degrades gracefully instead of leaking a raw enum.
var AR_ASPECT_RU = {
  positioning: 'Позиционирование', offers: 'Офферы', products_services: 'Продукты и услуги',
  prices: 'Цены и ставки', prices_terms: 'Цены и ставки', cta: 'Призывы к действию',
  cta_touchpoints: 'Призывы к действию', strengths: 'Сильные стороны', weaknesses: 'Слабые стороны',
  audience: 'Аудитория', target_audience: 'Аудитория', trust_signals: 'Сигналы доверия',
  market_gaps: 'Ниши и пробелы', risks: 'Риски'
};
function arDimensionRu(v) { return AR_DIMENSION_RU[arStr(v).toLowerCase()] || 'наблюдение'; }
function arPriorityRu(v) { return AR_PRIORITY_RU[arStr(v).toLowerCase()] || 'средний'; }
function arAspectRu(v) {
  var k = arStr(v).toLowerCase().trim();
  if (AR_ASPECT_RU[k]) return AR_ASPECT_RU[k];
  return k ? (k.charAt(0).toUpperCase() + k.slice(1)) : 'Сравнение';
}
// Per-evidence source identity (defect 6): a multi-source analysis keys its top-level `source` as "multi", but each
// evidence row belongs to ONE real source. Prefer the evidence item's own source_id, else the URL host — never the
// aggregate "multi" — so «Доказательства» names the true competitor for every row.
function arHostOf(u) { var m = arStr(u).match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1].replace(/^www\./i, '') : ''; }
function arEvidenceSource(e, a) {
  var sid = arStr(e && e.source_id);
  if (sid && sid.toLowerCase() !== 'multi') return sid;
  var h = arHostOf(e && (e.url || e.source_url));
  if (h) return h;
  // last resort: the analysis-level source id, but only when it names a REAL source. A comparison/synthesis carries
  // source_id 'multi' (an aggregate, not a source) — never emit that as an identity. h is already known falsy here.
  var as = arStr(((a && a.source) || {}).source_id);
  return (as && as.toLowerCase() !== 'multi') ? as : '';
}
// REPORT-TRUTH-E (row integrity): merge two workbook row lists WITHOUT duplicating a row both produce. The
// comparison-derived recommendations/pains are ALREADY folded into analysisXlsxData's return, so a blind concat of a
// second analysisXlsxData call doubled every row (rows N+1..2N == rows 1..N). Dedup by normalized text (+ source),
// primary order preserved, only genuinely-new rows from `extra` appended — rows that merely have similar wording are
// kept (exact normalized match only).
function arRowKey(r) {
  return arStr(r && (r.text != null ? r.text : r.recommendation)).toLowerCase().replace(/\s+/g, ' ').trim()
    + '|' + arStr(r && r.source).toLowerCase().trim();
}
function arMergeXlsxRows(primary, extra) {
  var out = (Array.isArray(primary) ? primary : []).slice(), seen = {};
  out.forEach(function (r) { seen[arRowKey(r)] = true; });
  (Array.isArray(extra) ? extra : []).forEach(function (r) { var k = arRowKey(r); if (seen[k]) return; seen[k] = true; out.push(r); });
  return out;
}
// REPORT-TRUTH-E (defect 10): a market-gap / unmet-demand claim drawn from a 2–3 source sample is a HYPOTHESIS,
// not an established fact — «незанятая ниша» must not read as proven. Label it (once) with the sample size.
var AR_GAP_RE = /незанят|не\s*закрыт|незакрыт|пробел|никто\s+(?:из|не)|отсутствует\s+на\s+рынке|свободн[а-яё]*\s+ниш|неудовлетвор[а-яё]+\s+спрос|незакрыт[а-яё]+\s+спрос/i;
function arHypothesisGuard(text, sourceCount) {
  var t = arStr(text); if (!t) return t;
  if (sourceCount && sourceCount > 3) return t;          // a larger sample is not flagged
  if (/гипотез|предполож|вероятн|возможно/i.test(t)) return t;  // already hedged
  if (AR_GAP_RE.test(t)) return t.replace(/[\s.]*$/, '') + ' (гипотеза на основе выборки из ' + (sourceCount || 'нескольких') + ' источников)';
  return t;
}
// Detect a universal / all-sources quantifier. DETECTION only — we never rewrite the sentence body (fragile Russian
// regex surgery breaks agreement/grammar). Cyrillic-safe: no \b/\w. Controlled + NOUN-ANCHORED so it fires on the real
// over-claims («все три источника», «все игроки», «у всех конкурентов», «каждый конкурент», «оба источника», «обе
// компании») but NOT on temporal «каждый месяц» or a bare verb «все предлагают» (no source-noun / numeral follows).
var AR_SRC_NOUN = 'источник|игрок|конкурент|компани|сайт|канал|сообществ|бренд|площадк|фирм|организац|сервис';
var AR_UNIVERSAL_RE = new RegExp('(^|[\\s(«"])(?:все\\s+(?:три|3|четыре|4|пять|5|(?:' + AR_SRC_NOUN + ')[а-яё]*)'
  + '|(?:у|для|во)\\s+всех|кажд(?:ый|ая|ое|ые)\\s+(?:из\\s+(?:трёх|трех|четырёх|четырех|пяти|них)|(?:' + AR_SRC_NOUN + ')[а-яё]*)'
  + '|об[ае]\\s+(?:' + AR_SRC_NOUN + ')[а-яё]*)', 'i');
var AR_NOT_ALL_RU = 'Подтверждено не для всех участвовавших источников';
// REPORT-TRUTH-E (defect 9, STRUCTURED fail-closed): a universal claim is RETAINED only when its cited evidence
// covers every contributing source. Otherwise the original clause is kept intact (no regex surgery) and a neutral,
// grammatical disclaimer is APPENDED — listing the sources that DO support it when known. We never invent which
// source supports a property: if the supporting ids cannot be resolved, only the neutral note is added.
function arBroadcastGuard(text, citedSources, totalSources, supportedIds) {
  var t = arStr(text);
  if (!t || !totalSources || totalSources < 2) return t;            // "all" is meaningless below 2 sources
  if (citedSources && citedSources >= totalSources) return t;       // evidence covers every source → keep as-is
  if (!AR_UNIVERSAL_RE.test(t)) return t;                           // no universal quantifier → nothing to qualify
  if (t.indexOf(AR_NOT_ALL_RU) >= 0) return t;                      // already qualified (idempotent)
  var ids = (Array.isArray(supportedIds) ? supportedIds : []).filter(Boolean);
  var note = AR_NOT_ALL_RU + (ids.length ? (' (подтверждено: ' + ids.join(', ') + ')') : '');
  return t.replace(/[\s.]*$/, '') + '. ' + note + '.';
}
// distinct real source identities a set of ev ids spans (via the analysis evidence_map) — the basis for both the
// broadcast coverage check and the «подтверждено: …» attribution. Order preserved, deduped.
function arCitedSources(ids, a) {
  var em = (a && a.evidence_map) || [], byId = {};
  em.forEach(function (e) { byId[arStr(e.id)] = arEvidenceSource(e, a); });
  var seen = {}, out = [];
  (ids || []).forEach(function (id) { var s = byId[arStr(id)]; if (s && !seen[s]) { seen[s] = true; out.push(s); } });
  return out;
}
function arCitedSourceCount(ids, a) { return arCitedSources(ids, a).length; }
// REPORT-TRUTH-E (defect 8): an AI-written limitation must not contradict the deterministic quality state. When the
// run actually collected healthy/accepted evidence, a limitation claiming the sources were quarantined/blocked/«не
// удалось собрать» is false — drop those lines. Honest limitations (scope, sample size, missing fields) are kept.
var AR_QUALITY_NEG_RE = /каранти|quarantin|заблокир|недоступ|не\s+удалось\s+собра|данные\s+не\s+(?:были\s+)?собра|источник[а-яё]*\s+отклон|отклон[а-яё]+\s+источник/i;
var AR_HEALTHY_STATES = ['healthy', 'ok', 'accepted', 'eligible', 'good'];
function arIsHealthyState(s) { return AR_HEALTHY_STATES.indexOf(arStr(s).toLowerCase()) >= 0; }
// A source id is only "named" in a limitation when it is distinctive enough to match unambiguously — a host
// (contains a dot) or a key of length >= 4 (website/telegram/avito, real hosts). Short keys like «vk» are NOT
// matched, so we never spuriously credit/deny a limitation from an accidental substring.
function arNamedIn(text, id) {
  var i = arStr(id).toLowerCase(); if (!i || (i.length < 4 && i.indexOf('.') < 0)) return false;
  return arStr(text).toLowerCase().indexOf(i) >= 0;
}
// REPORT-TRUTH-E (defect 8, SOURCE-AWARE): an AI-written limitation claiming a source was quarantined/blocked/
// «не удалось собрать» is dropped ONLY when it is provably false against the DETERMINISTIC per-source state — either
// it NAMES a source that is healthy/accepted, or it is an AGGREGATE claim while EVERY contributing source is
// healthy/accepted. A limitation that names a genuinely quarantined source, or an aggregate claim while ANY source
// is not-healthy or of unknown state, is KEPT. Fail-closed: never delete a legitimate quarantine warning just
// because a DIFFERENT source happens to be healthy.
function arResolveSourceStates(sourceStates) {
  // DEDUP + PRECEDENCE: the same source id can carry several quality observations (bundle.source_quality AND one row
  // per cited evidence). Collapse to ONE record per id, fail-closed: a source is HEALTHY only when EVERY observation
  // of it is a recognized healthy state; ANY non-healthy OR unknown/unrecognized observation makes it not-healthy.
  // A conflict (healthy + quarantined for the same id) therefore NEVER silently resolves to healthy.
  var byId = {}, order = [];
  (Array.isArray(sourceStates) ? sourceStates : []).forEach(function (s) {
    var id = arStr(s && (s.id != null ? s.id : s.source));
    var status = arStr(s && (s.status != null ? s.status : s));
    if (!status) return;                                       // no observed status → contributes nothing
    if (!(id in byId)) { byId[id] = { id: id, statuses: [status] }; order.push(id); }
    else byId[id].statuses.push(status);
  });
  return order.map(function (id) {
    var st = byId[id].statuses;
    var healthy = st.every(function (s) { return arIsHealthyState(s); });       // fail-closed: ALL must be healthy
    var shown = healthy ? st[0] : (st.filter(function (s) { return !arIsHealthyState(s); })[0] || st[0]);
    return { id: id, status: shown, healthy: healthy };
  });
}
function arQualityContradictionGuard(limitations, sourceStates) {
  var states = arResolveSourceStates(sourceStates);
  if (!states.length) return (limitations || []).slice();     // no deterministic state → cannot disprove anything
  var allHealthy = states.every(function (s) { return s.healthy; });
  return (limitations || []).filter(function (l) {
    var t = arStr(l); if (!AR_QUALITY_NEG_RE.test(t)) return true;              // not a quality-negative claim → keep
    var named = states.filter(function (s) { return arNamedIn(t, s.id); });
    if (named.length) return !named.every(function (s) { return s.healthy; });  // drop iff every named source healthy
    return !allHealthy;                                                        // aggregate: drop iff ALL sources healthy
  });
}

// Build the ev_N -> visible marker/URL index across every analysis in the run. One shared numbering, so [3] means
// the same source everywhere in the report.
function arBuildEvidenceIndex(analyses) {
  var byUrl = {}, list = [];
  (analyses || []).forEach(function (a) {
    var local = {};
    (a && a.evidence_map ? a.evidence_map : []).forEach(function (e) {
      var url = arStr(e && e.url);
      if (!url) return;
      if (!byUrl[url]) {
        // REPORT-TRUTH-D: the visible evidence entry carries the captured contract (bounded quote, kind of
        // observation, when it was collected, source quality) — a bare URL cannot honestly support many claims.
        list.push({ n: list.length + 1, url: url, type: arStr(e.type), source_id: arEvidenceSource(e, a),
          excerpt: arTrim(e.excerpt, 300), fact_type: arStr(e.fact_type),
          collected_at: arStr(e.collected_at), quality: arStr(e.quality_status) });
        byUrl[url] = list.length;
      } else {
        // Same URL seen again: backfill fields the first sighting lacked (never overwrite captured data).
        var ex = list[byUrl[url] - 1];
        if (!ex.excerpt && arStr(e.excerpt)) ex.excerpt = arTrim(e.excerpt, 300);
        if (!ex.fact_type && arStr(e.fact_type)) ex.fact_type = arStr(e.fact_type);
        if (!ex.collected_at && arStr(e.collected_at)) ex.collected_at = arStr(e.collected_at);
        if (!ex.quality && arStr(e.quality_status)) ex.quality = arStr(e.quality_status);
      }
      local[arStr(e.id)] = byUrl[url];
    });
    a.__local = local; // ev_N -> visible number, for this analysis only
  });
  return { list: list, size: list.length };
}

// Map an item's evidence_ids to visible markers. Returns '' when NOTHING is citable -> the caller drops the claim.
function arMarkers(item, analysis) {
  var local = (analysis && analysis.__local) || {};
  var seen = {}, nums = [];
  (item && Array.isArray(item.evidence_ids) ? item.evidence_ids : []).forEach(function (id) {
    var n = local[arStr(id)];
    if (n && !seen[n]) { seen[n] = true; nums.push(n); }
  });
  nums.sort(function (x, y) { return x - y; });
  return nums.length ? ' [' + nums.join('][') + ']' : '';
}

// Only analyses that actually produced grounded content may speak. A fallback/degraded result is NOT narrative.
function arUsable(a) {
  return !!(a && a.enriched === true && a.fallback_used !== true && a.analysis && typeof a.analysis === 'object'
    && arStr(a.quality_status) !== 'deterministic_fallback');
}
function arItems(analyses, kind) {
  var out = [];
  (analyses || []).forEach(function (a) {
    if (!arUsable(a)) return;
    ((a.analysis.items) || []).forEach(function (it) {
      if (arStr(it && it.kind) !== kind) return;
      var text = arTrim(it.text_ru, 400);
      if (!text) return;
      var mk = arMarkers(it, a);
      if (!mk) return;  // no allowed evidence id => never rendered
      out.push({ text: text, markers: mk, dimension: arStr(it.dimension), source_id: arStr((a.source || {}).source_id), analysis_id: arStr(a.analysis_id) });
    });
  });
  return out;
}
function arRecommendations(analyses) {
  var out = [];
  (analyses || []).forEach(function (a) {
    if (!arUsable(a)) return;
    ((a.analysis.recommended_actions) || []).forEach(function (r) {
      var text = arTrim(r && r.text_ru, 400);
      if (!text) return;
      var mk = arMarkers(r, a);
      if (!mk) return;
      out.push({ text: text, markers: mk, priority: arStr(r.priority), source_id: arStr((a.source || {}).source_id), analysis_id: arStr(a.analysis_id) });
    });
    // kind=recommendation items are recommendations too.
  });
  arItems(analyses, 'recommendation').forEach(function (i) {
    out.push({ text: i.text, markers: i.markers, priority: 'medium', source_id: i.source_id, analysis_id: i.analysis_id });
  });
  return out;
}

// Deterministic facts from the WF12 bundle — authoritative, rendered first and never gated on Claude.
function arDeterministicFacts(bundle) {
  bundle = bundle || {};
  var out = [];
  (Array.isArray(bundle.offers) ? bundle.offers : []).forEach(function (o) {
    var who = arStr(o && o.competitor);
    var bits = [];
    if (arStr(o.offer)) bits.push(arStr(o.offer));
    if (arStr(o.price_rate)) bits.push(arStr(o.price_rate));
    if (arStr(o.cta)) bits.push('призыв: ' + arStr(o.cta));
    if (!bits.length) return;
    out.push({ competitor: who, text: arTrim(bits.join(' — '), 300), url: arStr(o.evidence_url) });
  });
  return out;
}

// renderAnalysisSectionsRu(analyses, bundle, opts) -> { text, has_content, sections{...}, evidence_list, note }
function renderAnalysisSectionsRu(analyses, bundle, opts) {
  analyses = Array.isArray(analyses) ? analyses.slice() : [];
  opts = opts || {};
  var idx = arBuildEvidenceIndex(analyses);
  var facts = arItems(analyses, 'fact');
  var inferences = arItems(analyses, 'inference');
  var recs = arRecommendations(analyses);
  var detFacts = arDeterministicFacts(bundle);

  var unknowns = [];
  analyses.forEach(function (a) {
    if (!arUsable(a)) return;
    ((a.analysis.unknowns_ru) || []).forEach(function (u) { var t = arTrim(u, 200); if (t && unknowns.indexOf(t) < 0) unknowns.push(t); });
    ((a.analysis.limitations_ru) || []).forEach(function (u) { var t = arTrim(u, 200); if (t && unknowns.indexOf(t) < 0) unknowns.push(t); });
  });
  // REPORT-TRUTH-E (defect 8, source-aware): drop an AI limitation that claims a source was quarantined/blocked/
  // uncollected ONLY when the DETERMINISTIC per-source state (bundle source_quality + cited evidence, keyed by
  // source id/host) proves it false. Build {id,status} pairs so the guard can reason per source, not in aggregate.
  var qSourceStates = [];
  ((bundle && bundle.source_quality) || []).forEach(function (q) {
    qSourceStates.push({ id: arStr(q && (q.source_id || q.source || q.host)) || arHostOf(q && q.url), status: arStr(q && q.status) });
  });
  analyses.forEach(function (a) { (a && a.evidence_map ? a.evidence_map : []).forEach(function (e) { if (arStr(e.quality_status)) qSourceStates.push({ id: arEvidenceSource(e, a), status: arStr(e.quality_status) }); }); });
  unknowns = arQualityContradictionGuard(unknowns, qSourceStates);

  // Honest degradation note — never a provider message, never an error code.
  var degraded = analyses.filter(function (a) { return a && (a.fallback_used === true || arStr(a.quality_status) === 'deterministic_fallback'); }).length;
  var usable = analyses.filter(arUsable).length;
  var note = '';
  if (analyses.length && !usable) note = 'AI-анализ в этот раз не удалось выполнить — ниже только проверенные собранные данные.';
  else if (degraded) note = 'Часть источников осталась без AI-анализа — по ним показаны только собранные факты.';

  var L = [];
  var maxPer = arNum(opts.max_per_section, 8);
  var hasGrounded = (facts.length + inferences.length + recs.length) > 0;

  // REPORT-DEDUP-001: these sections EXTEND the deterministic report, which already lists the collected facts.
  // With nothing analytical to add we must append NOTHING (re-printing the facts would duplicate the report);
  // when every analysis degraded we append only the honest note.
  if (!hasGrounded) {
    return {
      text: arStr(note), has_content: false, note: note, evidence_list: [],
      sections: { deterministic_facts: detFacts, facts: [], inferences: [], recommendations: [], unknowns: unknowns },
      stats: { analyses: analyses.length, usable: usable, degraded: degraded, evidence_sources: 0 }
    };
  }

  if (detFacts.length || facts.length) {
    L.push('📌 Подтверждённые факты');
    detFacts.slice(0, maxPer).forEach(function (f) { L.push('• ' + (f.competitor ? f.competitor + ': ' : '') + f.text); });
    facts.slice(0, maxPer).forEach(function (f) { L.push('• ' + f.text + f.markers); });
    L.push('');
  }
  if (inferences.length) {
    L.push('🧠 Аналитические выводы');
    L.push('_Это интерпретация собранных данных, а не факты._');
    inferences.slice(0, maxPer).forEach(function (i) { L.push('• ' + i.text + i.markers); });
    L.push('');
  }
  if (recs.length) {
    L.push('💡 Рекомендации');
    L.push('_Это предложения к проверке, а не подтверждённые факты._');
    recs.slice(0, maxPer).forEach(function (r) { L.push('• ' + r.text + ' (приоритет: ' + arPriorityRu(r.priority) + ')' + r.markers); });
    L.push('');
  }
  var hasContent = (detFacts.length + facts.length + inferences.length + recs.length) > 0;
  if (idx.size || unknowns.length || note) {
    L.push('🔍 Доказательства и ограничения');
    if (idx.size) {
      L.push('Источники:');
      idx.list.slice(0, 20).forEach(function (e) { L.push('[' + e.n + '] ' + e.url); });
    }
    if (unknowns.length) {
      L.push('Требует проверки:');
      unknowns.slice(0, 6).forEach(function (u) { L.push('• ' + u); });
    }
    if (note) L.push(note);
    L.push('');
  }
  return {
    text: L.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    has_content: hasContent,
    note: note,
    evidence_list: idx.list,
    sections: { deterministic_facts: detFacts, facts: facts, inferences: inferences, recommendations: recs, unknowns: unknowns },
    stats: { analyses: analyses.length, usable: usable, degraded: degraded, evidence_sources: idx.size }
  };
}

// Append the Stage-F sections to the DETERMINISTIC report markdown. The deterministic report is always returned
// unchanged when there is nothing grounded to add (fail-open).
function appendAnalysisToReportRu(reportMarkdown, rendered) {
  var base = arStr(reportMarkdown);
  if (!rendered || !arStr(rendered.text)) return base;
  if (!rendered.has_content && !arStr(rendered.note)) return base;
  return base ? (base.replace(/\s+$/, '') + '\n\n' + rendered.text) : rendered.text;
}

// Stage-F XLSX sheet DATA (rows only; report_package owns the column/format contract).
// Returns only what is POPULATED — an empty section yields an empty array and its sheet is omitted upstream.
function analysisXlsxData(analyses, rendered) {
  var r = rendered || renderAnalysisSectionsRu(analyses, {}, {});
  var s = r.sections || {};
  // REPORT-TRUTH-D: keep the bracketed [1] [2] form — a bare «1» in a «Доказательства» column reads as a count,
  // not as a reference into the «Доказательства» sheet.
  var mk = function (m) { return arStr(m).replace(/\]\[/g, '] [').trim(); };
  var inferences = (s.inferences || []).map(function (i) {
    return { source: i.source_id, dimension: arDimensionRu(i.dimension), text: i.text, evidence: mk(i.markers) };
  });
  var recommendations = (s.recommendations || []).map(function (i) {
    return { source: i.source_id, text: i.text, priority: arPriorityRu(i.priority), evidence: mk(i.markers) };
  });
  // «Боли и сигналы» draws from BOTH facts and inferences whose dimension is a pain/objection.
  var pains = (s.facts || []).concat(s.inferences || []).filter(function (i) {
    return AR_PAIN_DIMENSIONS.indexOf(arStr(i.dimension).toLowerCase()) >= 0;
  }).map(function (i) {
    return { source: i.source_id, kind: arDimensionRu(i.dimension), text: i.text, evidence: mk(i.markers) };
  });
  // A comparison/synthesis analysis has NO fact/inference/rec items, so renderAnalysisSectionsRu takes its
  // no-grounded-content early return and hands back evidence_list:[] — even though arBuildEvidenceIndex DID build a
  // valid ev_N -> URL index from the multi-source package's evidence_map (and set each analysis's __local). Fall
  // back to that index directly so the comparison's sources still populate the «Доказательства» sheet and its
  // [n] refs resolve. (Single-source runs keep using r.evidence_list — identical numbering, same analyses.)
  var evList = (r.evidence_list && r.evidence_list.length) ? r.evidence_list : arBuildEvidenceIndex(analyses).list;
  var evidence = evList.map(function (e) {
    return { ref: '[' + e.n + ']', source: e.source_id, url: e.url, type: e.type,
      excerpt: arStr(e.excerpt), fact_type: arStr(e.fact_type),
      collected_at: arStr(e.collected_at), quality: arStr(e.quality) };
  });
  // REPORT-TRUTH-D: honest limitations belong on the user-facing Summary sheet.
  var unknowns = ((r.sections || {}).unknowns || []).slice(0, 5);
  // F-7: a comparison/synthesis analysis carries no `items` — surface its cross-source structure so the workbook
  // renders the comparison it was paid for. Each row cites the evidence ids of the sources it compares.
  var cmp = arComparisonXlsx(analyses);
  return { inferences: inferences, recommendations: recommendations.concat(cmp.recommendations),
    pains: pains.concat(cmp.pains), evidence: evidence, unknowns: unknowns,
    comparisons: cmp.comparisons, overview: cmp.overview };
}

// The internal ev_N ids the comparison analysis cites must NEVER reach the user (see the header rule) — they are
// remapped to the SAME visible [n] markers the «Доказательства» sheet uses, via the analysis's __local index.
// arComparisonXlsx runs after arBuildEvidenceIndex (analysisXlsxData builds the index first), so __local is set.
function arRemapEvIds(ids, local) {
  local = local || {};
  var seen = {}, nums = [];
  (ids || []).forEach(function (id) { var n = local[arStr(id)]; if (n && !seen[n]) { seen[n] = true; nums.push(n); } });
  nums.sort(function (a, b) { return a - b; });
  return nums.map(function (n) { return '[' + n + ']'; }).join(' ');
}
// The model routinely embeds citations INLINE in text_ru («…ценовой якорь [ev_1, ev_2]; …»). Rewrite each inline
// ev_N to its visible [n] (or drop it when unmapped), then tidy the punctuation an empty replacement can leave.
function arRemapEvText(text, local) {
  local = local || {};
  return arStr(text)
    .replace(/\[?\bev_(\d+)\b\]?/g, function (m, d) { var n = local['ev_' + d]; return n ? ('[' + n + ']') : ''; })
    .replace(/\[\s*,\s*/g, '[').replace(/,\s*\]/g, ']').replace(/\[\s*\]/g, '')
    .replace(/\s+([;,.)])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

// Extract the comparison/synthesis shape into workbook-ready rows. Opportunities and experiments become
// recommendations; recurring pains become pain rows; comparisons get their own list. Every ev_N (inline in the
// text AND in evidence_ids) is remapped to the visible [n] that resolves in the «Доказательства» sheet.
function arComparisonXlsx(analyses) {
  var comparisons = [], recommendations = [], pains = [], overview = '';
  (analyses || []).forEach(function (a) {
    if (!arUsable(a)) return;
    var an = a.analysis || {};
    if (!Array.isArray(an.comparisons)) return;
    var local = a.__local || {};
    // Total real sources in this package — the denominator for the broadcast guard (defect 9) and the sample size
    // for the hypothesis guard (defect 10).
    var total = Number((a.source || {}).source_count) || arCitedSourceCount((a.evidence_map || []).map(function (e) { return arStr(e.id); }), a);
    if (!overview) overview = arHypothesisGuard(arTrim(arRemapEvText(an.overview_ru, local), 400), total);
    (an.comparisons || []).forEach(function (c) {
      var t = arTrim(arRemapEvText(c && c.text_ru, local), 400); if (!t || !(c.evidence_ids || []).length) return;
      // defect 9: a property cited by only some sources must not be broadcast to all (structured, fail-closed, with
      // the supported source ids attributed); defect 10: gap claims from a small sample are hypotheses.
      var cited = arCitedSources(c.evidence_ids, a);
      t = arHypothesisGuard(arBroadcastGuard(t, cited.length, total, cited), total);
      comparisons.push({ aspect: arAspectRu(c.aspect), text: t, evidence: arRemapEvIds(c.evidence_ids, local) });
    });
    (an.opportunities || []).forEach(function (o) {
      var t = arTrim(arRemapEvText(o && o.text_ru, local), 400); if (!t || !(o.evidence_ids || []).length) return;
      var cited = arCitedSources(o.evidence_ids, a);
      t = arHypothesisGuard(arBroadcastGuard(t, cited.length, total, cited), total);   // defect 9/10
      recommendations.push({ source: 'сравнение', text: t, priority: arPriorityRu('medium'), evidence: arRemapEvIds(o.evidence_ids, local) });
    });
    (an.recommended_experiments || []).forEach(function (o) {
      var t = arTrim(arRemapEvText(o && o.text_ru, local), 400); if (!t) return;
      recommendations.push({ source: 'эксперимент', text: t, priority: arPriorityRu(o.priority), evidence: arRemapEvIds(o.evidence_ids || [], local) });
    });
    (an.recurring_pains_ru || []).forEach(function (p) {
      var t = arHypothesisGuard(arTrim(arRemapEvText(p, local), 300), total); if (!t) return;
      pains.push({ source: 'сравнение', kind: 'общая боль', text: t, evidence: '' });
    });
  });
  return { comparisons: comparisons, recommendations: recommendations, pains: pains, overview: overview };
}

module.exports = {
  AR_DIMENSION_RU, AR_PRIORITY_RU, AR_PAIN_DIMENSIONS, AR_ASPECT_RU,
  arDimensionRu, arPriorityRu, arAspectRu, arBuildEvidenceIndex, arUsable,
  arHostOf, arEvidenceSource, arRowKey, arMergeXlsxRows,
  arHypothesisGuard, arBroadcastGuard, arCitedSources, arCitedSourceCount,
  arQualityContradictionGuard, arResolveSourceStates, arIsHealthyState, arNamedIn, AR_NOT_ALL_RU,
  renderAnalysisSectionsRu, appendAnalysisToReportRu, analysisXlsxData, arDeterministicFacts
};
