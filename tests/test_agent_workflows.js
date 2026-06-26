// test_agent_workflows.js — proves the conversational-agent Code nodes (WF18 gateway, WF22 control) embed the
// n8n/lib/* contracts byte-identically (no drift) and execute under the offline harness. $0, no network.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');
const H = require('./wf_harness');

function libCore(name) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  return s.trim();
}
function extract(code, name) {
  const m = code.match(new RegExp('// embedded n8n/lib/' + name + '\\.js[^\\n]*\\n([\\s\\S]*?)\\n// --- end embedded ' + name + ' ---'));
  return m ? m[1] : null;
}

A.section('Conversational agent — Code nodes embed n8n/lib/* with no drift');
const EMBEDS = [
  ['18_telegram_agent_gateway.json', 'Route Intent', ['intent_router', 'agent_charter', 'telegram_io', 'request_planner']],
  ['18_telegram_agent_gateway.json', 'Build Conversation Context', ['conversation_memory']],
  ['18_telegram_agent_gateway.json', 'Build Conversational Reply', ['conversation_response', 'agent_charter']],
  ['22_conversation_control.json', 'Apply Control Command', ['conversation_memory', 'tracked_sources']],
  ['22_conversation_control.json', 'Build Control Reply', ['conversation_response']]
];
const WFS = {};
for (const [file] of EMBEDS) if (!WFS[file]) WFS[file] = H.loadWorkflow(file);
for (const [file, node, libs] of EMBEDS) {
  const code = WFS[file].nodes.find(n => n.name === node).parameters.jsCode;
  for (const lib of libs) A.eq(file + ' :: ' + node + ' embeds ' + lib + ' (no drift)', extract(code, lib), libCore(lib));
}

// ---- WF18 conversational gateway flow (post-DEC-161: gate output injected; dispatcher routes locally vs child) --
const WF18 = WFS['18_telegram_agent_gateway.json'];
const CFG18 = { telegram_allowed_user_ids: ['111'], source_allowlist: ['website'], require_approval: true, max_external_calls: 40, source_budget_usd: 0.2, config_complete: true, enable_llm_intent: false, max_context_tokens: 6000, report_data_mode: 'live', recent_window: 8 };
function gateOut(parsed) {
  return { accepted: true, stop_reason: '', secret_ok: true, telegram_enabled: true, supported: true, is_private: true, authorized: true, is_callback: parsed.kind === 'callback', ack_needed: false, callback_query_id: parsed.callback_query_id || '', idempotency_key: 'tg::' + (parsed.update_id || '') + '::' + (parsed.chat_id || '') };
}
function P(o) { return Object.assign({ kind: 'request', update_type: 'message', chat_type: 'private', from_is_bot: false, callback_data: '', callback_query_id: '', text: '' }, o); }
function gateway(parsed, opts) {
  opts = opts || {};
  const run = H.makeRun();
  H.inject(run, 'Ingress Security Gate', [{ gate: gateOut(parsed), parsed: parsed, cfg: CFG18 }]);
  H.inject(run, 'Read agent_request_events', opts.events || []);
  H.inject(run, 'Read conversation_state', opts.state || []);
  H.inject(run, 'Read conversation_messages', opts.msgs || []);
  H.inject(run, 'Read conversation_summaries', opts.sums || []);
  H.inject(run, 'Read durable_memories', opts.mem || []);
  H.inject(run, 'Read execution_plans', opts.plans || []);
  H.runCodeNode(run, WF18, 'Route Intent', []);
  const intake = H.runCodeNode(run, WF18, 'Build Intake Decision', [])[0].json;
  const ctx = H.runCodeNode(run, WF18, 'Build Conversation Context', [])[0].json;
  const reply = H.runCodeNode(run, WF18, 'Build Conversational Reply', [])[0].json;
  return { reply, intake, ctx, send: JSON.parse(reply.telegram_send_body) };
}

