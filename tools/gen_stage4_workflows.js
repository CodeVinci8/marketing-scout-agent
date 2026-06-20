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
write('18_telegram_agent_gateway.json', wf('18 — Telegram Agent Gateway', [
  webhook('wf18-hook', 'Telegram Webhook', [-360, 0], 'ms-telegram-agent'),
  code('wf18-cfg', 'Resolve Agent Config', [-140, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  code('wf18-parse', 'Parse Telegram Update', [80, 0], ['telegram_io'],
    "var body=($json&&$json.body)?$json.body:$json;\nvar parsed=parseUpdate(body);\nvar cfg=$('Resolve Agent Config').first().json;\nparsed.authorized=isAuthorized(parsed,cfg.telegram_allowed_user_ids);\nparsed.idempotency_key=updateIdempotencyKey(parsed);\nreturn [{json:parsed}];"),
  sheetsRead('wf18-readev', 'Read agent_request_events', [300, 0], 'agent_request_events'),
  code('wf18-intake', 'Build Intake Decision', [520, 0], ['agent_state'],
    "var p=$('Parse Telegram Update').first().json;\nvar seen={};try{($('Read agent_request_events').all()||[]).forEach(function(r){var k=(r.json&&r.json.idempotency_key)||'';if(k)seen[k]=1;});}catch(e){}\nvar dup=!!seen[p.idempotency_key];\nvar stamp=(new Date()).toISOString();\nif(!p.authorized){return [{json:{decision:'unauthorized',authorized:false,start_work:false,reply:'Доступ запрещён.',parsed:p}}];}\nif(dup){return [{json:{decision:'duplicate',authorized:true,start_work:false,reply:'Запрос уже принят (дубликат обновления).',parsed:p}}];}\nvar arid='req_'+(p.update_id||p.message_id||stamp.replace(/[^0-9]/g,'')).toString();\nvar rec={agent_request_id:arid,update_id:p.update_id,chat_id:p.chat_id,user_id:p.user_id,request_text:p.text,kind:p.kind,idempotency_key:p.idempotency_key,created_at:stamp,state:'received'};\nvar t=transition(rec,'classified',{ts:stamp});\nreturn [{json:{decision:'accepted',authorized:true,start_work:p.kind==='request',reply:'Запрос принят. Готовлю план…',request:rec,event:t.event,parsed:p}}];"),
  sheetsAppend('wf18-apreq', 'Append agent_requests', [740, -120], 'agent_requests'),
  sheetsAppend('wf18-apev', 'Append agent_request_events', [740, 120], 'agent_request_events'),
  code('wf18-reply', 'Build Telegram Reply', [960, 0], ['telegram_io'],
    "var d=$('Build Intake Decision').first().json;\nvar chat=(d.parsed&&d.parsed.chat_id)||'';\nvar body={chat_id:chat,text:d.reply};\nreturn [{json:{telegram_send_body:JSON.stringify(body),decision:d.decision}}];"),
  httpTelegram('wf18-send', 'Send Telegram Reply', [1180, 0])
], [
  ['Telegram Webhook', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Parse Telegram Update'],
  ['Parse Telegram Update', 'Read agent_request_events'],
  ['Read agent_request_events', 'Build Intake Decision'],
  ['Build Intake Decision', 'Append agent_requests'],
  ['Build Intake Decision', 'Append agent_request_events'],
  ['Append agent_requests', 'Build Telegram Reply'],
  ['Build Telegram Reply', 'Send Telegram Reply']
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
  manual('wf20-trig', 'Manual Start', [-700, 0]),
  code('wf20-cfg', 'Resolve Agent Config', [-480, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  code('wf20-gate', 'Approval & Budget Gate', [-260, 0], ['approval_gate', 'agent_state'],
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
  ['Resolve Agent Config', 'Approval & Budget Gate'],
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

console.log('Stage 4 workflows generated.');
