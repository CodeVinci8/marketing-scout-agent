// test_stage4_workflows.js — proves the Stage 4 workflow Code nodes (a) embed the n8n/lib/* contracts
// byte-identically (no drift) and (b) actually execute under the offline harness with realistic inputs.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');
const H = require('./wf_harness');

// ----- drift proof: every embedded block equals its library core -----------------------------------------
function libCore(name) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  return s.trim();
}
function extract(code, name) {
  const m = code.match(new RegExp('// embedded n8n/lib/' + name + '\\.js[^\\n]*\\n([\\s\\S]*?)\\n// --- end embedded ' + name + ' ---'));
  return m ? m[1] : null;
}
A.section('Stage 4 — workflow Code nodes embed n8n/lib/* with no drift');
const EMBEDS = [
  ['17_agent_settings_config.json', 'Resolve Agent Config', ['agent_config']],
  ['18_telegram_agent_gateway.json', 'Ingress Security Gate', ['telegram_io', 'agent_config']],
  ['18_telegram_agent_gateway.json', 'Mint Claim', ['idempotency_claim']],
  ['18_telegram_agent_gateway.json', 'Resolve Winner', ['sheets_access', 'idempotency_claim']],
  ['18_telegram_agent_gateway.json', 'Build Intake Decision', ['agent_state', 'request_planner']],
  ['18_telegram_agent_gateway.json', 'Build Conversation Context', ['conversation_memory']],
  ['18_telegram_agent_gateway.json', 'Handle Plan Result', ['request_planner', 'telegram_io', 'plan_render_ru']],
  ['18_telegram_agent_gateway.json', 'Build Conversational Reply', ['conversation_response', 'agent_charter', 'plan_render_ru']],
  ['19_request_planner.json', 'Deterministic Plan', ['request_planner']],
  ['19_request_planner.json', 'Planner LLM Guard', ['approval_gate']],
  ['19_request_planner.json', 'Build Approval Message', ['request_planner', 'telegram_io', 'scope_preview', 'plan_render_ru']],
  ['22_conversation_control.json', 'Apply Control Command', ['conversation_memory', 'tracked_sources', 'plan_render_ru']],
  ['20_agent_orchestrator.json', 'Approval & Budget Gate', ['approval_gate', 'agent_state']],
  ['20_agent_orchestrator.json', 'Normalize Website Result', ['source_adapter']],
  ['20_agent_orchestrator.json', 'Build Execution Summary', ['source_adapter', 'execution_summary']],
  ['20_agent_orchestrator.json', 'Build Delivery Outbox', ['telegram_io']],
  ['21_deep_competitor_analysis.json', 'Build Deep Blocked Reply', ['conversation_response', 'plan_render_ru']],
  ['26_vk_public_community_collector.json', 'Build Setup-Required Reply', ['vk_collector', 'conversation_response', 'plan_render_ru']]
];
const WFS = {};
for (const [file] of EMBEDS) if (!WFS[file]) WFS[file] = H.loadWorkflow(file);
for (const [file, node, libs] of EMBEDS) {
  const code = WFS[file].nodes.find(n => n.name === node).parameters.jsCode;
  for (const lib of libs) {
    A.eq(file + ' :: ' + node + ' embeds ' + lib + ' (no drift)', extract(code, lib), libCore(lib));
  }
}

// ----- WF17: config loader runs and returns fail-closed defaults -----------------------------------------
A.section('WF17 — config loader resolves one config object');
const WF17 = WFS['17_agent_settings_config.json'];
const cfg17 = H.runCodeNode(H.makeRun(), WF17, 'Resolve Agent Config', [])[0].json;
A.eq('WF17 resolves require_approval=true', cfg17.require_approval, true);
A.eq('WF17 resolves website-only allowlist', cfg17.source_allowlist.join(','), 'website');
A.eq('WF17 flags missing config (no env)', cfg17.config_complete, false);

