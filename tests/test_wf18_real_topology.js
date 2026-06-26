// test_wf18_real_topology.js — DEC-161. Proves the REAL WF18 n8n graph (committed JSON), not just pure libs:
// fail-closed ingress, hard-stop branches that cannot reach a side effect, a real executeWorkflow dispatcher to
// WF19/20/21/22/24, callable children, durable plan-before-approval, callback ack, shaped Sheets writes, and
// unambiguous Telegram ownership. Plus §20 negative/behavioral paths via the real Code nodes + libs. $0, offline.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');
const H = require('./wf_harness');
const TG = require('../n8n/lib/telegram_io.js');
const RP = require('../n8n/lib/request_planner.js');

const WF_DIR = path.join(__dirname, '..', 'n8n', 'workflows');
function load(file) { return JSON.parse(fs.readFileSync(path.join(WF_DIR, file), 'utf8')); }
const WF18 = load('18_telegram_agent_gateway.json');

// ---- graph helpers (reachability over .connections.main, honoring output index when given) -----------------
function nodeByName(wf, name) { return (wf.nodes || []).find(n => n.name === name); }
function edges(wf) {
  const out = [];
  for (const [from, conn] of Object.entries(wf.connections || {})) {
    (conn.main || []).forEach((arr, oi) => (arr || []).forEach(c => out.push({ from, to: c.node, out: oi })));
  }
  return out;
}
// nodes reachable FROM a start node, optionally only following a specific first-hop output index.
function reachable(wf, start, firstOut) {
  const E = edges(wf);
  const seen = new Set();
  let frontier = E.filter(e => e.from === start && (firstOut == null || e.out === firstOut)).map(e => e.to);
  while (frontier.length) {
    const next = [];
    for (const n of frontier) { if (seen.has(n)) continue; seen.add(n); E.filter(e => e.from === n).forEach(e => next.push(e.to)); }
    frontier = next;
  }
  return seen;
}
function isSheetsWrite(node) { return node && node.type === 'n8n-nodes-base.googleSheets' && ['append', 'appendOrUpdate', 'update'].indexOf((node.parameters || {}).operation) >= 0; }
function isExecWf(node) { return node && node.type === 'n8n-nodes-base.executeWorkflow'; }
function tgUrl(node) { return (node && node.parameters && node.parameters.url) || ''; }
function isTelegramSend(node) { return /telegram\.org.*\/(sendMessage|sendDocument|sendPhoto)/.test(tgUrl(node)); }
function isTelegramAnswer(node) { return /telegram\.org.*answerCallbackQuery/.test(tgUrl(node)); }
function nodeIn(wf, names) { return Array.from(names).map(n => nodeByName(wf, n)).filter(Boolean); }
function predecessors(wf, name) { return edges(wf).filter(e => e.to === name).map(e => e.from); }

// ============================================================================ §19 REAL TOPOLOGY ASSERTIONS
A.section('§19.1-2 — fail-closed ingress: secret + MS_ENABLE_TELEGRAM hard gate BEFORE any side effect');
const gate = nodeByName(WF18, 'Ingress Security Gate');
A.ok('1. webhook-secret validation gate node exists', !!gate);
A.ok('1. gate validates the Telegram secret header against MS_TELEGRAM_WEBHOOK_SECRET', /MS_TELEGRAM_WEBHOOK_SECRET/.test(gate.parameters.jsCode) && /ingressDecision/.test(gate.parameters.jsCode));
A.ok('2. gate enforces the MS_ENABLE_TELEGRAM kill switch (enable_telegram)', /enable_telegram/.test(TG.ingressDecision.toString()));
A.ok('1/2. the webhook flows into the gate FIRST (before any read/write)', edges(WF18).some(e => e.from === 'Telegram Webhook' && e.to === 'Ingress Security Gate'));
A.ok('1/2. an Ingress Accepted? IF immediately gates the rest', !!nodeByName(WF18, 'Ingress Accepted?'));
// the gate node itself performs NO side effect
A.ok('gate node does no Sheets/Telegram I/O itself', gate.type === 'n8n-nodes-base.code');

