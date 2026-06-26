// manifest_lib.js — the ONE reader for config/workflow_manifest.json. deploy_n8n.sh, the import/zlib/e2e
// smokes, the binding tool and the manifest validator all consume the deployment plan through here, so the
// runtime set, import order, binding edges and activation policy are never duplicated by hand (QA-001).
//
// Library API (require): loadManifest(), deployment(), importOrder(), runtimeClosure(), bindingEdges(),
//   activationPlan({monitoring,weeklyDigest}), expectedN8nVersion().
// CLI (so bash can read the same facts without re-implementing them):
//   node tools/manifest_lib.js import-order              # one runtime file per line (deterministic order)
//   node tools/manifest_lib.js runtime-count             # e.g. 15
//   node tools/manifest_lib.js n8n-version               # e.g. 2.23.3
//   node tools/manifest_lib.js binding-edges             # JSON array of the 8 edges
//   node tools/manifest_lib.js binding-count             # e.g. 8
//   node tools/manifest_lib.js callable-targets          # one callable file per line (6)
//   node tools/manifest_lib.js activation [--monitoring] [--weekly-digest]   # files to activate, one per line
//   node tools/manifest_lib.js plan-json [--monitoring] [--weekly-digest]    # full machine-readable plan
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'config', 'workflow_manifest.json');
const WF_DIR = path.join(ROOT, 'n8n', 'workflows');

function loadManifest() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  if (!m.deployment) throw new Error('workflow_manifest.json has no deployment section — run: node tools/gen_workflow_manifest.js');
  return m;
}
function deployment() { return loadManifest().deployment; }
function importOrder() { return deployment().import_order.slice(); }
function runtimeClosure() { return deployment().runtime_closure.slice(); }
function callableTargets() { return deployment().callable_targets.slice(); }
function bindingEdges() { return deployment().binding_edges.map(e => Object.assign({}, e)); }
function expectedN8nVersion() { return deployment().n8n_version; }
// Logical (non-secret) identity for the 15 runtime workflows; real ids live in config/runtime_ids.local.json.
function runtimeIdentity() { return JSON.parse(JSON.stringify(loadManifest().runtime_identity || {})); }

// Files that may be activated for the given feature flags. Never includes a callable sub-workflow.
function activationPlan(opts) {
  opts = opts || {};
  const act = deployment().activation;
  const files = act.always.slice();
  if (opts.monitoring) act.when_monitoring.forEach(f => files.push(f));
  if (opts.weeklyDigest) act.when_weekly_digest.forEach(f => files.push(f));
  // hard guard: no callable target may ever appear in an activation plan
  const callable = new Set(callableTargets());
  for (const f of files) if (callable.has(f)) throw new Error('activation plan contains a callable sub-workflow: ' + f);
  return files;
}

// The exact workflow name n8n indexes a file by (used by the binding tool to match by exact name, not substring).
function workflowName(file) {
  const wf = JSON.parse(fs.readFileSync(path.join(WF_DIR, file), 'utf8'));
  return String(wf.name || '');
}

module.exports = {
  loadManifest, deployment, importOrder, runtimeClosure, callableTargets, bindingEdges,
  expectedN8nVersion, activationPlan, workflowName, runtimeIdentity, MANIFEST, WF_DIR
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opts = { monitoring: args.indexOf('--monitoring') >= 0, weeklyDigest: args.indexOf('--weekly-digest') >= 0 };
  const d = deployment();
  switch (cmd) {
    case 'import-order': importOrder().forEach(f => console.log(f)); break;
    case 'runtime-count': console.log(d.runtime_workflow_count); break;
    case 'n8n-version': console.log(d.n8n_version); break;
    case 'binding-edges': console.log(JSON.stringify(bindingEdges(), null, 2)); break;
    case 'binding-count': console.log(d.binding_edge_count); break;
    case 'callable-targets': callableTargets().forEach(f => console.log(f)); break;
    case 'callable-count': console.log(d.callable_targets.length); break;
    case 'activation': activationPlan(opts).forEach(f => console.log(f)); break;
    case 'plan-json':
      console.log(JSON.stringify({
        n8n_version: d.n8n_version,
        runtime_workflow_count: d.runtime_workflow_count,
        import_order: d.import_order,
        binding_edge_count: d.binding_edge_count,
        binding_edges: bindingEdges(),
        callable_targets: d.callable_targets,
        activation: { plan: activationPlan(opts), always: d.activation.always, when_monitoring: d.activation.when_monitoring, when_weekly_digest: d.activation.when_weekly_digest, never_callable: d.activation.never_callable },
        excluded_from_runtime: d.excluded_from_runtime
      }, null, 2));
      break;
    default:
      console.error('usage: node tools/manifest_lib.js <import-order|runtime-count|n8n-version|binding-edges|binding-count|callable-targets|activation|plan-json> [--monitoring] [--weekly-digest]');
      process.exit(2);
  }
}
