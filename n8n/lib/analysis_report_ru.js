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
      if (!byUrl[url]) { list.push({ n: list.length + 1, url: url, type: arStr(e.type), source_id: arStr((a.source || {}).source_id) }); byUrl[url] = list.length; }
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
  var mk = function (m) { return arStr(m).replace(/[\[\]]/g, ' ').trim(); };
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
  var evidence = (r.evidence_list || []).map(function (e) {
    return { ref: '[' + e.n + ']', source: e.source_id, url: e.url, type: e.type };
  });
  // REPORT-TRUTH-D: honest limitations belong on the user-facing Summary sheet.
  var unknowns = ((r.sections || {}).unknowns || []).slice(0, 5);
  return { inferences: inferences, recommendations: recommendations, pains: pains, evidence: evidence, unknowns: unknowns };
}

module.exports = {
  AR_DIMENSION_RU, AR_PRIORITY_RU, AR_PAIN_DIMENSIONS,
  arDimensionRu, arPriorityRu, arBuildEvidenceIndex, arUsable,
  renderAnalysisSectionsRu, appendAnalysisToReportRu, analysisXlsxData, arDeterministicFacts
};
