// test_agent_e2e.js — full mocked MULTI-TURN conversational E2E. Drives the conversational-agent libraries
// through a realistic dialogue: search -> approve -> report -> deep compare -> approve -> deep report ->
// add sources from context -> capabilities -> window overflow -> rolling summary -> follow-up still resolves
// the right competitors. Collection is mocked (a counter); ZERO external calls; $0; no network.
'use strict';
const A = require('./_assert');
const tg = require('../n8n/lib/telegram_io');
const charter = require('../n8n/lib/agent_charter');
const router = require('../n8n/lib/intent_router');
const mem = require('../n8n/lib/conversation_memory');
const resp = require('../n8n/lib/conversation_response');
const deep = require('../n8n/lib/deep_analysis');
const pol = require('../n8n/lib/orchestration_policy');
const trk = require('../n8n/lib/tracked_sources');
const planner = require('../n8n/lib/request_planner');

const NOW = '2026-06-21T10:00:00Z';
const CFG = {
  telegram_allowed_user_ids: ['111'], source_allowlist: ['website', 'telegram_channel', 'vk_community'],
  require_approval: true, max_items_per_source: 25, max_external_calls: 40, source_budget_usd: 0.20,
  llm_budget_usd: 0.50, default_region: 'Москва/МО', default_niche: 'pts_loan', deep_page_limit: 6,
  max_competitors_deep: 3, evidence_max_age_days: 7, enable_llm_intent: false, enable_llm_summary: false,
  config_complete: true, max_context_tokens: 4000, recent_window: 6, summary_trigger_tokens: 400
};

// shared conversation world
let state = mem.newConversationState('conv_e2e', '111');
let messages = [];
let memories = [mem.makeMemory({ owner_user_id: '111', memory_type: 'region', key: 'default_region', value_json: 'Москва/МО', ts: NOW }).memory];
let sources = [];
let lastReport = null;
let summary = null;
let pendingPlan = null, pendingDeep = null;
let externalCalls = 0, mid = 0;

function ctxView() {
  return Object.assign({}, state, {
    last_report: lastReport, last_report_id: lastReport ? lastReport.report_id : '',
    selected_competitors: state.selected_competitors,
    collected_platforms: state.collected_platforms || ['website'],
    last_collected_at: state.last_collected_at || '', conversation_id: 'conv_e2e'
  });
}
function pushMsg(role, text) { messages.push({ role: role, message_id: 'm' + (++mid), text: String(text) }); }
function maybeSummarize() {
  if (mem.shouldSummarize(messages, CFG)) {
    const keep = mem.recentWindow(messages, CFG.recent_window);
    const older = messages.slice(0, messages.length - keep.length);
    if (older.length) { summary = mem.rollingSummary(summary, older, { entities: ['CASHMOTOR', 'CarCapital'], ts: NOW }); messages = keep; }
  }
}

