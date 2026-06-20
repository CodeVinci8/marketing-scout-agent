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
  ['18_telegram_agent_gateway.json', 'Parse Telegram Update', ['telegram_io']],
  ['18_telegram_agent_gateway.json', 'Build Intake Decision', ['agent_state']],
  ['19_request_planner.json', 'Deterministic Plan', ['request_planner']],
  ['19_request_planner.json', 'Planner LLM Guard', ['approval_gate']],
  ['20_agent_orchestrator.json', 'Approval & Budget Gate', ['approval_gate', 'agent_state']],
  ['20_agent_orchestrator.json', 'Normalize Adapter Result', ['source_adapter']],
  ['20_agent_orchestrator.json', 'Build Execution Summary', ['source_adapter', 'execution_summary']],
  ['20_agent_orchestrator.json', 'Build Delivery Outbox', ['telegram_io']]
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

// ----- WF18: gateway authorization + duplicate-update protection -----------------------------------------
A.section('WF18 — gateway: unauthorized blocked, duplicate update => one request');
const WF18 = WFS['18_telegram_agent_gateway.json'];
function gateway(update, opts) {
  opts = opts || {};
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [{ telegram_allowed_user_ids: ['111'], source_allowlist: ['website'] }]);
  H.runCodeNode(run, WF18, 'Parse Telegram Update', [{ json: { body: update } }]);
  H.inject(run, 'Read agent_request_events', opts.events || []);
  return H.runCodeNode(run, WF18, 'Build Intake Decision', [])[0].json;
}
const reqUpdate = { update_id: 900, message: { message_id: 7, text: 'найди конкурентов по ПТС', from: { id: 111 }, chat: { id: 555 } } };
const accepted = gateway(reqUpdate);
A.eq('authorized request => accepted + start_work', accepted.decision + ':' + accepted.start_work, 'accepted:true');
A.ok('accepted request gets an agent_request_id', /^req_/.test(accepted.request.agent_request_id));
const unauth = gateway({ update_id: 901, message: { message_id: 8, text: 'hi', from: { id: 999 }, chat: { id: 555 } } });
A.eq('unauthorized => no work', unauth.decision + ':' + unauth.start_work, 'unauthorized:false');
const dupEvents = [{ idempotency_key: accepted.parsed.idempotency_key }];
const dup = gateway(reqUpdate, { events: dupEvents });
A.eq('duplicate update => no new work', dup.decision + ':' + dup.start_work, 'duplicate:false');

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
H.runCodeNode(gOk.run, WF20, 'Normalize Adapter Result', [{ json: { live_source_run: { agent_request_id: 'req_1', source_run_id: 'firecrawl_X', items_received: 4, items_written: 4, items_relevant: 3, external_calls: 4, cost_status: 'unknown', platform: 'website', data_mode: 'live' } } }]);
const summ = H.runCodeNode(gOk.run, WF20, 'Build Execution Summary', [{ json: { report: { report_id: 'rep1', rows_after_filters: 3, records_unique: 4, records_eligible: 3, records_analyzed: 3, llm_primary_calls: 0, llm_repair_calls: 0 } } }])[0].json;
A.eq('summary records reported', summ.summary.records_reported, 3);
A.eq('summary source cost stays unknown', summ.summary.source_cost_status, 'unknown');
const out1 = H.runCodeNode(gOk.run, WF20, 'Build Delivery Outbox', [{ json: {} }])[0].json;
A.ok('outbox builds a deterministic delivery id', /^dlv_req_1_rep1_/.test(out1.delivery.delivery_id));
A.ok('outbox emits a telegram send body', /chat_id/.test(out1.telegram_send_body));

A.report('stage4-workflows');
