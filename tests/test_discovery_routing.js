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

A.section('DEFECT-8 — "найди ... сайты" routes to website discovery (not old analysis/no-data)');
['найди кредитных брокеров сайты', 'найди сайты конкурентов', 'найди новые сайты кредитных брокеров', 'найди сайты кредитных брокеров в Москве'].forEach(function (t) {
  A.eq('"' + t + '" -> competitor_discovery', route(t).intent, 'competitor_discovery');
});
A.eq('"проверь отслеживаемые сайты" -> manage_sources (tracked check, not discovery)', route('проверь отслеживаемые сайты').intent, 'manage_sources');
A.eq('"проанализируй эти сайты: https://finardi.ru" -> competitor_search (explicit analysis)', route('проанализируй эти сайты: https://finardi.ru').intent, 'competitor_search');

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

A.section('DISCOVERY-004 — WF18 routes candidate buttons (disc_*) to the WF22 discovery domain');
A.ok('Build Intake Decision maps disc_* callbacks to manage_discovery', /disc_\(add\|all\|more\|none\)/.test(intake) && /action='manage_discovery'/.test(intake));
A.ok("manage_discovery dispatches to wf22", /action==='manage_discovery'\)\{dispatch_target='wf22'/.test(intake) || /manage_discovery'\)\{dispatch_target='wf22'/.test(intake));
const cmd = node('18_telegram_agent_gateway.json', 'Command Lane').parameters.jsCode;
A.ok('Command Lane clears the spinner for disc_* callbacks', /disc_\(add\|all\|more\|none\)/.test(cmd) && /answer_callback_body/.test(cmd));
const run22 = node('18_telegram_agent_gateway.json', 'Run WF22 (Control)');
A.ok('Run WF22 passes domain=discovery for manage_discovery', String(run22.parameters.workflowInputs.value.domain).indexOf('discovery') >= 0);

A.section('DISCOVERY-004 — WF22 discovery domain: add best / list / none / more (real node execution)');
const H = require('./wf_harness');
const CFG = require('../n8n/lib/agent_config.js').resolveConfig({ MS_SPREADSHEET_ID: 'S', MS_TELEGRAM_ALLOWED_USER_IDS: '111', MS_SOURCE_ALLOWLIST: 'website,telegram' });
const WF22 = H.loadWorkflow('22_conversation_control.json');
const CANDS = [
  { candidate_id: 'r1::website::zalog24h.ru', owner_user_id: '111', discovery_run_id: 'r1', platform: 'website', source_url: 'https://zalog24h.ru', normalized_key: 'website::zalog24h.ru', display_name: 'zalog24h.ru', is_competitor: true, confidence: 64, region: 'match', quality_status: 'validated', already_tracked: '', classification_reason: 'поставщик услуги: автоломбард', query_text: 'автоломбард Москва' },
  { candidate_id: 'r1::website::autolombardn1.ru', owner_user_id: '111', discovery_run_id: 'r1', platform: 'website', source_url: 'https://autolombardn1.ru', normalized_key: 'website::autolombardn1.ru', display_name: 'autolombardn1.ru', is_competitor: true, confidence: 64, region: 'match', quality_status: 'validated', already_tracked: '', classification_reason: 'поставщик услуги: автоломбард', query_text: 'автоломбард Москва' },
  { candidate_id: 'r1::website::sravni.ru', owner_user_id: '111', discovery_run_id: 'r1', platform: 'website', source_url: 'https://sravni.ru', normalized_key: 'website::sravni.ru', display_name: 'sravni.ru', is_competitor: false, is_news_or_aggregator: true, confidence: 55, already_tracked: '', classification_reason: 'агрегатор/каталог/СМИ', query_text: 'автоломбард Москва' }
];
function discRun(op, cands) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [CFG]);
  H.inject(run, 'Read durable_memories', []);
  H.inject(run, 'Read tracked_sources', []);
  H.inject(run, 'Read execution_plans', []);
  H.inject(run, 'Read candidate_sources', cands || CANDS);
  return H.runCodeNode(run, WF22, 'Apply Control Command', [{ json: { domain: 'discovery', op: op, arg: 'r1', owner_user_id: '111', chat_id: '555' } }])[0].json;
}
const addOut = discRun('add');
A.ok('add persists the top competitors to tracked_sources', addOut.changed_sources.length === 2, 'changed=' + addOut.changed_sources.length);
A.ok('add reply confirms in Russian', addOut.reply.indexOf('Добавил в мониторинг') === 0, addOut.reply);
A.ok('aggregator (sravni.ru) is NOT added', !/sravni/.test(JSON.stringify(addOut.changed_sources)));
const listOut = discRun('list');
A.ok('list shows the competitor breakdown', listOut.reply.indexOf('Похожи на конкурентов:') >= 0 && listOut.reply.indexOf('zalog24h.ru') >= 0);
const noneOut = discRun('none');
A.ok('none dismisses without adding', noneOut.reply.indexOf('ничего не добавляю') >= 0 && noneOut.changed_sources.length === 0);
const moreOut = discRun('more');
A.ok('more gives actionable guidance (no paid call)', /расширить поиск/.test(moreOut.reply) && moreOut.changed_sources.length === 0);
const emptyAdd = discRun('add', [{ candidate_id: 'r1::website::x', owner_user_id: '111', discovery_run_id: 'r1', platform: 'website', source_url: 'https://x.ru', normalized_key: 'website::x.ru', display_name: 'x.ru', is_competitor: false, confidence: 30, already_tracked: '' }]);
A.ok('add with no qualifying competitor adds nothing (fail-safe)', emptyAdd.changed_sources.length === 0 && /нечего добавить/.test(emptyAdd.reply));

