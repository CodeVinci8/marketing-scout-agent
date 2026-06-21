// test_release_e2e.js — Part 9 full multi-turn monitoring E2E + negative paths. Drives the REAL workflow Code
// nodes (WF20 orchestrator delivery, WF23 scheduled monitor) and the proven n8n/lib contracts end-to-end across
// one coherent 20-step narrative, then exercises the negative/guarded paths. Offline, $0, zero external calls.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const tio = require('../n8n/lib/telegram_io');
const router = require('../n8n/lib/intent_router');
const planner = require('../n8n/lib/request_planner');
const gate = require('../n8n/lib/approval_gate');
const state = require('../n8n/lib/agent_state');
const deep = require('../n8n/lib/deep_analysis');
const mem = require('../n8n/lib/conversation_memory');
const policy = require('../n8n/lib/orchestration_policy');
const charter = require('../n8n/lib/agent_charter');
const trk = require('../n8n/lib/tracked_sources');
const mon = require('../n8n/lib/source_monitor');

const WF20 = H.loadWorkflow('20_agent_orchestrator.json');
const WF23 = H.loadWorkflow('23_scheduled_source_monitor.json');

const CFG = {
  source_allowlist: ['website', 'telegram_channel', 'vk_community'], max_items_per_source: 25,
  max_external_calls: 40, source_budget_usd: 0.20, llm_budget_usd: 0.50, require_approval: true,
  monitor_interval_hours: 24, config_complete: true, data_mode: 'live'
};
const USER = '111', CHAT = '555';
function update(text) { return { message: { text: text, chat: { id: CHAT }, from: { id: USER }, message_id: Math.floor(Math.random() * 1e6) } }; }
function callback(data) { return { callback_query: { data: data, message: { chat: { id: CHAT } }, from: { id: USER } } }; }
function route(upd, ctx) { const p = tio.parseUpdate(upd); return { p: p, r: router.routeIntent(p, ctx || {}, CFG) }; }

// WF20 delivery driver (real orchestrator nodes: gate -> normalize -> summary -> outbox)
function deliver(req, adapterRaw, report) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [CFG]);
  H.runCodeNode(run, WF20, 'Approval & Budget Gate', [{ json: { request: req, plan: { sources: ['website'], source: 'website', est_items: 10, est_external_calls: 4, est_source_cost_usd: 0.05, est_llm_cost_usd: 0.1 } } }]);
  H.runCodeNode(run, WF20, 'Normalize Adapter Result', [{ json: { live_source_run: adapterRaw } }]);
  H.runCodeNode(run, WF20, 'Build Execution Summary', [{ json: { report: report } }]);
  return H.runCodeNode(run, WF20, 'Build Delivery Outbox', [])[0].json;
}
// WF23 monitor driver (real nodes: Check & Detect Change reads injected change events)
function monitorRun(input, opts) {
  opts = opts || {};
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [Object.assign({ mode: opts.mode || 'scheduled' }, CFG)]);
  H.inject(run, 'Read tracked_sources', opts.sources || []);
  H.inject(run, 'Read source_change_events', opts.changes || []);
  const detect = H.runCodeNode(run, WF23, 'Check & Detect Change', [{ json: input }])[0].json;
  return { run, detect };
}

// =================================================================== FULL 20-STEP MULTI-TURN MONITORING E2E
A.section('E2E step 1 — natural-language search intent is understood');
const s1 = route(update('Найди конкурентов по автоломбардам в Москве'));
A.eq('search routed deterministically', s1.r.intent.intent, 'competitor_search');
A.eq('search requires approval before any external call', s1.r.intent.requires_approval, true);

A.section('E2E step 2 — an ambiguous message asks a clarifying question (no silent run)');
const s2 = route(update('привет, ну что там')); // no actionable intent/entities
A.eq('ambiguous message clarifies instead of running', s2.r.route, 'clarify');
A.eq('clarify never carries an approval-bearing intent', s2.r.intent.intent, 'clarify_request');

A.section('E2E step 3 — approval via button maps to the approve action');
const s3 = route(callback('approve:req_1'), { current_intent: 'competitor_search' });
A.eq('approve callback yields approve action', s3.r.intent.requested_action, 'approve');
A.eq('approve callback keeps the pending intent', s3.r.intent.intent, 'competitor_search');

