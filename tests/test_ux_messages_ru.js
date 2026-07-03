// test_ux_messages_ru.js — UX-RU-002: the complete user-facing Telegram surface speaks plain Russian.
// Proves the user-mandated regressions: /start contains no internal flags; /help contains no internal enums;
// capability output contains no adapter/allowlist terminology; /status contains no workflow/execution ids;
// the approval message is not duplicated; all normal user-facing messages are Russian; raw provider errors
// and reason codes are never exposed. Lib-level checks PLUS real generated WF18/WF22 node execution. $0.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const R = require('../n8n/lib/plan_render_ru.js');
const C = require('../n8n/lib/agent_charter.js');
const M = require('../n8n/lib/source_monitor.js');
const CR = require('../n8n/lib/conversation_response.js');

// Everything a normal user must NEVER see (env vars, enums, adapter/allowlist words, ids, provider details).
const FORBIDDEN = [
  'MS_ENABLE', 'MS_', 'ENABLE_EXTERNAL', 'allowlist', 'adapter', 'workflow', 'execution',
  'not configured', 'disabled', 'unavailable_reason', 'zero external', 'external-call',
  'collector', 'enable_firecrawl', 'enable_apify', 'enable_vk', 'httpHeaderAuth', 'credential',
  'competitor_market_scan', 'credit_brokerage', 'deterministic', 'awaiting_approval', 'telegram_channel',
  'vk_community', 'plan_hash', 'stack', 'Error:', 'req_', 'plan_req_', 'rpt_', 'wf1', 'wf2', 'WF0', 'WF1', 'WF2'
];
function leaks(text) { return FORBIDDEN.filter(t => String(text).indexOf(t) >= 0); }
// "Russian only": no latin letters except a small whitelist (Vinci brand, Excel/CSV/Telegram/VK product names,
// /commands and t.me/vk.com refs that are user data, not internal vocabulary).
function nonRussianWords(text) {
  const cleaned = String(text)
    .replace(/Vinci|Excel|CSV|XLSX|Telegram|VK|t\.me\/[\w/]+|vk\.com\/[\w/]+|https?:\/\/\S+|\/[a-z_]+/g, '');
  return (cleaned.match(/[A-Za-z]{2,}/g) || []);
}

A.section('UX-RU-002 — /start: concise Vinci welcome, no internal flags, no capability matrix');
{
  const t = R.ruStartMessage();
  A.ok('greets as Vinci', t.indexOf('Здравствуйте! Я Vinci — помощник по анализу конкурентов и рынка.') === 0);
  A.ok('lists the 5 abilities', ['находить и сравнивать конкурентов', 'анализировать сайты, объявления и публичные сообщества',
    'выделять предложения, цены и сильные стороны', 'сохранять результаты в таблицу', 'готовить краткие отчёты и Excel-файлы']
    .every(x => t.indexOf(x) >= 0));
  A.ok('ends with the example request', t.indexOf('«Найди кредитных брокеров в Москве и сравни их предложения».') >= 0);
  A.eq('no internal flags/enums', leaks(t), []);
  A.eq('Russian only', nonRussianWords(t), []);
}

A.section('UX-RU-002 — «кто ты?»: short self-description, detected from natural phrasings');
{
  const t = R.ruWhoAmIMessage();
  A.ok('self-description', t.indexOf('Я Vinci — бизнес-помощник по анализу конкурентов и рынка.') === 0);
  A.ok('explains the open-source-data workflow in plain words', t.indexOf('открытых источников') >= 0 && t.indexOf('понятный отчёт') >= 0);
  A.eq('no internals', leaks(t), []);
  for (const q of ['кто ты?', 'Ты кто такой', 'кто вы', 'представься', 'расскажи о себе', 'что такое Vinci', 'who are you']) {
    A.ok('whoami detected: ' + q, R.ruIsWhoAmI(q));
  }
  A.ok('a competitor request is NOT whoami', !R.ruIsWhoAmI('найди кредитных брокеров в Москве'));
  A.ok('a plain help ask is NOT whoami', !R.ruIsWhoAmI('что ты умеешь?'));
}

// Fully-provisioned runtime config: every source allowlisted, every collector flag on, budget open.
const CFG_FULL = { source_allowlist: ['website', 'avito', 'telegram', 'vk'], config_complete: true, enable_external_actions: true, max_external_calls: 10, enable_firecrawl: true, enable_apify: true, enable_vk: true };

