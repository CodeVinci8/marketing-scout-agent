// semantic_core.js — Stage C Hardening shared semantic engine (systemic fix, NOT keyword crutches).
//
// Single source of truth for the canonical taxonomy lives in config/taxonomy.json; this module loads it.
// n8n Code nodes cannot require() local files inside the sandbox, so the workflow nodes embed a MIRROR of the
// functions below and the offline harness runs the REAL node jsCode to prove the mirror has not drifted.
//
// Pure functions only: NO network, NO external API, NO secrets. Deterministic.
//
// Responsibilities:
//   - taxonomy normalization + alias resolution (record_type / entity_type / service)
//   - deterministic route mapping (semantic class -> physical queue; the MODEL never names a sheet)
//   - Stage A pre-gate: system-event detection, placeholder/search-card detection, evidence completeness
//   - owned-media / affiliate / direct-offer / negation-quotation detection
//   - explainable, evidence-based confidence (with hard caps)
//   - Stage D semantic validation
//   - classifyOffline(): deterministic evidence-based classifier = free fixture/offline mode + LLM fallback
'use strict';
const fs = require('fs');
const path = require('path');

const TAXONOMY = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'taxonomy.json'), 'utf8')
);

// ---------- small helpers ----------
function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function has(blob, term) { return low(blob).indexOf(low(term)) >= 0; }
function anyTerm(blob, arr) { const b = low(blob); for (const t of arr) { if (b.indexOf(low(t)) >= 0) return true; } return false; }
function hitTerms(blob, arr) { const b = low(blob); const out = []; for (const t of arr) { if (b.indexOf(low(t)) >= 0) out.push(t); } return out; }
function clampScore(v, lo, hi) { const n = parseInt(v, 10); if (isNaN(n)) return lo; return Math.min(hi, Math.max(lo, n)); }

// ---------- taxonomy normalization ----------
function normalizeRecordType(raw) {
  const r = low(raw) || 'unknown';
  if (TAXONOMY.record_type.indexOf(r) >= 0) return { value: r, raw: str(raw), alias_used: false, resolved: true };
  const alias = TAXONOMY.record_type_aliases[r];
  if (alias) return { value: alias, raw: str(raw), alias_used: true, resolved: true };
  return { value: 'unknown', raw: str(raw), alias_used: false, resolved: false };
}

function normalizeEntityType(raw) {
  const r = low(raw) || 'unknown';
  if (TAXONOMY.entity_type.indexOf(r) >= 0) return { value: r, raw: str(raw), alias_used: false, resolved: true };
  const alias = TAXONOMY.entity_type_aliases[r];
  if (alias) return { value: alias, raw: str(raw), alias_used: true, resolved: true };
  return { value: 'unknown', raw: str(raw), alias_used: false, resolved: false };
}

// Resolve a service value to the canonical taxonomy. Preserves raw_model_service_type and never silently
// discards an unresolved value: an unresolved alias is surfaced (unresolved=true) so callers can flag it.
function normalizeService(raw, evidenceText) {
  const rawStr = str(raw);
  const r = low(raw);
  if (r && TAXONOMY.service.indexOf(r) >= 0) {
    return { service_primary: r, raw_model_service_type: rawStr, normalized_service_type: r, alias_used: false, unresolved: false, taxonomy_version: TAXONOMY.taxonomy_version };
  }
  if (r && TAXONOMY.service_aliases[r]) {
    const v = TAXONOMY.service_aliases[r];
    return { service_primary: v, raw_model_service_type: rawStr, normalized_service_type: v, alias_used: true, unresolved: false, taxonomy_version: TAXONOMY.taxonomy_version };
  }
  // Cyrillic phrase aliases on the raw value
  for (const k of Object.keys(TAXONOMY.service_keyword_aliases_cyrillic)) {
    if (r && r.indexOf(k) >= 0) {
      const v = TAXONOMY.service_keyword_aliases_cyrillic[k];
      return { service_primary: v, raw_model_service_type: rawStr, normalized_service_type: v, alias_used: true, unresolved: false, taxonomy_version: TAXONOMY.taxonomy_version };
    }
  }
  // last resort: derive from evidence text (keyword phrase aliases)
  const ev = low(evidenceText);
  if (ev) {
    for (const k of Object.keys(TAXONOMY.service_keyword_aliases_cyrillic)) {
      if (ev.indexOf(k) >= 0) {
        const v = TAXONOMY.service_keyword_aliases_cyrillic[k];
        return { service_primary: v, raw_model_service_type: rawStr, normalized_service_type: v, alias_used: true, unresolved: false, taxonomy_version: TAXONOMY.taxonomy_version };
      }
    }
  }
  // Unknown / unresolved: keep the raw, flag it, do NOT inject downstream as fact.
  const unresolved = !!(rawStr && rawStr.toLowerCase() !== 'unknown');
  return { service_primary: 'unknown', raw_model_service_type: rawStr, normalized_service_type: 'unknown', alias_used: false, unresolved: unresolved, taxonomy_version: TAXONOMY.taxonomy_version };
}

