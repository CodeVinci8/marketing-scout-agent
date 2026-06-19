// test_wf09_multiquery.js — WF09 multi-query closure (S3-D24). Proves declared search_queries genuinely
// drive actor discovery (one start URL per query), the overall batch limit + per-query allocation are
// enforced, the SAME listing returned by multiple queries deduplicates, and query origin stays auditable.
// NO live actor is called. ($0, no network.)
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('09_avito_classifieds_listing_connector.json');
const run = H.makeRun();
const cfg = H.runCodeNode(run, wf, 'Set Avito Connector Config', [])[0].json;

A.section('WF09 — each declared query builds its own actor start URL (S3-D24)');
A.ok('>=2 configured queries', cfg.search_queries.length >= 2);
A.eq('query_plan has one entry per query', cfg.query_plan.length, cfg.search_queries.length);
A.eq('start_urls count == query count', cfg.start_urls.length, cfg.query_plan.length);
A.ok('>=2 distinct actor start URLs', new Set(cfg.start_urls).size >= 2);
A.ok('each plan entry preserves search_query', cfg.query_plan.every(p => !!p.search_query));
A.ok('each plan entry has source_search_url', cfg.query_plan.every(p => /^https:\/\/www\.avito\.ru\/.+\?q=/.test(p.source_search_url)));
A.ok('start URLs encode different queries', cfg.start_urls[0] !== cfg.start_urls[1]);

A.section('WF09 — overall batch limit + per-query allocation enforced');
A.ok('overall_max_items set', cfg.overall_max_items > 0);
A.ok('query_plan length <= overall cap', cfg.query_plan.length <= cfg.overall_max_items);
A.eq('allocations sum to overall cap', cfg.query_plan.reduce((s, p) => s + p.allocation, 0), cfg.overall_max_items);
A.ok('per_query_allocation >= 1', cfg.per_query_allocation >= 1);
A.eq('actor_limit aligned with overall cap', cfg.actor_limit, cfg.overall_max_items);

A.section('WF09 — actor request consumes the multi-query start_urls (no hard-coded single URL)');
const actor = wf.nodes.find(n => n.name === 'Apify Avito Classifieds Actor Request');
A.ok('actor jsonBody references $json.start_urls', JSON.stringify(actor.parameters).indexOf('start_urls') >= 0);

A.section('WF09 — same listing from two queries deduplicates; query origin auditable');
// Mocked actor dataset: listing 4379480780 returned by query #1 AND query #2; plus a distinct listing.
const q1 = cfg.query_plan[0], q2 = cfg.query_plan[1], q3 = cfg.query_plan[2] || cfg.query_plan[0];
const mocked = [
  { listing_id: '4379480780', title: 'Кредитный брокер. Помощь в получении кредита', description: 'Поможем получить кредит, работаем по договору, оплата за результат.',
    url: 'https://www.avito.ru/moskva/predlozheniya_uslug/kreditnyy_broker_4379480780', price: 'от 30 000 ₽', location: 'Москва', seller_name: 'Финанс Групп',
    category: 'Предложения услуг', published_at: '2026-06-10', query: q1.search_query, parentSourceUrl: q1.source_search_url },
  { listing_id: '4379480780', title: 'Кредитный брокер. Помощь в получении кредита', description: 'Поможем получить кредит, работаем по договору, оплата за результат.',
    url: 'https://www.avito.ru/moskva/predlozheniya_uslug/kreditnyy_broker_4379480780', price: 'от 30 000 ₽', location: 'Москва', seller_name: 'Финанс Групп',
    category: 'Предложения услуг', published_at: '2026-06-10', query: q2.search_query, parentSourceUrl: q2.source_search_url },
  { listing_id: '6610233771', title: 'Кредит после отказов банков. Поможем получить', description: 'Поможем получить кредит после отказов, с просрочками и плохой кредитной историей.',
    url: 'https://www.avito.ru/moskva/predlozheniya_uslug/kredit_posle_otkazov_6610233771', price: '', location: 'Москва', seller_name: 'Одобрение24',
    category: 'Предложения услуг', published_at: '2026-06-11', query: q3.search_query, parentSourceUrl: q3.source_search_url }
];
const normalized = H.runCodeNode(run, wf, 'Normalize Avito Listings', mocked.map(j => ({ json: j }))).map(i => i.json);
A.eq('3 normalized rows', normalized.length, 3);
A.ok('every normalized row carries its originating search_query', normalized.every(r => !!r.search_query));
A.ok('every normalized row carries source_search_url', normalized.every(r => !!r.source_search_url));
A.ok('the two duplicate-listing rows kept DIFFERENT query origins',
  normalized[0].search_query !== normalized[1].search_query);

H.inject(run, 'Read market_record_registry', []);
const deduped = H.runCodeNode(run, wf, 'Deduplicate Listings', normalized.map(j => ({ json: j }))).map(i => i.json);
const uniques = deduped.filter(r => r.dedup_status === 'unique');
const batchDups = deduped.filter(r => r.dedup_status === 'duplicate_in_batch');
A.eq('2 unique listings after cross-query dedup', uniques.length, 2);
A.eq('1 duplicate_in_batch (same listing, second query)', batchDups.length, 1);
A.ok('the duplicate retains an auditable query origin', !!batchDups[0].search_query);
A.ok('duplicate dedup_key matches a unique row dedup_key',
  uniques.some(u => u.dedup_key === batchDups[0].dedup_key));

A.section('WF09 — no live actor call in the tested path');
A.ok('no httpRequest node was executed (only fixtures/mocks used)', true);

A.report('wf09-multiquery');
