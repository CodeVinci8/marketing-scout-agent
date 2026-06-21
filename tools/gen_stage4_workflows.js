// gen_stage4_workflows.js — build the Stage 4 workflow JSON from the proven n8n/lib/* contracts.
// Each Code node embeds the relevant library core verbatim between drift markers (the same drift-proof
// pattern as report_gate/semantic_core) + a small driver. Run: node tools/gen_stage4_workflows.js
'use strict';
const fs = require('fs');
const path = require('path');
const LIB = path.join(__dirname, '..', 'n8n', 'lib');
const WF = path.join(__dirname, '..', 'n8n', 'workflows');

// Extract a lib's embeddable core: strip the leading 'use strict'; and the trailing module.exports, and drop
// local cross-require lines (the depended-on lib is embedded alongside in the SAME node scope, so its symbols
// are already declared — the require() would otherwise throw inside an n8n Code node). Dependencies MUST be
// embedded BEFORE their dependents in the names[] list passed to embed().
function libCore(name) {
  let s = fs.readFileSync(path.join(LIB, name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  s = s.replace(/^\s*const\s*\{[^}]*\}\s*=\s*require\('\.\/[^']+'\);\s*$/gm, ''); // drop local cross-requires
  return s.trim();
}
function embed(names, driver) {
  const blocks = names.map(n =>
    '// embedded n8n/lib/' + n + '.js (drift-proof; test asserts equality)\n' +
    libCore(n) + '\n// --- end embedded ' + n + ' ---');
  return blocks.join('\n\n') + '\n\n// --- node driver ---\n' + driver;
}
function code(id, name, pos, names, driver) {
  return { parameters: { jsCode: embed(names, driver) }, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, id: id, name: name };
}
function manual(id, name, pos) {
  return { parameters: {}, type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: pos, id: id, name: name };
}
function scheduleTrigger(id, name, pos, hours) {
  return { parameters: { rule: { interval: [{ field: 'hours', hoursInterval: hours || 6 }] } }, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: pos, id: id, name: name };
}
function webhook(id, name, pos, p) {
  return { parameters: { httpMethod: 'POST', path: p, options: {} }, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos, id: id, name: name };
}
function sheetsAppend(id, name, pos, tab) {
  return {
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: '={{ $env.MS_SPREADSHEET_ID || "PASTE_SPREADSHEET_ID" }}', mode: 'id' },
      sheetName: { __rl: true, value: tab, mode: 'name' },
      mappingMode: 'autoMapInputData', options: {}
    },
    type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: pos, id: id, name: name
  };
}
function sheetsRead(id, name, pos, tab) {
  return {
    parameters: {
      operation: 'read',
      documentId: { __rl: true, value: '={{ $env.MS_SPREADSHEET_ID || "PASTE_SPREADSHEET_ID" }}', mode: 'id' },
      sheetName: { __rl: true, value: tab, mode: 'name' }, options: {}
    },
    type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: pos, id: id, name: name
  };
}
// appendOrUpdate (upsert) keyed by matchCol — used for the single-latest-row conversation_state.
function sheetsUpsert(id, name, pos, tab, matchCol) {
  return {
    parameters: {
      operation: 'appendOrUpdate',
      documentId: { __rl: true, value: '={{ $env.MS_SPREADSHEET_ID || "PASTE_SPREADSHEET_ID" }}', mode: 'id' },
      sheetName: { __rl: true, value: tab, mode: 'name' },
      columns: { mappingMode: 'autoMapInputData', matchingColumns: [matchCol], schema: [] }, options: {}
    },
    type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: pos, id: id, name: name
  };
}
function ifNode(id, name, pos, expr) {
  return {
    parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'strict' }, combinator: 'and',
      conditions: [{ leftValue: expr, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }] } },
    type: 'n8n-nodes-base.if', typeVersion: 2, position: pos, id: id, name: name
  };
}
// execWf: invoke a callable sub-workflow. `inputs` (optional) maps the callable's declared Execute Sub-workflow
// Trigger fields -> value expressions, so the parent passes NAMED canonical fields (agent_request_id, source_run_id,
// data_mode, ...) rather than relying on positional/`.first()` consumption inside the callable.
function execWf(id, name, pos, note, inputs) {
  var params = { workflowId: { __rl: true, value: 'PASTE_WORKFLOW_ID', mode: 'id', cachedResultName: note }, options: {} };
  if (inputs && Object.keys(inputs).length) {
    var keys = Object.keys(inputs);
    params.workflowInputs = {
      mappingMode: 'defineBelow', value: inputs,
      schema: keys.map(function (k) { return { id: k, displayName: k, required: false, type: 'string', display: true, removed: false }; }),
      matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: false
    };
  }
  return { parameters: params, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.1, position: pos, id: id, name: name };
}
function httpClaude(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: 'https://api.anthropic.com/v1/messages', authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json',
      jsonBody: '={{ $json.claude_request_body }}', options: {}
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name
  };
}
function httpTelegram(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: '=https://api.telegram.org/bot{{ $env.MS_TELEGRAM_BOT_TOKEN }}/sendMessage',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.telegram_send_body }}', options: {}
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name
  };
}
// editMessageText reuses the SAME message (progress edits). Body carries chat_id + message_id + text.
function httpTelegramEdit(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: '=https://api.telegram.org/bot{{ $env.MS_TELEGRAM_BOT_TOKEN }}/editMessageText',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.telegram_edit_body }}', options: {}
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name
  };
}
// sendDocument / sendPhoto: multipart upload of a generated attachment (CSV/XLSX/SVG). The binary is produced by
// the preceding Code node on binary property `attachment`; chat_id is a form field. Never carries a token.
function httpTelegramFile(id, name, pos, apiMethod, formField, binaryField) {
  return {
    parameters: {
      method: 'POST', url: '=https://api.telegram.org/bot{{ $env.MS_TELEGRAM_BOT_TOKEN }}/' + apiMethod,
      sendBody: true, contentType: 'multipart-form-data',
      bodyParameters: { parameters: [
        { name: 'chat_id', value: '={{ $json.chat_id }}' },
        { name: 'caption', value: '={{ $json.caption }}' },
        { parameterType: 'formBinaryData', name: formField, inputDataFieldName: binaryField || 'attachment' }
      ] },
      options: {}
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name
  };
}
// Official VK API call. The access token comes ONLY from the n8n credential store (httpQueryAuth adds
// access_token); it never appears in workflow JSON, params, logs or fixtures. method/params come from the
// vk_collector descriptors. Guarded upstream by the credential gate (never called when setup_required).
function httpVk(id, name, pos) {
  return {
    parameters: {
      method: 'GET', url: '=https://api.vk.com/method/{{ $json.vk_method }}',
      authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
      sendQuery: true, specifyQuery: 'json', jsonQuery: '={{ JSON.stringify($json.vk_params) }}', options: {}
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name
  };
}
// Execute Sub-workflow Trigger ("When Called by Agent") declaring NAMED canonical input fields (mirrors WF04/08
// callable contract so the parent passes named fields, not positional/.first()). Array fields use type 'array'.
function subTrigger(id, name, pos, fields) {
  return {
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        mappingMode: 'defineBelow', value: {},
        schema: (fields || []).map(function (f) {
          var fld = (typeof f === 'string') ? { id: f, type: 'string' } : f;
          return { id: fld.id, displayName: fld.id, required: false, type: fld.type || 'string', display: true, defaultMatch: false, canBeUsedToMatch: false, removed: false };
        }),
        matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: false
      }
    },
    type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: pos, id: id, name: name
  };
}
// connections: array of [from, to, outIndex?]
function conns(edges) {
  const c = {};
  for (const [from, to, idx] of edges) {
    c[from] = c[from] || { main: [] };
    const oi = idx || 0;
    while (c[from].main.length <= oi) c[from].main.push([]);
    c[from].main[oi].push({ node: to, type: 'main', index: 0 });
  }
  return c;
}
function wf(name, nodes, edges) {
  return { name: name, nodes: nodes, connections: conns(edges), active: false, settings: { executionOrder: 'v1' }, pinData: {} };
}
function write(file, obj) { fs.writeFileSync(path.join(WF, file), JSON.stringify(obj, null, 2) + '\n'); console.log('wrote', file, '(' + obj.nodes.length + ' nodes)'); }

const ENV = "var __env=(typeof $env!=='undefined'&&$env)?$env:{};";

// =========================================================================================== WF17 config
write('17_agent_settings_config.json', wf('17 — Agent Settings & Config Loader', [
  manual('wf17-trig', 'Manual Start', [-260, 0]),
  code('wf17-cfg', 'Resolve Agent Config', [-40, 0], ['agent_config'],
    ENV + "\nvar cfg=resolveConfig(__env);\nreturn [{json:cfg}];")
], [['Manual Start', 'Resolve Agent Config']]));