// Derive service from free evidence text when no explicit value was given.
function deriveServiceFromText(text) {
  const t = low(text);
  if (!t) return 'unknown';
  if (/возвратн[а-яё]*\s+лизинг|sale.?leaseback|leaseback/.test(t)) return 'auto_lease_refinance';
  if (/птс|pts|под залог авто|залог автомобил|под авто/.test(t)) return 'pts_loan';
  if (/под залог недвиж|залог квартир|залог дома|под квартир/.test(t)) return 'real_estate_secured_loan';
  if (/ипотек/.test(t) && /рефинанс/.test(t)) return 'mortgage_refinance';
  if (/ипотек/.test(t)) return 'mortgage_brokerage';
  if (/кредитн[а-яё]* истори|исправ[а-яё]* кредитн|очист[а-яё]* кредитн|бки/.test(t)) return 'credit_history_consulting';
  if (/после отказ|с просрочк|плох[а-яё]* кредитн|отказах банк/.test(t)) return 'credit_after_refusals';
  if (/для бизнеса|ип и ооо|оборотн|тендерн|бизнес-кредит/.test(t)) return 'business_credit';
  if (/банковск[а-яё]* гарант/.test(t)) return 'bank_guarantee';
  if (/банкрот/.test(t)) return 'bankruptcy_advisory';
  if (/рефинанс/.test(t)) return 'debt_refinancing';
  if (/объедин[а-яё]* кредит|консолидац/.test(t)) return 'debt_consolidation';
  if (/залог|под обеспечени/.test(t)) return 'secured_financing';
  if (/кредитн[а-яё]* брокер|подбор банк|помощь.{0,12}кредит/.test(t)) return 'credit_brokerage';
  if (/кредит|займ/.test(t)) return 'consumer_credit';
  return 'unknown';
}

// Collect every canonical service the evidence text supports (primary + secondary).
function deriveAllServices(text) {
  const t = low(text);
  const found = [];
  const push = (s) => { if (s && s !== 'unknown' && found.indexOf(s) < 0) found.push(s); };
  if (/возвратн[а-яё]*\s+лизинг|leaseback/.test(t)) push('auto_lease_refinance');
  if (/птс|pts|под залог авто|залог автомобил|под авто/.test(t)) push('pts_loan');
  if (/под залог недвиж|залог квартир|залог дома|под квартир/.test(t)) push('real_estate_secured_loan');
  if (/ипотек/.test(t) && /рефинанс/.test(t)) push('mortgage_refinance');
  else if (/ипотек/.test(t)) push('mortgage_brokerage');
  if (/кредитн[а-яё]* истори|исправ[а-яё]* кредитн|очист[а-яё]* кредитн|бки/.test(t)) push('credit_history_consulting');
  if (/после отказ|с просрочк|плох[а-яё]* кредитн|отказах банк/.test(t)) push('credit_after_refusals');
  if (/для бизнеса|ип и ооо|оборотн|тендерн|бизнес-кредит/.test(t)) push('business_credit');
  if (/банковск[а-яё]* гарант/.test(t)) push('bank_guarantee');
  if (/банкрот/.test(t)) push('bankruptcy_advisory');
  if (/рефинанс/.test(t)) push('debt_refinancing');
  if (/объедин[а-яё]* кредит|консолидац/.test(t)) push('debt_consolidation');
  if (/залог|под обеспечени/.test(t)) push('secured_financing');
  return found;
}

function routeForRecordType(rt) {
  return TAXONOMY.route_map[low(rt)] || 'review_queue';
}
function entityForRecordType(rt) { return TAXONOMY.entity_for_record_type[low(rt)] || 'unknown'; }
function legacyEntityForRecordType(rt) { return TAXONOMY.legacy_entity_for_record_type[low(rt)] || 'content_idea'; }
function reportEligibleByType(rt) { return TAXONOMY.report_eligible_default_false_record_types.indexOf(low(rt)) < 0; }

