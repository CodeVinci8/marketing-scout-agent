// test_stage4_e2e.js — Stage 4 mocked end-to-end replay. Drives the seven n8n/lib/* contracts against the
// sanitized replay fixtures through the whole agent lifecycle:
//   Telegram -> plan -> approval -> website -> WF16 -> WF08 -> WF10 -> WF12 -> outbox -> completed.
// Every "external call" is counted by a single mock collector that ONLY runs when the approval gate allows,
// so the negative paths can prove ZERO external calls. No network, no credentials, $0.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');

const cfgLib = require('../n8n/lib/agent_config');
const state = require('../n8n/lib/agent_state');
const planner = require('../n8n/lib/request_planner');
const gate = require('../n8n/lib/approval_gate');
const adapter = require('../n8n/lib/source_adapter');
const tg = require('../n8n/lib/telegram_io');
const exec = require('../n8n/lib/execution_summary');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'fixtures', 'stage4', 'replay_fixtures.json'), 'utf8'));

// Resolved config for the replay operator (user 111111111, website-only, approval required, summary OFF).
function makeConfig(over) {
  return cfgLib.resolveConfig(
    { MS_SPREADSHEET_ID: 'sheet_replay', MS_TELEGRAM_ALLOWED_USER_IDS: '111111111' },
    Object.assign({ source_allowlist: ['website'], max_items_per_source: 25, max_external_calls: 40, source_budget_usd: 0.20, llm_budget_usd: 0.50, require_approval: true, enable_llm_planner: false, enable_llm_summary: false }, over || {})
  );
}

