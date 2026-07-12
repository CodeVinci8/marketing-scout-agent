'use strict';
// discovery_query.js — DISCOVERY-001: deterministic cross-source competitor DISCOVERY query expansion.
//
// Turns a plain-text discovery request ("найди конкурентов по ПТС в Москве в Telegram") into a BOUNDED list of
// concrete search queries per platform (website / telegram / vk), using Russian credit/brokerage product
// synonyms. NO LLM (an optional LLM expansion is a Stage-F enhancement, gated + off). Every query carries its
// platform target, the product it targets, a human reason, a result cap and provider — so the caller can budget
// and dedupe before any paid search. Pure + deterministic, embeddable, $0.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }
function clamp(n, lo, hi) { n = num(n, lo); return n < lo ? lo : (n > hi ? hi : n); }

// Product/service -> ordered RU search phrases (most specific first). Mirrors config/taxonomy.json `service`
// but adds the search-phrase surface forms a user/site would actually contain.
const PRODUCT_PHRASES = {
  pts_loan: ['кредит под ПТС', 'займ под ПТС', 'автоломбард', 'кредит под залог авто', 'залог авто'],
  mortgage_brokerage: ['ипотечный брокер', 'помощь с ипотекой', 'одобрение ипотеки', 'ипотека без отказа'],
  real_estate_secured_loan: ['кредит под залог недвижимости', 'займ под залог квартиры', 'деньги под залог недвижимости'],
  mortgage_refinance: ['рефинансирование ипотеки', 'снижение ставки по ипотеке'],
  debt_refinancing: ['рефинансирование кредитов', 'объединение кредитов', 'рефинансирование'],
  credit_after_refusals: ['кредит после отказов', 'помощь в получении кредита', 'плохая кредитная история'],
  business_credit: ['кредит для бизнеса', 'кредит для ООО', 'оборотные средства бизнесу'],
  credit_brokerage: ['кредитный брокер', 'помощь в получении кредита', 'кредит наличными', 'кредит с плохой историей']
};

// Detect the product/service from the user's text (order = most specific first). Falls back to cfg.default_niche
// or credit_brokerage.
const PRODUCT_HINTS = [
  [/птс|залог\s*авто|автоломбард|под\s*авто|автозайм/i, 'pts_loan'],
  [/залог\s*недвижим|под\s*залог\s*(кварт|дом|недвиж)|под\s*квартир/i, 'real_estate_secured_loan'],
  [/рефинанс[а-яё]*\s*ипоте[кч]|ипоте[кч][а-яё]*\s*рефинанс/i, 'mortgage_refinance'],
  [/ипоте[кч]/i, 'mortgage_brokerage'],
  [/рефинанс|объединен\w*\s*кредит/i, 'debt_refinancing'],
  [/для\s*бизнеса|\bооо\b|оборотн|тендерн/i, 'business_credit'],
  [/после\s*отказ|плох\w*\s*кредитн\w*\s*истор|испорчен\w*\s*кредитн/i, 'credit_after_refusals']
];
function detectProduct(text, cfg) {
  const t = str(text);
  for (const [rx, v] of PRODUCT_HINTS) { if (rx.test(t)) return v; }
  const niche = low((cfg && cfg.default_niche) || '');
  return PRODUCT_PHRASES[niche] ? niche : 'credit_brokerage';
}