// ---------- Stage A detectors ----------
function detectSystemEvent(text) {
  const t = str(text);
  const tl = low(t);
  const PATTERNS = [
    /channel name was changed to/i,
    /(название|имя)\s+канала\s+(изменено|сменено|поменя)/i,
    /(изменил|сменил|поменял)\s+название\s+канала/i,
    /канал\s+переименован/i,
    /channel photo (was )?(changed|updated|removed)/i,
    /(сменил|изменил|обновил|удалил)\s+фото\s+канала/i,
    /(фото|аватар)\s+канала\s+(изменено|обновлено|удалено)/i,
    /channel (was )?created/i,
    /канал\s+создан/i,
    /(закрепил|открепил)\s+сообщени/i,
    /pinned ["«].*["»]/i
  ];
  for (const re of PATTERNS) {
    if (re.test(t)) return { is_system_event: true, skip_reason: 'telegram_service_message' };
  }
  // Very short metadata-only service line ("Channel name ...") with no sentence content.
  if (tl && tl.length < 60 && /(channel name|название канала|фото канала)/i.test(t)) {
    return { is_system_event: true, skip_reason: 'telegram_service_message' };
  }
  return { is_system_event: false, skip_reason: null };
}

// Avito "Ещё N фото" / image-count UI fragments are NOT listing titles.
function detectPlaceholderTitle(title) {
  const t = str(title);
  if (!t) return false;
  if (/ещё\s*\d+\s*фото/i.test(t)) return true;
  if (/ещ[её]\d+\s*фото/i.test(t)) return true;
  if (/^\s*\+?\d+\s*фото\s*$/i.test(t)) return true;
  if (/^\s*\d+\s*(фото|photos?|images?)\s*$/i.test(t)) return true;
  if (/^\s*показать\s+ещё/i.test(t)) return true;
  return false;
}

// A search-discovery card (Apify isDetail=false) is not a full listing.
function detectSearchCard(rec) {
  const isDetailRaw = rec.is_detail;
  const isDetail = (isDetailRaw === true || low(isDetailRaw) === 'true');
  const explicitFalse = (isDetailRaw === false || low(isDetailRaw) === 'false');
  const placeholder = detectPlaceholderTitle(rec.title || rec.title_raw);
  const noDesc = str(rec.description) === '';
  const noSeller = str(rec.seller_name || rec.profile_name) === '';
  const noDate = str(rec.published_at) === '';
  // Treat as a search card when detail is explicitly false, OR when it is missing the core listing evidence.
  const looksIncomplete = (placeholder || noDesc) && (noSeller || noDate);
  return { is_search_card: explicitFalse || (!isDetail && looksIncomplete), placeholder_title: placeholder, missing_description: noDesc, missing_seller_identity: noSeller, missing_published_at: noDate, is_detail: isDetail };
}

// Evidence completeness 0-100 + flags + detail_fetch_required.
function evidenceCompleteness(rec) {
  const flags = [];
  let score = 0;
  const text = str(rec.text_context || rec.text || rec.description);
  const title = str(rec.title || rec.title_raw);
  if (text.length >= 80) score += 30; else if (text.length >= 30) score += 15; else flags.push('missing_descriptions');
  if (str(rec.exact_evidence_url || rec.post_url || rec.listing_url || rec.source_url)) score += 20; else flags.push('missing_exact_evidence_url');
  if (str(rec.seller_name || rec.profile_name || rec.author_handle || rec.competitor_name)) score += 15; else flags.push('missing_seller_identity');
  if (str(rec.published_at)) score += 15; else flags.push('missing_published_at');
  if (title && !detectPlaceholderTitle(title)) score += 20; else if (detectPlaceholderTitle(title)) flags.push('placeholder_titles');
  const placeholder = detectPlaceholderTitle(title);
  const detail_fetch_required = placeholder || (text.length < 30) || flags.indexOf('missing_descriptions') >= 0;
  return { evidence_completeness_score: Math.min(100, score), flags: flags, detail_fetch_required: detail_fetch_required, placeholder_title: placeholder };
}

// ---------- semantic signal detectors (post-level evidence) ----------
const DIRECT_OFFER_SIGNALS = ['мы предлагаем', 'предлагаем', 'предлагает', 'предлага', 'поможем получить', 'поможем взять', 'поможем с кредит', 'оставьте заявк', 'оставляйте заявк', 'напишите', 'пишите в личк', 'в личку', 'свяжитесь', 'звоните', 'запишитесь на консультаци', 'без предоплаты', 'без справок', 'без поручител', 'в день обращения', 'за 1 день', 'решение за', 'до 15 000 000', 'до 15000000', 'кредитный брокер', 'ипотечный брокер', 'подбор банка', 'подберём банк', 'подберем банк', 'оплата за результат', 'комиссия от'];
const AMOUNT_RE = /(до\s*)?\d[\d  .,]{2,}\s*(₽|руб|млн|тыс)/i;
const CTA_SIGNALS = ['напишите', 'оставьте заявк', 'оставляйте заявк', 'свяжитесь', 'звоните', 'пишите в личк', 'в личку', 'запишитесь', 'жми', 'переходи по ссылке', 'зарегистрируйтесь', 'регистрируйтесь'];

