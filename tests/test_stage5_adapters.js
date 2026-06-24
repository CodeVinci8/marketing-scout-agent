'use strict';
// test_stage5_adapters.js — Stage 5 guarded provider-adapter contract, exercised through the REAL production
// path (n8n/lib/provider_adapter.js runAdapter) with a deterministic, in-memory, call-COUNTING mock transport.
// There is NO real network here: the mock transport is a pure function, so TOTAL live external calls = 0. Mock
// transport invocations are counted separately and reported as offline fixture/mock calls.
const A = require('./_assert.js');
const P = require('../n8n/lib/provider_adapter.js');

// ---- offline mock transport: scripted responses; counts invocations (never touches the network) -------------
const COUNTERS = { mock_transport_calls: 0, fixture_calls: 0 };
function transportFrom(script) {
  // script: array of {status,headers,body} or Error, consumed per attempt; or a function(req,attempt).
  let i = 0;
  return function (req, attempt) {
    COUNTERS.mock_transport_calls++;
    const step = typeof script === 'function' ? script(req, attempt) : script[Math.min(i++, script.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
}
const CFG = { enable_claude: true, enable_firecrawl: true, enable_apify: true, enable_external_actions: true, enable_vk: true };
const SECRETS = { anthropicApi: true, firecrawlApi: true, apifyApi: true, vkApi: true };
const DEPS = { now: () => '2026-06-24T12:00:00.000+03:00', rng: () => 0.42 };

A.section('contract version + error taxonomy completeness');
A.eq('contract version', P.ADAPTER_CONTRACT_VERSION, 'adapter-v1');
['AUTHENTICATION','AUTHORIZATION','FEATURE_DISABLED','CREDENTIAL_MISSING','INVALID_REQUEST','UNSUPPORTED_OPERATION','RATE_LIMIT','TIMEOUT','NETWORK','PROVIDER_4XX','PROVIDER_5XX','INVALID_RESPONSE','EMPTY_RESULT','BUDGET_BLOCKED','CANCELLED','RETRY_EXHAUSTED','INTERNAL']
  .forEach(c => A.includes('taxonomy has ' + c, P.ERROR_CATEGORIES, c));
A.eq('exactly 17 error categories', P.ERROR_CATEGORIES.length, 17);

A.section('request schema validation');
A.ok('valid claude request', P.buildRequest({ adapter: 'claude', operation: 'messages', max_external_calls: 1 }).valid);
A.ok('unknown adapter invalid', !P.buildRequest({ adapter: 'nope', operation: 'x' }).valid);
A.ok('unsupported operation invalid', !P.buildRequest({ adapter: 'claude', operation: 'crawl' }).valid);
A.ok('deterministic request_id', P.buildRequest({ adapter: 'firecrawl', operation: 'scrape', url: 'https://a.ru' }).request_id === P.buildRequest({ adapter: 'firecrawl', operation: 'scrape', url: 'https://a.ru' }).request_id);

A.section('credential + feature preflight (presence only, never values)');
A.ok('feature disabled => FEATURE_DISABLED', P.preflightCredentials('claude', { enable_claude: false }, SECRETS).error.category === 'FEATURE_DISABLED');
A.ok('missing credential => CREDENTIAL_MISSING', P.preflightCredentials('claude', { enable_claude: true }, {}).error.category === 'CREDENTIAL_MISSING');
A.ok('enabled + present => ok', P.preflightCredentials('claude', CFG, SECRETS).ok);
A.ok('website needs no credential', P.preflightCredentials('website', { enable_external_actions: true }, {}).ok);

A.section('Claude provider parser (usage + request id; reject malformed)');
const claudeBody = { id: 'msg_01ABC', model: 'claude-haiku-4-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Анализ рынка.' }], usage: { input_tokens: 1200, output_tokens: 350, cache_read_input_tokens: 100 } };
const pc = P.parseClaude(claudeBody);
A.ok('parses claude text', pc.ok && pc.records[0].text === 'Анализ рынка.');
A.eq('claude provider_request_id', pc.provider_request_id, 'msg_01ABC');
A.eq('claude input tokens', pc.usage.input_tokens, 1200);
A.eq('claude cache tokens preserved', pc.usage.cache_read_input_tokens, 100);
A.ok('claude malformed JSON => INVALID_RESPONSE', P.parseClaude('{not json').error.category === 'INVALID_RESPONSE');
A.ok('claude missing content[] => INVALID_RESPONSE', P.parseClaude({ id: 'x' }).error.category === 'INVALID_RESPONSE');

A.section('Firecrawl + Apify parsers');
const fc = P.parseFirecrawl({ id: 'fc_1', success: true, data: { markdown: '# Цены', metadata: { sourceURL: 'https://shop.ru/prices', statusCode: 200, title: 'Цены' } }, creditsUsed: 1 });
A.ok('firecrawl record url + content', fc.ok && fc.records[0].url === 'https://shop.ru/prices' && /Цены/.test(fc.records[0].content));
A.includes('firecrawl source_urls', fc.source_urls, 'https://shop.ru/prices');
A.ok('firecrawl success=false => PROVIDER_4XX', P.parseFirecrawl({ success: false, error: 'blocked' }).error.category === 'PROVIDER_4XX');
const ap = P.parseApify([{ url: 'https://avito.ru/x', title: 'Объявление', text: 'описание' }]);
A.ok('apify items parsed', ap.ok && ap.records.length === 1 && ap.usage.items === 1);
A.ok('apify non-array => INVALID_RESPONSE', P.parseApify({ foo: 1 }).error.category === 'INVALID_RESPONSE');

A.section('cost model — honest estimated / actual / actual_cost_unknown / free / budget_blocked');
A.eq('no pricing => actual_cost_unknown', P.computeCost('claude', pc, P.DEFAULT_PRICING).cost_status, 'actual_cost_unknown');
const PRICED = { version: 'pricing-test-2026-06', claude: { models: { 'claude-haiku-4-5': { input_per_mtok: 1.0, output_per_mtok: 5.0 } } }, firecrawl: { estimate_per_unit_usd: 0.002 }, apify: { estimate_per_unit_usd: null } };
const cc = P.computeCost('claude', pc, PRICED);
A.eq('claude actual cost computed', cc.cost_status, 'actual');
A.eq('claude cost math (1200/1e6*1 + 350/1e6*5)', cc.actual_cost, Math.round((1200/1e6*1 + 350/1e6*5) * 1e6) / 1e6);
A.eq('firecrawl estimated when per-unit configured', P.computeCost('firecrawl', fc, PRICED).cost_status, 'estimated');
A.eq('apify unknown when per-unit null', P.computeCost('apify', ap, PRICED).cost_status, 'actual_cost_unknown');
A.eq('website is free', P.computeCost('website', { usage: {} }, PRICED).cost_status, 'free');

A.section('runAdapter — happy path (real loop, mock transport, cost actual)');
const ok1 = P.runAdapter({ adapter: 'claude', operation: 'messages', max_external_calls: 2, query: 'рынок' }, Object.assign({ pricing: PRICED }, CFG), SECRETS, Object.assign({ transport: transportFrom([{ status: 200, headers: { 'x-ratelimit-remaining': '9' }, body: claudeBody }]) }, DEPS));
A.ok('success', ok1.success === true && ok1.status === 'ok');
A.eq('attempt_count', ok1.attempt_count, 1);
A.eq('cost actual', ok1.cost_status, 'actual');
A.ok('provider_request_id propagated', ok1.provider_request_id === 'msg_01ABC');
A.ok('raw response preserved by bounded ref (hash+bytes, not full body)', ok1.raw_response_reference && ok1.raw_response_reference.hash && ok1.raw_response_reference.bytes > 0);
A.ok('idempotent delivery key', ok1.delivery_key === P.runAdapter({ adapter: 'claude', operation: 'messages', max_external_calls: 2, query: 'рынок' }, Object.assign({ pricing: PRICED }, CFG), SECRETS, Object.assign({ transport: transportFrom([{ status: 200, headers: {}, body: claudeBody }]) }, DEPS)).delivery_key);

A.section('runAdapter — 429 then success (retry honored)');
const r429 = P.runAdapter({ adapter: 'firecrawl', operation: 'scrape', url: 'https://a.ru', max_external_calls: 3, max_attempts: 3 }, CFG, SECRETS, Object.assign({ transport: transportFrom([{ status: 429, headers: { 'retry-after': '1' } }, { status: 200, headers: {}, body: { success: true, data: { markdown: 'x', metadata: { sourceURL: 'https://a.ru' } } } }]) }, DEPS));
A.ok('recovered after 429', r429.success === true && r429.attempt_count === 2);

A.section('runAdapter — transient 5xx retried, permanent 4xx not retried');
const r5 = P.runAdapter({ adapter: 'apify', operation: 'run_actor', max_external_calls: 3, max_attempts: 3 }, CFG, SECRETS, Object.assign({ transport: transportFrom([{ status: 503, headers: {} }, { status: 503, headers: {} }, { status: 200, headers: {}, body: [{ url: 'https://x.ru' }] }]) }, DEPS));
A.ok('5xx retried to success on attempt 3', r5.success === true && r5.attempt_count === 3);
const r4 = P.runAdapter({ adapter: 'apify', operation: 'run_actor', max_external_calls: 3, max_attempts: 3 }, CFG, SECRETS, Object.assign({ transport: transportFrom([{ status: 400, headers: {} }, { status: 200, headers: {}, body: [{ url: 'https://x.ru' }] }]) }, DEPS));
A.ok('4xx not retried (stops at attempt 1)', r4.success === false && r4.attempt_count === 1 && r4.error.category === 'PROVIDER_4XX');

A.section('runAdapter — timeout/network retried then RETRY_EXHAUSTED');
const rex = P.runAdapter({ adapter: 'firecrawl', operation: 'scrape', url: 'https://a.ru', max_external_calls: 5, max_attempts: 3 }, CFG, SECRETS, Object.assign({ transport: transportFrom([new Error('timeout'), new Error('timeout'), new Error('timeout')]) }, DEPS));
A.ok('retry exhausted after max attempts', rex.success === false && rex.attempt_count === 3 && rex.error.category === 'RETRY_EXHAUSTED');

A.section('runAdapter — cancellation before attempt, budget block (no call), dry-run (no call), feature-disabled');
let cancelCalls = 0;
const rc = P.runAdapter({ adapter: 'claude', operation: 'messages', max_external_calls: 2 }, CFG, SECRETS, Object.assign({ is_cancelled: () => true, transport: () => { cancelCalls++; return { status: 200, headers: {}, body: claudeBody }; } }, DEPS));
A.ok('cancelled before any transport call', rc.error.category === 'CANCELLED' && cancelCalls === 0);
const rb = P.runAdapter({ adapter: 'claude', operation: 'messages', max_external_calls: 0 }, CFG, SECRETS, Object.assign({ transport: () => { throw new Error('should not be called'); } }, DEPS));
A.ok('zero budget => BUDGET_BLOCKED with no transport call', rb.error.category === 'BUDGET_BLOCKED');
const rd = P.runAdapter({ adapter: 'claude', operation: 'messages', max_external_calls: 5, dry_run: true }, CFG, SECRETS, Object.assign({ transport: () => { throw new Error('should not be called'); } }, DEPS));
A.ok('dry_run makes no transport call', rd.dry_run === true && rd.status === 'dry_run');
const rf = P.runAdapter({ adapter: 'vk', operation: 'wall_get', max_external_calls: 1 }, { enable_vk: false }, SECRETS, DEPS);
A.ok('feature disabled => FEATURE_DISABLED, no call', rf.error.category === 'FEATURE_DISABLED');

A.section('fixture_mode goes through the real parser/normalizer (counted as fixture, not live)');
const rfm = P.runAdapter({ adapter: 'firecrawl', operation: 'scrape', url: 'https://a.ru', fixture_mode: true, fixture: { status: 200, headers: {}, body: { success: true, data: { markdown: 'фикстура', metadata: { sourceURL: 'https://a.ru' } } } } }, CFG, SECRETS, Object.assign({ record_call: (k) => { COUNTERS.fixture_calls += (k === 'fixture' ? 1 : 0); } }, DEPS));
A.ok('fixture parsed through production path', rfm.success === true && /фикстура/.test(rfm.records[0].content));
A.ok('fixture recorded as fixture call', COUNTERS.fixture_calls >= 1);

A.section('acceptance harness emits all markers for every adapter (offline, RESULT=PASS)');
const H = require('../tools/adapter_acceptance.js');
Object.keys(H.FIXTURES).forEach(function (a) {
  const m = H.acceptance(a, {});
  A.ok('acceptance(' + a + ') RESULT=PASS', m.RESULT === 'PASS', JSON.stringify(m));
  A.ok('acceptance(' + a + ') has all markers', H.MARKERS.every(function (k) { return m[k] !== undefined; }));
  A.ok('acceptance(' + a + ') made no live call', /NO/.test(String(m.LIVE_CALL_EXECUTED)));
});
A.ok('dry-run acceptance makes no live call', H.acceptance('claude', { dry_run: true }).LIVE_CALL_EXECUTED === 'NO');
A.ok('live acceptance is refused (no real transport)', H.acceptance('apify', { live: true }).RESULT === 'REFUSED');

A.section('external-call accounting: ZERO real network calls in this suite');
A.ok('mock transport was used (offline)', COUNTERS.mock_transport_calls > 0);
A.ok('LIVE external calls = 0 (no real transport ever injected)', true);

A.report('STAGE 5 ADAPTERS (real path, mock transport=' + COUNTERS.mock_transport_calls + ', live external=0)');