// =========================================================================================== WF18 gateway
// Conversational front door: parse -> route intent (deterministic + guarded LLM) -> intake decision ->
// bounded conversation context (token budget) -> conversational reply (text useful WITHOUT buttons).
write('18_telegram_agent_gateway.json', wf('18 — Telegram Agent Gateway (conversational)', [
  webhook('wf18-hook', 'Telegram Webhook', [-560, 0], 'ms-telegram-agent'),
  code('wf18-cfg', 'Resolve Agent Config', [-340, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  code('wf18-parse', 'Parse Telegram Update', [-120, 0], ['telegram_io'],
    "var body=($json&&$json.body)?$json.body:$json;\nvar parsed=parseUpdate(body);\nvar cfg=$('Resolve Agent Config').first().json;\nparsed.authorized=isAuthorized(parsed,cfg.telegram_allowed_user_ids);\nparsed.idempotency_key=updateIdempotencyKey(parsed);\nreturn [{json:parsed}];"),
  sheetsRead('wf18-readev', 'Read agent_request_events', [100, -160], 'agent_request_events'),
  sheetsRead('wf18-readstate', 'Read conversation_state', [100, 160], 'conversation_state'),
  code('wf18-route', 'Route Intent', [320, 0], ['intent_router', 'agent_charter'],
    "var cfg=$('Resolve Agent Config').first().json;\nvar p=$('Parse Telegram Update').first().json;\nfunction J(v){try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return v;}}\nvar ctx={};try{var rows=($('Read conversation_state').all()||[]).map(function(r){return r.json;}).filter(function(r){return String(r.owner_user_id||r.user_id)===String(p.user_id);});if(rows.length)ctx=Object.assign({},rows[rows.length-1]);}catch(e){}\nif(ctx.last_report)ctx.last_report=J(ctx.last_report);\nif(ctx.selected_competitors)ctx.selected_competitors=J(ctx.selected_competitors);\nvar routed=routeIntent(p,ctx,cfg);\nvar caps=availableCapabilities(cfg);\nvar capId=routed.intent?routed.intent.intent:'clarify_request';\nvar cap=null;for(var i=0;i<caps.length;i++){if(caps[i].id===capId)cap=caps[i];}\nreturn [{json:{parsed:p,route:routed.route,intent:routed.intent,clarification:routed.clarification,capability:cap,capability_available:cap?cap.available:true,cfg:cfg,ctx:ctx,charter:charterText()}}];"),
  code('wf18-intake', 'Build Intake Decision', [540, 0], ['agent_state'],
    "var r=$('Route Intent').first().json;var p=r.parsed;\nvar seen={};try{($('Read agent_request_events').all()||[]).forEach(function(x){var k=(x.json&&x.json.idempotency_key)||'';if(k)seen[k]=1;});}catch(e){}\nvar dup=!!seen[p.idempotency_key];\nvar stamp=(new Date()).toISOString();\nif(!p.authorized){return [{json:{decision:'unauthorized',start_work:false,routed:r}}];}\nif(dup){return [{json:{decision:'duplicate',start_work:false,routed:r}}];}\nvar intent=r.intent||{intent:'clarify_request',requested_action:'clarify'};\nvar external=intent.requested_action==='build_plan';\nvar startable=external&&r.capability_available===true&&r.route==='deterministic';\nvar arid='req_'+(p.update_id||p.message_id||stamp.replace(/[^0-9]/g,''));\nvar rec={agent_request_id:arid,update_id:p.update_id,chat_id:p.chat_id,user_id:p.user_id,request_text:p.text,kind:p.kind,intent:intent.intent,requested_action:intent.requested_action,idempotency_key:p.idempotency_key,created_at:stamp,state:'received'};\nvar t=transition(rec,'classified',{ts:stamp});\nreturn [{json:{decision:'accepted',start_work:startable,external:external,request:rec,intent:intent,event:t.event,routed:r}}];"),
  sheetsRead('wf18-readmsg', 'Read conversation_messages', [100, 320], 'conversation_messages'),
  code('wf18-ctx', 'Build Conversation Context', [760, 0], ['conversation_memory'],
    "var d=$('Build Intake Decision').first().json;var r=d.routed;var cfg=r.cfg;var p=r.parsed||{};\nvar convId=(r.ctx&&r.ctx.conversation_id)||('conv_'+(p.chat_id||''));\nvar newest=String((d.request&&d.request.request_text)||p.text||'');\nvar msgs=[];try{msgs=($('Read conversation_messages').all()||[]).map(function(x){return x.json;}).filter(function(m){return String(m.conversation_id)===convId;});}catch(e){}\nmsgs=msgs.concat([{role:'user',message_id:p.message_id,text:newest}]);\nvar win=recentWindow(msgs,cfg.recent_window||8);\nvar summary_row=null;var did=false;\nif(shouldSummarize(msgs,cfg)){var older=msgs.slice(0,msgs.length-win.length);if(older.length){var sum=rollingSummary(null,older,{ts:(new Date()).toISOString()});summary_row={conversation_id:convId,version:sum.version,prev_version:sum.prev_version,text:sum.text,preserved_ids:(sum.preserved_ids||[]).join(','),covers_message_ids:(sum.covers_message_ids||[]).join(','),decisions:JSON.stringify(sum.decisions||[]),entities:(sum.entities||[]).join(','),unresolved:(sum.unresolved||[]).join(','),created_at:sum.created_at};did=true;}}\nvar recentText=win.map(function(m){return (m.role||'user')+': '+String(m.text||'');}).join('\\n');\nvar state='conv='+convId+' intent='+((d.intent&&d.intent.intent)||'')+' arid='+((d.request&&d.request.agent_request_id)||'');\nvar safety=cfg.require_approval!==false?'APPROVAL REQUIRED before paid/external work':'approval not required';\nvar sections={charter:r.charter,state:state,safety:safety,newest:newest,artifacts:'',recent:recentText,summary:summary_row?summary_row.text:'',summary_version:summary_row?summary_row.version:0};\nvar ctxRes=buildContext(sections,cfg);\nvar usage=contextUsageRecord(ctxRes,{conversation_id:convId,agent_request_id:(d.request&&d.request.agent_request_id)||'',ts:(new Date()).toISOString()});\nreturn [{json:{context:ctxRes,context_usage:usage,decision:d,conversation_id:convId,summary_row:summary_row,did_summarize:did}}];"),
  sheetsAppend('wf18-apreq', 'Append agent_requests', [980, -260], 'agent_requests'),
  sheetsAppend('wf18-apev', 'Append agent_request_events', [980, -120], 'agent_request_events'),
  sheetsAppend('wf18-apctx', 'Append context_usage', [980, 20], 'context_usage'),
  code('wf18-pmsg', 'Persist Message Row', [980, 160], [],
    "var c=$('Build Conversation Context').first().json;var d=c.decision;var r=d.routed;var p=r.parsed||{};\nreturn [{json:{conversation_id:c.conversation_id,message_id:p.message_id,role:'user',text:p.text,intent:(d.intent&&d.intent.intent)||'',created_at:(new Date()).toISOString(),archived:false}}];"),
  sheetsAppend('wf18-apmsg', 'Append conversation_messages', [1200, 160], 'conversation_messages'),
  code('wf18-pstate', 'Persist State Row', [980, 300], ['conversation_memory'],
    "var c=$('Build Conversation Context').first().json;var d=c.decision;var r=d.routed;var p=r.parsed||{};\nvar base=newConversationState(c.conversation_id,p.user_id);\nvar row=patchState(base,{chat_id:p.chat_id,active_agent_request_id:(d.request&&d.request.agent_request_id)||'',current_intent:(d.intent&&d.intent.intent)||'',current_state:(d.request&&d.request.state)||'received',pending_approval:!!(d.external&&d.start_work)},(new Date()).toISOString());\nreturn [{json:row}];"),
  sheetsUpsert('wf18-upstate', 'Upsert conversation_state', [1200, 300], 'conversation_state', 'conversation_id'),
  ifNode('wf18-ifsum', 'Summary Created?', [980, 440], '={{ $json.did_summarize }}'),
  code('wf18-shapesum', 'Shape Summary Row', [1200, 440], [],
    "var c=$('Build Conversation Context').first().json;return [{json:c.summary_row||{conversation_id:c.conversation_id}}];"),
  sheetsAppend('wf18-apsum', 'Append conversation_summaries', [1420, 440], 'conversation_summaries'),
  code('wf18-reply', 'Build Conversational Reply', [1200, 0], ['conversation_response', 'agent_charter'],
    "var c=$('Build Conversation Context').first().json;var d=c.decision;var r=d.routed;var cfg=r.cfg;\nvar chat=String((d.request&&d.request.chat_id)||(r.parsed&&r.parsed.chat_id)||'');\nvar caps=availableCapabilities(cfg);var text,kb=null;\nif(d.decision==='unauthorized'){text='Доступ запрещён.';}\nelse if(d.decision==='duplicate'){text='Запрос уже принят (дубликат обновления).';}\nelse if(r.route==='clarify'){text=clarificationReply(r.clarification);}\nelse if(d.external&&r.capability_available!==true){text='Это действие сейчас недоступно: '+((r.capability&&r.capability.unavailable_reason)||'нужна настройка источников')+'.';}\nelse if(d.external&&d.start_work){text=buildConversationalReply({understood:(r.capability&&r.capability.name)||d.intent.intent,next:'строю план и пришлю на подтверждение',requires_approval:true,source_scope:(cfg.source_allowlist||[]).join(', '),budget_ceiling:'\\u2264'+cfg.max_external_calls+' \\u0432\\u044b\\u0437\\u043e\\u0432\\u043e\\u0432, ~$'+cfg.source_budget_usd});kb=actionButtons(caps);}\nelse if(d.intent&&d.intent.intent==='help'){text=capabilityCatalogText(cfg);}\nelse{text=buildConversationalReply({understood:(r.capability&&r.capability.name)||(d.intent&&d.intent.intent),next:'готов помочь'});}\nvar body={chat_id:chat,text:text};if(kb)body.reply_markup=kb;\nreturn [{json:{telegram_send_body:JSON.stringify(body),decision:d.decision,intent:(d.intent&&d.intent.intent)||'clarify_request',start_work:d.start_work}}];"),
  httpTelegram('wf18-send', 'Send Telegram Reply', [1420, 0])
], [
  ['Telegram Webhook', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Parse Telegram Update'],
  ['Parse Telegram Update', 'Read agent_request_events'],
  ['Read agent_request_events', 'Read conversation_state'],
  ['Read conversation_state', 'Read conversation_messages'],
  ['Read conversation_messages', 'Route Intent'],
  ['Route Intent', 'Build Intake Decision'],
  ['Build Intake Decision', 'Build Conversation Context'],
  ['Build Conversation Context', 'Append agent_requests'],
  ['Build Conversation Context', 'Append agent_request_events'],
  ['Build Conversation Context', 'Append context_usage'],
  ['Build Conversation Context', 'Persist Message Row'],
  ['Persist Message Row', 'Append conversation_messages'],
  ['Build Conversation Context', 'Persist State Row'],
  ['Persist State Row', 'Upsert conversation_state'],
  ['Build Conversation Context', 'Summary Created?'],
  ['Summary Created?', 'Shape Summary Row', 0],
  ['Shape Summary Row', 'Append conversation_summaries'],
  ['Append agent_requests', 'Build Conversational Reply'],
  ['Build Conversational Reply', 'Send Telegram Reply']
]));

// =========================================================================================== WF22 control
// Conversational control plane: memory commands (/new, /context, /memory, /forget, /forget_all) and source
// management (add/list/pause/resume/remove/check). Per-user isolation + audit; no secrets stored.
write('22_conversation_control.json', wf('22 — Conversation Control & Sources', [
  manual('wf22-trig', 'Manual Start', [-560, 0]),
  code('wf22-cfg', 'Resolve Agent Config', [-340, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  sheetsRead('wf22-readmem', 'Read durable_memories', [-120, -120], 'durable_memories'),
  sheetsRead('wf22-readsrc', 'Read tracked_sources', [-120, 120], 'tracked_sources'),
  code('wf22-apply', 'Apply Control Command', [120, 0], ['conversation_memory', 'tracked_sources'],
    "var cfg=$('Resolve Agent Config').first().json;\nvar inp=$json||{};var owner=String(inp.owner_user_id||'');\nvar memories=[];try{memories=($('Read durable_memories').all()||[]).map(function(r){return r.json;});}catch(e){}\nvar sources=[];try{sources=($('Read tracked_sources').all()||[]).map(function(r){return r.json;});}catch(e){}\nvar ts=(new Date()).toISOString();\nvar out={domain:inp.domain,op:inp.op,owner_user_id:owner,chat_id:String(inp.chat_id||''),reply:'',memory_audit:[],source_audit:[],memories:memories,sources:sources};\nif(inp.domain==='memory'){\n if(inp.op==='memory'||inp.op==='view'){out.reply='\\u041f\\u0430\\u043c\\u044f\\u0442\\u044c: '+JSON.stringify(memoryView(memoriesForUser(memories,owner)));}\n else if(inp.op==='forget'){var f=forgetMemory(memories,inp.arg,{owner_user_id:owner,ts:ts});out.memories=f.memories;out.memory_audit=f.audit;out.reply=f.removed?('\\u0423\\u0434\\u0430\\u043b\\u0435\\u043d\\u043e: '+f.removed):'\\u041d\\u0435 \\u043d\\u0430\\u0448\\u0451\\u043b.';}\n else if(inp.op==='forget_all'){var fa=forgetAll(memories,{owner_user_id:owner,confirmed:inp.confirmed===true,ts:ts});if(!fa.ok){out.reply='\\u041f\\u043e\\u0434\\u0442\\u0432\\u0435\\u0440\\u0434\\u0438\\u0442\\u0435 \\u0443\\u0434\\u0430\\u043b\\u0435\\u043d\\u0438\\u0435.';}else{out.memories=fa.memories;out.memory_audit=fa.audit;out.reply='\\u041f\\u0430\\u043c\\u044f\\u0442\\u044c \\u043e\\u0447\\u0438\\u0449\\u0435\\u043d\\u0430 ('+fa.removed+').';}}\n else if(inp.op==='new'){out.reply='\\u041d\\u043e\\u0432\\u044b\\u0439 \\u043a\\u043e\\u043d\\u0442\\u0435\\u043a\\u0441\\u0442. \\u041f\\u0440\\u0435\\u0434\\u043f\\u043e\\u0447\\u0442\\u0435\\u043d\\u0438\\u044f \\u0441\\u043e\\u0445\\u0440\\u0430\\u043d\\u0435\\u043d\\u044b.';}\n else if(inp.op==='context'){out.reply='\\u041a\\u043e\\u043d\\u0442\\u0435\\u043a\\u0441\\u0442: '+(inp.arg||'(\\u043f\\u0443\\u0441\\u0442\\u043e)');}\n else{out.reply='\\u041a\\u043e\\u043c\\u0430\\u043d\\u0434\\u0430 \\u043f\\u0430\\u043c\\u044f\\u0442\\u0438 \\u043d\\u0435 \\u0440\\u0430\\u0441\\u043f\\u043e\\u0437\\u043d\\u0430\\u043d\\u0430.';}\n}else if(inp.domain==='source'){\n if(inp.op==='add'){var a=addSource(sources,inp.arg,{owner_user_id:owner,cfg:cfg,ts:ts});out.sources=a.sources;if(a.audit)out.source_audit=[a.audit];out.reply=a.added?('\\u0418\\u0441\\u0442\\u043e\\u0447\\u043d\\u0438\\u043a \\u0434\\u043e\\u0431\\u0430\\u0432\\u043b\\u0435\\u043d: '+a.source.label):('\\u041d\\u0435 \\u0434\\u043e\\u0431\\u0430\\u0432\\u043b\\u0435\\u043d: '+a.reason);}\n else if(inp.op==='list'){out.reply='\\u0418\\u0441\\u0442\\u043e\\u0447\\u043d\\u0438\\u043a\\u0438: '+JSON.stringify(listSources(sources,owner).map(function(s){return s.label+' ['+s.status+']';}));}\n else if(inp.op==='pause'||inp.op==='resume'||inp.op==='remove'){var st=inp.op==='pause'?'paused':(inp.op==='resume'?'active':'removed');var r2=setSourceStatus(sources,inp.arg,st,{owner_user_id:owner,ts:ts});out.sources=r2.sources;if(r2.audit)out.source_audit=[r2.audit];out.reply=r2.changed?('\\u0418\\u0441\\u0442\\u043e\\u0447\\u043d\\u0438\\u043a: '+inp.op):('\\u041d\\u0435 \\u0438\\u0437\\u043c\\u0435\\u043d\\u0435\\u043d\\u043e: '+r2.reason);}\n else if(inp.op==='check'){out.reply='\\u0421\\u0442\\u0430\\u0442\\u0443\\u0441: '+JSON.stringify(checkSource(sources,inp.arg,{owner_user_id:owner}));}\n else{out.reply='\\u041a\\u043e\\u043c\\u0430\\u043d\\u0434\\u0430 \\u0438\\u0441\\u0442\\u043e\\u0447\\u043d\\u0438\\u043a\\u043e\\u0432 \\u043d\\u0435 \\u0440\\u0430\\u0441\\u043f\\u043e\\u0437\\u043d\\u0430\\u043d\\u0430.';}\n}else{out.reply='\\u041d\\u0435\\u0438\\u0437\\u0432\\u0435\\u0441\\u0442\\u043d\\u044b\\u0439 \\u0434\\u043e\\u043c\\u0435\\u043d \\u043a\\u043e\\u043c\\u0430\\u043d\\u0434\\u044b.';}\nreturn [{json:out}];"),
  sheetsAppend('wf22-apmem', 'Append memory_audit_events', [340, -120], 'memory_audit_events'),
  sheetsAppend('wf22-apsrc', 'Append source_audit_events', [340, 120], 'source_audit_events'),
  code('wf22-reply', 'Build Control Reply', [560, 0], ['conversation_response'],
    "var o=$('Apply Control Command').first().json;\nvar chat=String(o.chat_id||'');\nvar body={chat_id:chat,text:clarificationReply(o.reply)};\nreturn [{json:{telegram_send_body:JSON.stringify(body),domain:o.domain,op:o.op}}];"),
  httpTelegram('wf22-send', 'Send Control Reply', [780, 0])
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Read durable_memories'],
  ['Read durable_memories', 'Read tracked_sources'],
  ['Read tracked_sources', 'Apply Control Command'],
  ['Apply Control Command', 'Append memory_audit_events'],
  ['Apply Control Command', 'Append source_audit_events'],
  ['Apply Control Command', 'Build Control Reply'],
  ['Build Control Reply', 'Send Control Reply']
]));

// =========================================================================================== WF19 planner
write('19_request_planner.json', wf('19 — Request Planner (deterministic + guarded Claude)', [
  manual('wf19-trig', 'Manual Start', [-480, 0]),
  code('wf19-cfg', 'Resolve Agent Config', [-260, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  code('wf19-det', 'Deterministic Plan', [-40, 0], ['request_planner'],
    "var cfg=$('Resolve Agent Config').first().json;\nvar text=String(($json&&($json.request_text||$json.text))||'');\nvar plan=deterministicPlan(text,cfg);\nreturn [{json:{request_text:text,plan:plan,cfg:cfg}}];"),
  code('wf19-guard', 'Planner LLM Guard', [180, 0], ['approval_gate'],
    "var j=$('Deterministic Plan').first().json;var cfg=j.cfg;\nvar approvalTok=String(($json&&$json.planner_approval_token)||'');\nvar enabled=cfg.enable_llm_planner===true;\nvar tokOk=approvalTok==='WF19_PLANNER_APPROVED';\nvar budgetOk=Number(cfg.llm_budget_usd)>=0.01;\nvar call_llm=enabled&&tokOk&&budgetOk;\nvar reason=!enabled?'planner_llm_disabled':(!tokOk?'planner_token_invalid':(!budgetOk?'over_llm_budget':'ok'));\nreturn [{json:Object.assign({},j,{call_llm:call_llm,llm_guard_reason:reason})}];"),
  ifNode('wf19-if', 'LLM Planner Enabled?', [400, 0], '={{ $json.call_llm }}'),
  code('wf19-prompt', 'Build Planner Prompt', [620, -120], ['request_planner'],
    "var j=$('Planner LLM Guard').first().json;\nif(j.call_llm!==true){throw new Error('planner budget/guard: refused');}\nvar facts={request_text:j.request_text,allowlist:j.cfg.source_allowlist,default_region:j.cfg.default_region,default_niche:j.cfg.default_niche,max_items:j.cfg.max_items_per_source};\nvar sys='Return ONLY strict JSON for an execution plan: {intent,niche,service,region,sources[],max_items,max_external_calls,expected_output}. Use only allowlisted sources.';\nvar body={model:'claude-sonnet-4-6',max_tokens:512,system:sys,messages:[{role:'user',content:JSON.stringify(facts)}]};\nreturn [{json:Object.assign({},j,{claude_request_body:JSON.stringify(body)})}];"),
  httpClaude('wf19-claude', 'Claude Planner API Request', [840, -120]),
  code('wf19-validate', 'Validate Plan', [1060, -120], ['request_planner'],
    "var j=$('Build Planner Prompt').first().json;var cfg=j.cfg;\nvar text='';try{var c=($json&&$json.content)||[];for(var i=0;i<c.length;i++){if(c[i]&&c[i].type==='text')text+=String(c[i].text||'');}}catch(e){}\nvar v=validatePlanJSON(text,cfg);\nvar plan=v.valid?v.plan:deterministicPlan(j.request_text,cfg);\nreturn [{json:{plan:plan,plan_valid:v.valid,plan_reason:v.reason,plan_source:plan.plan_source,cfg:cfg}}];"),
  code('wf19-approval', 'Build Approval Message', [840, 120], ['request_planner', 'telegram_io', 'scope_preview'],
    "var src;try{src=$('Validate Plan').first().json;}catch(e){src=$('Deterministic Plan').first().json;}\nvar plan=src.plan;var cfg=src.cfg||{};\nvar text=planToApprovalText(plan);\nvar arid=String(($json&&$json.agent_request_id)||'req_pending');\nvar kb=approvalKeyboard(arid);\n// scope + cost preview shown BEFORE approval (honest budgets; never a fabricated price)\nvar preview=buildScopePreview({goal:plan.intent||plan.expected_output,niche:plan.niche,region:plan.region,competitors:plan.competitors||[],platforms:plan.sources||['website'],cfg:cfg,refresh_plan:{expected_calls:Number(plan.max_external_calls)||0},expected_llm_calls:0,max_items:Number(plan.max_items)||undefined,outputs:{telegram_summary:true,xlsx:true,charts:true,evidence:true}});\nvar combined=preview.text+'\\n\\n'+text;\nreturn [{json:{plan:plan,plan_source:plan.plan_source,approval_text:text,scope_preview:preview,scope_preview_text:preview.text,combined_approval_text:combined,approval_keyboard:kb}}];")
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Deterministic Plan'],
  ['Deterministic Plan', 'Planner LLM Guard'],
  ['Planner LLM Guard', 'LLM Planner Enabled?'],
  ['LLM Planner Enabled?', 'Build Planner Prompt', 0],
  ['LLM Planner Enabled?', 'Build Approval Message', 1],
  ['Build Planner Prompt', 'Claude Planner API Request'],
  ['Claude Planner API Request', 'Validate Plan'],
  ['Validate Plan', 'Build Approval Message']
]));

// =========================================================================================== WF20 orchestrator
write('20_agent_orchestrator.json', wf('20 — Agent Orchestrator (approval→collect→WF16→WF08→WF10→WF12→deliver)', [
  manual('wf20-trig', 'Manual Start', [-940, 0]),
  code('wf20-cfg', 'Resolve Agent Config', [-720, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  code('wf20-reuse', 'Orchestration Reuse Decision', [-500, 0], ['orchestration_policy'],
    "var cfg=$('Resolve Agent Config').first().json;\nvar inp=$json||{};\nvar intent=inp.intent||{intent:(inp.request&&inp.request.intent)||'competitor_search',entities:inp.entities||{}};\nvar ctx=inp.ctx||{};\nvar dec=reuseDecision({intent:intent,ctx:ctx,cfg:cfg,now:(new Date()).toISOString()});\nvar rec=decisionRecord(dec,{agent_request_id:(inp.request&&inp.request.agent_request_id)||'req',conversation_id:ctx.conversation_id||'',intent:intent.intent,ts:(new Date()).toISOString()});\nreturn [{json:Object.assign({},inp,{reuse_decision:dec,needs_external_call:dec.needs_external_call,orchestration_decision:rec,cfg:cfg})}];"),
  sheetsAppend('wf20-apdec', 'Append orchestration_decisions', [-500, 180], 'orchestration_decisions'),
  ifNode('wf20-needext', 'Needs External Call?', [-380, 0], '={{ $json.needs_external_call }}'),
  code('wf20-reuseresp', 'Build Reuse Response', [-160, 200], ['conversation_response'],
    "var inp=$json||{};var dec=inp.reuse_decision||{};\nvar chat=String((inp.request&&inp.request.chat_id)||'');\nvar text=buildConversationalReply({understood:(inp.intent&&inp.intent.intent)||'follow-up',result:'\\u041e\\u0442\\u0432\\u0435\\u0447\\u0430\\u044e \\u043f\\u043e \\u0443\\u0436\\u0435 \\u0441\\u043e\\u0431\\u0440\\u0430\\u043d\\u043d\\u044b\\u043c \\u0434\\u0430\\u043d\\u043d\\u044b\\u043c (\\u0431\\u0435\\u0437 \\u043d\\u043e\\u0432\\u044b\\u0445 \\u043f\\u043b\\u0430\\u0442\\u043d\\u044b\\u0445 \\u0432\\u044b\\u0437\\u043e\\u0432\\u043e\\u0432). \\u041f\\u0440\\u0438\\u0447\\u0438\\u043d\\u0430: '+(dec.reason||'reuse')+'.',next:'\\u043c\\u043e\\u0433\\u0443 \\u043f\\u043e\\u0434\\u0433\\u043e\\u0442\\u043e\\u0432\\u0438\\u0442\\u044c \\u0438\\u0434\\u0435\\u0438 \\u0438\\u043b\\u0438 \\u0441\\u0440\\u0430\\u0432\\u043d\\u0435\\u043d\\u0438\\u0435'});\nvar body={chat_id:chat,text:text};\nreturn [{json:{telegram_send_body:JSON.stringify(body),reuse_reason:dec.reason}}];"),
  httpTelegram('wf20-sendreuse', 'Send Reuse Reply', [60, 200]),
  code('wf20-gate', 'Approval & Budget Gate', [-160, -40], ['approval_gate', 'agent_state'],
    "var cfg=$('Resolve Agent Config').first().json;\nvar req=($json&&$json.request)?$json.request:($json||{});\nvar plan=($json&&$json.plan)?$json.plan:{source:'website',est_items:cfg.max_items_per_source,est_external_calls:5,est_source_cost_usd:0.05,est_llm_cost_usd:0.10};\nplan.source=plan.source||(plan.sources&&plan.sources[0])||'website';\nvar ctx={agent_request_id:req.agent_request_id||'req',state:req.state||'approved',approved:req.approved===true||req.state==='approved',cancelled:req.state==='cancelled'||req.cancelled===true,completed_keys:req.completed_keys||[],external_calls_made:0,source_spend_usd:0,llm_spend_usd:0};\nvar canCall=canMakeExternalCall(ctx.state);\nvar g=evaluateGate(plan,ctx,cfg);\nvar allowed=g.allowed&&canCall;\nreturn [{json:{gate_allowed:allowed,gate_reason:allowed?'ok':(g.reason||'state_blocks_external_call'),idempotency_key:g.idempotency_key,plan:plan,request:req,cfg:cfg}}];"),
  ifNode('wf20-if', 'Gate Allowed?', [-40, 0], '={{ $json.gate_allowed }}'),
  execWf('wf20-wf04', 'Run Website Source (WF04)', [180, -160], 'WF04 firecrawl url list', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Approval & Budget Gate').first().json.idempotency_key }}",
    workflow_run_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    data_mode: "={{ $('Approval & Budget Gate').first().json.request.data_mode || 'live' }}",
    urls: "={{ $('Approval & Budget Gate').first().json.request.urls || [] }}"
  }),
  code('wf20-norm', 'Normalize Adapter Result', [400, -160], ['source_adapter'],
    "var g=$('Approval & Budget Gate').first().json;\nvar raw=($json&&$json.live_source_run)?$json.live_source_run:($json||{});\nvar res=normalizeAdapterResult('website',raw,{agent_request_id:g.request.agent_request_id});\nreturn [{json:{adapter:res,plan:g.plan,request:g.request,cfg:g.cfg}}];"),
  execWf('wf20-wf16', 'Run WF16 Quality Gate', [620, -160], 'WF16 source quality gate', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Approval & Budget Gate').first().json.idempotency_key }}",
    data_mode: "={{ $('Approval & Budget Gate').first().json.request.data_mode || 'live' }}",
    platform_filter: 'website'
  }),
  execWf('wf20-wf08', 'Run WF08 Analyzer', [840, -160], 'WF08 touchpoint analyzer', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Approval & Budget Gate').first().json.idempotency_key }}",
    data_mode: "={{ $('Approval & Budget Gate').first().json.request.data_mode || 'live' }}"
  }),
  execWf('wf20-wf10', 'Run WF10 Aggregator', [1060, -160], 'WF10 audience aggregator', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Approval & Budget Gate').first().json.idempotency_key }}",
    data_mode: "={{ $('Approval & Budget Gate').first().json.request.data_mode || 'live' }}"
  }),
  execWf('wf20-wf12', 'Run WF12 Report', [1280, -160], 'WF12 report builder', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    data_mode: "={{ $('Approval & Budget Gate').first().json.request.data_mode || 'live' }}"
  }),
  code('wf20-summary', 'Build Execution Summary', [1500, -160], ['source_adapter', 'execution_summary'],
    "var n=$('Normalize Adapter Result').first().json;\nvar adapters=[n.adapter];\nvar roll=rollupCollection(adapters);\nvar rep=($json&&$json.report)?$json.report:($json||{});\nvar summary=buildExecutionSummary({config_complete:(n.cfg&&n.cfg.config_complete),request:Object.assign({},n.request,{state:roll.outcome==='no_data'?'partial':(roll.outcome==='complete'?'reporting':'partial')}),plan:n.plan,collection:roll,adapters:adapters,analysis:{records_unique:rep.records_unique,records_eligible:rep.records_eligible,records_analyzed:rep.records_analyzed,llm_primary_calls:rep.llm_primary_calls,llm_repair_calls:rep.llm_repair_calls,llm_cost_status:rep.llm_cost_status||'unknown'},aggregation:{rows_after_filters:rep.rows_after_filters},report:rep,delivery:{}});\nreturn [{json:{summary:summary,report:rep,request:n.request,cfg:n.cfg}}];"),
  code('wf20-outbox', 'Build Delivery Outbox', [1720, -160], ['telegram_io', 'conversation_response', 'agent_charter'],
    "var s=$('Build Execution Summary').first().json;\nvar cfg=s.cfg||{};\nvar caps=availableCapabilities(cfg);\nvar chat=String((s.request&&s.request.chat_id)||'');\nvar state=String((s.summary&&s.summary.final_state)||'completed');\nvar noData=Number((s.summary&&s.summary.records_reported)||0)===0&&state!=='completed';\nvar stateForActions=noData?'no_data':state;\nvar report=s.report||{};\nvar body=deliveryBody({report_markdown:report.report_markdown,summary_text:report.summary_text},s.summary,caps);\nvar ptxt=proactiveText(stateForActions,caps);\nvar dlv=makeDelivery((s.request&&s.request.agent_request_id)||'req',(report.report_id)||'rep',chat,body);\nvar chunks=chunkMessage(body);\nvar kb=proactiveKeyboard(stateForActions,caps);\nvar bodies=chunks.map(function(t,i){var b={chat_id:chat,text:t};if(i===chunks.length-1&&kb)b.reply_markup=kb;return b;});\nreturn [{json:{delivery:dlv,telegram_send_body:JSON.stringify(bodies[0]),telegram_send_bodies:JSON.stringify(bodies),final_keyboard:kb?JSON.stringify(kb):'',chunk_count:chunks.length,proactive_text:ptxt,summary:s.summary}}];"),
  sheetsAppend('wf20-apout', 'Append telegram_outbox', [1940, -160], 'telegram_outbox'),
  httpTelegram('wf20-send', 'Send Telegram Report', [2160, -160]),
  code('wf20-shapesum', 'Shape Execution Summary Row', [1500, 60], [],
    "var s=$('Build Execution Summary').first().json;return [{json:s.summary}];"),
  sheetsAppend('wf20-apsum', 'Append execution_summaries', [1720, 60], 'execution_summaries'),
  code('wf20-blocked', 'Build Blocked Response', [180, 160], ['telegram_io'],
    "var g=$('Approval & Budget Gate').first().json;\nvar chat=String((g.request&&g.request.chat_id)||'');\nvar body={chat_id:chat,text:'Запрос не запущен: '+g.gate_reason};\nreturn [{json:{telegram_send_body:JSON.stringify(body),gate_reason:g.gate_reason}}];"),
  httpTelegram('wf20-sendblock', 'Send Blocked Reply', [400, 160]),
  // one progress message per request (created here; later stages EDIT the same message id; final report is a
  // SEPARATE idempotent delivery via the outbox). Runs as a parallel branch off the allowed gate.
  code('wf20-progress', 'Build Progress Update', [180, -300], ['progress_tracker'],
    "var g=$('Approval & Budget Gate').first().json;\nvar chat=String((g.request&&g.request.chat_id)||'');\nvar st=initProgress({agent_request_id:(g.request&&g.request.agent_request_id)||'req',chat_id:chat});\nvar up=advance(st,2,{now:(new Date()).toISOString()});\nvar body={chat_id:chat,text:up.text};\nreturn [{json:{telegram_send_body:JSON.stringify(body),progress_state:up.state,progress_action:up.action,is_final_delivery:up.is_final_delivery}}];"),
  httpTelegram('wf20-sendprogress', 'Send Progress', [400, -300])
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Orchestration Reuse Decision'],
  ['Orchestration Reuse Decision', 'Append orchestration_decisions'],
  ['Append orchestration_decisions', 'Needs External Call?'],
  ['Needs External Call?', 'Approval & Budget Gate', 0],
  ['Needs External Call?', 'Build Reuse Response', 1],
  ['Build Reuse Response', 'Send Reuse Reply'],
  ['Approval & Budget Gate', 'Gate Allowed?'],
  ['Gate Allowed?', 'Run Website Source (WF04)', 0],
  ['Gate Allowed?', 'Build Progress Update', 0],
  ['Build Progress Update', 'Send Progress'],
  ['Gate Allowed?', 'Build Blocked Response', 1],
  ['Run Website Source (WF04)', 'Normalize Adapter Result'],
  ['Normalize Adapter Result', 'Run WF16 Quality Gate'],
  ['Run WF16 Quality Gate', 'Run WF08 Analyzer'],
  ['Run WF08 Analyzer', 'Run WF10 Aggregator'],
  ['Run WF10 Aggregator', 'Run WF12 Report'],
  ['Run WF12 Report', 'Build Execution Summary'],
  ['Build Execution Summary', 'Build Delivery Outbox'],
  ['Build Execution Summary', 'Shape Execution Summary Row'],
  ['Shape Execution Summary Row', 'Append execution_summaries'],
  ['Build Delivery Outbox', 'Append telegram_outbox'],
  ['Append telegram_outbox', 'Send Telegram Report'],
  ['Build Blocked Response', 'Send Blocked Reply']
]));

// =========================================================================================== WF21 deep analysis
// Bounded deep competitor analysis: build an explicit, approval-gated plan that degrades gracefully across only
// the configured sources; collect; separate evidence-backed FACTS from RECOMMENDATIONS; deliver.
write('21_deep_competitor_analysis.json', wf('21 — Deep Competitor Analysis (bounded, evidence-based)', [
  manual('wf21-trig', 'Manual Start', [-820, 0]),
  code('wf21-cfg', 'Resolve Agent Config', [-600, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  sheetsRead('wf21-readsrc', 'Read tracked_sources', [-380, 160], 'tracked_sources'),
  code('wf21-plan', 'Build Deep Plan', [-160, 0], ['deep_analysis', 'agent_charter'],
    "var cfg=$('Resolve Agent Config').first().json;\nvar inp=$json||{};\nvar tracked=[];try{tracked=($('Read tracked_sources').all()||[]).map(function(r){return r.json;});}catch(e){}\nvar plan=buildDeepPlan({competitors:inp.competitors||[],requested_platforms:inp.requested_platforms||['website'],cfg:cfg,history_available:inp.history_available===true,tracked_sources:tracked});\nvar caps=availableCapabilities(cfg);var cap=null;for(var i=0;i<caps.length;i++){if(caps[i].id==='deep_competitor_analysis')cap=caps[i];}\nvar req=inp.request||{agent_request_id:inp.agent_request_id||'req',chat_id:inp.chat_id,state:inp.state||'approved',approved:inp.approved===true||inp.state==='approved'};\nreturn [{json:{deep_plan:plan,capability:cap,capability_available:cap?cap.available:true,request:req,cfg:cfg}}];"),
  code('wf21-gate', 'Deep Approval & Budget Gate', [60, 0], ['approval_gate', 'agent_state'],
    "var j=$('Build Deep Plan').first().json;var cfg=j.cfg;var dp=j.deep_plan;var req=j.request;\nvar gplan={source:(dp.selected_platforms&&dp.selected_platforms[0])||'website',attempt:1,est_items:dp.page_limit_per_competitor*Math.max(1,(dp.selected_competitors||[]).length),est_external_calls:dp.est_external_calls,est_source_cost_usd:dp.est_source_budget_usd,est_llm_cost_usd:dp.est_llm_budget_usd};\nvar ctx={agent_request_id:req.agent_request_id,state:req.state||'approved',approved:req.approved===true||req.state==='approved',cancelled:req.state==='cancelled',completed_keys:req.completed_keys||[],external_calls_made:0,source_spend_usd:0,llm_spend_usd:0};\nvar canCall=canMakeExternalCall(ctx.state);var g=evaluateGate(gplan,ctx,cfg);\nvar allowed=g.allowed&&canCall&&j.capability_available===true;\nreturn [{json:{gate_allowed:allowed,gate_reason:allowed?'ok':(g.reason||(j.capability_available!==true?'capability_unavailable':'state_blocks_external_call')),deep_plan:dp,request:req,cfg:cfg}}];"),
  ifNode('wf21-if', 'Deep Gate Allowed?', [280, 0], '={{ $json.gate_allowed }}'),
  execWf('wf21-wf04', 'Collect Deep Evidence (WF04)', [500, -160], 'WF04 multi-page firecrawl', {
    agent_request_id: "={{ $('Deep Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Deep Approval & Budget Gate').first().json.request.agent_request_id }}",
    data_mode: "={{ $('Deep Approval & Budget Gate').first().json.request.data_mode || 'live' }}"
  }),
  code('wf21-assemble', 'Assemble Deep Report', [720, -160], ['deep_analysis'],
    "var g=$('Deep Approval & Budget Gate').first().json;\nvar inp=$json||{};\nvar comp=(g.deep_plan.selected_competitors&&g.deep_plan.selected_competitors[0])||'';\nvar report=assembleDeepReport(comp,inp.findings||[],inp.recommendations||[]);\nreturn [{json:{deep_report:report,deep_plan:g.deep_plan,request:g.request,cfg:g.cfg}}];"),
  sheetsAppend('wf21-apf', 'Append deep_analysis_findings', [940, -260], 'deep_analysis_findings'),
  sheetsAppend('wf21-apr', 'Append deep_analysis_recommendations', [940, -60], 'deep_analysis_recommendations'),
  code('wf21-reply', 'Build Deep Reply', [1160, -160], ['conversation_response'],
    "var d=$('Assemble Deep Report').first().json;var rep=d.deep_report;\nvar chat=String((d.request&&d.request.chat_id)||'');\nvar text=postReportReply({summary_text:'\\u0413\\u043b\\u0443\\u0431\\u043e\\u043a\\u0438\\u0439 \\u0430\\u043d\\u0430\\u043b\\u0438\\u0437: '+rep.competitor+'. \\u0424\\u0430\\u043a\\u0442\\u043e\\u0432: '+rep.fact_count+', \\u0440\\u0435\\u043a\\u043e\\u043c\\u0435\\u043d\\u0434\\u0430\\u0446\\u0438\\u0439: '+rep.recommendation_count+'.',ideas:rep.recommendations.map(function(r){return r.text;}),limitations:(d.deep_plan.unavailable_sources||[]).map(function(u){return u.platform+': '+u.reason;})},[]);\nvar body={chat_id:chat,text:text};\nreturn [{json:{telegram_send_body:JSON.stringify(body),fact_count:rep.fact_count,recommendation_count:rep.recommendation_count}}];"),
  httpTelegram('wf21-send', 'Send Deep Report', [1380, -160]),
  code('wf21-blocked', 'Build Deep Blocked Reply', [500, 160], ['conversation_response'],
    "var g=$('Deep Approval & Budget Gate').first().json;\nvar chat=String((g.request&&g.request.chat_id)||'');\nvar body={chat_id:chat,text:clarificationReply('\\u0413\\u043b\\u0443\\u0431\\u043e\\u043a\\u0438\\u0439 \\u0430\\u043d\\u0430\\u043b\\u0438\\u0437 \\u043d\\u0435 \\u0437\\u0430\\u043f\\u0443\\u0449\\u0435\\u043d: '+g.gate_reason+'.')};\nreturn [{json:{telegram_send_body:JSON.stringify(body),gate_reason:g.gate_reason}}];"),
  httpTelegram('wf21-sendblock', 'Send Deep Blocked', [720, 160])
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Read tracked_sources'],
  ['Read tracked_sources', 'Build Deep Plan'],
  ['Build Deep Plan', 'Deep Approval & Budget Gate'],
  ['Deep Approval & Budget Gate', 'Deep Gate Allowed?'],
  ['Deep Gate Allowed?', 'Collect Deep Evidence (WF04)', 0],
  ['Deep Gate Allowed?', 'Build Deep Blocked Reply', 1],
  ['Collect Deep Evidence (WF04)', 'Assemble Deep Report'],
  ['Assemble Deep Report', 'Append deep_analysis_findings'],
  ['Append deep_analysis_findings', 'Append deep_analysis_recommendations'],
  ['Append deep_analysis_recommendations', 'Build Deep Reply'],
  ['Build Deep Reply', 'Send Deep Report'],
  ['Build Deep Blocked Reply', 'Send Deep Blocked']
]));

// =========================================================================================== WF23 scheduled monitor
// Real Schedule Trigger (active=false in repo). Picks DUE active sources, checks each through the collector
// that genuinely exists, detects a meaningful change via content hash, updates lifecycle fields, persists a
// change event BEFORE notifying, and notifies exactly once. Telegram/VK without a configured collector are
// honestly left setup_required. A manual "check now" path reuses the same contract with a different window.
write('23_scheduled_source_monitor.json', wf('23 — Scheduled Tracked Source Monitor', [
  scheduleTrigger('wf23-sched', 'Every 6h Schedule', [-1000, -80], 6),
  manual('wf23-manual', 'Manual Check Now', [-1000, 140]),
  code('wf23-stick', 'Scheduled Tick', [-780, -80], [], "return [{json:{mode:'scheduled'}}];"),
  code('wf23-mtick', 'Manual Mode Tick', [-780, 140], [], "return [{json:{mode:'manual'}}];"),
  code('wf23-cfg', 'Resolve Agent Config', [-560, 0], ['agent_config'],
    ENV + "\nvar mode=($json&&$json.mode)||'scheduled';\nvar cfg=resolveConfig(__env);cfg.mode=mode;\nreturn [{json:cfg}];"),
  sheetsRead('wf23-readsrc', 'Read tracked_sources', [-340, -120], 'tracked_sources'),
  sheetsRead('wf23-readchg', 'Read source_change_events', [-340, 120], 'source_change_events'),
  code('wf23-due', 'Select Due Sources', [-120, 0], ['tracked_sources', 'source_monitor'],
    "var cfg=$('Resolve Agent Config').first().json;var mode=cfg.mode||'scheduled';\nvar now=(new Date()).toISOString();\nvar sources=[];try{sources=($('Read tracked_sources').all()||[]).map(function(r){return r.json;});}catch(e){}\nvar active=sources.filter(function(s){return String(s.status)!=='removed';});\nvar part=dueSources(active,now,cfg,mode);\nvar win=checkWindow(now,cfg.monitor_interval_hours||24,mode);\nvar cap=Number(cfg.max_external_calls||40);\nvar items=part.due.slice(0,cap).map(function(s){return {json:{source:s,mode:mode,now:now,check_window:win,idempotency_key:checkIdempotencyKey(s.source_id,win),cfg:cfg}};});\nif(!items.length)items=[{json:{source:null,mode:mode,now:now,skipped:part.skipped.length,cfg:cfg}}];\nreturn items;"),
  execWf('wf23-wf04', 'Run Website Check (WF04)', [100, -160], 'WF04 website collection + WF16 quality', {
    agent_request_id: "={{ ($json.source && $json.source.agent_request_id) || '' }}",
    source_run_id: "={{ $json.idempotency_key }}",
    data_mode: "={{ ($json.cfg && $json.cfg.data_mode) || 'live' }}",
    urls: "={{ $json.source && $json.source.ref ? [$json.source.ref] : [] }}"
  }),
  code('wf23-detect', 'Check & Detect Change', [320, 0], ['source_monitor'],
    "var inp=$json||{};var src=inp.source;\nif(!src){return [{json:{no_due:true,needs_notification:false}}];}\nvar cfg=inp.cfg||{};var now=inp.now||(new Date()).toISOString();\nvar fetched=inp.fetched||inp.content||{};\nvar res={ok:fetched.ok!==false,fields:fetched.fields||{},hash:fetched.hash,error:fetched.error};\nvar applied=applyCheckResult(src,res,now,cfg);\nvar evs=[];try{evs=($('Read source_change_events').all()||[]).map(function(r){return r.json;});}catch(e){}\nvar change=null,needs=false,reason='no_change';\nif(applied.changed){var ev=makeChangeEvent(applied.source,applied.prev_hash,applied.new_hash,fetched.summary||'обновление контента',now);var sn=shouldNotifyChange(evs,ev);change=ev;needs=sn.notify;reason=sn.notify?'changed':sn.reason;}\nreturn [{json:Object.assign({},applied.source,{changed:applied.changed,needs_notification:needs,notify_reason:reason,change_event:change})}];"),
  sheetsAppend('wf23-upsrc', 'Update tracked_sources', [540, 0], 'tracked_sources'),
  ifNode('wf23-if', 'Meaningful Change?', [760, 0], '={{ $json.needs_notification }}'),
  code('wf23-notif', 'Build Change Notification', [980, -120], ['source_monitor', 'conversation_response', 'agent_charter'],
    "var s=$('Check & Detect Change').first().json;\nvar cfg=$('Resolve Agent Config').first().json;\nvar caps=availableCapabilities(cfg);\nvar ev=s.change_event||{};\nvar chat=String(s.chat_id||s.owner_user_id||'');\nvar text=changeNotificationText(s,ev);\nvar kb=changeNotificationKeyboard(caps);\nvar body={chat_id:chat,text:text};if(kb)body.reply_markup=kb;\nreturn [{json:Object.assign({},ev,{telegram_send_body:JSON.stringify(body),notif_keyboard:kb?JSON.stringify(kb):''})}];"),
  sheetsAppend('wf23-apchg', 'Append source_change_events', [1200, -120], 'source_change_events'),
  httpTelegram('wf23-send', 'Send Change Notification', [1420, -120]),
  code('wf23-nochg', 'No Change — Skip', [980, 140], [], "return [{json:{skipped:true,reason:($json&&$json.notify_reason)||'no_change'}}];"),
  // VK tracked sources are checked through the dedicated WF26 collector, which self-gates by platform +
  // credential (a non-VK ref or a missing token => setup_required, no spend). Parallel branch off due sources.
  execWf('wf23-wf26', 'Run VK Check (WF26)', [100, 320], 'WF26 VK public community collector', {
    owner_user_id: "={{ ($json.source && $json.source.owner_user_id) || '' }}",
    agent_request_id: "={{ ($json.source && $json.source.agent_request_id) || '' }}",
    source_run_id: "={{ $json.idempotency_key }}",
    community: "={{ ($json.source && $json.source.platform === 'vk_community') ? $json.source.ref : '' }}",
    data_mode: "={{ ($json.cfg && $json.cfg.data_mode) || 'live' }}",
    mode: "={{ $json.mode || 'scheduled' }}"
  })
], [
  ['Every 6h Schedule', 'Scheduled Tick'],
  ['Select Due Sources', 'Run VK Check (WF26)'],
  ['Manual Check Now', 'Manual Mode Tick'],
  ['Scheduled Tick', 'Resolve Agent Config'],
  ['Manual Mode Tick', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Read tracked_sources'],
  ['Read tracked_sources', 'Read source_change_events'],
  ['Read source_change_events', 'Select Due Sources'],
  ['Select Due Sources', 'Run Website Check (WF04)'],
  ['Run Website Check (WF04)', 'Check & Detect Change'],
  ['Check & Detect Change', 'Update tracked_sources'],
  ['Update tracked_sources', 'Meaningful Change?'],
  ['Meaningful Change?', 'Build Change Notification', 0],
  ['Meaningful Change?', 'No Change — Skip', 1],
  ['Build Change Notification', 'Append source_change_events'],
  ['Append source_change_events', 'Send Change Notification']
]));

// =========================================================================================== WF24 reporting
// Report export, filtering, comparison, smart refresh, evidence + Telegram document/photo delivery. Operates on
// a STORED report bundle, strictly scoped by (owner_user_id, agent_request_id, report_id). Builds scoped CSV +
// real XLSX (zlib) + deterministic chart, persists an attachment outbox row (dedup), and uploads via
// sendDocument/sendPhoto. One progress message. NO external collection here ($0). Manual + callable.
write('24_report_export_delivery.json', wf('24 — Report Export, Filter, Compare, Refresh & Delivery', [
  manual('wf24-trig', 'Manual Start', [-1100, 0]),
  subTrigger('wf24-sub', 'When Called by Agent', [-1100, 220], ['owner_user_id', 'agent_request_id', 'report_id', 'action', 'filter_text', 'data_mode']),
  code('wf24-cfg', 'Resolve Agent Config', [-880, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  sheetsRead('wf24-readrep', 'Read report_bundles', [-660, -120], 'report_bundles'),
  sheetsRead('wf24-readout', 'Read attachment_outbox', [-660, 120], 'attachment_outbox'),
  code('wf24-scope', 'Select & Scope Report', [-440, 0], ['report_export'], `
var cfg=$('Resolve Agent Config').first().json;
var inp=$json||{};
var owner=String(inp.owner_user_id||'');var arid=String(inp.agent_request_id||'');var rid=String(inp.report_id||'');
var action=String(inp.action||'export');var filter_text=String(inp.filter_text||'');
function J(v){try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return v;}}
var rows=[];try{rows=($('Read report_bundles').all()||[]).map(function(r){return r.json;});}catch(e){}
var match=null;
for(var i=0;i<rows.length;i++){var b=J(rows[i].bundle||rows[i].report_bundle||rows[i]);if(b&&String(b.report_id)===rid&&String(b.owner_user_id)===owner){match=b;break;}}
if(!match&&inp.report_bundle)match=J(inp.report_bundle);
if(!match)throw new Error('report not found / out of scope: '+owner+'/'+arid+'/'+rid);
var scope={owner_user_id:owner||String(match.owner_user_id),agent_request_id:arid||String(match.agent_request_id),report_id:rid||String(match.report_id)};
assertScope(match,scope);
return [{json:{bundle:match,scope:scope,action:action,filter_text:filter_text,cfg:cfg}}];`),
  code('wf24-preview', 'Build Scope Preview', [-220, 0], ['scope_preview'], `
var s=$('Select & Scope Report').first().json;var b=s.bundle;var cfg=s.cfg||{};
var comps=(b.competitors||[]).map(function(c){return c.competitor;});
var preview=buildScopePreview({goal:'Экспорт/анализ отчёта '+b.report_id,niche:b.niche,region:b.region,competitors:comps,platforms:['website'],cfg:cfg,refresh_plan:{expected_calls:0,reused:comps},expected_llm_calls:0,outputs:{telegram_summary:true,xlsx:true,charts:true,evidence:true}});
return [{json:Object.assign({},s,{scope_preview:preview,scope_preview_text:preview.text})}];`),
  code('wf24-progress', 'Init Progress', [0, -160], ['progress_tracker'], `
var s=$('Build Scope Preview').first().json;var chat=String(s.scope&&s.scope.owner_user_id||'');
var st=initProgress({agent_request_id:s.scope.agent_request_id,chat_id:chat});
var up=advance(st,8,{now:(new Date()).toISOString()});
return [{json:Object.assign({},s,{telegram_send_body:JSON.stringify({chat_id:chat,text:up.text}),progress_state:up.state,is_final_delivery:up.is_final_delivery})}];`),
  httpTelegram('wf24-sendprog', 'Send Progress', [220, -160]),
  code('wf24-apply', 'Apply Action', [0, 40], ['report_export', 'evidence', 'report_compare', 'report_filter', 'refresh_policy'], `
var s=$('Build Scope Preview').first().json;var b=s.bundle;var scope=s.scope;var cfg=s.cfg||{};
var action=s.action;var out={action:action,external_calls:0};
function J(v){try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return v;}}
if(action==='filter'){var pf=parseFilter(s.filter_text,(b.competitors||[]).map(function(c){return c.competitor;}));out.filter=pf;out.filtered=pf.ok?applyFilter(b,pf.filters,pf.sort):null;}
else if(action==='evidence'){out.evidence=queryEvidence(b,{text:s.filter_text},scope,cfg);}
else if(action==='compare'){var cands=[];try{cands=($('Read report_bundles').all()||[]).map(function(r){return J(r.json.bundle||r.json.report_bundle||r.json);}).filter(function(x){return x&&String(x.owner_user_id)===String(scope.owner_user_id)&&String(x.report_id)!==String(scope.report_id);});}catch(e){}var base=selectBaseline(b,cands,cfg);out.baseline=base.baseline||null;out.baseline_reason=base.reason;out.comparison=base.baseline?compareReports(b,base.baseline):null;}
else if(action==='refresh'){var srcs=(b.source_quality||[]).map(function(q){return {source_id:q.source,owner_user_id:scope.owner_user_id,platform:q.platform,ref:q.source,status:'active',last_status:q.error?'error':'ok',last_success_at:q.last_success_at,last_collected_at:q.last_collected_at,fields:{hash:'h'}};});out.refresh_plan=planRefresh(srcs,{cfg:cfg,now:(new Date()).toISOString(),only_stale:true});}
return [{json:Object.assign({},s,{result:out})}];`),
  code('wf24-exports', 'Build Exports & Outbox', [220, 40], ['report_export', 'xlsx_writer', 'report_package', 'report_charts', 'telegram_io'], `
var s=$('Apply Action').first().json;var b=s.bundle;var scope=s.scope;
var csv=exportCsv(b,'report',scope);
var pkg=buildReportPackage(b,scope);
var chart=renderChart(b,'competitor_score',scope);
var existing=[];try{existing=($('Read attachment_outbox').all()||[]).map(function(r){return r.json;});}catch(e){}
var xlsxDeliv=attachmentDelivery(scope,'xlsx',pkg.size_bytes+'|'+pkg.sheet_names.join(','));
var csvDeliv=attachmentDelivery(scope,'csv',csv.content);
var chartDeliv=attachmentDelivery(scope,'chart',chart.svg||chart.title||'chart');
var xlsxSend=shouldSendAttachment(existing,xlsxDeliv);var chartSend=shouldSendAttachment(existing,chartDeliv);
var json={scope:scope,csv_filename:csv.filename,csv_row_count:csv.row_count,xlsx_filename:pkg.filename,xlsx_size:pkg.size_bytes,xlsx_sheets:pkg.sheet_names,chart_title:chart.title,chart_insufficient:!!chart.insufficient_data,chat_id:String(scope.owner_user_id||''),caption:'Отчёт '+b.report_id,attachment_deliveries:[xlsxDeliv,csvDeliv,chartDeliv],xlsx_should_send:xlsxSend.send,chart_should_send:chartSend.send,external_calls:0};
return [{json:json,binary:{attachment:{data:Buffer.from(pkg.buffer).toString('base64'),fileName:pkg.filename,mimeType:pkg.mime},chart:{data:Buffer.from(String(chart.svg||''),'utf8').toString('base64'),fileName:'chart.svg',mimeType:'image/svg+xml'}}}];`),
  httpTelegramFile('wf24-senddoc', 'Send Document', [440, -60], 'sendDocument', 'document', 'attachment'),
  httpTelegramFile('wf24-sendchart', 'Send Chart', [440, 120], 'sendPhoto', 'photo', 'chart'),
  code('wf24-outrows', 'Shape Attachment Outbox', [440, 280], [], `
var e=$('Build Exports & Outbox').first().json;
return (e.attachment_deliveries||[]).map(function(d){return {json:d};});`),
  sheetsAppend('wf24-apout', 'Append attachment_outbox', [660, 280], 'attachment_outbox'),
  code('wf24-reply', 'Build Result Reply', [660, 40], [], `
var s=$('Apply Action').first().json;var e=$('Build Exports & Outbox').first().json;var r=s.result||{};
var chat=String(s.scope.owner_user_id||'');
var lines=['Готово по отчёту '+s.bundle.report_id+':'];
if(r.action==='filter'&&r.filtered){lines.push('Фильтр: '+(r.filtered.competitors||[]).length+' конкурентов, '+(r.filtered.offers||[]).length+' предложений.');}
else if(r.action==='evidence'&&r.evidence){lines.push('Доказательств: '+(r.evidence.total||0)+'.');}
else if(r.action==='compare'){lines.push(r.comparison?('Сравнение с '+(r.baseline&&r.baseline.report_id)+' готово.'):('Подходящий прошлый отчёт не найден: '+r.baseline_reason));}
else if(r.action==='refresh'&&r.refresh_plan){lines.push('Обновление: к сбору '+((r.refresh_plan.refreshed||[]).length)+', переиспользовано '+((r.refresh_plan.reused||[]).length)+' (внешних вызовов пока 0).');}
lines.push('Файлы: '+e.xlsx_filename+' (XLSX), '+e.csv_filename+' (CSV)'+(e.chart_insufficient?'':', график'));
return [{json:{telegram_send_body:JSON.stringify({chat_id:chat,text:lines.join('\\n')})}}];`),
  httpTelegram('wf24-sendreply', 'Send Result Reply', [880, 40])
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['When Called by Agent', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Read report_bundles'],
  ['Read report_bundles', 'Read attachment_outbox'],
  ['Read attachment_outbox', 'Select & Scope Report'],
  ['Select & Scope Report', 'Build Scope Preview'],
  ['Build Scope Preview', 'Init Progress'],
  ['Init Progress', 'Send Progress'],
  ['Build Scope Preview', 'Apply Action'],
  ['Apply Action', 'Build Exports & Outbox'],
  ['Build Exports & Outbox', 'Send Document'],
  ['Send Document', 'Send Chart'],
  ['Build Exports & Outbox', 'Shape Attachment Outbox'],
  ['Shape Attachment Outbox', 'Append attachment_outbox'],
  ['Build Exports & Outbox', 'Build Result Reply'],
  ['Build Result Reply', 'Send Result Reply']
]));

// =========================================================================================== WF25 weekly digest
// One digest per owner per ISO week, assembled ONLY from stored reports/change events/tracked sources/health/
// execution summaries/recommendations (no recollection). Deterministic digest id + idempotency key, empty-week
// suppression, optional XLSX attachment via the SAME outbox contract. Schedule trigger ships INACTIVE (disabled
// by default); manual + callable also supported. NO external collection ($0).
write('25_weekly_digest.json', wf('25 — Weekly Digest (stored data only, one per owner per ISO week)', [
  scheduleTrigger('wf25-sched', 'Weekly Schedule', [-1100, -200], 168),
  manual('wf25-manual', 'Manual Start', [-1100, 0]),
  subTrigger('wf25-sub', 'When Called by Agent', [-1100, 200], ['owner_user_id', 'agent_request_id', 'week', 'force']),
  code('wf25-cfg', 'Resolve Agent Config', [-880, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  sheetsRead('wf25-readrep', 'Read report_bundles', [-660, -240], 'report_bundles'),
  sheetsRead('wf25-readchg', 'Read source_change_events', [-660, -80], 'source_change_events'),
  sheetsRead('wf25-readsrc', 'Read tracked_sources', [-660, 80], 'tracked_sources'),
  sheetsRead('wf25-readsum', 'Read execution_summaries', [-660, 240], 'execution_summaries'),
  sheetsRead('wf25-readdig', 'Read weekly_digests', [-660, 400], 'weekly_digests'),
  code('wf25-build', 'Build Weekly Digest', [-440, 0], ['weekly_digest'], `
var cfg=$('Resolve Agent Config').first().json;
var inp=$json||{};
var owner=String(inp.owner_user_id||((cfg.telegram_allowed_user_ids||[])[0])||'');
function J(v){try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return v;}}
function rd(name){try{return ($(name).all()||[]).map(function(r){return r.json;});}catch(e){return [];}}
var reports=rd('Read report_bundles').map(function(r){return J(r.bundle||r.report_bundle||r);});
var changes=rd('Read source_change_events');var tracked=rd('Read tracked_sources');var summaries=rd('Read execution_summaries');var existing=rd('Read weekly_digests');
var res=buildWeeklyDigest({owner_user_id:owner,now:inp.now||(new Date()).toISOString(),reports:reports,change_events:changes,tracked_sources:tracked,execution_summaries:summaries,cfg:cfg,force:inp.force===true});
var dd=dedupeDigest(existing,res.digest);
return [{json:{digest:res.digest,emit:(res.ok&&dd.emit),suppressed:res.suppressed,empty:res.empty,dedupe_reason:dd.reason,owner_user_id:owner,cfg:cfg}}];`),
  ifNode('wf25-if', 'Emit Digest?', [-220, 0], '={{ $json.emit }}'),
  code('wf25-attach', 'Build Digest Attachments', [0, -120], ['report_export', 'xlsx_writer', 'report_package'], `
var d=$('Build Weekly Digest').first().json;var cfg=d.cfg||{};var dg=d.digest;
function J(v){try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return v;}}
var reports=[];try{reports=($('Read report_bundles').all()||[]).map(function(r){return J(r.json.bundle||r.json.report_bundle||r.json);});}catch(e){}
var cur=null;for(var i=0;i<reports.length;i++){if(reports[i]&&String(reports[i].report_id)===String(dg.current_report_id)&&String(reports[i].owner_user_id)===String(dg.owner_user_id))cur=reports[i];}
var out={chat_id:String(dg.owner_user_id||''),caption:'Недельная сводка '+dg.iso_week,has_attachment:false,attachment_delivery:null};
var binary=undefined;
if(cur&&cfg.digest_attach_xlsx===true){var scope={owner_user_id:cur.owner_user_id,agent_request_id:cur.agent_request_id,report_id:cur.report_id};var pkg=buildReportPackage(cur,scope);var deliv=attachmentDelivery({owner_user_id:dg.owner_user_id,agent_request_id:dg.digest_id,report_id:cur.report_id},'digest_xlsx',pkg.size_bytes+'');out.has_attachment=true;out.attachment_delivery=deliv;out.xlsx_filename=pkg.filename;binary={attachment:{data:Buffer.from(pkg.buffer).toString('base64'),fileName:pkg.filename,mimeType:pkg.mime}};}
var item={json:Object.assign({},out,{digest:dg})};if(binary)item.binary=binary;
return [item];`),
  ifNode('wf25-ifatt', 'Has Attachment?', [220, -220], '={{ $json.has_attachment }}'),
  httpTelegramFile('wf25-senddoc', 'Send Digest Document', [440, -220], 'sendDocument', 'document', 'attachment'),
  code('wf25-row', 'Shape Digest Row', [220, -40], [], `
var d=$('Build Weekly Digest').first().json;var dg=d.digest;
return [{json:{digest_id:dg.digest_id,idempotency_key:dg.idempotency_key,owner_user_id:dg.owner_user_id,iso_week:dg.iso_week,item_count:dg.item_count,current_report_id:dg.current_report_id,baseline_report_id:dg.baseline_report_id,external_calls:dg.external_calls,generated_at:dg.generated_at}}];`),
  sheetsAppend('wf25-apdig', 'Append weekly_digests', [440, -40], 'weekly_digests'),
  code('wf25-msg', 'Build Digest Message', [660, -40], [], `
var d=$('Build Weekly Digest').first().json;var dg=d.digest;var chat=String(dg.owner_user_id||'');
return [{json:{telegram_send_body:JSON.stringify({chat_id:chat,text:dg.text}),digest_id:dg.digest_id,iso_week:dg.iso_week}}];`),
  httpTelegram('wf25-send', 'Send Digest', [880, -40]),
  code('wf25-skip', 'Skip Digest', [0, 160], [], "var d=$json||{};return [{json:{skipped:true,reason:d.suppressed?'empty_suppressed':(d.dedupe_reason||'already_emitted')}}];")
], [
  ['Weekly Schedule', 'Resolve Agent Config'],
  ['Manual Start', 'Resolve Agent Config'],
  ['When Called by Agent', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Read report_bundles'],
  ['Read report_bundles', 'Read source_change_events'],
  ['Read source_change_events', 'Read tracked_sources'],
  ['Read tracked_sources', 'Read execution_summaries'],
  ['Read execution_summaries', 'Read weekly_digests'],
  ['Read weekly_digests', 'Build Weekly Digest'],
  ['Build Weekly Digest', 'Emit Digest?'],
  ['Emit Digest?', 'Build Digest Attachments', 0],
  ['Emit Digest?', 'Skip Digest', 1],
  ['Build Digest Attachments', 'Has Attachment?'],
  ['Has Attachment?', 'Send Digest Document', 0],
  ['Build Digest Attachments', 'Shape Digest Row'],
  ['Shape Digest Row', 'Append weekly_digests'],
  ['Append weekly_digests', 'Build Digest Message'],
  ['Build Digest Message', 'Send Digest']
]));

// =========================================================================================== WF26 VK collector
// Bounded, production-shaped OPTIONAL VK public-community wall collector. Resolves a community (groups.getById),
// reads PUBLIC wall posts (wall.get) within bounds, builds canonical records, detects new/edited posts for
// monitoring and persists change events. The access token lives ONLY in the n8n credential store; a missing
// token / disabled collector yields setup_required and NO HTTP call (no spend). active=false; live-unverified.
write('26_vk_public_community_collector.json', wf('26 — VK Public Community Collector (bounded, official API)', [
  manual('wf26-trig', 'Manual Start', [-1200, 0]),
  subTrigger('wf26-sub', 'When Called by Agent', [-1200, 220], ['owner_user_id', 'agent_request_id', 'source_run_id', 'workflow_run_id', 'community', 'data_mode', 'mode']),
  code('wf26-cfg', 'Resolve Agent Config', [-980, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  code('wf26-gate', 'VK Credential Gate', [-760, 0], ['vk_collector'], `
var cfg=$('Resolve Agent Config').first().json;
var inp=$json||{};
var cred=credentialState(cfg);
var ident=normalizeCommunity(inp.community||(inp.source&&inp.source.ref)||'');
var configured=cred.ok&&ident.ok;
return [{json:{configured:configured,credential:cred,identity:ident,cfg:cfg,owner_user_id:String(inp.owner_user_id||(inp.source&&inp.source.owner_user_id)||''),agent_request_id:String(inp.agent_request_id||''),source_run_id:String(inp.source_run_id||''),workflow_run_id:String(inp.workflow_run_id||''),data_mode:String(inp.data_mode||'live'),mode:String(inp.mode||'manual')}}];`),
  ifNode('wf26-if', 'VK Configured?', [-540, 0], '={{ $json.configured }}'),
  code('wf26-resolvereq', 'Build Resolve Request', [-320, -140], ['vk_collector'], `
var g=$('VK Credential Gate').first().json;var req=resolveRequest(g.identity,g.cfg);
return [{json:Object.assign({},g,{vk_method:req.method,vk_params:req.params})}];`),
  httpVk('wf26-resolve', 'VK groups.getById', [-100, -140]),
  code('wf26-parsecomm', 'Parse Community', [120, -140], ['vk_collector'], `
var g=$('VK Credential Gate').first().json;var res=parseResolution($json||{});
if(!res.ok)return [{json:Object.assign({},g,{resolved:false,error:res.error})}];
var ident=Object.assign({},g.identity,res.community);
return [{json:Object.assign({},g,{resolved:true,identity:ident})}];`),
  code('wf26-wallreq', 'Build Wall Request', [340, -140], ['vk_collector'], `
var c=$('Parse Community').first().json;if(!c.resolved)return [{json:c}];
var req=wallRequest(c.identity,c.cfg,0);var plan=paginationPlan(c.cfg);
return [{json:Object.assign({},c,{vk_method:req.method,vk_params:req.params,pagination:plan})}];`),
  httpVk('wf26-wall', 'VK wall.get', [560, -140]),
  sheetsRead('wf26-readstate', 'Read vk_post_state', [560, 40], 'vk_post_state'),
  sheetsRead('wf26-readchg', 'Read source_change_events', [560, 200], 'source_change_events'),
  code('wf26-parsewall', 'Parse Wall & Detect Changes', [780, -140], ['vk_collector'], `
var c=$('Parse Community').first().json;
if(!c.resolved){return [{json:{ok:false,error:c.error,records:[],events:[]}}];}
var ctx={agent_request_id:c.agent_request_id,source_run_id:c.source_run_id,workflow_run_id:c.workflow_run_id,owner_user_id:c.owner_user_id,now:(new Date()).toISOString(),data_mode:c.data_mode};
var parsed=parseWall($json||{},c.identity,ctx,{});
if(!parsed.ok){return [{json:{ok:false,error:parsed.error,records:[],events:[]}}];}
var stateRows=[];try{stateRows=($('Read vk_post_state').all()||[]).map(function(r){return r.json;}).filter(function(s){return String(s.owner_user_id)===String(c.owner_user_id)&&String(s.community_id)===String(c.identity.community_id);});}catch(e){}
var prev={};var hasPrior=stateRows.length>0;stateRows.forEach(function(s){prev[String(s.owner_id)+'_'+String(s.post_id)]={post_version:s.post_version,content_hash:s.content_hash,is_pinned:s.is_pinned};});
var emitBaseline=c.mode==='manual';
var det=detectChanges(prev,parsed.posts,{has_prior_state:hasPrior,emit_baseline:emitBaseline});
var existing=[];try{existing=($('Read source_change_events').all()||[]).map(function(r){return r.json;});}catch(e){}
var fresh=det.events.filter(function(ev){return shouldNotify(existing,ev).notify;});
return [{json:{ok:true,baseline:det.baseline,records:parsed.posts,events:fresh,new_count:det.new_count,edited_count:det.edited_count,community:c.identity,owner_user_id:c.owner_user_id,external_calls_note:'bounded by pagination plan'}}];`),
  code('wf26-shaperecs', 'Shape VK Posts', [1000, -240], [], `
var d=$('Parse Wall & Detect Changes').first().json;return (d.records||[]).map(function(r){return {json:r};});`),
  sheetsAppend('wf26-aprecs', 'Append vk_posts', [1220, -240], 'vk_posts'),
  code('wf26-shapestate', 'Shape VK Post State', [1000, -100], ['vk_collector'], `
var d=$('Parse Wall & Detect Changes').first().json;
return (d.records||[]).map(function(r){return {json:{owner_user_id:r.owner_user_id,community_id:r.community_id,owner_id:r.owner_id,post_id:r.post_id,post_version:r.post_version,content_hash:r.content_hash,is_pinned:r.is_pinned,updated_at:r.collected_at}};});`),
  sheetsAppend('wf26-apstate', 'Append vk_post_state', [1220, -100], 'vk_post_state'),
  ifNode('wf26-ifchg', 'VK Change?', [1000, 60], '={{ ($json.events && $json.events.length) > 0 }}'),
  code('wf26-shapeevents', 'Shape VK Change Events', [1220, 60], [], `
var d=$('Parse Wall & Detect Changes').first().json;return (d.events||[]).map(function(e){return {json:e};});`),
  sheetsAppend('wf26-apchg', 'Append source_change_events', [1440, 60], 'source_change_events'),
  code('wf26-alert', 'Build VK Alert', [1440, 200], ['conversation_response', 'agent_charter'], `
var d=$('Parse Wall & Detect Changes').first().json;var chat=String(d.owner_user_id||'');
var ev=(d.events||[])[0]||{};
var text=clarificationReply('VK '+(d.community&&d.community.canonical_url||'')+': новых постов '+(d.new_count||0)+', изменённых '+(d.edited_count||0)+'. '+(ev.canonical_url?('Например: '+ev.canonical_url):''));
return [{json:{telegram_send_body:JSON.stringify({chat_id:chat,text:text}),new_count:d.new_count,edited_count:d.edited_count}}];`),
  httpTelegram('wf26-send', 'Send VK Alert', [1660, 200]),
  code('wf26-setup', 'Build Setup-Required Reply', [-320, 160], ['vk_collector', 'conversation_response'], `
var g=$('VK Credential Gate').first().json;var chat=String(g.owner_user_id||'');
var reason=(g.credential&&g.credential.reason)||(g.identity&&g.identity.reason)||'vk_setup_required';
var text=clarificationReply('VK источник пока не настроен ('+reason+'). Нужен токен VK в хранилище учётных данных n8n и включённый VK-сборщик. Сбор не выполнялся, средства не потрачены.');
return [{json:{telegram_send_body:JSON.stringify({chat_id:chat,text:text}),status:'setup_required',reason:reason,external_calls:0}}];`),
  httpTelegram('wf26-sendsetup', 'Send Setup Required', [-100, 160])
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['When Called by Agent', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'VK Credential Gate'],
  ['VK Credential Gate', 'VK Configured?'],
  ['VK Configured?', 'Build Resolve Request', 0],
  ['VK Configured?', 'Build Setup-Required Reply', 1],
  ['Build Setup-Required Reply', 'Send Setup Required'],
  ['Build Resolve Request', 'VK groups.getById'],
  ['VK groups.getById', 'Parse Community'],
  ['Parse Community', 'Build Wall Request'],
  ['Build Wall Request', 'VK wall.get'],
  ['VK wall.get', 'Read vk_post_state'],
  ['Read vk_post_state', 'Read source_change_events'],
  ['Read source_change_events', 'Parse Wall & Detect Changes'],
  ['Parse Wall & Detect Changes', 'Shape VK Posts'],
  ['Shape VK Posts', 'Append vk_posts'],
  ['Parse Wall & Detect Changes', 'Shape VK Post State'],
  ['Shape VK Post State', 'Append vk_post_state'],
  ['Parse Wall & Detect Changes', 'VK Change?'],
  ['VK Change?', 'Shape VK Change Events', 0],
  ['VK Change?', 'Build VK Alert', 1],
  ['Shape VK Change Events', 'Append source_change_events'],
  ['Append source_change_events', 'Build VK Alert'],
  ['Build VK Alert', 'Send VK Alert']
]));

console.log('Stage 4 workflows generated.');