// ---- the mock runtime: one path, one external-call counter -------------------------------------------------
// Replays a request from a raw Telegram update through the full lifecycle using ONLY the libraries.
function runRequest(update, opts) {
  opts = opts || {};
  const cfg = opts.cfg || makeConfig();
  const trace = { external_calls: 0, llm_calls: 0, events: [], adapters: [], state: 'received', request: null, plan: null, gate_reasons: [], delivery: null, summary: null };

  // 1. INTAKE — parse + authorize + duplicate-update protection
  const parsed = tg.parseUpdate(update);
  const idemKey = tg.updateIdempotencyKey(parsed);
  const seen = opts.seen_update_keys || [];
  if (parsed.kind !== 'request') { trace.outcome = 'not_a_request'; return trace; }
  if (!tg.isAuthorized(parsed, cfg.telegram_allowed_user_ids)) { trace.outcome = 'unauthorized'; return trace; }
  if (seen.indexOf(idemKey) >= 0) { trace.outcome = 'duplicate'; return trace; }
  const rec = { agent_request_id: opts.agent_request_id || 'req_replay_0001', state: 'received', chat_id: parsed.chat_id, approved: false };
  trace.request = rec;
  trace.idempotency_key = idemKey;

  // 2. CLASSIFY + PLAN — deterministic plan, or guarded-LLM plan that fell back on invalid JSON
  let t = state.transition(rec, 'classified', { reason: 'parsed' }); trace.events.push(t.event); rec.state = t.state;
  let plan;
  if (opts.planner_raw_json !== undefined) {
    const v = planner.validatePlanJSON(opts.planner_raw_json, cfg);
    plan = v.valid ? v.plan : planner.deterministicPlan(parsed.text, cfg); // invalid LLM JSON => deterministic; never blocks
    trace.plan_valid = v.valid; trace.plan_reason = v.reason;
  } else {
    plan = planner.deterministicPlan(parsed.text, cfg);
  }
  trace.plan = plan;

  // 3. AWAIT APPROVAL — request parks until the operator approves (or cancels)
  t = state.transition(rec, 'awaiting_approval', { reason: 'plan_built' }); trace.events.push(t.event); rec.state = t.state;
  if (opts.cancel_before_approval) {
    t = state.transition(rec, 'cancelled', { reason: 'user_cancel' }); trace.events.push(t.event); rec.state = t.state;
    trace.state = rec.state; trace.outcome = 'cancelled'; return trace;
  }
  if (!opts.approve) { trace.state = rec.state; trace.outcome = 'awaiting_approval'; return trace; }
  t = state.transition(rec, 'approved', { reason: 'operator_approved' }); trace.events.push(t.event); rec.state = t.state;
  rec.approved = true;

  // 4. COLLECT — gate EACH source; the mock collector only fires when the gate allows -> counts external calls
  t = state.transition(rec, 'collecting', { reason: 'approved' }); trace.events.push(t.event); rec.state = t.state;
  const gctx = { agent_request_id: rec.agent_request_id, state: rec.state, cancelled: false, approved: true, completed_keys: opts.completed_keys ? opts.completed_keys.slice() : [], external_calls_made: 0, source_spend_usd: 0, llm_spend_usd: 0 };
  const perSourceCalls = 4;
  for (const source of plan.sources) {
    const gplan = { source: source, attempt: 1, est_items: plan.max_items, est_external_calls: perSourceCalls, est_source_cost_usd: plan.est_source_cost_usd, est_llm_cost_usd: 0 };
    const g = gate.evaluateGate(gplan, gctx, cfg);
    if (!g.allowed) { trace.gate_reasons.push(g.reason); continue; }
    // gate allowed -> the ONLY place an external collector runs
    const raws = (opts.source_runs && opts.source_runs[source]) || [];
    for (const raw of raws) {
      trace.external_calls += Number(raw.external_calls || 0);
      const norm = adapter.normalizeAdapterResult(source, raw, { agent_request_id: rec.agent_request_id });
      trace.adapters.push(norm);
    }
    gctx.completed_keys.push(g.idempotency_key);
    gctx.external_calls_made += perSourceCalls;
    gctx.source_spend_usd += plan.est_source_cost_usd;
  }
  trace.completed_keys = gctx.completed_keys;

  // 5. QUALITY + ANALYSIS rollup -> partial / no_data / complete
  const roll = adapter.rollupCollection(trace.adapters);
  trace.rollup = roll;
  t = state.transition(rec, 'quality_check', { reason: 'collected' }); trace.events.push(t.event); rec.state = t.state;

  if (roll.outcome === 'no_data') {
    t = state.transition(rec, 'partial', { reason: 'no_eligible_data' }); trace.events.push(t.event); rec.state = t.state;
    trace.state = rec.state;
    trace.summary = exec.buildExecutionSummary({ request: rec, collection: roll, adapters: trace.adapters, config_complete: cfg.config_complete });
    trace.outcome = 'no_data'; return trace;
  }

  // analysis/aggregation/report facts come from the replay fixtures (WF08/WF10/WF12 outputs)
  const analysis = opts.analysis || FIX.wf08_analysis_output;
  const report = opts.report || FIX.wf12_report;
  trace.llm_calls += Number(analysis.llm_primary_calls || 0) + Number(report.llm_primary_calls || 0);

  t = state.transition(rec, 'analyzing', { reason: 'quality_ok' }); trace.events.push(t.event); rec.state = t.state;
  t = state.transition(rec, 'aggregating', { reason: 'analyzed' }); trace.events.push(t.event); rec.state = t.state;
  t = state.transition(rec, 'reporting', { reason: 'aggregated' }); trace.events.push(t.event); rec.state = t.state;

  // 6. DELIVER — outbox (payload hash) then mark sent; retries cannot double-send
  t = state.transition(rec, 'delivering', { reason: 'report_built' }); trace.events.push(t.event); rec.state = t.state;
  const payload = report.summary_text || 'report';
  const delivery = tg.makeDelivery(rec.agent_request_id, report.report_id, rec.chat_id, payload);
  const decision = tg.shouldSend(opts.existing_deliveries || [], delivery);
  if (decision.send) { delivery.send_status = 'sent'; delivery.attempts = 1; delivery.telegram_message_id = 'tg_msg_1'; }
  trace.delivery = delivery; trace.delivery_decision = decision;

  // 7. FINAL STATE — complete vs partial
  const finalState = roll.outcome === 'partial' ? 'partial' : 'completed';
  t = state.transition(rec, finalState, { reason: 'delivered' }); trace.events.push(t.event); rec.state = t.state;
  trace.state = rec.state;
  trace.summary = exec.buildExecutionSummary({
    request: rec, plan: plan, collection: roll, adapters: trace.adapters,
    analysis: analysis, aggregation: FIX.wf10_aggregation_output, report: report,
    delivery: delivery, config_complete: cfg.config_complete
  });
  trace.outcome = finalState;
  return trace;
}

