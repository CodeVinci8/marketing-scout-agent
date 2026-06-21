// gen_workflow_manifest.js — machine-readable workflow dependency + capability manifest (Section 1).
//
// The independent audit suggested archiving "experimental" Stage 2/3 workflows (WF05–WF15). This tool exists
// so that decision is data-driven, never a guess: for every workflow it computes who calls it (Execute
// Sub-workflow edges), whether the deploy script imports it, whether a trigger/scheduled workflow activates
// it, and whether any test references it. From those facts it assigns ONE capability class and an
// archive-safety verdict. A workflow is only ever a `safe_archive_candidate` when ALL of: no caller, not
// imported, no test reference, and not a trigger/scheduled entrypoint. Default verdict is RETAIN.
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
const DEPLOY = path.join(ROOT, 'scripts', 'deploy_n8n.sh');
const OUT = path.join(ROOT, 'config', 'workflow_manifest.json');

// Parse a bash array `NAME=( "a.json" "b.json" )` (single- or multi-line) into a list of .json names.
function bashArray(src, name) {
  const m = src.match(new RegExp(name + '=\\(([\\s\\S]*?)\\)'));
  if (!m) return [];
  return (m[1].match(/"([^"]+\.json)"/g) || []).map(s => s.replace(/"/g, ''));
}

// Collect every textual reference to a workflow from the test tree (filename or WF<nn> token, or the
// long-hand workflow basename). This is intentionally broad: a single mention counts as "referenced".
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
  // the lead-scout fixture harness also references WF12/13/14
  const ls = path.join(ROOT, 'n8n', 'fixtures', 'lead_scout');
  if (fs.existsSync(ls)) walk(ls);
  return out.join('\n');
}

function build() {
  const a = audit();
  const all = loadAll();
  const deploySrc = fs.readFileSync(DEPLOY, 'utf8');
  const importOrder = bashArray(deploySrc, 'IMPORT_ORDER');
  const triggersAlways = bashArray(deploySrc, 'TRIGGER_WORKFLOWS_ALWAYS');
  const triggersMonitor = bashArray(deploySrc, 'TRIGGER_WORKFLOWS_MONITORING');
  const tests = testCorpus();

  // reverse call map: file -> [files that call it]
  const callers = {};
  a.exec_edges.forEach(e => { (callers[e.to] = callers[e.to] || []).push(e.from); });
  // forward call map: file -> [files it calls]
  const calls = {};
  a.exec_edges.forEach(e => { (calls[e.from] = calls[e.from] || []).push(e.to); });

  const entries = all.map(({ file, num, wf }) => {
    const cls = a.classification[file] || ['none'];
    const calledBy = (callers[file] || []).sort();
    const callsOut = (calls[file] || []).sort();
    const imported = importOrder.indexOf(file) >= 0;
    const isTriggerAlways = triggersAlways.indexOf(file) >= 0;
    const isTriggerMonitor = triggersMonitor.indexOf(file) >= 0;
    // test reference: WF number token, the json filename, or the trailing basename
    const base = file.replace(/^\d+_/, '').replace(/\.json$/, '');
    const refRe = new RegExp('(WF0*' + Number(num) + '\\b)|(' + file.replace(/[.]/g, '\\.') + ')|(' + base + ')', 'i');
    const referencedByTest = num ? refRe.test(tests) : tests.indexOf(file) >= 0;

    // capability class (one canonical value)
    let capability;
    if (cls.indexOf('public') >= 0) capability = 'production_entrypoint';
    else if (cls.indexOf('scheduled') >= 0) capability = 'production_entrypoint';
    else if (calledBy.length && calledBy.some(c => importOrder.indexOf(c) >= 0)) capability = 'production_dependency';
    else if (imported) capability = 'production_dependency';
    else if (/connector|avito|social|discussion|reviews/i.test(file)) capability = 'optional_source_adapter';
    else if (/healthcheck|sheets_append|single_record|single_url|test/i.test(file)) capability = 'manual_diagnostic';
    else if (referencedByTest || calledBy.length) capability = 'legacy_referenced';
    else capability = 'manual_diagnostic';

    // archive safety: only when nothing depends on it in any dimension
    const noCaller = calledBy.length === 0;
    const blockers = [];
    if (!noCaller) blockers.push('called_by:' + calledBy.join(','));
    if (referencedByTest) blockers.push('referenced_by_test');
    if (imported) blockers.push('in_deploy_import_order');
    if (isTriggerAlways || isTriggerMonitor) blockers.push('trigger_entrypoint');
    const archiveSafe = blockers.length === 0;

    return {
      file, wf_number: num ? 'WF' + num : '', name: wf.name || '', node_count: (wf.nodes || []).length,
      active: wf.active === false ? false : wf.active,
      trigger_classes: a.trigger_classes[file] || [], classification: cls,
      capability_class: capability,
      called_by: calledBy, calls: callsOut,
      imported_by_deploy: imported, trigger_always: isTriggerAlways, trigger_when_monitoring: isTriggerMonitor,
      referenced_by_test: referencedByTest,
      archive_safe_candidate: archiveSafe,
      retain_reason: archiveSafe ? '' : blockers.join('; '),
      action: archiveSafe ? 'review_for_archive' : 'retain'
    };
  }).sort((x, y) => (x.file < y.file ? -1 : 1));

  return {
    generated_by: 'tools/gen_workflow_manifest.js',
    purpose: 'Data-driven capability + archive-safety classification for every workflow. Default action is RETAIN; nothing is archived while any caller/test/deploy/trigger references it (Section 1 of the reporting-UX phase).',
    workflow_count: entries.length,
    capability_classes: ['production_entrypoint', 'production_dependency', 'optional_source_adapter', 'manual_diagnostic', 'legacy_referenced'],
    deploy_import_order: importOrder,
    trigger_workflows_always: triggersAlways,
    trigger_workflows_when_monitoring: triggersMonitor,
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
    console.log('config/workflow_manifest.json is up to date (' + manifest.workflow_count + ' workflows).');
    process.exit(0);
  }
  fs.writeFileSync(OUT, text);
  console.log('wrote config/workflow_manifest.json (' + manifest.workflow_count + ' workflows; ' +
    manifest.archive_safe_candidates.length + ' archive-safe candidate(s))');
}

module.exports = { build };
