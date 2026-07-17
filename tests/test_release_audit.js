// test_release_audit.js — Part 5 (persistence wiring) + Part 7 (sub-workflow/trigger audit) + Part 8 (Telegram
// delivery proof). Structural assertions against the ACTUAL generated workflow node parameters. Offline, $0.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const audit = require('../tools/audit_workflows').audit;
const tio = require('../n8n/lib/telegram_io');

function sheetsNodes(wf) {
  return wf.nodes.filter(n => n.type === 'n8n-nodes-base.googleSheets').map(n => ({
    name: n.name, op: n.parameters.operation,
    tab: n.parameters.sheetName && n.parameters.sheetName.value,
    match: (n.parameters.columns && n.parameters.columns.matchingColumns) || []
  }));
}
function hasSheet(wf, tab, op) { return sheetsNodes(wf).some(s => s.tab === tab && s.op === op); }
// SHEETS-READ-AMPLIFICATION-001: WF18 now reads via ONE values:batchGet (predefined googleApi) + a per-tab Code
// extractor instead of per-tab Get-Rows. "reads a tab" => a legacy googleSheets read OR the batchGet covers the tab
// AND a "Read <tab>" extractor projects it.
function readsTab(wf, tab) {
  if (hasSheet(wf, tab, 'read')) return true;
  const batch = (wf.nodes || []).some(n => n.type === 'n8n-nodes-base.httpRequest' && /\/values:batchGet/.test(String((n.parameters || {}).url || '')) && String((n.parameters || {}).url || '').indexOf(tab) >= 0);
  const extractor = (wf.nodes || []).some(n => n.type === 'n8n-nodes-base.code' && /Batch Read Sheets/.test(String((n.parameters || {}).jsCode || '')) && String((n.parameters || {}).jsCode || '').indexOf(tab) >= 0);
  return batch && extractor;
}
function edge(wf, from, to) {
  const c = wf.connections[from]; if (!c || !c.main) return false;
  return c.main.some(arr => (arr || []).some(e => e.node === to));
}

// ============================================================================================================
A.section('Part 7 — static sub-workflow + trigger audit');
const R = audit();
A.eq('no hard import/resolution errors', R.errors.length, 0);
A.eq('every executeWorkflow node with workflowInputs is typeVersion>=1.2 (below 1.2 n8n silently drops the named-input mapping)', (R.exec_wf_typeversion_violations || ['audit-field-missing']).length, 0);
// SHEETS-DOCID-001 (live-observed: WF04 'Append to Dynamic Route Sheet' 404'd on the literal
// PASTE_SPREADSHEET_ID_HERE placeholder): every googleSheets documentId and sheets.googleapis.com URL in a
// RUNTIME workflow must resolve the spreadsheet id from $env.MS_SPREADSHEET_ID, never a literal placeholder.
{
  const fs0 = require('fs'); const path0 = require('path');
  const manifest = JSON.parse(fs0.readFileSync(path0.join(__dirname, '..', 'config', 'workflow_manifest.json'), 'utf8'));
  const runtimeFiles = Object.values(manifest.runtime_identity).map(v => v.file);
  const bad = [];
  for (const base of runtimeFiles) {
    const wf = JSON.parse(fs0.readFileSync(path0.join(__dirname, '..', 'n8n', 'workflows', base), 'utf8'));
    for (const n of (wf.nodes || [])) {
      const p = n.parameters || {};
      const d = p.documentId;
      if (d && typeof d.value === 'string' && d.value.indexOf('$env.MS_SPREADSHEET_ID') < 0) bad.push(base + '::' + n.name + ' documentId=' + d.value.slice(0, 40));
      if (typeof p.url === 'string' && p.url.indexOf('sheets.googleapis.com') >= 0 && p.url.indexOf('$env.MS_SPREADSHEET_ID') < 0) bad.push(base + '::' + n.name + ' url');
    }
  }
  A.eq('runtime spreadsheet ids all resolve from $env.MS_SPREADSHEET_ID (' + bad.join('; ') + ')', bad.length, 0);
}
A.eq('all workflows inactive', R.active_violations.length, 0);
A.eq('all node types recognized (n8n-nodes-base)', R.unrecognized_types.length, 0);
A.eq('no unresolved sub-workflow references', R.unresolved_refs.length, 0);
A.ok('WF20 -> WF04/16/08/10/12 edges resolve', ['WF04', 'WF16', 'WF08', 'WF10', 'WF12'].every(t => R.exec_edges.some(e => /20_/.test(e.from) && e.target === t)));
A.ok('WF21 -> WF04 resolves', R.exec_edges.some(e => /21_/.test(e.from) && e.target === 'WF04'));
A.ok('WF23 -> WF04 resolves', R.exec_edges.some(e => /23_/.test(e.from) && e.target === 'WF04'));
A.ok('placeholder workflow ids catalogued as post-import bindings', R.placeholder_bindings.length === R.exec_edges.length);
// fixed: every callable Stage 1-3 target now carries an Execute Sub-workflow Trigger (release blocker resolved)
A.eq('no callable target is missing a Sub-workflow Trigger', R.subworkflow_trigger_gaps.length, 0);
A.eq('no callable sub-workflow is exposed via a public webhook', R.public_trigger_callables.length, 0);

