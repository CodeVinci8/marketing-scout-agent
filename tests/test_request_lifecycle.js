// test_request_lifecycle.js — the ONE canonical active-request selector shared by /status (WF18) and /cancel (WF22).
// Owner+chat scoped, newest valid active request, TTL-expired approvals + terminal/QA/foreign rows ignored.
'use strict';
const A = require('./_assert');
const RL = require('../n8n/lib/request_lifecycle.js');
const fs = require('fs');
const path = require('path');

const NOW = '2026-07-11T12:00:00Z';
function iso(minAgo) { return new Date(Date.parse(NOW) - minAgo * 60000).toISOString(); }
const OWNER = '1188830082', CHAT = '1188830082';

A.section('selectActiveRequest — owner + chat isolation');
const plans = [
  { plan_id: 'p_old', agent_request_id: 'r_old', owner_user_id: OWNER, chat_id: CHAT, status: 'collecting', sources: 'website', created_at: iso(30) },
  { plan_id: 'p_new', agent_request_id: 'r_new', owner_user_id: OWNER, chat_id: CHAT, status: 'awaiting_approval', sources: 'vk', created_at: iso(5) },
  { plan_id: 'p_foreign', agent_request_id: 'r_f', owner_user_id: '999', chat_id: '999', status: 'collecting', created_at: iso(1) },
  { plan_id: 'p_qa', agent_request_id: 'r_qa', owner_user_id: 'stage_d_owner', chat_id: '', status: 'collecting', created_at: iso(1) },
  { plan_id: 'p_done', agent_request_id: 'r_d', owner_user_id: OWNER, chat_id: CHAT, status: 'completed', created_at: iso(2) },
  { plan_id: 'p_cancel', agent_request_id: 'r_c', owner_user_id: OWNER, chat_id: CHAT, status: 'cancelled', created_at: iso(1) }
];
const sel = RL.selectActiveRequest(plans, { owner_user_id: OWNER, chat_id: CHAT, now_iso: NOW });
A.ok('found an active request', sel.found === true, 'none found');
A.eq('selects exactly the NEWEST active (p_new)', sel.request.plan_id, 'p_new');
A.eq('active_count = 2 (p_new + p_old)', sel.active_count, 2);
A.ok('foreign-owner row excluded', !sel.others.concat([sel.request]).some(r => r.plan_id === 'p_foreign'), 'foreign leaked');
A.ok('QA-owner row excluded', !sel.others.concat([sel.request]).some(r => r.plan_id === 'p_qa'), 'qa leaked');
A.ok('terminal rows (completed/cancelled) excluded', !sel.others.concat([sel.request]).some(r => ['p_done', 'p_cancel'].indexOf(r.plan_id) >= 0), 'terminal leaked');

A.section('selectActiveRequest — TTL expiry of stale awaiting_approval');
const stale = [
  { plan_id: 'p_stale', owner_user_id: OWNER, chat_id: CHAT, status: 'awaiting_approval', created_at: iso(200) }, // > 120min TTL
  { plan_id: 'p_fresh', owner_user_id: OWNER, chat_id: CHAT, status: 'awaiting_approval', created_at: iso(10) }
];
const selStale = RL.selectActiveRequest(stale, { owner_user_id: OWNER, chat_id: CHAT, now_iso: NOW });
A.eq('stale awaiting_approval TTL-expired -> fresh chosen', selStale.request.plan_id, 'p_fresh');
A.eq('one stale ignored', selStale.stale_ignored, 1);
const onlyStale = RL.selectActiveRequest([stale[0]], { owner_user_id: OWNER, chat_id: CHAT, now_iso: NOW });
A.ok('a lone stale approval => no active request', onlyStale.found === false, 'stale returned as active');
// STATUS-TTL-002: a stale active run (any state) beyond the TTL is treated as abandoned/crashed and NOT shown.
A.ok('a stale collecting run (500 min) IS TTL-expired', RL.selectActiveRequest([{ plan_id: 'c', owner_user_id: OWNER, chat_id: CHAT, status: 'collecting', created_at: iso(500) }], { owner_user_id: OWNER, now_iso: NOW }).found === false, 'stale collecting not expired');
A.ok('a recent collecting run stays active', RL.selectActiveRequest([{ plan_id: 'c2', owner_user_id: OWNER, chat_id: CHAT, status: 'collecting', created_at: iso(3) }], { owner_user_id: OWNER, now_iso: NOW }).found === true, 'recent collecting wrongly expired');
A.ok('a stale approved run IS TTL-expired (the live defect)', RL.selectActiveRequest([{ plan_id: 'ap', owner_user_id: OWNER, chat_id: CHAT, status: 'approved', created_at: iso(3000), decided_at: iso(3000) }], { owner_user_id: OWNER, now_iso: NOW }).found === false, 'stale approved not expired');
// the EXACT live defect: 3 different-agent_request_id approved plans from 1-2 days ago -> none active, and since
// the owner has a completed run, /status says "последний отчёт уже отправлен".
const liveStale = [
  { plan_id: 'p1', agent_request_id: 'r1', owner_user_id: OWNER, chat_id: CHAT, status: 'approved', created_at: iso(2880), decided_at: iso(2880) },
  { plan_id: 'p2', agent_request_id: 'r2', owner_user_id: OWNER, chat_id: CHAT, status: 'approved', created_at: iso(2000), decided_at: iso(2000) },
  { plan_id: 'p3', agent_request_id: 'r3', owner_user_id: OWNER, chat_id: CHAT, status: 'completed', created_at: iso(1500) }
];
const liveSel = RL.selectActiveRequest(liveStale, { owner_user_id: OWNER, chat_id: CHAT, now_iso: NOW });
A.eq('3 stale approved plans -> 0 active (no "ещё в работе")', liveSel.active_count, 0);
A.ok('owner has a delivered report -> has_delivered_report true', liveSel.has_delivered_report === true);
A.ok('no delivered report on a fresh owner -> false', RL.selectActiveRequest([{ plan_id: 'n', owner_user_id: OWNER, chat_id: CHAT, status: 'awaiting_approval', created_at: iso(3) }], { owner_user_id: OWNER, now_iso: NOW }).has_delivered_report === false);

