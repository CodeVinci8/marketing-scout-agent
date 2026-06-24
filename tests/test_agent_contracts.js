// test_agent_contracts.js — unit contracts for the conversational-agent libraries (charter, intent router,
// conversation memory, response generation, tracked sources). Pure, offline, $0.
'use strict';
const A = require('./_assert');
const charter = require('../n8n/lib/agent_charter');
const router = require('../n8n/lib/intent_router');
const mem = require('../n8n/lib/conversation_memory');
const resp = require('../n8n/lib/conversation_response');
const ts = require('../n8n/lib/tracked_sources');

const CFG = { source_allowlist: ['website'], config_complete: true, enable_llm_intent: false, max_context_tokens: 400, recent_window: 4, summary_trigger_tokens: 200 };
const CFG_FULL = { source_allowlist: ['website', 'telegram_channel', 'vk_community'], config_complete: true };

// ============================================================================================================
A.section('agent_charter — immutable charter + deterministic capability registry');
A.ok('charter is versioned', /charter-v2/.test(charter.charterText()));
A.ok('charter identity is Vinci AI Pilot', /Vinci AI Pilot/.test(charter.charterText()));
A.ok('charter states the never-invent rule', /never invents/.test(charter.charterText()));
A.eq('capability ids are unique', new Set(charter.CAPABILITIES.map(c => c.id)).size, charter.CAPABILITIES.length);
A.ok('capabilityById finds a real id', !!charter.capabilityById('deep_competitor_analysis'));
A.eq('capabilityById rejects an invented id', charter.capabilityById('do_something_magic'), null);
const annWeb = charter.availableCapabilities(CFG);
A.eq('website search available on website allowlist', annWeb.find(c => c.id === 'competitor_search').available, true);
A.eq('add_source needs telegram platform => unavailable on website-only', annWeb.find(c => c.id === 'add_source').available, false);
A.ok('unavailable reason names the missing platform', /telegram_channel/.test(annWeb.find(c => c.id === 'add_source').unavailable_reason));
A.eq('add_source available when telegram+vk configured', charter.availableCapabilities(CFG_FULL).find(c => c.id === 'add_source').available, true);
A.ok('catalog lists available + unavailable honestly', /Недоступно/.test(charter.capabilityCatalogText(CFG)));

A.section('intent_router — INTENT_IDS stay in sync with routable capability IDs');
const capIds = charter.CAPABILITIES.map(c => c.id);
for (const id of capIds) {
  if (id === 'status' || id === 'cancel' || id === 'help' || id === 'manage_memory') { A.ok(id + ' routable', router.INTENT_IDS.indexOf(id) >= 0); continue; }
  A.ok('router knows capability ' + id, router.INTENT_IDS.indexOf(id) >= 0);
}

A.section('identity questions route deterministically to a non-external answer (no paid call, no pipeline)');
const identity = require('../n8n/lib/agent_identity');
A.ok('charter product identity matches the canonical agent_identity', charter.CHARTER.identity.indexOf(identity.PRODUCT_NAME) >= 0);
['Кто ты?', 'Ты кто?', 'Для чего ты нужен?', 'Что такое Vinci AI Pilot?', 'Какие задачи ты решаешь?'].forEach(function (q) {
  const it = router.deterministicIntent(parse(q));
  A.ok('"' + q + '" routes to help intent', it && it.intent === 'help');
  A.ok('"' + q + '" is not an approval/external action', it && it.requires_approval !== true && it.requested_action !== 'build_plan');
});

A.section('intent_router — deterministic free-text routing (no buttons)');
function parse(text, kind) { return { kind: kind || 'request', text: text, callback_data: '', update_id: '1', message_id: '1', chat_id: '5', user_id: '111' }; }
A.eq('competitor search routes', router.deterministicIntent(parse('найди конкурентов по займам под ПТС в Москве')).intent, 'competitor_search');
A.eq('competitor search requires approval', router.deterministicIntent(parse('найди конкурентов')).requires_approval, true);
const ctxRep = { last_report: { competitors: [{ company_name: 'CASHMOTOR', root_url: 'https://cashmotor.ru/' }, { company_name: 'CarCapital', root_url: 'https://carcapital.ru/' }] }, last_report_id: 'rep_1' };
A.eq('"сравни первых двух подробнее" => deep analysis', router.deterministicIntent(parse('сравни первых двух подробнее')).intent, 'deep_competitor_analysis');
A.eq('ideas without a report => not ideas (clarify path)', router.deterministicIntent(parse('какие идеи можно адаптировать?')), null);
A.eq('ideas WITH a report => generate_ideas', router.deterministicIntent(parse('какие идеи можно адаптировать?'), ctxRep).intent, 'generate_ideas');
A.eq('add source routes', router.deterministicIntent(parse('добавь их сайты в мониторинг')).intent, 'add_source');
A.eq('manage sources routes', router.deterministicIntent(parse('поставь на паузу второй источник')).intent, 'manage_sources');
A.eq('compare periods routes', router.deterministicIntent(parse('сравни с прошлым отчётом'), ctxRep).intent, 'compare_periods');
A.eq('rerun routes', router.deterministicIntent(parse('запусти это снова на следующей неделе')).intent, 'rerun_request');
A.eq('status command routes', router.deterministicIntent(parse('/status', 'status')).intent, 'status');
A.eq('cancel command routes', router.deterministicIntent(parse('/cancel', 'cancel')).intent, 'cancel');
A.eq('/new command => manage_memory', router.deterministicIntent(parse('/new')).entities.memory_op, 'new');
A.eq('vague text => ambiguous (null)', router.deterministicIntent(parse('ну и что теперь')), null);

