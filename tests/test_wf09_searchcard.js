// test_wf09_searchcard.js — Stage C Closure Patch 3 (audit S3-D21). Direct production-node proof that a
// real-shaped Avito search-card / placeholder control is quarantined (never accepted as a market offer)
// and never enters offer/price/competitor evidence or the downstream raw_market_records competitor path.
// Runs the REAL WF09 nodes. $0, no network, no live actor.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('09_avito_classifieds_listing_connector.json');
const run = H.makeRun();
const cfg = H.runCodeNode(run, wf, 'Set Avito Connector Config', [])[0].json;
cfg.fixture_mode = false; // exercise LIVE classification semantics (report_eligible reflects live)
run.outputs['Set Avito Connector Config'] = [{ json: cfg }];

const q = cfg.query_plan[0];
// Production-shaped SEARCH CARD: not a detail page, placeholder-style title, no seller/description/date.
const searchCard = { listing_id: '', isDetail: false, title: 'Ещё 5 фото', description: '', url: 'https://www.avito.ru/moskva/predlozheniya_uslug?q=' + encodeURIComponent(q.search_query), price: '', location: 'Москва', seller_name: '', published_at: '', category: 'Предложения услуг', query: q.search_query, parentSourceUrl: q.source_search_url };
// Contrast: a real DETAIL competitor listing.
const realListing = { listing_id: '4379480780', isDetail: true, title: 'Кредитный брокер. Помощь в получении кредита', description: 'Поможем получить кредит после отказов банков, работаем по договору, оплата за результат.', url: 'https://www.avito.ru/moskva/predlozheniya_uslug/kreditnyy_broker_4379480780', price: 'от 30 000 ₽', location: 'Москва', seller_name: 'Финанс Групп', published_at: '2026-06-12', category: 'Предложения услуг', query: q.search_query, parentSourceUrl: q.source_search_url };

const normalized = H.runCodeNode(run, wf, 'Normalize Avito Listings', [searchCard, realListing].map(j => ({ json: j }))).map(i => i.json);
const card = normalized.find(r => /search\?q=/.test(r.source_url) || r.touchpoint_type === 'search_card');
const real = normalized.find(r => String(r.source_url).indexOf('4379480780') >= 0);

A.section('WF09 — search card is quarantined, never a competitor offer (S3-D21)');
A.ok('search-card row found', !!card);
A.eq('record_type_hint = source_candidate (NOT competitor_activity)', card.record_type_hint, 'source_candidate');
A.eq('touchpoint_type = search_card', card.touchpoint_type, 'search_card');
A.eq('predicted_route = review_queue (NOT monitor_queue)', card.predicted_route, 'review_queue');
A.eq('detail_fetch_required = true', card.detail_fetch_required, true);
A.eq('detail_fetch_status = not_run', card.detail_fetch_status, 'not_run');
A.ok('not a competitor entity', card.predicted_entity_type !== 'competitor');
A.ok('competitor_related is not true', card.competitor_related !== true);
A.ok('quality_status quarantined/degraded (not healthy)', card.quality_status === 'degraded' || card.quality_status === 'quarantined');
A.eq('report_eligible = false (live)', card.report_eligible, false);
A.eq('llm_eligible = false', card.llm_eligible, false);
A.ok('explicit search-card reason recorded', /search_card_no_detail/.test(card.relevance_reason));
A.ok('no fabricated offer text formed', !card.offer_text || /search card|detail-enrichment|offer не сформирован/i.test(String(card.offer_text || card.offer_summary || '')));

A.section('WF09 — the real detail listing still classifies as a competitor offer (control)');
A.eq('real record_type_hint = competitor_activity', real.record_type_hint, 'competitor_activity');
A.eq('real predicted_route = monitor_queue', real.predicted_route, 'monitor_queue');
A.eq('real report_eligible = true (live, detail)', real.report_eligible, true);

A.section('WF09 — search card excluded from offer/price/competitor evidence downstream');
H.inject(run, 'Read market_record_registry', []);
const deduped = H.runCodeNode(run, wf, 'Deduplicate Listings', normalized.map(j => ({ json: j }))).map(i => i.json);
const dedupCard = deduped.find(r => r.touchpoint_type === 'search_card');
const dedupReal = deduped.find(r => String(r.source_url).indexOf('4379480780') >= 0);
A.ok('search card not counted as a competitor offer after dedup', dedupCard && dedupCard.record_type_hint === 'source_candidate' && dedupCard.competitor_related !== true);
A.ok('real listing remains a competitor offer', dedupReal && dedupReal.record_type_hint === 'competitor_activity');
// Build raw_market_records and prove the offer/competitor evidence comes only from real detail listings.
const raw = H.runCodeNode(run, wf, 'Build raw_market_records Rows', deduped.map(j => ({ json: j }))).map(i => i.json);
const rawCompetitorOffers = raw.filter(r => r.competitor_related === true || r.record_type_hint === 'competitor_activity');
A.ok('no search card appears as a raw competitor offer', rawCompetitorOffers.every(r => r.touchpoint_type !== 'search_card'));
A.ok('query origin preserved on the search card', card.search_query === q.search_query || card.query === q.search_query);

A.report('wf09-searchcard');