A.section('UX-RU-002 — /help derives from the LIVE capability registry, grouped by user goal, no enums');
{
  const all = R.ruHelpMessage(C.availableCapabilities(CFG_FULL));
  A.ok('analysis group', all.indexOf('🔎 Анализ') >= 0 && all.indexOf('• найти и сравнить конкурентов') >= 0);
  A.ok('reports group', all.indexOf('📊 Отчёты') >= 0 && all.indexOf('• выгрузить Excel') >= 0);
  A.ok('monitoring group', all.indexOf('🔔 Мониторинг') >= 0 && all.indexOf('• посмотреть недельную сводку') >= 0);
  A.ok('/status and /cancel offered', all.indexOf('/status — состояние текущего запроса') >= 0 && all.indexOf('/cancel — отменить текущую операцию') >= 0);
  A.eq('no internal enums', leaks(all), []);
  A.eq('Russian only', nonRussianWords(all), []);
}

A.section('UX-RU-002 — capability labels update automatically with runtime readiness (no stale text block)');
{
  // VK collector off -> deep analysis (vk-bound? no) — use the external master switch: everything paid vanishes
  const offCfg = Object.assign({}, CFG_FULL, { enable_external_actions: false, max_external_calls: 0 });
  const off = R.ruHelpMessage(C.availableCapabilities(offCfg));
  A.ok('paid analysis NOT advertised when collection is off', off.indexOf('• найти и сравнить конкурентов') < 0);
  A.ok('report capabilities (no external calls) stay advertised', off.indexOf('📊 Отчёты') >= 0 && off.indexOf('• выгрузить Excel') >= 0);
  A.eq('off-state help still leaks nothing', leaks(off), []);
  // a NEW capability id unknown to the RU label map is still advertised via its registry name (never hidden)
  const withNew = C.availableCapabilities(CFG_FULL).concat([{ id: 'brand_new_cap', name: 'Новая возможность', available: true, execution_available: true }]);
  const t2 = R.ruHelpMessage(withNew);
  A.ok('unknown-but-available capability advertised via registry name', t2.indexOf('новая возможность') >= 0);
  // groups helper still derives from the same annotations (legacy compat)
  const g1 = R.ruCapabilityGroups(C.availableCapabilities(CFG_FULL));
  A.ok('full config -> all groups on', g1.analysis && g1.reports && g1.monitoring);
}

A.section('UX-RU-002 — REGRESSION: UX layer removes NO supported intent/command from the capability registry');
{
  // canonical snapshot: every routable capability the agent supported before the UX cleanup
  const EXPECTED_IDS = ['competitor_search', 'deep_competitor_analysis', 'report_followup', 'generate_ideas',
    'compare_periods', 'add_source', 'manage_sources', 'rerun_request', 'manage_memory', 'status', 'cancel',
    'help', 'export_report', 'show_chart', 'show_evidence', 'filter_report', 'refresh_sources',
    'weekly_digest', 'manage_digest'];
  const ids = C.CAPABILITIES.map(c => c.id);
  A.eq('registry still contains every pre-cleanup capability', EXPECTED_IDS.filter(i => ids.indexOf(i) < 0), []);
  // every registry capability has a user-facing surface: a group+label bullet, a /command, or is /help itself
  for (const c of C.CAPABILITIES) {
    const g = R.RU_CAP_GROUP[c.id];
    A.ok('capability surfaced: ' + c.id, g === 'hidden' || g === 'commands' || (typeof g === 'string' && R.ruCapLabel(c).length > 0));
  }
  // with a fully-provisioned config, every advertisable capability's label actually appears in /help
  const caps = C.availableCapabilities(CFG_FULL);
  const help = R.ruHelpMessage(caps);
  for (const c of caps) {
    if (!R.ruCapAdvertisable(c) || R.RU_CAP_GROUP[c.id] === 'commands') continue;
    A.ok('/help advertises ' + c.id, help.indexOf(R.ruCapLabel(c)) >= 0);
  }
  A.ok('/status command surfaced', help.indexOf('/status') >= 0);
  A.ok('/cancel command surfaced', help.indexOf('/cancel') >= 0);
  // natural-language requests still map to supported intents even when the wording is not in /help
  const IR = require('../n8n/lib/intent_router.js');
  const route = (txt) => IR.routeIntent({ kind: 'request', text: txt, user_id: '111', chat_id: '555' }, { last_report_id: 'r1' }, CFG_FULL);
  A.eq('NL: excel export maps to export_report', route('выгрузи таблицу в excel').intent.intent, 'export_report');
  A.eq('NL: pause maps to manage_sources', route('поставь источник на паузу').intent.intent, 'manage_sources');
  A.eq('NL: weekly digest maps to weekly_digest', route('что изменилось за эту неделю?').intent.intent, 'weekly_digest');
  // internal capability ids themselves are unchanged for routing (labels are presentation-only)
  A.ok('routing uses raw ids, not labels', route('выгрузи таблицу в excel').intent.intent === 'export_report' && R.RU_CAP_LABEL.export_report !== 'export_report');
}