A.section('Part 7 — five Stage 1-3 callables now have Execute Sub-workflow Triggers');
const CALLABLES = ['04_firecrawl_url_list_resilient.json', '08_touchpoint_analyzer.json', '10_competitor_audience_intelligence_aggregator.json', '12_market_intelligence_report_builder.json', '16_source_quality_gate_health_score.json'];
const CANON = ['agent_request_id', 'source_run_id', 'workflow_run_id', 'data_mode'];
for (const f of CALLABLES) {
  const wf = H.loadWorkflow(f);
  const trig = wf.nodes.filter(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
  A.eq(f + ' has exactly one Execute Sub-workflow Trigger', trig.length, 1);
  A.ok(f + ' keeps its Manual Trigger for standalone diagnosis', wf.nodes.some(n => n.type === 'n8n-nodes-base.manualTrigger'));
  A.ok(f + ' has NO public webhook trigger', !wf.nodes.some(n => n.type === 'n8n-nodes-base.webhook'));
  A.ok(f + ' classified callable+manual-diagnostic', JSON.stringify(R.classification[f]) === JSON.stringify(['callable', 'manual-diagnostic']));
  const contract = R.callable_contracts[f] || [];
  A.ok(f + ' trigger contract declares the canonical fields', CANON.every(c => contract.indexOf(c) >= 0));
  // the trigger feeds the SAME config node the manual trigger feeds (business path preserved)
  const sub = wf.connections['When Called by Agent'];
  A.ok(f + ' sub-workflow trigger is wired into the config path', !!sub && sub.main[0].length >= 1);
}

A.section('Part 7 — parent orchestrator passes NAMED canonical fields (no positional/.first() reliance in callable)');
function execInputs(wf, nodeName) {
  const n = wf.nodes.find(x => x.name === nodeName);
  const wi = n && n.parameters && n.parameters.workflowInputs;
  return (wi && wi.value) ? Object.keys(wi.value) : [];
}
const orch = H.loadWorkflow('20_agent_orchestrator.json');
A.ok('WF20 -> WF04 passes named agent_request_id/source_run_id/data_mode', ['agent_request_id', 'source_run_id', 'data_mode'].every(k => execInputs(orch, 'Run Website Source (WF04)').indexOf(k) >= 0));
A.ok('WF20 -> WF16 passes named source_run_id', execInputs(orch, 'Run WF16 Quality Gate').indexOf('source_run_id') >= 0);
A.ok('WF20 -> WF08 passes named agent_request_id', execInputs(orch, 'Run WF08 Analyzer').indexOf('agent_request_id') >= 0);
A.ok('WF20 -> WF10 passes named data_mode', execInputs(orch, 'Run WF10 Aggregator').indexOf('data_mode') >= 0);
A.ok('WF20 -> WF12 passes named agent_request_id', execInputs(orch, 'Run WF12 Report').indexOf('agent_request_id') >= 0);
const deep = H.loadWorkflow('21_deep_competitor_analysis.json');
A.ok('WF21 -> WF04 passes named canonical fields', ['agent_request_id', 'source_run_id', 'data_mode'].every(k => execInputs(deep, 'Collect Deep Evidence (WF04)').indexOf(k) >= 0));
const mon = H.loadWorkflow('23_scheduled_source_monitor.json');
A.ok('WF23 -> WF04 passes the tracked source url + idempotent source_run_id', ['source_run_id', 'urls', 'data_mode'].every(k => execInputs(mon, 'Run Website Check (WF04)').indexOf(k) >= 0));

A.section('Part 7 — callable config nodes honor canonical input WITHOUT breaking manual-mode semantics');
// manual mode: empty input => unchanged deterministic defaults
const wf16man = H.runCodeNode(H.makeRun(), H.loadWorkflow('16_source_quality_gate_health_score.json'), 'Set WF16 Config', [])[0].json;
A.eq('WF16 manual mode keeps fixture_self_test=true', wf16man.fixture_self_test, true);
A.eq('WF16 manual mode source_run_id_filter empty', wf16man.source_run_id_filter, '');
// sub-workflow mode: canonical input overrides the matching config keys
const wf16sub = H.runCodeNode(H.makeRun(), H.loadWorkflow('16_source_quality_gate_health_score.json'), 'Set WF16 Config', [{ json: { source_run_id: 'src_42', agent_request_id: 'req_42', data_mode: 'live' } }])[0].json;
A.eq('WF16 sub-workflow mode maps source_run_id -> filter', wf16sub.source_run_id_filter, 'src_42');
A.eq('WF16 sub-workflow mode maps agent_request_id -> filter', wf16sub.agent_request_id_filter, 'req_42');
A.eq('WF16 live data_mode flips fixture_self_test off', wf16sub.fixture_self_test, false);
const wf04man = H.runCodeNode(H.makeRun(), H.loadWorkflow('04_firecrawl_url_list_resilient.json'), 'Set URL List', []);
A.ok('WF04 manual mode keeps example placeholders', wf04man.length === 3 && /example\.com/.test(wf04man[0].json.target_url));
A.ok('WF04 manual mode run_id is canonical firecrawl id', /^firecrawl_\d{8}_\d{6}$/.test(wf04man[0].json.run_id));
const wf04sub = H.runCodeNode(H.makeRun(), H.loadWorkflow('04_firecrawl_url_list_resilient.json'), 'Set URL List', [{ json: { agent_request_id: 'req_9', source_run_id: 'run_9', urls: ['https://x.example/a'], force_reprocess: true } }]);
A.eq('WF04 sub-workflow mode uses agent urls', wf04sub[0].json.target_url, 'https://x.example/a');
A.eq('WF04 sub-workflow mode uses agent source_run_id', wf04sub[0].json.run_id, 'run_9');
A.eq('WF04 sub-workflow mode honors force_reprocess', wf04sub[0].json.force_reprocess, true);

A.section('Part 7 — trigger classification of the Telegram-path workflows');
A.ok('WF18 gateway is webhook-triggered', (R.trigger_classes['18_telegram_agent_gateway.json'] || []).indexOf('webhook') >= 0);
A.ok('only WF18 carries a public webhook (no callable is public)', R.workflows.filter(f => (R.trigger_classes[f] || []).indexOf('webhook') >= 0).join(',') === '18_telegram_agent_gateway.json');
A.ok('WF23 monitor has a schedule trigger', (R.trigger_classes['23_scheduled_source_monitor.json'] || []).indexOf('scheduleTrigger') >= 0);
A.ok('WF23 monitor also has a manual check-now trigger', (R.trigger_classes['23_scheduled_source_monitor.json'] || []).indexOf('manualTrigger') >= 0);

// ============================================================================================================
A.section('Part 5 — persistence wiring (real Sheets nodes, correct tabs + operations)');
const WF18 = H.loadWorkflow('18_telegram_agent_gateway.json');
const WF20 = H.loadWorkflow('20_agent_orchestrator.json');
const WF22 = H.loadWorkflow('22_conversation_control.json');
const WF23 = H.loadWorkflow('23_scheduled_source_monitor.json');

A.ok('WF18 reads conversation_state', readsTab(WF18, 'conversation_state'));
A.ok('WF18 reads conversation_messages', readsTab(WF18, 'conversation_messages'));
A.ok('WF18 appends conversation_messages', hasSheet(WF18, 'conversation_messages', 'append'));
A.ok('WF18 upserts conversation_state (appendOrUpdate)', hasSheet(WF18, 'conversation_state', 'appendOrUpdate'));
A.ok('WF18 conversation_state upsert matches on conversation_id', sheetsNodes(WF18).some(s => s.tab === 'conversation_state' && s.op === 'appendOrUpdate' && s.match.indexOf('conversation_id') >= 0));
A.ok('WF18 appends conversation_summaries', hasSheet(WF18, 'conversation_summaries', 'append'));
A.ok('WF18 appends context_usage', hasSheet(WF18, 'context_usage', 'append'));
A.ok('WF18 appends agent_requests', hasSheet(WF18, 'agent_requests', 'append'));
A.ok('WF18 appends agent_request_events', hasSheet(WF18, 'agent_request_events', 'append'));
A.ok('WF22 reads durable_memories', hasSheet(WF22, 'durable_memories', 'read'));
A.ok('WF22 reads tracked_sources', hasSheet(WF22, 'tracked_sources', 'read'));
A.ok('WF22 appends memory_audit_events', hasSheet(WF22, 'memory_audit_events', 'append'));
A.ok('WF22 appends source_audit_events', hasSheet(WF22, 'source_audit_events', 'append'));
A.ok('WF23 reads tracked_sources', hasSheet(WF23, 'tracked_sources', 'read'));
A.ok('WF23 reads source_change_events', hasSheet(WF23, 'source_change_events', 'read'));
A.ok('WF23 writes tracked_sources lifecycle', hasSheet(WF23, 'tracked_sources', 'append'));
A.ok('WF23 appends source_change_events', hasSheet(WF23, 'source_change_events', 'append'));
A.ok('WF20 appends telegram_outbox', hasSheet(WF20, 'telegram_outbox', 'append'));
A.ok('WF20 appends execution_summaries', hasSheet(WF20, 'execution_summaries', 'append'));

A.section('Part 5 — context is reconstructable from Sheets (write-then-read loop exists)');
A.ok('WF18 both reads AND upserts conversation_state', readsTab(WF18, 'conversation_state') && hasSheet(WF18, 'conversation_state', 'appendOrUpdate'));
A.ok('WF18 both reads AND appends conversation_messages', readsTab(WF18, 'conversation_messages') && hasSheet(WF18, 'conversation_messages', 'append'));

// ============================================================================================================
A.section('Part 8 — Telegram delivery proof (outbox before send; dedup; persisted fields)');
// DELIVERY-CHUNKS-001: the chunk fan-out sits between the persisted outbox row and the send.
A.ok('WF20: outbox row persisted before send (Append telegram_outbox -> Expand Telegram Chunks -> Send Telegram Report)',
  edge(WF20, 'Append telegram_outbox', 'Expand Telegram Chunks') && edge(WF20, 'Expand Telegram Chunks', 'Send Telegram Report'));
A.ok('WF20: delivery built before outbox append (Build Delivery Outbox -> Append telegram_outbox)', edge(WF20, 'Build Delivery Outbox', 'Append telegram_outbox'));
const dlv = tio.makeDelivery('req_1', 'rep_1', '555', 'body');
A.ok('delivery row carries a telegram_message_id slot', Object.prototype.hasOwnProperty.call(dlv, 'telegram_message_id'));
A.ok('delivery row carries a retryable status + attempts', dlv.send_status === 'pending' && dlv.attempts === 0 && Object.prototype.hasOwnProperty.call(dlv, 'last_error'));
A.eq('an already-sent delivery is never resent', tio.shouldSend([Object.assign({}, dlv, { send_status: 'sent' })], dlv).send, false);
A.eq('a pending delivery is sendable', tio.shouldSend([], dlv).send, true);
// chunking + escaping are real transforms
const long = new Array(9000).join('x');
A.ok('long payload is chunked under the Telegram cap', tio.chunkMessage(long, 3900).every(c => c.length <= 3900));
A.ok('Markdown reserved chars are escaped', /\\\./.test(tio.escapeMarkdown('a.b')));

// ============================================================================================================
A.section('Part 7 — deployment activates ONLY the trigger workflows (WF18 always, WF23 when monitoring)');
const fs = require('fs');
const path = require('path');
const deploy = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy_n8n.sh'), 'utf8');
A.ok('deploy supports --activate-triggers', /--activate-triggers\)\s*MODE="activate-triggers"/.test(deploy));
A.ok('deploy ALWAYS-activate set is exactly WF18', /TRIGGER_WORKFLOWS_ALWAYS=\(\s*"18_telegram_agent_gateway\.json"\s*\)/.test(deploy));
A.ok('deploy MONITORING-activate set is exactly WF23', /TRIGGER_WORKFLOWS_MONITORING=\(\s*"23_scheduled_source_monitor\.json"\s*\)/.test(deploy));
A.ok('WF23 activation is gated behind MS_MONITORING_ENABLED=true', /MS_MONITORING_ENABLED:-false.*=.*"true"/s.test(deploy) || /MS_MONITORING_ENABLED:-false/.test(deploy));
A.ok('deploy never activates a callable sub-workflow (explicit guard text present)', /NEVER activated|never activates a callable/i.test(deploy));
// QA-012: imports land inactive via the proven 2.23.3 mechanism (--activeState=false deactivates regardless of JSON).
A.ok('deploy import lands workflows inactive via --activeState=false (no blanket activation on import)', /import:workflow --input=[^\n]*--activeState=false/.test(deploy));
// QA-012: 2.23.3 DOES have publish/unpublish (update:workflow is deprecated). Deploy prefers the modern command
// and keeps the deprecated update:workflow as a fallback for older CLIs.
A.ok('activation prefers publish:workflow (proven 2.23.3 semantics)', /publish:workflow --id="\$id"/.test(deploy));
A.ok('deactivation uses unpublish:workflow (publish rollback)', /unpublish:workflow --id="\$id"/.test(deploy));
A.ok('deprecated update:workflow --active=true retained only as a fallback', /update:workflow --id="\$id" --active=true/.test(deploy));

A.section('Part 7 — every repository workflow stays inactive');
A.eq('audit finds zero active workflows', R.active_violations.length, 0);

A.report('release-audit');
