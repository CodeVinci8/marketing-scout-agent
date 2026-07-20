// audit_workflows.js — static n8n compatibility + topology resolver (Part 6/7).
//
// Since a local n8n CLI may be absent, this validates as much of the real import/runtime contract as is
// possible offline: every workflow is valid + inactive, every node type is a recognized n8n-nodes-base type,
// every Execute Sub-workflow reference resolves to a real repository workflow, placeholder workflow IDs are
// catalogued as post-import operator bindings (not silent breakage), trigger workflows vs callable
// sub-workflows are classified, and callable targets are checked for a Sub-workflow Trigger. Pure + offline.
'use strict';
const fs = require('fs');
const path = require('path');

const WF_DIR = path.join(__dirname, '..', 'n8n', 'workflows');
const TRIGGER_TYPES = ['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.webhook', 'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.executeWorkflowTrigger', 'n8n-nodes-base.cron'];
const SUBWORKFLOW_TRIGGER = 'n8n-nodes-base.executeWorkflowTrigger';

function loadAll() {
  const files = fs.readdirSync(WF_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => ({ file: f, num: (f.match(/^(\d+)/) || [])[1] || '', wf: JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8')) }));
}

function audit() {
  const all = loadAll();
  const byNum = {}; all.forEach(w => { if (w.num) byNum[w.num] = w; });
  const report = {
    workflows: all.map(w => w.file),
    node_types: [], unrecognized_types: [], active_violations: [],
    exec_edges: [], unresolved_refs: [], placeholder_bindings: [],
    trigger_classes: {}, callable_targets: [], subworkflow_trigger_gaps: [],
    callable_contracts: {}, classification: {}, public_trigger_callables: [], errors: []
  };
  report.exec_wf_typeversion_violations = [];
  const typeSet = {};
  for (const { file, wf } of all) {
    if (wf.active !== false) report.active_violations.push(file);
    const triggers = [];
    for (const n of (wf.nodes || [])) {
      typeSet[n.type] = 1;
      if (!/^n8n-nodes-base\./.test(n.type)) report.unrecognized_types.push(file + ' :: ' + n.type);
      if (TRIGGER_TYPES.indexOf(n.type) >= 0) triggers.push(n.type.replace('n8n-nodes-base.', ''));
      if (n.type === 'n8n-nodes-base.executeWorkflow') {
        // workflowInputs (defineBelow named-contract mapping) only exists at typeVersion >= 1.2; below that the
        // running n8n silently ignores it and passes items through, breaking every named dispatch contract.
        if (n.parameters && n.parameters.workflowInputs && !(Number(n.typeVersion) >= 1.2)) {
          report.exec_wf_typeversion_violations.push(file + ' :: ' + n.name + ' (typeVersion=' + n.typeVersion + ' < 1.2 with workflowInputs)');
        }
        const note = (n.parameters && n.parameters.workflowId && (n.parameters.workflowId.cachedResultName || n.parameters.workflowId.value)) || '';
        const idVal = (n.parameters && n.parameters.workflowId && n.parameters.workflowId.value) || '';
        if (idVal === 'PASTE_WORKFLOW_ID' || /PASTE_/.test(String(idVal))) report.placeholder_bindings.push({ workflow: file, node: n.name, target_hint: note });
        const m = String(note).match(/WF(\d{2})/);
        const target = m ? m[1] : null;
        if (target && byNum[target]) report.exec_edges.push({ from: file, to: byNum[target].file, target: 'WF' + target, note: note, resolved: true });
        else report.unresolved_refs.push({ workflow: file, node: n.name, hint: note });
      }
    }
    report.trigger_classes[file] = triggers;
  }
  report.node_types = Object.keys(typeSet).sort();
  // callable targets = anything invoked via Execute Sub-workflow; each MUST have a Sub-workflow Trigger to be
  // runtime-invocable, and MUST NOT be exposed via a public webhook.
  const targets = {}; report.exec_edges.forEach(e => { targets[e.to] = 1; });
  report.callable_targets = Object.keys(targets).sort();
  for (const tfile of report.callable_targets) {
    const w = all.find(x => x.file === tfile).wf;
    const subNode = (w.nodes || []).find(n => n.type === SUBWORKFLOW_TRIGGER);
    if (!subNode) {
      const present = (w.nodes || []).filter(n => TRIGGER_TYPES.indexOf(n.type) >= 0).map(n => n.type.replace('n8n-nodes-base.', ''));
      report.subworkflow_trigger_gaps.push({ target: tfile, has: present, needs: 'executeWorkflowTrigger (Execute Sub-workflow Trigger) for runtime invocation' });
    } else {
      // extract the declared input contract (canonical field ids) from the trigger schema
      const wi = (subNode.parameters && subNode.parameters.workflowInputs) || {};
      const sch = wi.schema || wi.values || [];
      report.callable_contracts[tfile] = sch.map(s => s.id || s.name).filter(Boolean);
    }
    // a callable must never be publicly exposed
    if ((w.nodes || []).some(n => n.type === 'n8n-nodes-base.webhook')) report.public_trigger_callables.push(tfile);
  }
  // classify every workflow: public (webhook) / scheduled (scheduleTrigger|cron) / callable (executeWorkflowTrigger)
  // / manual-only (only manualTrigger). A workflow may be both callable and manual (sub-workflow + manual diagnosis).
  for (const { file, wf } of all) {
    const t = report.trigger_classes[file] || [];
    const c = [];
    if (t.indexOf('webhook') >= 0) c.push('public');
    if (t.indexOf('scheduleTrigger') >= 0 || t.indexOf('cron') >= 0) c.push('scheduled');
    if (t.indexOf('executeWorkflowTrigger') >= 0) c.push('callable');
    if (t.indexOf('manualTrigger') >= 0) c.push(c.length ? 'manual-diagnostic' : 'manual-only');
    report.classification[file] = c.length ? c : ['none'];
  }
  // hard errors: things that would actually break import/resolution OR violate the release contract. Placeholder
  // workflow IDs are NOT errors (documented post-import bindings). A callable missing its Sub-workflow Trigger, or a
  // callable exposed via a public webhook, ARE hard errors — the release audit must fail until they are fixed.
  report.errors = []
    .concat(report.active_violations.map(f => 'active!=false: ' + f))
    .concat(report.unrecognized_types.map(t => 'unrecognized node type: ' + t))
    .concat(report.unresolved_refs.map(r => 'unresolved sub-workflow ref: ' + r.workflow + ' :: ' + r.node + ' (' + r.hint + ')'))
    .concat(report.subworkflow_trigger_gaps.map(g => 'callable target missing Execute Sub-workflow Trigger: ' + g.target + ' (has: ' + g.has.join(',') + ')'))
    .concat(report.public_trigger_callables.map(f => 'callable sub-workflow exposed via public webhook: ' + f))
    .concat(report.exec_wf_typeversion_violations.map(v => 'executeWorkflow named-input mapping silently dropped (needs typeVersion>=1.2): ' + v));
  return report;
}

if (require.main === module) {
  const r = audit();
  console.log('=== n8n static topology audit ===');
  console.log('workflows:', r.workflows.length, '| node types:', r.node_types.length);
  console.log('exec sub-workflow edges:');
  r.exec_edges.forEach(e => console.log('  ' + e.from + ' --(' + e.target + ')--> ' + e.to));
  console.log('placeholder workflow-id bindings (set after import):', r.placeholder_bindings.length);
  console.log('callable targets:', r.callable_targets.join(', ') || '(none)');
  console.log('callable input contracts:');
  Object.keys(r.callable_contracts).forEach(f => console.log('  ' + f + ': ' + r.callable_contracts[f].join(', ')));
  console.log('workflow classification:');
  Object.keys(r.classification).sort().forEach(f => console.log('  ' + f + ': ' + r.classification[f].join('+')));
  if (r.subworkflow_trigger_gaps.length) {
    console.log('FINDINGS — callable targets MISSING a Sub-workflow Trigger (release blocker):');
    r.subworkflow_trigger_gaps.forEach(g => console.log('  ' + g.target + ' (has: ' + g.has.join(',') + ')'));
  }
  console.log(r.errors.length ? ('ERRORS:\n  ' + r.errors.join('\n  ')) : 'no hard errors (every callable has a Sub-workflow Trigger; no public callable; refs resolve)');
  process.exit(r.errors.length ? 1 : 0);
}

module.exports = { audit, loadAll, TRIGGER_TYPES, SUBWORKFLOW_TRIGGER };