// ----- WF18: fail-closed ingress (lib level) + real dispatcher (node level) -------------------------------
A.section('WF18 — fail-closed ingress: secret + kill-switch + auth + supported-type, no side effects');
const WF18 = WFS['18_telegram_agent_gateway.json'];
const TG = require('../n8n/lib/telegram_io.js');
const CFG18 = { enable_telegram: true, telegram_allowed_user_ids: ['111'] };
const goodHdr = { 'X-Telegram-Bot-Api-Secret-Token': 'sekret' };
const reqUpd = { update_id: 900, message: { message_id: 7, text: 'найди конкурентов по ПТС', from: { id: 111 }, chat: { id: 555, type: 'private' } } };
A.eq('valid secret + enabled + authorized + private => accepted', TG.ingressDecision({ update: reqUpd, headers: goodHdr, expectedSecret: 'sekret', cfg: CFG18 }).accepted, true);
A.eq('wrong secret => reject (bad_secret)', TG.ingressDecision({ update: reqUpd, headers: { 'X-Telegram-Bot-Api-Secret-Token': 'nope' }, expectedSecret: 'sekret', cfg: CFG18 }).stop_reason, 'bad_secret');
A.eq('missing secret => reject (bad_secret)', TG.ingressDecision({ update: reqUpd, headers: {}, expectedSecret: 'sekret', cfg: CFG18 }).stop_reason, 'bad_secret');
A.eq('blank expected secret fails closed', TG.ingressDecision({ update: reqUpd, headers: goodHdr, expectedSecret: '', cfg: CFG18 }).stop_reason, 'bad_secret');
A.eq('telegram disabled => reject', TG.ingressDecision({ update: reqUpd, headers: goodHdr, expectedSecret: 'sekret', cfg: { enable_telegram: false, telegram_allowed_user_ids: ['111'] } }).stop_reason, 'telegram_disabled');
A.eq('unauthorized user => reject', TG.ingressDecision({ update: { update_id: 1, message: { message_id: 1, text: 'hi', from: { id: 999 }, chat: { id: 5, type: 'private' } } }, headers: goodHdr, expectedSecret: 'sekret', cfg: CFG18 }).stop_reason, 'unauthorized');
A.eq('edited_message unsupported => reject', TG.ingressDecision({ update: { update_id: 2, edited_message: { message_id: 1, text: 'x', from: { id: 111 }, chat: { id: 5, type: 'private' } } }, headers: goodHdr, expectedSecret: 'sekret', cfg: CFG18 }).stop_reason, 'unsupported_update');
A.eq('group chat => reject (private only)', TG.ingressDecision({ update: { update_id: 3, message: { message_id: 1, text: 'x', from: { id: 111 }, chat: { id: 5, type: 'group' } } }, headers: goodHdr, expectedSecret: 'sekret', cfg: CFG18 }).stop_reason, 'non_private_chat');

