// test_wf09_avito_proxy.js — AVITO-PROXY-001 regression on the REAL WF09 nodes ($0, no network).
// The live Apify Avito actor (fatihtahta~avito-russia-scraper) is anti-bot protected and needs a residential
// proxy; the connector previously sent NO proxyConfiguration, so a bounded live run came back empty ([{}],
// items_received=1/items_written=0). This proves 'Set Avito Connector Config' now resolves a residential
// proxy_config (agent AND manual paths) and the actor-request body forwards it as proxyConfiguration.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const wf = H.loadWorkflow('09_avito_classifieds_listing_connector.json');

function config(agentIn) {
  const run = H.makeRun();
  if (agentIn) H.inject(run, 'When Called by Agent', [agentIn]);
  return H.runCodeNode(run, wf, 'Set Avito Connector Config', [])[0].json;
}

A.section('AVITO-PROXY-001 — agent-called config resolves a residential proxy');
const c = config({
  agent_request_id: 'req_avito_x', source_run_id: 'req_avito_x::avito::a1',
  data_mode: 'live', search_queries: 'кредитный брокер Москва;кредит под ПТС Москва',
  max_items: '30', approval_token: 'AVITO_LIVE_APPROVED', max_budget_usd: '1',
});
A.ok('proxy_config present', c.proxy_config && typeof c.proxy_config === 'object', JSON.stringify(c.proxy_config));
A.ok('useApifyProxy=true', c.proxy_config.useApifyProxy === true);
A.ok('apifyProxyGroups includes RESIDENTIAL', Array.isArray(c.proxy_config.apifyProxyGroups) && c.proxy_config.apifyProxyGroups.indexOf('RESIDENTIAL') >= 0, JSON.stringify(c.proxy_config.apifyProxyGroups));
A.ok('live_mode true when data_mode=live', c.live_mode === true);
A.ok('start_urls are plain strings (actor schema)', Array.isArray(c.start_urls) && typeof c.start_urls[0] === 'string');

A.section('AVITO-PROXY-001 — manual (non-agent) config also carries the proxy default');
const m = config(null);
A.ok('manual proxy_config present', m.proxy_config && m.proxy_config.useApifyProxy === true, JSON.stringify(m.proxy_config));

A.section('AVITO-PROXY-001 — actor-request body forwards proxyConfiguration');
const reqNode = wf.nodes.find(n => n.name === 'Apify Avito Classifieds Actor Request');
const body = String(reqNode.parameters.jsonBody || '');
A.ok('body includes proxyConfiguration', body.indexOf('proxyConfiguration') >= 0, body);
A.ok('body references proxy_config', body.indexOf('proxy_config') >= 0);
A.ok('body still sends startUrls + limit', body.indexOf('startUrls') >= 0 && body.indexOf('limit') >= 0);

A.report('wf09-avito-proxy');
