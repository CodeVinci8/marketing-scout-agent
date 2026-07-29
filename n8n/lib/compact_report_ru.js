'use strict';
const { dedupeHeadingRu } = require('./report_text_safety.js');
// compact_report_ru.js — REPORT-TRUTH-C: the deliberate compact Telegram answer.
//
// The old default pushed the full ~10–13k-char report markdown into 3–4 Telegram messages. This renderer builds
// ONE short message from STRUCTURED data (bundle + validated analyses + summary) — it never truncates markdown.
// Full detail lives in the XLSX and the stored report bundle.
//
// Length contract (§6):
//   success source_analysis .. 700–1200 target, HARD MAX 1500
//   reused snapshot .......... 300–700
//   blocked / failure / none . 250–600
//   comparison / synthesis ... ≤ 1500
// The hard cap is enforced by dropping whole trailing bullet lines — never mid-word, never mid-line.
//
// Structure (success): source+assessment → ≤3 facts → ≤3 conclusions (marked interpretation) → ≤3
// recommendations → evidence/limitations line → reuse note → cost line → ONE next action.
// «Анализ завершён» is NOT this message — the progress line says it, only after report+XLSX delivery.
//
// Embeddable: unique cr*-prefixed names, no cross-lib require. Cost line / next action / validated analyses are
// passed IN by the caller (conversation_response.costLine, proactiveActions, claim_validation output).

