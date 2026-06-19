// test_wf06_processed.js — proves WF06 persists approval_status=processed for candidates confirmed in
// url_registry, in the ACTUAL node output + the real Google Sheets update node mapping. ($0, no network.)
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('06_approved_candidates_runner.json');

// A candidate already written to url_registry by WF04 (its normalized URL is present in registry).
const candidates = [
  { candidate_id: 'cand_finardi_01', discovery_request_id: 'disc_1', candidate_url: 'https://finardi.ru/pts-zaim',
    normalized_source_url: 'https://finardi.ru/pts-zaim', candidate_type: 'direct_competitor', approval_status: 'approved',
    confidence_score: 78, rank: 1, dedup_status: '', registry_status: '', notes: '' },
  // a second, still-pending approved candidate NOT in registry -> stays approved (not processed)
  { candidate_id: 'cand_new_02', discovery_request_id: 'disc_1', candidate_url: 'https://newcomp.ru/credit',
    normalized_source_url: 'https://newcomp.ru/credit', candidate_type: 'direct_competitor', approval_status: 'approved',
    confidence_score: 60, rank: 2, dedup_status: '', registry_status: '', notes: '' }
];
const registry = [{ normalized_source_url: 'https://finardi.ru/pts-zaim', source_url: 'https://finardi.ru/pts-zaim' }];

const run = H.makeRun();
H.runCodeNode(run, wf, 'Set Runner Config', []);
H.inject(run, 'Read url_candidates', candidates);
H.inject(run, 'Read url_registry', registry);
const annotated = H.runCodeNode(run, wf, 'Select, Prioritize & Annotate', []).map(i => i.json);
const summary = H.runCodeNode(run, wf, 'Build Execution Summary & Handoff', annotated)[0].json;

const confirmed = annotated.find(r => r.candidate_id === 'cand_finardi_01');
const pending = annotated.find(r => r.candidate_id === 'cand_new_02');

A.section('WF06 — registry-confirmed candidate persisted as approval_status=processed (S2-D18)');
A.ok('confirmed row found', !!confirmed);
A.eq('confirmed not selected for handoff', confirmed._selected, false);
A.eq('confirmed skip_category=registry_recheck_duplicate', confirmed._skip_category, 'registry_recheck_duplicate');
A.eq('confirmed _confirm_processed=true', confirmed._confirm_processed, true);
A.eq('confirmed approval_status=processed (actual update payload)', confirmed.approval_status, 'processed');
A.ok('confirmed processed_update_payload present', !!confirmed.processed_update_payload);
A.eq('confirmed processed_update_payload.approval_status=processed', confirmed.processed_update_payload && confirmed.processed_update_payload.approval_status, 'processed');
A.eq('confirmed processed_update_payload.candidate_id matches', confirmed.processed_update_payload && confirmed.processed_update_payload.candidate_id, 'cand_finardi_01');

A.section('WF06 — non-confirmed approved candidate is NOT marked processed');
A.ok('pending row found', !!pending);
A.eq('pending approval_status still approved', pending.approval_status, 'approved');
A.eq('pending _confirm_processed=false', pending._confirm_processed, false);
A.eq('pending processed_update_payload null', pending.processed_update_payload, null);

// Acceptance rerun scenario (brief §7): the ONLY candidate is the one now confirmed in registry.
const run2 = H.makeRun();
H.runCodeNode(run2, wf, 'Set Runner Config', []);
H.inject(run2, 'Read url_candidates', [candidates[0]]);
H.inject(run2, 'Read url_registry', registry);
const annotated2 = H.runCodeNode(run2, wf, 'Select, Prioritize & Annotate', []).map(i => i.json);
const summary2 = H.runCodeNode(run2, wf, 'Build Execution Summary & Handoff', annotated2)[0].json;

A.section('WF06 — rerun acceptance (only registry-confirmed candidate)');
A.eq('selected_count=0', summary2.selected_count, 0);
A.eq('registry_recheck_duplicate counted', summary2.registry_recheck_duplicate, 1);
A.eq('confirm_processed_count=1', summary2.confirm_processed_count, 1);
A.eq('mixed-run confirm_processed_count=1', summary.confirm_processed_count, 1);

A.section('WF06 — real Google Sheets update node writes processed, keyed by candidate_id');
const upd = wf.nodes.find(n => n.name === 'Mark Candidates Processed (confirmed in url_registry)');
A.ok('update node present', !!upd);
A.eq('operation=update', upd.parameters.operation, 'update');
A.eq('target tab url_candidates', upd.parameters.sheetName.value, 'url_candidates');
A.eq('matching column candidate_id', upd.parameters.columns.matchingColumns[0], 'candidate_id');
A.eq('approval_status sourced from node payload', upd.parameters.columns.value.approval_status, '={{ $json.approval_status }}');
// IF node routes only confirmed rows into the update node.
const ifn = wf.nodes.find(n => n.name === 'IF Confirmed Processed?');
A.ok('IF gate on _confirm_processed', JSON.stringify(ifn.parameters).indexOf('_confirm_processed') >= 0);

A.section('WF06 — no external call performed by tested path');
A.ok('no httpRequest node in WF06', !wf.nodes.some(n => n.type === 'n8n-nodes-base.httpRequest'));

A.report('wf06-processed');