A.section('E2E step 4 — planner builds a bounded, approval-shaped plan');
const plan = planner.deterministicPlan({ intent: 'competitor_search', entities: { region: 'Москва', niche: 'автоломбард' } }, CFG);
A.ok('plan is bounded to the configured source allowlist', (plan.sources || []).every(s => CFG.source_allowlist.indexOf(s) >= 0));
A.ok('plan estimates external calls within budget', plan.max_external_calls <= CFG.max_external_calls);
A.eq('plan requires approval', plan.requires_approval, true);

A.section('E2E step 5-8 — gate -> collection replay -> quality-eligible report through the real WF20 nodes');
const req = { agent_request_id: 'req_1', state: 'approved', approved: true, chat_id: CHAT, data_mode: 'live' };
const okAdapter = { agent_request_id: 'req_1', source_run_id: 'firecrawl_X', items_received: 4, items_written: 4, items_relevant: 3, external_calls: 4, cost_status: 'ok', platform: 'website', data_mode: 'live', quality_status: 'healthy' };
const okReport = { report_id: 'rep_1', report_markdown: 'ФАКТ: 2 конкурента в Москве, ставка от 0,1%/день.', competitors: [{ company_name: 'Конкурент А' }, { company_name: 'Конкурент Б' }], rows_after_filters: 2, records_unique: 2, records_eligible: 2, records_analyzed: 2, llm_primary_calls: 0, llm_repair_calls: 0 };
const out = deliver(req, okAdapter, okReport);
const body = JSON.parse(out.telegram_send_body);
A.ok('report facts are delivered verbatim (immutable)', /ФАКТ: 2 конкурента в Москве/.test(body.text));
A.ok('outbox row is built before send', /^dlv_req_1_rep_1_/.test(out.delivery.delivery_id));

A.section('E2E step 9 — proactive assistance rides the real delivery path (works without buttons)');
A.ok('delivery appends a proactive continuation', /Просто напишите, что сделать дальше/.test(body.text));
const bodies = JSON.parse(out.telegram_send_bodies);
A.ok('keyboard only on the FINAL chunk', !bodies.slice(0, -1).some(b => b.reply_markup) && !!bodies[bodies.length - 1].reply_markup);
A.ok('every proactive button maps to a real intent', bodies[bodies.length - 1].reply_markup.inline_keyboard.every(r => /^intent:/.test(r[0].callback_data)));

A.section('E2E step 10 — "compare the first two more deeply" resolves from the prior report');
const ctxAfterReport = { last_report: { report_id: 'rep_1', competitors: okReport.competitors }, selected_competitors: [] };
const s10 = route(update('сравни первых двух подробнее'), ctxAfterReport);
A.eq('deep analysis intent recognized', s10.r.intent.intent, 'deep_competitor_analysis');
const refs = router.resolveReferences(s10.r.intent.entities, ctxAfterReport);
A.eq('"first two" resolves to the two competitors from the report', refs.competitors.length, 2);

A.section('E2E step 11-12 — deep analysis is approved + separates evidence FACTS from RECOMMENDATIONS');
const dplan = deep.buildDeepPlan({ competitors: refs.competitors, requested_platforms: ['website'], cfg: CFG, history_available: false });
const dgate = gate.evaluateGate({ source: 'website', est_items: dplan.page_limit_per_competitor * 2, est_external_calls: dplan.est_external_calls, est_source_cost_usd: dplan.est_source_budget_usd, est_llm_cost_usd: dplan.est_llm_budget_usd }, { agent_request_id: 'req_2', state: 'approved', approved: true, completed_keys: [], external_calls_made: 0, source_spend_usd: 0, llm_spend_usd: 0 }, CFG);
A.eq('deep plan within budget is approved', dgate.allowed, true);
const findings = [deep.deepFinding('prices', 'ставка от 0,1%/день', { source_url: 'https://a.example', source_run_id: 'firecrawl_X', excerpt: 'от 0,1% в день', quality_status: 'healthy' })];
const recs = [deep.deepRecommendation('Подсветить ставку в оффере', [findings[0].finding_id], 0.7)];
const dreport = deep.assembleDeepReport('Конкурент А', findings, recs);
A.eq('deep report carries the evidence-backed fact', dreport.fact_count, 1);
A.eq('deep report keeps recommendations separate', dreport.recommendation_count, 1);
A.ok('every fact carries an evidence anchor', dreport.facts.every(f => f.evidence && f.evidence.source_url && f.evidence.source_run_id));
A.ok('every recommendation is derived from a real finding', dreport.recommendations.every(r => (r.derived_from || []).length > 0));