// DISCOVERY-005: add policy excludes region mismatch + aggregator-competitors even at high confidence.
const RC = [
  { candidate_id: 'r2::website::msk.ru', owner_user_id: '111', discovery_run_id: 'r2', platform: 'website', source_url: 'https://msk.ru', normalized_key: 'website::msk.ru', display_name: 'msk.ru', is_competitor: true, is_news_or_aggregator: false, region: 'match', quality_status: 'validated', confidence: 78, already_tracked: '', classification_reason: 'услуга: автоломбард; регион соответствует', query_text: 'автоломбард Москва' },
  { candidate_id: 'r2::website::nsk.ru', owner_user_id: '111', discovery_run_id: 'r2', platform: 'website', source_url: 'https://nsk.ru', normalized_key: 'website::nsk.ru', display_name: 'nsk.ru', is_competitor: true, is_news_or_aggregator: false, region: 'mismatch', quality_status: 'validated', confidence: 70, already_tracked: '', classification_reason: 'услуга: автоломбард; другой регион', query_text: 'автоломбард Москва' },
  { candidate_id: 'r2::website::2gis.ru', owner_user_id: '111', discovery_run_id: 'r2', platform: 'website', source_url: 'https://2gis.ru', normalized_key: 'website::2gis.ru', display_name: '2gis.ru', is_competitor: true, is_news_or_aggregator: true, region: 'match', quality_status: 'validated', confidence: 90, already_tracked: '', classification_reason: 'каталог', query_text: 'автоломбард Москва' }
];
const rcAdd = H.runCodeNode((function () { const run = H.makeRun(); H.inject(run, 'Resolve Agent Config', [CFG]); H.inject(run, 'Read durable_memories', []); H.inject(run, 'Read tracked_sources', []); H.inject(run, 'Read execution_plans', []); H.inject(run, 'Read candidate_sources', RC); return run; })(), WF22, 'Apply Control Command', [{ json: { domain: 'discovery', op: 'add', arg: 'r2', owner_user_id: '111', chat_id: '555' } }])[0].json;
A.ok('add takes only the in-region non-aggregator competitor (msk.ru)', rcAdd.changed_sources.length === 1 && /msk\.ru/.test(JSON.stringify(rcAdd.changed_sources)), 'changed=' + JSON.stringify(rcAdd.changed_sources.map(s => s.key || s.ref)));
A.ok('region-mismatch competitor NOT added', !/nsk\.ru/.test(JSON.stringify(rcAdd.changed_sources)));
A.ok('aggregator competitor (2gis) NOT added even at conf 90', !/2gis/.test(JSON.stringify(rcAdd.changed_sources)));

// DISCOVERY-006: unvalidated competitors are never added, even in-region above threshold.
const UNVAL = [{ candidate_id: 'r3::website::u.ru', owner_user_id: '111', discovery_run_id: 'r3', platform: 'website', source_url: 'https://u.ru', normalized_key: 'website::u.ru', display_name: 'u.ru', is_competitor: true, is_news_or_aggregator: false, region: 'match', quality_status: 'unvalidated', confidence: 75, already_tracked: '', classification_reason: 'услуга; не подтверждён', query_text: 'автоломбард Москва' }];
const uvAdd = H.runCodeNode((function () { const run = H.makeRun(); H.inject(run, 'Resolve Agent Config', [CFG]); H.inject(run, 'Read durable_memories', []); H.inject(run, 'Read tracked_sources', []); H.inject(run, 'Read execution_plans', []); H.inject(run, 'Read candidate_sources', UNVAL); return run; })(), WF22, 'Apply Control Command', [{ json: { domain: 'discovery', op: 'add', arg: 'r3', owner_user_id: '111', chat_id: '555' } }])[0].json;
A.ok('unvalidated competitor NOT added (validated-only policy)', uvAdd.changed_sources.length === 0 && /нечего добавить/.test(uvAdd.reply));

A.report('discovery-routing');