A.section('intent_router — entity + reference resolution');
const ent = router.entityExtract('сравни первых двух подробнее и проверь telegram', ctxRep);
A.ok('extracts first_two', ent.competitor_refs.indexOf('first_two') >= 0);
A.ok('extracts telegram platform', ent.platforms.indexOf('telegram_channel') >= 0);
const res = router.resolveReferences({ competitor_refs: ['first_two'] }, ctxRep);
A.eq('first_two resolves to two competitors', res.competitors.length, 2);
A.eq('first_two resolves correct first name', res.competitors[0].company_name, 'CASHMOTOR');
A.eq('"them" resolves from last report', router.resolveReferences({ competitor_refs: ['selected'] }, ctxRep).competitors.length, 2);

A.section('intent_router — guarded classifier + clarification fallback');
const rOff = router.routeIntent(parse('ну и что'), {}, { enable_llm_intent: false });
A.eq('LLM off + ambiguous => clarify', rOff.route, 'clarify');
A.ok('clarify carries one question', rOff.clarification.length > 0);
const rOn = router.routeIntent(parse('ну и что'), {}, { enable_llm_intent: true });
A.eq('LLM on + ambiguous => llm route (no run yet)', rOn.route, 'llm');
A.eq('valid classifier JSON accepted', router.validateIntentJSON('{"intent":"competitor_search","confidence":0.9,"entities":{},"requested_action":"build_plan"}').valid, true);
A.eq('unknown intent rejected', router.validateIntentJSON('{"intent":"hack_the_planet","confidence":0.9,"requested_action":"build_plan"}').reason, 'unknown_intent');
A.eq('bad confidence rejected', router.validateIntentJSON('{"intent":"status","confidence":5,"requested_action":"status"}').reason, 'bad_confidence');
A.eq('non-json rejected', router.validateIntentJSON('definitely not json').reason, 'not_json');

A.section('intent_router — buttons map to the same capabilities as free text');
const btn = router.deterministicIntent({ kind: 'callback', callback_data: 'intent:deep_competitor_analysis' }, {});
A.eq('intent: button => same capability', btn.intent, 'deep_competitor_analysis');
const approveBtn = router.deterministicIntent({ kind: 'callback', callback_data: 'approve:req_1' }, { current_intent: 'competitor_search' });
A.eq('approve button => approve action', approveBtn.requested_action, 'approve');
A.eq('unknown callback => clarify (no invented action)', router.deterministicIntent({ kind: 'callback', callback_data: 'wat:xyz' }, {}).intent, 'clarify_request');

A.section('conversation_memory — bounded window + rolling summary preserves IDs/decisions');
const msgs = [];
for (let i = 1; i <= 12; i++) msgs.push({ role: i % 2 ? 'user' : 'assistant', message_id: 'm' + i, text: 'message number ' + i });
A.eq('recent window bounded to default 8', mem.recentWindow(msgs).length, 8);
A.eq('recent window honors n', mem.recentWindow(msgs, 4).length, 4);
A.eq('shouldSummarize true over window', mem.shouldSummarize(msgs, { recent_window: 8 }), true);
A.eq('shouldSummarize false under window', mem.shouldSummarize(msgs.slice(0, 3), { recent_window: 8, summary_trigger_tokens: 9999 }), false);
const older = [{ role: 'user', message_id: 'm1', text: 'найди конкурентов, отчёт rep_42 по req_7' }, { role: 'assistant', message_id: 'm2', text: 'approve req_7' }];
const sum1 = mem.rollingSummary(null, older, { entities: ['CASHMOTOR'], goals: ['monitor PTS Moscow'], ts: 't1' });
A.eq('summary version starts at 1', sum1.version, 1);
A.ok('summary preserves req id verbatim', sum1.preserved_ids.indexOf('req_7') >= 0);
A.ok('summary preserves report id verbatim', sum1.preserved_ids.indexOf('rep_42') >= 0);
A.ok('summary captures a decision', sum1.decisions.length >= 1);
const sum2 = mem.rollingSummary(sum1, [{ role: 'user', message_id: 'm3', text: 'добавь rep_99' }], { ts: 't2' });
A.eq('summary version increments', sum2.version, 2);
A.eq('summary keeps prev version for audit', sum2.prev_version, 1);
A.ok('summary carries forward earlier IDs', sum2.preserved_ids.indexOf('req_7') >= 0);

