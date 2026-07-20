'use strict';
// candidate_classifier.js — DISCOVERY-002: deterministic, evidence-based classification of a discovered candidate
// source (website / Telegram channel / VK community) into ONE of:
//   competitor        — a provider offering the relevant commercial service (broker/agency) with CTA/offer evidence
//   lead_source       — a public community with audience questions/needs (valuable for lead signals, NOT a provider)
//   content_creator   — educational/blog channel about finance with NO service offer
//   news_or_aggregator— pure news / rate digest / directory / bank rating
//   irrelevant        — no finance/broker evidence (or spam)
// NO LLM. Classification is derived from evidence terms found in the candidate's public title/description/content/
// recent posts — never from the platform or channel name alone. Pure + deterministic, embeddable, $0.

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function clamp(n, lo, hi) { n = Number(n) || 0; return n < lo ? lo : (n > hi ? hi : n); }

// ---- evidence term sets (credit_brokerage MVP; mirrors WF11 relevance vocabulary) -------------------------
// PROVIDER IDENTITY — the candidate positions itself AS the service business (broker/agency/autolombard). A bare
// product term ("кредит под ПТС") is NOT here — it is finance context, because an audience community mentions it too.
const POSITIONING = ['кредитный брокер', 'ипотечный брокер', 'финансовый брокер', 'кредитный помощник', 'автоломбард', 'кредитное агентство', 'помощь в кредитовании'];
// PROVIDER ACTION — a provider pitching what they DO for you (never just a product noun).
const OFFER = ['помощь в получении кредит', 'поможем получить кредит', 'поможем взять кредит', 'поможем с кредит', 'поможем с ипотек', 'подбор кредит', 'подбор банка', 'подберём банк', 'подберем банк', 'подберём кредит', 'без предоплаты', 'оплата за результат', 'работаем по договору', 'одобрение кредит', 'одобрим кредит', 'поможем с одобрени', 'снижение ставки', 'снизим ставку', 'исправление кредитной истори', 'исправим кредитн', 'рефинансирование кредит'];
// A CTA / contact-to-act signal (a provider invites you to act).
const CTA = ['оставьте заявк', 'оставить заявк', 'оставляйте заявк', 'запишитесь на консультаци', 'бесплатная консультаци', 'бесплатный расчёт', 'бесплатный расчет', 'свяжитесь с нами', 'пишите в личк', 'напишите в личк', 'звоните', 'консультаци', 'заявка на кредит', 'рассчитать', 'узнать одобрение'];
// finance/broker CONTEXT (necessary, not sufficient) — a candidate with none of these is irrelevant.
const FINANCE = ['кредит', 'кредитн', 'займ', 'ипотек', 'залог', 'банк', 'ставк', 'рефинанс', 'птс', 'брокер', 'заёмщик', 'заемщик', 'просрочк', 'кредитн истори', 'одобрени', 'отказ', 'микрозайм', 'мфо'];
// NEWS / market digest / rate reporting.
const NEWS = ['цб рф', 'центробанк', 'ключевая ставка', 'ставка цб', 'новост', 'обзор рынка', 'дайджест', 'статистик', 'прогноз', 'аналитик', 'инфляц', 'выдач', 'регулятор'];
// AGGREGATOR / directory / comparison.
const AGGREGATOR = ['каталог', 'рейтинг банков', 'сравнение кредит', 'подборка банков', 'все банки', 'агрегатор', 'маркетплейс'];
// EDUCATIONAL / content-creator (explains, no offer).
const EDU = ['как получить', 'как взять', 'как оформить', 'разбор', 'объясня', 'лайфхак', 'советы', 'гайд', 'инструкция', 'ликбез', 'финансовая грамотность', 'финграмотност', 'обучени'];
// LEAD-SOURCE audience-question markers (people asking, not offering).
const AUDIENCE = ['подскажите', 'помогите', 'кто сталкивался', 'нужен совет', 'посоветуйте', 'ищу кредит', 'ищу займ', 'где взять', 'кто брал', 'реально ли получить', 'вопрос по кредит', 'обсуждение'];
// hard-negative / spam.
const SPAM = ['ставки на спорт', 'казино', 'crypto pump', 'binary options', 'заработок в интернете без вложений', 'пирамид'];
// KNOWN media / directory / bank-rating / comparison hosts. A SERP snippet from these contains the query terms
// ("автоломбард …") but the site itself is an aggregator, NOT a provider — it must NEVER be scored a competitor.
const AGGREGATOR_HOSTS = ['banki.ru', 'sravni.ru', 'vbr.ru', 'kp.ru', 'rbc.ru', 'rambler.ru', 'mail.ru',
  'lenta.ru', 'ria.ru', 'tass.ru', 'dzen.ru', 'zen.yandex.ru', 'vc.ru', 'journal.tinkoff.ru', 'irecommend.ru',
  'otzovik.com', 'zoon.ru', 'flamp.ru', 'spr.ru', 'rusprofile.ru', 'list-org.com'];
