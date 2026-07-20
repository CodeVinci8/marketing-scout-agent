'use strict';
// PLAN-TERMINAL-001 — a completed run must leave its plan TERMINAL.
//
// Live regression (WF20 exec 904, plan_req_1784216513_h6ef5737d): the run completed, 'Shape Plan Completion'
// emitted status='completed', and 'Mark Plan Complete' returned success with no error — yet the sheet row stayed
// status='approved'. Node timings showed why:
//     +110400 ms  Mark Plan Complete   -> writes completed
//     +112310 ms  Mark Plan Approved   -> writes approved   (1.9s LATER, clobbers it)
// 'Mark Plan Approved' hung off a FLOATING parallel branch from 'Resolve Approved Plan'. n8n executionOrder v1
// defers such a branch to the end of the run, so it (a) never ran "before collection" as its own comment claimed,
// and (b) overwrote the terminal state. Every finished run therefore stayed non-terminal, B4 reused it inside the
// 30-min TTL, and the next approval callback could never dispatch — which is what blocked the Stage-F E2E.
//
// The fix is structural: the flip is SEQUENCED into the main path, so no scheduler choice can reorder them.
// Offline, $0.
const A = require('./_assert.js');
const H = require('./wf_harness.js');
const fs = require('fs'); const path = require('path');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '20_agent_orchestrator.json'), 'utf8'));
const node = (n) => wf.nodes.find(x => x.name === n);

// Longest path from any trigger to `name`. A strictly smaller depth means "can never run after".
function depth(name, seen) {
  seen = seen || new Set();
  if (seen.has(name)) return 0;
  seen.add(name);
  let d = 0;
  for (const [from, v] of Object.entries(wf.connections)) {
    const outs = (v.main || []).flat().map(x => x.node);
    if (outs.indexOf(name) >= 0) d = Math.max(d, depth(from, new Set(seen)) + 1);
  }
  return d;
}

A.section('the approval flip is SEQUENCED before collection — not a floating branch a scheduler may defer');
{
  A.ok('the guard node exists', !!node('Plan To Approve?'));
  A.ok('the flip node exists', !!node('Shape Plan Approval Upsert'));
  A.ok('the approved write exists', !!node('Mark Plan Approved'));
  A.ok('the completion write exists', !!node('Mark Plan Complete'));

  const c = wf.connections;
  A.ok('resolve feeds the guard', JSON.stringify(c['Resolve Approved Plan']).indexOf('Plan To Approve?') >= 0);
  A.ok('guard TRUE -> flip', JSON.stringify(c['Plan To Approve?'].main[0]).indexOf('Shape Plan Approval Upsert') >= 0);
  A.ok('guard FALSE -> straight to collection (a manual/no-plan run is never blocked)',
    JSON.stringify(c['Plan To Approve?'].main[1]).indexOf('Orchestration Reuse Decision') >= 0);
  A.ok('flip -> approved write', JSON.stringify(c['Shape Plan Approval Upsert']).indexOf('Mark Plan Approved') >= 0);
  A.ok('approved write REJOINS the main path (so it cannot float to the end)',
    JSON.stringify(c['Mark Plan Approved']).indexOf('Orchestration Reuse Decision') >= 0);
  A.eq('an empty approved write still continues the run', node('Mark Plan Approved').alwaysOutputData, true);
  // resolve must no longer reach collection directly, or the flip could still be bypassed/deferred
  A.ok('resolve does NOT bypass the guard', JSON.stringify(c['Resolve Approved Plan']).indexOf('Orchestration Reuse Decision') < 0);

  // THE regression, expressed structurally: approved-write strictly upstream of completion-write.
  const a = depth('Mark Plan Approved'), t = depth('Mark Plan Complete');
  A.ok('Mark Plan Approved is strictly UPSTREAM of Mark Plan Complete (' + a + ' < ' + t + ')', a < t);
  A.ok('...and of the report build too (approved really is "before collection")', a < depth('Run WF12 Report'));
  A.ok('...and before the first collector', a < depth('Run Website Source (WF04)'));
}

