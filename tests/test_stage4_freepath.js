// test_stage4_freepath.js — Stage 4 Telegram free path: zero-paid guards, deterministic commands, Russian UX,
// authorization, update idempotency, and proof that no secret/spreadsheet-id is baked into workflow JSON.
// Offline, $0, no network.
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const C = require('../n8n/lib/agent_config.js');
const R = require('../n8n/lib/intent_router.js');
const TG = require('../n8n/lib/telegram_io.js');

const WFDIR = path.join(__dirname, '..', 'n8n', 'workflows');
function wf(name) { return JSON.parse(fs.readFileSync(path.join(WFDIR, name), 'utf8')); }
const RUNTIME = ['17_agent_settings_config', '18_telegram_agent_gateway', '19_request_planner', '20_agent_orchestrator',
  '21_deep_competitor_analysis', '22_conversation_control', '23_scheduled_source_monitor', '24_report_export_delivery',
  '25_weekly_digest', '26_vk_public_community_collector'];

A.section('1. zero-paid-call guards — fail-closed defaults; nothing paid runs without explicit enable');
const freeEnv = { MS_SPREADSHEET_ID: 'sheetX', MS_TELEGRAM_ALLOWED_USER_IDS: '111,222', MS_ENABLE_TELEGRAM: 'true', MS_ENABLE_EXTERNAL_ACTIONS: 'false', MS_ENABLE_CLAUDE: 'false', MS_ENABLE_APIFY: 'false', MS_ENABLE_FIRECRAWL: 'false', MS_ENABLE_VK: 'false', MS_MONITORING_ENABLED: 'false', MS_WEEKLY_DIGEST_ENABLED: 'false', MS_MAX_EXTERNAL_CALLS: '0' };
const free = C.resolveConfig(freeEnv);
A.eq('config is complete (id + users present)', free.config_complete, true);
A.eq('Telegram conversation is enabled', free.enable_telegram, true);
A.eq('zero_paid_mode is on', free.zero_paid_mode, true);
A.eq('effective_max_external_calls is 0', free.effective_max_external_calls, 0);
A.eq('paidCallsAllowed=false', C.paidCallsAllowed(free), false);
A.eq('no collector is enabled (firecrawl)', C.collectorEnabled(free, 'website'), false);
A.eq('no collector is enabled (apify)', C.collectorEnabled(free, 'apify'), false);
A.eq('no collector is enabled (vk)', C.collectorEnabled(free, 'vk'), false);
A.eq('LLM not allowed', C.llmAllowed(free), false);
A.eq('freePathStatus reports zero paid mode', C.freePathStatus(free).zero_paid_mode, true);

A.section('2. defaults are fail-closed even with NO env at all');
const bare = C.resolveConfig({});
A.eq('external actions off by default', bare.enable_external_actions, false);
A.eq('claude off by default', bare.enable_claude, false);
A.eq('apify/firecrawl/vk off by default', [bare.enable_apify, bare.enable_firecrawl, bare.enable_vk].join(','), 'false,false,false');
A.eq('monitoring/digest off by default', [bare.monitoring_enabled, bare.weekly_digest_enabled].join(','), 'false,false');
A.eq('zero_paid_mode on by default (external actions off)', bare.zero_paid_mode, true);
A.eq('default timezone is Europe/Moscow', bare.timezone, 'Europe/Moscow');

A.section('3. enable_claude master switch forces planner/summary off; approval cannot bypass the call ceiling');
const claudeAsked = C.resolveConfig({ MS_ENABLE_CLAUDE: 'false', MS_ENABLE_LLM_PLANNER: 'true', MS_ENABLE_LLM_SUMMARY: 'true' });
A.eq('planner forced off when Claude master off', claudeAsked.enable_llm_planner, false);
A.eq('summary forced off when Claude master off', claudeAsked.enable_llm_summary, false);
const actionsOffButCalls = C.resolveConfig({ MS_ENABLE_EXTERNAL_ACTIONS: 'false', MS_MAX_EXTERNAL_CALLS: '40' });
A.eq('zero_paid_mode even with a positive ceiling when external actions off', actionsOffButCalls.zero_paid_mode, true);
A.eq('effective ceiling forced to 0', actionsOffButCalls.effective_max_external_calls, 0);

A.section('4. a fully-enabled paid config DOES allow (proves the guard is not hard-stuck off)');
const paid = C.resolveConfig({ MS_ENABLE_EXTERNAL_ACTIONS: 'true', MS_ENABLE_FIRECRAWL: 'true', MS_MAX_EXTERNAL_CALLS: '5', MS_SOURCE_ALLOWLIST: 'website' });
A.eq('paidCallsAllowed=true when enabled + positive ceiling', C.paidCallsAllowed(paid), true);
A.eq('firecrawl collector enabled (allowlisted + flagged)', C.collectorEnabled(paid, 'website'), true);
A.eq('vk still off (not flagged)', C.collectorEnabled(paid, 'vk'), false);