// website source-runs for the canonical happy path: ONE healthy website run (page-level quarantine of
// CarCapital is a downstream WF16/WF08 record gate, not a source-level failure).
const HEALTHY_WEBSITE = [Object.assign({}, FIX.firecrawl_cashmotor_healthy.summary, { items_written: 2, items_received: 2, items_relevant: 1 })];
const DEGRADED_WEBSITE = [FIX.firecrawl_carcapital_degraded.summary];
const PARTIAL_WEBSITE = [FIX.firecrawl_cashmotor_healthy.summary, FIX.firecrawl_carcapital_degraded.summary];

// ============================================================================================================
A.section('Stage 4 E2E — full happy path: Telegram -> plan -> approval -> website -> WF10/WF12 -> outbox -> completed');
const happy = runRequest(FIX.telegram_request_update, { approve: true, source_runs: { website: HEALTHY_WEBSITE } });
A.eq('happy path ends completed', happy.state, 'completed');
A.eq('happy path plan is website-only', happy.plan.sources.join(','), 'website');
A.eq('happy path makes external calls (collection ran)', happy.external_calls > 0, true);
A.eq('happy path summary reports 1 competitor row', happy.summary.records_reported, 1);
A.eq('happy path source cost stays unknown (never fake $0)', happy.summary.source_cost_status, 'unknown');
A.eq('happy path delivered', happy.summary.delivery_status, 'sent');
A.eq('happy path next action = report delivered', happy.summary.next_operator_action, 'none — report delivered');
A.ok('happy path persisted a transition event per hop', happy.events.length >= 9);

A.section('Stage 4 E2E — scenario 1: duplicate Telegram update creates ONE request');
const first = runRequest(FIX.telegram_request_update, { approve: false });
const dup = runRequest(FIX.telegram_request_update, { approve: false, seen_update_keys: [first.idempotency_key] });
A.eq('first update accepted', first.outcome, 'awaiting_approval');
A.eq('duplicate update rejected (no second request)', dup.outcome, 'duplicate');
A.eq('duplicate made zero external calls', dup.external_calls, 0);

A.section('Stage 4 E2E — scenario 2: unauthorized user => zero external calls');
const unauth = runRequest(FIX.telegram_unauthorized_update, { approve: true, source_runs: { website: HEALTHY_WEBSITE } });
A.eq('unauthorized blocked', unauth.outcome, 'unauthorized');
A.eq('unauthorized zero external calls', unauth.external_calls, 0);

A.section('Stage 4 E2E — scenario 3: unapproved request => zero external calls');
const unappr = runRequest(FIX.telegram_request_update, { approve: false });
A.eq('unapproved parks at awaiting_approval', unappr.state, 'awaiting_approval');
A.eq('unapproved zero external calls', unappr.external_calls, 0);

A.section('Stage 4 E2E — scenario 4: cancelled/terminal request blocked by approval gate');
const cancelled = runRequest(FIX.telegram_request_update, { cancel_before_approval: true });
A.eq('cancel before approval ends cancelled', cancelled.state, 'cancelled');
A.eq('cancelled zero external calls', cancelled.external_calls, 0);
// gate-level proof: a cancelled/terminal ctx is hard-blocked
const cg = gate.evaluateGate({ source: 'website', est_items: 1 }, { state: 'cancelled', cancelled: true, approved: true }, makeConfig());
A.eq('gate blocks cancelled state', cg.allowed, false);
A.ok('gate reason = request_not_active', /request_not_active/.test(cg.reason));
const tgone = gate.evaluateGate({ source: 'website', est_items: 1 }, { state: 'completed', approved: true }, makeConfig());
A.eq('gate blocks terminal completed state', tgone.allowed, false);
A.eq('canMakeExternalCall=false once cancelled', state.canMakeExternalCall('cancelled'), false);