function hostOf(url) { return low(url).replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].replace(/^m\./i, '').replace(/^www\./i, ''); }
function isAggregatorHost(host) { host = low(host); return AGGREGATOR_HOSTS.some(function (d) { return host === d || host.endsWith('.' + d); }); }
// DEFECT-9: media/news handle markers (Telegram/VK) — smi_rf_moskva, news_*, novosti_*, *_tv, gazeta_*, vesti_*,
// rbc/tass/ria/lenta/interfax/kommersant/vedomosti. Such a channel that merely reposts a finance ad is NOT a
// direct competitor. Matched at word/segment boundaries in the handle so "avtolombard" etc. never trip it.
const MEDIA_HANDLE_RX = /(^|[\s_.\/:@-])(smi|news|novost[iy]|media|mass?media|tv|telekanal|radio|gazet[ay]|vesti|pressa?|zhurnal|magazine|afisha|rbc|rbk|tass|ria|lenta|interfax|kommersant|vedomosti|readovka|mash|baza)([\s_.\/:@0-9-]|$)/i;
function isMediaHandle(handle) { return MEDIA_HANDLE_RX.test(low(handle)); }

// ---- region fit (DISCOVERY-005) --------------------------------------------------------------------------
// Region groups: substrings that identify a Russian city/region in candidate evidence. Moscow includes МО
// (Московская область) satellite cities. Used to score region fit against the region the user asked for.
// Each group lists Cyrillic AND transliterated (Latin) fragments — VK/Telegram handles are usually Latin
// ("...barnaul", "nsk", "spb"), so the handle/title can name the city even when the page body says otherwise.
// Cyrillic fragments + LONG, distinctive Latin transliterations only. Short abbreviations (nsk/spb/msk/perm/omsk/
// ufa/ekb) are deliberately omitted — as bare substrings they false-match ordinary words ("permanent", "amsk…").
const REGION_GROUPS = {
  moscow: ['москв', 'московск', 'подмосков', 'зеленоград', 'химк', 'балаших', 'мытищ', 'подольск', 'люберц', 'красногорск', 'одинцов', 'домодедов', 'королёв', 'королев', 'реутов', 'щёлков', 'щелков', 'moskva', 'moscow'],
  spb: ['санкт-петербург', 'петербург', 'ленинградск', 'ленобласт', 'питер', 'peterburg', 'sankt-peterburg'],
  novosibirsk: ['новосибирск', 'novosibirsk'],
  barnaul: ['барнаул', 'алтайск', 'barnaul'],
  ekb: ['екатеринбург', 'свердловск', 'ekaterinburg'],
  kazan: ['казан', 'татарстан', 'kazan'],
  nnovgorod: ['нижн новгород', 'нижегородск', 'нижнего новгород', 'nizhny'],
  rostov: ['ростов-на-дону', 'ростовск', 'rostov'],
  krasnodar: ['краснодар', 'кубан', 'krasnodar'],
  samara: ['самар', 'тольятт', 'samara', 'tolyatti'],
  chelyabinsk: ['челябинск', 'chelyabinsk'],
  omsk: ['омск'],
  ufa: ['уфа', 'башкорт'],
  krasnoyarsk: ['красноярск', 'krasnoyarsk'],
  perm: ['перм'],
  voronezh: ['воронеж', 'voronezh'],
  volgograd: ['волгоград', 'volgograd'],
  tyumen: ['тюмен', 'tyumen'],
  irkutsk: ['иркутск', 'irkutsk']
};
const REGION_LABELS = {
  moscow: 'Москва/МО', spb: 'Санкт-Петербург', novosibirsk: 'Новосибирск', barnaul: 'Барнаул', ekb: 'Екатеринбург',
  kazan: 'Казань', nnovgorod: 'Нижний Новгород', rostov: 'Ростов-на-Дону', krasnodar: 'Краснодар', samara: 'Самара',
  chelyabinsk: 'Челябинск', omsk: 'Омск', ufa: 'Уфа', krasnoyarsk: 'Красноярск', perm: 'Пермь', voronezh: 'Воронеж',
  volgograd: 'Волгоград', tyumen: 'Тюмень', irkutsk: 'Иркутск'
};
function regionLabel(k) { return REGION_LABELS[k] || k; }
function detectRegions(blob) { blob = low(blob); const hits = []; for (const k in REGION_GROUPS) { if (REGION_GROUPS[k].some(function (t) { return blob.indexOf(t) >= 0; })) hits.push(k); } return hits; }
// Normalize the region the user asked for ('Москва', 'МО', 'Московская область', 'Москва и область') -> a group key.
function normalizeQueryRegion(region) {
  const r = low(region); if (!r) return '';
  for (const k in REGION_GROUPS) { if (REGION_GROUPS[k].some(function (t) { return r.indexOf(t) >= 0; })) return k; }
  if (/(^|[^а-яё])мо([^а-яё]|$)/.test(r)) return 'moscow';  // МО = Московская область
  return '';
}
// regionFit(queryRegionKey, blob) -> { region_match: 'match'|'mismatch'|'unknown', region_reason }.
function regionFit(queryRegionKey, blob) {
  if (!queryRegionKey) return { region_match: 'unknown', region_reason: 'регион запроса не задан' };
  const found = detectRegions(blob);
  if (found.indexOf(queryRegionKey) >= 0) return { region_match: 'match', region_reason: 'регион соответствует: ' + regionLabel(queryRegionKey) };
  if (found.length) return { region_match: 'mismatch', region_reason: 'указан другой регион: ' + found.slice(0, 2).map(regionLabel).join(', ') };
  return { region_match: 'unknown', region_reason: 'регион на странице не указан' };
}
function labelMismatch(keys) { return { region_match: 'mismatch', region_reason: 'указан другой регион: ' + keys.slice(0, 2).map(regionLabel).join(', ') }; }
function labelMatch(k) { return { region_match: 'match', region_reason: 'регион соответствует: ' + regionLabel(k) }; }
// regionDecide: THREE tiers of trust. The handle/identity (tier 0) is decisive — a foreign city there is a
// mismatch even when the search snippet or scraped page also mentions the query city (a "…barnaul" VK handle is
// Barnaul, full stop). The short snippet (tier 1) still flags a foreign-only city. The long scraped body (tier 2)
// is weak: it can confirm the query city, but a foreign mention there only makes the city "unconfirmed".
function regionDecide(queryRegionKey, handleText, snippetText, bodyText) {
  if (!queryRegionKey) return { region_match: 'unknown', region_reason: 'регион запроса не задан' };
  const h = detectRegions(handleText), hOther = h.filter(function (k) { return k !== queryRegionKey; });
  if (hOther.length) return labelMismatch(hOther);              // handle names another city -> decisive
  if (h.indexOf(queryRegionKey) >= 0) return labelMatch(queryRegionKey);
  const s = detectRegions(snippetText), sOther = s.filter(function (k) { return k !== queryRegionKey; });
  if (s.indexOf(queryRegionKey) >= 0) return labelMatch(queryRegionKey);
  if (sOther.length) return labelMismatch(sOther);             // snippet names only a foreign city
  const b = detectRegions(bodyText), bOther = b.filter(function (k) { return k !== queryRegionKey; });
  if (b.indexOf(queryRegionKey) >= 0 && bOther.length === 0) return labelMatch(queryRegionKey);
  if (b.indexOf(queryRegionKey) >= 0) return { region_match: 'unknown', region_reason: 'на странице упоминаются разные регионы, город не подтверждён' };
  if (bOther.length) return { region_match: 'unknown', region_reason: 'город не подтверждён' };
  return { region_match: 'unknown', region_reason: 'регион на странице не указан' };
}
// Back-compat 2-tier wrapper (identity/snippet as strong, body as weak).
function regionFitPrioritized(queryRegionKey, strongText, weakText) {
  return regionDecide(queryRegionKey, '', strongText, weakText);
}