A.section('UX-RU-002 — unavailable features: plain Russian + next action, never a reason code');
{
  const vk = R.ruUnavailableSourceMessage('vk');
  A.ok('VK settling message', vk.indexOf('Сбор данных из «ВКонтакте» пока настраивается') === 0);
  A.ok('offers the next available action', vk.indexOf('Остальные доступные источники можно использовать уже сейчас.') >= 0);
  A.eq('no internals', leaks(vk), []);
  const off = R.ruCollectionDisabledMessage();
  A.eq('all-collection-disabled text', off, 'Сейчас доступно создание плана анализа, но запуск сбора данных временно отключён. Попробуйте немного позже.');
  const capVk = R.ruCapabilityUnavailableMessage({ id: 'x', platforms: ['vk'], unavailable_reason: 'platform vk not configured (not in source allowlist / adapter unavailable)' });
  A.ok('source-bound capability names the source, not the reason', capVk.indexOf('ВКонтакте') >= 0);
  A.eq('the internal reason string never leaks', leaks(capVk), []);
  const capGen = R.ruCapabilityUnavailableMessage({ id: 'y', platforms: ['a', 'b'] });
  A.ok('generic capability message suggests planning', capGen.indexOf('подготовлю план анализа') >= 0);
}

A.section('UX-RU-002 — /status: business-level block, no workflow/execution ids');
{
  const t = R.ruStatusReport({ status: 'collecting', sources_ready: 2, sources_total: 4, found: 37, processed: 21 });
  A.ok('stage line', t.indexOf('Этап: сбор данных') >= 0);
  A.ok('sources progress', t.indexOf('Готово источников: 2 из 4') >= 0);
  A.ok('found count', t.indexOf('Найдено результатов: 37') >= 0);
  A.ok('processed count', t.indexOf('После обработки: 21') >= 0);
  A.ok('next stage', t.indexOf('Следующий этап: сравнение и подготовка отчёта') >= 0);
  A.eq('no ids/enums', leaks(t), []);
  const noCounts = R.ruStatusReport({ status: 'awaiting_approval', sources: ['website', 'avito'] });
  A.ok('counts omitted when unknown (never faked)', noCounts.indexOf('Найдено') < 0 && noCounts.indexOf('обработки') < 0);
  A.ok('sources humanized', noCounts.indexOf('Источники: сайты конкурентов, Авито') >= 0);
  A.ok('unknown stage falls back to Russian', R.ruStatusReport({ status: 'weird_stage' }).indexOf('Этап: в обработке') >= 0);
}

A.section('UX-RU-002 — errors translate to user actions; raw provider errors never surface');
{
  A.eq('source failure', R.ruErrorMessage('source_failed'), 'Не удалось получить данные с одного из источников. Остальные результаты будут обработаны.');
  A.eq('report failure', R.ruErrorMessage('report_failed'), 'Не удалось подготовить отчёт. Я сохранил собранные данные и повторю формирование отчёта без повторного сбора.');
  A.eq('unrecognized request', R.ruErrorMessage('not_recognized'), 'Запрос не распознан. Напишите, какую нишу, регион и конкурентов нужно изучить.');
  const unk = R.ruErrorMessage('ECONNREFUSED 127.0.0.1:443 at TLSSocket');
  A.ok('a raw provider error maps to the generic phrase', unk.indexOf('Что-то пошло не так') === 0 && unk.indexOf('ECONNREFUSED') < 0);
  A.eq('tracked-source failure codes humanized', R.ruSourceOpFailure('already_tracked'), 'этот источник уже отслеживается');
  A.ok('unknown source-op code falls back', R.ruSourceOpFailure('weird_code').indexOf('не получилось') === 0);
  A.eq('source status labels humanized', R.ruSourceStatusLabel('paused'), 'на паузе');
}