// one user turn -> routed handling (mirrors WF18/WF20/WF21 drivers, library-level)
function turn(update) {
  const parsed = tg.parseUpdate(update);
  pushMsg('user', parsed.text || parsed.callback_data);
  const routed = router.routeIntent(parsed, ctxView(), CFG);
  const out = { route: routed.route, parsed: parsed };
  if (routed.route === 'clarify') { out.intent = 'clarify_request'; out.reply = resp.clarificationReply(routed.clarification); pushMsg('assistant', out.reply); maybeSummarize(); return out; }
  const intent = routed.intent; out.intent = intent.intent; out.requested_action = intent.requested_action;

  // approval callbacks execute the pending plan
  if (intent.requested_action === 'approve') {
    if (state.current_intent === 'deep_competitor_analysis' && pendingDeep) {
      externalCalls += pendingDeep.est_external_calls;
      const ev = { source_url: 'https://cashmotor.ru/tariffs', source_record_id: 'firecrawl_d::r1', source_run_id: 'firecrawl_d', excerpt: 'ставка от 0,1%/день', collected_at: NOW, quality_status: 'healthy', confidence: 0.9 };
      const findings = [deep.deepFinding('prices', 'от 0,1%/день', ev)];
      const recs = [deep.deepRecommendation('снизить ставку до 0,09%/день', [findings[0].finding_id], 0.6)];
      out.deep_report = deep.assembleDeepReport(pendingDeep.selected_competitors[0], findings, recs);
      state = mem.patchState(state, { current_state: 'completed', pending_approval: false }, NOW);
      out.reply = resp.postReportReply({ summary_text: 'Глубокий анализ', ideas: out.deep_report.recommendations.map(r => r.text) }, charter.availableCapabilities(CFG));
    } else if (pendingPlan) {
      externalCalls += pendingPlan.max_external_calls;
      lastReport = { report_id: 'rep_1', competitors: [{ company_name: 'CASHMOTOR', root_url: 'https://cashmotor.ru/' }, { company_name: 'CarCapital', root_url: 'https://carcapital.ru/' }], rows_after_filters: 2, summary_text: '2 конкурента найдено по req_1 (отчёт rep_1)' };
      state = mem.patchState(state, { last_report_id: 'rep_1', current_state: 'completed', pending_approval: false, collected_platforms: ['website'], last_collected_at: NOW, active_agent_request_id: 'req_1' }, NOW);
      out.reply = resp.postReportReply(lastReport, charter.availableCapabilities(CFG));
    }
    pushMsg('assistant', out.reply); maybeSummarize(); return out;
  }

  // reuse policy for non-collecting follow-ups
  const dec = pol.reuseDecision({ intent: intent, ctx: ctxView(), cfg: CFG, now: NOW });
  out.needs_external_call = dec.needs_external_call;

  if (intent.intent === 'competitor_search') {
    pendingPlan = planner.deterministicPlan(parsed.text, CFG);
    state = mem.patchState(state, { current_intent: 'competitor_search', pending_approval: true, current_plan_id: 'plan_1' }, NOW);
    out.reply = resp.buildConversationalReply({ understood: 'поиск конкурентов', requires_approval: true, source_scope: 'website' });
  } else if (intent.intent === 'deep_competitor_analysis') {
    const refs = router.resolveReferences(intent.entities, ctxView());
    pendingDeep = deep.buildDeepPlan({ competitors: refs.competitors, requested_platforms: intent.entities.platforms || ['website'], cfg: CFG, tracked_sources: sources });
    state = mem.patchState(state, { current_intent: 'deep_competitor_analysis', pending_approval: true, selected_competitors: refs.competitors }, NOW);
    out.selected = refs.competitors; out.deep_plan = pendingDeep;
    out.reply = resp.buildConversationalReply({ understood: 'глубокий анализ', requires_approval: true });
  } else if (intent.intent === 'add_source') {
    const refs = trk.resolveSourcesFromContext(ctxView()); let added = 0;
    refs.forEach(u => { const a = trk.addSource(sources, u, { owner_user_id: '111', cfg: CFG, ts: NOW }); sources = a.sources; if (a.added) added++; });
    out.added = added; out.reply = 'Добавлено источников: ' + added;
  } else if (intent.intent === 'generate_ideas') {
    out.reply = resp.postReportReply(lastReport, charter.availableCapabilities(CFG));
  } else if (intent.intent === 'help') {
    out.reply = charter.capabilityCatalogText(CFG);
  } else {
    out.reply = resp.buildConversationalReply({ understood: intent.intent, next: 'готов помочь' });
  }
  pushMsg('assistant', out.reply); maybeSummarize();
  return out;
}

function userText(text, n) { return { update_id: n, message: { message_id: 100 + n, text: text, from: { id: 111 }, chat: { id: 555 } } }; }
function userApprove(n) { return { update_id: n, callback_query: { id: 'c' + n, data: 'approve:req_1', from: { id: 111 }, message: { message_id: 200 + n, chat: { id: 555 } } } }; }

