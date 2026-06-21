// test_stage4_contracts.js — Stage 4 core contracts (libs): config, state machine, approval/budget gate,
// source adapter, request planner, telegram gateway/outbox, execution summary. $0, no network, no Claude.
'use strict';
const A = require('./_assert');
const CFG = require('../n8n/lib/agent_config.js');
const ST = require('../n8n/lib/agent_state.js');
const GATE = require('../n8n/lib/approval_gate.js');
const ADP = require('../n8n/lib/source_adapter.js');
const PLN = require('../n8n/lib/request_planner.js');
const TG = require('../n8n/lib/telegram_io.js');
const SUM = require('../n8n/lib/execution_summary.js');

// ---------------------------------------------------------------------------------------------------------
A.section('agent_config — one resolved config from $env; fail-closed defaults; no secrets');
const def = CFG.resolveConfig({});
A.eq('default require_approval=true (fail-closed)', def.require_approval, true);
A.eq('default require_source_health=true', def.require_source_health, true);
A.eq('default LLM planner OFF', def.enable_llm_planner, false);
A.eq('default LLM summary OFF', def.enable_llm_summary, false);
A.eq('default source allowlist = website only', def.source_allowlist.join(','), 'website');
A.eq('blank env => config_complete false (missing id + users)', def.config_complete, false);
A.ok('missing names surfaced', def.missing.indexOf('MS_SPREADSHEET_ID') >= 0 && def.missing.indexOf('MS_TELEGRAM_ALLOWED_USER_IDS') >= 0);
const env = { MS_SPREADSHEET_ID: 'SHEET123', MS_TELEGRAM_ALLOWED_USER_IDS: '111,222', MS_LLM_BUDGET_USD: '0.75', MS_SOURCE_ALLOWLIST: 'website, avito' };
const live = CFG.resolveConfig(env);
A.eq('env spreadsheet id resolved once', live.spreadsheet_id, 'SHEET123');
A.eq('env llm budget parsed', live.llm_budget_usd, 0.75);
A.eq('env allowlist parsed', live.source_allowlist.join(','), 'website,avito');
A.eq('config_complete when id+users present', live.config_complete, true);
A.ok('allowed user check', CFG.isAllowedUser(live, '111') && !CFG.isAllowedUser(live, '999'));
A.ok('source allowed check', CFG.sourceAllowed(live, 'website') && !CFG.sourceAllowed(live, 'vk'));
A.ok('config carries no token-shaped secret', JSON.stringify(live).indexOf('sk-ant') < 0 && JSON.stringify(live).indexOf('apify_api_') < 0);

// ---------------------------------------------------------------------------------------------------------
A.section('agent_state — validated transitions, terminal absorbing, no external call after cancel');
A.ok('received -> classified valid', ST.canTransition('received', 'classified'));
A.ok('received -> analyzing INVALID (no skipping)', !ST.canTransition('received', 'analyzing'));
A.ok('cancel from any live state', ST.canTransition('collecting', 'cancelled') && ST.canTransition('awaiting_approval', 'cancelled'));
A.ok('terminal is absorbing', !ST.canTransition('completed', 'delivering') && !ST.canTransition('cancelled', 'approved'));
const tr = ST.transition({ agent_request_id: 'r1', state: 'awaiting_approval' }, 'approved', {});
A.ok('transition ok + event accepted', tr.ok && tr.event.accepted && tr.state === 'approved');
const bad = ST.transition({ agent_request_id: 'r1', state: 'received' }, 'reporting', {});
A.ok('invalid transition rejected with event', !bad.ok && bad.event.accepted === false && bad.state === 'received');
A.ok('cancelled blocks external calls', !ST.canMakeExternalCall('cancelled'));
A.ok('completed blocks external calls', !ST.canMakeExternalCall('completed'));
A.ok('collecting allows external calls', ST.canMakeExternalCall('collecting'));

