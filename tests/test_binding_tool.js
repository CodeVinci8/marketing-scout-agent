// test_binding_tool.js — QA-002 / QA-009: automatic post-import binding of the eight Execute Sub-workflow ids.
// Builds a synthetic "exported" directory (the committed runtime workflows with deterministic assigned ids), runs
// the binder, and proves: all 8 edges resolved to the EXACT target id, zero placeholders, idempotent second run,
// verify mode, and fail-closed rejection of duplicate / missing / ambiguous / wrong-type inputs. Offline, $0.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const L = require('../tools/manifest_lib.js');
const B = require('../tools/bind_n8n_workflow_ids.js');

const WF_DIR = path.join(__dirname, '..', 'n8n', 'workflows');

// Materialize an exported dir from a list of files, assigning deterministic ids. Returns { dir, idByFile }.
function exportDir(files, opts) {
  opts = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bind-'));
  const idByFile = {};
  let i = 100;
  for (const f of files) {
    const wf = JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8'));
    wf.id = 'ID' + (i++);
    idByFile[f] = wf.id;
    fs.writeFileSync(path.join(dir, f), JSON.stringify(wf, null, 2) + '\n');
  }
  return { dir, idByFile };
}
function rm(d) { fs.rmSync(d, { recursive: true, force: true }); }
function readWf(dir, file) { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }

const CLOSURE = L.runtimeClosure();
const EDGES = L.bindingEdges();

A.section('QA-002 — first bind resolves all 13 edges to the exact target id, zero placeholders');
let env = exportDir(CLOSURE);
const r1 = B.bindDir(env.dir, { write: true });
A.eq('bindings_expected', r1.bindings_expected, 13);
A.eq('bindings_resolved', r1.bindings_resolved, 13);
A.eq('placeholders_remaining', r1.placeholders_remaining, 0);
A.eq('missing_targets', r1.missing_targets, 0);
A.eq('ambiguous_targets', r1.ambiguous_targets, 0);
A.eq('duplicate_workflows', r1.duplicate_workflows, 0);
A.eq('all_inactive', r1.all_inactive, true);
A.eq('report ok', r1.ok, true);
// DEC-161: WF18 is now the 4th caller (dispatcher -> WF19/20/21/22/24)
A.eq('only the 4 caller workflows were rewritten', r1.files_written.slice().sort(),
  ['18_telegram_agent_gateway.json', '20_agent_orchestrator.json', '21_deep_competitor_analysis.json', '23_scheduled_source_monitor.json']);

A.section('QA-002 — each caller node now holds the EXACT assigned id of its target (matched by name, not position)');
for (const e of EDGES) {
  const callerName = L.workflowName(e.caller_workflow);
  const callerFile = fs.readdirSync(env.dir).find(f => readWf(env.dir, f).name === callerName);
  const node = readWf(env.dir, callerFile).nodes.find(n => n.name === e.caller_node);
  A.eq('bound ' + e.caller_wf + '::' + e.caller_node + ' -> ' + e.target_wf, node.parameters.workflowId.value, env.idByFile[e.target_workflow]);
  A.eq('caller workflow id preserved: ' + e.caller_wf, readWf(env.dir, callerFile).id, env.idByFile[e.caller_workflow]);
}

