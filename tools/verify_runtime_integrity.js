'use strict';
// verify_runtime_integrity.js — canonical POST-DEPLOY runtime check. Read-only.
//
// Run this after EVERY workflow import. `/healthz`, the workflow inventory and RestartCount can all look green
// while the Telegram ingress is dead (session 70) or while an imported workflow is silently inactive
// (sessions 70 and 71). See tools/runtime_integrity_lib.js for both hazards.
//
// Usage:
//   node tools/verify_runtime_integrity.js --expect-total 90 --expect-active 17 \
//        [--must-active id1,id2] [--container n8n-n8n-1] [--ingress ms-telegram-agent] [--json]
// Exit 0 = OK; 1 = integrity FAILURE (message says whether a controlled restart is required); 2 = probe error.

const { execFileSync } = require('child_process');
const { evaluateRuntimeIntegrity, formatIntegrityReport } = require('./runtime_integrity_lib.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const CONTAINER = arg('container', 'n8n-n8n-1');
const INGRESS = arg('ingress', 'ms-telegram-agent');
const EXPECT_TOTAL = arg('expect-total', null);
const EXPECT_ACTIVE = arg('expect-active', null);
const MUST_ACTIVE = String(arg('must-active', '')).split(',').filter(Boolean);
const AS_JSON = process.argv.indexOf('--json') >= 0;

function sh(args, timeout) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: timeout || 90000, maxBuffer: 64 * 1024 * 1024 });
}
function listWorkflows(activeOnly) {
  const a = ['exec', CONTAINER, 'n8n', 'list:workflow'];
  if (activeOnly) a.push('--active=true');
  // the CLI prints a release notice on stderr-ish first line; only `id|name` rows count
  return sh(a).split('\n').filter((l) => l.indexOf('|') > 0);
}
function exportWorkflow(id) {
  sh(['exec', CONTAINER, 'sh', '-c', 'n8n export:workflow --id=' + id + ' --output=/tmp/ri_' + id + '.json >/dev/null 2>&1']);
  const raw = sh(['exec', CONTAINER, 'cat', '/tmp/ri_' + id + '.json']);
  let j = JSON.parse(raw);
  if (Array.isArray(j)) j = j[0];
  return j;
}

let probe;
try {
  const health = sh(['exec', CONTAINER, 'sh', '-c',
    'wget -q -O - http://localhost:5678/healthz 2>/dev/null || curl -s http://localhost:5678/healthz']).trim();
  const all = listWorkflows(false);
  const act = listWorkflows(true);

  const webhookRows = JSON.parse(sh(['exec', CONTAINER, 'node', '-e',
    'const s=require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");' +
    'const db=new s.Database("/home/node/.n8n/database.sqlite",s.OPEN_READONLY);' +
    'db.all("SELECT method,webhookPath as path,workflowId FROM webhook_entity",(e,r)=>{' +
    'process.stdout.write(JSON.stringify(e?[]:r));process.exit(0)});']));

  // Probe only what we assert on: the must-active set plus every active webhook owner we can see.
  const ids = MUST_ACTIVE.slice();
  act.forEach((l) => { const id = l.split('|')[0].trim(); if (ids.indexOf(id) < 0 && webhookRows.some((w) => String(w.workflowId) === id)) ids.push(id); });
  const workflows = ids.map((id) => { try { return exportWorkflow(id); } catch (e) { return null; } }).filter(Boolean);

  // A real request is the only proof the path is served. Sent with NO secret header, so the ingress security
  // gate rejects it before any work happens: this can never create a plan, a message or a cost. We only care
  // that it is not 404. Uses node (always present in the image) rather than curl (not installed).
  let post = null;
  try {
    const code = sh(['exec', CONTAINER, 'node', '-e',
      'const h=require("http");const b="{}";const q=h.request({host:"127.0.0.1",port:5678,path:"/webhook/' + INGRESS +
      '",method:"POST",headers:{"Content-Type":"application/json","Content-Length":b.length}},r=>{process.stdout.write(String(r.statusCode));process.exit(0)});' +
      'q.on("error",()=>{process.stdout.write("0");process.exit(0)});q.write(b);q.end();']).trim();
    post = { path: INGRESS, status: Number(code) };
  } catch (e) { /* probe is best-effort; absence is reported as a warning */ }

  probe = {
    health_ok: health.indexOf('"status":"ok"') >= 0,
    total: all.length, active: act.length,
    workflows: workflows, registered_webhooks: webhookRows, webhook_post: post
  };
} catch (e) {
  console.error('PROBE ERROR: ' + e.message);
  process.exit(2);
}

const verdict = evaluateRuntimeIntegrity(probe, {
  total: EXPECT_TOTAL == null ? null : Number(EXPECT_TOTAL),
  active: EXPECT_ACTIVE == null ? null : Number(EXPECT_ACTIVE),
  must_be_active: MUST_ACTIVE
});

if (AS_JSON) console.log(JSON.stringify({ probe: { health_ok: probe.health_ok, total: probe.total, active: probe.active, registered: probe.registered_webhooks.length, post: probe.webhook_post }, verdict: verdict }, null, 1));
else {
  console.log('probe: health=' + probe.health_ok + ' total=' + probe.total + ' active=' + probe.active +
    ' registered_webhooks=' + probe.registered_webhooks.length + ' ingress_post=' + (probe.webhook_post ? probe.webhook_post.status : 'n/a'));
  console.log(formatIntegrityReport(verdict));
}
process.exit(verdict.ok ? 0 : 1);
