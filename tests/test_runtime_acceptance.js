// test_runtime_acceptance.js — OFFLINE validation of the Stage 4 disposable runtime-acceptance fixtures + runner
// (RUNTIME-ACCEPTANCE-001). This runs in `make test` ($0, no docker): it proves the fixtures are well-formed, the
// gate embeds the COMMITTED telegram_io.js byte-identically, every scenario's expected routing matches what the
// REAL ingressDecision actually returns, and the runner emits honest markers + never targets production. The
// ACTUAL n8n execution is proven separately by scripts/n8n_runtime_acceptance.sh (DISPOSABLE_RUNTIME_PROVEN).
'use strict';
const A = require('./_assert');
const fs = require('fs');
const path = require('path');
const G = require('../tools/gen_runtime_acceptance_fixtures.js');
const embed = require('../tools/embed_lib.js');
const tio = require('../n8n/lib/telegram_io.js');

const ROOT = path.join(__dirname, '..');
const fx = G.genFixtures();

A.section('runtime fixtures — complete set, well-formed, all inactive');
{
  const names = Object.keys(fx);
  const want = ['rtgatebadsecret.json', 'rtgatemissingsecret.json', 'rtgatetelegramdisabled.json', 'rtgateunsupportedupdate.json',
    'rtgatebotmessage.json', 'rtgatenonprivatechat.json', 'rtgateunauthorized.json', 'rtgateduplicate.json', 'rtgateaccept.json',
    'rtchildok.json', 'rtparentok.json', 'rtchildfail.json', 'rtparentfail.json', 'rtwebhook.json'];
  for (const w of want) A.ok('fixture present: ' + w, names.indexOf(w) >= 0);
  for (const f of names) {
    const w = fx[f];
    A.ok(f + ' active=false', w.active === false);
    A.ok(f + ' has nodes', (w.nodes || []).length > 0);
    A.ok(f + ' has a unique id', !!w.id);
  }
  const ids = names.map(n => fx[n].id);
  A.eq('all fixture ids unique', new Set(ids).size, ids.length);
}