function detectDirectOffer(text) {
  const t = low(text);
  const signals = hitTerms(t, DIRECT_OFFER_SIGNALS);
  const hasAmount = AMOUNT_RE.test(text);
  const hasCta = anyTerm(t, CTA_SIGNALS);
  return { is_offer: signals.length > 0 || (hasAmount && hasCta), signals: signals, has_amount: hasAmount, has_cta: hasCta };
}

const AFFILIATE_SIGNALS = ['партнёрск', 'партнерск', 'реферальн', 'реферал', 'приведи друг', 'за каждого заёмщик', 'за каждого заемщик', 'вознаграждение за', 'партнёрская программа', 'партнерская программа', 'агентское вознаграждение', 'ваша личная ссылка', 'персональная ссылка', 'зарегистрируйтесь и получ', 'реферальная ссылка', 'реферальную ссылку'];
function detectAffiliate(text) {
  const signals = hitTerms(low(text), AFFILIATE_SIGNALS);
  return { is_affiliate: signals.length > 0, signals: signals };
}

// Negation / quotation: a quoted scam claim is NOT an author offer.
function detectNegationQuote(text) {
  const t = str(text);
  const tl = low(t);
  const SCAM_MARKERS = ['это мошенничеств', 'мошенник', 'обман', 'развод', 'осторожн', 'не верьте', 'не ведитесь', 'схема обмана', 'будьте осторожн', 'остерегайтесь'];
  const scamHit = hitTerms(tl, SCAM_MARKERS);
  // claims that are typically quoted/scam: "удалим просрочки", "очистим кредитную историю за день"
  const CLAIM_MARKERS = ['удал[а-яё]* просрочк', 'очист[а-яё]* кредитн', 'удал[а-яё]* кредитн', 'за один день', 'за 1 день', 'сотр[её]м кредитн'];
  const quotedClaims = [];
  for (const re of CLAIM_MARKERS) {
    const m = new RegExp(re, 'i').exec(t);
    if (m) quotedClaims.push(m[0]);
  }
  const hasQuote = /[«"„].{3,}[»"“]/.test(t);
  const has_quoted_scam = scamHit.length > 0 && quotedClaims.length > 0;
  return { has_quoted_scam: has_quoted_scam, has_negation: scamHit.length > 0, quoted_claims: has_quoted_scam ? quotedClaims : [], scam_markers: scamHit, has_quote_marks: hasQuote };
}

// Owned-media competitor content: competitor-owned channel/domain discussing target services with an
// expertise funnel / CTA -> competitor_activity (owned_media_content / educational_offer), NOT market_signal.
function detectOwnedMedia(rec) {
  const text = str(rec.text_context || rec.text || rec.description);
  const tl = low(text);
  const ownedDomainHit = /da\.credit|t\.me\/[a-z0-9_]+|наш\s+канал|наш\s+сайт|наш\s+телеграм|подпишись на наш|на нашем канале|на нашем сайте|читайте в нашем/i.test(text);
  const linkOut = /https?:\/\/|t\.me\/|\.ru\b|\.credit\b/i.test(text);
  const expertiseFunnel = /разбира[а-яё]+|объясня[а-яё]+|рассказыва[а-яё]+|как (восстанов|подготов|получ)|инструкция|чек-лист|гайд|подробнее (по ссылке|в статье)|читайте в стать/i.test(tl);
  const targetService = /кредит|ипотек|рефинанс|кредитн[а-яё]* истори|после отказ|залог|займ/i.test(tl);
  const cta = detectDirectOffer(text).has_cta || /подпиш|переходи|читайте|жми|ссылк/i.test(tl);
  const is_owned_media = targetService && (ownedDomainHit || (linkOut && expertiseFunnel)) && (expertiseFunnel || cta);
  return { is_owned_media: is_owned_media, expertise_funnel: expertiseFunnel, owned_domain: ownedDomainHit };
}

// Market signal (external event: rate / regulation / program / demand shift) — NOT an owned offer.
function detectMarketSignal(text) {
  const t = low(text);
  let subtype = '';
  if (/ключевая ставка|ставку до|снизил[а-яё]* ставк|повысил[а-яё]* ставк|цб рф|центробанк|центральн[а-яё]* банк/.test(t)) subtype = 'central_bank_rate';
  else if (/сбп|система быстрых платеж|эквайринг.{0,20}регул|платёжн[а-яё]* регул|оплата по qr/.test(t)) subtype = 'payments_regulation';
  else if (/господдержк|госпрограмм|льготн[а-яё]* ипотек|семейн[а-яё]* ипотек|субсиди/.test(t)) subtype = 'program';
  else if (/(^|[^а-яё])закон(ы|а|е|ом|у)?([^а-яё]|$)|регулятор|поправк|постановлени|вступает в силу|вступил в силу/.test(t)) subtype = 'regulation';
  else if (/скоринг|ужесточ[а-яё]* (выдач|скоринг|требован)|смягч[а-яё]*/.test(t)) subtype = 'scoring_change';
  else if (/спрос (вырос|снизил|раст)|количество отказов вырос|выдач[а-яё]* (вырос|снизил)|тренд|статистик/.test(t)) subtype = 'demand_shift';
  return { is_market_signal: subtype !== '', market_signal_subtype: subtype || 'other' };
}