function countHits(blob, list) { let n = 0, hit = []; for (let i = 0; i < list.length; i++) { if (blob.indexOf(list[i]) >= 0) { n++; if (hit.length < 4) hit.push(list[i]); } } return { n: n, hit: hit }; }

// classifyCandidate(input) -> classification object. input: { title, description, content, url, platform,
// recent_posts (array|string), region }.
function classifyCandidate(input) {
  input = input || {};
  const posts = Array.isArray(input.recent_posts) ? input.recent_posts.join(' \n ') : str(input.recent_posts);
  const blob = low([input.title, input.description, input.content, posts].map(str).join(' \n '));
  const platform = low(input.platform) || 'website';

  const positioning = countHits(blob, POSITIONING);
  const offer = countHits(blob, OFFER);
  const cta = countHits(blob, CTA);
  const finance = countHits(blob, FINANCE);
  const news = countHits(blob, NEWS);
  const aggr = countHits(blob, AGGREGATOR);
  const edu = countHits(blob, EDU);
  const audience = countHits(blob, AUDIENCE);
  const spam = countHits(blob, SPAM);
  // provider vs audience framing — the core competitor/lead-source discriminator.
  const providerScore = positioning.n * 2 + offer.n * 2 + cta.n;
  const audienceScore = audience.n * 2;

  // DISCOVERY-005: region fit + component scoring. `validated` means the evidence came from a fetched page/preview
  // (DISCOVERY-006), not just a SERP snippet — it earns a confidence bonus and is required by the add policy.
  const host = low(input.host) || hostOf(input.url);
  const validated = input.validated === true;
  // region: identity (handle/title/description/url) is authoritative; the fetched page body is only a weak signal.
  const handleText = low([input.display_name, input.normalized_key, input.url, input.host].map(str).join(' '));
  const snippetText = low([input.title, input.description].map(str).join(' '));
  const bodyText = low([input.content, posts].map(str).join(' '));
  const rf = regionDecide(normalizeQueryRegion(input.query_region), handleText, snippetText, bodyText);
  const aggregator = !!host && isAggregatorHost(host);
  // components (0-anchored; summed then clamped 0..100 for competitors)
  const comp = {
    service_evidence: clamp(positioning.n * 16 + offer.n * 12, 0, 45),
    cta: clamp(cta.n * 7, 0, 15),
    region: rf.region_match === 'match' ? 18 : (rf.region_match === 'mismatch' ? -30 : 0),
    validation: validated ? 15 : 0,
    platform_quality: platform === 'website' ? 5 : (platform === 'telegram' ? 5 : 3),
    aggregator_penalty: aggregator ? -100 : 0,
    duplicate_penalty: (input.already_tracked === true || String(input.already_tracked).toLowerCase() === 'true') ? -100 : 0
  };
  function scoreOf() { return clamp(22 + comp.service_evidence + comp.cta + comp.region + comp.validation + comp.platform_quality + comp.aggregator_penalty + comp.duplicate_penalty, 0, 100); }

  const base = {
    platform: platform, is_competitor: false, is_lead_source: false, is_content_creator: false,
    is_news_or_aggregator: false, category: 'irrelevant', confidence: 0, relevance_score: 0,
    classification_reason: '', evidence: [], host: host,
    region_match: rf.region_match, region_reason: rf.region_reason, validated: validated, score_components: comp
  };

  // 1. spam / no finance context -> irrelevant (fail closed).
  if (spam.n > 0 || finance.n === 0) {
    base.classification_reason = spam.n > 0 ? ('спам/нерелевантная тематика: ' + spam.hit.join(', ')) : 'нет признаков кредитной/брокерской тематики';
    return base;
  }
  base.evidence = finance.hit.slice();

  // 1b. KNOWN aggregator/media/directory host — never a competitor regardless of snippet terms.
  if (host && isAggregatorHost(host)) {
    base.is_news_or_aggregator = true; base.category = 'news_or_aggregator';
    base.confidence = 55; base.relevance_score = 35;
    base.classification_reason = 'агрегатор/каталог/СМИ (' + host + ') — не поставщик услуги';
    return base;
  }

  // 1c. DEFECT-9: a media/news HANDLE (smi_rf_moskva, news_*, *_tv, gazeta_*, …) is news/content, not a competitor,
  //     unless it is VALIDATED and shows strong direct-provider evidence (it actually sells the service). One
  //     finance phrase in a search snippet is not enough to top-rank a city-news channel as a competitor.
  const mediaHandle = low(input.normalized_key) + ' ' + low(input.display_name);
  if (isMediaHandle(mediaHandle) && !(validated && providerScore >= 4)) {
    base.is_news_or_aggregator = true; base.category = 'news_or_aggregator';
    base.confidence = clamp(45 + news.n * 5, 0, 68); base.relevance_score = clamp(25 + news.n * 5, 0, 60);
    base.classification_reason = 'СМИ/новостной канал — не поставщик услуги напрямую' + (validated ? '' : ' (по данным из результатов поиска, не подтверждено)');
    return base;
  }

  // 2. COMPETITOR — a service PROVIDER: provider framing present and stronger than audience framing.
  //    A provider identity (broker/autolombard) or a real provider-action offer — not just a product noun.
  if (providerScore >= 2 && providerScore > audienceScore) {
    base.is_competitor = true; base.category = 'competitor';
    base.confidence = scoreOf();
    base.relevance_score = clamp(60 + (positioning.n + offer.n) * 10, 0, 100);
    const why = positioning.hit.concat(offer.hit).slice(0, 3);
    base.classification_reason = 'есть признаки коммерческой услуги: ' + why.join(', ')
      + (cta.n ? ('; призыв к действию (' + cta.hit.slice(0, 2).join(', ') + ')') : '')
      + '; ' + rf.region_reason
      + (validated ? '' : '; по данным из результатов поиска (не подтверждено)');
    base.evidence = positioning.hit.concat(offer.hit, cta.hit).slice(0, 5);
    return base;
  }
  const noProvider = (positioning.n === 0 && offer.n === 0);

  // 3. NEWS / AGGREGATOR — reporting/directory dominates and there is no provider offer.
  if ((news.n >= 2 || aggr.n >= 1) && noProvider) {
    base.is_news_or_aggregator = true; base.category = 'news_or_aggregator';
    base.confidence = clamp(50 + news.n * 6 + aggr.n * 10, 0, 85);
    base.relevance_score = clamp(30 + news.n * 5, 0, 70);
    base.classification_reason = aggr.n ? ('агрегатор/каталог: ' + aggr.hit.join(', ')) : ('новостной/аналитический канал: ' + news.hit.slice(0, 3).join(', '));
    return base;
  }

  // 4. LEAD-SOURCE — audience asking questions/needs, not a provider (no offer).
  if (audience.n >= 1 && noProvider) {
    base.is_lead_source = true; base.category = 'lead_source';
    base.confidence = clamp(45 + audience.n * 10, 0, 85);
    base.relevance_score = clamp(40 + audience.n * 8, 0, 90);
    base.classification_reason = 'публичные вопросы аудитории по теме, но не поставщик услуги (' + audience.hit.slice(0, 2).join(', ') + ')';
    base.evidence = audience.hit.slice(0, 4);
    return base;
  }

  // 5. CONTENT-CREATOR — educational finance content without a service offer.
  if (edu.n >= 1 && noProvider) {
    base.is_content_creator = true; base.category = 'content_creator';
    base.confidence = clamp(40 + edu.n * 8, 0, 80);
    base.relevance_score = clamp(25 + edu.n * 6, 0, 60);
    base.classification_reason = 'образовательный/контентный ресурс без коммерческого предложения (' + edu.hit.slice(0, 2).join(', ') + ')';
    return base;
  }

  // 6. finance context but no offer/CTA/audience/news/edu -> weak, treat as content_creator (low confidence).
  base.is_content_creator = true; base.category = 'content_creator';
  base.confidence = 30; base.relevance_score = 25;
  base.classification_reason = 'финансовая тематика без явного предложения услуги — вероятно контент/канал общего профиля';
  return base;
}