// Which platforms a discovery request targets. An explicit platform mention narrows it; otherwise discover across
// the requested set (default: every allowlisted discoverable platform). Avito is NEVER a discovery target.
// NOTE: JS \b/\w are ASCII-only — never use \b around Cyrillic. Use explicit non-letter boundaries instead.
const PLATFORM_HINTS = [
  [/телеграм|telegram|t\.me|канал|(^|[^а-яёa-z])тг([^а-яёa-z]|$)/i, 'telegram'],
  [/вконтакте|соцсет|сообществ|(^|[^а-яёa-z])вк([^а-яёa-z]|$)|(^|[^a-z])vk([^a-z]|$)/i, 'vk'],
  [/сайт|website|(^|[^а-яёa-z])веб([^а-яёa-z]|$)|(^|[^a-z])web([^a-z]|$)/i, 'website']
];
function detectPlatforms(text, opts) {
  opts = opts || {};
  if (opts.platform) { const p = low(opts.platform); if (['website', 'telegram', 'vk'].indexOf(p) >= 0) return [p]; }
  const t = str(text);
  const hit = [];
  for (const [rx, v] of PLATFORM_HINTS) { if (rx.test(t) && hit.indexOf(v) < 0) hit.push(v); }
  let want = hit.length ? hit : ['website', 'telegram', 'vk'];
  // intersect with the allowlist (a platform not configured can't be discovered) and never Avito.
  const allow = ((opts.allowlist) || ['website']).map(low);
  want = want.filter(p => p !== 'avito' && allow.indexOf(p) >= 0);
  return want;
}

// Region for the query: shorten "Москва/МО" -> "Москва" (the searchable token).
function regionToken(region) {
  const r = str(region) || 'Москва';
  return r.split(/[\/,]/)[0].trim() || 'Москва';
}

// site: filter per platform. Website discovery uses a plain web query (no site: filter).
function siteFilter(platform) {
  if (platform === 'telegram') return 'site:t.me/s ';
  if (platform === 'vk') return 'site:vk.com ';
  return '';
}

// buildDiscoveryQueries(opts) -> [{ query_text, platform_target, intent, product, reason, max_results, provider,
//   est_cost_usd }]. opts: { text, niche, service, region, platform, allowlist, known_competitors, max_variants,
//   max_results, cost_search_usd }.
function buildDiscoveryQueries(opts) {
  opts = opts || {};
  const text = str(opts.text);
  const region = regionToken(opts.region);
  const platforms = detectPlatforms(text, opts);
  const product = str(opts.service) && PRODUCT_PHRASES[low(opts.service)] ? low(opts.service) : detectProduct(text, opts);
  const phrases = (PRODUCT_PHRASES[product] || PRODUCT_PHRASES.credit_brokerage);
  const perPlatform = clamp(opts.max_variants, 3, 5);
  const maxResults = clamp(opts.max_results, 5, 10);
  const perCall = (opts.cost_search_usd != null && isFinite(Number(opts.cost_search_usd))) ? Number(opts.cost_search_usd) : null;
  const out = [];
  const seen = {};
  platforms.forEach(function (pf) {
    const site = siteFilter(pf);
    phrases.slice(0, perPlatform).forEach(function (ph) {
      const q = (site + '"' + ph + '" ' + region).trim();
      const key = pf + '::' + low(q);
      if (seen[key]) return; seen[key] = 1;
      out.push({
        query_text: q, platform_target: pf, intent: 'competitor_discovery', product: product,
        reason: 'поиск ' + (pf === 'telegram' ? 'Telegram-каналов' : (pf === 'vk' ? 'VK-сообществ' : 'сайтов')) + '-кандидатов по «' + ph + '» в ' + region,
        max_results: maxResults, provider: 'firecrawl_search', est_cost_usd: perCall
      });
    });
  });
  return out;
}

// projected cost + call count for a query set (budget gate consults this BEFORE any paid search).
function projectDiscoveryCost(queries, cfg) {
  queries = queries || []; cfg = cfg || {};
  const per = (cfg.cost_search_usd != null && isFinite(Number(cfg.cost_search_usd))) ? Number(cfg.cost_search_usd)
    : (cfg.cost_firecrawl_page_usd != null ? Number(cfg.cost_firecrawl_page_usd) : null);
  const calls = queries.length;
  return { search_calls: calls, cost_status: per == null ? 'unknown' : 'estimated', projected_cost_usd: per == null ? null : Math.round(per * calls * 1000) / 1000 };
}

module.exports = {
  PRODUCT_PHRASES, detectProduct, detectPlatforms, regionToken, siteFilter,
  buildDiscoveryQueries, projectDiscoveryCost, str, low, num
};