A.section('WF18 — real dispatcher: intent => dispatch_target, duplicate claim, approval binding');
function gateOut(parsed) {
  return { accepted: true, stop_reason: '', secret_ok: true, telegram_enabled: true, supported: true, is_private: true, authorized: true, is_callback: parsed.kind === 'callback', ack_needed: false, callback_query_id: parsed.callback_query_id || '', idempotency_key: 'tg::' + (parsed.update_id || '') + '::' + (parsed.chat_id || '') };
}
// IDEMP-001 claim chain, exercised with the REAL node code: 'Mint Claim' runs for real; the Sheets append +
// 'Re-read Claims' HTTP round-trip is simulated by injecting the values:batchGet response the sheet would return
// AFTER the append (prior claims occupy lower physical rows; the freshly minted claim lands after them). This runs
// the real extractTab projection through 'Resolve Winner', so a shape/order bug in the embedded chain fails here.
const EV_HEADERS = ['agent_request_id', 'from_state', 'to_state', 'accepted', 'reason', 'idempotency_key', 'ts'];
function batchGetResponse(tab, headers, rows) {
  return {
    valueRanges: [{
      range: tab + '!A1:ZZ' + (rows.length + 1), majorDimension: 'ROWS',
      values: [headers].concat(rows.map(r => headers.map(h => (r[h] == null ? '' : r[h]))))
    }]
  };
}
function priorClaim(token, key) {
  return { agent_request_id: token, from_state: '', to_state: '', accepted: '', reason: 'idempotency_claim', idempotency_key: key, ts: '2026-07-01T00:00:00.000Z' };
}
function dispatch(parsed, opts) {
  opts = opts || {};
  const run = H.makeRun();
  const cfg = { telegram_allowed_user_ids: ['111'], source_allowlist: ['website'], require_approval: true, config_complete: true, enable_llm_intent: false, max_context_tokens: 6000, report_data_mode: 'live', recent_window: 8 };
  H.inject(run, 'Ingress Security Gate', [{ gate: gateOut(parsed), parsed: parsed, cfg: cfg }]);
  H.inject(run, 'Read agent_request_events', opts.events || []);
  H.inject(run, 'Read conversation_state', opts.state || []);
  H.inject(run, 'Read execution_plans', opts.plans || []);
  const minted = H.runCodeNode(run, WF18, 'Mint Claim', [])[0].json;
  const sheetRows = (opts.priorClaims || []).concat(opts.claimLost ? [] : [minted]);
  H.inject(run, 'Re-read Claims', [batchGetResponse('agent_request_events', EV_HEADERS, sheetRows)]);
  const claim = H.runCodeNode(run, WF18, 'Resolve Winner', [])[0].json;
  H.runCodeNode(run, WF18, 'Route Intent', []);
  const intake = H.runCodeNode(run, WF18, 'Build Intake Decision', [])[0].json;
  return { claim, intake, minted };
}
const reqParsed = { kind: 'request', update_type: 'message', update_id: '900', chat_id: '555', chat_type: 'private', user_id: '111', from_is_bot: false, message_id: '7', text: 'найди конкурентов по ПТС', callback_data: '', callback_query_id: '' };
const d1 = dispatch(reqParsed);
A.eq('search request => dispatch_target wf19', d1.intake.dispatch_target, 'wf19');
A.ok('intake transitions received=>classified (state==event.to_state)', d1.intake.request.state === 'classified' && d1.intake.event.to_state === 'classified');
A.eq('no prior claim => this execution wins (not a duplicate)', d1.claim.duplicate, false);
A.ok('winner verified its own claim row', d1.claim.claim_verified === true && d1.claim.winner_token === d1.minted.agent_request_id);
// sequential duplicate: a re-delivered update appends a NEW claim but observes the earlier claim at a lower row
const d1dup = dispatch(reqParsed, { priorClaims: [priorClaim('clm_first_run', 'tg::900::555')] });
A.eq('sequential duplicate => claim.duplicate true', d1dup.claim.duplicate, true);
A.eq('sequential duplicate resolves the FIRST claim as winner', d1dup.claim.winner_token, 'clm_first_run');
// concurrent duplicate: both executions appended before either read; the later physical row loses deterministically
const dConc = dispatch(reqParsed, { priorClaims: [priorClaim('clm_concurrent_rival', 'tg::900::555')] });
A.eq('concurrent duplicate (rival appended first) => loser terminates', dConc.claim.duplicate, true);
A.ok('exactly one winner between the two concurrent claims', dConc.claim.winner_token === 'clm_concurrent_rival' && dConc.claim.candidate_count === 2);
// a normal state-transition event row with the same key is NOT a claim and must not affect the protocol
const dEvt = dispatch(reqParsed, { priorClaims: [{ agent_request_id: 'req_900', from_state: 'received', to_state: 'classified', accepted: 'TRUE', reason: 'dispatch_wf19', idempotency_key: 'tg::900::555', ts: '2026-07-01T00:00:00.000Z' }] });
A.eq('non-claim event rows do not compete', dEvt.claim.duplicate, false);
// fail-closed: if the post-append read does NOT show my claim row, never proceed
const dLost = dispatch(reqParsed, { claimLost: true });
A.ok('unverified claim => treated as duplicate (fail closed)', dLost.claim.duplicate === true && dLost.claim.claim_verified === false);
const cbParsed = { kind: 'callback', update_type: 'callback_query', update_id: '901', chat_id: '555', chat_type: 'private', user_id: '111', from_is_bot: false, message_id: '8', text: '', callback_data: 'approve:req_900', callback_query_id: 'cbq1' };
const planRow = { plan_id: 'plan_req_900_h1', plan_hash: 'h1', agent_request_id: 'req_900', owner_user_id: '111', chat_id: '555', intent: 'competitor_search', status: 'awaiting_approval' };
const dAppr = dispatch(cbParsed, { plans: [planRow] });
A.eq('approve callback bound to awaiting plan => wf20', dAppr.intake.dispatch_target, 'wf20');
A.eq('approve binds the existing request id', dAppr.intake.request.agent_request_id, 'req_900');
const dStale = dispatch(cbParsed, { plans: [Object.assign({}, planRow, { status: 'approved' })] });
A.eq('stale/already-approved => local (not re-dispatched)', dStale.intake.dispatch_target, 'local');
// CALLBACK-IDEMP-001: a duplicate tap of an already-running plan is an IDEMPOTENT ack, not a contradictory error.
A.ok('duplicate-of-running recorded as idempotent (never «план не найден»)', dStale.intake.dispatch_reason === 'approval_dup:duplicate_running');
const dDone = dispatch(cbParsed, { plans: [Object.assign({}, planRow, { status: 'completed' })] });
A.eq('duplicate-of-completed => local (no re-dispatch)', dDone.intake.dispatch_target, 'local');
A.ok('duplicate-of-completed recorded as already-finished', dDone.intake.dispatch_reason === 'approval_dup:duplicate_done');
const dNoPlan = dispatch(cbParsed, { plans: [] });
A.ok('genuinely absent plan still reports no_plan (real error path)', dNoPlan.intake.dispatch_reason === 'approval_invalid:no_plan');