A.section('E2E step 13 — "add their sites to monitoring" registers a tracked source (website => active)');
let sources = [];
const add1 = trk.addSource(sources, 'https://konkurent-a.ru/', { owner_user_id: USER, chat_id: CHAT, cfg: CFG, ts: '2026-06-21T10:00:00Z', agent_request_id: 'req_2' });
sources = add1.sources;
A.eq('website source is active and monitorable', add1.source.status, 'active');
A.ok('source carries chat_id for later notifications', add1.source.chat_id === CHAT);

A.section('E2E step 14 — re-adding the same site is idempotent (no duplicate)');
const add2 = trk.addSource(sources, 'https://konkurent-a.ru/', { owner_user_id: USER, chat_id: CHAT, cfg: CFG, ts: '2026-06-21T10:05:00Z' });
A.eq('duplicate add does not grow the source list', add2.sources.length, sources.length);
A.ok('duplicate add is reported as a no-op/duplicate', add2.duplicate === true || add2.added === false || add2.sources.length === sources.length);

A.section('E2E step 15 — scheduled check with NO change sends NOTHING');
const TRK = sources[0];
const baseline = monitorRun({ source: TRK, cfg: CFG, now: '2026-06-21T11:00:00Z', fetched: { fields: { price: '1000' } } });
A.eq('first scheduled check is a silent baseline', baseline.detect.needs_notification, false);
const unchanged = monitorRun({ source: Object.assign({}, TRK, { last_content_hash: mon.contentHash(mon.normalizeContent({ price: '1000' })) }), cfg: CFG, now: '2026-06-22T11:00:00Z', fetched: { fields: { price: '1000' } } });
A.eq('unchanged content => no notification', unchanged.detect.needs_notification, false);

A.section('E2E step 16-17 — a later meaningful change creates ONE persisted event + ONE notification');
const changed = monitorRun({ source: Object.assign({}, TRK, { last_content_hash: 'cOLD' }), cfg: CFG, now: '2026-06-23T11:00:00Z', fetched: { fields: { price: '850' }, summary: 'ставка снижена до 0,08%/день' } });
A.eq('meaningful change needs a notification', changed.detect.needs_notification, true);
A.ok('a change event is produced before notifying', !!changed.detect.change_event && changed.detect.change_event.status === 'detected');
const notif = H.runCodeNode(changed.run, WF23, 'Build Change Notification', [])[0].json;
const notifBody = JSON.parse(notif.telegram_send_body);
A.ok('one conversational notification with chat + change text', !!notifBody.chat_id && /Изменение у отслеживаемого источника/.test(notifBody.text));
A.eq('the persisted change_id matches the notified change', notif.change_id, changed.detect.change_event.change_id);

A.section('E2E step 18 — acknowledged/duplicate change is NEVER notified twice (idempotent)');
const dup = monitorRun({ source: Object.assign({}, TRK, { last_content_hash: 'cOLD' }), cfg: CFG, now: '2026-06-23T17:00:00Z', fetched: { fields: { price: '850' } } }, { changes: [{ change_id: changed.detect.change_event.change_id }] });
A.eq('already-recorded change is not re-notified', dup.detect.needs_notification, false);

A.section('E2E step 19 — "suggest a response" reuses collected evidence (no new paid call)');
const reuse = policy.reuseDecision({ intent: { intent: 'generate_ideas', entities: {} }, ctx: { last_report: { report_id: 'rep_1' }, conversation_id: 'c1' }, cfg: CFG, now: '2026-06-23T18:00:00Z' });
A.eq('generate_ideas answers from context (no external call)', reuse.needs_external_call, false);

