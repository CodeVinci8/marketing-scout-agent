// gen_workflow_manifest.js — single machine-readable source of truth for BOTH (a) capability/archive-safety
// classification and (b) the production deployment plan (runtime closure, import order, sub-workflow binding
// edges, activation policy). Everything here is DERIVED from the workflow JSONs themselves (the real Execute
// Sub-workflow graph + trigger node types) plus one small, explicit policy block below — never from the deploy
// shell script (that would be circular: the deploy script now reads THIS manifest, not the other way around).
//
// QA-001/008/015: the deploy/smoke tooling consumes `deployment.*` so the runtime set is defined in exactly one
// place. The runtime closure = the agent runtime roots (the generated Stage-4 set) UNION the transitive closure
// of their Execute Sub-workflow targets. A missing dependency is therefore detectable, not silent.
//
// Output: config/workflow_manifest.json (deterministic, sorted). Pure + offline ($0). Run:
//   node tools/gen_workflow_manifest.js            # write config/workflow_manifest.json
//   node tools/gen_workflow_manifest.js --check    # fail (exit 1) if the committed manifest is stale
'use strict';
const fs = require('fs');
const path = require('path');
const { audit, loadAll } = require('./audit_workflows.js');

const ROOT = path.join(__dirname, '..');
const WF_DIR = path.join(ROOT, 'n8n', 'workflows');
const TESTS_DIR = path.join(ROOT, 'tests');
const OUT = path.join(ROOT, 'config', 'workflow_manifest.json');

// ---------------------------------------------------------------------------------------------------------
// POLICY (the only hand-authored facts; everything else is derived from the workflow JSONs).
// ---------------------------------------------------------------------------------------------------------
// The version the disposable import/runtime smokes verify against (QA-007/QA-010/QA-012).
const N8N_VERSION = '2.23.3';
// The agent runtime ROOTS — the Stage-4 workflows the deploy imports directly. They are not reachable purely
// via Execute Sub-workflow edges (the gateway/orchestrator/planner/control/export/digest chain), so they must
// be declared. The callable collection/analysis/report dependencies (WF04/08/10/12/16/26) are NOT listed here:
// they are pulled in automatically as the Execute Sub-workflow closure of these roots.
const RUNTIME_ROOTS = [
  '17_agent_settings_config.json',
  '18_telegram_agent_gateway.json',
  '19_request_planner.json',
  '20_agent_orchestrator.json',
  '21_deep_competitor_analysis.json',
  '22_conversation_control.json',
  '23_scheduled_source_monitor.json',
  '24_report_export_delivery.json',
  '25_weekly_digest.json',
  '26_vk_public_community_collector.json'
];
// Activation policy. ONLY these trigger workflows may ever be activated, gated by a feature flag. A callable
// sub-workflow is NEVER in any activation list (QA-008/QA-012). Every other runtime workflow stays inactive.
const ACTIVATION = {
  always: ['18_telegram_agent_gateway.json'],                   // public Telegram webhook entrypoint
  when_monitoring: ['23_scheduled_source_monitor.json'],        // MS_MONITORING_ENABLED=true
  when_weekly_digest: ['25_weekly_digest.json']                 // MS_WEEKLY_DIGEST_ENABLED=true
};
// Runtime capability requirements per role (non-secret env / builtin module needs surfaced to preflight).
const RUNTIME_REQUIRES = {
  // XLSX export uses zlib inside an n8n Code node, which needs NODE_FUNCTION_ALLOW_BUILTIN to include zlib.
  xlsx_zlib: ['24_report_export_delivery.json', '25_weekly_digest.json']
};

const EXECUTE_WORKFLOW = 'n8n-nodes-base.executeWorkflow';
const EXECUTE_WORKFLOW_TRIGGER = 'n8n-nodes-base.executeWorkflowTrigger';

// Collect every textual reference to a workflow from the test tree (filename, WF<nn> token, or basename).
function testCorpus() {
  const out = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|json)$/.test(e.name)) out.push(fs.readFileSync(p, 'utf8'));
    }
  }
  walk(TESTS_DIR);
  const ls = path.join(ROOT, 'n8n', 'fixtures', 'lead_scout');
  if (fs.existsSync(ls)) walk(ls);
  return out.join('\n');
}