// ---------- explainable confidence ----------
// factors: object of booleans; caps: array of cap keys to apply (min). Returns score + reasons + caps applied.
function computeConfidence(factors, caps) {
  factors = factors || {};
  const reasons = [];
  let score = 35; reasons.push('base=35');
  const add = (cond, pts, label) => { if (cond) { score += pts; reasons.push('+' + pts + ' ' + label); } };
  add(factors.complete_text, 12, 'complete_text');
  add(factors.exact_evidence_url, 8, 'exact_evidence_url');
  add(factors.brand_mention, 8, 'brand_mention');
  add(factors.direct_offer_language, 12, 'direct_offer_language');
  add(factors.explicit_cta, 8, 'explicit_cta');
  add(factors.explicit_amount, 8, 'explicit_amount');
  add(factors.owned_domain, 6, 'owned_domain');
  add(factors.seller_identity, 6, 'seller_identity');
  add(factors.consistent_service, 5, 'consistent_service');
  if (factors.contradictory_evidence) { score -= 15; reasons.push('-15 contradictory_evidence'); }
  if (score > 95) { score = 95; }
  if (score < 1) score = 1;
  const caps_applied = [];
  (caps || []).forEach(function (capKey) {
    const cap = TAXONOMY.confidence_caps[capKey];
    if (typeof cap === 'number' && score > cap) { score = cap; caps_applied.push(capKey + '<=' + cap); }
  });
  return { confidence_score: Math.round(score), confidence_reasons: reasons.concat(caps_applied) };
}

// ---------- Stage D semantic validator ----------
// Validates a semantic-v2 object against evidence. Returns ok + semantic_flags + downgrade hint.
function semanticValidate(sem, evidenceText) {
  const flags = [];
  const ev = str(evidenceText || sem.offer_text);
  const rt = low(sem.record_type);
  if (TAXONOMY.record_type.indexOf(rt) < 0) flags.push('taxonomy_drift');
  // service taxonomy resolution
  if (sem.normalized_service_type && sem.normalized_service_type !== 'unknown' && TAXONOMY.service.indexOf(low(sem.normalized_service_type)) < 0) flags.push('taxonomy_drift');
  if (sem.service_unresolved === true) flags.push('taxonomy_drift');
  // competitor_activity requires competitor/offer evidence
  if (rt === 'competitor_activity') {
    const off = detectDirectOffer(ev);
    const aff = detectAffiliate(ev);
    const om = detectOwnedMedia({ text_context: ev });
    if (!off.is_offer && !aff.is_affiliate && !om.is_owned_media && !str(sem.competitor_name)) {
      flags.push('semantic_validation_failed');
    }
  }
  // market_signal must be an external event, not merely an owned offer
  if (rt === 'market_signal') {
    const ms = detectMarketSignal(ev);
    const off = detectDirectOffer(ev);
    if (!ms.is_market_signal && off.is_offer) flags.push('owned_media_misclassification');
  }
  // system_event can never become content idea / offer
  if (rt === 'system_event' && (str(sem.offer_text) || low(sem.entity_type) === 'content_idea')) flags.push('system_event_contamination');
  // quoted/negated scam claim cannot become author offer
  const nq = detectNegationQuote(ev);
  if (nq.has_quoted_scam && (str(sem.offer_text) && hitTerms(low(sem.offer_text), ['удал', 'очист', 'за день', 'за 1 день']).length)) {
    flags.push('semantic_validation_failed');
  }
  // amounts/terms must have evidence
  const terms = sem.offer_terms || {};
  const claimsAmount = terms.amount_max != null || terms.amount_min != null || str(terms.price_text) || str(terms.rate_text);
  if (claimsAmount && !AMOUNT_RE.test(ev) && !/%|ставк|руб|₽|млн|тыс/i.test(ev)) flags.push('semantic_validation_failed');
  // placeholder titles cannot produce high confidence
  if (sem.placeholder_title === true && (parseInt(sem.confidence_score, 10) || 0) > TAXONOMY.confidence_caps.placeholder_title) flags.push('placeholder_titles');
  // metadata-only contamination: claim of post service with no post text
  if (rt === 'competitor_activity' && str(sem.service_evidence_source) === 'source_metadata') flags.push('metadata_contamination');
  return { ok: flags.length === 0, semantic_flags: flags };
}

