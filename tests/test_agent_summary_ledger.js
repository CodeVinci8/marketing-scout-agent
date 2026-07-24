// test_agent_summary_ledger.js — AGENT-SUMMARY-001 focused regression.
// Live defect (exec 366, req_1783126525951): in agent-called mode WF11 wrote 10 unique
// raw_market_records rows, but 'Build agent_requests Row' returned [] (agent guard), which killed
// the summary chain, so the live_source_runs ledger row was never written. WF16/08/10/12 trust the
// ledger, so the whole downstream pipeline saw an empty run and WF12 produced a no_data_notice.
// Same structure in WF09; additionally an empty collection (Avito blocked) killed the chain even
// earlier at 'Build raw_market_records Rows' (0 items). WF04 crashed appending to the missing
// skipped_log tab ('Sheet with name skipped_log not found') and lost ITS ledger row too.
// $0, no network.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const CONNECTORS = [
  { file: '09_avito_classifieds_listing_connector.json', cfgNode: 'Set Avito Connector Config', dedupNode: 'Deduplicate Listings' },
  { file: '11_social_source_connector_foundation.json', cfgNode: 'Set Connector Config', dedupNode: 'Deduplicate Posts' }
];

function targets(wf, from, outIndex) {
  const c = (wf.connections[from] || {}).main || [];
  return ((c[outIndex] || []).map(t => t.node));
}

for (const C of CONNECTORS) {
  const wf = H.loadWorkflow(C.file);
  A.section(C.file + ' — ledger chain survives agent mode and empty collections');

  // --- structural wiring: marker IFs route around the appends, ledger append always reachable
  A.eq('Build raw_market_records Rows feeds Any Rows To Write?', targets(wf, 'Build raw_market_records Rows', 0).join(','), 'Any Rows To Write?');
  A.eq('Any Rows To Write? true -> Append raw_market_records', targets(wf, 'Any Rows To Write?', 0).join(','), 'Append raw_market_records');
  A.eq('Any Rows To Write? false -> Build agent_requests Row (skip appends, keep chain)', targets(wf, 'Any Rows To Write?', 1).join(','), 'Build agent_requests Row');
  A.eq('Build agent_requests Row feeds Write Legacy Request Row?', targets(wf, 'Build agent_requests Row', 0).join(','), 'Write Legacy Request Row?');
  A.eq('Write Legacy Request Row? true -> Append agent_requests (manual mode unchanged)', targets(wf, 'Write Legacy Request Row?', 0).join(','), 'Append agent_requests');
  A.eq('Write Legacy Request Row? false -> Build live_source_runs Row (agent mode bypass)', targets(wf, 'Write Legacy Request Row?', 1).join(','), 'Build live_source_runs Row');
  A.eq('Build live_source_runs Row -> Append live_source_runs', targets(wf, 'Build live_source_runs Row', 0).join(','), 'Append live_source_runs');

  // --- behavior: 0 collected rows -> marker item (not 0 items)
  const runE = H.makeRun();
  H.inject(runE, C.cfgNode, [{ agent_request_id: 'req_t', created_at: '2026-07-04T00:00:00+03:00', run_id: 'req_t::x::a1', data_mode: 'live' }]);
  H.inject(runE, C.dedupNode, []);
  const emptyOut = H.runCodeNode(runE, wf, 'Build raw_market_records Rows', [{ json: {} }]);
  A.eq('empty collection emits exactly one marker item', emptyOut.length, 1);
  A.eq('marker item is ms_no_rows:true', emptyOut[0].json.ms_no_rows, true);

  // --- behavior: agent mode -> marker item (not [])
  const runA = H.makeRun();
  H.inject(runA, C.cfgNode, [{ agent_called: true, agent_request_id: 'req_t', run_id: 'req_t::x::a1' }]);
  H.inject(runA, C.dedupNode, []);
  const agentOut = H.runCodeNode(runA, wf, 'Build agent_requests Row', [{ json: { ms_no_rows: true } }]);
  A.eq('agent mode emits exactly one marker item', agentOut.length, 1);
  A.eq('marker item is ms_agent_mode:true', agentOut[0].json.ms_agent_mode, true);

  // --- behavior: manual mode still returns a real legacy row (no marker)
  const runM = H.makeRun();
  H.inject(runM, C.cfgNode, [{ agent_called: false, agent_request_id: '', run_id: 'manual_run' }]);
  H.inject(runM, C.dedupNode, [{ dedup_status: 'unique', record_type_hint: 'competitor_activity' }]);
  const manualOut = H.runCodeNode(runM, wf, 'Build agent_requests Row', [{ json: {} }]);
  A.eq('manual mode returns one legacy agent_requests row', manualOut.length, 1);
  A.ok('manual row is not a marker', manualOut[0].json.ms_agent_mode !== true);

  // --- ledger row carries the canonical items_written the adapter contract reads
  const runL = H.makeRun();
  H.inject(runL, C.cfgNode, [{ agent_called: true, agent_request_id: 'req_t', run_id: 'req_t::x::a1', created_at: '2026-07-04T00:00:00+03:00' }]);
  H.inject(runL, C.dedupNode, [{ dedup_status: 'unique' }, { dedup_status: 'duplicate_registry' }]);
  const ledger = H.runCodeNode(runL, wf, 'Build live_source_runs Row', [{ json: { ms_agent_mode: true } }]);
  A.eq('ledger emits one row', ledger.length, 1);
  A.eq('ledger items_written mirrors items_written_raw (adapter contract)', ledger[0].json.items_written, ledger[0].json.items_written_raw);
  A.eq('ledger items_unique preserved', ledger[0].json.items_unique, 1);
}