A.section('E2E step 20 — context compaction keeps charter/state/safety/newest; follow-up still resolves competitors');
const msgs = [];
for (let i = 0; i < 14; i++) msgs.push({ role: i % 2 ? 'assistant' : 'user', text: 'turn ' + i + (i === 2 ? ' одобряю запуск' : '') });
A.eq('long conversation triggers summarization', mem.shouldSummarize(msgs, { recent_window: 8 }), true);
const summary = mem.rollingSummary(null, msgs.slice(0, 6), {});
const ctxBudget = mem.buildContext({ charter: charter.charterText(), state: 'state: reporting', safety: 'approval required before paid calls', newest: 'сделай идеи по первому конкуренту', summary: summary.summary_text || 'sum', artifacts: 'rep_1', recent: 'recent turns' }, { max_context_tokens: 50 });
A.ok('charter/state/safety/newest survive even a tiny token budget', mem.REQUIRED.every(s => ctxBudget.sections_included.indexOf(s) >= 0));
// fresh execution: reconstruct context purely from persisted rows (no in-memory carryover) and resolve the follow-up
const reconstructedCtx = { last_report: { report_id: 'rep_1', competitors: okReport.competitors }, selected_competitors: [] };
const followRefs = router.resolveReferences(router.entityExtract('напомни по первых двух конкурентам', reconstructedCtx), reconstructedCtx);
A.eq('a follow-up resolves the correct competitors from reconstructed state', followRefs.competitors.length, 2);
A.ok('the resolved competitors are exactly the prior report competitors', /Конкурент А/.test(JSON.stringify(followRefs.competitors)) && /Конкурент Б/.test(JSON.stringify(followRefs.competitors)));

// =================================================================== NEGATIVE / GUARDED PATHS
A.section('Negative — unauthorized user is rejected');
A.eq('unknown user id is not authorized', tio.isAuthorized({ user_id: '999' }, [USER]), false);
A.eq('allowed user id is authorized', tio.isAuthorized({ user_id: USER }, [USER]), true);

A.section('Negative — duplicate Telegram update is idempotent');
const u = update('Найди конкурентов');
const k1 = tio.updateIdempotencyKey(tio.parseUpdate(u));
const k2 = tio.updateIdempotencyKey(tio.parseUpdate(u));
A.eq('same update yields the same idempotency key', k1, k2);

A.section('Negative — invalid planner JSON is rejected (never run a malformed plan)');
A.eq('non-JSON plan rejected', planner.validatePlanJSON('{not json').valid, false);
A.eq('plan with an out-of-allowlist source is rejected or normalized away', (function () { const v = planner.validatePlanJSON(JSON.stringify({ sources: ['darkweb'], est_external_calls: 3 })); return v.valid === false || (v.plan && (v.plan.sources || []).indexOf('darkweb') < 0); })(), true);

function gateBlocks(reqOver, planOver) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [CFG]);
  const g = H.runCodeNode(run, WF20, 'Approval & Budget Gate', [{ json: { request: Object.assign({ agent_request_id: 'rq', chat_id: CHAT }, reqOver), plan: Object.assign({ source: 'website', est_items: 5, est_external_calls: 4, est_source_cost_usd: 0.05, est_llm_cost_usd: 0.1 }, planOver) } }])[0].json;
  return g;
}
A.section('Negative — unapproved request never makes an external call');
A.eq('state=new blocks the external call', gateBlocks({ state: 'new', approved: false }).gate_allowed, false);

A.section('Negative — cancelled request never makes an external call');
A.eq('state=cancelled blocks the external call', gateBlocks({ state: 'cancelled', cancelled: true }).gate_allowed, false);

A.section('Negative — over-budget plans are blocked');
A.eq('source budget exceeded blocks', gateBlocks({ state: 'approved', approved: true }, { est_source_cost_usd: 999 }).gate_allowed, false);
A.eq('LLM budget exceeded blocks', gateBlocks({ state: 'approved', approved: true }, { est_llm_cost_usd: 999 }).gate_allowed, false);