// ---------------------------------------------------------------------------------------------------------
A.section('approval_gate — every paid call fails closed (approval, cancel, budgets, idempotency)');
const gcfg = CFG.resolveConfig(env, { source_allowlist: ['website'] });
const okCtx = { agent_request_id: 'r1', state: 'collecting', approved: true, cancelled: false, completed_keys: [], external_calls_made: 0, source_spend_usd: 0, llm_spend_usd: 0 };
const okPlan = { source: 'website', est_items: 10, est_external_calls: 3, est_source_cost_usd: 0.05, est_llm_cost_usd: 0.10 };
A.ok('approved+in-budget+allowed => allowed', GATE.evaluateGate(okPlan, okCtx, gcfg).allowed);
A.ok('unapproved => blocked not_approved', /not_approved/.test(GATE.evaluateGate(okPlan, Object.assign({}, okCtx, { approved: false }), gcfg).reason));
A.ok('cancelled => blocked request_not_active', /request_not_active/.test(GATE.evaluateGate(okPlan, Object.assign({}, okCtx, { cancelled: true }), gcfg).reason));
A.ok('source not in allowlist => blocked', /source_not_allowed/.test(GATE.evaluateGate(Object.assign({}, okPlan, { source: 'vk' }), okCtx, gcfg).reason));
A.ok('over item limit => blocked', /over_item_limit/.test(GATE.evaluateGate(Object.assign({}, okPlan, { est_items: 9999 }), okCtx, gcfg).reason));
A.ok('over source budget => blocked', /over_source_budget/.test(GATE.evaluateGate(Object.assign({}, okPlan, { est_source_cost_usd: 999 }), okCtx, gcfg).reason));
A.ok('over llm budget => blocked', /over_llm_budget/.test(GATE.evaluateGate(Object.assign({}, okPlan, { est_llm_cost_usd: 999 }), okCtx, gcfg).reason));
const key = GATE.idempotencyKey('r1', 'website', 1);
A.eq('idempotency key deterministic', key, GATE.idempotencyKey('r1', 'WEBSITE', 1));
A.ok('already-completed unit => blocked', /already_completed/.test(GATE.evaluateGate(okPlan, Object.assign({}, okCtx, { completed_keys: [key] }), gcfg).reason));

// ---------------------------------------------------------------------------------------------------------
A.section('source_adapter — canonical result + collection rollup (partial / no_data / complete)');
const okRes = ADP.normalizeAdapterResult('website', { agent_request_id: 'r1', source_run_id: 'firecrawl_X', items_received: 4, items_written: 4, items_relevant: 3, external_calls: 4, cost_status: 'unknown', platform: 'website', data_mode: 'live' });
A.eq('website is first_class', okRes.first_class, true);
A.eq('unknown cost preserved (never fake $0)', okRes.cost_status, 'unknown');
A.eq('unknown cost_usd stays null', okRes.cost_usd, null);
A.eq('healthy write => status ok', okRes.status, 'ok');
const quar = ADP.normalizeAdapterResult('avito', { source_run_id: 'avito_1', items_received: 3, items_written: 0, quality_status: 'quarantined' });
A.eq('quarantined detected', quar.quarantined, true);
A.eq('avito is experimental', quar.experimental, true);
const fail = ADP.normalizeAdapterResult('website', { source_run_id: 'w2', items_written: 0, error: 'timeout' });
A.eq('error+no write => failed', fail.status, 'failed');
A.eq('rollup complete', ADP.rollupCollection([okRes]).outcome, 'complete');
A.eq('rollup partial (one ok one fail)', ADP.rollupCollection([okRes, fail]).outcome, 'partial');
A.eq('rollup no_data (all quarantined)', ADP.rollupCollection([quar]).outcome, 'no_data');
A.eq('rollup no_data (empty)', ADP.rollupCollection([]).outcome, 'no_data');

// ---------------------------------------------------------------------------------------------------------
A.section('request_planner — deterministic plan always exists; LLM JSON validated or falls back');
const pcfg = CFG.resolveConfig(env, { source_allowlist: ['website', 'avito'] });
const dp = PLN.deterministicPlan('конкуренты по займам под ПТС в Москве, посмотри их сайты', pcfg);
A.eq('niche parsed = pts_loan', dp.niche, 'pts_loan');
A.eq('region parsed = Москва/МО', dp.region, 'Москва/МО');
A.ok('website source chosen', dp.sources.indexOf('website') >= 0);
A.ok('deterministic plan requires approval (fail-closed)', dp.requires_approval === true);
A.ok('plan clamps items to cfg', dp.max_items <= pcfg.max_items_per_source);
const inv1 = PLN.validatePlanJSON('this is not json', pcfg);
A.ok('invalid JSON => not valid (no external work)', !inv1.valid && inv1.reason === 'not_json');
const inv2 = PLN.validatePlanJSON(JSON.stringify({ region: 'Москва', max_items: 10 }), pcfg);
A.ok('no sources => invalid', !inv2.valid && inv2.reason === 'no_sources');
const good = PLN.validatePlanJSON(JSON.stringify({ intent: 'scan', niche: 'credit_brokerage', region: 'Москва', sources: ['website', 'vk'], max_items: 9999 }), pcfg);
A.ok('valid LLM plan => plan_source=llm', good.valid && good.plan.plan_source === 'llm');
A.ok('LLM plan filtered to allowlist (vk dropped)', good.plan.sources.indexOf('vk') < 0 && good.plan.sources.indexOf('website') >= 0);
A.ok('LLM plan max_items clamped to budget', good.plan.max_items <= pcfg.max_items_per_source);
A.ok('approval text shows sources + budgets', /Источники/.test(PLN.planToApprovalText(dp)) && /Бюджет/.test(PLN.planToApprovalText(dp)));

