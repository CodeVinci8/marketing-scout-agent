// gen_runtime_acceptance_fixtures.js — generate the DISPOSABLE runtime-acceptance workflow fixtures for Stage 4
// (RUNTIME-ACCEPTANCE-001). These run in a real disposable n8n 2.23.3 via `n8n execute` (exit-code = the signal),
// so they prove ACTUAL execution semantics, not just graph reachability:
//
//   * gate-routing scenarios — the COMMITTED n8n/lib/telegram_io.js ingressDecision (embedded byte-identically via
//     embed.stripCore, exactly like WF18's "Ingress Security Gate") runs inside a real Code node, feeding the same
//     two-stage IF routing WF18 uses (Ingress Accepted? -> Claim Idempotency -> New Update?). Each reject scenario
//     MUST route to "Terminate Safely" (zero side effects); the accept scenario MUST reach the dispatch region.
//     A per-scenario "Assert Routing" node THROWS on any mismatch, so `n8n execute` exits non-zero on a defect.
//   * parent/child contract — a parent Execute Workflow calls a child Execute Workflow Trigger, waits, and asserts
//     the child's canonical output round-tripped back (proves wait-for-completion + child output + continuation).
//   * child-failure propagation — a child that throws makes the PARENT execution fail (no silent swallow).
//
// Pure string/JSON generation (no I/O beyond reading the committed lib + writing fixtures); the offline test
// (tests/test_runtime_acceptance.js) validates the generated artifacts and the scenario expectations without docker.
'use strict';
const fs = require('fs');
const path = require('path');
const embed = require('./embed_lib.js');

const LIB = path.join(__dirname, '..', 'n8n', 'lib', 'telegram_io.js');
const TELEGRAM_IO_CORE = embed.stripCore(fs.readFileSync(LIB, 'utf8'));

// ---- node builders ---------------------------------------------------------------------------------------------
let _y = 0;
function pos() { _y += 0; return [0, 0]; }
function manualTrigger(name) { return { parameters: {}, type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-400, 0], id: 'n_' + name.replace(/\W/g, ''), name }; }
function code(name, jsCode, x) { return { parameters: { jsCode }, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x || 0, 0], id: 'n_' + name.replace(/\W/g, ''), name }; }
function ifBool(name, leftExpr, x) {
  return {
    parameters: {
      conditions: { options: { caseSensitive: true, typeValidation: 'strict' }, combinator: 'and',
        conditions: [{ leftValue: leftExpr, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }] },
      options: {}
    },
    type: 'n8n-nodes-base.if', typeVersion: 2, position: [x || 0, 0], id: 'n_' + name.replace(/\W/g, ''), name
  };
}
// Parent caller. The child is a PASSTHROUGH Execute Workflow Trigger, so the parent forwards its incoming items
// directly (no workflowInputs schema). NOTE: n8n 2.23.3's CLI `n8n execute` runs checkForWorkflowIssues on the
// invoked sub-workflow and REFUSES a child whose executeWorkflowTrigger uses the "workflowInputs" schema mode
// (the production named-contract mode); that named mapping is proven separately by the binding/contract tests and
// works in SERVER mode. For the DISPOSABLE CLI runtime proof we use passthrough — it still exercises the real
// Execute Workflow -> Execute Workflow Trigger -> output -> parent-continuation + wait-for-completion semantics.
function execWf(name, childId, x) {
  return {
    parameters: { workflowId: { __rl: true, value: childId, mode: 'id', cachedResultName: childId }, options: {} },
    type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.1, position: [x || 0, 0], id: 'n_' + name.replace(/\W/g, ''), name
  };
}
function execWfTrigger(name) {
  return { parameters: { inputSource: 'passthrough' }, type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 0], id: 'n_' + name.replace(/\W/g, ''), name };
}
function wf(id, name, nodes, connections) { return { id, name, active: false, settings: { executionOrder: 'v1' }, pinData: {}, nodes, connections }; }
function conn(from, mainArr) { const o = {}; o[from] = { main: mainArr }; return o; }
function mergeConns() { return Object.assign.apply(null, [{}].concat([].slice.call(arguments))); }

// ---- the gate glue: run the COMMITTED ingressDecision on the injected scenario (faithful to WF18) ---------------
const GATE_GLUE = TELEGRAM_IO_CORE + '\n' + [
  '// --- runtime-acceptance gate glue (RUNTIME-ACCEPTANCE-001): the SAME committed ingressDecision WF18 runs ---',
  'var item = $json || {};',
  'var dec = ingressDecision({ update: item.update, headers: item.headers, expectedSecret: item.expectedSecret, cfg: item.cfg });',
  '// _env_access proves Code nodes can read $env in this n8n (N8N_BLOCK_ENV_ACCESS_IN_NODE=false runtime requirement)',
  'return [{ json: { accepted: dec.accepted, stop_reason: dec.stop_reason, idempotency_key: dec.idempotency_key, _meta: item._meta || {}, _env_access: (typeof $env !== "undefined") } }];'
].join('\n');