A.section('selectActiveRequest — chat scope + empty / no-match');
A.ok('foreign chat excluded', RL.selectActiveRequest([{ plan_id: 'x', owner_user_id: OWNER, chat_id: '777', status: 'collecting', created_at: iso(1) }], { owner_user_id: OWNER, chat_id: CHAT, now_iso: NOW }).found === false, 'foreign chat leaked');
A.ok('blank chat_id tolerated (owner-only match)', RL.selectActiveRequest([{ plan_id: 'y', owner_user_id: OWNER, chat_id: '', status: 'collecting', created_at: iso(1) }], { owner_user_id: OWNER, chat_id: CHAT, now_iso: NOW }).found === true, 'blank chat dropped');
A.ok('no plans -> not found', RL.selectActiveRequest([], { owner_user_id: OWNER, now_iso: NOW }).found === false, 'empty found');
A.ok('rlIsTerminal / rlIsActive consistent', RL.rlIsTerminal('cancelled') && RL.rlIsActive('collecting') && !RL.rlIsActive('completed'), 'state helpers wrong');
A.ok('rlIsQaOwner catches non-numeric owners', RL.rlIsQaOwner('stage_d_owner') && !RL.rlIsQaOwner('1188830082'), 'qa owner detection wrong');

A.section('STATUS-DEDUP-001 — one request with several active rows is counted/listed once');
// same agent_request_id leaves a stale awaiting_approval row AND a newer collecting row (append history).
const dupRows = [
  { plan_id: 'p1', agent_request_id: 'rDup', owner_user_id: OWNER, chat_id: CHAT, status: 'awaiting_approval', created_at: iso(10) },
  { plan_id: 'p2', agent_request_id: 'rDup', owner_user_id: OWNER, chat_id: CHAT, status: 'collecting', created_at: iso(3) },
  { plan_id: 'p3', agent_request_id: 'rOther', owner_user_id: OWNER, chat_id: CHAT, status: 'collecting', created_at: iso(1) }
];
const selDup = RL.selectActiveRequest(dupRows, { owner_user_id: OWNER, chat_id: CHAT, now_iso: NOW });
A.eq('active_count dedups by agent_request_id (2 requests, not 3 rows)', selDup.active_count, 2);
A.eq('chosen is the newest DISTINCT request (rOther)', selDup.request.agent_request_id, 'rOther');
A.eq('"others" lists rDup exactly once', selDup.others.map(o => o.agent_request_id).join(','), 'rDup');
A.eq('the newest row wins within rDup (collecting p2, not stale p1)', selDup.others[0].plan_id, 'p2');