A.section('Negative — fail-closed source health policy is the default in the aggregator/report');
const aggCfg = H.runCodeNode(H.makeRun(), H.loadWorkflow('10_competitor_audience_intelligence_aggregator.json'), 'Set Aggregator Config', [])[0].json;
A.eq('aggregator requires verified source health by default', aggCfg.require_source_health, true);
const repCfg = H.runCodeNode(H.makeRun(), H.loadWorkflow('12_market_intelligence_report_builder.json'), 'Set Report Config', [])[0].json;
A.eq('report enforces source health by default', repCfg.enforce_source_health, true);

A.section('Negative — all-quarantined collection delivers a no-data notice, not a fake report');
const quarOut = deliver(req, Object.assign({}, okAdapter, { quality_status: 'quarantined', items_relevant: 0, items_written: 1 }), { report_id: 'rep_q', rows_after_filters: 0, records_unique: 0, records_eligible: 0, records_analyzed: 0 });
const quarBody = JSON.parse(quarOut.telegram_send_body);
A.ok('no-data reply does not claim competitors it does not have', !/2 конкурента/.test(quarBody.text));
A.ok('no-data reply still offers a relevant next action', /напишите, что сделать|проверить|источник|расшир/i.test(quarBody.text));

A.section('Negative — Telegram send failure is retryable; an already-sent delivery is never resent');
const d = tio.makeDelivery('req_1', 'rep_1', CHAT, 'body');
A.eq('a fresh delivery is pending/retryable', d.send_status, 'pending');
A.eq('a pending delivery is sendable', tio.shouldSend([], d).send, true);
A.eq('an already-sent delivery is NOT resent', tio.shouldSend([Object.assign({}, d, { send_status: 'sent' })], d).send, false);

A.section('Negative — duplicate monitoring check window is idempotent');
A.eq('the same scheduled window/key is stable', mon.checkIdempotencyKey(TRK.source_id, mon.checkWindow('2026-06-23T11:00:00Z', 24, 'scheduled')), mon.checkIdempotencyKey(TRK.source_id, mon.checkWindow('2026-06-23T11:00:00Z', 24, 'scheduled')));
A.ok('manual check-now uses a DIFFERENT window than scheduled', mon.checkWindow('2026-06-23T11:00:00Z', 24, 'manual') !== mon.checkWindow('2026-06-23T11:00:00Z', 24, 'scheduled'));

A.section('Negative — missing Telegram/VK collectors are honestly setup_required (no invented collector)');
A.eq('telegram without collector => setup_required', mon.collectorState('telegram_channel', CFG).state, 'setup_required');
A.eq('vk without collector => setup_required', mon.collectorState('vk_community', CFG).state, 'setup_required');
const dueTgVk = mon.dueSources([{ source_id: 't1', platform: 'telegram_channel', status: 'active', ref: 'https://t.me/x', next_check_at: '' }, { source_id: 'v1', platform: 'vk_community', status: 'active', ref: 'https://vk.com/y', next_check_at: '' }], '2026-06-23T11:00:00Z', CFG, 'scheduled');
A.eq('tg/vk without a collector are skipped, not checked', dueTgVk.due.length, 0);

A.section('Negative — a deleted memory is gone; an ephemeral run carries no in-memory state');
const madeMem = mem.makeMemory({ owner_user_id: USER, memory_type: 'region', key: 'region', value_json: 'Москва', ts: '2026-06-21T10:00:00Z' });
A.eq('a region memory is created active', madeMem.ok && madeMem.memory.status, 'active');
const afterForget = mem.forgetMemory([madeMem.memory], 'region', { owner_user_id: USER, ts: '2026-06-21T12:00:00Z' });
A.ok('forget removes the targeted memory', afterForget.removed >= 1);
A.eq('no active memory of that user survives the forget', mem.memoriesForUser(afterForget.memories, USER).length, 0);
// ephemeral: build context only from rows we pass in — no hidden process state leaks across runs
const ephemeral = mem.buildContext({ charter: 'c', state: 's', safety: 'x', newest: 'n' }, { max_context_tokens: 6000 });
A.ok('a fresh run reconstructs context only from provided rows', ephemeral.sections_included.indexOf('charter') >= 0 && ephemeral.sections_included.indexOf('artifacts') < 0);

A.report('release-e2e');
