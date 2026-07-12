'use strict';
// test_discovery_libs.js — DISCOVERY-001/002: deterministic query expansion + candidate classification.
const A = require('./_assert');
const Q = require('../n8n/lib/discovery_query.js');
const C = require('../n8n/lib/candidate_classifier.js');

const ALLOW = ['website', 'telegram', 'vk'];

A.section('discovery_query — product detection from RU text');
A.eq('ПТС -> pts_loan', Q.detectProduct('конкуренты по ПТС Москва'), 'pts_loan');
A.eq('автоломбард -> pts_loan', Q.detectProduct('найди автоломбарды в москве'), 'pts_loan');
A.eq('ипотека -> mortgage_brokerage', Q.detectProduct('ипотечные брокеры Москва'), 'mortgage_brokerage');
A.eq('залог недвижимости -> real_estate_secured_loan', Q.detectProduct('кредит под залог недвижимости'), 'real_estate_secured_loan');
A.eq('после отказов -> credit_after_refusals', Q.detectProduct('кредит после отказов'), 'credit_after_refusals');
A.eq('generic -> credit_brokerage', Q.detectProduct('найди кредитных брокеров'), 'credit_brokerage');

A.section('discovery_query — platform detection (explicit + allowlist-gated, never Avito)');
A.eq('"в тг" -> telegram only', Q.detectPlatforms('найди конкурентов по ПТС в тг', { allowlist: ALLOW }).join(','), 'telegram');
A.eq('"VK сообщества" -> vk only', Q.detectPlatforms('найди VK сообщества по кредитам', { allowlist: ALLOW }).join(','), 'vk');
A.eq('"сайты" -> website only', Q.detectPlatforms('найди сайты конкурентов', { allowlist: ALLOW }).join(','), 'website');
A.eq('no platform -> all allowlisted', Q.detectPlatforms('найди новых конкурентов', { allowlist: ['website', 'telegram'] }).sort().join(','), 'telegram,website');
A.ok('avito never a discovery target', Q.detectPlatforms('найди на авито', { allowlist: ['website', 'telegram', 'avito'] }).indexOf('avito') < 0);

A.section('discovery_query — telegram discovery for ПТС Москва (bounded, site:t.me/s, synonyms)');
const tg = Q.buildDiscoveryQueries({ text: 'найди конкурентов по ПТС Москва в тг', region: 'Москва/МО', allowlist: ALLOW });
A.ok('3-5 telegram queries', tg.length >= 3 && tg.length <= 5, 'n=' + tg.length);
A.ok('all telegram-targeted', tg.every(q => q.platform_target === 'telegram'));
A.ok('all use site:t.me/s', tg.every(q => q.query_text.indexOf('site:t.me/s') === 0));
A.ok('region shortened to Москва (not Москва/МО)', tg.every(q => q.query_text.indexOf('Москва') >= 0 && q.query_text.indexOf('Москва/МО') < 0));
A.ok('includes "кредит под ПТС"', tg.some(q => q.query_text.indexOf('"кредит под ПТС"') >= 0));
A.ok('includes "автоломбард"', tg.some(q => q.query_text.indexOf('"автоломбард"') >= 0));
A.ok('each query bounded max_results 5-10', tg.every(q => q.max_results >= 5 && q.max_results <= 10));
A.ok('each query names firecrawl_search provider + a reason', tg.every(q => q.provider === 'firecrawl_search' && q.reason.length > 0));

A.section('discovery_query — vk + website site filters');
A.ok('vk uses site:vk.com', Q.buildDiscoveryQueries({ text: 'найди vk сообщества по автоломбард', region: 'Москва', allowlist: ALLOW }).every(q => q.query_text.indexOf('site:vk.com') === 0));
const web = Q.buildDiscoveryQueries({ text: 'найди сайты конкурентов по кредиту под ПТС Москва', region: 'Москва', allowlist: ALLOW });
A.ok('website discovery has NO site: filter', web.every(q => q.query_text.indexOf('site:') < 0));
A.ok('website query still quotes the product phrase', web.some(q => /"кредит под ПТС"/.test(q.query_text)));