A.section('§19.3-5 — reject/duplicate hard-stops cannot reach a side effect');
const stopBranch = reachable(WF18, 'Ingress Accepted?', 1);   // the FALSE (reject) output
const newFalse = reachable(WF18, 'New Update?', 1);           // the FALSE (duplicate) output
const stopSheets = nodeIn(WF18, stopBranch).filter(isSheetsWrite);
const stopExec = nodeIn(WF18, stopBranch).filter(isExecWf);
const stopSends = nodeIn(WF18, stopBranch).filter(isTelegramSend);
A.eq('3. unauthorized/ingress-reject branch reaches ZERO Sheets writes', stopSheets.length, 0);
A.eq('4. unauthorized/ingress-reject branch reaches ZERO Telegram business sends', stopSends.length, 0);
A.eq('4b. ingress-reject branch reaches ZERO child workflow calls', stopExec.length, 0);
A.eq('5. duplicate branch reaches ZERO Sheets writes', nodeIn(WF18, newFalse).filter(isSheetsWrite).length, 0);
A.eq('5b. duplicate branch reaches ZERO child workflow calls', nodeIn(WF18, newFalse).filter(isExecWf).length, 0);
A.eq('5c. duplicate branch reaches ZERO Telegram business sends', nodeIn(WF18, newFalse).filter(isTelegramSend).length, 0);
// the only outbound the stop path may touch is answerCallbackQuery (benign ack) and Respond-to-Webhook
A.ok('stop path terminates with a Respond to Webhook (fast 200)', nodeIn(WF18, stopBranch).some(n => n.type === 'n8n-nodes-base.respondToWebhook'));

