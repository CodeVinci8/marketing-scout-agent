// test_wf04_force_reprocess.js — FORCE-REPROCESS-001 regression on the REAL WF04 node ($0, no network).
// The callable trigger types `force_reprocess` as a STRING, but 'Set URL List' only honored boolean `true`,
// so an agent-driven re-collection of an already-registered URL was always dedup-skipped (no fresh rows).
// Downstream (Normalize URL for Dedup / Evaluate Dedup) already accept 'true'; this proves Set URL List does too.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('04_firecrawl_url_list_resilient.json');

function setUrlList(input) {
  const run = H.makeRun();
  return H.runCodeNode(run, wf, 'Set URL List', [{ json: input }]);
}

const urls = ['https://mkbkfin.ru', 'https://lioncredit.ru', 'https://finardi.ru'];

A.section('FORCE-REPROCESS-001 — string "true" from the callable is honored');
const asString = setUrlList({ agent_request_id: 'req_x', source_run_id: 'req_x::website::a1', urls, force_reprocess: 'true' });
A.eq('3 url items produced', asString.length, 3);
A.ok('every item force_reprocess === true (string "true" accepted)', asString.every(i => i.json.force_reprocess === true));

A.section('FORCE-REPROCESS-001 — boolean true still honored; absent/false stays false');
const asBool = setUrlList({ agent_request_id: 'req_x', urls, force_reprocess: true });
A.ok('boolean true still honored', asBool.every(i => i.json.force_reprocess === true));
const asAbsent = setUrlList({ agent_request_id: 'req_x', urls });
A.ok('absent → force_reprocess false (no accidental bypass)', asAbsent.every(i => i.json.force_reprocess === false));
const asFalse = setUrlList({ agent_request_id: 'req_x', urls, force_reprocess: 'false' });
A.ok('string "false" → false (only the literal "true" bypasses)', asFalse.every(i => i.json.force_reprocess === false));

A.report('wf04-force-reprocess');
