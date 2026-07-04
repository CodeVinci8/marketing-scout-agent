'use strict';
// §8 FAST-LANE-001 + TELEGRAM-MENU-001 — static commands reply before any Sheets call; /status renders from
// the already-read batch; /cancel acks immediately and continues to the real WF22 cancel; the native Telegram
// command menu is registered idempotently from the ONE canonical registry. $0, offline.
const fs = require('fs');
const path = require('path');
const A = require('./_assert');
const H = require('./wf_harness');
const FL = require('../n8n/lib/fast_lane.js');
const TC = require('../n8n/lib/telegram_commands.js');
const R = require('../n8n/lib/plan_render_ru.js');

const WF_DIR = path.join(__dirname, '..', 'n8n', 'workflows');
const WF18 = JSON.parse(fs.readFileSync(path.join(WF_DIR, '18_telegram_agent_gateway.json'), 'utf8'));

function edges(wf) {
  const out = [];
  for (const [from, conn] of Object.entries(wf.connections || {})) {
    (conn.main || []).forEach((arr, oi) => (arr || []).forEach(c => out.push({ from, to: c.node, out: oi })));
  }
  return out;
}
function reachable(wf, start, firstOut) {
  const E = edges(wf);
  const seen = new Set();
  let frontier = E.filter(e => e.from === start && (firstOut == null || e.out === firstOut)).map(e => e.to);
  while (frontier.length) {
    const next = [];
    for (const n of frontier) { if (!seen.has(n)) { seen.add(n); E.filter(e => e.from === n).forEach(e => next.push(e.to)); } }
    frontier = next;
  }
  return seen;
}

A.section('fast_lane decisions — static allowlist only');
{
  A.eq('/start is fast', FL.fastLaneDecision({ kind: 'command', text: '/start' }).kind, 'start');
  A.eq('/help is fast', FL.fastLaneDecision({ kind: 'command', text: '/help' }).kind, 'help');
  A.eq('кто ты? is fast (who-am-I)', FL.fastLaneDecision({ kind: 'request', text: 'кто ты?' }).kind, 'whoami');
  A.eq('представься is fast', FL.fastLaneDecision({ kind: 'request', text: 'представься' }).kind, 'whoami');
  A.eq('a business request is NOT fast', FL.fastLaneDecision({ kind: 'request', text: 'Найди кредитных брокеров в Москве' }).fast, false);
  A.eq('/status is NOT fast-static (stateful, claim-protected)', FL.fastLaneDecision({ kind: 'status', text: '/status' }).fast, false);
  A.eq('/cancel is NOT fast-static', FL.fastLaneDecision({ kind: 'cancel', text: '/cancel' }).fast, false);
  A.eq('a callback is NEVER fast', FL.fastLaneDecision({ kind: 'callback', text: '/start' }).fast, false);
  A.eq('freetext approval («да, запускай») is NOT fast', FL.fastLaneDecision({ kind: 'request', text: 'да, запускай' }).fast, false);
  A.eq('who-am-I regex mirrors plan_render_ru.ruIsWhoAmI', String(FL.FL_WHOAMI_RX), String(/кто\s+(ты|вы)|ты\s+кто|вы\s+кто|что\s+ты\s+такое|что\s+ты\s+за|что\s+такое\s+vinci|что\s+за\s+(бот|агент|сервис|vinci)|расскажи\s+о\s+себе|представься|who\s+are\s+you|what\s+are\s+you/i));
  A.eq('ruIsWhoAmI agrees with fast_lane on кто ты', R.ruIsWhoAmI('кто ты'), true);
}

