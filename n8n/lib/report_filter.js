'use strict';
// report_filter.js — natural-language filtering + sorting over STORED report data (Section 8).
//
// No arbitrary code/expression evaluation: a deterministic Russian-phrase parser produces a STRICT, validated
// filter schema, which a pure applier runs against the report bundle. Invalid input asks exactly one
// clarification. Filtering never recollects data ($0). Active filters are mergeable so follow-ups like
// "а теперь только Москва" refine the previous selection. Pure + deterministic, offline.

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function rateNum(v) { const m = str(v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; }

const ALLOWED_FILTERS = ['competitor', 'region', 'service', 'platform', 'source_quality', 'confidence',
  'min_value', 'max_value', 'min_score', 'max_score', 'has_offer', 'cta', 'usp', 'has_promotion', 'has_change',
  'freshness', 'date_from', 'date_to', 'require_evidence', 'report_eligible'];
const SORT_KEYS = ['score', 'price_rate', 'confidence', 'quality', 'freshness', 'findings', 'changes'];
const PLATFORMS = { website: 'website', сайт: 'website', сайты: 'website', avito: 'avito', авито: 'avito', telegram: 'telegram_channel', телеграм: 'telegram_channel', vk: 'vk_community', вк: 'vk_community' };
const QUALITY = { healthy: 'healthy', здоров: 'healthy', degraded: 'degraded', деград: 'degraded', quarantined: 'quarantined', карантин: 'quarantined' };
const CONF = { high: 'high', высок: 'high', medium: 'medium', средн: 'medium', low: 'low', низк: 'low' };

// ---- parser ------------------------------------------------------------------------------------------
// parseFilter(text, knownCompetitors) -> { ok, filters, sort, clarification }
function parseFilter(text, knownCompetitors) {
  const t = low(text);
  const filters = {}; let sort = null; let sawComparatorNoNumber = false;

  // region: "из Москвы", "в Москве", "Москва"
  const cities = ['москв', 'московск', 'спб', 'санкт-петербург', 'питер', 'екатеринбург', 'новосибирск', 'казан'];
  for (const c of cities) if (t.indexOf(c) >= 0) { filters.region = c; break; }

  // platform
  for (const k of Object.keys(PLATFORMS)) if (new RegExp('\\b' + k).test(t)) { filters.platform = PLATFORMS[k]; break; }
  // source quality ("только healthy источники", "здоровые источники")
  if (/источник/.test(t) || /healthy|degraded|quarantin|здоров|деград|карантин/.test(t)) {
    for (const k of Object.keys(QUALITY)) if (t.indexOf(k) >= 0) { filters.source_quality = QUALITY[k]; break; }
  }
  // confidence
  if (/увер|confidence|достоверн/.test(t)) for (const k of Object.keys(CONF)) if (t.indexOf(k) >= 0) { filters.confidence = CONF[k]; break; }

  // numeric rate filters: "ниже 5%", "меньше 5", "выше 4", "от 4 до 6"
  let m;
  if ((m = t.match(/(?:ниже|меньше|до)\s*(\d+[.,]?\d*)\s*%?/))) filters.max_value = Number(str(m[1]).replace(',', '.'));
  if ((m = t.match(/(?:выше|больше|от)\s*(\d+[.,]?\d*)\s*%?/))) filters.min_value = Number(str(m[1]).replace(',', '.'));
  if (/(ниже|меньше|выше|больше)/.test(t) && filters.min_value == null && filters.max_value == null) sawComparatorNoNumber = true;

  // score filter: "оценка выше 8", "сильные конкуренты"
  if ((m = t.match(/оценк[аи]?\s*(?:выше|больше|от)\s*(\d+[.,]?\d*)/))) filters.min_score = Number(str(m[1]).replace(',', '.'));

  // presence flags
  if (/акци|промо|скидк|спецпредложен/.test(t)) filters.has_promotion = true;
  // "убери записи без доказательств" / "с доказательствами" => keep only evidence-backed records
  if (/без доказательств|нет доказательств|без подтвержд|с доказательствами|только подтвержд/.test(t)) filters.require_evidence = true;
  if (/изменивш|только новые|что нового|новые офферы/.test(t)) filters.has_change = true;
  if (/свеж|не старше|fresh/.test(t)) filters.freshness = 'fresh';
  if (/устаревш|старше|stale/.test(t)) filters.freshness = 'stale';

  // competitor by name (match against known competitors)
  (knownCompetitors || []).forEach(c => { const n = low(c); if (n && t.indexOf(n) >= 0) filters.competitor = n; });

  // sorting
  if (/отсортир|сортир|по убыван|по возрастан|sort/.test(t)) {
    if (/качеств|надёжн|надежн|источник/.test(t)) sort = { by: 'quality', dir: 'desc' };
    else if (/сил[ае] предложен|оценк|score|рейтинг/.test(t)) sort = { by: 'score', dir: 'desc' };
    else if (/ставк|цен|price|rate/.test(t)) sort = { by: 'price_rate', dir: 'asc' };
    else if (/свеж|fresh|дат/.test(t)) sort = { by: 'freshness', dir: 'desc' };
    else if (/доказательств|findings|находок/.test(t)) sort = { by: 'findings', dir: 'desc' };
    else if (/изменен|changes/.test(t)) sort = { by: 'changes', dir: 'desc' };
    else sort = { by: 'score', dir: 'desc' };
  }

  const hasAny = Object.keys(filters).length > 0 || sort;
  if (!hasAny) {
    if (sawComparatorNoNumber) return { ok: false, filters: {}, sort: null, clarification: 'Уточните число для фильтра (например «ставка ниже 5%»).' };
    return { ok: false, filters: {}, sort: null, clarification: 'Не понял условие фильтра. Например: «только конкуренты из Москвы» или «ставки ниже 5%».' };
  }
  if (sawComparatorNoNumber && filters.min_value == null && filters.max_value == null)
    return { ok: false, filters: filters, sort: sort, clarification: 'Уточните число для сравнения ставок (например «ниже 5%»).' };
  return { ok: true, filters: validate(filters), sort: sort, clarification: '' };
}

// reject any key not in the strict schema (defence in depth — the parser only emits allowed keys)
function validate(filters) {
  const out = {};
  for (const k of Object.keys(filters || {})) if (ALLOWED_FILTERS.indexOf(k) >= 0) out[k] = filters[k];
  return out;
}
function mergeFilters(prev, next) {
  const out = Object.assign({}, validate(prev || {}));
  const n = validate(next || {});
  for (const k of Object.keys(n)) out[k] = n[k];
  return out;
}

// ---- applier -----------------------------------------------------------------------------------------
function competitorPasses(c, f, bundle) {
  if (f.region && low(c.region).indexOf(f.region) < 0) return false;
  if (f.competitor && low(c.competitor).indexOf(f.competitor) < 0) return false;
  if (f.source_quality && low(c.quality) !== f.source_quality) return false;
  if (f.min_score != null && !(Number(c.score) >= f.min_score)) return false;
  if (f.max_score != null && !(Number(c.score) <= f.max_score)) return false;
  if (f.require_evidence === true) { const has = (bundle.evidence || []).some(e => low(e.competitor) === low(c.competitor)); if (!has) return false; }
  return true;
}
function offerPasses(o, f, bundle) {
  if (f.competitor && low(o.competitor).indexOf(f.competitor) < 0) return false;
  if (f.has_promotion === true && !str(o.promotion).trim()) return false;
  if (f.cta && low(o.cta).indexOf(low(f.cta)) < 0) return false;
  const rate = rateNum(o.price_rate);
  if (f.max_value != null && !(rate != null && rate <= f.max_value)) return false;
  if (f.min_value != null && !(rate != null && rate >= f.min_value)) return false;
  if (f.has_change === true) { const ch = (bundle.changes || []).some(c => low(c.entity).indexOf(low(o.competitor)) >= 0); if (!ch) return false; }
  if (f.require_evidence === true) { const has = (bundle.evidence || []).some(e => low(e.competitor) === low(o.competitor)); if (!has) return false; }
  return true;
}

const QUALITY_RANK = { healthy: 3, degraded: 2, quarantined: 1, '': 0 };
const CONF_RANK = { high: 3, medium: 2, low: 1, '': 0 };
function sortComparators(by) {
  if (by === 'score') return (a, b) => (Number(b.score) || -Infinity) - (Number(a.score) || -Infinity);
  if (by === 'quality') return (a, b) => (QUALITY_RANK[low(b.quality)] || 0) - (QUALITY_RANK[low(a.quality)] || 0);
  return null;
}

// applyFilter(bundle, filter, sort) -> { competitors, offers, evidence, counts, active }
function applyFilter(bundle, filter, sort) {
  bundle = bundle || {}; filter = validate(filter || {});
  let competitors = (bundle.competitors || []).filter(c => competitorPasses(c, filter, bundle));
  let offers = (bundle.offers || []).filter(o => offerPasses(o, filter, bundle));
  let evidence = (bundle.evidence || []).filter(e => {
    if (filter.competitor && low(e.competitor).indexOf(filter.competitor) < 0) return false;
    if (filter.confidence && low(e.confidence) !== filter.confidence) return false;
    return true;
  });
  if (sort && sort.by) {
    if (sort.by === 'score' || sort.by === 'quality') { const cmp = sortComparators(sort.by); if (cmp) competitors = competitors.slice().sort(cmp); }
    if (sort.by === 'price_rate') offers = offers.slice().sort((a, b) => (rateNum(a.price_rate) == null ? Infinity : rateNum(a.price_rate)) - (rateNum(b.price_rate) == null ? Infinity : rateNum(b.price_rate)) * (sort.dir === 'desc' ? -1 : 1));
    if (sort.by === 'confidence') evidence = evidence.slice().sort((a, b) => (CONF_RANK[low(b.confidence)] || 0) - (CONF_RANK[low(a.confidence)] || 0));
  }
  return {
    competitors: competitors, offers: offers, evidence: evidence,
    counts: { competitors: competitors.length, offers: offers.length, evidence: evidence.length },
    active: { filters: filter, sort: sort || null }, external_calls: 0
  };
}

module.exports = { parseFilter, mergeFilters, applyFilter, validate, ALLOWED_FILTERS, SORT_KEYS, rateNum };