A.section('Resolve Approved Plan exposes a plain boolean the IF can test');
{
  function resolve(planRows, caller) {
    const r = H.makeRun();
    H.inject(r, 'Read execution_plans', planRows);
    H.inject(r, 'When Called by Agent', [caller]);
    return H.runCodeNode(r, wf, 'Resolve Approved Plan', [{ json: {} }])[0].json;
  }
  const awaiting = { plan_id: 'p1', plan_hash: 'h1', status: 'awaiting_approval', owner_user_id: 'o1',
    intent: 'competitor_market_scan', sources: 'website', urls: 'https://x.ru', max_items: '10' };

  const ok = resolve([awaiting], { plan_id: 'p1', plan_hash: 'h1', agent_request_id: 'req_a' });
  A.eq('an awaiting plan flips', ok.needs_approval_flip, true);
  A.eq('...and resolves', ok.plan_resolution, 'resolved');
  A.eq('...and is not blocked', ok.plan_blocked, false);

  A.eq('no plan_id (manual run) => no flip', resolve([{}], { agent_request_id: 'req_m' }).needs_approval_flip, false);
  A.eq('missing plan => no flip', resolve([awaiting], { plan_id: 'nope', agent_request_id: 'r' }).needs_approval_flip, false);
  A.eq('hash mismatch => no flip', resolve([awaiting], { plan_id: 'p1', plan_hash: 'WRONG', agent_request_id: 'r' }).needs_approval_flip, false);
  A.eq('already-approved plan => no flip (a second press cannot re-run it)',
    resolve([Object.assign({}, awaiting, { status: 'approved' })], { plan_id: 'p1', plan_hash: 'h1', agent_request_id: 'r' }).needs_approval_flip, false);
  A.eq('terminal plan => no flip',
    resolve([Object.assign({}, awaiting, { status: 'completed' })], { plan_id: 'p1', plan_hash: 'h1', agent_request_id: 'r' }).needs_approval_flip, false);
  A.eq('cancelled plan => no flip',
    resolve([Object.assign({}, awaiting, { status: 'cancelled' })], { plan_id: 'p1', plan_hash: 'h1', agent_request_id: 'r' }).needs_approval_flip, false);
  A.eq('the guard is a strict boolean (an IF cannot test a null object)', typeof resolve([{}], {}).needs_approval_flip, 'boolean');
}

A.section('the terminal state written at the end matches the run outcome');
{
  function complete(finalState) {
    const r = H.makeRun();
    H.inject(r, 'Read execution_plans', [{ plan_id: 'p1' }]);
    H.inject(r, 'Resolve Approved Plan', [{ plan_row: { plan_id: 'p1', owner_user_id: 'o1', status: 'approved' }, plan_blocked: false, needs_approval_flip: true }]);
    H.inject(r, 'Build Execution Summary', [{ summary: { final_state: finalState }, request: { agent_request_id: 'req_1' } }]);
    const out = H.runCodeNode(r, wf, 'Shape Plan Completion', [{ json: {} }]);
    return out.length ? out[0].json : null;
  }
  A.eq('completed run => completed', complete('completed').status, 'completed');
  A.eq('no_data run => no_data (terminal)', complete('no_data').status, 'no_data');
  A.eq('failed run => failed', complete('failed').status, 'failed');
  A.eq('error run => failed', complete('error').status, 'failed');
  A.eq('partial run => completed (delivered)', complete('partial').status, 'completed');
  A.ok('the completion row carries decided_at', !!complete('completed').decided_at);
  A.ok('the completion row keeps the plan id (so the upsert matches, never appends)', complete('completed').plan_id === 'p1');

  // a blocked/absent plan writes nothing at all — no phantom row
  const r = H.makeRun();
  H.inject(r, 'Resolve Approved Plan', [{ plan_row: null, plan_blocked: true }]);
  H.inject(r, 'Build Execution Summary', [{ summary: { final_state: 'completed' }, request: {} }]);
  A.eq('a blocked plan writes no completion row', H.runCodeNode(r, wf, 'Shape Plan Completion', [{ json: {} }]).length, 0);
}

A.section('both plan writes target the SAME row by plan_id (never a duplicate append)');
{
  [['Mark Plan Approved', 'approved'], ['Mark Plan Complete', 'terminal']].forEach(([n]) => {
    const p = node(n).parameters;
    A.eq(n + ' upserts (never plain append)', p.operation, 'appendOrUpdate');
    A.eq(n + ' matches on plan_id', JSON.stringify(p.columns.matchingColumns), JSON.stringify(['plan_id']));
    A.eq(n + ' targets execution_plans', p.sheetName.value, 'execution_plans');
  });
}

A.report('plan-terminal');