A.section('Stage 4 E2E — scenario 5: approved request passes the gate');
const okGate = gate.evaluateGate({ source: 'website', est_items: 10, est_external_calls: 4, est_source_cost_usd: 0.05, est_llm_cost_usd: 0.0 }, { state: 'collecting', approved: true, completed_keys: [], external_calls_made: 0 }, makeConfig());
A.eq('approved + in-budget => allowed', okGate.allowed, true);

A.section('Stage 4 E2E — scenario 6: source outside allowlist is blocked');
const offAllow = gate.evaluateGate({ source: 'avito', est_items: 5 }, { state: 'collecting', approved: true }, makeConfig());
A.eq('avito (not allowlisted) blocked', offAllow.allowed, false);
A.ok('reason = source_not_allowed', /source_not_allowed/.test(offAllow.reason));
// and end-to-end: an avito-only plan over a website-only allowlist collapses back to website (never spends on avito)
const avitoText = { update_id: 7, message: { message_id: 1, text: 'спарси объявления на авито', from: { id: 111111111 }, chat: { id: 222222222 } } };
const avitoRun = runRequest(avitoText, { approve: true, source_runs: { website: HEALTHY_WEBSITE, avito: [FIX.avito_search_cards] } });
A.eq('avito plan clamped to website allowlist', avitoRun.plan.sources.join(','), 'website');

A.section('Stage 4 E2E — scenario 7: budget/call/item overflow is blocked');
const overItems = gate.evaluateGate({ source: 'website', est_items: 9999 }, { state: 'collecting', approved: true }, makeConfig());
A.ok('over item limit blocked', /over_item_limit/.test(overItems.reason));
const overCalls = gate.evaluateGate({ source: 'website', est_items: 1, est_external_calls: 9999 }, { state: 'collecting', approved: true, external_calls_made: 0 }, makeConfig());
A.ok('over call limit blocked', /over_call_limit/.test(overCalls.reason));
const overSrc = gate.evaluateGate({ source: 'website', est_items: 1, est_source_cost_usd: 99 }, { state: 'collecting', approved: true, source_spend_usd: 0 }, makeConfig());
A.ok('over source budget blocked', /over_source_budget/.test(overSrc.reason));
const overLlm = gate.evaluateGate({ source: 'website', est_items: 1, est_llm_cost_usd: 99 }, { state: 'collecting', approved: true, llm_spend_usd: 0 }, makeConfig());
A.ok('over llm budget blocked', /over_llm_budget/.test(overLlm.reason));

A.section('Stage 4 E2E — scenario 8: idempotency key is deterministic');
A.eq('same inputs => same key', gate.idempotencyKey('req_1', 'website', 1), gate.idempotencyKey('req_1', 'website', 1));
A.ok('different attempt => different key', gate.idempotencyKey('req_1', 'website', 1) !== gate.idempotencyKey('req_1', 'website', 2));

A.section('Stage 4 E2E — scenario 9: repeated approval/source call does not spend twice');
const firstKey = gate.idempotencyKey('req_replay_0001', 'website', 1);
const replay = gate.evaluateGate({ source: 'website', est_items: 10, attempt: 1, agent_request_id: 'req_replay_0001' }, { agent_request_id: 'req_replay_0001', state: 'collecting', approved: true, completed_keys: [firstKey] }, makeConfig());
A.eq('already-completed unit blocked', replay.allowed, false);
A.ok('reason = already_completed', /already_completed/.test(replay.reason));

A.section('Stage 4 E2E — scenario 10: healthy website record proceeds');
const healthyNorm = adapter.normalizeAdapterResult('website', FIX.firecrawl_cashmotor_healthy.summary, {});
A.eq('healthy website status = ok', healthyNorm.status, 'ok');
A.eq('healthy website not quarantined', healthyNorm.quarantined, false);
A.eq('healthy website next_state = quality_check', healthyNorm.next_state, 'quality_check');