function crStr(v) { return v == null ? '' : String(v).trim(); }
function crNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function crTrim(v, n) { var s = crStr(v).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

var CR_HARD_MAX = 1500;
var CR_RU_SRC = { website: 'сайты', telegram: 'Telegram-каналы', vk: 'VK-сообщества', avito: 'Avito' };

function crUsable(a) {
  return !!(a && a.enriched === true && a.fallback_used !== true && a.analysis && typeof a.analysis === 'object'
    && crStr(a.quality_status) !== 'deterministic_fallback');
}

// Collect ≤max items of a kind across validated analyses.
function crKind(analyses, kind, max) {
  var out = [];
  (analyses || []).forEach(function (a) {
    if (!crUsable(a) || out.length >= max) return;
    ((a.analysis.items) || []).forEach(function (it) {
      if (out.length >= max) return;
      if (crStr(it && it.kind) !== kind) return;
      var t = crTrim(it.text_ru, 140);
      if (t && (it.evidence_ids || []).length) out.push(t);
    });
  });
  return out;
}
// F-7 comparison rendering: a comparison/synthesis analysis has NO `items` — its content lives in
// overview_ru / comparisons / recurring_pains_ru / opportunities / recommended_experiments. Pull those out so a
// paid comparison actually reaches the user instead of falling back to deterministic per-source offer facts.
// Internal ev_N citation ids must NEVER reach the user. The compact Telegram message carries no [n] legend (the
// resolvable [n] -> URL evidence lives in the attached XLSX «Доказательства» sheet), so — unlike the workbook,
// which remaps ev_N to a resolvable [n] — here we strip the ids and tidy the punctuation an empty gap leaves.
// This also matches single-source rendering, which shows bare text with no visible markers (crKind).
function crStripEv(s) {
  return crStr(s).replace(/\[?\bev_\d+\b\]?/g, '')
    .replace(/\[\s*,\s*/g, '[').replace(/,\s*\]/g, ']').replace(/\[\s*\]/g, '')
    .replace(/\s+([;,.)])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
// REPORT-TRUTH-E (defects 8/9/10): the SAME claim guards the workbook applies (arQualityContradictionGuard /
// arBroadcastGuard / arHypothesisGuard), mirrored here byte-for-byte in behaviour so the Telegram answer never
// over-claims where the XLSX does not, and never contradicts the deterministic per-source quality. Self-contained
// (embed contract — no cross-lib require).
var CR_GAP_RE = /незанят|не\s*закрыт|незакрыт|пробел|никто\s+(?:из|не)|отсутствует\s+на\s+рынке|свободн[а-яё]*\s+ниш|неудовлетвор[а-яё]+\s+спрос|незакрыт[а-яё]+\s+спрос/i;
function crEvSource(e) { var s = crStr(e && e.source_id); if (s && s.toLowerCase() !== 'multi') return s; var m = crStr(e && (e.url || e.source_url)).match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1].replace(/^www\./i, '') : ''; }
// distinct real source identities a set of ev ids spans (via the analysis evidence_map). Order preserved, deduped —
// the basis for both the broadcast coverage check and the «подтверждено: …» attribution.
function crCitedSources(ids, a) {
  var em = (a && a.evidence_map) || [], by = {};
  em.forEach(function (e) { by[crStr(e.id)] = crEvSource(e); });
  var seen = {}, out = [];
  (ids || []).forEach(function (id) { var s = by[crStr(id)]; if (s && !seen[s]) { seen[s] = true; out.push(s); } });
  return out;
}
function crCitedCount(ids, a) { return crCitedSources(ids, a).length; }
function crHypothesisGuard(t, n) { t = crStr(t); if (!t) return t; if (n && n > 3) return t; if (/гипотез|предполож|вероятн|возможно/i.test(t)) return t; return CR_GAP_RE.test(t) ? (t.replace(/[\s.]*$/, '') + ' (гипотеза на основе выборки из ' + (n || 'нескольких') + ' источников)') : t; }
// STRUCTURED fail-closed broadcast guard (mirrors arBroadcastGuard): DETECT a universal quantifier; if the cited
// evidence does not cover every contributing source, keep the clause intact (no fragile Cyrillic regex surgery) and
// APPEND a neutral, grammatical disclaimer — listing the supporting sources when known. Never invents attribution.
// NOUN-ANCHORED universal detector — identical contract to analysis_report_ru.AR_UNIVERSAL_RE (fires on «все три
// источника»/«все игроки»/«у всех конкурентов»/«каждый конкурент»/«оба источника»/«обе компании»; never on temporal
// «каждый месяц» or a bare verb «все предлагают»).
var CR_SRC_NOUN = 'источник|игрок|конкурент|компани|сайт|канал|сообществ|бренд|площадк|фирм|организац|сервис';
var CR_UNIVERSAL_RE = new RegExp('(^|[\\s(«"])(?:все\\s+(?:три|3|четыре|4|пять|5|(?:' + CR_SRC_NOUN + ')[а-яё]*)'
  + '|(?:у|для|во)\\s+всех|кажд(?:ый|ая|ое|ые)\\s+(?:из\\s+(?:трёх|трех|четырёх|четырех|пяти|них)|(?:' + CR_SRC_NOUN + ')[а-яё]*)'
  + '|об[ае]\\s+(?:' + CR_SRC_NOUN + ')[а-яё]*)', 'i');
var CR_NOT_ALL_RU = 'Подтверждено не для всех участвовавших источников';
function crBroadcastGuard(t, cited, total, supportedIds) {
  t = crStr(t);
  if (!t || !total || total < 2) return t;                     // "all" is meaningless below 2 sources
  if (cited && cited >= total) return t;                       // evidence covers every source → keep as-is
  if (!CR_UNIVERSAL_RE.test(t)) return t;                      // no universal quantifier → nothing to qualify
  if (t.indexOf(CR_NOT_ALL_RU) >= 0) return t;                 // already qualified (idempotent)
  var ids = (Array.isArray(supportedIds) ? supportedIds : []).filter(Boolean);
  var note = CR_NOT_ALL_RU + (ids.length ? (' (подтверждено: ' + ids.join(', ') + ')') : '');
  return t.replace(/[\s.]*$/, '') + '. ' + note + '.';
}
// Source-aware quality-contradiction guard (mirrors arQualityContradictionGuard): drop an AI limitation claiming
// quarantine/blocked/uncollected ONLY when provably false against the DETERMINISTIC per-source state — it NAMES a
// healthy/accepted source, or it is an AGGREGATE claim while EVERY contributing source is healthy/accepted. Keep a
// limitation that names a genuinely quarantined source, or an aggregate claim while ANY source is not-healthy /
// unknown. Fail-closed: never delete a legitimate quarantine warning because a DIFFERENT source is healthy.
var CR_QUALITY_NEG_RE = /каранти|quarantin|заблокир|недоступ|не\s+удалось\s+собра|данные\s+не\s+(?:были\s+)?собра|источник[а-яё]*\s+отклон|отклон[а-яё]+\s+источник/i;
var CR_HEALTHY_STATES = ['healthy', 'ok', 'accepted', 'eligible', 'good'];
function crIsHealthyState(s) { return CR_HEALTHY_STATES.indexOf(crStr(s).toLowerCase()) >= 0; }
function crNamedIn(text, id) {
  var i = crStr(id).toLowerCase(); if (!i || (i.length < 4 && i.indexOf('.') < 0)) return false;
  return crStr(text).toLowerCase().indexOf(i) >= 0;
}
// DEDUP + PRECEDENCE (mirrors arResolveSourceStates): collapse multiple/conflicting observations of the same source
// id to ONE record, fail-closed — a source is HEALTHY only when EVERY observation is a recognized healthy state; any
// non-healthy/unknown observation makes it not-healthy. A conflict never silently resolves to healthy.
function crResolveSourceStates(sourceStates) {
  var byId = {}, order = [];
  (Array.isArray(sourceStates) ? sourceStates : []).forEach(function (s) {
    var id = crStr(s && (s.id != null ? s.id : s.source));
    var status = crStr(s && (s.status != null ? s.status : s));
    if (!status) return;
    if (!(id in byId)) { byId[id] = { id: id, statuses: [status] }; order.push(id); }
    else byId[id].statuses.push(status);
  });
  return order.map(function (id) {
    var st = byId[id].statuses;
    var healthy = st.every(function (s) { return crIsHealthyState(s); });
    var shown = healthy ? st[0] : (st.filter(function (s) { return !crIsHealthyState(s); })[0] || st[0]);
    return { id: id, status: shown, healthy: healthy };
  });
}
function crQualityContradictionGuard(limitations, sourceStates) {
  var states = crResolveSourceStates(sourceStates);
  if (!states.length) return (limitations || []).slice();     // no deterministic state → cannot disprove anything
  var allHealthy = states.every(function (s) { return s.healthy; });
  return (limitations || []).filter(function (l) {
    var t = crStr(l); if (!CR_QUALITY_NEG_RE.test(t)) return true;              // not a quality-negative claim → keep
    var named = states.filter(function (s) { return crNamedIn(t, s.id); });
    if (named.length) return !named.every(function (s) { return s.healthy; });  // drop iff every named source healthy
    return !allHealthy;                                                        // aggregate: drop iff ALL sources healthy
  });
}
function crComparison(analyses) {
  var out = { overview: '', comparisons: [], pains: [], opportunities: [], experiments: [] };
  (analyses || []).forEach(function (a) {
    if (!crUsable(a)) return;
    var an = a.analysis || {};
    if (!Array.isArray(an.comparisons)) return; // not a comparison result
    var total = Number((a.source || {}).source_count) || crCitedCount((a.evidence_map || []).map(function (e) { return crStr(e.id); }), a);
    if (!out.overview) out.overview = crHypothesisGuard(crTrim(crStripEv(an.overview_ru), 300), total);
    (an.comparisons || []).forEach(function (c) {
      var cited = crCitedSources(c.evidence_ids, a);
      var t = crTrim(crHypothesisGuard(crBroadcastGuard(crStripEv(c && c.text_ru), cited.length, total, cited), total), 160);
      if (t && (c.evidence_ids || []).length) out.comparisons.push(t);
    });
    (an.recurring_pains_ru || []).forEach(function (t) { var s = crTrim(crHypothesisGuard(crStripEv(t), total), 120); if (s) out.pains.push(s); });
    (an.opportunities || []).forEach(function (o) {
      var cited = crCitedSources(o.evidence_ids, a);
      var t = crTrim(crHypothesisGuard(crBroadcastGuard(crStripEv(o && o.text_ru), cited.length, total, cited), total), 140);
      if (t && (o.evidence_ids || []).length) out.opportunities.push(t);
    });
    (an.recommended_experiments || []).forEach(function (o) { var t = crTrim(crStripEv(o && o.text_ru), 140); if (t) out.experiments.push(t); });
  });
  return out;
}
function crHasComparison(analyses) {
  return (analyses || []).some(function (a) { return crUsable(a) && a.analysis && Array.isArray(a.analysis.comparisons) && a.analysis.comparisons.length; });
}

function crRecs(analyses, max) {
  var out = [];
  (analyses || []).forEach(function (a) {
    if (!crUsable(a) || out.length >= max) return;
    ((a.analysis.recommended_actions) || []).forEach(function (r) {
      if (out.length >= max) return;
      var t = crTrim(r && r.text_ru, 140);
      if (t) out.push(t);
    });
  });
  crKind(analyses, 'recommendation', max).forEach(function (t) { if (out.length < max) out.push(t); });
  return out;
}

function crNormTxt(s) { return crStr(s).toLowerCase().replace(/[^а-яёa-z0-9%]+/gi, ' ').replace(/\s+/g, ' ').trim(); }

// Deterministic offer facts from the bundle — authoritative, listed before AI facts.
// Bundle offer text is machine-built (live exec 1018: «Предложение конкурента (LionCredit), услуга:
// generic_lending. Условия: …») — drop the boilerplate prefix and any internal ascii enum, and never repeat
// price_rate when the text already contains it.
function crOfferFacts(bundle, max) {
  var out = [];
  (Array.isArray(bundle && bundle.offers) ? bundle.offers : []).forEach(function (o) {
    if (out.length >= max) return;
    var text = crStr(o && o.offer)
      .replace(/^Предложение конкурента\s*\([^)]*\)[,.]?\s*/i, '')
      .replace(/услуга:\s*[a-z0-9_]+\.?\s*/gi, '')
      .replace(/^условия:\s*/i, '').trim();
    var bits = [];
    if (text) bits.push(text);
    var rate = crStr(o && o.price_rate);
    if (rate && crNormTxt(text).indexOf(crNormTxt(rate)) < 0) bits.push(rate);
    if (!bits.length) return;
    out.push(crTrim((crStr(o.competitor) ? crStr(o.competitor) + ': ' : '') + bits.join(' — '), 160));
  });
  return out;
}