const CLAIM_GLUE = [
  'var j = $json || {}; var m = j._meta || {};',
  '// mirror WF18 "Claim Idempotency": a duplicate update_id is flagged so "New Update?" routes it to Terminate.',
  'return [{ json: Object.assign({}, j, { duplicate: m.already_claimed === true }) }];'
].join('\n');

const ASSERT_GLUE = [
  'var j = $json || {}; var m = j._meta || {};',
  'if (j._reached !== m.expect_reached) {',
  '  throw new Error("ROUTING_MISMATCH scenario=" + m.scenario + " expected=" + m.expect_reached + " reached=" + j._reached + " accepted=" + j.accepted + " stop_reason=" + (j.stop_reason||""));',
  '}',
  'return [{ json: { ok: true, scenario: m.scenario, reached: j._reached, accepted: j.accepted, stop_reason: j.stop_reason||"" } }];'
].join('\n');

function reachedNode(name, reached) { return code(name, 'return [{ json: Object.assign({}, $json, { _reached: "' + reached + '" }) }];', 300); }

// ---- scenario definitions (drive cfg/update/headers from the injected item; ingressDecision itself is committed) -
const SECRET = 'rt_secret_value_1234567890';
const GOOD_HDR = { 'x-telegram-bot-api-secret-token': SECRET };
const CFG_ON = { enable_telegram: true, telegram_allowed_user_ids: ['111'] };
const CFG_OFF = { enable_telegram: false, telegram_allowed_user_ids: ['111'] };
function privMsg(over) { return Object.assign({ update_id: 1001, message: Object.assign({ message_id: 5, from: { id: 111, is_bot: false }, chat: { id: 111, type: 'private' }, text: 'hi', date: 1 }, (over && over.message) || {}) }, over && over.top || {}); }

const SCENARIOS = [
  { name: 'bad_secret', expect_reached: 'terminate', stop_reason: 'bad_secret', update: privMsg(), headers: { 'x-telegram-bot-api-secret-token': 'WRONG_SECRET_VALUE' }, cfg: CFG_ON, already_claimed: false },
  { name: 'missing_secret', expect_reached: 'terminate', stop_reason: 'bad_secret', update: privMsg(), headers: {}, cfg: CFG_ON, already_claimed: false },
  { name: 'telegram_disabled', expect_reached: 'terminate', stop_reason: 'telegram_disabled', update: privMsg(), headers: GOOD_HDR, cfg: CFG_OFF, already_claimed: false },
  { name: 'unsupported_update', expect_reached: 'terminate', stop_reason: 'unsupported_update', update: { update_id: 1002, edited_message: { message_id: 6, from: { id: 111, is_bot: false }, chat: { id: 111, type: 'private' }, text: 'edited' } }, headers: GOOD_HDR, cfg: CFG_ON, already_claimed: false },
  { name: 'bot_message', expect_reached: 'terminate', stop_reason: 'bot_message', update: privMsg({ message: { from: { id: 111, is_bot: true } } }), headers: GOOD_HDR, cfg: CFG_ON, already_claimed: false },
  { name: 'non_private_chat', expect_reached: 'terminate', stop_reason: 'non_private_chat', update: privMsg({ message: { chat: { id: -100, type: 'group' } } }), headers: GOOD_HDR, cfg: CFG_ON, already_claimed: false },
  { name: 'unauthorized', expect_reached: 'terminate', stop_reason: 'unauthorized', update: privMsg({ message: { from: { id: 999, is_bot: false } } }), headers: GOOD_HDR, cfg: CFG_ON, already_claimed: false },
  { name: 'duplicate', expect_reached: 'terminate', stop_reason: '', update: privMsg(), headers: GOOD_HDR, cfg: CFG_ON, already_claimed: true },
  { name: 'accept', expect_reached: 'dispatch', stop_reason: '', update: privMsg(), headers: GOOD_HDR, cfg: CFG_ON, already_claimed: false }
];