// WF11 terminal node (child return in agent mode) must speak the adapter contract
A.section('WF11 Final Summary Output — adapter-compatible aliases');
{
  const wf = H.loadWorkflow('11_social_source_connector_foundation.json');
  const run = H.makeRun();
  H.inject(run, 'Set Connector Config', [{ agent_called: true, agent_request_id: 'req_t', run_id: 'req_t::telegram::a1' }]);
  H.inject(run, 'Deduplicate Posts', [
    { dedup_status: 'unique' }, { dedup_status: 'unique' }, { dedup_status: 'duplicate_registry' }
  ]);
  const out = H.runCodeNode(run, wf, 'Final Summary Output', [{ json: {} }]);
  const j = out[0].json;
  A.eq('items_received alias present', j.items_received, 3);
  A.eq('items_written alias equals unique rows written', j.items_written, 2);
  A.ok('items_relevant alias present (number)', typeof j.items_relevant === 'number');
  const sa = require('../n8n/lib/source_adapter.js');
  const norm = sa.normalizeAdapterResult('telegram', j, { agent_request_id: 'req_t' });
  A.eq('adapter classifies a run with written rows as ok (was: empty)', norm.status, 'ok');
  A.eq('adapter sees the written count', norm.items_written, 2);
}

// WF04 — diagnostics-only skipped_log append must never kill the run
A.section('WF04 — Append Skipped Log (Duplicate) is tolerant of the missing skipped_log tab');
{
  const wf = H.loadWorkflow('04_firecrawl_url_list_resilient.json');
  const n = (wf.nodes || []).find(x => x.name === 'Append Skipped Log (Duplicate)');
  A.ok('node present', !!n);
  A.eq('onError=continueRegularOutput (diagnostics-only append)', n.onError, 'continueRegularOutput');
  A.eq('alwaysOutputData=true (loop continues on error)', n.alwaysOutputData, true);
}

// SCOPE-STRICT-001 / WF11-RUNID-001 / WF16-WRITE-001 — request-family scoping through the pipeline
A.section('WF11 raw rows carry canonical source_run_id + data_mode');
{
  const wf = H.loadWorkflow('11_social_source_connector_foundation.json');
  const run = H.makeRun();
  H.inject(run, 'Set Connector Config', [{ agent_request_id: 'req_t', run_id: 'req_t::website::a1::telegram', created_at: '2026-07-04T00:00:00+03:00', data_mode: 'live' }]);
  H.inject(run, 'Deduplicate Posts', [{ dedup_status: 'unique', source_type: 'social_channel', platform: 'telegram', post_url: 'https://t.me/x/1' }]);
  const out = H.runCodeNode(run, wf, 'Build raw_market_records Rows', [{ json: {} }]);
  A.eq('row source_run_id = cfg.run_id', out[0].json.source_run_id, 'req_t::website::a1::telegram');
  A.eq('row data_mode = live', out[0].json.data_mode, 'live');
}