// ----- WF19: deterministic plan + planner LLM guard (off by default) -------------------------------------
A.section('WF19 — planner: deterministic plan always built; LLM guard OFF by default');
const WF19 = WFS['19_request_planner.json'];
function planner(cfgOver, reqText, approvalTok) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [Object.assign({ source_allowlist: ['website'], default_region: 'Москва/МО', default_niche: 'credit_brokerage', max_items_per_source: 25, max_external_calls: 40, source_budget_usd: 0.2, llm_budget_usd: 0.5, enable_llm_planner: false, require_approval: true }, cfgOver || {})]);
  H.runCodeNode(run, WF19, 'Deterministic Plan', [{ json: { request_text: reqText } }]);
  const guard = H.runCodeNode(run, WF19, 'Planner LLM Guard', [{ json: { planner_approval_token: approvalTok || '' } }])[0].json;
  return { run, guard };
}
const p1 = planner({}, 'конкуренты по займам под ПТС в Москве');
A.eq('deterministic plan has website source', p1.guard.plan.sources.join(','), 'website');
A.eq('LLM planner OFF => no call', p1.guard.call_llm, false);
A.eq('reason planner_llm_disabled', p1.guard.llm_guard_reason, 'planner_llm_disabled');
const p2 = planner({ enable_llm_planner: true }, 'x', '');
A.eq('enabled but no token => no call', p2.guard.call_llm, false);
A.eq('reason planner_token_invalid', p2.guard.llm_guard_reason, 'planner_token_invalid');
const p3 = planner({ enable_llm_planner: true }, 'x', 'WF19_PLANNER_APPROVED');
A.eq('enabled + token + budget => call_llm true', p3.guard.call_llm, true);
// invalid Claude JSON => Validate Plan falls back to deterministic
H.runCodeNode(p3.run, WF19, 'Build Planner Prompt', [{ json: {} }]);
const vp = H.runCodeNode(p3.run, WF19, 'Validate Plan', [{ json: { content: [{ type: 'text', text: 'not json at all' }] } }])[0].json;
A.eq('invalid planner JSON => deterministic fallback', vp.plan_source, 'deterministic');
A.eq('invalid planner JSON => plan_valid false', vp.plan_valid, false);

// ----- WF20: approval/budget gate + adapter normalize + summary + outbox ---------------------------------
A.section('WF20 — orchestrator: gate fails closed; healthy path normalizes + summarizes + dedupes delivery');
const WF20 = WFS['20_agent_orchestrator.json'];
function orchGate(reqOver, cfgOver) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [Object.assign({ source_allowlist: ['website'], max_items_per_source: 25, max_external_calls: 40, source_budget_usd: 0.2, llm_budget_usd: 0.5, require_approval: true, config_complete: true }, cfgOver || {})]);
  const input = { request: Object.assign({ agent_request_id: 'req_1', state: 'approved', approved: true, chat_id: '555' }, reqOver || {}), plan: { sources: ['website'], source: 'website', est_items: 10, est_external_calls: 4, est_source_cost_usd: 0.05, est_llm_cost_usd: 0.1 } };
  return { run, gate: H.runCodeNode(run, WF20, 'Approval & Budget Gate', [{ json: input }])[0].json };
}
const gOk = orchGate({});
A.eq('approved+in-budget => gate allowed', gOk.gate.gate_allowed, true);
A.eq('cancelled => gate blocked', orchGate({ state: 'cancelled', approved: false }).gate.gate_allowed, false);
A.eq('not approved => gate blocked', orchGate({ state: 'awaiting_approval', approved: false }).gate.gate_allowed, false);
// healthy adapter normalize -> summary -> outbox dedupe
H.runCodeNode(gOk.run, WF20, 'Normalize Website Result', [{ json: { live_source_run: { agent_request_id: 'req_1', source_run_id: 'firecrawl_X', items_received: 4, items_written: 4, items_relevant: 3, external_calls: 4, cost_status: 'unknown', platform: 'website', data_mode: 'live' } } }]);
// STAGE-F-INTEGRATION: the Stage-F analysis chain now sits between WF12 and the summary, so the summary reads the
// report from WF12 BY NAME — a Claude result can never displace the deterministic report.
H.inject(gOk.run, 'Run WF12 Report', [{ report_id: 'rep1', rows_after_filters: 3, records_unique: 4, records_eligible: 3, records_analyzed: 3, llm_primary_calls: 0, llm_repair_calls: 0 }]);
H.inject(gOk.run, 'Merge Analyses', [{ analysis: { count_enriched: 0, count_reused: 0, count_fallback: 0, analysis_cost_usd: 0, reason: 'disabled' } }]);
const summ = H.runCodeNode(gOk.run, WF20, 'Build Execution Summary', [{ json: {} }])[0].json;
A.eq('summary records reported', summ.summary.records_reported, 3);
// fail-open: with the analyst disabled the deterministic report still reaches the summary intact.
A.eq('report survives a disabled analyst', summ.report.report_id, 'rep1');
A.eq('no analyses => no AI cost', summ.summary.actual_ai_usd, 0);
A.eq('summary source cost stays unknown', summ.summary.source_cost_status, 'unknown');
const out1 = H.runCodeNode(gOk.run, WF20, 'Build Delivery Outbox', [{ json: {} }])[0].json;
A.ok('outbox builds a deterministic delivery id', /^dlv_req_1_rep1_/.test(out1.delivery.delivery_id));
A.ok('outbox emits a telegram send body', /chat_id/.test(out1.telegram_send_body));

