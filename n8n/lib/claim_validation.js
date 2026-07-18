'use strict';
// claim_validation.js — REPORT-TRUTH-B: evidence-grounded claim validation + semantic quality guards.
//
// Runs BEFORE AI content reaches any user surface (Telegram markdown, XLSX bundle, later Radar/Analyst).
// The renderer already drops claims without citable evidence ids; this layer enforces the TRUTHFULNESS of the
// claims that survive:
//   * a single-source analysis describes the SOURCE, not the market — market-wide superlatives («максимальный
//     LTV на рынке», «лидер рынка», «отраслевой стандарт», «быстрорастущий сегмент», «высокая конкурентная
//     активность») are demoted to explicitly scoped hypotheses, never presented as facts;
//   * advertising-strength claims require advertising evidence;
//   * absence claims («не предлагает…», «отсутствует…») are scoped to the pages actually checked;
//   * demand-absence claims require audience signals;
//   * vehicle-use/seizure claims require explicit terms evidence;
//   * semantic artifacts observed live — foreign-script fragments in Russian prose, mixed-script malformed
//     words, an invented recent year (2025 in a 2026 report), duplicated items — are rejected or flagged.
//
// Design rules: transformations are conservative (prefix/append/demote/drop — never free rewriting), idempotent
// (already-scoped text is never re-prefixed), and fail-open on structure (a malformed analysis object passes
// through untouched rather than blocking delivery).
//
// Embeddable: unique cv*-prefixed top-level names, no cross-lib require.

function cvStr(v) { return v == null ? '' : String(v); }

// --- semantic guards -------------------------------------------------------------------------------------------

// Foreign scripts that can never legitimately appear in Russian analytical prose (CJK, kana, Hangul, Arabic,
// Hebrew, Thai). Explicit \u escapes — raw range literals are encoding-fragile.
var CV_FOREIGN_RE = new RegExp('[\\u3400-\\u9FFF\\u3040-\\u30FF\\uAC00-\\uD7AF\\u0590-\\u05FF\\u0600-\\u06FF\\u0E00-\\u0E7F]');
// A single letter-run mixing Cyrillic and Latin is a model artifact («text_ю», «WhatsАpp»). Hyphens/digits/dots
// split runs, so «IT-компания», «B2B», domains and URLs are unaffected.
var CV_MIXED_TOKEN_RE = /(?:[a-z]+[а-яё]+|[а-яё]+[a-z]+)[a-zа-яё]*/i;
// An underscore touching a Cyrillic letter is a leaked identifier/key artifact («текстом_ю», «text_ю»).
var CV_SNAKE_CYR_RE = /[а-яё]_|_[а-яё]/i;
// 3+ identical consecutive letters — truncation/generation artifact («оченььь»).
var CV_STUTTER_RE = /([а-яёa-z])\1\1/i;

// Per-item guard: returns fatal=true when the text is a generation artifact that must not be rendered.
function cvGuardTextRu(text) {
  var s = cvStr(text);
  var flags = [];
  if (CV_FOREIGN_RE.test(s)) flags.push('foreign_script');
  if (CV_MIXED_TOKEN_RE.test(s)) flags.push('mixed_script_word');
  if (CV_SNAKE_CYR_RE.test(s)) flags.push('leaked_identifier');
  if (CV_STUTTER_RE.test(s)) flags.push('malformed_word');
  return { text: s, flags: flags, fatal: flags.length > 0 };
}

