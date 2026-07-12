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
A.ok('reason cites the provider service evidence', /признаки коммерческой услуги/.test(comp.classification_reason));

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

A.section('discovery_query — Firecrawl Search request/response glue + candidate normalization');
const TS = require('../n8n/lib/tracked_sources.js');
const body = Q.buildFirecrawlSearchBody({ query_text: 'site:t.me/s "кредит под ПТС" Москва', max_results: 8 });
A.eq('search body query', body.query, 'site:t.me/s "кредит под ПТС" Москва');
A.eq('search body limit clamped', body.limit, 8);
A.eq('search body sources=web', body.sources.join(','), 'web');
const resp = { success: true, data: { web: [
  { url: 'https://t.me/s/broker_pts', title: 'Кредит под ПТС', description: 'Автоломбард' },
  { url: 'https://t.me/s/broker_pts', title: 'dup', description: 'dup' },
  { url: 'https://example.com/x', title: 'off-platform', description: 'web' },
  { url: 'https://t.me/+secretinvite', title: 'invite', description: 'private' }
] } };
const results = Q.parseFirecrawlSearchResults(resp);
A.eq('parses 4 raw results', results.length, 4);
const cands = Q.candidatesFromResults(results, { platform_target: 'telegram' }, TS.normalizeSourceRef);
A.eq('telegram candidates: dedup + drop off-platform + drop invite = 1', cands.length, 1);
A.eq('normalized handle', cands[0].display_name, '@broker_pts');
A.eq('key matches tracked_sources', cands[0].normalized_key, 'telegram_channel::broker_pts');
const webResp = [{ url: 'https://finardi.ru/', title: 'Финарди', description: 'брокер' }, { url: 'https://t.me/s/x', title: 'tg', description: '' }];
const webCands = Q.candidatesFromResults(Q.parseFirecrawlSearchResults({ success: true, data: webResp }), { platform_target: 'website' }, TS.normalizeSourceRef);
A.eq('website mode drops t.me, keeps finardi', webCands.length, 1);
A.ok('website candidate key is website::', webCands[0].normalized_key.indexOf('website::finardi.ru') === 0, webCands[0].normalized_key);
A.eq('malformed search response -> [] (fail safe)', Q.parseFirecrawlSearchResults('not json').length, 0);
A.eq('success:false -> [] ', Q.parseFirecrawlSearchResults({ success: false }).length, 0);

A.section('discovery_query — candidate URL hygiene (clean canonical source_url, no query/fragment/mobile prefix)');
const tgDirty = Q.candidatesFromResults([{ url: 'https://t.me/s/avtosebe?before=23717', title: 'Автоломбард', description: 'займ под ПТС' }], { platform_target: 'telegram' }, TS.normalizeSourceRef);
A.eq('telegram source_url stripped of /s/ and ?before=', tgDirty[0].source_url, 'https://t.me/avtosebe');
const vkDirty = Q.candidatesFromResults([{ url: 'https://m.vk.com/rosavtodengi?offset=10&own=0', title: 'Автоденьги', description: 'займ под ПТС' }], { platform_target: 'vk' }, TS.normalizeSourceRef);
A.eq('vk source_url normalized (no m. / no query)', vkDirty[0].source_url, 'https://vk.com/rosavtodengi');

A.section('discovery_query — VK junk paths rejected (wall/photo/personal id are not communities)');
const vkJunk = Q.candidatesFromResults([
  { url: 'https://vk.com/wall-154046029_18261', title: 'x', description: 'кредит под ПТС' },
  { url: 'https://m.vk.com/photo-162799537_456239017?rev=1', title: 'x', description: 'автоломбард' },
  { url: 'https://vk.com/id535931446', title: 'x', description: 'займ под ПТС' },
  { url: 'https://vk.com/ptszaim1', title: 'ПТС Займ', description: 'автоломбард' }
], { platform_target: 'vk' }, TS.normalizeSourceRef);
A.eq('only the real community survives (wall/photo/id dropped)', vkJunk.map(c => c.normalized_key).join(','), 'vk_community::ptszaim1');

A.section('discovery_query — search/marketplace/Avito hosts dropped in website mode');
const webDrop = Q.candidatesFromResults([
  { url: 'https://yandex.ru/search/?text=автоломбард', title: 'Яндекс', description: 'автоломбард Москва' },
  { url: 'https://2gis.ru/moscow/автоломбард', title: '2ГИС', description: 'автоломбард' },
  { url: 'https://www.avito.ru/moskva/avtomobili', title: 'Авито', description: 'автоломбард' },
  { url: 'https://carmoney.ru/', title: 'CarMoney', description: 'займ под ПТС автоломбард' }
], { platform_target: 'website' }, TS.normalizeSourceRef);
A.eq('yandex/2gis/avito dropped, carmoney kept', webDrop.map(c => c.host).join(','), 'carmoney.ru');
A.ok('Avito never appears as a candidate', webDrop.every(c => !/avito/i.test(c.source_url + c.normalized_key)));

A.section('candidate_classifier — aggregator/media host is never a competitor (snippet has query terms)');
const aggr = C.classifyCandidate({ title: 'Автоломбард Москва — рейтинг', description: 'Поможем получить кредит под ПТС, автоломбард, оставьте заявку', platform: 'website', host: 'moskva.vbr.ru' });
A.eq('vbr.ru forced to news_or_aggregator (not competitor)', aggr.is_competitor, false);
A.eq('vbr.ru category', aggr.category, 'news_or_aggregator');
const aggr2 = C.classifyCandidate({ title: 'Автоломбарды — отзывы', description: 'помощь в получении кредита, автоломбард, оставьте заявку', platform: 'website', url: 'https://www.banki.ru/products/' });
A.eq('banki.ru (via url) not a competitor', aggr2.is_competitor, false);
const realComp = C.classifyCandidate({ title: 'Автоломбард', description: 'Поможем получить кредит под ПТС без предоплаты, оставьте заявку', platform: 'website', host: 'carmoney.ru' });
A.eq('a real provider host still classifies as competitor', realComp.is_competitor, true);