// Extract the Execute Sub-workflow binding edges straight from the workflow nodes (authoritative): for each
// runtime workflow, every executeWorkflow node -> the target workflow identified by the WF<nn> token in its
// cachedResultName. Caller node names are stable (set by the generator) and used for exact, position-free
// rebinding (QA-002/QA-009).
function bindingEdges(byNum, isRuntime) {
  const edges = [];
  for (const { file, num, wf } of loadAll()) {
    for (const n of (wf.nodes || [])) {
      if (n.type !== EXECUTE_WORKFLOW) continue;
      const hint = (n.parameters && n.parameters.workflowId &&
        (n.parameters.workflowId.cachedResultName || n.parameters.workflowId.value)) || '';
      const m = String(hint).match(/WF(\d{2})/);
      const targetNum = m ? m[1] : null;
      const target = targetNum && byNum[targetNum] ? byNum[targetNum] : null;
      edges.push({
        caller_file: file, caller_wf: num ? 'WF' + num : '',
        caller_node: n.name,
        target_file: target ? target.file : null,
        target_wf: targetNum ? 'WF' + targetNum : '',
        target_hint: hint,
        expected_caller_type: EXECUTE_WORKFLOW,
        expected_target_trigger: EXECUTE_WORKFLOW_TRIGGER,
        in_runtime: !!(target && isRuntime(file) && isRuntime(target.file)),
        required: true
      });
    }
  }
  return edges.sort((a, b) => (a.caller_file + a.caller_node < b.caller_file + b.caller_node ? -1 : 1));
}

