// wf_harness.js — run REAL n8n Code-node jsCode (extracted from a workflow JSON) under minimal shims.
// NO network. Lets the offline suite exercise the actual node logic shipped in the workflow, so the
// node-embedded mirrors of n8n/lib/* cannot silently drift from the tested library.
'use strict';
const fs = require('fs');
const path = require('path');
const WF_DIR = path.join(__dirname, '..', 'n8n', 'workflows');

function loadWorkflow(file) { return JSON.parse(fs.readFileSync(path.join(WF_DIR, file), 'utf8')); }
function getNodeCode(wf, name) {
  const n = (wf.nodes || []).find(x => x.name === name);
  if (!n) throw new Error('node not found: ' + name);
  if (!n.parameters || typeof n.parameters.jsCode !== 'string') throw new Error('not a Code node: ' + name);
  return n.parameters.jsCode;
}
function makeRun() { return { outputs: Object.create(null), staticData: {} }; }
function inject(run, name, rows) { run.outputs[name] = (rows || []).map(j => ({ json: j })); return run.outputs[name]; }

function runCodeNode(run, wf, name, inputItems) {
  const code = getNodeCode(wf, name);
  inputItems = inputItems || [];
  const $ = (nm) => {
    const out = run.outputs[nm];
    if (out === undefined) throw new Error('$("' + nm + '") referenced before produced');
    return {
      all: () => out.map(i => ({ json: i.json })),
      first: () => ({ json: (out[0] && out[0].json) || {} }),
      last: () => ({ json: (out[out.length - 1] && out[out.length - 1].json) || {} })
    };
  };
  const $input = {
    all: () => inputItems.map(i => ({ json: i.json })),
    first: () => ({ json: (inputItems[0] && inputItems[0].json) || {} }),
    get item() { return { json: (inputItems[0] && inputItems[0].json) || {} }; }
  };
  const $getWorkflowStaticData = () => run.staticData;
  // Faithful to an n8n Code node with NODE_FUNCTION_ALLOW_BUILTIN restricted to PURE built-ins only (zlib/crypto/
  // buffer/util) — needed for the real XLSX writer (zlib). No I/O/network module is ever exposed, so the offline
  // guarantee (no network, $0) holds. Deploy docs must set NODE_FUNCTION_ALLOW_BUILTIN=zlib (or *) for XLSX export.
  const SAFE_BUILTINS = ['zlib', 'crypto', 'buffer', 'util', 'string_decoder'];
  const requireShim = (name) => {
    if (SAFE_BUILTINS.indexOf(String(name)) >= 0) return require(String(name));
    throw new Error('require("' + name + '") is not allowed in the offline Code-node harness');
  };
  const fn = new Function('$', '$input', '$getWorkflowStaticData', '$json', 'require', 'Buffer', code);
  const $json = (inputItems[0] && inputItems[0].json) || {};
  const res = fn($, $input, $getWorkflowStaticData, $json, requireShim, Buffer);
  const items = Array.isArray(res) ? res : (res ? [res] : []);
  run.outputs[name] = items;
  return items;
}
module.exports = { loadWorkflow, getNodeCode, makeRun, inject, runCodeNode };