A.section('conversation_memory — token-budgeted context never drops critical sections');
const big = new Array(500).join('x'); // ~500 chars
const ctxRes = mem.buildContext({
  charter: 'CHARTER', state: 'STATE req_1', safety: 'APPROVAL REQUIRED', newest: 'newest user message',
  artifacts: big, recent: big, summary: big, durable: big, summary_version: 3
}, { max_context_tokens: 150 });
A.ok('charter always included', ctxRes.sections_included.indexOf('charter') >= 0);
A.ok('state always included', ctxRes.sections_included.indexOf('state') >= 0);
A.ok('safety always included', ctxRes.sections_included.indexOf('safety') >= 0);
A.ok('newest user message always included', ctxRes.sections_included.indexOf('newest') >= 0);
A.ok('some low-priority section omitted under budget', ctxRes.sections_omitted.length >= 1);
A.eq('truncation flagged', ctxRes.truncated, true);
A.ok('budget respected for optional sections', ctxRes.est_input_tokens <= 150 + mem.estimateTokens('STATE req_1') + 50);
const usage = mem.contextUsageRecord(ctxRes, { conversation_id: 'conv_1', agent_request_id: 'req_1', ts: 't' });
A.eq('usage records summary version', usage.summary_version, 3);

A.section('conversation_memory — durable memory: isolation, no secrets, forget + audit');
A.eq('makeMemory rejects secret-like value', mem.makeMemory({ owner_user_id: '111', memory_type: 'preference', key: 'telegram_token', value_json: 'bot12345678:ABC' }).reason, 'secret_blocked');
A.eq('makeMemory rejects bad type', mem.makeMemory({ owner_user_id: '111', memory_type: 'nope', key: 'x', value_json: 'y' }).reason, 'bad_memory_type');
const m111 = mem.makeMemory({ owner_user_id: '111', memory_type: 'region', key: 'default_region', value_json: 'Москва/МО', ts: 't' }).memory;
const m222 = mem.makeMemory({ owner_user_id: '222', memory_type: 'region', key: 'default_region', value_json: 'СПб', ts: 't' }).memory;
const store = [m111, m222];
A.eq('user isolation: 111 sees only own', mem.memoriesForUser(store, '111').length, 1);
A.eq('user isolation: 111 cannot see 222', mem.memoriesForUser(store, '111')[0].owner_user_id, '111');
const forgot = mem.forgetMemory(store, 'default_region', { owner_user_id: '111', ts: 't2' });
A.eq('forget removes only the matching user memory', forgot.removed, 1);
A.eq('forgotten memory excluded from active view', mem.memoriesForUser(forgot.memories, '111').length, 0);
A.eq('other user memory survives forget', mem.memoriesForUser(forgot.memories, '222').length, 1);
A.ok('forget audit has value hash, not raw value', /^h[0-9a-f]+$/.test(forgot.audit[0].value_hash));
A.eq('forget audit retains no raw value field', forgot.audit[0].value_json, undefined);
A.eq('forget_all requires confirmation', mem.forgetAll(store, { owner_user_id: '111', confirmed: false }).reason, 'confirmation_required');
A.eq('forget_all with confirm removes user memory', mem.forgetAll(store, { owner_user_id: '111', confirmed: true, ts: 't' }).removed, 1);

A.section('conversation_memory — /new resets active context but keeps preferences');
const st = mem.patchState(mem.newConversationState('conv_1', '111'), { current_region: 'Москва/МО', last_report_id: 'rep_1', current_intent: 'competitor_search' }, 't');
const reset = mem.resetConversation(st, 'conv_2', 't2');
A.eq('reset clears last_report_id', reset.last_report_id, '');
A.eq('reset clears active intent', reset.current_intent, '');
A.eq('reset keeps owner', reset.owner_user_id, '111');
// durable preference lives in the memory store, untouched by a conversation reset
A.eq('durable preference survives /new (separate store)', mem.memoriesForUser([m111], '111').length, 1);