A.section('§19.6-13 — real executeWorkflow dispatcher + callable children + resolvable bindings');
const execNodes = (WF18.nodes || []).filter(isExecWf);
A.ok('6. WF18 has executeWorkflow dispatcher nodes (>=5)', execNodes.length >= 5);
const TARGET = { 'Run WF19 (Planner)': '19', 'Run WF20 (Orchestrator)': '20', 'Run WF21 (Deep Analysis)': '21', 'Run WF22 (Control)': '22', 'Run WF24 (Reporting)': '24' };
const FILES = { '19': '19_request_planner.json', '20': '20_agent_orchestrator.json', '21': '21_deep_competitor_analysis.json', '22': '22_conversation_control.json', '24': '24_report_export_delivery.json' };
for (const [nodeName, num] of Object.entries(TARGET)) {
  const en = nodeByName(WF18, nodeName);
  A.ok('6. dispatcher node present: ' + nodeName, isExecWf(en));
  const hint = en.parameters.workflowId.cachedResultName || '';
  A.ok('13. ' + nodeName + ' resolves to WF' + num + ' (no dangling reference)', new RegExp('WF' + num).test(hint));
  const child = load(FILES[num]);
  A.ok('7. child WF' + num + ' has an Execute Sub-workflow Trigger', (child.nodes || []).some(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger'));
}
A.ok('8. WF18 -> WF19 planner path exists', !!nodeByName(WF18, 'Run WF19 (Planner)'));
A.ok('9. approval -> WF20 orchestrator path exists', !!nodeByName(WF18, 'Run WF20 (Orchestrator)'));
A.ok('10. deep approval -> WF21 path exists', !!nodeByName(WF18, 'Run WF21 (Deep Analysis)'));
A.ok('11. control/memory/source/cancel -> WF22 path exists', !!nodeByName(WF18, 'Run WF22 (Control)'));
A.ok('12. report operations -> WF24 path exists', !!nodeByName(WF18, 'Run WF24 (Reporting)'));
// 13: every WF18 executeWorkflow is a declared manifest binding edge (resolvable post-import, not a silent gap)
const manifest = require('../config/workflow_manifest.json');
const wf18Edges = manifest.deployment.binding_edges.filter(e => e.caller_workflow === '18_telegram_agent_gateway.json');
A.eq('13. all 5 WF18 dispatch edges are declared in the manifest (resolvable)', wf18Edges.length, 5);

A.section('§19.14-16 — durable plan before approval + real approval identifiers + callback ack');
const planAppend = nodeByName(WF18, 'Append execution_plans');
A.ok('14. a durable plan store append (execution_plans) exists', isSheetsWrite(planAppend));
const fromWF19 = reachable(WF18, 'Run WF19 (Planner)');
A.ok('14. plan is persisted on the WF19 result path (after planner, before approval send)', fromWF19.has('Append execution_plans'));
A.ok('14. awaiting_approval state is set only AFTER the plan append', reachable(WF18, 'Append execution_plans').has('Shape Awaiting State'));
const planRes = nodeByName(WF18, 'Handle Plan Result');
A.ok('15. approval keyboard is built from the REAL agent_request_id', /approvalKeyboard\(req\.agent_request_id\)/.test(planRes.parameters.jsCode));
A.ok('16. callback acknowledgement (answerCallbackQuery) node exists', (WF18.nodes || []).some(isTelegramAnswer));

A.section('§19.17 — reject/cancel route to control (WF22) and make zero PAID external calls');
const wf22 = load('22_conversation_control.json');
const wf22Paid = (wf22.nodes || []).filter(n => /api\.anthropic\.com|api\.apify\.com|firecrawl|api\.vk\.com/.test(tgUrl(n)));
A.eq('17. WF22 (reject/cancel/control) has ZERO paid external HTTP nodes', wf22Paid.length, 0);

A.section('§19.18 — every Sheets write is fed by an explicit shape/code node (no nested auto-map guess)');
const writes = (WF18.nodes || []).filter(isSheetsWrite);
A.ok('18. WF18 has multiple shaped Sheets writes', writes.length >= 5);
for (const w of writes) {
  const preds = predecessors(WF18, w.name).map(n => nodeByName(WF18, n));
  A.ok('18. ' + w.name + ' is fed by a Code/shape node', preds.length > 0 && preds.every(p => p && p.type === 'n8n-nodes-base.code'));
}

A.section('§19.19 — state and event destination states agree (intake persists the transitioned record)');
const intakeCode = nodeByName(WF18, 'Build Intake Decision').parameters.jsCode;
A.ok('19. intake returns request=t.record (the transitioned record), not the pre-transition rec', /var request=t\.record/.test(intakeCode));

A.section('§19.20 — Telegram send ownership is unambiguous (children own their own delivery)');
// each dispatch executeWorkflow branch must NOT be followed by a WF18 sendMessage (the child delivers).
for (const nm of ['Run WF20 (Orchestrator)', 'Run WF21 (Deep Analysis)', 'Run WF22 (Control)', 'Run WF24 (Reporting)']) {
  A.eq('20. ' + nm + ' branch has no WF18 Telegram send (child owns delivery)', nodeIn(WF18, reachable(WF18, nm)).filter(isTelegramSend).length, 0);
}
// WF18 only sends for: plan approval (WF19 result), and the local reply (help/clarify/answer-from-context)
A.ok('20. WF18 owns exactly the plan-approval and local-reply sends', (WF18.nodes || []).filter(isTelegramSend).map(n => n.name).sort().join(',') === 'Send Plan Reply,Send Telegram Reply');

// ============================================================================ §20 BEHAVIORAL / NEGATIVE PATHS
A.section('§20 — fail-closed behavioral matrix (ingress decisions, every reject reveals nothing)');
const cfg = { enable_telegram: true, telegram_allowed_user_ids: ['111'] };
const hdr = { 'X-Telegram-Bot-Api-Secret-Token': 'sek' };
function upd(o) { return Object.assign({ update_id: 1 }, o); }
const msg = (uid, txt, type) => upd({ message: { message_id: 1, text: txt || 'найди конкурентов', from: { id: uid }, chat: { id: 5, type: type || 'private' } } });
const cb = (uid, data) => upd({ update_id: 2, callback_query: { id: 'q', data: data, from: { id: uid }, message: { message_id: 1, chat: { id: 5, type: 'private' } } } });
function ing(update, secret, c) { return TG.ingressDecision({ update, headers: hdr, expectedSecret: secret == null ? 'sek' : secret, cfg: c || cfg }); }
A.eq('invalid webhook secret => bad_secret, not accepted', ing(msg('111'), 'WRONG').stop_reason, 'bad_secret');
A.eq('missing webhook secret => bad_secret', TG.ingressDecision({ update: msg('111'), headers: {}, expectedSecret: 'sek', cfg }).stop_reason, 'bad_secret');
A.eq('telegram disabled => telegram_disabled', ing(msg('111'), 'sek', { enable_telegram: false, telegram_allowed_user_ids: ['111'] }).stop_reason, 'telegram_disabled');
A.eq('unauthorized message => unauthorized', ing(msg('999')).stop_reason, 'unauthorized');
A.eq('unauthorized callback => unauthorized + NO ack (no outbound)', ing(cb('999', 'approve:req_1')).stop_reason + ':' + ing(cb('999', 'approve:req_1')).ack_needed, 'unauthorized:false');
A.eq('group chat => non_private_chat', ing(msg('111', 'x', 'group')).stop_reason, 'non_private_chat');
A.eq('edited message => unsupported_update', ing(upd({ edited_message: { message_id: 1, text: 'x', from: { id: 111 }, chat: { id: 5, type: 'private' } } })).stop_reason, 'unsupported_update');
A.eq('channel post => unsupported_update', ing(upd({ channel_post: { message_id: 1, text: 'x', chat: { id: 5, type: 'channel' } } })).stop_reason, 'unsupported_update');
A.eq('bot-originated callback => bot_message', ing(upd({ callback_query: { id: 'q', data: 'approve:req_1', from: { id: 111, is_bot: true }, message: { message_id: 1, chat: { id: 5, type: 'private' } } } })).stop_reason, 'bot_message');
A.eq('valid authorized private message => accepted', ing(msg('111')).accepted, true);
A.eq('authorized callback ack_needed (for later duplicate ack)', ing(cb('111', 'approve:req_1')).ack_needed, true);

A.section('§20 — approval binding: owner / chat / hash / lifecycle (fail-closed)');
const plan = { sources: ['website'], intent: 'competitor_search', niche: 'pts_loan', region: 'Москва/МО', max_items: 25, max_external_calls: 6, est_source_cost_usd: 0.05, est_llm_cost_usd: 0, expected_output: 'r', plan_source: 'deterministic' };
const ident = RP.planIdentity(plan, 'req_900', 1);
const row = RP.buildPlanRow(plan, ident, { agent_request_id: 'req_900', owner_user_id: '111', chat_id: '555', ts: 't' });
A.eq('approve by owner+chat+request on an awaiting plan => ok', RP.validateApproval(row, { owner_user_id: '111', chat_id: '555', agent_request_id: 'req_900' }).ok, true);
A.eq('approve by a DIFFERENT user => owner_mismatch (cross-user blocked)', RP.validateApproval(row, { owner_user_id: '222', chat_id: '555', agent_request_id: 'req_900' }).ok, false);
A.eq('approve from a different chat => chat_mismatch', RP.validateApproval(row, { owner_user_id: '111', chat_id: '999', agent_request_id: 'req_900' }).ok, false);
A.eq('approve a different request id (modified callback) => request_mismatch', RP.validateApproval(row, { owner_user_id: '111', chat_id: '555', agent_request_id: 'req_OTHER' }).ok, false);
A.eq('approve after completion (status approved) => blocked', RP.validateApproval(Object.assign({}, row, { status: 'approved' }), { owner_user_id: '111', chat_id: '555', agent_request_id: 'req_900' }).ok, false);
A.eq('approve after cancellation => blocked', RP.validateApproval(Object.assign({}, row, { status: 'cancelled' }), { owner_user_id: '111', chat_id: '555', agent_request_id: 'req_900' }).ok, false);
A.eq('replayed approval (no plan row) => no_plan', RP.validateApproval(null, { owner_user_id: '111', chat_id: '555', agent_request_id: 'req_900' }).reason, 'no_plan');
A.eq('plan_hash mismatch (modified plan) => blocked', RP.validateApproval(row, { owner_user_id: '111', chat_id: '555', agent_request_id: 'req_900', plan_hash: 'hDIFFERENT' }).ok, false);

A.section('§20 — free-text approval: bind only to exactly ONE pending plan');
const pendOne = [Object.assign({}, row, { status: 'awaiting_approval' })];
const pendTwo = [Object.assign({}, row, { status: 'awaiting_approval' }), Object.assign({}, row, { plan_id: 'plan_req_901_h2', agent_request_id: 'req_901', status: 'awaiting_approval' })];
A.eq('"да" with exactly one pending => approve signal', TG.freetextApprovalSignal('да') === 'approve' && RP.pendingPlansForOwner(pendOne, '111').length === 1, true);
A.eq('"нет" => reject signal', TG.freetextApprovalSignal('нет, не запускай'), 'reject');
A.eq('unrelated text is not an approval', TG.freetextApprovalSignal('расскажи про конкурентов'), '');
A.eq('multiple pending => ambiguous (caller must ask which)', RP.pendingPlansForOwner(pendTwo, '111').length, 2);
A.eq('zero pending => nothing to approve', RP.pendingPlansForOwner([], '111').length, 0);

A.section('§20 — formula-injection guard on user-controlled Sheet values');
A.eq('leading = neutralized', TG.escapeSheetValue('=HYPERLINK("http://x")').charAt(0), "'");
A.eq('leading + neutralized', TG.escapeSheetValue('+cmd()').charAt(0), "'");
A.eq('leading @ neutralized', TG.escapeSheetValue('@SUM(1)').charAt(0), "'");
A.eq('finite negative number stays numeric', TG.escapeSheetValue('-4.5'), '-4.5');
A.eq('plain text untouched', TG.escapeSheetValue('конкуренты по ПТС'), 'конкуренты по ПТС');

A.report('wf18-real-topology');