A.section('WF16/WF08/WF10 — source_run_id filter matches the request run FAMILY');
{
  const fs = require('fs'); const path = require('path');
  const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
  const cases = [
    ['16_source_quality_gate_health_score.json', 'Assemble Run Bundles', 'if(!runFamilyMatch(rid,runIdF))return;'],
    ['08_touchpoint_analyzer.json', 'Filter & Select Records', 'if(source_run_id_filter&&!runFamilyMatch(canonId(r),source_run_id_filter))continue;'],
    ['10_competitor_audience_intelligence_aggregator.json', 'Aggregate Market Intelligence', 'runFamilyMatch(str(r.source_run_id)||str(r.agent_request_id)']
  ];
  for (const [file, nodeName, marker] of cases) {
    const wf = JSON.parse(fs.readFileSync(path.join(WFD, file), 'utf8'));
    const n = wf.nodes.find(x => x.name === nodeName);
    A.ok(file + ' ' + nodeName + ' uses runFamilyMatch (no strict equality)', n && n.parameters.jsCode.indexOf(marker) >= 0);
    // behavioral check of the helper semantics as embedded
    const m = /function runFamilyMatch[\s\S]*?\}/.exec(n.parameters.jsCode);
    A.ok(file + ' embeds the helper', !!m);
    const fam = new Function(m[0] + '; return runFamilyMatch;')();
    A.eq(file + ': exact id matches', fam('req_x::website::a1', 'req_x::website::a1'), true);
    A.eq(file + ': per-source child matches (::telegram)', fam('req_x::website::a1::telegram', 'req_x::website::a1'), true);
    A.eq(file + ': legacy bare request id matches', fam('req_x', 'req_x::website::a1'), true);
    A.eq(file + ': other request never matches', fam('req_y::website::a1', 'req_x::website::a1'), false);
    A.eq(file + ': similar-prefix id never matches', fam('req_x2', 'req_x::website::a1'), false);
  }
}

A.section('WF16 write_result is caller-controllable; WF20 passes the gating inputs');
{
  const fs = require('fs'); const path = require('path');
  const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
  const wf16 = JSON.parse(fs.readFileSync(path.join(WFD, '16_source_quality_gate_health_score.json'), 'utf8'));
  const cfgNode = wf16.nodes.find(x => x.name === 'Set WF16 Config');
  A.ok("Set WF16 Config maps caller write_result", cfgNode.parameters.jsCode.indexOf("__ov('write_result','write_result')") >= 0);
  const trig = wf16.nodes.find(x => x.type.endsWith('executeWorkflowTrigger'));
  A.ok('WF16 trigger declares write_result input', trig.parameters.workflowInputs.values.some(v => v.name === 'write_result'));
  const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
  const d16 = wf20.nodes.find(x => x.name === 'Run WF16 Quality Gate');
  const v16 = JSON.stringify(d16.parameters.workflowInputs);
  A.ok('WF20 passes write_result=true to WF16', v16.indexOf('"write_result":"true"') >= 0);
  const d12 = wf20.nodes.find(x => x.name === 'Run WF12 Report');
  const v12 = JSON.stringify(d12.parameters.workflowInputs);
  A.ok('WF20 passes enable_llm_summary to WF12', v12.indexOf('enable_llm_summary') >= 0);
  A.ok('WF20 passes the WF12 Claude summary approval token', v12.indexOf('I_APPROVE_CLAUDE_REPORT_SUMMARY') >= 0);

  // WF08-LLMAGENT-001: WF20 must ARM the WF08 llm_primary path (else every record degrades to
  // review_queue/report_eligible=false and the report is no_data) — and WF08 must coerce the string inputs.
  const d08 = wf20.nodes.find(x => x.name === 'Run WF08 Analyzer');
  const v08 = JSON.stringify(d08.parameters.workflowInputs);
  A.ok('WF20 passes llm_enabled to WF08', v08.indexOf('llm_enabled') >= 0);
  // WF08-LLM-GATE-001: WF08's LEGACY per-record classifier (one 16-28s Claude call PER RECORD, ~12/run, on the
  // pre-Stage-F transport) no longer rides on enable_llm_analysis — cost_model only QUOTES it when enable_wf08_llm
  // is set, so the flag that quotes it must be the flag that arms it.
  A.ok('WF20 llm_enabled follows cfg.enable_wf08_llm (its own default-OFF gate)', v08.indexOf('enable_wf08_llm') >= 0);
  A.ok('WF20 never arms the legacy WF08 LLM from the Stage-F flag', v08.indexOf('enable_llm_analysis') < 0);
  A.ok('WF20 passes the WF08 LLM approval token', v08.indexOf('WF08_LLM_APPROVED') >= 0);
  const wf08 = JSON.parse(fs.readFileSync(path.join(WFD, '08_touchpoint_analyzer.json'), 'utf8'));
  const cfg08 = wf08.nodes.find(x => x.name === 'Set Analyzer Config');
  A.ok("WF08 coerces string 'true' llm_enabled to boolean (strict guard compatibility)", cfg08.parameters.jsCode.indexOf('__boolish') >= 0);
  const acfg = require('../n8n/lib/agent_config.js');
  const rc = acfg.resolveConfig({ MS_ENABLE_CLAUDE: 'true' });
  A.eq('agent_config enable_llm_analysis defaults true under enable_claude', rc.enable_llm_analysis, true);
  const rcOff = acfg.resolveConfig({});
  A.eq('enable_claude kill-switch also disables llm analysis', rcOff.enable_llm_analysis, false);
}