function gateWorkflow(s) {
  const id = 'rtgate' + s.name.replace(/_/g, '');
  const inject = code('Inject Update', 'return [{ json: ' + JSON.stringify({
    update: s.update, headers: s.headers, expectedSecret: SECRET, cfg: s.cfg,
    _meta: { scenario: s.name, expect_reached: s.expect_reached, already_claimed: s.already_claimed }
  }) + ' }];', -200);
  const gate = code('Ingress Security Gate', GATE_GLUE, 0);
  const accepted = ifBool('Ingress Accepted?', '={{ $json.accepted }}', 150);
  const claim = code('Claim Idempotency', CLAIM_GLUE, 250);
  const newUpdate = ifBool('New Update?', '={{ !$json.duplicate }}', 350);
  const dispatch = reachedNode('Reached Dispatch (side-effect region)', 'dispatch');
  const termDup = reachedNode('Terminate Safely (duplicate)', 'terminate');
  const termRej = reachedNode('Terminate Safely (rejected)', 'terminate');
  const assert = code('Assert Routing', ASSERT_GLUE, 450);
  const nodes = [manualTrigger('Start'), inject, gate, accepted, claim, newUpdate, dispatch, termDup, termRej, assert];
  const connections = mergeConns(
    conn('Start', [[{ node: 'Inject Update', type: 'main', index: 0 }]]),
    conn('Inject Update', [[{ node: 'Ingress Security Gate', type: 'main', index: 0 }]]),
    conn('Ingress Security Gate', [[{ node: 'Ingress Accepted?', type: 'main', index: 0 }]]),
    conn('Ingress Accepted?', [
      [{ node: 'Claim Idempotency', type: 'main', index: 0 }],          // true -> dedup stage
      [{ node: 'Terminate Safely (rejected)', type: 'main', index: 0 }] // false -> reject
    ]),
    conn('Claim Idempotency', [[{ node: 'New Update?', type: 'main', index: 0 }]]),
    conn('New Update?', [
      [{ node: 'Reached Dispatch (side-effect region)', type: 'main', index: 0 }], // true -> dispatch
      [{ node: 'Terminate Safely (duplicate)', type: 'main', index: 0 }]            // false -> dup terminate
    ]),
    conn('Reached Dispatch (side-effect region)', [[{ node: 'Assert Routing', type: 'main', index: 0 }]]),
    conn('Terminate Safely (duplicate)', [[{ node: 'Assert Routing', type: 'main', index: 0 }]]),
    conn('Terminate Safely (rejected)', [[{ node: 'Assert Routing', type: 'main', index: 0 }]])
  );
  return wf(id, 'RT gate :: ' + s.name, nodes, connections);
}

// ---- parent/child runtime contract + child-failure propagation -------------------------------------------------
// Canonical-ish input the parent sends and the child echoes back (proves the data contract round-trips, not just
// that the child ran). Mirrors the shape of WF18->child named fields without the workflowInputs UI mapping.
const PARENT_SEED = 'return [{ json: { agent_request_id: "req_rt_1", ping: "hello-from-parent", data_mode: "fixture" } }];';
function childOk() {
  const trig = execWfTrigger('When Called by Parent');
  const echo = code('Child Echo', 'var j = $json || {}; return [{ json: { child_ran: true, echo: String(j.ping||""), got_request_id: String(j.agent_request_id||""), marker: "child-roundtrip-ok" } }];', 220);
  return wf('rtchildok', 'RT child callable (ok)', [trig, echo], conn('When Called by Parent', [[{ node: 'Child Echo', type: 'main', index: 0 }]]));
}
function parentOk() {
  const trig = manualTrigger('Manual Start');
  const seed = code('Seed Canonical Input', PARENT_SEED, -200);
  const call = execWf('Call Child (WF)', 'rtchildok', 0);
  const assert = code('Assert Round Trip', 'var c = $json || {}; var ok = c.child_ran === true && c.marker === "child-roundtrip-ok" && c.echo === "hello-from-parent" && c.got_request_id === "req_rt_1"; if (!ok) { throw new Error("PARENT_CHILD_FAIL: " + JSON.stringify(c)); } return [{ json: { parent_child_ok: true, child_marker: c.marker, child_echo: c.echo } }];', 220);
  return wf('rtparentok', 'RT parent caller (ok)', [trig, seed, call, assert], mergeConns(
    conn('Manual Start', [[{ node: 'Seed Canonical Input', type: 'main', index: 0 }]]),
    conn('Seed Canonical Input', [[{ node: 'Call Child (WF)', type: 'main', index: 0 }]]),
    conn('Call Child (WF)', [[{ node: 'Assert Round Trip', type: 'main', index: 0 }]])
  ));
}
function childFail() {
  const trig = execWfTrigger('When Called by Parent');
  const boom = code('Child Boom', 'throw new Error("CHILD_INTENTIONAL_FAILURE");', 220);
  return wf('rtchildfail', 'RT child callable (fails)', [trig, boom], conn('When Called by Parent', [[{ node: 'Child Boom', type: 'main', index: 0 }]]));
}
function parentExpectFail() {
  const trig = manualTrigger('Manual Start');
  const seed = code('Seed Canonical Input', PARENT_SEED, -200);
  const call = execWf('Call Failing Child', 'rtchildfail', 0);
  // If we reach here, the child failure was SWALLOWED — that is the defect this fixture catches.
  const after = code('Should Not Reach', 'throw new Error("CHILD_FAILURE_WAS_SWALLOWED");', 220);
  return wf('rtparentfail', 'RT parent caller (expects child failure)', [trig, seed, call, after], mergeConns(
    conn('Manual Start', [[{ node: 'Seed Canonical Input', type: 'main', index: 0 }]]),
    conn('Seed Canonical Input', [[{ node: 'Call Failing Child', type: 'main', index: 0 }]]),
    conn('Call Failing Child', [[{ node: 'Should Not Reach', type: 'main', index: 0 }]])
  ));
}

