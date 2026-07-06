// test_wf26_generator_sync.js — drift-proof: the CANONICAL generator (tools/gen_stage4_workflows.js) must itself
// emit VK-ENABLE-001 + VK-PARSE-001, not just the committed JSON. A prior session applied these two VK fixes only
// to the committed 26_*.json while the generator stayed stale — so a plain `node tools/gen_stage4_workflows.js`
// silently reverted them. This asserts (a) the in-memory generator output carries both fixes, and (b) the VK gate
// and parse node code is byte-identical between the generator and the committed workflow (no surgical-only patch).
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');

const gen = require('../tools/gen_stage4_workflows.js');
const built = (gen.generated || []).find(g => g.file === '26_vk_public_community_collector.json');
const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '26_vk_public_community_collector.json'), 'utf8'));

function node(wf, name) { return (wf.nodes || []).find(n => n.name === name); }
function code(wf, name) { const n = node(wf, name); return n && n.parameters ? String(n.parameters.jsCode || '') : ''; }

A.section('WF26 generator sync — generator emits both VK fixes');
A.ok('generator built WF26', !!built, 'generated array missing 26_*.json');
const genWf = built.workflow;

// VK-ENABLE-001 in the generator's gate node
const genGate = code(genWf, 'VK Credential Gate');
A.ok('gen gate merges trigger inputs over $json (VK-ENABLE-001)', /When Called by Agent'\).first\(\)/.test(genGate) && /Object\.assign\(\{\}, \(\$json\|\|\{\}\), __trig\)/.test(genGate), 'gate does not merge trigger');
A.ok('gen gate honors per-call approval token', /VK_LIVE_APPROVED/.test(genGate) && /enable_vk_collector:true/.test(genGate), 'gate missing approval enable');

// VK-PARSE-001 in the generator's parse node
const genParse = code(genWf, 'Parse Wall & Detect Changes');
A.ok('gen parse reads wall from VK wall.get, not $json (VK-PARSE-001)', /\$\('VK wall\.get'\)\.first\(\)/.test(genParse) && /parseWall\(__wall,/.test(genParse), 'parse still reads $json');
A.ok('gen parse no longer calls parseWall($json', !/parseWall\(\$json/.test(genParse), 'parse still uses parseWall($json...)');

// subTrigger input contract carries vk_enable_approval
const genTrig = node(genWf, 'When Called by Agent');
const inputs = ((genTrig.parameters.workflowInputs || {}).values || []).map(v => v.name);
A.ok('gen callable trigger exposes vk_enable_approval', inputs.indexOf('vk_enable_approval') >= 0, 'inputs=' + JSON.stringify(inputs));

A.section('WF26 generator sync — generator == committed for the VK nodes (no surgical-only drift)');
for (const nm of ['VK Credential Gate', 'Parse Wall & Detect Changes', 'When Called by Agent']) {
  A.eq('generator node "' + nm + '" identical to committed', JSON.stringify(node(genWf, nm)), JSON.stringify(node(committed, nm)));
}

A.report('wf26-generator-sync');