function crHeader(bundle, analyses, summary) {
  var doms = [];
  (Array.isArray(bundle && bundle.competitors) ? bundle.competitors : []).forEach(function (c) {
    var d = crStr(c && (c.domain || c.name || c.competitor));
    if (d && doms.indexOf(d) < 0) doms.push(d);
  });
  var subject = doms.slice(0, 3).join(', ') || 'запрошенные источники';
  var assess = '';
  (analyses || []).some(function (a) {
    if (!crUsable(a)) return false;
    assess = crTrim((a.analysis || {}).executive_summary_ru, 180);
    return !!assess;
  });
  if (!assess) assess = 'собрано записей: ' + crNum(summary && summary.records_reported, 0);
  // The executive summary often opens with the subject name — don't print «LionCredit — LionCredit — …».
  // Canonical de-duplication (report_text_safety.dedupeHeadingRu) also tolerates a trailing parenthetical:
  // the live report rendered «📊 Залог 24 — Залог 24 (zalog24h.ru) — …» because the old inline regex required
  // the separator to follow the name immediately and «(zalog24h.ru)» sat in between.
  assess = dedupeHeadingRu(subject, assess);
  return '📊 ' + subject + ' — ' + assess;
}

function crReuseLine(summary) {
  var reused = Array.isArray(summary && summary.reused_sources) ? summary.reused_sources : [];
  if (!reused.length) return '';
  var when = reused.map(function (r) {
    var src = CR_RU_SRC[crStr(r.source).toLowerCase()] || crStr(r.source);
    var m = crStr(r.original_collected_at).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return src + (m ? (' (сбор от ' + m[3] + '.' + m[2] + '.' + m[1] + ' ' + m[4] + ':' + m[5] + ' МСК)') : '');
  }).join(', ');
  return '💾 Использованы сохранённые данные: ' + when + '. Новый сбор не выполнялся — стоимость сбора $0.';
}