A.section('WF18 /status and WF22 /cancel embed the SAME canonical selector (no drift)');
const gen = require('../tools/gen_stage4_workflows.js');
function node(file, name) { const w = (gen.generated || []).find(g => g.file === file).workflow; return w.nodes.find(n => n.name === name); }
const cmd = node('18_telegram_agent_gateway.json', 'Command Lane').parameters.jsCode;
const ctl = node('22_conversation_control.json', 'Apply Control Command').parameters.jsCode;
A.ok('WF18 Command Lane embeds request_lifecycle', /embedded n8n\/lib\/request_lifecycle\.js/.test(cmd), 'wf18 missing embed');
A.ok('WF22 Apply Control Command embeds request_lifecycle', /embedded n8n\/lib\/request_lifecycle\.js/.test(ctl), 'wf22 missing embed');
A.ok('WF18 /status uses selectActiveRequest (not an inline status filter)', /selectActiveRequest\(/.test(cmd) && !/\['awaiting_approval','approved','collecting'\]/.test(cmd), 'wf18 still inline');
A.ok('WF22 /cancel + /status use selectActiveRequest', (ctl.match(/selectActiveRequest\(/g) || []).length >= 2, 'wf22 not both');
// the embedded lib core is byte-identical to the library (drift-proof)
const libCore = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', 'request_lifecycle.js'), 'utf8')
  .replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '').trim();
A.ok('WF18 embed === library core', cmd.indexOf(libCore) >= 0, 'wf18 embed drift');
A.ok('WF22 embed === library core', ctl.indexOf(libCore) >= 0, 'wf22 embed drift');

A.section('WF22 /cancel — STATUS-SELECT-002: a text-command arid (req_<update_id>) falls back to the newest active');
const H = require('./wf_harness');
const WF22 = H.loadWorkflow('22_conversation_control.json');
function control(input, plansArr) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [{ source_allowlist: ['website'] }]);
  H.inject(run, 'Read durable_memories', []);
  H.inject(run, 'Read tracked_sources', []);
  H.inject(run, 'Read execution_plans', plansArr || []);
  return H.runCodeNode(run, WF22, 'Apply Control Command', [{ json: input }])[0].json;
}
// WF22 Apply Control Command uses REAL new Date() for the selector's "now", so these fixtures must be recent
// relative to real time (the all-states TTL now expires stale active plans regardless of state).
function recentIso(minAgo) { return new Date(Date.now() - minAgo * 60000).toISOString(); }
const activePlans = [
  { plan_id: 'pA', agent_request_id: 'rA', owner_user_id: '111', chat_id: '555', status: 'approved', sources: 'website', created_at: recentIso(5), decided_at: recentIso(5) },
  { plan_id: 'pB', agent_request_id: 'rB', owner_user_id: '111', chat_id: '555', status: 'collecting', sources: 'vk', created_at: recentIso(30) }
];
// text /cancel: the dispatch passes the command's own update id, which matches no plan -> newest active (pA) cancelled
const cText = control({ domain: 'request', op: 'cancel', owner_user_id: '111', chat_id: '555', agent_request_id: 'req_1783753557665' }, activePlans);
A.eq('text /cancel cancels the newest active plan (pA)', (cText.changed_plans || []).map(p => p.plan_id).join(','), 'pA');
A.eq('text /cancel newest plan -> cancelled', (cText.changed_plans || [])[0] && cText.changed_plans[0].status, 'cancelled');
A.ok('text /cancel reply is user-safe (no "нет активного")', cText.reply.indexOf('отмен') >= 0 && cText.reply.indexOf('Сейчас нет') < 0, 'reply=' + cText.reply);
// a REAL callback arid targets that specific plan
const cCb = control({ domain: 'request', op: 'cancel', owner_user_id: '111', chat_id: '555', agent_request_id: 'rB' }, activePlans);
A.eq('callback arid=rB cancels exactly pB', (cCb.changed_plans || []).map(p => p.plan_id).join(','), 'pB');
// nothing active -> safe idempotent reply
const cNone = control({ domain: 'request', op: 'cancel', owner_user_id: '111', chat_id: '555', agent_request_id: 'req_x' }, [{ plan_id: 'pD', agent_request_id: 'rD', owner_user_id: '111', chat_id: '555', status: 'cancelled', created_at: iso(1) }]);
A.eq('no active -> no changed_plans', (cNone.changed_plans || []).length, 0);
A.ok('no active -> safe reply', /нет активного/i.test(cNone.reply), 'reply=' + cNone.reply);
// /status via WF22 also uses the selector (owner+chat), humanized, no leak
const sWf22 = control({ domain: 'request', op: 'status', owner_user_id: '111', chat_id: '555' }, activePlans);
A.ok('WF22 /status renders a humanized status (no raw enum)', sWf22.reply.indexOf('Статус запроса') >= 0 && !/approved|collecting|plan_/.test(sWf22.reply), 'reply=' + sWf22.reply);

A.report('request-lifecycle');