A.section('WF18 topology — fast lane replies BEFORE any Sheets node');
{
  A.ok('Ingress Accepted? routes to Fast Static Lane first', edges(WF18).some(e => e.from === 'Ingress Accepted?' && e.to === 'Fast Static Lane' && e.out === 0));
  const fastPath = reachable(WF18, 'Fast Static Reply?', 0);
  A.ok('fast reply branch reaches Send Fast Reply', fastPath.has('Send Fast Reply'));
  const heavy = ['Batch Read Sheets', 'Mint Claim', 'Append Claim', 'Route Intent', 'Build Conversation Context',
    'Append agent_requests', 'Run WF19 (Planner)', 'Run WF20 (Orchestrator)', 'Run WF22 (Control)'];
  for (const n of heavy) A.ok('fast branch never reaches ' + n, !fastPath.has(n));
  const sheetsOnFast = [...fastPath].filter(n => { const nd = WF18.nodes.find(x => x.name === n); return nd && /googleSheets|sheets\.googleapis/.test(JSON.stringify(nd.parameters || {}) + nd.type); });
  A.eq('ZERO Sheets nodes on the fast branch', sheetsOnFast.length, 0);
  A.ok('non-fast branch still enters Batch Read Sheets', edges(WF18).some(e => e.from === 'Fast Static Reply?' && e.to === 'Batch Read Sheets' && e.out === 1));
  // security unchanged: fast lane runs only after the ingress gate accepted the update
  const preFast = reachable(WF18, 'Ingress Security Gate');
  A.ok('fast lane is downstream of the ingress security gate', preFast.has('Fast Static Lane'));
}

A.section('WF18 topology — command lane (/status from batch, /cancel ack + continue)');
{
  A.ok('New Update? routes into Command Lane', edges(WF18).some(e => e.from === 'New Update?' && e.to === 'Command Lane' && e.out === 0));
  A.ok('command reply sends via Send Command Reply', edges(WF18).some(e => e.from === 'Command Reply?' && e.to === 'Send Command Reply' && e.out === 0));
  A.ok('heavy chain continues only via Continue Heavy Path?', edges(WF18).some(e => e.from === 'Continue Heavy Path?' && e.to === 'Read conversation_state' && e.out === 0));
  // command lane behavior via the real Code node
  const run = H.makeRun();
  const plans = [{ plan_id: 'p1', owner_user_id: 'u1', agent_request_id: 'r1', status: 'collecting', sources: 'website,telegram', intent: 'competitor_market_scan' }];
  H.inject(run, 'Resolve Winner', [{ parsed: { kind: 'status', chat_id: 'c1', user_id: 'u1', text: '/status' } }]);
  H.inject(run, 'Batch Read Sheets', [{ valueRanges: [{ range: 'execution_plans!A1:Z9', values: [Object.keys(plans[0]), Object.keys(plans[0]).map(k => plans[0][k])] }] }]);
  const st = H.runCodeNode(run, WF18, 'Command Lane', [{ json: {} }])[0].json;
  A.eq('status lane answers without the heavy chain', st.continue_heavy, false);
  A.ok('status text is the humanized Russian stage', JSON.parse(st.telegram_send_body).text.indexOf('сбор данных') >= 0);
  A.ok('status text never leaks the raw enum', JSON.parse(st.telegram_send_body).text.indexOf('collecting') < 0);
  const run2 = H.makeRun();
  H.inject(run2, 'Resolve Winner', [{ parsed: { kind: 'cancel', chat_id: 'c1', user_id: 'u1', text: '/cancel' } }]);
  const cn = H.runCodeNode(run2, WF18, 'Command Lane', [{ json: {} }])[0].json;
  A.eq('cancel lane acks immediately', JSON.parse(cn.telegram_send_body).text.indexOf('Отменяю') >= 0, true);
  A.eq('cancel CONTINUES to the real WF22 lifecycle', cn.continue_heavy, true);
  const run3 = H.makeRun();
  H.inject(run3, 'Resolve Winner', [{ parsed: { kind: 'request', chat_id: 'c1', user_id: 'u1', text: 'найди брокеров' } }]);
  const rq = H.runCodeNode(run3, WF18, 'Command Lane', [{ json: {} }])[0].json;
  A.eq('a business request passes through untouched', rq.continue_heavy, true);
  A.eq('a business request sends no lane reply', rq.has_reply, false);
}

