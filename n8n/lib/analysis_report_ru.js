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

function arDimensionRu(v) { return AR_DIMENSION_RU[arStr(v).toLowerCase()] || 'наблюдение'; }
function arPriorityRu(v) { return AR_PRIORITY_RU[arStr(v).toLowerCase()] || 'средний'; }

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
        list.push({ n: list.length + 1, url: url, type: arStr(e.type), source_id: arStr((a.source || {}).source_id),
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
  });

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
    if (!overview) overview = arTrim(arRemapEvText(an.overview_ru, local), 400);
    (an.comparisons || []).forEach(function (c) {
      var t = arTrim(arRemapEvText(c && c.text_ru, local), 400); if (!t || !(c.evidence_ids || []).length) return;
      comparisons.push({ aspect: arStr(c.aspect) || 'сравнение', text: t, evidence: arRemapEvIds(c.evidence_ids, local) });
    });
    (an.opportunities || []).forEach(function (o) {
      var t = arTrim(arRemapEvText(o && o.text_ru, local), 400); if (!t || !(o.evidence_ids || []).length) return;
      recommendations.push({ source: 'сравнение', text: t, priority: arPriorityRu('medium'), evidence: arRemapEvIds(o.evidence_ids, local) });
    });
    (an.recommended_experiments || []).forEach(function (o) {
      var t = arTrim(arRemapEvText(o && o.text_ru, local), 400); if (!t) return;
      recommendations.push({ source: 'эксперимент', text: t, priority: arPriorityRu(o.priority), evidence: arRemapEvIds(o.evidence_ids || [], local) });
    });
    (an.recurring_pains_ru || []).forEach(function (p) {
      var t = arTrim(arRemapEvText(p, local), 300); if (!t) return;
      pains.push({ source: 'сравнение', kind: 'общая боль', text: t, evidence: '' });
    });
  });
  return { comparisons: comparisons, recommendations: recommendations, pains: pains, overview: overview };
}

module.exports = {
  AR_DIMENSION_RU, AR_PRIORITY_RU, AR_PAIN_DIMENSIONS,
  arDimensionRu, arPriorityRu, arBuildEvidenceIndex, arUsable,
  renderAnalysisSectionsRu, appendAnalysisToReportRu, analysisXlsxData, arDeterministicFacts
};
