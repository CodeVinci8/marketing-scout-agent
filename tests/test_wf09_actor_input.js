// test_wf09_actor_input.js — Stage C Runtime Patch 5. Proves the WF09 Apify actor-input regression is fixed:
// the live request sends STRING startUrls (cfg.start_urls) + integer limit (cfg.actor_limit), NOT the Patch-4
// {url,userData} objects; per-record query origin is recovered from the actor's parentSourceUrl matched against
// cfg.query_plan (else 'unknown', never the concatenated query list); a malformed/empty actor item writes ZERO
// raw rows with an explicit error/skip summary; and a normal 10-item actor output still proceeds end to end.
// Runs the REAL WF09 nodes. $0, no network, no live actor.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('09_avito_classifieds_listing_connector.json');

// ---------------------------------------------------------------------------------------------------------
A.section('WF09 — live Apify request sends STRING startUrls + integer limit (no {url,userData} objects)');
const apifyNode = (wf.nodes || []).find(n => n.name === 'Apify Avito Classifieds Actor Request');
A.ok('Apify request node present', !!apifyNode);
const body = String(apifyNode.parameters.jsonBody);
A.ok('startUrls bound to cfg.start_urls (plain string URLs)', /JSON\.stringify\(\s*\$json\.start_urls\s*\)/.test(body));
A.ok('actor_start_urls object array is NOT sent to the live actor', body.indexOf('actor_start_urls') < 0);
A.ok('limit bound to cfg.actor_limit', /\$json\.actor_limit/.test(body));