A.section('5. deterministic command handlers: /start /help /new /status /cancel (no LLM, no clarify)');
function route(text) { const kind = text === '/status' ? 'status' : (text === '/cancel' ? 'cancel' : 'request'); return R.routeIntent({ kind: kind, text: text }, {}, {}); }
const rStart = route('/start');
A.eq('/start is deterministic', rStart.route, 'deterministic');
A.eq('/start maps to the welcome/help action', rStart.intent.requested_action, 'help');
A.eq('/start carries the start marker', rStart.intent.entities.start, true);
A.eq('/start creates no approval-bearing request', rStart.intent.requires_approval, false);
A.eq('/help deterministic -> help', route('/help').intent.requested_action, 'help');
A.eq('/new deterministic -> manage_memory(new)', (function () { const r = route('/new'); return r.route === 'deterministic' && r.intent.requested_action === 'manage_memory' && r.intent.entities.memory_op === 'new'; })(), true);
A.eq('/status deterministic -> status', route('/status').intent.requested_action, 'status');
A.eq('/cancel deterministic -> cancel', route('/cancel').intent.requested_action, 'cancel');

A.section('6. authorization — from.id allowlist, fail-closed; chat.id never substitutes for from.id');
const allowed = ['111', '222'];
A.eq('authorized private chat', TG.isAuthorized(TG.parseUpdate({ message: { from: { id: 111 }, chat: { id: 111 }, text: 'hi' } }), allowed), true);
A.eq('unauthorized private chat', TG.isAuthorized(TG.parseUpdate({ message: { from: { id: 999 }, chat: { id: 999 }, text: 'hi' } }), allowed), false);
A.eq('same authorized from.id in a different chat is still authorized', TG.isAuthorized(TG.parseUpdate({ message: { from: { id: 222 }, chat: { id: -1009 }, text: 'hi' } }), allowed), true);
A.eq('a foreign from.id in an allowed-looking chat is rejected (chat.id != auth)', TG.isAuthorized(TG.parseUpdate({ message: { from: { id: 999 }, chat: { id: 111 }, text: 'hi' } }), allowed), false);
A.eq('empty allowlist fails closed', TG.isAuthorized(TG.parseUpdate({ message: { from: { id: 111 }, chat: { id: 111 }, text: 'hi' } }), []), false);
A.eq('malformed allowlist entries do not authorize', C.resolveConfig({ MS_TELEGRAM_ALLOWED_USER_IDS: 'abc, , 111' }).telegram_allowed_user_ids.join(','), 'abc,111');
A.eq('callback authorization uses callback_query.from.id', TG.isAuthorized(TG.parseUpdate({ callback_query: { from: { id: 111 }, data: 'approve:req1', message: { chat: { id: 111 } } } }), allowed), true);

A.section('7. update idempotency — duplicate update_id yields one stable key; callbacks parsed');
const u1 = TG.parseUpdate({ update_id: 5005, message: { from: { id: 111 }, chat: { id: 111 }, text: 'найди конкурентов', message_id: 9 } });
const u1dup = TG.parseUpdate({ update_id: 5005, message: { from: { id: 111 }, chat: { id: 111 }, text: 'найди конкурентов', message_id: 9 } });
A.eq('same update_id => identical idempotency key', TG.updateIdempotencyKey(u1), TG.updateIdempotencyKey(u1dup));
A.ok('key embeds the update_id', TG.updateIdempotencyKey(u1).indexOf('5005') >= 0);
A.eq('a different update_id => different key', TG.updateIdempotencyKey(u1) !== TG.updateIdempotencyKey(TG.parseUpdate({ update_id: 5006, message: { from: { id: 111 }, chat: { id: 111 }, text: 'x', message_id: 10 } })), true);
A.eq('outbox dedup: a re-send of a sent delivery is suppressed', TG.shouldSend([{ delivery_id: 'd1', send_status: 'sent' }], { delivery_id: 'd1' }).send, false);
A.eq('outbox: a fresh delivery is allowed once', TG.shouldSend([], { delivery_id: 'd2' }).send, true);

A.section('8. Telegram delivery: token is an $env reference, never a literal; spreadsheet id never embedded');
const gw = JSON.stringify(wf('18_telegram_agent_gateway.json'));
A.ok('WF18 references $env.MS_TELEGRAM_BOT_TOKEN', gw.indexOf('$env.MS_TELEGRAM_BOT_TOKEN') >= 0);
A.ok('WF18 contains NO bot-token-shaped literal', !/\d{8,10}:[A-Za-z0-9_-]{30,}/.test(gw));
RUNTIME.forEach(function (n) {
  const blob = JSON.stringify(wf(n + '.json'));
  // a Telegram bot token looks like "<8-10 digits>:<35+ chars>" — must never be baked into JSON
  A.ok(n + ': no bot-token literal', !/\d{8,10}:[A-Za-z0-9_-]{30,}/.test(blob));
  // a real Google spreadsheet id (30+ id chars) must never sit in a /spreadsheets/<id> path — the id comes from
  // $env.MS_SPREADSHEET_ID at runtime (a clearly-fake PASTE_* placeholder default is acceptable, a real id is not)
  A.ok(n + ': no real spreadsheet id embedded in a sheets path', !/spreadsheets\/[A-Za-z0-9_-]{30,}/.test(blob));
});

A.section('9. Russian user-facing UX present; all runtime workflows inactive in Git');
A.ok('WF18 gateway carries Russian copy', (gw.match(/[А-Яа-яЁё]/g) || []).length > 50);
RUNTIME.forEach(function (n) { A.eq(n + ' inactive in Git', wf(n + '.json').active, false); });

A.report('stage4-freepath');