// Evidence + limitations in ONE honest line.
function crEvidenceLine(bundle, analyses, xlsxExpected) {
  var ev = Array.isArray(bundle && bundle.evidence) ? bundle.evidence.length : 0;
  var unknowns = [];
  // REPORT-TRUTH-E (defect 8, source-aware): build {id,status} pairs from the DETERMINISTIC per-source quality
  // (bundle source_quality + cited evidence, keyed by source id/host) so the guard reasons per source, not in
  // aggregate — the Telegram line must never contradict the XLSX «Качество источника», but must also never suppress
  // a genuine quarantine warning just because a DIFFERENT source is healthy.
  var qSourceStates = [];
  ((bundle && bundle.source_quality) || []).forEach(function (q) {
    var host = ''; var m = crStr(q && q.url).match(/^https?:\/\/([^\/?#]+)/i); if (m) host = m[1].replace(/^www\./i, '');
    qSourceStates.push({ id: crStr(q && (q.source_id || q.source || q.host)) || host, status: crStr(q && q.status) });
  });
  (analyses || []).forEach(function (a) {
    if (!crUsable(a)) return;
    ((a.analysis.unknowns_ru) || []).forEach(function (u) { var t = crTrim(u, 120); if (t && unknowns.indexOf(t) < 0) unknowns.push(t); });
    ((a.analysis.limitations_ru) || []).forEach(function (u) { var t = crTrim(u, 120); if (t && unknowns.indexOf(t) < 0) unknowns.push(t); });
    (a.evidence_map || []).forEach(function (e) { if (crStr(e.quality_status)) qSourceStates.push({ id: crEvSource(e), status: crStr(e.quality_status) }); });
  });
  unknowns = crQualityContradictionGuard(unknowns, qSourceStates);
  var bits = [];
  if (ev) bits.push('Основано на ' + ev + ' подтверждённых фрагментах данных');
  if (unknowns.length) bits.push('требует проверки: ' + unknowns[0]);
  if (xlsxExpected) bits.push('полные данные — в Excel-файле ниже');
  return bits.length ? ('🔍 ' + bits.join('; ') + '.') : '';
}

var CR_MODE_LINE = {
  change_report: 'Тип отчёта: изменения с прошлой проверки.',
  comparison: 'Тип отчёта: сравнение источников.',
  synthesis: 'Тип отчёта: сводный анализ нескольких источников.'
};

// crCompactReportRu(p) -> { text, length, profile }
// p: { bundle, analyses (validated), summary, cost_line, next_action, xlsx_expected, state }
// AI-CONTRACT-001: short RU reason for an AI analysis that was expected but not delivered (embeddable copy of the
// same mapping the progress terminal uses — no cross-lib require in an embedded node).
var CR_AI_REASON = {
  server_error: 'сервис AI временно недоступен', overloaded_error: 'сервис AI перегружен',
  rate_limit_error: 'достигнут лимит запросов к AI', timeout: 'AI не ответил вовремя',
  invalid_response: 'AI вернул некорректный ответ', invalid_request_error: 'AI отклонил запрос',
  no_evidence: 'недостаточно данных для AI-анализа', disabled: 'AI-анализ отключён настройками',
  budget: 'исчерпан бюджет на AI-анализ'
};
function crAiReasonRu(cat) { return CR_AI_REASON[crStr(cat)] || 'AI-анализ не выполнен'; }

function crCompactReportRu(p) {
  p = p || {};
  var bundle = p.bundle || {};
  var analyses = Array.isArray(p.analyses) ? p.analyses : [];
  var summary = p.summary || {};
  var state = crStr(p.state || summary.final_state).toLowerCase() || 'completed';
  var records = crNum(summary.records_reported, 0);
  var mode = crStr(bundle.analysis_mode || summary.analysis_mode) || 'source_analysis';
  // SOCIAL-DELIVERY-001: a Telegram/VK source_analysis routinely reports ZERO deterministic records — a public
  // channel/community is citable EVIDENCE, not a competitor profile with offers/prices (DEC-133/135). When the
  // analyst nonetheless produced a usable, evidence-bound result, THAT is the deliverable. Without this guard the
  // no-data profile below fires on (records===0 && state!=='completed') and silently suppresses a real analysis —
  // live-observed: rusmicrofinance analysis an_3f6ccdb3 (18 grounded items) was delivered as "Подходящих данных
  // не собрано". A genuine no-data/failed run has no usable analysis and still gets the honest issue profile.
  var crHasAnalysis = analyses.some(crUsable);
  var L = [];

  // ---- issue profile: honest, short (250–600) --------------------------------------------------------------
  if (!crHasAnalysis && (state === 'failed' || state === 'no_data' || (records === 0 && state !== 'completed'))) {
    var RU_FAIL = { failed: 'Не удалось собрать данные по запрошенным источникам.', no_data: 'Подходящих данных не собрано.' };
    var failedNames = (Array.isArray(summary.failed_sources) ? summary.failed_sources : [])
      .map(function (k) { return CR_RU_SRC[crStr(k).toLowerCase()] || crStr(k); }).filter(Boolean);
    L.push('⚠️ ' + (RU_FAIL[state] || RU_FAIL.no_data));
    if (failedNames.length) L.push('Проблемные источники: ' + failedNames.join(', ') + '.');
    // STAGE-F §8 (live telegram exec 1087): only call it an access limitation when access was actually lost. A
    // source that COLLECTED data but yielded no competitor profiles is NOT an access problem — saying so is a lie.
    var crOut = Array.isArray(summary.source_outcomes) ? summary.source_outcomes : [];
    var crAnyData = crOut.some(function (o) { return o && o.has_data; });
    var crAllAccessFail = crOut.length > 0 && crOut.every(function (o) {
      return o && ['blocked', 'access_denied', 'timeout', 'provider_failed', 'empty_response', 'unsupported_content'].indexOf(crStr(o.outcome)) >= 0;
    });
    if (crAnyData) L.push('Источники доступны, но конкурентных профилей с офферами и ценами в собранных данных не найдено.');
    else if (crAllAccessFail || !crOut.length) L.push('Это ограничение доступа к данным, а не вывод о рынке или спросе.');
    else L.push('Это ограничение сбора данных, а не вывод о рынке или спросе.');
    if (crStr(p.cost_line)) L.push(crStr(p.cost_line));
    if (crStr(p.next_action)) L.push(crStr(p.next_action));
    return crFinish(L, 'issue', 600);
  }

  // ---- content profiles ------------------------------------------------------------------------------------
  var reusedAll = analyses.length > 0 && analyses.every(function (a) { return crStr(a.mode) === 'reuse' || !crUsable(a); })
    && analyses.some(function (a) { return crStr(a.mode) === 'reuse'; });
  var facts = crOfferFacts(bundle, 3);
  crKind(analyses, 'fact', 3).forEach(function (t) { if (facts.length < 3) facts.push(t); });
  var infs = crKind(analyses, 'inference', 3);
  var recs = crRecs(analyses, 3);

  L.push(crHeader(bundle, analyses, summary));
  if (CR_MODE_LINE[mode]) L.push(CR_MODE_LINE[mode]);
  // AI-CONTRACT-001: the plan promised AI analysis but none was delivered (Claude failed -> deterministic
  // fallback, or no compatible reuse). Deliver the facts, but say so honestly — never present a fact-only report
  // as if the promised AI interpretation is present. The XLSX «Аналитические выводы» carries the same note.
  if (summary.ai_expected === true && !crHasAnalysis) {
    L.push('⚠️ AI-анализ не выполнен: ' + crAiReasonRu(summary.ai_error_category) + '. Ниже — собранные факты без AI-интерпретации.');
  }
  if (mode === 'change_report') {
    var changes = Array.isArray(bundle.changes) ? bundle.changes : [];
    if (!changes.length) L.push('Существенных изменений относительно прошлой проверки не обнаружено — это честный результат сравнения, а не сбой.');
  }
  if (state === 'partial') L.push('Отчёт частичный — часть источников не отработала.');

  // F-7: a comparison/synthesis result renders its cross-source structure, not per-source item facts.
  var cmp = (mode === 'comparison' || mode === 'synthesis') ? crComparison(analyses) : null;
  if (cmp && crHasComparison(analyses)) {
    if (cmp.overview) { L.push(''); L.push(cmp.overview); }
    if (cmp.comparisons.length) {
      L.push('');
      L.push('⚖️ Сравнение источников');
      cmp.comparisons.slice(0, 4).forEach(function (t) { L.push('• ' + t); });
    }
    if (cmp.pains.length) {
      L.push('');
      L.push('🎯 Общие боли аудитории');
      cmp.pains.slice(0, 3).forEach(function (t) { L.push('• ' + t); });
    }
    if (cmp.opportunities.length) {
      L.push('');
      L.push('💡 Возможности — предложения к проверке');
      cmp.opportunities.slice(0, 3).forEach(function (t) { L.push('• ' + t); });
    }
  } else {
    var maxFacts = reusedAll ? 2 : 3;
    if (facts.length) {
      L.push('');
      L.push('📌 Ключевые факты');
      facts.slice(0, maxFacts).forEach(function (t) { L.push('• ' + t); });
    }
    if (!reusedAll && infs.length) {
      L.push('');
      L.push('🧠 Выводы — интерпретация, не факты');
      infs.forEach(function (t) { L.push('• ' + t); });
    }
    if (recs.length) {
      L.push('');
      L.push('💡 Рекомендации — предложения к проверке');
      recs.slice(0, reusedAll ? 2 : 3).forEach(function (t) { L.push('• ' + t); });
    }
  }
  // Reuse messages stay tight (300–700): the evidence detail lives in the XLSX; the reuse line already names
  // the snapshot origin.
  var evLine = reusedAll ? '' : crEvidenceLine(bundle, analyses, p.xlsx_expected === true);
  var tail = [];
  if (evLine) tail.push(evLine);
  var reuseLine = crReuseLine(summary);
  if (reuseLine) tail.push(reuseLine);
  if (crStr(p.cost_line)) tail.push(crStr(p.cost_line));
  if (crStr(p.next_action)) tail.push(crStr(p.next_action));
  if (tail.length) { L.push(''); tail.forEach(function (t) { L.push(t); }); }
  return crFinish(L, reusedAll ? 'reuse' : ((mode === 'comparison' || mode === 'synthesis') ? 'multi' : 'success'),
    reusedAll ? 700 : CR_HARD_MAX);
}

// Join, collapse blank runs, enforce the profile cap by dropping trailing BULLET lines first, then trailing lines.
function crFinish(lines, profile, maxLen) {
  var cap = Math.min(Number(maxLen) || CR_HARD_MAX, CR_HARD_MAX);
  var text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  var guard = 0;
  while (text.length > cap && guard < 60) {
    guard++;
    var arr = text.split('\n');
    var cut = -1;
    for (var i = arr.length - 1; i >= 0; i--) { if (/^•/.test(arr[i].trim())) { cut = i; break; } }
    if (cut < 0) { text = text.slice(0, cap - 1) + '…'; break; }
    arr.splice(cut, 1);
    text = arr.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  // Cap-trimming may leave a section header (📌/🧠/💡 + optional explainer line) with no bullets — drop it.
  var out = [];
  var arr2 = text.split('\n');
  for (var j = 0; j < arr2.length; j++) {
    var ln = arr2[j];
    if (/^[📌🧠💡]/u.test(ln.trim())) {
      var k = j + 1;
      while (k < arr2.length && arr2[k].trim() && !/^•/.test(arr2[k].trim()) && !/^[📌🧠💡🔍💾💰]/u.test(arr2[k].trim())) k++;
      if (!(k < arr2.length && /^•/.test(arr2[k].trim()))) { j = k - 1; continue; }
    }
    out.push(ln);
  }
  text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: text, length: text.length, profile: profile };
}

module.exports = {
  CR_HARD_MAX, crCompactReportRu, crOfferFacts, crKind, crRecs, crHeader, crReuseLine, crEvidenceLine, crFinish,
  crBroadcastGuard, crHypothesisGuard, crCitedSources, crCitedCount, crQualityContradictionGuard,
  crResolveSourceStates, crIsHealthyState, crNamedIn, CR_NOT_ALL_RU
};