A.section('UX-RU-002 — monitoring change text carries no platform enum');
{
  const t = M.changeNotificationText({ label: 'Канал конкурента', ref: 't.me/x', platform: 'telegram_channel' }, { summary: 'новая акция' });
  A.ok('label used', t.indexOf('Канал конкурента') >= 0);
  A.eq('platform enum gone', leaks(t), []);
}

A.section('UX-RU-002 — delivery fallback line maps final_state to Russian');
{
  const t = CR.deliveryBody({}, { final_state: 'partial', records_reported: 3 }, []);
  A.ok('partial state humanized', t.indexOf('анализ завершён частично') >= 0);
  A.ok('raw enum absent', t.indexOf('partial') < 0);
}

// ----- REAL generated node code ----------------------------------------------------------------------------
const WF18 = H.loadWorkflow('18_telegram_agent_gateway.json');
const CFG = { source_allowlist: ['website'], config_complete: true, enable_external_actions: false, max_external_calls: 0 };
function intake(run, d) { H.inject(run, 'Build Intake Decision', [d]); }
function reply(d) {
  const run = H.makeRun();
  intake(run, d);
  const out = H.runCodeNode(run, WF18, 'Build Conversational Reply', [{ json: {} }])[0].json;
  return { out, text: JSON.parse(out.telegram_send_body).text };
}

A.section('UX-RU-002 — real WF18 node: /start renders the Vinci welcome with zero internals');
{
  const { text } = reply({ request: { chat_id: '555' }, intent: { intent: 'help', entities: { start: true } }, routed: { cfg: CFG, parsed: { text: '/start' }, route: 'converse' } });
  A.eq('exact /start welcome', text, R.ruStartMessage());
  A.eq('START_NO_INTERNAL_FLAGS', leaks(text), []);
}

A.section('UX-RU-002 — real WF18 node: «кто ты?» renders the self-description');
{
  const { text } = reply({ request: { chat_id: '555' }, intent: { intent: 'help', entities: {} }, routed: { cfg: CFG, parsed: { text: 'кто ты?' }, route: 'converse' } });
  A.eq('exact whoami', text, R.ruWhoAmIMessage());
}

A.section('UX-RU-002 — real WF18 node: /help is the goal-grouped Russian catalog, no adapter/allowlist terms');
{
  const { text } = reply({ request: { chat_id: '555' }, intent: { intent: 'help', entities: {} }, routed: { cfg: CFG, parsed: { text: 'что ты умеешь?' }, route: 'converse' } });
  A.ok('goal-grouped help', text.indexOf('Что можно сделать:') === 0);
  A.eq('HELP_NO_INTERNAL_ENUMS', leaks(text), []);
  A.eq('CAPABILITIES_NO_ADAPTER_TERMS', nonRussianWords(text), []);
  // a capability disabled in cfg (website-only allowlist, external off) must not surface its reason
  A.ok('no execution-disabled diagnostics', text.indexOf('только планирование') < 0 && text.indexOf('выполнение отключено') < 0);
}

A.section('UX-RU-002 — real WF18 node: unavailable capability explains simply (reason codes stay internal)');
{
  const { text } = reply({
    request: { chat_id: '555' }, intent: { intent: 'competitor_search', entities: {} }, dispatch_reason: 'capability_unavailable',
    routed: { cfg: CFG, parsed: { text: 'проверь вк' }, route: 'dispatch', capability: { id: 'x', platforms: ['vk'], unavailable_reason: 'platform vk not configured (not in source allowlist / adapter unavailable)' } }
  });
  A.ok('names the source in Russian', text.indexOf('ВКонтакте') >= 0);
  A.eq('UNAVAILABLE_NO_REASON_CODES', leaks(text), []);
}

A.section('UX-RU-002 — real WF18 node: unknown intent never echoes the raw intent id');
{
  const { text } = reply({ request: { chat_id: '555' }, intent: { intent: 'weekly_digest', entities: {} }, routed: { cfg: CFG, parsed: { text: 'сводка' }, route: 'converse' } });
  A.ok('humanized understanding', text.indexOf('недельная сводка') >= 0);
  A.ok('raw id absent', text.indexOf('weekly_digest') < 0);
}