// ---------- freshness ----------
function freshness(publishedAt, nowIso, windowDays) {
  const win = windowDays || 30;
  const p = Date.parse(str(publishedAt));
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  if (isNaN(p)) return { age_days: null, freshness_bucket: 'unknown', within_default_window: false };
  const age = Math.floor((now - p) / 86400000);
  let bucket = 'fresh';
  if (age > win) bucket = 'stale'; else if (age > Math.floor(win / 2)) bucket = 'aging';
  return { age_days: age, freshness_bucket: bucket, within_default_window: age <= win };
}

// ---------- route mapper (deterministic; the model never names a sheet) ----------
function buildRoute(sem) {
  const norm = normalizeRecordType(sem.record_type);
  const rt = norm.value;
  let route = routeForRecordType(rt);
  // contact-safety override for the lead path: no results/contact route without a usable public contact.
  if (route === 'results' && !str(sem.contact_public)) route = 'review_queue';
  const report_eligible = reportEligibleByType(rt) && (sem.report_eligible !== false);
  return {
    record_type: rt,
    record_type_resolved: norm.resolved,
    entity_type: entityForRecordType(rt),
    legacy_entity_type: legacyEntityForRecordType(rt),
    route: route,
    report_eligible_by_type: reportEligibleByType(rt),
    report_eligible: report_eligible
  };
}