function build() {
  const a = audit();
  const all = loadAll();
  const byNum = {}; all.forEach(w => { if (w.num) byNum[w.num] = w; });
  const tests = testCorpus();

  // reverse / forward call maps from the resolved Execute Sub-workflow edges
  const callers = {}; a.exec_edges.forEach(e => { (callers[e.to] = callers[e.to] || []).push(e.from); });
  const calls = {}; a.exec_edges.forEach(e => { (calls[e.from] = calls[e.from] || []).push(e.to); });

  // ---- runtime closure: roots UNION transitive Execute Sub-workflow targets ----
  const closure = new Set(RUNTIME_ROOTS);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of Array.from(closure)) {
      for (const t of (calls[f] || [])) { if (!closure.has(t)) { closure.add(t); grew = true; } }
    }
  }
  const isRuntime = f => closure.has(f);

  const edges = bindingEdges(byNum, isRuntime);
  const runtimeEdges = edges.filter(e => e.in_runtime);
  const callableTargets = Array.from(new Set(runtimeEdges.map(e => e.target_file))).sort();

  // ---- per-file role (one canonical deployment role) ----
  const entrypoints = new Set([].concat(ACTIVATION.always, ACTIVATION.when_monitoring, ACTIVATION.when_weekly_digest));
  function roleOf(file, cls) {
    if (!closure.has(file)) {
      if (cls.indexOf('public') >= 0 || cls.indexOf('scheduled') >= 0) return 'non_runtime_trigger';
      if (/connector|avito|social|discussion|reviews/i.test(file)) return 'optional_source_adapter';
      if (a.classification[file] && (callers[file] || []).length === 0 &&
        /healthcheck|sheets_append|single_record|single_url|logger|_test/i.test(file)) return 'manual_diagnostic';
      return 'manual_diagnostic';
    }
    if (callableTargets.indexOf(file) >= 0) return 'callable_dependency';
    if (entrypoints.has(file)) return 'entrypoint';
    return 'orchestration';
  }

  // ---- deterministic import order: config -> callable deps -> orchestration -> entrypoints (numeric within) ----
  const byNumKey = f => Number((f.match(/^(\d+)/) || [])[1] || 0);
  const numSort = (x, y) => byNumKey(x) - byNumKey(y);
  const roleFiles = { entrypoint: [], orchestration: [], callable_dependency: [] };
  for (const f of closure) {
    const r = roleOf(f, a.classification[f] || []);
    if (roleFiles[r]) roleFiles[r].push(f);
  }
  const config = roleFiles.orchestration.filter(f => /^17_/.test(f));
  const orchestration = roleFiles.orchestration.filter(f => !/^17_/.test(f)).sort(numSort);
  const importOrder = []
    .concat(config.sort(numSort))
    .concat(roleFiles.callable_dependency.slice().sort(numSort))
    .concat(orchestration)
    .concat(roleFiles.entrypoint.slice().sort(numSort));

  // activation feature flag lookup per file
  const activationFlag = {};
  ACTIVATION.always.forEach(f => { activationFlag[f] = 'always'; });
  ACTIVATION.when_monitoring.forEach(f => { activationFlag[f] = 'MS_MONITORING_ENABLED'; });
  ACTIVATION.when_weekly_digest.forEach(f => { activationFlag[f] = 'MS_WEEKLY_DIGEST_ENABLED'; });

  const entries = all.map(({ file, num, wf }) => {
    const cls = a.classification[file] || ['none'];
    const calledBy = (callers[file] || []).sort();
    const callsOut = (calls[file] || []).sort();
    const inRuntime = closure.has(file);
    const role = roleOf(file, cls);
    const base = file.replace(/^\d+_/, '').replace(/\.json$/, '');
    const refRe = new RegExp('(WF0*' + Number(num) + '\\b)|(' + file.replace(/[.]/g, '\\.') + ')|(' + base + ')', 'i');
    const referencedByTest = num ? refRe.test(tests) : tests.indexOf(file) >= 0;

    // capability class (legacy field, still computed; now keyed off runtime membership, not the deploy script)
    let capability;
    if (cls.indexOf('public') >= 0 || cls.indexOf('scheduled') >= 0) capability = 'production_entrypoint';
    else if (inRuntime) capability = 'production_dependency';
    else if (/connector|avito|social|discussion|reviews/i.test(file)) capability = 'optional_source_adapter';
    else if (/healthcheck|sheets_append|single_record|single_url|test/i.test(file)) capability = 'manual_diagnostic';
    else if (referencedByTest || calledBy.length) capability = 'legacy_referenced';
    else capability = 'manual_diagnostic';

    // archive safety: only when nothing depends on it in any dimension
    const blockers = [];
    if (calledBy.length) blockers.push('called_by:' + calledBy.join(','));
    if (referencedByTest) blockers.push('referenced_by_test');
    if (inRuntime) blockers.push('in_runtime_closure');
    if (entrypoints.has(file)) blockers.push('trigger_entrypoint');
    const archiveSafe = blockers.length === 0;

    const requires = [];
    if (RUNTIME_REQUIRES.xlsx_zlib.indexOf(file) >= 0) requires.push('NODE_FUNCTION_ALLOW_BUILTIN:zlib');

    return {
      file, wf_number: num ? 'WF' + num : '', name: wf.name || '', node_count: (wf.nodes || []).length,
      active: wf.active === false ? false : wf.active,
      trigger_classes: a.trigger_classes[file] || [], classification: cls,
      capability_class: capability,
      deployment_role: role,
      runtime: inRuntime,
      activation_flag: activationFlag[file] || (inRuntime ? 'never' : 'n/a'),
      expected_active: false,
      called_by: calledBy, calls: callsOut,
      binding_nodes: runtimeEdges.filter(e => e.caller_file === file).map(e => ({ node: e.caller_node, target: e.target_wf })),
      requires_runtime: requires,
      imported_by_deploy: inRuntime, trigger_always: ACTIVATION.always.indexOf(file) >= 0,
      trigger_when_monitoring: ACTIVATION.when_monitoring.indexOf(file) >= 0,
      trigger_when_weekly_digest: ACTIVATION.when_weekly_digest.indexOf(file) >= 0,
      referenced_by_test: referencedByTest,
      archive_safe_candidate: archiveSafe,
      retain_reason: archiveSafe ? '' : blockers.join('; '),
      action: archiveSafe ? 'review_for_archive' : 'retain'
    };
  }).sort((x, y) => (x.file < y.file ? -1 : 1));

  // ---- runtime LOGICAL identity (single source of truth for the operator-local id resolver) ----
  // This block carries only NON-secret logical identity: the WF key, the exact expected name, the source file,
  // the deployment role, callable/trigger expectations and the binding edges this workflow OWNS as a caller.
  // The real installation-specific n8n workflow id is NEVER stored here — it lives in the gitignored
  // config/runtime_ids.local.json (id_source=operator_local). canonical_id stays null in the committed repo.
  const callableSet = new Set(callableTargets);
  const orderPos = {}; importOrder.forEach((f, i) => { orderPos[f] = i; });
  const runtimeIdentity = {};
  entries
    .filter(e => e.runtime && e.wf_number)
    .sort((a, b) => orderPos[a.file] - orderPos[b.file])
    .forEach(e => {
      runtimeIdentity[e.wf_number] = {
        wf: e.wf_number,
        file: e.file,
        name: e.name,
        role: e.deployment_role,
        callable: callableSet.has(e.file),
        trigger_entrypoint: entrypoints.has(e.file),
        activation_flag: e.activation_flag,
        expected_target_trigger: callableSet.has(e.file) ? EXECUTE_WORKFLOW_TRIGGER : null,
        binding_calls: (e.binding_nodes || []).map(b => ({ caller_node: b.node, target_wf: b.target })),
        canonical_id: null,
        id_source: 'operator_local'
      };
    });

  return {
    generated_by: 'tools/gen_workflow_manifest.js',
    purpose: 'Single source of truth for capability/archive classification AND the production deployment plan (runtime closure, import order, sub-workflow binding edges, activation policy). Derived from the workflow Execute Sub-workflow graph + the POLICY block in the generator; the deploy/smoke tooling consumes deployment.* so the runtime set is defined in exactly one place.',
    workflow_count: entries.length,
    capability_classes: ['production_entrypoint', 'production_dependency', 'optional_source_adapter', 'manual_diagnostic', 'legacy_referenced'],
    deployment: {
      n8n_version: N8N_VERSION,
      runtime_roots: RUNTIME_ROOTS.slice().sort(numSort),
      runtime_closure: Array.from(closure).sort(numSort),
      runtime_workflow_count: closure.size,
      import_order: importOrder,
      callable_targets: callableTargets,
      binding_edges: runtimeEdges.map(e => ({
        caller_workflow: e.caller_file, caller_wf: e.caller_wf, caller_node: e.caller_node,
        target_workflow: e.target_file, target_wf: e.target_wf,
        expected_caller_type: e.expected_caller_type, expected_target_trigger: e.expected_target_trigger,
        required: true
      })),
      binding_edge_count: runtimeEdges.length,
      activation: {
        always: ACTIVATION.always.slice(),
        when_monitoring: ACTIVATION.when_monitoring.slice(),
        when_weekly_digest: ACTIVATION.when_weekly_digest.slice(),
        never_callable: callableTargets.slice(),
        callable_trigger_count: callableTargets.length
      },
      requires_runtime: { xlsx_zlib: RUNTIME_REQUIRES.xlsx_zlib.slice() },
      expected_active_after_import: [],
      excluded_from_runtime: all.map(w => w.file).filter(f => !closure.has(f)).sort(numSort)
    },
    // logical identity for the 15 runtime workflows (non-secret); real ids live in config/runtime_ids.local.json
    runtime_identity: runtimeIdentity,
    // legacy mirrors (kept so existing readers keep working); authoritative copies live under deployment.*
    deploy_import_order: importOrder,
    trigger_workflows_always: ACTIVATION.always.slice(),
    trigger_workflows_when_monitoring: ACTIVATION.when_monitoring.slice(),
    trigger_workflows_when_weekly_digest: ACTIVATION.when_weekly_digest.slice(),
    archive_safe_candidates: entries.filter(e => e.archive_safe_candidate).map(e => e.file),
    workflows: entries
  };
}

function stable(obj) { return JSON.stringify(obj, null, 2) + '\n'; }

if (require.main === module) {
  const manifest = build();
  const text = stable(manifest);
  const check = process.argv.indexOf('--check') >= 0;
  if (check) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) {
      console.error('STALE: config/workflow_manifest.json is out of date. Run: node tools/gen_workflow_manifest.js');
      process.exit(1);
    }
    console.log('config/workflow_manifest.json is up to date (' + manifest.workflow_count + ' workflows; runtime=' +
      manifest.deployment.runtime_workflow_count + ', edges=' + manifest.deployment.binding_edge_count + ').');
    process.exit(0);
  }
  fs.writeFileSync(OUT, text);
  console.log('wrote config/workflow_manifest.json (' + manifest.workflow_count + ' workflows; runtime=' +
    manifest.deployment.runtime_workflow_count + ', binding edges=' + manifest.deployment.binding_edge_count + ')');
}

module.exports = { build, N8N_VERSION, RUNTIME_ROOTS, ACTIVATION };
