// test_claude_endpoint.js — CLAUDE-ENDPOINT-001 regression.
//
// Every intended Claude-compatible request in the RUNTIME graph must target the project-approved gateway
// `https://aiprimetech.io/v1/messages` (operator decision; see docs/DECISIONS.md). No runtime Claude node may
// target `api.anthropic.com`. The credential identity for the credentialled Claude nodes must stay the single
// reconcilable "Claude API - Marketing Scout" httpHeaderAuth reference, and the generator that emits the WF19
// planner node must agree byte-for-byte with the committed workflow. Pure + offline ($0, no docker, no network,
// no paid Claude call). Emits honest named markers in addition to per-assertion PASS/FAIL.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const path = require('path');

const WFDIR = path.join(__dirname, '..', 'n8n', 'workflows');
const M = require('../config/workflow_manifest.json');
const RUNTIME = M.deployment.import_order; // the 15 deployed workflow files

const CANON_URL = 'https://aiprimetech.io/v1/messages';
const CANON_HOST = 'aiprimetech.io';
const FORBIDDEN_HOST = 'api.anthropic.com';
const CLAUDE_CRED = { type: 'httpHeaderAuth', name: 'Claude API - Marketing Scout' };

const readWF = f => JSON.parse(fs.readFileSync(path.join(WFDIR, f), 'utf8'));
// A Claude-compatible node is an httpRequest to the Anthropic-messages path (/v1/messages); this is what
// distinguishes it from the Firecrawl (api.firecrawl.dev), Apify (api.apify.com) and Telegram (api.telegram.org)
// HTTP nodes. We deliberately match on the path so a node that regressed back to api.anthropic.com is STILL caught.
function isClaudeNode(n) {
  if (!n || n.type !== 'n8n-nodes-base.httpRequest') return false;
  const url = String((n.parameters && n.parameters.url) || '');
  return /\/v1\/messages(\b|$)/.test(url);
}
function urlHost(url) { try { return new URL(String(url)).host; } catch (e) { void e; return ''; } }

// Collect every Claude node across the runtime graph (with provenance for honest reporting).
const claudeNodes = [];
for (const f of RUNTIME) {
  const wf = readWF(f);
  for (const n of (wf.nodes || [])) {
    if (isClaudeNode(n)) claudeNodes.push({ file: f, node: n });
  }
}

// =====================================================================================================
A.section('CLAUDE_ENDPOINT_CANONICAL — every runtime Claude node targets the aiprimetech gateway');
let canonical = claudeNodes.length > 0;
A.ok('runtime graph actually contains Claude nodes (test is meaningful)', claudeNodes.length > 0);
for (const { file, node } of claudeNodes) {
  const url = String((node.parameters && node.parameters.url) || '');
  const ok = url === CANON_URL;
  canonical = canonical && ok;
  A.ok(file + ' :: ' + node.name + ' url == ' + CANON_URL, ok, 'got=' + url);
}

A.section('NO_RUNTIME_ANTHROPIC_ENDPOINT — no runtime workflow references api.anthropic.com anywhere');
let noAnthropic = true;
for (const f of RUNTIME) {
  const raw = fs.readFileSync(path.join(WFDIR, f), 'utf8');
  const ok = raw.indexOf(FORBIDDEN_HOST) < 0;
  noAnthropic = noAnthropic && ok;
  A.ok(f + ' free of ' + FORBIDDEN_HOST, ok);
}

A.section('AIPRIMETECH_ALLOWLIST — aiprimetech.io is the ONLY Claude host in the runtime graph');
const claudeHosts = Array.from(new Set(claudeNodes.map(({ node }) => urlHost((node.parameters || {}).url)).filter(Boolean)));
const allowlistOk = claudeHosts.length === 1 && claudeHosts[0] === CANON_HOST;
A.ok('Claude host set == {' + CANON_HOST + '} (got ' + JSON.stringify(claudeHosts) + ')', allowlistOk);

A.section('CLAUDE_CREDENTIAL_RECONCILIATION — credentialled Claude nodes keep the single reconcilable identity');
// A Claude node either (a) declares an n8n credential -> it MUST be the httpHeaderAuth "Claude API - Marketing
// Scout" reference that reconciles to one production credential by (type,name); or (b) is the documented WF12
// inert inline placeholder (DEC-122: x-api-key placeholder, no credential block, replaced by the operator at
// enable-time). No Claude node may reference a different/foreign credential.
let credOk = true;
for (const { file, node } of claudeNodes) {
  const creds = node.credentials || {};
  const credTypes = Object.keys(creds);
  if (credTypes.length === 0) {
    // (b) inert placeholder path — allowed ONLY when the node carries no n8n credential at all.
    A.ok(file + ' :: ' + node.name + ' has no foreign credential (inert placeholder allowed)', true);
    continue;
  }
  // (a) credentialled path — exactly the Claude httpHeaderAuth reference, nothing else.
  const onlyHeaderAuth = credTypes.length === 1 && credTypes[0] === CLAUDE_CRED.type;
  const nameOk = onlyHeaderAuth && String(creds[CLAUDE_CRED.type].name) === CLAUDE_CRED.name;
  credOk = credOk && nameOk;
  A.ok(file + ' :: ' + node.name + ' references ' + CLAUDE_CRED.type + ' "' + CLAUDE_CRED.name + '"', nameOk,
    'got=' + JSON.stringify(creds));
}

A.section('GENERATOR_OUTPUT_ENDPOINT_PARITY — gen_stage4_workflows.httpClaude agrees with committed WF19');
const genSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'gen_stage4_workflows.js'), 'utf8');
const genTargetsCanonical = genSrc.indexOf("url: '" + CANON_URL + "'") >= 0;
const genFreeOfAnthropic = genSrc.indexOf("'https://" + FORBIDDEN_HOST) < 0;
A.ok('generator httpClaude() emits ' + CANON_URL, genTargetsCanonical);
A.ok('generator emits no https://' + FORBIDDEN_HOST + ' literal', genFreeOfAnthropic);
// the committed WF19 planner node must equal what the generator would emit (URL parity, the CLAUDE-ENDPOINT scope)
const wf19 = readWF('19_request_planner.json');
const wf19Claude = (wf19.nodes || []).find(n => n.id === 'wf19-claude');
const wf19Ok = !!wf19Claude && String(wf19Claude.parameters.url) === CANON_URL;
A.ok('committed WF19 planner node url == ' + CANON_URL, wf19Ok, 'got=' + (wf19Claude && wf19Claude.parameters.url));
const parityOk = genTargetsCanonical && genFreeOfAnthropic && wf19Ok;

// =====================================================================================================
// Honest named markers (printed BEFORE A.report, which exits). Each marker is PASS only if its group held.
const m = (k, v) => console.log(k + '=' + (v ? 'PASS' : 'FAIL'));
console.log('\n----- CLAUDE-ENDPOINT-001 markers -----');
m('CLAUDE_ENDPOINT_CANONICAL', canonical);
m('NO_RUNTIME_ANTHROPIC_ENDPOINT', noAnthropic);
m('AIPRIMETECH_ALLOWLIST', allowlistOk);
m('CLAUDE_CREDENTIAL_RECONCILIATION', credOk);
m('GENERATOR_OUTPUT_ENDPOINT_PARITY', parityOk);
console.log('CLAUDE_NODES_AUDITED=' + claudeNodes.length);

A.report('claude-endpoint');