// ---------- classifyOffline(): deterministic evidence-based classifier ----------
// Free fixture/offline mode (§2.1 #8) AND the deterministic fallback after LLM failure. Produces a
// semantic-v2 object from POST/LISTING EVIDENCE ONLY. Hints are weak priors; post evidence wins.
function classifyOffline(rec, opts) {
  opts = opts || {};
  const text = str(rec.text_context || rec.text || rec.description);
  const title = str(rec.title || rec.title_raw);
  const blob = (title + ' ' + text + ' ' + str(rec.offer_text)).trim();
  const evUrl = str(rec.exact_evidence_url || rec.post_url || rec.listing_url || rec.source_url);
  const out = {
    schema_version: 'semantic-v2',
    record_type: 'unknown',
    entity_type: 'unknown',
    activity_subtype: null,
    competitor_related: false,
    competitor_name: str(rec.competitor_name || rec.seller_name || rec.profile_name),
    service_primary: 'unknown',
    service_secondary: [],
    market_signal_subtype: null,
    content_topics: [],
    pain_tags: [],
    offer_text: '',
    offer_terms: { amount_min: null, amount_max: null, currency: 'RUB', price_text: null, rate_text: null, speed_text: null, conditions: [], documents_not_required: [] },
    cta: null,
    quoted_claims: [],
    negated_claims: [],
    hard_skip: false,
    skip_reason: null,
    confidence_score: 1,
    confidence_reasons: [],
    semantic_flags: [],
    evidence: [],
    exact_evidence_url: evUrl,
    placeholder_title: false,
    classified_by: 'offline_deterministic'
  };

  // Stage A.1: system event -> hard skip, no LLM, no classification.
  const sysev = detectSystemEvent(blob);
  if (sysev.is_system_event) {
    out.record_type = 'system_event'; out.entity_type = 'system_event'; out.hard_skip = true;
    out.skip_reason = sysev.skip_reason; out.confidence_score = 1; out.semantic_flags = ['system_event'];
    out.confidence_reasons = ['system_event: skip not classification'];
    out.route = 'skipped_log'; out.report_eligible = false; out.llm_eligible = false;
    return out;
  }

  const compl = evidenceCompleteness(rec);
  out.placeholder_title = compl.placeholder_title;
  // Search-card detection is an Avito/classifieds concept (isDetail). Only apply it there.
  const isClassified = (low(rec.source_type) === 'classified') || (low(rec.platform) === 'avito');
  const card = detectSearchCard(rec);

  // Stage A.2: incomplete Avito search card / placeholder -> degraded source_candidate, needs detail.
  if (compl.placeholder_title || (isClassified && card.is_search_card)) {
    out.record_type = 'source_candidate'; out.entity_type = 'source_candidate';
    out.detail_fetch_required = true; out.report_eligible = false; out.llm_eligible = false;
    out.route = 'review_queue';
    out.skip_reason = compl.placeholder_title ? 'placeholder_title' : 'search_card_no_detail';
    out.semantic_flags = [].concat(compl.placeholder_title ? ['placeholder_titles'] : ['search_cards_only']);
    const caps = [compl.placeholder_title ? 'placeholder_title' : 'search_card_no_detail'];
    const conf = computeConfidence({ exact_evidence_url: !!evUrl }, caps);
    out.confidence_score = conf.confidence_score; out.confidence_reasons = conf.confidence_reasons;
    return out;
  }

  // Negation / quoted scam — must not become an author offer.
  const nq = detectNegationQuote(blob);
  if (nq.has_quoted_scam) { out.quoted_claims = nq.quoted_claims; out.negated_claims = nq.quoted_claims; }

  const offer = detectDirectOffer(blob);
  const aff = detectAffiliate(blob);
  const om = detectOwnedMedia(rec);
  const ms = detectMarketSignal(blob);
  const serviceText = blob;
  const svcDerived = deriveServiceFromText(serviceText);

  // confidence factors shared by branches
  const factors = {
    complete_text: text.length >= 80,
    exact_evidence_url: !!evUrl,
    brand_mention: !!str(out.competitor_name),
    direct_offer_language: offer.is_offer,
    explicit_cta: offer.has_cta,
    explicit_amount: offer.has_amount,
    owned_domain: om.owned_domain,
    seller_identity: !!str(rec.seller_name || rec.profile_name),
    consistent_service: svcDerived !== 'unknown'
  };
  const caps = [];
  if (compl.flags.indexOf('missing_descriptions') >= 0) caps.push('missing_description');

  // Audience signals (questions/objections/complaints/buying intent) — only when it reads as an audience voice.
  const isAudience = (low(rec.source_type) === 'public_discussion') || (low(rec.touchpoint_type).indexOf('question') >= 0) || (low(rec.record_type_hint).indexOf('question') >= 0) || (low(rec.record_type_hint).indexOf('audience') >= 0);

  function finalizeService(primary) {
    const n = normalizeService(primary || svcDerived, serviceText);
    out.service_primary = n.normalized_service_type;
    out.raw_model_service_type = n.raw_model_service_type;
    out.service_unresolved = n.unresolved;
    if (n.unresolved) { out.semantic_flags.push('taxonomy_drift'); caps.push('unresolved_taxonomy_alias'); }
  }

  // Branch 1: affiliate program (strong, overrides market keywords).
  if (aff.is_affiliate) {
    out.record_type = 'competitor_activity'; out.activity_subtype = 'affiliate_program'; out.competitor_related = true;
    out.offer_text = title || blob.substring(0, 200);
    finalizeService(svcDerived);
    const conf = computeConfidence(factors, caps); out.confidence_score = conf.confidence_score; out.confidence_reasons = conf.confidence_reasons;
    if (evUrl) out.evidence.push({ field: 'record_type', quote: aff.signals[0] || 'affiliate', source: 'post_text' });
    return finalize(out, blob);
  }

  // Branch 2: owned-media competitor content (broker-owned channel/domain explaining a service).
  if (om.is_owned_media && !ms.is_market_signal) {
    out.record_type = 'competitor_activity';
    out.activity_subtype = offer.is_offer ? 'educational_offer' : 'owned_media_content';
    out.competitor_related = true; out.offer_text = title || blob.substring(0, 200);
    finalizeService(svcDerived === 'unknown' ? 'credit_history_consulting' : svcDerived);
    const conf = computeConfidence(factors, caps); out.confidence_score = conf.confidence_score; out.confidence_reasons = conf.confidence_reasons;
    return finalize(out, blob);
  }

  // Branch 3: direct competitor offer (overrides broad market keywords).
  if (offer.is_offer && !isAudience) {
    out.record_type = 'competitor_activity'; out.competitor_related = true;
    out.activity_subtype = om.expertise_funnel ? 'educational_offer' : 'direct_offer';
    out.offer_text = title || blob.substring(0, 240);
    if (offer.has_amount) { const m = blob.match(AMOUNT_RE); if (m) { out.offer_terms.price_text = m[0]; out.evidence.push({ field: 'offer_terms.price_text', quote: m[0], source: 'post_text' }); } }
    if (/без справок/i.test(blob)) out.offer_terms.documents_not_required.push('income_certificate');
    if (/без поручител/i.test(blob)) out.offer_terms.documents_not_required.push('guarantor');
    if (/в день обращения|за 1 день|решение за/i.test(blob)) out.offer_terms.speed_text = 'same day';
    if (offer.has_cta) out.cta = { type: 'channel_message', text: '' };
    finalizeService(svcDerived);
    const conf = computeConfidence(factors, caps); out.confidence_score = conf.confidence_score; out.confidence_reasons = conf.confidence_reasons;
    if (evUrl) out.evidence.push({ field: 'exact_evidence_url', quote: evUrl, source: 'metadata' });
    return finalize(out, blob);
  }

  // Branch 4: audience signal.
  if (isAudience) {
    const tl = low(blob);
    if (/(жалоб|обманул|не вернул|развод|кошмар|ужас|肯)/.test(tl)) out.record_type = 'audience_complaint';
    else if (/(дорого|невыгодн|не доверя|сомнева|боюсь|а вдруг|почему так|не уверен)/.test(tl)) out.record_type = 'audience_objection';
    else if (/(нужен кредит|ищу кредит|где взять|подскажите банк|оформить|готов взять|хочу взять)/.test(tl)) out.record_type = 'buying_intent';
    else out.record_type = 'audience_question';
    out.entity_type = entityForRecordType(out.record_type);
    finalizeService(svcDerived);
    const conf = computeConfidence(factors, caps); out.confidence_score = conf.confidence_score; out.confidence_reasons = conf.confidence_reasons;
    return finalize(out, blob);
  }

  // Branch 5: market signal (external event).
  if (ms.is_market_signal) {
    out.record_type = 'market_signal'; out.market_signal_subtype = ms.market_signal_subtype;
    out.content_topics = [ms.market_signal_subtype];
    const m = blob.match(/(\d{1,2}(?:[.,]\d)?)\s*%/);
    if (ms.market_signal_subtype === 'central_bank_rate') {
      const rates = blob.match(/(\d{1,2}(?:[.,]\d)?)/g);
      if (rates && rates.length >= 2) out.offer_terms.rate_text = rates[0] + ' -> ' + rates[1];
    }
    finalizeService(svcDerived === 'credit_brokerage' ? 'unknown' : svcDerived);
    const conf = computeConfidence(factors, caps); out.confidence_score = conf.confidence_score; out.confidence_reasons = conf.confidence_reasons;
    return finalize(out, blob);
  }

  // Branch 6: hard negative / irrelevant.
  const HARD_NEG = ['юридический адрес', 'регистрация ооо', 'регистрация ип', 'бухгалтер', 'эквайринг', 'pos-терминал', 'касса', 'печать', 'штамп', 'эцп', 'коворкинг'];
  if (anyTerm(blob, HARD_NEG) && svcDerived === 'unknown') {
    out.record_type = 'irrelevant'; out.entity_type = 'irrelevant'; out.hard_skip = true; out.skip_reason = 'hard_negative';
    out.route = 'skipped_log'; out.report_eligible = false; out.llm_eligible = false;
    out.confidence_score = 1; out.confidence_reasons = ['hard_negative']; return out;
  }

  // Branch 7: unknown -> review.
  out.record_type = 'unknown'; out.entity_type = 'unknown';
  finalizeService(svcDerived);
  const conf = computeConfidence(factors, caps); out.confidence_score = Math.min(conf.confidence_score, 50);
  out.confidence_reasons = conf.confidence_reasons.concat(['unknown<=50']);
  out.semantic_flags.push('pending_review');
  return finalize(out, blob);
}