const run0 = H.makeRun();
const cfg0 = H.runCodeNode(run0, wf, 'Set Avito Connector Config', [])[0].json;
A.ok('cfg.start_urls is a non-empty array', Array.isArray(cfg0.start_urls) && cfg0.start_urls.length > 0);
A.ok('every cfg.start_urls entry is a plain string URL', cfg0.start_urls.every(u => typeof u === 'string' && /^https?:\/\//.test(u)));
A.eq('cfg.actor_limit is an integer (10)', Number.isInteger(cfg0.actor_limit) && cfg0.actor_limit, 10);
// Render the body the way n8n would and assert the live payload shape the actor actually receives.
const rendered = JSON.parse('{ "limit": ' + (cfg0.actor_limit || 10) + ', "startUrls": ' + JSON.stringify(cfg0.start_urls) + ' }');
A.eq('rendered limit is the integer actor_limit', rendered.limit, cfg0.actor_limit);
A.ok('rendered startUrls are all strings (the fatihtahta actor contract)', Array.isArray(rendered.startUrls) && rendered.startUrls.length === cfg0.start_urls.length && rendered.startUrls.every(u => typeof u === 'string'));
// actor_start_urls is preserved for internal mapping/tests but is the WRONG live input (objects, not strings).
A.ok('actor_start_urls preserved as {url,userData} objects for internal mapping only', Array.isArray(cfg0.actor_start_urls) && cfg0.actor_start_urls.every(o => o && typeof o === 'object' && typeof o.url === 'string' && o.userData && typeof o.userData === 'object'));
A.ok('the preserved actor_start_urls are objects (NOT what the live body sends)', cfg0.actor_start_urls.every(o => typeof o !== 'string'));

// ---------------------------------------------------------------------------------------------------------
A.section('WF09 — actor item with parentSourceUrl maps to the correct single configured query');
const run1 = H.makeRun();
const cfg1 = H.runCodeNode(run1, wf, 'Set Avito Connector Config', [])[0].json;
cfg1.fixture_mode = false;
cfg1.data_mode = 'live';
run1.outputs['Set Avito Connector Config'] = [{ json: cfg1 }];
const targetIdx = 2; // the THIRD configured query — proves no start_urls[0] / first-query bias
const qp = cfg1.query_plan[targetIdx];
// A real detail listing as the fatihtahta actor returns it: NO explicit query field, only parentSourceUrl.
const actorItem = { listing_id: '4400112233', isDetail: true, title: 'Кредитный брокер. Помощь в получении кредита после отказов', description: 'Поможем получить кредит после отказов банков, работаем по договору, оплата за результат, большие суммы.', url: 'https://www.avito.ru/moskva/predlozheniya_uslug/kreditnyy_broker_4400112233', price: 'от 25 000 ₽', location: 'Москва', seller_name: 'Кредит Центр', published_at: '2026-06-18', category: 'Предложения услуг', parentSourceUrl: qp.source_search_url };
const norm1 = H.runCodeNode(run1, wf, 'Normalize Avito Listings', [{ json: actorItem }]).map(i => i.json);
A.eq('exactly one normalized record', norm1.length, 1);
const rec1 = norm1[0];
A.eq('search_query recovered from parentSourceUrl via cfg.query_plan', rec1.search_query, qp.search_query);
A.eq('source_search_url set from the actor parentSourceUrl', rec1.source_search_url, qp.source_search_url);
A.ok('search_query is a single query, not the concatenated list', String(rec1.search_query).indexOf(';') < 0);
A.ok('search_query matches exactly one configured query (no first-query bias)', cfg1.query_plan.filter(p => p.search_query === rec1.search_query).length === 1);
A.ok('it is not the first configured query', rec1.search_query !== cfg1.query_plan[0].search_query);
A.eq('it is a real detail competitor offer (not a search card)', rec1.record_type_hint, 'competitor_activity');

// ---------------------------------------------------------------------------------------------------------
A.section('WF09 — unmatched parentSourceUrl yields search_query=unknown (never the concatenated query list)');
const run2 = H.makeRun();
const cfg2 = H.runCodeNode(run2, wf, 'Set Avito Connector Config', [])[0].json;
cfg2.fixture_mode = false;
run2.outputs['Set Avito Connector Config'] = [{ json: cfg2 }];
const stray = { listing_id: '4400999999', isDetail: true, title: 'Кредитный брокер для бизнеса ИП и ООО', description: 'Финансирование для бизнеса, оборотные кредиты, банковские гарантии, тендерные займы.', url: 'https://www.avito.ru/moskva/predlozheniya_uslug/kreditnyy_broker_4400999999', price: 'от 20 000 ₽', location: 'Москва', seller_name: 'БизнесФин', published_at: '2026-06-15', category: 'Предложения услуг', parentSourceUrl: 'https://www.avito.ru/sankt-peterburg/predlozheniya_uslug?q=%D0%BD%D0%B5%D1%82' };
const norm2 = H.runCodeNode(run2, wf, 'Normalize Avito Listings', [{ json: stray }]).map(i => i.json);
A.eq('unmatched parentSourceUrl → search_query=unknown', norm2[0].search_query, 'unknown');
const joined = cfg2.search_queries.join('; ');
A.ok('search_query is never the concatenated configured query list', norm2[0].search_query !== joined && String(norm2[0].search_query).indexOf(';') < 0);
A.eq('source_search_url still preserved from the actor parentSourceUrl', norm2[0].source_search_url, stray.parentSourceUrl);

// ---------------------------------------------------------------------------------------------------------
A.section('WF09 — malformed/empty actor output → ZERO raw rows + explicit error/skip summary (no empty record)');
const run3 = H.makeRun();
const cfg3 = H.runCodeNode(run3, wf, 'Set Avito Connector Config', [])[0].json;
cfg3.fixture_mode = false;
cfg3.data_mode = 'live';
run3.outputs['Set Avito Connector Config'] = [{ json: cfg3 }];
// The exact single empty item the live actor emitted (alwaysOutputData) when Patch 4 sent userData objects.
const malformed = { source_url: '', post_url: '', title: '', listing_id: '', query: '' };
const norm3 = H.runCodeNode(run3, wf, 'Normalize Avito Listings', [{ json: malformed }]).map(i => i.json);
A.eq('one normalized item', norm3.length, 1);
A.eq('malformed item flagged invalid (not a valid listing)', norm3[0].is_valid_listing, false);
A.eq('invalid_reason = no_listing_url', norm3[0].invalid_reason, 'no_listing_url');
H.inject(run3, 'Read market_record_registry', []);
const dedup3 = H.runCodeNode(run3, wf, 'Deduplicate Listings', norm3.map(j => ({ json: j }))).map(i => i.json);
A.eq('dedup marks it invalid', dedup3[0].dedup_status, 'invalid');
const raw3 = H.runCodeNode(run3, wf, 'Build raw_market_records Rows', dedup3.map(j => ({ json: j }))).map(i => i.json);
A.eq('ZERO raw_market_records rows written from the malformed item', raw3.length, 0);
const reg3 = H.runCodeNode(run3, wf, 'Build market_record_registry Rows', dedup3.map(j => ({ json: j }))).map(i => i.json);
A.eq('ZERO market_record_registry rows written', reg3.length, 0);
const ar3 = H.runCodeNode(run3, wf, 'Build agent_requests Row', dedup3.map(j => ({ json: j })))[0].json;
A.ok('agent_requests next_action says do NOT run WF08', /Do NOT run Workflow 08/.test(ar3.next_action));
A.ok('agent_requests result_summary reports invalid_items=1', /invalid_items=1/.test(ar3.result_summary));
A.ok('agent_requests notes flags the empty actor output', /no valid listing_url\/title\/price/.test(ar3.notes));
const runlog3 = H.runCodeNode(run3, wf, 'Build live_source_runs Row', dedup3.map(j => ({ json: j })))[0].json;
A.ok('live_source_runs error_summary reports invalid_items=1', /invalid_items=1/.test(runlog3.error_summary));
const fsum3 = H.runCodeNode(run3, wf, 'Final Summary Output', dedup3.map(j => ({ json: j })))[0].json;
A.eq('Final Summary actor_items_received=1', fsum3.actor_items_received, 1);
A.eq('Final Summary invalid_items=1', fsum3.invalid_items, 1);
A.eq('Final Summary report_candidate_items=0', fsum3.report_candidate_items, 0);
A.eq('Final Summary unique_count=0', fsum3.unique_count, 0);
A.ok('Final Summary next_action says inspect Apify output / no business-relevant unique rows', /No business-relevant unique rows|inspect Apify output/.test(fsum3.next_action));

// ---------------------------------------------------------------------------------------------------------
A.section('WF09 — a normal 10-item actor output still proceeds end to end');
const run4 = H.makeRun();
const cfg4 = H.runCodeNode(run4, wf, 'Set Avito Connector Config', [])[0].json;
cfg4.fixture_mode = false;
cfg4.data_mode = 'live';
run4.outputs['Set Avito Connector Config'] = [{ json: cfg4 }];
const items10 = [];
for (let i = 0; i < 10; i++) {
  const p = cfg4.query_plan[i % cfg4.query_plan.length];
  const id = '44100000' + String(10 + i); // 4410000010 .. 4410000019
  items10.push({ json: {
    listing_id: id, isDetail: true,
    title: 'Кредитный брокер. Помощь в получении кредита №' + (i + 1),
    description: 'Поможем получить кредит после отказов банков, работаем по договору, оплата за результат, большие суммы, подбор банка.',
    url: 'https://www.avito.ru/moskva/predlozheniya_uslug/kreditnyy_broker_' + id,
    price: 'от ' + (10000 + i * 1000) + ' ₽', location: 'Москва', seller_name: 'Брокер ' + (i + 1),
    published_at: '2026-06-1' + (i % 9 || 1) /* always non-empty */, category: 'Предложения услуг',
    parentSourceUrl: p.source_search_url
  } });
}
const norm4 = H.runCodeNode(run4, wf, 'Normalize Avito Listings', items10).map(i => i.json);
A.eq('10 items normalized', norm4.length, 10);
A.ok('all 10 are valid listings', norm4.every(r => r.is_valid_listing === true));
A.ok('all 10 mapped to a real configured query (none unknown)', norm4.every(r => r.search_query !== 'unknown' && cfg4.search_queries.indexOf(r.search_query) >= 0));
A.ok('all 10 source_search_url come from a configured start URL', norm4.every(r => cfg4.start_urls.indexOf(r.source_search_url) >= 0));
H.inject(run4, 'Read market_record_registry', []);
const dedup4 = H.runCodeNode(run4, wf, 'Deduplicate Listings', norm4.map(j => ({ json: j }))).map(i => i.json);
A.eq('all 10 unique (empty registry)', dedup4.filter(r => r.dedup_status === 'unique').length, 10);
const raw4 = H.runCodeNode(run4, wf, 'Build raw_market_records Rows', dedup4.map(j => ({ json: j }))).map(i => i.json);
A.eq('10 raw_market_records rows written', raw4.length, 10);
A.ok('every raw row carries a per-record query origin (none unknown/blank)', raw4.every(r => r.search_query && r.search_query !== 'unknown'));
A.ok('no raw row has an empty source_url', raw4.every(r => String(r.source_url).length > 0));
const fsum4 = H.runCodeNode(run4, wf, 'Final Summary Output', dedup4.map(j => ({ json: j })))[0].json;
A.eq('Final Summary actor_items_received=10', fsum4.actor_items_received, 10);
A.eq('Final Summary invalid_items=0', fsum4.invalid_items, 0);
A.eq('Final Summary unique_count=10', fsum4.unique_count, 10);
A.eq('Final Summary confirmed_detail_offer_items=10', fsum4.confirmed_detail_offer_items, 10);

A.report('wf09-actor-input');
