// gen_stage4_accepted_path_qa.js — mechanically derive a localhost-only QA harness from the REAL secure WF18.
//
// Stage 4 LIVE acceptance (LIVE-SHEETS-001 / IDEMP-001): proves the real WF18 accepted path against the real
// production Google Sheets + the real WF19 child, with ZERO paid calls and WITHOUT exposing anything through
// ngrok. We transform the production WF18 export (resolved ids/credentials/bindings) so that:
//   * the Telegram Webhook trigger becomes a Manual-Trigger-fed Code "injector" that synthesises ONE accepted
//     update from $env (real webhook secret + first allowed owner id) plus a UNIQUE QA marker — secrets are read
//     at runtime inside n8n, never embedded in JSON, never printed;
//   * every Telegram api.telegram.org httpRequest SEND becomes a deterministic Code SINK (no HTTP, no token, no
//     real user-visible message) that records what WOULD have been sent;
//   * respondToWebhook becomes a Code passthrough (no webhook to answer under `n8n execute`);
//   * every googleSheets node and the Run WF19 executeWorkflow are LEFT INTACT (real reads/writes/child).
//
// Output is an INACTIVE workflow with a fresh id/name. It carries NO secret and NO spreadsheet id. Usage:
//   node tools/gen_stage4_accepted_path_qa.js --wf18 <prod_wf18.json> --out <qa.json> --id <id> --marker <m> --update-id <n>
'use strict';
const fs = require('fs');

function arg(f, d) { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; }

const wf18Path = arg('--wf18');
const outPath = arg('--out');
const qaId = arg('--id');
const marker = arg('--marker');
const updateId = arg('--update-id');
if (!wf18Path || !outPath || !qaId || !marker || !updateId) {
  console.error('usage: --wf18 <file> --out <file> --id <id> --marker <str> --update-id <n>');
  process.exit(2);
}

const wf = JSON.parse(fs.readFileSync(wf18Path, 'utf8'));

// --- the synthetic injector (runs as the "Telegram Webhook" node; reads secrets at runtime, embeds none) -------
const injectorCode =
  'var e=(typeof $env!=="undefined"&&$env)?$env:{};\n' +
  'var allowed=String(e.MS_TELEGRAM_ALLOWED_USER_IDS||"").split(/[\\s,;]+/).filter(Boolean);\n' +
  'var owner=allowed.length?allowed[0]:"0";\n' +
  'var marker=' + JSON.stringify(marker) + ';\n' +
  'var uid=' + JSON.stringify(String(updateId)) + ';\n' +
  'var now=Math.floor(Date.now()/1000);\n' +
  'var update={update_id:Number(uid),message:{message_id:Number(uid),date:now,' +
  'from:{id:Number(owner),is_bot:false,first_name:"QA",language_code:"ru"},' +
  'chat:{id:Number(owner),type:"private"},' +
  'text:"проанализируй конкурентов по сайту "+marker}};\n' +
  'return [{json:{headers:{"x-telegram-bot-api-secret-token":String(e.MS_TELEGRAM_WEBHOOK_SECRET||"")},body:update,qa_marker:marker}}];';

// --- a Telegram SEND sink: record the would-be send, make NO HTTP call, pass input json through ---------------
function sinkCode(nodeName) {
  return 'var j=$json||{};\n' +
    'return [{json:Object.assign({},j,{_qa_telegram_sink:true,_qa_sink_node:' + JSON.stringify(nodeName) + ',_qa_marker:' + JSON.stringify(marker) + '})}];';
}

let injectors = 0, sinks = 0, responders = 0;
for (const n of (wf.nodes || [])) {
  if (n.name === 'Telegram Webhook') {
    n.type = 'n8n-nodes-base.code'; n.typeVersion = 2;
    n.parameters = { jsCode: injectorCode };
    delete n.webhookId; delete n.credentials;
    injectors++;
    continue;
  }
  const url = String((n.parameters && n.parameters.url) || '');
  if (n.type === 'n8n-nodes-base.httpRequest' && /api\.telegram\.org/.test(url)) {
    n.type = 'n8n-nodes-base.code'; n.typeVersion = 2;
    n.parameters = { jsCode: sinkCode(n.name) };
    delete n.credentials;
    sinks++;
    continue;
  }
  if (n.type === 'n8n-nodes-base.respondToWebhook') {
    n.type = 'n8n-nodes-base.code'; n.typeVersion = 2;
    n.parameters = { jsCode: 'return [{json:Object.assign({},$json||{},{_qa_respond_noop:true})}];' };
    responders++;
    continue;
  }
}

// --- add a Manual Trigger and wire it into the (now Code) injector so `n8n execute` has a start node ----------
const TRIGGER = 'QA Manual Trigger';
wf.nodes.push({
  parameters: {}, id: 'qa-manual-trigger', name: TRIGGER,
  type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-400, 0]
});
wf.connections = wf.connections || {};
wf.connections[TRIGGER] = { main: [[{ node: 'Telegram Webhook', type: 'main', index: 0 }]] };

// --- finalize: fresh identity, inactive, no webhook/pin/static leftovers -------------------------------------
wf.id = qaId;
wf.name = 'QA Stage4 Accepted Path (' + marker + ')';
wf.active = false;
delete wf.versionId; delete wf.pinData; delete wf.staticData; delete wf.tags; delete wf.triggerCount;
delete wf.shared; delete wf.meta; delete wf.createdAt; delete wf.updatedAt;
wf.settings = wf.settings || { executionOrder: 'v1' };

fs.writeFileSync(outPath, JSON.stringify(wf, null, 2) + '\n');
console.log('QA_HARNESS_WRITTEN injectors=' + injectors + ' telegram_sinks=' + sinks + ' responders=' + responders +
  ' nodes=' + wf.nodes.length);
// hard guards (honest): exactly one injector, at least one sink, no remaining telegram httpRequest, no webhook node
const stillTelegram = wf.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest' && /api\.telegram\.org/.test(String((n.parameters && n.parameters.url) || ''))).length;
const stillWebhook = wf.nodes.filter(n => n.type === 'n8n-nodes-base.webhook' || n.type === 'n8n-nodes-base.respondToWebhook').length;
const ok = injectors === 1 && sinks >= 1 && stillTelegram === 0 && stillWebhook === 0;
console.log('QA_HARNESS_SANE=' + (ok ? 'PASS' : 'FAIL') + ' (stillTelegramHttp=' + stillTelegram + ' stillWebhookNodes=' + stillWebhook + ')');
process.exit(ok ? 0 : 1);
