'use strict';
// test_discovery_routing.js — DISCOVERY-003: "найди новых конкурентов [in tg/vk/сайты]" routes to discovery
// (WF27), while tracked-source checks + explicit-source analysis stay on their own paths.
const A = require('./_assert');
const R = require('../n8n/lib/intent_router.js');
const CH = require('../n8n/lib/agent_charter.js');

function route(t) { const r = R.routeIntent({ kind: 'request', text: t }); return { intent: r.intent && r.intent.intent, action: r.intent && r.intent.requested_action }; }

A.section('discovery intents route to competitor_discovery / discovery');
['найди новых конкурентов',
 'найди конкурентов по ПТС Москва в тг',
 'найди Telegram-каналы кредитных брокеров в Москве',
 'найди VK сообщества по кредитам под ПТС',
 'найди сайты конкурентов по кредитам под ПТС Москва',
 'поищи новых конкурентов в вк',
 'найди и добавь подходящие каналы'].forEach(function (t) {
  const r = route(t);
  A.eq('"' + t + '" -> competitor_discovery', r.intent, 'competitor_discovery');
  A.eq('  action=discovery', r.action, 'discovery');
});

A.section('non-discovery intents stay on their own path');
A.eq('explicit pasted sources -> competitor_search (analysis)', route('проверь https://finardi.ru t.me/da_credit').intent, 'competitor_search');
A.eq('single pasted url -> competitor_search', route('https://finardi.ru').intent, 'competitor_search');
A.eq('tracked-source check stays manage_sources', route('покажи мои источники').intent, 'manage_sources');
A.eq('memory stays manage_memory', route('что ты помнишь').intent, 'manage_memory');
A.ok('a discovery request with a pasted url is analysis, not discovery', route('найди конкурентов на https://finardi.ru').intent === 'competitor_search');

A.section('capability registry + platform detection wired for discovery');
A.ok('competitor_discovery is a real capability', !!CH.capabilityById('competitor_discovery'));
A.ok('competitor_discovery is routable (INTENT_IDS)', R.INTENT_IDS.indexOf('competitor_discovery') >= 0);
A.ok('discovery is a requested_action', R.REQUESTED_ACTIONS.indexOf('discovery') >= 0);

A.section('WF18 dispatches discovery to WF27 (generator drift-proof)');
const gen = require('../tools/gen_stage4_workflows.js');
function node(file, name) { const w = (gen.generated || []).find(g => g.file === file).workflow; return w.nodes.find(n => n.name === name); }
const intake = node('18_telegram_agent_gateway.json', 'Build Intake Decision').parameters.jsCode;
A.ok("Build Intake Decision maps action='discovery' -> wf27", /action==='discovery'\)\{dispatch_target='wf27'/.test(intake));
const d27 = node('18_telegram_agent_gateway.json', 'Dispatch WF27?');
A.ok('WF18 has a Dispatch WF27? gate', !!d27 && JSON.stringify(d27.parameters).indexOf("wf27") >= 0);
const run27 = node('18_telegram_agent_gateway.json', 'Run WF27 (Discovery)');
A.ok('WF18 has a Run WF27 executeWorkflow node', !!run27 && run27.type === 'n8n-nodes-base.executeWorkflow');
A.ok('auto_add flagged only on explicit "найди и добавь"', String(run27.parameters.workflowInputs.value.auto_add).indexOf('добав') >= 0);

A.report('discovery-routing');