A.section('fast reply content — canonical Russian renderers via the real Code node');
{
  const cfg = { enable_telegram: true };
  const run = H.makeRun();
  H.inject(run, 'Ingress Security Gate', [{ gate: { accepted: true }, parsed: { kind: 'command', text: '/start', chat_id: 'c1', user_id: 'u1' }, cfg }]);
  const out = H.runCodeNode(run, WF18, 'Fast Static Lane', [{ json: {} }])[0].json;
  A.eq('/start rides the fast lane', out.fast, true);
  const body = JSON.parse(out.telegram_send_body);
  A.ok('/start returns the canonical welcome', body.text.indexOf('Я Vinci') >= 0);
  A.eq('reply goes to the sender chat', body.chat_id, 'c1');
  const run2 = H.makeRun();
  H.inject(run2, 'Ingress Security Gate', [{ gate: { accepted: true }, parsed: { kind: 'request', text: 'Найди брокеров в Москве', chat_id: 'c1' }, cfg }]);
  const out2 = H.runCodeNode(run2, WF18, 'Fast Static Lane', [{ json: {} }])[0].json;
  A.eq('a business request does NOT ride the fast lane', out2.fast, false);
}

A.section('TELEGRAM-MENU-001 — one canonical command registry, valid + minimal');
{
  const cmds = TC.botCommands();
  A.eq('registry validates', TC.validateCommands(cmds).ok, true);
  A.eq('exactly the four genuinely supported public commands', cmds.map(c => c.command).join(','), 'start,help,status,cancel');
  for (const c of cmds) {
    A.ok('/' + c.command + ' has a concise Russian description', /[а-яё]/i.test(c.description) && c.description.length <= 64);
  }
  A.eq('setMyCommands body uses the default scope (private chat menu)', TC.setMyCommandsBody().scope.type, 'default');
  A.eq('menu button opens the command list', TC.setChatMenuButtonBody().menu_button.type, 'commands');
  A.eq('bad command name rejected', TC.validateCommands([{ command: 'Bad-Name', description: 'что-то' }]).ok, false);
  A.eq('duplicate command rejected', TC.validateCommands([{ command: 'start', description: 'один' }, { command: 'start', description: 'два' }]).ok, false);
  A.eq('empty list rejected', TC.validateCommands([]).ok, false);
}

A.section('registration wiring — idempotent, token-safe, separate from the webhook check');
{
  const sh = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'telegram_webhook.sh'), 'utf8');
  for (const m of ['setMyCommands', 'getMyCommands', 'setChatMenuButton', 'getChatMenuButton']) {
    A.ok('telegram_webhook.sh uses ' + m, sh.indexOf(m) >= 0);
  }
  A.ok('menu payload comes from the canonical registry tool', sh.indexOf('telegram_menu_payload.js') >= 0);
  A.ok('menu-set is dry-run by default', sh.indexOf('TELEGRAM_MENU_SET=DRYRUN') >= 0);
  A.ok('menu verify emits its own separate marker', sh.indexOf('TELEGRAM_COMMANDS_MATCH=') >= 0 && sh.indexOf('WEBHOOK_MATCH=') >= 0);
  A.ok('token flows only through the --config pattern (never argv echo)', /api_json\(\)\s*\{[\s\S]*?--config/.test(sh) || sh.indexOf('curl --config') >= 0);
  A.ok('no echo/printf of the raw token variable', !/say[^\n]*\$TOKEN|echo[^\n]*\$TOKEN|printf[^\n]*TELEGRAM_BOT_TOKEN/.test(sh));
  const dep = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy_n8n.sh'), 'utf8');
  A.ok('deploy activate-telegram registers the menu AFTER webhook verify', dep.indexOf('menu-set --apply') >= 0);
  A.ok('menu failure never rolls back the verified gateway', dep.indexOf('TELEGRAM_MENU=FAIL — gateway stays ACTIVE') > 0 || dep.indexOf('gateway stays ACTIVE') > 0);
  const payload = require('../n8n/lib/telegram_commands.js').setMyCommandsBody();
  A.ok('payload tool emits the same canonical list', JSON.stringify(payload.commands) === JSON.stringify(TC.botCommands()));
}

A.report('fast-lane');