A.section('DISCOVERY-005 — region fit (Moscow query penalizes other cities)');
A.eq('normalizeQueryRegion Москва -> moscow', C.normalizeQueryRegion('Москва'), 'moscow');
A.eq('normalizeQueryRegion МО -> moscow', C.normalizeQueryRegion('МО'), 'moscow');
A.eq('Moscow query + Moscow evidence = match', C.regionFit('moscow', 'автоломбард москва химки').region_match, 'match');
A.eq('Moscow query + Novosibirsk evidence = mismatch', C.regionFit('moscow', 'автоломбард новосибирск').region_match, 'mismatch');
A.eq('Moscow query + no region = unknown', C.regionFit('moscow', 'автоломбард займ под птс').region_match, 'unknown');
const inMsk = C.classifyCandidate({ title: 'Автоломбард Москва', description: 'займ под ПТС, оставьте заявку. Москва', platform: 'website', host: 'zalog24h.ru', query_region: 'Москва' });
const inNsk = C.classifyCandidate({ title: 'Автоломбард Новосибирск', description: 'займ под ПТС, оставьте заявку. Новосибирск', platform: 'website', host: 'a.ru', query_region: 'Москва' });
A.eq('in-region competitor region_match=match', inMsk.region_match, 'match');
A.eq('out-of-region competitor region_match=mismatch', inNsk.region_match, 'mismatch');
A.ok('region mismatch is strongly penalized in confidence', inMsk.confidence - inNsk.confidence >= 40, 'msk=' + inMsk.confidence + ' nsk=' + inNsk.confidence);
// DISCOVERY-006 region accuracy: a transliterated VK/Telegram handle naming another city is a MISMATCH even when
// the noisy scraped page body mentions the query city (the live Barnaul-as-Moscow bug).
const barnaulHandle = C.classifyCandidate({ title: 'Займы под ПТС', description: 'автоломбард', content: 'Работаем по всей России. Москва, оставьте заявку.', platform: 'vk', normalized_key: 'vk_community::zaimypodzalogavtoiptsbarnaul', display_name: 'vk.com/zaimypodzalogavtoiptsbarnaul', url: 'https://vk.com/zaimypodzalogavtoiptsbarnaul', query_region: 'Москва', validated: true });
A.eq('barnaul handle beats Moscow body text -> mismatch', barnaulHandle.region_match, 'mismatch');
A.ok('barnaul reason names the real city', /Барнаул/.test(barnaulHandle.region_reason));
A.eq('regionFitPrioritized trusts identity over body', C.regionFitPrioritized('moscow', 'avtolombard nsk novosibirsk', 'москва москва').region_match, 'mismatch');
A.eq('regionFitPrioritized: clean body match', C.regionFitPrioritized('moscow', 'autolombard', 'москва подольск').region_match, 'match');
A.eq('regionFitPrioritized: ambiguous body -> unknown', C.regionFitPrioritized('moscow', 'autolombard', 'москва новосибирск').region_match, 'unknown');

A.section('DISCOVERY-005 — component scoring produces varied confidence (not flat 64)');
A.ok('confidence is 0..100', inMsk.confidence >= 0 && inMsk.confidence <= 100);
A.ok('score_components present', inMsk.score_components && typeof inMsk.score_components.service_evidence === 'number' && inMsk.score_components.region === 18);
const val = C.classifyCandidate({ title: 'Автоломбард Москва', description: 'займ под ПТС, автоломбард, оставьте заявку, бесплатная консультация, работаем по договору. Москва', platform: 'website', host: 'zalog24h.ru', query_region: 'Москва', validated: true });
A.ok('validated evidence scores higher than snippet-only', val.confidence > inMsk.confidence, 'val=' + val.confidence + ' snippet=' + inMsk.confidence);
A.eq('validated flag echoed', val.validated, true);
A.ok('three distinct providers give three distinct scores', new Set([inMsk.confidence, inNsk.confidence, val.confidence]).size === 3, [inMsk.confidence, inNsk.confidence, val.confidence].join(','));

A.section('DISCOVERY-005 — ranking + add policy (region-aware, validated-only)');
const ranked2 = C.rankCandidates([inNsk, val, aggr]);
A.eq('in-region validated competitor ranks first', ranked2.ranked[0].host, 'zalog24h.ru');
A.eq('aggregator is bucketed separately (not a competitor)', ranked2.aggregators.length, 1);
A.ok('add policy: validated in-region competitor is eligible', C.addEligible(val, { min_confidence: 60 }).ok === true);
const valNsk = C.classifyCandidate({ title: 'Автоломбард Новосибирск', description: 'займ под ПТС, автоломбард, оставьте заявку. Новосибирск', platform: 'website', host: 'b.ru', query_region: 'Москва', validated: true });
A.ok('add policy: validated region mismatch rejected', C.addEligible(valNsk, { min_confidence: 60 }).ok === false && /регион/.test(C.addEligible(valNsk, {}).reason));
A.ok('add policy: unvalidated competitor rejected', C.addEligible(inMsk, { min_confidence: 60 }).ok === false && /подтвержд/.test(C.addEligible(inMsk, {}).reason));
A.ok('add policy: aggregator rejected', C.addEligible(aggr, {}).ok === false);

A.report('discovery-libs');
