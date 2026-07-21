'use strict';
// source_role.js — WIP2 SOURCE-ROLE-001: classify a public source's ROLE from its COLLECTED EVIDENCE, never from
// the user's niche. A Telegram/VK channel that reports market news is NOT a competitor just because the request
// niche is credit_brokerage (regression: PRObonds/frank_media/banksta). A source becomes a direct_competitor only
// when its own posts advertise its own niche offers with prices/CTA. Pure, embeddable, deterministic-first.
//
// classifySourceRole({ source_id, kind, evidence, niche }) -> {
//   source_role, role_confidence, role_reason, evidence_ids, direct_competitor, limitations }
// Roles: direct_competitor | adjacent_player | industry_source | news_source | public_community | irrelevant_or_uncertain

function srStr(v) { return v == null ? '' : String(v); }
function srLow(v) { return srStr(v).toLowerCase(); }
function srClamp01(x) { x = Number(x); return isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }

// Niche-service relevance: does the text talk about lending/credit at all? (deliberately broad — relevance, not role)
var SR_NICHE_TERMS = ['займ', 'заём', 'заем', 'кредит', 'ссуд', 'ипотек', 'рефинанс', 'лизинг', 'ломбард', 'мфо',
  'микрозайм', 'рассрочк', 'под залог', 'птс', 'долг', 'просрочк', 'коллектор', 'банкрот', 'брокер'];
// A source SPEAKING AS a provider of a niche offer (first-person, with price/CTA) → competitor signal.
var SR_OWN_OFFER = ['оформить', 'оформите', 'подать заявку', 'подайте заявку', 'получите', 'получить деньги',
  'наши условия', 'у нас', 'ставка от', 'без справок', 'одобрение', 'заявка онлайн', 'взять займ', 'взять кредит',
  'выдаём', 'выдаем', 'выдача за', 'деньги за'];
// Third-person market reporting → news signal.
var SR_NEWS = ['сообщил', 'сообщили', 'по данным', 'по словам', 'заявил', 'аналитик', 'прогноз', 'исследовани',
  'рынок вырос', 'рынок', 'отчёт', 'обзор', 'индекс', 'котировк', 'акци', 'облигац', 'выручк', 'квартал'];
// Regulatory / industry-body content → industry_source signal.
var SR_INDUSTRY = ['банк россии', 'цб рф', 'центробанк', 'регулятор', 'эксперт ра', 'наумир', 'ассоциаци',
  'саморегулир', 'сро', 'ренкинг', 'рейтинг агентств', 'закон', 'законопроект', 'госдума', 'минфин'];
// Community discussion / user Q&A → public_community signal.
var SR_COMMUNITY = ['подскажите', 'кто брал', 'посоветуйте', 'help', 'помогите', 'вопрос', 'а кто', 'делюсь опытом',
  'мой отзыв', 'кто сталкивался'];

function srCount(evTexts, terms) {
  var hits = 0;
  for (var i = 0; i < evTexts.length; i++) {
    var t = evTexts[i];
    for (var j = 0; j < terms.length; j++) { if (t.indexOf(terms[j]) >= 0) { hits++; break; } }
  }
  return hits;
}