A.section('WF18 — free-text competitor request => dispatched to WF19 (no premature "building plan")');
const req = gateway(P({ update_id: 1, message_id: 1, text: 'найди конкурентов по займам под ПТС в Москве', user_id: '111', chat_id: '555' }));
A.eq('authorized free-text accepted', req.intake.decision, 'accepted');
A.eq('competitor search routed to WF19 planner', req.intake.dispatch_target, 'wf19');
A.eq('routed intent is competitor_search', req.intake.intent.intent, 'competitor_search');
A.ok('local reply node does NOT claim a plan is being built (WF18 owns no premature claim)', !/стро[юя]\s*план/i.test(req.send.text));

A.section('WF18 — ambiguous free text => local clarification, no dispatch');
const amb = gateway(P({ update_id: 3, message_id: 3, text: 'ну и что теперь', user_id: '111', chat_id: '555' }));
A.eq('ambiguous stays local', amb.intake.dispatch_target, 'local');
A.ok('ambiguous reply is a clarification question', amb.send.text.length > 0 && /\?/.test(amb.send.text));

A.section('WF18 — /help lists only configured capabilities (local)');
const help = gateway(P({ update_id: 4, message_id: 4, text: '/help', kind: 'command', user_id: '111', chat_id: '555' }));
A.eq('help stays local', help.intake.dispatch_target, 'local');
A.ok('help reply lists capabilities', /умею/i.test(help.send.text));
A.ok('help reply is honest about unavailable platforms', /Недоступно/.test(help.send.text));

A.section('WF18 — context build is token-budgeted, owner-isolated, keeps critical sections');
A.ok('charter always in context', req.ctx.context.sections_included.indexOf('charter') >= 0);
A.ok('newest user message always in context', req.ctx.context.sections_included.indexOf('newest') >= 0);
A.ok('context usage records token estimate', req.ctx.context_usage.est_input_tokens > 0);
A.ok('conversation id binds chat AND user (cross-user isolation)', req.ctx.conversation_id === 'conv_555_111');

// ---- WF22 control plane -----------------------------------------------------------------------------------
const WF22 = WFS['22_conversation_control.json'];
function control(input, opts) {
  opts = opts || {};
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [{ source_allowlist: ['website'] }]);
  H.inject(run, 'Read durable_memories', opts.memories || []);
  H.inject(run, 'Read tracked_sources', opts.sources || []);
  const out = H.runCodeNode(run, WF22, 'Apply Control Command', [{ json: input }])[0].json;
  return out;
}

A.section('WF22 — memory commands: forget + isolation; source add idempotent + honest');
const memRows = [
  { memory_id: 'mem_111_region_default_region', owner_user_id: '111', memory_type: 'region', key: 'default_region', value_json: 'Москва/МО', status: 'active' },
  { memory_id: 'mem_222_region_default_region', owner_user_id: '222', memory_type: 'region', key: 'default_region', value_json: 'СПб', status: 'active' }
];
const forget = control({ domain: 'memory', op: 'forget', arg: 'default_region', owner_user_id: '111', chat_id: '5' }, { memories: memRows });
A.ok('forget removes the user memory', /Удалено/.test(forget.reply));
A.ok('forget emits an audit event', forget.memory_audit.length >= 1);
A.ok('forget audit carries a value hash, not raw value', /^h[0-9a-f]+$/.test(forget.memory_audit[0].value_hash));
const forgetAll = control({ domain: 'memory', op: 'forget_all', owner_user_id: '111', chat_id: '5', confirmed: false }, { memories: memRows });
A.ok('forget_all without confirm asks to confirm', /Подтвердите/.test(forgetAll.reply));
const addSrc = control({ domain: 'source', op: 'add', arg: 'https://cashmotor.ru/', owner_user_id: '111', chat_id: '5' }, { sources: [] });
A.ok('website source added', /добавлен/i.test(addSrc.reply));
A.ok('source add audited', addSrc.source_audit.length >= 1);
const addTg = control({ domain: 'source', op: 'add', arg: 'https://t.me/chan', owner_user_id: '111', chat_id: '5' }, { sources: [] });
A.ok('telegram source honestly blocked on website-only allowlist', /Не добавлен/.test(addTg.reply));

A.report('agent-workflows');