function finalize(out, blob) {
  // service_secondary = every supported service except the chosen primary.
  if (out.service_primary && out.service_primary !== 'unknown') {
    const all = deriveAllServices(blob);
    out.service_secondary = all.filter(function (s) { return s !== out.service_primary; });
  }
  const r = buildRoute(out);
  out.record_type = r.record_type;
  out.entity_type = entityForRecordType(out.record_type);
  out.legacy_entity_type = r.legacy_entity_type;
  out.route = r.route;
  if (out.report_eligible === undefined) out.report_eligible = r.report_eligible;
  if (out.llm_eligible === undefined) out.llm_eligible = !out.hard_skip;
  out.competitor_related = (out.record_type === 'competitor_activity');
  const val = semanticValidate(out, blob);
  out.semantic_flags = Array.from(new Set(out.semantic_flags.concat(val.semantic_flags)));
  if (!val.ok && out.semantic_flags.indexOf('semantic_validation_failed') >= 0) {
    if (out.confidence_score > 50) out.confidence_score = 50;
  }
  return out;
}

module.exports = {
  TAXONOMY,
  str, low, has, anyTerm, hitTerms, clampScore,
  normalizeRecordType, normalizeEntityType, normalizeService, deriveServiceFromText,
  routeForRecordType, entityForRecordType, legacyEntityForRecordType, reportEligibleByType,
  detectSystemEvent, detectPlaceholderTitle, detectSearchCard, evidenceCompleteness,
  detectDirectOffer, detectAffiliate, detectNegationQuote, detectOwnedMedia, detectMarketSignal,
  computeConfidence, semanticValidate, freshness, buildRoute, classifyOffline, deriveAllServices
};