function classifySourceRole(input) {
  input = input || {};
  var kind = srLow(input.kind) || 'website';
  var evidence = Array.isArray(input.evidence) ? input.evidence : [];
  var evTexts = evidence.map(function (e) { return srLow((e && (e.excerpt || e.text || e.text_ru)) || ''); });
  var evidence_ids = evidence.map(function (e) { return srStr(e && (e.evidence_id || e.id)); }).filter(Boolean);
  var n = evTexts.length;
  var limitations = [];

  if (n === 0) {
    return { source_role: 'irrelevant_or_uncertain', role_confidence: 0, direct_competitor: false,
      role_reason: 'Нет доказательной базы для классификации источника.', evidence_ids: [],
      limitations: ['Роль источника не определена: нет собранных публичных материалов.'] };
  }

  var nicheHits = srCount(evTexts, SR_NICHE_TERMS);
  var ownOffer = srCount(evTexts, SR_OWN_OFFER.concat([])); // own-offer wording
  // own-offer only counts as a COMPETITOR signal when it co-occurs with niche relevance in the same source
  var offerWithNiche = 0;
  for (var i = 0; i < evTexts.length; i++) {
    var t = evTexts[i];
    var hasOffer = false, hasNiche = false;
    for (var a = 0; a < SR_OWN_OFFER.length; a++) { if (t.indexOf(SR_OWN_OFFER[a]) >= 0) { hasOffer = true; break; } }
    for (var b = 0; b < SR_NICHE_TERMS.length; b++) { if (t.indexOf(SR_NICHE_TERMS[b]) >= 0) { hasNiche = true; break; } }
    if (hasOffer && hasNiche) offerWithNiche++;
  }
  var news = srCount(evTexts, SR_NEWS);
  var industry = srCount(evTexts, SR_INDUSTRY);
  var community = srCount(evTexts, SR_COMMUNITY);
  var nicheRate = nicheHits / n;

  // ---- decide ----
  var role, conf, reason, direct = false;

  if (nicheHits === 0) {
    role = 'irrelevant_or_uncertain'; conf = srClamp01(0.5 + 0.3 * (1 - nicheRate));
    reason = 'Материалы источника не относятся к кредитной тематике запроса.';
    limitations.push('Источник не показал релевантности к нише — выводы для задачи ограничены.');
  } else if (offerWithNiche >= Math.max(2, Math.ceil(n * 0.34))) {
    // the source itself advertises its own niche offers with price/CTA
    role = 'direct_competitor'; direct = true;
    conf = srClamp01(0.55 + 0.4 * (offerWithNiche / n));
    reason = 'Источник публикует собственные предложения по нише с ценами/призывом к действию.';
    if (kind !== 'website') limitations.push('Прямая конкуренция определена по постам канала; карточки компании с офферами и ценами нет — подтвердите вручную.');
  } else if (industry >= Math.max(1, Math.ceil(n * 0.25)) && industry >= news) {
    role = 'industry_source'; conf = srClamp01(0.5 + 0.3 * (industry / n));
    reason = 'Регуляторные/отраслевые материалы (ЦБ, рейтинговые агентства, ассоциации) по рынку.';
    limitations.push('Отраслевой источник: описывает рынок в целом, а не конкретное коммерческое предложение.');
  } else if (news >= Math.max(1, Math.ceil(n * 0.34))) {
    role = 'news_source'; conf = srClamp01(0.5 + 0.3 * (news / n));
    reason = 'Новостные/аналитические публикации о компаниях и рынке (третье лицо).';
    limitations.push('Новостной источник: сигналы рынка, а не офферы источника; не прямой конкурент.');
  } else if (community >= Math.max(1, Math.ceil(n * 0.34))) {
    role = 'public_community'; conf = srClamp01(0.45 + 0.3 * (community / n));
    reason = 'Обсуждения и вопросы аудитории — публичное сообщество.';
    limitations.push('Публичное сообщество: пользовательский контент, не коммерческое предложение источника.');
  } else if (offerWithNiche >= 1) {
    role = 'adjacent_player'; conf = srClamp01(0.4 + 0.2 * (offerWithNiche / n));
    reason = 'Есть признаки собственных предложений по смежным финансовым услугам, но не по основной нише запроса.';
    limitations.push('Смежный игрок: пересечение с нишей частичное — прямая конкуренция не подтверждена.');
  } else {
    role = 'irrelevant_or_uncertain'; conf = srClamp01(0.4);
    reason = 'Тематика затрагивает кредитную сферу, но роль источника по доказательствам однозначно не определяется.';
    limitations.push('Роль источника неоднозначна: нужны дополнительные данные.');
  }

  // never assert direct competition without the offer signal
  if (role !== 'direct_competitor') direct = false;
  if (kind === 'telegram' || kind === 'vk') {
    limitations.push('Классификация выполнена по публичным постам; отсутствие рекламы в постах не означает отсутствие услуг у владельца канала.');
  }

  return { source_role: role, role_confidence: Math.round(conf * 100) / 100, direct_competitor: direct,
    role_reason: reason, evidence_ids: evidence_ids.slice(0, 12), limitations: limitations };
}

module.exports = { classifySourceRole, SR_NICHE_TERMS, SR_OWN_OFFER, SR_NEWS, SR_INDUSTRY, SR_COMMUNITY };