// Final-markdown guard (applies to the WHOLE delivered report, whatever produced each line): strip foreign-script
// fragments, collapse byte-identical bullet lines (duplicate offers/facts rendered twice). Never rewrites wording.
function cvGuardMarkdownRu(md) {
  var flags = [];
  var s = cvStr(md);
  if (CV_FOREIGN_RE.test(s)) {
    flags.push('foreign_script_stripped');
    s = s.replace(new RegExp(CV_FOREIGN_RE.source, 'g'), '');
  }
  var seen = {};
  var out = [];
  s.split('\n').forEach(function (line) {
    var t = line.trim();
    if (/^[•\-\*]/.test(t)) {
      var key = t.toLowerCase().replace(/[^а-яёa-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
      if (key && seen[key]) { flags.push('duplicate_line_dropped'); return; }
      if (key) seen[key] = true;
    }
    out.push(line);
  });
  return { text: out.join('\n'), flags: flags };
}

// --- claim classification --------------------------------------------------------------------------------------

// Cyrillic-safe boundaries: JS \b/\w never fire on Cyrillic — use explicit (^|[^а-яё]) style anchors.
var CV_MARKET_ZONE = '(на рынке|в отрасли|среди конкурентов|в сегменте|по рынку)';
var CV_RE = {
  // superlative … market (or market … superlative) within one clause
  market_wide: new RegExp('((максимальн|минимальн|лучш|самы[йех]|крупнейш|единственн)[а-яё]*[^.!?]{0,60}' + CV_MARKET_ZONE +
    '|' + CV_MARKET_ZONE + '[^.!?]{0,60}(максимальн|минимальн|лучш|самы[йех]|крупнейш|единственн))', 'i'),
  leader: /((^|[^а-яё])лидер[а-яё]*\s+(рынка|отрасл|сегмент)|№\s*1\s+(на рынке|в отрасли))/i,
  benchmark: /(отраслев[а-яё]+\s+(стандарт|бенчмарк|норм)|(^|[^а-яё])бенчмарк|стандарт[а-яё]*\s+(рынка|отрасли)|рыночн[а-яё]+\s+стандарт)/i,
  trend: /(быстрорастущ|стремительно\s+раст|растущ(ий|ем|его)\s+(сегмент|рынок|спрос))/i,
  competition: /(высок[а-яё]+\s+конкурентн[а-яё]+\s+активн|высокая\s+конкуренция|активн[а-яё]+\s+конкурентн)/i,
  ad_strength: /(активн[а-яё]*\s+реклам|рекламн[а-яё]+\s+(активн|кампани|давлени|бюджет)|(сильн|агрессивн)[а-яё]+\s+реклам|много\s+рекламы)/i,
  absence: /((^|[^а-яё])отсутству|(^|[^а-яё])нет\s+(у|на|в)\s|не\s+(предлагает|предоставляет|указан|имеет|представлен|размещает))/i,
  demand_absence: /(спрос[а-яё]*[^.!?]{0,40}(отсутству|низк|минимал)|нет\s+спроса|отсутствие\s+спроса)/i,
  vehicle_terms: /((изъят|конфиск|лишени|лишит)[а-яё]*[^.!?]{0,40}(авто|машин|транспорт)|(авто|машин|транспорт)[а-яё]*[^.!?]{0,40}(изъят|изымает|конфиск|заберут)|не\s+сможете\s+пользоваться|без\s+права\s+пользования)/i
};
var CV_MARKET_CATS = ['market_wide', 'leader', 'benchmark', 'trend', 'competition'];

function cvClassifyClaimRu(text) {
  var s = cvStr(text);
  var cats = [];
  Object.keys(CV_RE).forEach(function (k) { if (CV_RE[k].test(s)) cats.push(k); });
  return cats;
}

// Text that already carries honest scoping is never re-scoped (idempotency).
function cvIsScopedRu(text) {
  return /(гипотез|в доступном снимке|в проверенн[а-яё]+\s+страниц|данных недостаточно|требует проверки|по данным (сайта|снимка|источника))/i.test(cvStr(text));
}

// --- context ---------------------------------------------------------------------------------------------------

// cvBuildCtx({analyses, source_count, now, evidence, audience_signals}) -> validation context.
function cvBuildCtx(opts) {
  opts = opts || {};
  var analyses = Array.isArray(opts.analyses) ? opts.analyses : [];
  var now = opts.now ? new Date(opts.now) : new Date();
  var curYear = now.getUTCFullYear();
  var allowed = {}; allowed[curYear] = true;
  var evTexts = [];
  var hasAd = false;
  function scanEvidence(list) {
    (Array.isArray(list) ? list : []).forEach(function (e) {
      var blob = cvStr(e && (e.excerpt || e.observation || '')) + ' ' + cvStr(e && (e.collected_at || '')) + ' ' + cvStr(e && e.url);
      evTexts.push(blob);
      (blob.match(/(^|\D)(20\d\d)(?=\D|$)/g) || []).forEach(function (m) { allowed[m.replace(/\D/g, '')] = true; });
      if (/(реклам|advert|(^|[^a-z])ads?([^a-z]|$))/i.test(cvStr(e && (e.type || e.fact_type || '')) + ' ' + blob)) hasAd = true;
    });
  }
  scanEvidence(opts.evidence);
  analyses.forEach(function (a) { scanEvidence(a && a.evidence_map); });
  var srcCount = Number(opts.source_count);
  if (!isFinite(srcCount) || srcCount <= 0) srcCount = analyses.length || 1;
  return {
    current_year: curYear,
    allowed_years: allowed,
    single_source: srcCount <= 1,
    source_count: srcCount,
    has_ad_evidence: hasAd,
    has_audience_signals: opts.audience_signals === true,
    evidence_texts: evTexts
  };
}

// Recent invented year: flag Y when Y >= currentYear-2, Y != currentYear and Y is not in the evidence.
// Old years («работает с 2008 года») pass — they are content, not a wrong "now".
function cvBadYears(text, ctx) {
  var bad = [];
  (cvStr(text).match(/(^|\D)(20\d\d)(?=\D|$)/g) || []).forEach(function (m) {
    var y = Number(m.replace(/\D/g, ''));
    if (y >= (ctx.current_year - 2) && y !== ctx.current_year && !ctx.allowed_years[y] && bad.indexOf(y) < 0) bad.push(y);
  });
  return bad;
}

// --- item validation -------------------------------------------------------------------------------------------

function cvNormKey(text) {
  return cvStr(text).toLowerCase().replace(/[^а-яёa-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
}

// Validate one analytical item. Returns {action:'keep'|'demote'|'reject', item, reasons:[]}.
function cvValidateItem(item, ctx) {
  var it = { dimension: cvStr(item && item.dimension), kind: cvStr(item && item.kind), text_ru: cvStr(item && item.text_ru), evidence_ids: (item && item.evidence_ids) || [] };
  var reasons = [];

  var g = cvGuardTextRu(it.text_ru);
  if (g.fatal) return { action: 'reject', item: it, reasons: g.flags };

  var cats = cvClassifyClaimRu(it.text_ru);
  var demote = false;
  var isMarket = cats.some(function (c) { return CV_MARKET_CATS.indexOf(c) >= 0; });

  if (isMarket && !cvIsScopedRu(it.text_ru)) {
    // A market-wide claim from bounded snapshots is always a hypothesis, whatever the model called it.
    demote = true;
    it.text_ru = (ctx.single_source ? 'Гипотеза (по одному источнику): ' : 'Гипотеза: ') + it.text_ru;
    reasons.push('market_claim_scoped');
  }
  if (cats.indexOf('ad_strength') >= 0 && !ctx.has_ad_evidence && !cvIsScopedRu(it.text_ru)) {
    demote = true;
    it.text_ru = it.text_ru.replace(/[.\s]+$/, '') + ' — рекламная активность не подтверждена собранными данными, требует проверки.';
    reasons.push('ad_claim_unverified');
  }
  if (cats.indexOf('demand_absence') >= 0 && !ctx.has_audience_signals && !cvIsScopedRu(it.text_ru)) {
    // No audience signals were collected — absence of demand is unknowable from this run.
    demote = true;
    it.text_ru = 'Данных недостаточно (аудиторные сигналы не собирались): ' + it.text_ru;
    reasons.push('demand_absence_unsupported');
  } else if (cats.indexOf('absence') >= 0 && cats.indexOf('demand_absence') < 0 && !cvIsScopedRu(it.text_ru)) {
    // Absence of a feature is only known for the pages actually inspected.
    it.text_ru = 'В проверенных страницах: ' + it.text_ru;
    reasons.push('absence_scoped');
  }
  if (cats.indexOf('vehicle_terms') >= 0) {
    var backed = (ctx.evidence_texts || []).some(function (t) { return /(пользован|эксплуатац|изъят|остаётся|остается|хранени)/i.test(t); });
    if (!backed && !cvIsScopedRu(it.text_ru)) {
      demote = true;
      it.text_ru = it.text_ru.replace(/[.\s]+$/, '') + ' (условия требуют проверки).';
      reasons.push('vehicle_terms_unverified');
    }
  }
  var badYears = cvBadYears(it.text_ru, ctx);
  if (badYears.length) {
    demote = true;
    it.text_ru = it.text_ru.replace(/[.\s]+$/, '') + ' (год ' + badYears.join(', ') + ' не подтверждён данными — требует проверки).';
    reasons.push('year_unsupported');
  }

  if (demote && it.kind === 'fact') { it.kind = 'inference'; reasons.push('demoted_fact'); }
  return { action: reasons.length ? 'demote' : 'keep', item: it, reasons: reasons };
}

// cvValidateAnalyses(analyses, ctx) -> { analyses: validated copies, audit }.
// Structure is fail-open: a non-object analysis or missing items array passes through untouched.
function cvValidateAnalyses(analyses, ctx) {
  ctx = ctx || cvBuildCtx({ analyses: analyses });
  var audit = { checked: 0, kept: 0, demoted: 0, rejected: 0, deduped: 0, flags: [] };
  var seen = {};
  function note(analysisId, kind, action, reasons) {
    if (audit.flags.length < 20) audit.flags.push({ analysis_id: cvStr(analysisId), kind: cvStr(kind), action: action, reasons: reasons });
  }
  var out = (Array.isArray(analyses) ? analyses : []).map(function (a) {
    if (!a || typeof a !== 'object' || !a.analysis || typeof a.analysis !== 'object') return a;
    var copy = Object.assign({}, a, { analysis: Object.assign({}, a.analysis) });
    if (Array.isArray(copy.analysis.items)) {
      var items = [];
      copy.analysis.items.forEach(function (raw) {
        audit.checked++;
        var v = cvValidateItem(raw, ctx);
        if (v.action === 'reject') { audit.rejected++; note(a.analysis_id, v.item.kind, 'reject', v.reasons); return; }
        var key = v.item.kind + '|' + cvNormKey(v.item.text_ru);
        if (seen[key]) { audit.deduped++; return; }
        seen[key] = true;
        if (v.action === 'demote') { audit.demoted++; note(a.analysis_id, v.item.kind, 'demote', v.reasons); }
        else audit.kept++;
        items.push(Object.assign({}, raw, v.item));
      });
      copy.analysis.items = items;
    }
    if (Array.isArray(copy.analysis.recommended_actions)) {
      var recs = [];
      copy.analysis.recommended_actions.forEach(function (raw) {
        audit.checked++;
        var g = cvGuardTextRu(cvStr(raw && raw.text_ru));
        if (g.fatal) { audit.rejected++; note(a.analysis_id, 'recommendation', 'reject', g.flags); return; }
        var key = 'rec|' + cvNormKey(raw && raw.text_ru);
        if (seen[key]) { audit.deduped++; return; }
        seen[key] = true;
        audit.kept++;
        recs.push(raw);
      });
      copy.analysis.recommended_actions = recs;
    }
    if (Array.isArray(copy.analysis.unknowns_ru)) {
      copy.analysis.unknowns_ru = copy.analysis.unknowns_ru.filter(function (u) { return !cvGuardTextRu(cvStr(u)).fatal; });
    }
    return copy;
  });
  return { analyses: out, audit: audit };
}

module.exports = {
  CV_MARKET_CATS,
  cvGuardTextRu, cvGuardMarkdownRu, cvClassifyClaimRu, cvIsScopedRu,
  cvBuildCtx, cvBadYears, cvValidateItem, cvValidateAnalyses
};
