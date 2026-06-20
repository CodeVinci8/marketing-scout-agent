// gen_stage4_workflows.js — build the Stage 4 workflow JSON from the proven n8n/lib/* contracts.
// Each Code node embeds the relevant library core verbatim between drift markers (the same drift-proof
// pattern as report_gate/semantic_core) + a small driver. Run: node tools/gen_stage4_workflows.js
'use strict';
const fs = require('fs');
const path = require('path');
const LIB = path.join(__dirname, '..', 'n8n', 'lib');
const WF = path.join(__dirname, '..', 'n8n', 'workflows');

// Extract a lib's embeddable core: strip the leading 'use strict'; and the trailing module.exports.
function libCore(name) {
  let s = fs.readFileSync(path.join(LIB, name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
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
function ifNode(id, name, pos, expr) {
  return {
    parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'strict' }, combinator: 'and',
      conditions: [{ leftValue: expr, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }] } },
    type: 'n8n-nodes-base.if', typeVersion: 2, position: pos, id: id, name: name
  };
}
function execWf(id, name, pos, note) {
  return { parameters: { workflowId: { __rl: true, value: 'PASTE_WORKFLOW_ID', mode: 'id', cachedResultName: note }, options: {} },
    type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.1, position: pos, id: id, name: name };
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
  code('wf18-ctx', 'Build Conversation Context', [760, 0], ['conversation_memory'],
    "var d=$('Build Intake Decision').first().json;var r=d.routed;var cfg=r.cfg;\nvar newest=String((d.request&&d.request.request_text)||(r.parsed&&r.parsed.text)||'');\nvar state='conv='+((r.ctx&&r.ctx.conversation_id)||'new')+' intent='+((d.intent&&d.intent.intent)||'')+' arid='+((d.request&&d.request.agent_request_id)||'');\nvar safety=cfg.require_approval!==false?'APPROVAL REQUIRED before paid/external work':'approval not required';\nvar sections={charter:r.charter,state:state,safety:safety,newest:newest,artifacts:'',recent:'',summary:'',summary_version:0};\nvar ctxRes=buildContext(sections,cfg);\nvar usage=contextUsageRecord(ctxRes,{conversation_id:(r.ctx&&r.ctx.conversation_id)||'',agent_request_id:(d.request&&d.request.agent_request_id)||'',ts:(new Date()).toISOString()});\nreturn [{json:{context:ctxRes,context_usage:usage,decision:d}}];"),
  sheetsAppend('wf18-apreq', 'Append agent_requests', [980, -200], 'agent_requests'),
  sheetsAppend('wf18-apev', 'Append agent_request_events', [980, -40], 'agent_request_events'),
  sheetsAppend('wf18-apctx', 'Append context_usage', [980, 160], 'context_usage'),
  code('wf18-reply', 'Build Conversational Reply', [1200, 0], ['conversation_response', 'agent_charter'],
    "var c=$('Build Conversation Context').first().json;var d=c.decision;var r=d.routed;var cfg=r.cfg;\nvar chat=String((d.request&&d.request.chat_id)||(r.parsed&&r.parsed.chat_id)||'');\nvar caps=availableCapabilities(cfg);var text,kb=null;\nif(d.decision==='unauthorized'){text='Доступ запрещён.';}\nelse if(d.decision==='duplicate'){text='Запрос уже принят (дубликат обновления).';}\nelse if(r.route==='clarify'){text=clarificationReply(r.clarification);}\nelse if(d.external&&r.capability_available!==true){text='Это действие сейчас недоступно: '+((r.capability&&r.capability.unavailable_reason)||'нужна настройка источников')+'.';}\nelse if(d.external&&d.start_work){text=buildConversationalReply({understood:(r.capability&&r.capability.name)||d.intent.intent,next:'строю план и пришлю на подтверждение',requires_approval:true,source_scope:(cfg.source_allowlist||[]).join(', '),budget_ceiling:'\\u2264'+cfg.max_external_calls+' \\u0432\\u044b\\u0437\\u043e\\u0432\\u043e\\u0432, ~$'+cfg.source_budget_usd});kb=actionButtons(caps);}\nelse if(d.intent&&d.intent.intent==='help'){text=capabilityCatalogText(cfg);}\nelse{text=buildConversationalReply({understood:(r.capability&&r.capability.name)||(d.intent&&d.intent.intent),next:'готов помочь'});}\nvar body={chat_id:chat,text:text};if(kb)body.reply_markup=kb;\nreturn [{json:{telegram_send_body:JSON.stringify(body),decision:d.decision,intent:(d.intent&&d.intent.intent)||'clarify_request',start_work:d.start_work}}];"),
  httpTelegram('wf18-send', 'Send Telegram Reply', [1420, 0])
], [
  ['Telegram Webhook', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Parse Telegram Update'],
  ['Parse Telegram Update', 'Read agent_request_events'],
  ['Read agent_request_events', 'Read conversation_state'],
  ['Read conversation_state', 'Route Intent'],
  ['Route Intent', 'Build Intake Decision'],
  ['Build Intake Decision', 'Build Conversation Context'],
  ['Build Conversation Context', 'Append agent_requests'],
  ['Build Conversation Context', 'Append agent_request_events'],
  ['Build Conversation Context', 'Append context_usage'],
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
  code('wf19-approval', 'Build Approval Message', [840, 120], ['request_planner', 'telegram_io'],
    "var src;try{src=$('Validate Plan').first().json;}catch(e){src=$('Deterministic Plan').first().json;}\nvar plan=src.plan;\nvar text=planToApprovalText(plan);\nvar arid=String(($json&&$json.agent_request_id)||'req_pending');\nvar kb=approvalKeyboard(arid);\nreturn [{json:{plan:plan,plan_source:plan.plan_source,approval_text:text,approval_keyboard:kb}}];")
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
  execWf('wf20-wf04', 'Run Website Source (WF04)', [180, -160], 'WF04 firecrawl url list'),
  code('wf20-norm', 'Normalize Adapter Result', [400, -160], ['source_adapter'],
    "var g=$('Approval & Budget Gate').first().json;\nvar raw=($json&&$json.live_source_run)?$json.live_source_run:($json||{});\nvar res=normalizeAdapterResult('website',raw,{agent_request_id:g.request.agent_request_id});\nreturn [{json:{adapter:res,plan:g.plan,request:g.request,cfg:g.cfg}}];"),
  execWf('wf20-wf16', 'Run WF16 Quality Gate', [620, -160], 'WF16 source quality gate'),
  execWf('wf20-wf08', 'Run WF08 Analyzer', [840, -160], 'WF08 touchpoint analyzer'),
  execWf('wf20-wf10', 'Run WF10 Aggregator', [1060, -160], 'WF10 audience aggregator'),
  execWf('wf20-wf12', 'Run WF12 Report', [1280, -160], 'WF12 report builder'),
  code('wf20-summary', 'Build Execution Summary', [1500, -160], ['source_adapter', 'execution_summary'],
    "var n=$('Normalize Adapter Result').first().json;\nvar adapters=[n.adapter];\nvar roll=rollupCollection(adapters);\nvar rep=($json&&$json.report)?$json.report:($json||{});\nvar summary=buildExecutionSummary({config_complete:(n.cfg&&n.cfg.config_complete),request:Object.assign({},n.request,{state:roll.outcome==='no_data'?'partial':(roll.outcome==='complete'?'reporting':'partial')}),plan:n.plan,collection:roll,adapters:adapters,analysis:{records_unique:rep.records_unique,records_eligible:rep.records_eligible,records_analyzed:rep.records_analyzed,llm_primary_calls:rep.llm_primary_calls,llm_repair_calls:rep.llm_repair_calls,llm_cost_status:rep.llm_cost_status||'unknown'},aggregation:{rows_after_filters:rep.rows_after_filters},report:rep,delivery:{}});\nreturn [{json:{summary:summary,report:rep,request:n.request,cfg:n.cfg}}];"),
  code('wf20-outbox', 'Build Delivery Outbox', [1720, -160], ['telegram_io'],
    "var s=$('Build Execution Summary').first().json;\nvar chat=String((s.request&&s.request.chat_id)||'');\nvar body=(s.report&&s.report.report_markdown)?String(s.report.report_markdown):('Отчёт готов. Итог: '+s.summary.final_state+'. Источники: '+s.summary.sources_requested+'. Записей в отчёте: '+s.summary.records_reported+'.');\nvar dlv=makeDelivery(s.request.agent_request_id,(s.report&&s.report.report_id)||'rep',chat,body);\nvar chunks=chunkMessage(body);\nvar first={chat_id:chat,text:chunks[0]};\nreturn [{json:{delivery:dlv,telegram_send_body:JSON.stringify(first),summary:s.summary}}];"),
  sheetsAppend('wf20-apout', 'Append telegram_outbox', [1940, -160], 'telegram_outbox'),
  httpTelegram('wf20-send', 'Send Telegram Report', [2160, -160]),
  code('wf20-blocked', 'Build Blocked Response', [180, 160], ['telegram_io'],
    "var g=$('Approval & Budget Gate').first().json;\nvar chat=String((g.request&&g.request.chat_id)||'');\nvar body={chat_id:chat,text:'Запрос не запущен: '+g.gate_reason};\nreturn [{json:{telegram_send_body:JSON.stringify(body),gate_reason:g.gate_reason}}];"),
  httpTelegram('wf20-sendblock', 'Send Blocked Reply', [400, 160])
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
  ['Gate Allowed?', 'Build Blocked Response', 1],
  ['Run Website Source (WF04)', 'Normalize Adapter Result'],
  ['Normalize Adapter Result', 'Run WF16 Quality Gate'],
  ['Run WF16 Quality Gate', 'Run WF08 Analyzer'],
  ['Run WF08 Analyzer', 'Run WF10 Aggregator'],
  ['Run WF10 Aggregator', 'Run WF12 Report'],
  ['Run WF12 Report', 'Build Execution Summary'],
  ['Build Execution Summary', 'Build Delivery Outbox'],
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
  execWf('wf21-wf04', 'Collect Deep Evidence (WF04)', [500, -160], 'WF04 multi-page firecrawl'),
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

console.log('Stage 4 workflows generated.');