A.section('discovery_query — dedup + cost projection');
const all = Q.buildDiscoveryQueries({ text: 'найди новых конкурентов', region: 'Москва', allowlist: ALLOW, max_variants: 4 });
A.ok('no duplicate query_text', new Set(all.map(q => q.platform_target + q.query_text)).size === all.length);
const proj = Q.projectDiscoveryCost(all, { cost_search_usd: 0.01 });
A.eq('cost = per-call * queries', proj.projected_cost_usd, Math.round(0.01 * all.length * 1000) / 1000);
A.eq('search_calls counted', proj.search_calls, all.length);
A.eq('unknown per-call -> unknown cost', Q.projectDiscoveryCost(all, {}).cost_status, 'unknown');

A.section('candidate_classifier — competitor (offer + CTA)');
const comp = C.classifyCandidate({ title: 'Кредитный брокер Москва', description: 'Поможем получить кредит под ПТС без предоплаты, оплата за результат. Оставьте заявку на бесплатную консультацию.', platform: 'telegram' });
A.ok('is_competitor', comp.is_competitor && comp.category === 'competitor');
A.ok('confidence high', comp.confidence >= 70, 'conf=' + comp.confidence);
A.ok('reason cites the provider offer', /поставщик услуги/.test(comp.classification_reason));

A.section('candidate_classifier — lead-source (audience questions, no offer)');
const lead = C.classifyCandidate({ title: 'Займы и кредиты — обсуждение', description: 'Подскажите, кто брал займ под ПТС? Реально ли получить кредит после отказов? Ищу совет.', platform: 'vk' });
A.ok('is_lead_source not competitor', lead.is_lead_source && !lead.is_competitor && lead.category === 'lead_source');

A.section('candidate_classifier — news/aggregator + content-creator + irrelevant');
const news = C.classifyCandidate({ title: 'Финансовые новости', description: 'ЦБ РФ сохранил ключевую ставку. Обзор рынка, статистика выдач, прогноз аналитиков.', platform: 'telegram' });
A.ok('news_or_aggregator', news.is_news_or_aggregator && !news.is_competitor);
const edu = C.classifyCandidate({ title: 'Про финансы просто', description: 'Как получить кредит: разбор, лайфхаки, финансовая грамотность. Объясняю простыми словами.', platform: 'telegram' });
A.ok('content_creator (edu, no offer)', edu.is_content_creator && !edu.is_competitor);
const irr = C.classifyCandidate({ title: 'Мемы и котики', description: 'Смешные картинки каждый день', platform: 'telegram' });
A.ok('irrelevant (no finance context)', irr.category === 'irrelevant' && !irr.is_competitor);
const spam = C.classifyCandidate({ title: 'Кредит', description: 'ставки на спорт и казино, заработок в интернете без вложений', platform: 'telegram' });
A.ok('spam -> irrelevant', spam.category === 'irrelevant');

A.section('candidate_classifier — a bank/MFO is NOT auto a broker competitor without a broker offer');
const bank = C.classifyCandidate({ title: 'Банк новости', description: 'кредит наличными, ставка от 5%, вклады и карты', platform: 'telegram' });
A.ok('bank ad copy without broker offer is not a high-confidence broker competitor', bank.confidence < 70 || !bank.is_competitor, 'cat=' + bank.category + ' conf=' + bank.confidence);

A.section('candidate_classifier — ranking splits competitors first');
const ranked = C.rankCandidates([lead, comp, news, edu]);
A.eq('competitor ranked first', ranked.ranked[0].category, 'competitor');
A.eq('competitors bucket has the competitor', ranked.competitors.length, 1);
A.eq('lead_sources bucket has the lead source', ranked.lead_sources.length, 1);

A.report('discovery-libs');