A.section('Stage 4 E2E — scenario 11: degraded/quarantined record is blocked');
const degradedNorm = adapter.normalizeAdapterResult('website', FIX.firecrawl_carcapital_degraded.summary, {});
A.eq('degraded website status = quarantined', degradedNorm.status, 'quarantined');
A.eq('degraded website quarantined flag', degradedNorm.quarantined, true);
A.eq('degraded record report_eligible=false (blocked from WF08)', FIX.firecrawl_carcapital_degraded.records[0].report_eligible, false);

A.section('Stage 4 E2E — scenario 12: partial source success produces partial state');
const partial = runRequest(FIX.telegram_request_update, { approve: true, source_runs: { website: PARTIAL_WEBSITE } });
A.eq('mixed ok+quarantined => partial', partial.rollup.outcome, 'partial');
A.eq('partial collection => partial final state', partial.state, 'partial');
A.eq('partial summary records 1 quarantined source', partial.summary.sources_quarantined, 1);

A.section('Stage 4 E2E — scenario 13: all-quarantined produces no-data response');
const noData = runRequest(FIX.telegram_request_update, { approve: true, source_runs: { website: DEGRADED_WEBSITE } });
A.eq('all quarantined => no_data', noData.rollup.outcome, 'no_data');
A.eq('no_data => partial state (nothing eligible)', noData.state, 'partial');
A.ok('no_data next action = broaden sources', /broaden sources/.test(noData.summary.next_operator_action));

A.section('Stage 4 E2E — scenario 14: invalid planner JSON => deterministic plan, zero external calls before approval');
const badPlan = runRequest(FIX.telegram_request_update, { planner_raw_json: 'this is not json', approve: false });
A.eq('invalid planner JSON flagged', badPlan.plan_valid, false);
A.eq('invalid planner JSON => deterministic plan still built', badPlan.plan.plan_source, 'deterministic');
A.eq('invalid plan made zero external calls (parked at approval)', badPlan.external_calls, 0);
const badPlanNoSources = planner.validatePlanJSON('{"region":"Москва","max_items":10}', makeConfig());
A.eq('planner JSON with no sources => invalid', badPlanNoSources.valid, false);
A.eq('reason = no_sources', badPlanNoSources.reason, 'no_sources');

A.section('Stage 4 E2E — scenario 15: summary OFF => zero LLM calls');
A.eq('config summary flag OFF by default', makeConfig().enable_llm_summary, false);
A.eq('report fixture made zero llm_primary calls', happy.summary.llm_primary_calls, 0);
A.eq('happy path counted zero LLM calls', happy.llm_calls, 0);

A.section('Stage 4 E2E — scenario 16: delivery retry does not create a duplicate user-visible send');
const d1 = tg.makeDelivery('req_replay_0001', 'rep_1', '222', happy.summary && 'report body');
const d2 = tg.makeDelivery('req_replay_0001', 'rep_1', '222', 'report body');
A.eq('same request+report+payload => same delivery_id', d1.delivery_id, d2.delivery_id);
const retry = tg.shouldSend([Object.assign({}, d1, { send_status: 'sent' })], d2);
A.eq('retry after a sent delivery => skip', retry.send, false);
A.eq('retry reason = already_sent', retry.reason, 'already_sent');

A.section('Stage 4 E2E — state machine rejects illegal transitions');
A.eq('cannot skip approval (classified -> collecting)', state.canTransition('classified', 'collecting'), false);
A.eq('cannot resurrect a terminal state', state.canTransition('completed', 'reporting'), false);
A.eq('can cancel from any live state', state.canTransition('collecting', 'cancelled'), true);
const illegal = state.transition({ agent_request_id: 'r', state: 'received' }, 'reporting', {});
A.eq('illegal transition rejected (ok=false)', illegal.ok, false);
A.eq('illegal transition keeps state', illegal.state, 'received');
A.eq('illegal transition event marked not accepted', illegal.event.accepted, false);

A.report('stage4-e2e');