A.section('conversation_memory — no-memory mode + artifact selection');
const nm = mem.patchState(mem.newConversationState('conv_x', '111'), { no_memory: true }, 't');
A.eq('no-memory flag set', nm.no_memory, true);
const arts = mem.selectArtifacts({ last_report: 'rep_1', competitors: ['CASHMOTOR'] }, { reports: [{ report_id: 'rep_1', competitors: [] }], competitors: [{ company_name: 'CASHMOTOR' }, { company_name: 'Other' }] });
A.eq('selectArtifacts pulls only the requested report', arts.last_report.report_id, 'rep_1');
A.eq('selectArtifacts filters competitors', arts.competitors.length, 1);

A.section('conversation_response — useful text without buttons + post-report invitation');
const reply = resp.buildConversationalReply({ understood: 'поиск конкурентов', next: 'строю план', requires_approval: true, source_scope: 'website', budget_ceiling: '≤4 вызова, ~$0.05', followups: ['разобрать подробнее'] });
A.ok('reply states understanding', /Понял так/.test(reply));
A.ok('reply states approval need', /подтверждени/.test(reply));
A.ok('reply invites free-text continuation', /напишите/i.test(reply));
const pr = resp.postReportReply({ summary_text: '1 конкурент найден', ideas: ['снизить ставку'], limitations: ['1 источник деградирован'] }, charter.availableCapabilities(CFG_FULL));
A.ok('post-report marks ideas as recommendations', /рекомендации, не факты/.test(pr));
A.ok('post-report invites next step in natural language', /напишите, что сделать дальше/i.test(pr));
A.ok('action buttons only offer available capabilities', resp.actionButtons(charter.availableCapabilities(CFG)).inline_keyboard.every(r => /intent:/.test(r[0].callback_data)));
A.eq('approval buttons carry real callbacks', resp.approvalButtons('req_1').inline_keyboard[0][0].callback_data, 'approve:req_1');

A.section('tracked_sources — add/list/pause/resume/remove + availability honesty');
A.eq('website url => website platform', ts.normalizeSourceRef('https://cashmotor.ru/loans').platform, 'website');
A.eq('t.me => telegram platform', ts.normalizeSourceRef('https://t.me/somechannel').platform, 'telegram_channel');
A.eq('@handle => telegram platform', ts.normalizeSourceRef('@somechannel').platform, 'telegram_channel');
A.eq('vk.com => vk platform', ts.normalizeSourceRef('https://vk.com/club123').platform, 'vk_community');
const add1 = ts.addSource([], 'https://cashmotor.ru/', { owner_user_id: '111', cfg: CFG, ts: 't' });
A.eq('website source added on website allowlist', add1.added, true);
A.eq('add is audited', add1.audit.event, 'source_add');
const add2 = ts.addSource(add1.sources, 'https://cashmotor.ru/', { owner_user_id: '111', cfg: CFG, ts: 't' });
A.eq('duplicate source not added twice', add2.added, false);
A.eq('duplicate reason', add2.reason, 'already_tracked');
const addTg = ts.addSource(add1.sources, 'https://t.me/x', { owner_user_id: '111', cfg: CFG, ts: 't' });
A.eq('telegram source blocked on website-only allowlist (honest)', addTg.added, false);
A.eq('telegram block reason', addTg.reason, 'platform_unavailable');
const addTg2 = ts.addSource([], 'https://t.me/x', { owner_user_id: '111', cfg: CFG_FULL, ts: 't' });
A.eq('telegram source added when configured', addTg2.added, true);
const paused = ts.setSourceStatus(add1.sources, add1.source.key, 'paused', { owner_user_id: '111', ts: 't2' });
A.eq('pause changes status', paused.changed, true);
A.eq('pause audited', paused.audit.to, 'paused');
A.eq('list excludes removed', ts.listSources(ts.setSourceStatus(add1.sources, add1.source.key, 'removed', { owner_user_id: '111' }).sources, '111').length, 0);
const ctxComp = { selected_competitors: [{ company_name: 'CASHMOTOR', root_url: 'https://cashmotor.ru/' }, { company_name: 'CarCapital', root_url: 'https://carcapital.ru/' }] };
A.eq('resolveSourcesFromContext returns competitor urls', ts.resolveSourcesFromContext(ctxComp).length, 2);

A.report('agent-contracts');