// ---- webhook respond-200 fixture (Layer 1a): a REAL Webhook -> Respond 200 -> gate, exactly WF18's front edge ---
// Activated in the disposable; a POST (good OR bad secret) must get a prompt HTTP 200 so Telegram never retries.
// Here the gate reads cfg from $env (faithful to WF18) and update/headers from the webhook item.
const WEBHOOK_GATE_GLUE = TELEGRAM_IO_CORE + '\n' + [
  'var __env = (typeof $env !== "undefined" && $env) ? $env : {};',
  'var item = $json || {};',
  'var cfg = { enable_telegram: String(__env.MS_ENABLE_TELEGRAM||"").toLowerCase()==="true", telegram_allowed_user_ids: String(__env.MS_TELEGRAM_ALLOWED_USER_IDS||"").split(/[,\\s]+/).filter(Boolean) };',
  'var dec = ingressDecision({ update: item.body, headers: item.headers, expectedSecret: __env.MS_TELEGRAM_WEBHOOK_SECRET, cfg: cfg });',
  'return [{ json: { accepted: dec.accepted, stop_reason: dec.stop_reason } }];'
].join('\n');
function webhookFixture() {
  const webhook = { parameters: { httpMethod: 'POST', path: 'ms-rt-webhook', responseMode: 'responseNode', options: {} }, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [-300, 0], id: 'n_webhook', name: 'RT Webhook' };
  const respond = { parameters: { respondWith: 'text', responseCode: 200, responseBody: 'ok', options: {} }, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [-120, 0], id: 'n_respond', name: 'Respond 200' };
  const gate = code('Ingress Security Gate', WEBHOOK_GATE_GLUE, 60);
  const accepted = ifBool('Ingress Accepted?', '={{ $json.accepted }}', 200);
  const disp = reachedNode('Reached Dispatch (side-effect region)', 'dispatch');
  const term = reachedNode('Terminate Safely (rejected)', 'terminate');
  const nodes = [webhook, respond, gate, accepted, disp, term];
  const connections = mergeConns(
    conn('RT Webhook', [[{ node: 'Respond 200', type: 'main', index: 0 }]]),
    conn('Respond 200', [[{ node: 'Ingress Security Gate', type: 'main', index: 0 }]]),
    conn('Ingress Security Gate', [[{ node: 'Ingress Accepted?', type: 'main', index: 0 }]]),
    conn('Ingress Accepted?', [
      [{ node: 'Reached Dispatch (side-effect region)', type: 'main', index: 0 }],
      [{ node: 'Terminate Safely (rejected)', type: 'main', index: 0 }]
    ])
  );
  return wf('rtwebhook', 'RT webhook respond-200', nodes, connections);
}

function genFixtures() {
  const out = {};
  for (const s of SCENARIOS) { const w = gateWorkflow(s); out[w.id + '.json'] = w; }
  for (const w of [childOk(), parentOk(), childFail(), parentExpectFail(), webhookFixture()]) out[w.id + '.json'] = w;
  return out;
}

module.exports = { genFixtures, SCENARIOS, GATE_GLUE, WEBHOOK_GATE_GLUE, TELEGRAM_IO_CORE, SECRET };

if (require.main === module) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  if (oi < 0) { console.error('usage: node tools/gen_runtime_acceptance_fixtures.js --out <dir>'); process.exit(2); }
  const dir = args[oi + 1];
  fs.mkdirSync(dir, { recursive: true });
  const fx = genFixtures();
  for (const f of Object.keys(fx)) fs.writeFileSync(path.join(dir, f), JSON.stringify(fx[f], null, 2));
  console.log('wrote ' + Object.keys(fx).length + ' runtime-acceptance fixtures to ' + dir);
  Object.keys(fx).forEach(f => console.log('  ' + f));
}