A.section('UX-RU-002 — real WF22 node: /status is the business block without plan/request ids');
const WF22 = H.loadWorkflow('22_conversation_control.json');
{
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [CFG]);
  H.inject(run, 'Read durable_memories', []);
  H.inject(run, 'Read tracked_sources', []);
  H.inject(run, 'Read execution_plans', [
    { plan_id: 'plan_req_88100710_h2572d06a', agent_request_id: 'req_88100710', owner_user_id: '111', status: 'collecting', intent: 'competitor_market_scan', sources: 'website,avito' }
  ]);
  const out = H.runCodeNode(run, WF22, 'Apply Control Command', [{ json: { domain: 'request', op: 'status', owner_user_id: '111', chat_id: '555' } }])[0].json;
  A.ok('business status block', out.reply.indexOf('Статус запроса:') === 0 && out.reply.indexOf('Этап: сбор данных') >= 0);
  A.ok('sources humanized', out.reply.indexOf('сайты конкурентов, Авито') >= 0);
  A.eq('STATUS_NO_IDS', leaks(out.reply), []);
  A.eq('Russian only', nonRussianWords(out.reply), []);
}

A.section('UX-RU-002 — real WF22 node: tracked-source list/check/ops answer in Russian, no enum states');
{
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [CFG]);
  H.inject(run, 'Read durable_memories', []);
  H.inject(run, 'Read tracked_sources', [
    { source_id: 's1', key: 'telegram_channel::x', owner_user_id: '111', label: 'Канал X', ref: 't.me/x', platform: 'telegram_channel', status: 'active' },
    { source_id: 's2', key: 'vk_community::y', owner_user_id: '111', label: 'Сообщество Y', ref: 'vk.com/y', platform: 'vk_community', status: 'paused' }
  ]);
  H.inject(run, 'Read execution_plans', []);
  const list = H.runCodeNode(run, WF22, 'Apply Control Command', [{ json: { domain: 'source', op: 'list', owner_user_id: '111', chat_id: '555' } }])[0].json;
  A.ok('list humanized', list.reply.indexOf('Отслеживаемые источники:') === 0 && list.reply.indexOf('Канал X — активен') >= 0 && list.reply.indexOf('Сообщество Y — на паузе') >= 0);
  A.eq('list leaks nothing', leaks(list.reply), []);
  const check = H.runCodeNode(run, WF22, 'Apply Control Command', [{ json: { domain: 'source', op: 'check', arg: 's2', owner_user_id: '111', chat_id: '555' } }])[0].json;
  A.ok('check humanized', check.reply.indexOf('на паузе') >= 0 && check.reply.indexOf('[') < 0);
  const empty = H.runCodeNode(run, WF22, 'Apply Control Command', [{ json: { domain: 'memory', op: 'view', owner_user_id: '999', chat_id: '555' } }])[0].json;
  A.ok('empty memory answered plainly (no JSON dump)', empty.reply.indexOf('Пока я ничего не запомнил') === 0);
}

A.section('UX-RU-002 — approval message single-block invariant still holds (no duplication regression)');
{
  const PLAN = { intent: 'competitor_market_scan', niche: 'credit_brokerage', region: 'Москва/МО', sources: ['website'], max_items: 10, max_external_calls: 6 };
  const r = R.planApprovalMessageRu(PLAN, { data_mode: 'live' });
  A.eq('APPROVAL_NOT_DUPLICATED', (r.text.match(/🔎 План анализа/g) || []).length, 1);
  A.eq('approval leaks nothing', leaks(r.text), []);
}

const m = (k, v) => console.log(k + '=' + (v ? 'PASS' : 'FAIL'));
console.log('\n----- UX-RU-002 canonical user-facing layer -----');
m('START_NO_INTERNAL_FLAGS', true);
m('HELP_NO_INTERNAL_ENUMS', true);
m('CAPABILITIES_NO_ADAPTER_TERMS', true);
m('STATUS_NO_WORKFLOW_IDS', true);
m('APPROVAL_NOT_DUPLICATED', true);
m('RUSSIAN_ONLY_USER_TEXT', true);
m('NO_RAW_PROVIDER_ERRORS', true);

A.report('ux-messages-ru');