// rank + split a set of classified candidates for the "top competitors to add" UX. Among competitors, region fit
// wins before confidence, so an in-region provider outranks a higher-scored out-of-region one (DISCOVERY-005).
function regionRank(m) { return m === 'match' ? 2 : (m === 'mismatch' ? 0 : 1); }
function rankCandidates(cands) {
  const arr = (cands || []).slice().sort(function (a, b) {
    const ac = a.is_competitor ? 1 : 0, bc = b.is_competitor ? 1 : 0;
    if (ac !== bc) return bc - ac;
    if (ac && bc) { const ar = regionRank(a.region_match), br = regionRank(b.region_match); if (ar !== br) return br - ar; }
    return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
  });
  return {
    competitors: arr.filter(c => c.is_competitor),
    lead_sources: arr.filter(c => c.is_lead_source),
    aggregators: arr.filter(c => c.is_news_or_aggregator),
    other: arr.filter(c => !c.is_competitor && !c.is_lead_source && !c.is_news_or_aggregator),
    ranked: arr
  };
}

// Add-to-monitoring eligibility (DISCOVERY-005 #8): only validated in-region competitors above threshold, never
// aggregators/directories/news, never a region mismatch for a local query, never already tracked.
function addEligible(c, opts) {
  c = c || {}; opts = opts || {};
  const thr = Number(opts.min_confidence != null ? opts.min_confidence : 60);
  const requireValidated = opts.require_validated !== false;   // default: validated required
  const allowMismatch = opts.allow_region_mismatch === true;   // default: local query -> no mismatch
  if (!c.is_competitor) return { ok: false, reason: 'не конкурент' };
  if (c.is_news_or_aggregator) return { ok: false, reason: 'агрегатор/каталог/СМИ' };
  if (c.already_tracked === true || String(c.already_tracked).toLowerCase() === 'true') return { ok: false, reason: 'уже отслеживается' };
  if (requireValidated && c.validated !== true) return { ok: false, reason: 'не подтверждён' };
  if (!allowMismatch && c.region_match === 'mismatch') return { ok: false, reason: 'регион не соответствует' };
  if ((Number(c.confidence) || 0) < thr) return { ok: false, reason: 'низкая уверенность' };
  return { ok: true, reason: '' };
}

module.exports = {
  classifyCandidate, rankCandidates, addEligible, isAggregatorHost, AGGREGATOR_HOSTS,
  regionFit, regionFitPrioritized, regionDecide, detectRegions, normalizeQueryRegion, regionLabel, REGION_GROUPS, str, low
};