A.section('gate node embeds the COMMITTED telegram_io.js (drift-proof, byte-identical to WF18 stripCore)');
{
  const committedCore = embed.stripCore(fs.readFileSync(path.join(ROOT, 'n8n', 'lib', 'telegram_io.js'), 'utf8'));
  const gate = fx['rtgateaccept.json'].nodes.find(n => n.name === 'Ingress Security Gate');
  A.ok('gate code contains the committed core', gate.parameters.jsCode.indexOf(committedCore) >= 0);
  A.ok('gate calls ingressDecision', /ingressDecision\(\{/.test(gate.parameters.jsCode));
  // the WF18 production gate embeds the SAME core — prove our fixture is not a divergent copy
  const wf18 = require('../n8n/workflows/18_telegram_agent_gateway.json');
  const wf18gate = wf18.nodes.find(n => n.name === 'Ingress Security Gate');
  A.ok('WF18 gate also embeds the committed core', wf18gate.parameters.jsCode.indexOf(committedCore) >= 0);
}

A.section('each scenario expectation matches what the REAL ingressDecision returns');
{
  for (const s of G.SCENARIOS) {
    const d = tio.ingressDecision({ update: s.update, headers: s.headers, expectedSecret: G.SECRET, cfg: s.cfg });
    if (s.name === 'duplicate') {
      A.ok('duplicate: ingress ACCEPTS (deduped later by New Update?)', d.accepted === true);
      A.eq('duplicate expected route = terminate', s.expect_reached, 'terminate');
    } else if (s.name === 'accept') {
      A.ok('accept: ingress ACCEPTS', d.accepted === true);
      A.eq('accept expected route = dispatch', s.expect_reached, 'dispatch');
    } else {
      A.ok(s.name + ': ingress REJECTS', d.accepted === false);
      A.eq(s.name + ' stop_reason', d.stop_reason, s.stop_reason);
      A.eq(s.name + ' expected route = terminate', s.expect_reached, 'terminate');
    }
  }
  // exactly 8 reject/duplicate-terminate scenarios + 1 dispatch scenario
  A.eq('8 terminate scenarios', G.SCENARIOS.filter(s => s.expect_reached === 'terminate').length, 8);
  A.eq('1 dispatch scenario', G.SCENARIOS.filter(s => s.expect_reached === 'dispatch').length, 1);
}

A.section('gate workflow routing mirrors WF18 (Ingress Accepted? -> Claim -> New Update? -> dispatch/terminate)');
{
  const w = fx['rtgateaccept.json'];
  const names = w.nodes.map(n => n.name);
  for (const n of ['Ingress Security Gate', 'Ingress Accepted?', 'Claim Idempotency', 'New Update?', 'Reached Dispatch (side-effect region)', 'Terminate Safely (rejected)', 'Terminate Safely (duplicate)', 'Assert Routing'])
    A.ok('node present: ' + n, names.indexOf(n) >= 0);
  const C = w.connections;
  // Ingress Accepted? true(0)->Claim, false(1)->Terminate(rejected)
  A.eq('IA true -> Claim Idempotency', C['Ingress Accepted?'].main[0][0].node, 'Claim Idempotency');
  A.eq('IA false -> Terminate (rejected)', C['Ingress Accepted?'].main[1][0].node, 'Terminate Safely (rejected)');
  // New Update? true(0)->Reached Dispatch, false(1)->Terminate(duplicate)
  A.eq('NU true -> Reached Dispatch', C['New Update?'].main[0][0].node, 'Reached Dispatch (side-effect region)');
  A.eq('NU false -> Terminate (duplicate)', C['New Update?'].main[1][0].node, 'Terminate Safely (duplicate)');
  // all three terminals converge on Assert Routing
  for (const t of ['Reached Dispatch (side-effect region)', 'Terminate Safely (duplicate)', 'Terminate Safely (rejected)'])
    A.eq(t + ' -> Assert Routing', C[t].main[0][0].node, 'Assert Routing');
  // IF nodes are real n8n IF v2 boolean-true conditions
  const ia = w.nodes.find(n => n.name === 'Ingress Accepted?');
  A.eq('Ingress Accepted? is an IF node', ia.type, 'n8n-nodes-base.if');
  A.ok('Ingress Accepted? checks $json.accepted', /\$json\.accepted/.test(JSON.stringify(ia.parameters.conditions)));
  const nu = w.nodes.find(n => n.name === 'New Update?');
  A.ok('New Update? checks !$json.duplicate', /!\$json\.duplicate/.test(JSON.stringify(nu.parameters.conditions)));
  // Assert Routing throws on mismatch (the real execute-time signal)
  const assert = w.nodes.find(n => n.name === 'Assert Routing');
  A.ok('Assert Routing throws ROUTING_MISMATCH', /throw new Error\("ROUTING_MISMATCH/.test(assert.parameters.jsCode));
}

A.section('parent/child + child-failure fixtures use real Execute Workflow (Trigger) nodes');
{
  const child = fx['rtchildok.json'];
  const ct = child.nodes.find(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
  A.ok('child has Execute Workflow Trigger', !!ct);
  A.eq('child trigger is passthrough (CLI-executable under checkForWorkflowIssues)', ct.parameters.inputSource, 'passthrough');
  A.ok('parent seeds canonical input before calling the child', fx['rtparentok.json'].nodes.some(n => /agent_request_id/.test(n.parameters && n.parameters.jsCode || '')));
  A.ok('child echoes the request id (data contract round-trips)', child.nodes.some(n => /got_request_id/.test(n.parameters && n.parameters.jsCode || '')));
  const parent = fx['rtparentok.json'];
  const call = parent.nodes.find(n => n.type === 'n8n-nodes-base.executeWorkflow');
  A.ok('parent has Execute Workflow node', !!call);
  A.eq('parent calls rtchildok by id', call.parameters.workflowId.value, 'rtchildok');
  A.eq('parent uses the proven production executeWorkflow options ({})', JSON.stringify(call.parameters.options), '{}');
  A.ok('parent asserts round-trip (throws on failure)', parent.nodes.some(n => /PARENT_CHILD_FAIL/.test(n.parameters && n.parameters.jsCode || '')));
  // failure propagation fixtures
  const childFail = fx['rtchildfail.json'];
  A.ok('failing child throws', childFail.nodes.some(n => /CHILD_INTENTIONAL_FAILURE/.test(n.parameters && n.parameters.jsCode || '')));
  const parentFail = fx['rtparentfail.json'];
  A.eq('parentfail calls rtchildfail', parentFail.nodes.find(n => n.type === 'n8n-nodes-base.executeWorkflow').parameters.workflowId.value, 'rtchildfail');
  A.ok('parentfail has the swallowed-failure guard', parentFail.nodes.some(n => /CHILD_FAILURE_WAS_SWALLOWED/.test(n.parameters && n.parameters.jsCode || '')));
}

A.section('webhook respond-200 fixture is a real Webhook -> Respond 200 -> gate (WF18 front edge)');
{
  const w = fx['rtwebhook.json'];
  const wh = w.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
  A.ok('has a Webhook node', !!wh);
  A.eq('webhook POST', wh.parameters.httpMethod, 'POST');
  A.eq('webhook responseMode=responseNode', wh.parameters.responseMode, 'responseNode');
  const rw = w.nodes.find(n => n.type === 'n8n-nodes-base.respondToWebhook');
  A.ok('has Respond to Webhook', !!rw);
  A.eq('responds 200', rw.parameters.responseCode, 200);
  A.eq('webhook -> respond', w.connections['RT Webhook'].main[0][0].node, 'Respond 200');
  A.eq('respond -> gate', w.connections['Respond 200'].main[0][0].node, 'Ingress Security Gate');
  A.ok('webhook gate reads cfg from $env (faithful to WF18)', /\$env/.test(w.nodes.find(n => n.name === 'Ingress Security Gate').parameters.jsCode));
}

A.section('runner script — honest markers, disposable-only, layer-3 operator-pending');
{
  const s = fs.readFileSync(path.join(ROOT, 'scripts', 'n8n_runtime_acceptance.sh'), 'utf8');
  A.ok('defaults markers to SKIPPED (no fake PASS)', /M\[\$k\]="SKIPPED"/.test(s));
  A.ok('emits STAGE4_RUNTIME_REJECT_PATHS', /STAGE4_RUNTIME_REJECT_PATHS/.test(s));
  A.ok('emits PARENT_CHILD_RUNTIME_CONTRACT', /PARENT_CHILD_RUNTIME_CONTRACT/.test(s));
  A.ok('emits CHILD_FAILURE_PROPAGATES', /CHILD_FAILURE_PROPAGATES/.test(s));
  A.ok('layer 3 accepted path is OPERATOR_PENDING', /ACCEPTED_PATH_WITH_REAL_SHEETS=OPERATOR_PENDING/.test(s));
  A.ok('telegram live is OPERATOR_PENDING', /TELEGRAM_LIVE=OPERATOR_PENDING/.test(s));
  A.ok('webhook respond-200 is OPERATOR_PENDING (live server/owner-setup scoped, not faked)', /WEBHOOK_RESPONDS_200=OPERATOR_PENDING/.test(s));
  A.ok('activates callable children before CLI execute (n8n 2.23.3 inactive-sub-workflow limitation)', /update:workflow --id=rtchildok --active=true/.test(s));
  A.ok('uses --network none (no external calls)', /--network none/.test(s));
  A.ok('guards disposable names', /disp_guard_name/.test(s));
  A.ok('never hard-codes production container', !/--name "n8n-n8n-1"/.test(s) && !/--name n8n-n8n-1/.test(s));
  A.ok('SKIPPED (not PASS) without docker/image', /RUNTIME_ACCEPTANCE=SKIPPED/.test(s) && /disp_docker_ready/.test(s));
}

A.report('runtime-acceptance');
