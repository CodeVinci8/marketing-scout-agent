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

  const base = {
    platform: platform, is_competitor: false, is_lead_source: false, is_content_creator: false,
    is_news_or_aggregator: false, category: 'irrelevant', confidence: 0, relevance_score: 0,
    classification_reason: '', evidence: []
  };

  // 1. spam / no finance context -> irrelevant (fail closed).
  if (spam.n > 0 || finance.n === 0) {
    base.classification_reason = spam.n > 0 ? ('спам/нерелевантная тематика: ' + spam.hit.join(', ')) : 'нет признаков кредитной/брокерской тематики';
    return base;
  }
  base.evidence = finance.hit.slice();

  // 1b. KNOWN aggregator/media/directory host — never a competitor regardless of snippet terms.
  const host = low(input.host) || hostOf(input.url);
  if (host && isAggregatorHost(host)) {
    base.is_news_or_aggregator = true; base.category = 'news_or_aggregator';
    base.confidence = 55; base.relevance_score = 35;
    base.classification_reason = 'агрегатор/каталог/СМИ (' + host + ') — не поставщик услуги';
    return base;
  }

  // 2. COMPETITOR — a service PROVIDER: provider framing present and stronger than audience framing.
  //    A provider identity (broker/autolombard) or a real provider-action offer — not just a product noun.
  if (providerScore >= 2 && providerScore > audienceScore) {
    base.is_competitor = true; base.category = 'competitor';
    base.confidence = clamp(50 + positioning.n * 14 + offer.n * 10 + cta.n * 6, 0, 95);
    base.relevance_score = clamp(60 + (positioning.n + offer.n) * 10, 0, 100);
    const why = positioning.hit.concat(offer.hit).slice(0, 3);
    base.classification_reason = 'поставщик услуги: ' + why.join(', ') + (cta.n ? ('; призыв к действию (' + cta.hit.slice(0, 2).join(', ') + ')') : '');
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

// rank + split a set of classified candidates for the "top competitors to add" UX.
function rankCandidates(cands) {
  const arr = (cands || []).slice().sort(function (a, b) {
    const ac = a.is_competitor ? 1 : 0, bc = b.is_competitor ? 1 : 0;
    if (ac !== bc) return bc - ac;
    return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
  });
  return {
    competitors: arr.filter(c => c.is_competitor),
    lead_sources: arr.filter(c => c.is_lead_source),
    other: arr.filter(c => !c.is_competitor && !c.is_lead_source),
    ranked: arr
  };
}

module.exports = { classifyCandidate, rankCandidates, isAggregatorHost, AGGREGATOR_HOSTS, str, low };
