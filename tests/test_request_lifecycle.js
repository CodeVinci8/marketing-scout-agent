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
A.ok('a collecting run is NOT TTL-expired even if old', RL.selectActiveRequest([{ plan_id: 'c', owner_user_id: OWNER, chat_id: CHAT, status: 'collecting', created_at: iso(500) }], { owner_user_id: OWNER, now_iso: NOW }).found === true, 'collecting wrongly expired');

A.section('selectActiveRequest — chat scope + empty / no-match');
A.ok('foreign chat excluded', RL.selectActiveRequest([{ plan_id: 'x', owner_user_id: OWNER, chat_id: '777', status: 'collecting', created_at: iso(1) }], { owner_user_id: OWNER, chat_id: CHAT, now_iso: NOW }).found === false, 'foreign chat leaked');
A.ok('blank chat_id tolerated (owner-only match)', RL.selectActiveRequest([{ plan_id: 'y', owner_user_id: OWNER, chat_id: '', status: 'collecting', created_at: iso(1) }], { owner_user_id: OWNER, chat_id: CHAT, now_iso: NOW }).found === true, 'blank chat dropped');
A.ok('no plans -> not found', RL.selectActiveRequest([], { owner_user_id: OWNER, now_iso: NOW }).found === false, 'empty found');
A.ok('rlIsTerminal / rlIsActive consistent', RL.rlIsTerminal('cancelled') && RL.rlIsActive('collecting') && !RL.rlIsActive('completed'), 'state helpers wrong');
A.ok('rlIsQaOwner catches non-numeric owners', RL.rlIsQaOwner('stage_d_owner') && !RL.rlIsQaOwner('1188830082'), 'qa owner detection wrong');

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

A.report('request-lifecycle');