A.section('SECURITY-005 / Phase 7 — the binding report carries FINGERPRINTS only (no raw target/previous ids)');
{
  const rep = B.bindDir(env.dir, { verify: true });
  A.ok('every edge exposes target_id_fp (fp_<sha10> or the PASTE placeholder)',
    rep.edges.every(e => typeof e.target_id_fp === 'string' && /^(fp_[0-9a-f]{10}|PASTE_WORKFLOW_ID)$/.test(e.target_id_fp)));
  A.ok('every edge exposes previous_value_fp', rep.edges.every(e => 'previous_value_fp' in e));
  A.ok('raw target_id / previous_value fields are GONE', rep.edges.every(e => !('target_id' in e) && !('previous_value' in e)));
  const blob = JSON.stringify(rep);
  const rawIds = Object.values(env.idByFile);
  A.ok('no raw assigned workflow id leaks into the report', rawIds.every(id => blob.indexOf(String(id)) < 0));
  // an UNRESOLVED edge error must also fingerprint the offending value, never print a raw id
  const env2 = exportDir(CLOSURE);
  // force a mismatch: point one caller's binding at a bogus raw id
  const callerFile = '20_agent_orchestrator.json';
  const wf = readWf(env2.dir, callerFile);
  const node = wf.nodes.find(n => n.type === 'n8n-nodes-base.executeWorkflow');
  node.parameters.workflowId.value = 'RAWLEAKID999';
  fs.writeFileSync(path.join(env2.dir, callerFile), JSON.stringify(wf, null, 2) + '\n');
  const rmis = B.bindDir(env2.dir, { verify: true });
  A.ok('unresolved-edge error never prints the raw id', JSON.stringify(rmis.errors).indexOf('RAWLEAKID999') < 0);
  rm(env2.dir);
}

A.section('QA-009 — second run is a no-op (idempotent) and verify mode passes');
const r2 = B.bindDir(env.dir, { write: true });
A.eq('idempotent: nothing rewritten on second run', r2.files_written.length, 0);
A.eq('idempotent: still 13 resolved', r2.bindings_resolved, 13);
const rv = B.bindDir(env.dir, { verify: true });
A.eq('verify mode: ok', rv.ok, true);
A.eq('verify mode: zero placeholders', rv.placeholders_remaining, 0);
A.eq('verify mode: no errors', rv.errors.length, 0);
rm(env.dir);

A.section('fail-closed: duplicate workflow name is rejected');
env = exportDir(CLOSURE);
const dupWf = readWf(env.dir, '04_firecrawl_url_list_resilient.json');
fs.writeFileSync(path.join(env.dir, '04_copy.json'), JSON.stringify(dupWf, null, 2) + '\n');
const rd = B.bindDir(env.dir, { verify: true });
A.ok('duplicate_workflows detected', rd.duplicate_workflows >= 1);
A.eq('duplicate makes report not-ok', rd.ok, false);
rm(env.dir);

A.section('fail-closed: missing target is rejected');
env = exportDir(CLOSURE.filter(f => f !== '26_vk_public_community_collector.json'));
const rmiss = B.bindDir(env.dir, { verify: true });
A.ok('missing_targets detected', rmiss.missing_targets >= 1);
A.eq('missing target makes report not-ok', rmiss.ok, false);
rm(env.dir);

A.section('fail-closed: a caller node of the wrong type is rejected');
env = exportDir(CLOSURE);
const orch = readWf(env.dir, '20_agent_orchestrator.json');
orch.nodes.find(n => n.name === 'Run WF08 Analyzer').type = 'n8n-nodes-base.noOp';
fs.writeFileSync(path.join(env.dir, '20_agent_orchestrator.json'), JSON.stringify(orch, null, 2) + '\n');
const rtype = B.bindDir(env.dir, { verify: true });
A.ok('wrong-type caller node produces an error', rtype.errors.some(e => /wrong type/.test(e)));
A.eq('wrong-type makes report not-ok', rtype.ok, false);
rm(env.dir);

A.section('fail-closed: a renamed/absent caller node is rejected (no positional fallback)');
env = exportDir(CLOSURE);
const orch2 = readWf(env.dir, '20_agent_orchestrator.json');
orch2.nodes.find(n => n.name === 'Run WF12 Report').name = 'Renamed Node';
fs.writeFileSync(path.join(env.dir, '20_agent_orchestrator.json'), JSON.stringify(orch2, null, 2) + '\n');
const rmissnode = B.bindDir(env.dir, { verify: true });
A.ok('absent caller node produces an error', rmissnode.errors.some(e => /caller node not found/.test(e)));
A.eq('absent caller node makes report not-ok', rmissnode.ok, false);
rm(env.dir);

A.report('binding-tool');
