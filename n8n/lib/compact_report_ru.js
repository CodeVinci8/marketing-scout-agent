'use strict';
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
      var t = crTrim(it.text_ru, 160);
      if (t && (it.evidence_ids || []).length) out.push(t);
    });
  });
  return out;
}
function crRecs(analyses, max) {
  var out = [];
  (analyses || []).forEach(function (a) {
    if (!crUsable(a) || out.length >= max) return;
    ((a.analysis.recommended_actions) || []).forEach(function (r) {
      if (out.length >= max) return;
      var t = crTrim(r && r.text_ru, 160);
      if (t) out.push(t);
    });
  });
  crKind(analyses, 'recommendation', max).forEach(function (t) { if (out.length < max) out.push(t); });
  return out;
}

// Deterministic offer facts from the bundle — authoritative, listed before AI facts.
function crOfferFacts(bundle, max) {
  var out = [];
  (Array.isArray(bundle && bundle.offers) ? bundle.offers : []).forEach(function (o) {
    if (out.length >= max) return;
    var bits = [];
    if (crStr(o && o.offer)) bits.push(crStr(o.offer));
    if (crStr(o && o.price_rate)) bits.push(crStr(o.price_rate));
    if (!bits.length) return;
    out.push(crTrim((crStr(o.competitor) ? crStr(o.competitor) + ': ' : '') + bits.join(' — '), 160));
  });
  return out;
}

function crHeader(bundle, analyses, summary) {
  var doms = [];
  (Array.isArray(bundle && bundle.competitors) ? bundle.competitors : []).forEach(function (c) {
    var d = crStr(c && (c.domain || c.name));
    if (d && doms.indexOf(d) < 0) doms.push(d);
  });
  var subject = doms.slice(0, 3).join(', ') || 'запрошенные источники';
  var assess = '';
  (analyses || []).some(function (a) {
    if (!crUsable(a)) return false;
    assess = crTrim((a.analysis || {}).executive_summary_ru, 220);
    return !!assess;
  });
  if (!assess) assess = 'собрано записей: ' + crNum(summary && summary.records_reported, 0);
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
  (analyses || []).forEach(function (a) {
    if (!crUsable(a)) return;
    ((a.analysis.unknowns_ru) || []).forEach(function (u) { var t = crTrim(u, 120); if (t && unknowns.indexOf(t) < 0) unknowns.push(t); });
  });
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
function crCompactReportRu(p) {
  p = p || {};
  var bundle = p.bundle || {};
  var analyses = Array.isArray(p.analyses) ? p.analyses : [];
  var summary = p.summary || {};
  var state = crStr(p.state || summary.final_state).toLowerCase() || 'completed';
  var records = crNum(summary.records_reported, 0);
  var mode = crStr(bundle.analysis_mode || summary.analysis_mode) || 'source_analysis';
  var L = [];

  // ---- issue profile: honest, short (250–600) --------------------------------------------------------------
  if (state === 'failed' || state === 'no_data' || (records === 0 && state !== 'completed')) {
    var RU_FAIL = { failed: 'Не удалось собрать данные по запрошенным источникам.', no_data: 'Подходящих данных не собрано.' };
    var failedNames = (Array.isArray(summary.failed_sources) ? summary.failed_sources : [])
      .map(function (k) { return CR_RU_SRC[crStr(k).toLowerCase()] || crStr(k); }).filter(Boolean);
    L.push('⚠️ ' + (RU_FAIL[state] || RU_FAIL.no_data));
    if (failedNames.length) L.push('Проблемные источники: ' + failedNames.join(', ') + '.');
    L.push('Это ограничение доступа к данным, а не вывод о рынке или спросе.');
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
  if (mode === 'change_report') {
    var changes = Array.isArray(bundle.changes) ? bundle.changes : [];
    if (!changes.length) L.push('Существенных изменений относительно прошлой проверки не обнаружено — это честный результат сравнения, а не сбой.');
  }
  if (state === 'partial') L.push('Отчёт частичный — часть источников не отработала.');

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
  return { text: text, length: text.length, profile: profile };
}

module.exports = { CR_HARD_MAX, crCompactReportRu, crOfferFacts, crKind, crRecs, crHeader, crReuseLine, crEvidenceLine, crFinish };