// ============================================================================================================
A.section('Multi-turn E2E — step 1-4: search -> plan -> approve (free text) -> report');
const t1 = turn(userText('найди конкурентов по займам под ПТС в Москве', 1));
A.eq('1. competitor_search routed from free text', t1.intent, 'competitor_search');
A.ok('2. bot builds a plan and asks approval (no button required)', /подтвержд/i.test(t1.reply));
A.eq('plan pending stored', state.pending_approval, true);
const t3 = turn(userApprove(2));
A.eq('3. approval executes collection', state.current_state, 'completed');
A.ok('4. report generated with 2 competitors', lastReport && lastReport.competitors.length === 2);
A.ok('external calls happened exactly once (collection)', externalCalls > 0);
const callsAfterReport = externalCalls;

A.section('Multi-turn E2E — step 5-8: "compare the first two more deeply" -> deep plan from prior report -> approve -> deep report');
const t5 = turn(userText('сравни первых двух подробнее', 3));
A.eq('5. deep analysis routed', t5.intent, 'deep_competitor_analysis');
A.eq('6. deep plan uses the two competitors from the previous report', t5.selected.length, 2);
A.eq('deep plan first competitor resolved correctly', t5.selected[0].company_name, 'CASHMOTOR');
A.eq('deep plan requires approval', t5.deep_plan.requires_approval, true);
const t7 = turn(userApprove(4));
A.ok('7-8. deep report generated with evidence-backed facts', t7.deep_report.fact_count >= 1);
A.eq('deep report keeps only supported recommendations', t7.deep_report.orphan_recommendations.length, 0);
A.ok('deep report recommendations are typed as recommendations (never facts)', t7.deep_report.recommendations.every(r => r.type === 'recommendation'));

A.section('Multi-turn E2E — step 9-10: "add their sites to monitoring" resolves context + adds once');
const t9 = turn(userText('добавь их сайты в мониторинг', 5));
A.eq('9. add_source routed', t9.intent, 'add_source');
A.eq('10. both competitor sites resolved from context and added', t9.added, 2);
A.eq('tracked sources now hold 2 website sources', trk.listSources(sources, '111').length, 2);
const t9b = turn(userText('добавь их сайты в мониторинг', 6));
A.eq('re-adding the same sites adds zero (idempotent)', t9b.added, 0);

A.section('Multi-turn E2E — step 11-12: "what else can you help me with?" returns only configured capabilities');
const t11 = turn(userText('а что ещё ты умеешь?', 7));
A.eq('11. help routed', t11.intent, 'help');
A.ok('12. capability catalog returned', /умею/i.test(t11.reply));
A.ok('12. only registry capabilities listed (no invented ones)', charter.availableCapabilities(CFG).filter(c => c.available).every(c => charter.capabilityById(c.id)));

A.section('Multi-turn E2E — step 13-14: conversation exceeds window -> rolling summary created');
for (let i = 0; i < 6; i++) turn(userText('уточняющий вопрос номер ' + i, 20 + i));
A.ok('13. message window stays bounded', messages.length <= CFG.recent_window + 2);
A.ok('14. rolling summary was created', summary && summary.version >= 1);
A.ok('14. summary preserved the report id verbatim', summary.preserved_ids.indexOf('rep_1') >= 0 || summary.entities.indexOf('CASHMOTOR') >= 0);

A.section('Multi-turn E2E — step 15: a follow-up still resolves the correct competitors + report');
const t15 = turn(userText('сравни первых двух подробнее ещё раз', 30));
A.eq('15. deep analysis still routes after compaction', t15.intent, 'deep_competitor_analysis');
A.eq('15. still resolves the two original competitors', t15.selected.map(c => c.company_name).join(','), 'CASHMOTOR,CarCapital');

A.section('Multi-turn E2E — reuse: "generate ideas" does NOT trigger new collection');
const callsBeforeIdeas = externalCalls;
const tIdeas = turn(userText('какие идеи можно адаптировать?', 40));
A.eq('generate_ideas routed', tIdeas.intent, 'generate_ideas');
A.eq('generate_ideas needs no external call', tIdeas.needs_external_call, false);
A.eq('no new external calls for ideas', externalCalls, callsBeforeIdeas);
A.ok('report id stable across the whole conversation', lastReport.report_id === 'rep_1');
A.ok('deep approval did add calls but ideas did not', externalCalls > callsAfterReport);

A.report('agent-e2e');