A.section('EXPORT-BUNDLE-001 / REPORT-CONTEXT-001 / DELIVERY-CONTENT-001 — report reaches delivery & export');
{
  const fs = require('fs'); const path = require('path');
  const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
  const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
  const names = wf20.nodes.map(n => n.name);
  A.ok('WF20 has Shape Report Bundle', names.indexOf('Shape Report Bundle') >= 0);
  A.ok('WF20 appends report_bundles', names.indexOf('Append report_bundles') >= 0);
  A.ok('WF20 persists last_report_id on conversation state', names.indexOf('Upsert Report Context') >= 0);
  // F-2 DELIVERY-LIFECYCLE-001: the bundle chain hangs off the CONFIRMED text send (Edit Progress (Report Sent)),
  // not off the summary append — the workbook/export tail is downstream of a proven report delivery.
  const chain = wf20.connections['Edit Progress (Report Sent)'].main[0][0].node;
  A.eq('bundle chain hangs off the confirmed report send', chain, 'Shape Report Bundle');
  A.ok('Append execution_summaries is a ledger leaf (no longer drives the bundle/workbook)', !wf20.connections['Append execution_summaries']);

  const wf24 = JSON.parse(fs.readFileSync(path.join(WFD, '24_report_export_delivery.json'), 'utf8'));
  const scopeNode = wf24.nodes.find(n => n.name === 'Select & Scope Report');
  A.ok('WF24 scope: owner boundary + newest fallback (EXPORT-SCOPE-001)', scopeNode.parameters.jsCode.indexOf('EXPORT-SCOPE-001') >= 0);
  A.ok('WF24 scope derives agent_request_id from the matched bundle', scopeNode.parameters.jsCode.indexOf('agent_request_id:String(match.agent_request_id)') >= 0);

  const wf12 = JSON.parse(fs.readFileSync(path.join(WFD, '12_market_intelligence_report_builder.json'), 'utf8'));
  const rep = wf12.nodes.find(n => n.name === 'Build Deterministic Report');
  A.ok('WF12 report exposes redacted report_markdown', rep.parameters.jsCode.indexOf('report_markdown:redact(md)') >= 0);
  A.ok('WF12 report builds a structured report_bundle', rep.parameters.jsCode.indexOf('report_bundle:JSON.stringify(') >= 0);
  const fin = wf12.nodes.find(n => n.name === 'Final Summary Output');
  A.ok('WF12 Final Summary passes report_markdown to WF20 delivery', fin.parameters.jsCode.indexOf('report_markdown:') >= 0);
  A.ok('WF12 Final Summary passes report_bundle to WF20', fin.parameters.jsCode.indexOf('report_bundle:str(rep.report_bundle)') >= 0);
}

A.section('SHEETS-COLMAP-001 — every Sheets append/appendOrUpdate declares its columns resourceMapper');
{
  const fs = require('fs'); const path = require('path');
  const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
  const missing = [];
  for (const f of fs.readdirSync(WFD).filter(x => x.endsWith('.json'))) {
    let wf; try { wf = JSON.parse(fs.readFileSync(path.join(WFD, f), 'utf8')); } catch (e) { continue; }
    for (const n of (wf.nodes || [])) {
      if (n.type !== 'n8n-nodes-base.googleSheets') continue;
      const op = (n.parameters && n.parameters.operation) || '';
      if ((op === 'append' || op === 'appendOrUpdate') && !(n.parameters && n.parameters.columns && n.parameters.columns.mappingMode)) {
        missing.push(f + '::' + n.name);
      }
    }
  }
  A.eq('no append node without a columns mapper (tv4+ throws "Cannot convert undefined or null to object")', missing.join(','), '');
}

A.report('agent-summary-ledger');