// ------------------------------------------------------------------------------------------------------------
A.section('SHEETS-CHAIN-001 — every stage4/5 googleSheets READ survives an empty tab and cannot amplify per item');
{
  const stage4Files = ['17_agent_settings_config.json', '18_telegram_agent_gateway.json', '19_request_planner.json',
    '20_agent_orchestrator.json', '21_deep_competitor_analysis.json', '22_conversation_control.json',
    '23_scheduled_source_monitor.json', '24_report_export_delivery.json', '25_weekly_digest.json',
    '26_vk_public_community_collector.json'];
  let reads = 0;
  for (const f of stage4Files) {
    const wf = H.loadWorkflow(f);
    for (const n of (wf.nodes || [])) {
      if (n.type === 'n8n-nodes-base.googleSheets' && n.parameters && n.parameters.operation === 'read') {
        reads++;
        A.eq(f + ' :: ' + n.name + ' — alwaysOutputData (empty tab must not kill the chain)', n.alwaysOutputData, true);
        A.eq(f + ' :: ' + n.name + ' — executeOnce (no per-input-item read amplification)', n.executeOnce, true);
      }
    }
  }
  A.ok('stage4/5 read nodes were actually checked', reads >= 16);
}

// ------------------------------------------------------------------------------------------------------------
A.section('SOURCE-EMPTY-001 — dispatch nodes survive empty/crashed children (partial results, never a silent halt)');
{
  let dispatches = 0;
  for (const f of ['18_telegram_agent_gateway.json', '20_agent_orchestrator.json', '21_deep_competitor_analysis.json',
                   '23_scheduled_source_monitor.json']) {
    const wf = H.loadWorkflow(f);
    for (const n of (wf.nodes || [])) {
      if (n.type !== 'n8n-nodes-base.executeWorkflow') continue;
      dispatches++;
      A.eq(f + ' :: ' + n.name + ' — alwaysOutputData (empty child return must not kill the parent chain)', n.alwaysOutputData, true);
      if (/Run (Website|Avito|Telegram|VK) (Source|Check)/.test(n.name) && f === '20_agent_orchestrator.json') {
        A.eq(f + ' :: ' + n.name + ' — tolerant dispatch (crashed source degrades to partial result)', n.onError, 'continueRegularOutput');
      }
    }
  }
  A.ok('dispatch nodes were actually checked', dispatches >= 16);
  // the adapter maps the {} sentinel to an EMPTY source outcome (this is what makes alwaysOutputData safe)
  const sa = require('../n8n/lib/source_adapter.js');
  const empty = sa.normalizeAdapterResult('avito', {}, { agent_request_id: 'req_e' });
  A.eq('adapter maps {} sentinel to status=empty', empty.status, 'empty');
  A.ok('empty source still advances the run', !!empty.next_state);
}

A.report('stage4-workflows');