// ---------------------------------------------------------------------------------------------------------
A.section('telegram_io — intake parse/auth/dedup + outbox dedupe + escaping/chunking');
const upReq = TG.parseUpdate({ update_id: 500, message: { message_id: 9, text: 'найди конкурентов', from: { id: 111 }, chat: { id: 777 } } });
A.eq('plain text => request', upReq.kind, 'request');
A.eq('status command parsed', TG.parseUpdate({ update_id: 1, message: { text: '/status', from: { id: 111 }, chat: { id: 1 } } }).kind, 'status');
A.eq('cancel command parsed', TG.parseUpdate({ update_id: 2, message: { text: '/cancel', from: { id: 111 }, chat: { id: 1 } } }).kind, 'cancel');
const upCb = TG.parseUpdate({ update_id: 3, callback_query: { data: 'approve:req_9', from: { id: 111 }, message: { message_id: 5, chat: { id: 777 } } } });
A.eq('callback parsed', upCb.kind, 'callback');
A.eq('callback action+id parsed', TG.parseCallback(upCb.callback_data).action + ':' + TG.parseCallback(upCb.callback_data).agent_request_id, 'approve:req_9');
A.ok('authorized user accepted, others rejected', TG.isAuthorized(upReq, ['111']) && !TG.isAuthorized(upReq, ['999']));
A.eq('same update_id => same idempotency key (dedupe)', TG.updateIdempotencyKey(upReq), TG.updateIdempotencyKey(TG.parseUpdate({ update_id: 500, message: { message_id: 9, chat: { id: 777 } } })));
A.ok('markdown escaping neutralizes specials', TG.escapeMarkdown('a_b*c[d]').indexOf('\\_') >= 0);
const chunks = TG.chunkMessage('line\n'.repeat(2000), 1000);
A.ok('long message chunked under limit', chunks.length > 1 && chunks.every(c => c.length <= 1000));
const dlv = TG.makeDelivery('r1', 'rep1', '777', 'final report body');
A.eq('delivery id deterministic in payload', dlv.delivery_id, TG.makeDelivery('r1', 'rep1', '777', 'final report body').delivery_id);
A.eq('retry does not resend already-sent delivery', TG.shouldSend([Object.assign({}, dlv, { send_status: 'sent' })], dlv).send, false);
A.eq('fresh delivery sends', TG.shouldSend([], dlv).send, true);

// ---------------------------------------------------------------------------------------------------------
A.section('execution_summary — one canonical diagnostic; unknown cost stays unknown');
const sum = SUM.buildExecutionSummary({
  config_complete: true,
  request: { agent_request_id: 'r1', state: 'partial' },
  plan: { sources: ['website', 'avito'] },
  collection: { outcome: 'partial', sources_ok: 1, sources_failed: 1, sources_quarantined: 0, items_written: 4 },
  adapters: [okRes, fail],
  analysis: { records_unique: 4, records_eligible: 3, records_analyzed: 3, llm_primary_calls: 3, llm_repair_calls: 1, llm_cost_status: 'unknown' },
  aggregation: { rows_after_filters: 3 },
  report: { report_id: 'rep1' },
  delivery: { send_status: 'sent' }
});
A.eq('summary final_state', sum.final_state, 'partial');
A.eq('summary counts analyzed', sum.records_analyzed, 3);
A.eq('summary separates primary/repair calls', sum.llm_primary_calls + '/' + sum.llm_repair_calls, '3/1');
A.eq('summary keeps llm cost unknown', sum.llm_cost_status, 'unknown');
A.eq('summary source cost unknown (adapter unknown)', sum.source_cost_status, 'unknown');
A.ok('summary gives one next action', /partial report/.test(sum.next_operator_action));

A.report('stage4-contracts');
