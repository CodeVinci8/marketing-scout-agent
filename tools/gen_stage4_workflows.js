// gen_stage4_workflows.js — build the Stage 4 workflow JSON from the proven n8n/lib/* contracts.
// Each Code node embeds the relevant library core verbatim between drift markers (the same drift-proof
// pattern as report_gate/semantic_core) + a small driver. Run: node tools/gen_stage4_workflows.js
'use strict';
const fs = require('fs');
const path = require('path');
const LIB = path.join(__dirname, '..', 'n8n', 'lib');
const WF = path.join(__dirname, '..', 'n8n', 'workflows');
// SHEETS-RATELIMIT-001: every googleSheets node carries a storm-free, window-crossing native retry so a
// transient per-minute 429 (RATE_LIMIT_EXCEEDED) is ridden out in a FRESH quota window instead of storming
// the throttled minute. Single source of truth for the policy + its regression test.
const SHEETS_RETRY = require('../n8n/lib/sheets_retry_policy.js').nativeSheetsRetry();

// Credential placeholders (CRED-001 / DEPLOY-008). A node REQUIRES an n8n credential reference ONLY because of its
// own configuration — never to make an audit count green:
//   * a googleSheets node cannot read/write without a Google credential -> it carries a googleApi reference;
//   * an httpRequest node with authentication 'genericCredentialType'/'predefinedCredentialType' tells n8n to look
//     up a credential of the declared type at runtime -> it carries that exact type (httpHeaderAuth for the Claude
//     planner, httpQueryAuth for VK);
//   * an httpRequest node that injects $env directly (every Telegram send uses $env.MS_TELEGRAM_BOT_TOKEN in the
//     URL, no `authentication`) intentionally needs NO n8n credential and carries none.
// The committed source ships PASTE_CREDENTIAL_ID_HERE; tools/prepare_staged_workflows.js resolves it to the unique
// installation-local credential of the SAME TYPE at deploy time (reconcile matches by type — the name is cosmetic),
// or DEFERS it when no production credential of that type exists yet. The googleApi shape/name mirrors the legacy
// WF04/08/10/12 references so every Sheets node reconciles identically.
function credGoogle() { return { googleApi: { id: 'PASTE_CREDENTIAL_ID_HERE', name: 'Google Sheets - Marketing Scout Service Account' } }; }
// CRED-003: the ONLY httpHeaderAuth node generated here is the WF19 Claude planner (aiprimetech.io gateway —
// CLAUDE-ENDPOINT-001: the project-approved Claude-compatible endpoint, never api.anthropic.com). Its
// credential name MUST mirror the legacy WF04/08 Claude reference ("Claude API - Marketing Scout") so all five
// Claude httpHeaderAuth references reconcile to the SAME single production credential by (type,name). The old
// generic name "HTTP Header Auth - Marketing Scout" matched no production credential and, with >1 httpHeaderAuth
// credential present (Claude + Firecrawl + Apify), made the WF19 reference unresolvable/ambiguous on a real VPS.
function credClaude() { return { httpHeaderAuth: { id: 'PASTE_CREDENTIAL_ID_HERE', name: 'Claude API - Marketing Scout' } }; }
function credFirecrawl() { return { httpHeaderAuth: { id: 'PASTE_CREDENTIAL_ID_HERE', name: 'Firecrawl API - Marketing Scout' } }; }
// Stage F Claude call node (WF28). Measured gateway: latency 16-28s (90s timeout), fullResponse+neverError so a
// 4xx/5xx/timeout returns {statusCode,headers,body} to the parser as a provider error instead of aborting the run.
// Body is the tool-transport Messages request built by claude_adapter.buildToolRequest (tool_choice:auto).
// NB: distinct from the legacy httpClaude (WF19 planner, $json.claude_request_body) — this one reads claude_body.
//
// WF28-TIMEOUT-001. This was 90000, which is NOT the "generous timeout" the adapter's own header claims. The
// gateway wraps Claude Code with thinking always on, so wall time tracks OUTPUT tokens, not prompt size: our
// proven-good analysis (exec 834) emitted 3900 output tokens. Live exec 943 sent a 4602-byte body — 1% larger
// than 834's 4543 — and was aborted at ~92 s, so the ceiling sat right at the real cost of a normal analysis and
// decided runs by coin-flip. A timeout is pure downside: it burns the provider's full generation, bills nothing
// back to us, and drops the user to a deterministic fallback. Sized to ~2x the observed good call.
var CLAUDE_HTTP_TIMEOUT_MS = 180000;
function httpClaudeMsg(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: 'https://aiprimetech.io/v1/messages',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.claude_body) }}',
      options: { timeout: CLAUDE_HTTP_TIMEOUT_MS, response: { response: { neverError: true, fullResponse: true } } }
    },
    onError: 'continueRegularOutput',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name,
    credentials: credClaude()
  };
}
// Firecrawl Search HTTP node (DISCOVERY-003): POST /v2/search per query item; body from discovery_query. Tolerant
// (a failed/blocked search degrades to a user-safe no-candidates message, never aborts the discovery run).
function httpFirecrawlSearch(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: 'https://api.firecrawl.dev/v2/search',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.search_body) }}',
      options: { timeout: 25000 }
    },
    onError: 'continueRegularOutput',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name,
    credentials: credFirecrawl()
  };
}
// Firecrawl Scrape HTTP node (DISCOVERY-006): POST /v2/scrape for one candidate URL; body from Select Validation
// Targets. Tolerant — a failed scrape degrades the candidate to `unvalidated`, never aborts the run.
function httpFirecrawlScrape(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: 'https://api.firecrawl.dev/v2/scrape',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.scrape_body }}',
      options: { timeout: 20000 }
    },
    onError: 'continueRegularOutput',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name,
    credentials: credFirecrawl()
  };
}
function credHttpQuery() { return { httpQueryAuth: { id: 'PASTE_CREDENTIAL_ID_HERE', name: 'HTTP Query Auth - VK Access Token' } }; }

// Extract a lib's embeddable core: strip the leading 'use strict'; and the trailing module.exports, and drop
// local cross-require lines (the depended-on lib is embedded alongside in the SAME node scope, so its symbols
// are already declared — the require() would otherwise throw inside an n8n Code node). Dependencies MUST be
// embedded BEFORE their dependents in the names[] list passed to embed().
function libCore(name) {
  let s = fs.readFileSync(path.join(LIB, name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  s = s.replace(/^\s*const\s*\{[^}]*\}\s*=\s*require\('\.\/[^']+'\);\s*$/gm, ''); // drop local cross-requires
  // semantic_core loads config/taxonomy.json via fs at Node load time. n8n Code nodes cannot require('fs') or
  // read a repo path, so inline the taxonomy JSON at generation time — this keeps classifyOffline the SINGLE
  // canonical scoring contract inside n8n (tests/test_wf26_vk_rmr_mapping.js asserts the embedded classifier
  // is byte-for-byte the library core and behaves identically).
  if (/taxonomy\.json/.test(s)) {
    const taxJson = fs.readFileSync(path.join(LIB, '..', '..', 'config', 'taxonomy.json'), 'utf8').trim();
    s = s.replace(/^const fs = require\('fs'\);\s*$/m, '')
         .replace(/^const path = require\('path'\);\s*$/m, '')
         .replace(/const TAXONOMY = JSON\.parse\([\s\S]*?taxonomy\.json[\s\S]*?\);/m, 'const TAXONOMY = ' + taxJson + ';');
  }
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
  // responseMode:'responseNode' => a Respond to Webhook node returns the HTTP response fast (WEBHOOK-001), so
  // Telegram is acknowledged before Sheets/dispatch and never retries due to a slow downstream.
  // WEBHOOK-PATH-001: `webhookId` MUST be present. When it is missing, n8n 2.x registers the FALLBACK dynamic
  // path `<workflowId>/<node name>/<path>` instead of `/webhook/<path>` (live-observed in webhook_entity), so
  // the canonical /webhook/ms-telegram-agent URL 404s. A stable committed UUID keeps the path deterministic.
  return { parameters: { httpMethod: 'POST', path: p, responseMode: 'responseNode', options: {} }, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos, id: id, name: name, webhookId: 'a3b40e18-6f1c-4c95-8e3a-77b1c92d4f01' };
}
// Respond to Webhook — immediate 200 (WEBHOOK-001). Used on every WF18 terminal branch (accept + every safe stop).
function respond(id, name, pos) {
  return { parameters: { respondWith: 'text', responseCode: 200, responseBody: 'ok', options: {} }, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: pos, id: id, name: name };
}
// answerCallbackQuery — acknowledge a callback fast so Telegram drops the spinner (TELEGRAM-006). Body has no token.
function httpTelegramAnswer(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: '=https://api.telegram.org/bot{{ $env.MS_TELEGRAM_BOT_TOKEN }}/answerCallbackQuery',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.answer_callback_body }}',
      options: { ignoreHttpStatusErrors: true }
    },
    // TELEGRAM-TOLERANT-001: clearing the callback spinner is best-effort. A stale/expired/invalid callback id
    // makes Telegram return 400; that must NEVER abort the approval→analysis dispatch (which runs on a parallel
    // branch). Fail-open, exactly like WF20's progress sends.
    onError: 'continueRegularOutput',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name
  };
}
function sheetsAppend(id, name, pos, tab) {
  return {
    parameters: {
      // SHEETS-AUTH-001: pin service-account auth; the node defaults to OAuth2 (googleSheetsOAuth2Api) when unset,
      // which ignores the attached googleApi service-account credential and fails at runtime.
      authentication: 'serviceAccount',
      operation: 'append',
      documentId: { __rl: true, value: '={{ $env.MS_SPREADSHEET_ID || "PASTE_SPREADSHEET_ID" }}', mode: 'id' },
      sheetName: { __rl: true, value: tab, mode: 'name' },
      // SHEETS-UPSERT-001: append's `columns` is a resourceMapper too (v4.5 reads columns.mappingMode/schema/value);
      // a top-level mappingMode throws "Could not get parameter columns.schema" at runtime. append is a plain insert
      // -> NO matchingColumns.
      columns: { mappingMode: 'autoMapInputData', value: null, schema: [], attemptToConvertTypes: false, convertFieldsToString: false }, options: {}
    },
    type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: pos, id: id, name: name,
    credentials: credGoogle(), ...SHEETS_RETRY
  };
}
function sheetsRead(id, name, pos, tab) {
  return {
    parameters: {
      authentication: 'serviceAccount',   // SHEETS-AUTH-001: see sheetsAppend()
      operation: 'read',
      documentId: { __rl: true, value: '={{ $env.MS_SPREADSHEET_ID || "PASTE_SPREADSHEET_ID" }}', mode: 'id' },
      sheetName: { __rl: true, value: tab, mode: 'name' }, options: {}
    },
    type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: pos, id: id, name: name,
    // SHEETS-CHAIN-001 (live-observed: WF22 exec ended after an EMPTY durable_memories read with no reply):
    // n8n stops a branch when a node emits 0 items -> alwaysOutputData emits one {} sentinel item instead
    // (consumers filter rows by content, matching WF08/10/12/16 convention). executeOnce prevents the
    // documented read-amplification (read.operation re-runs per INPUT item at typeVersion>4.1), which in a
    // read chain multiplies requests by the previous tab's row count (SHEETS-READ-AMPLIFICATION-001).
    executeOnce: true, alwaysOutputData: true,
    credentials: credGoogle(), ...SHEETS_RETRY
  };
}
// SHEETS-READ-AMPLIFICATION-001: ONE values:batchGet for the whole WF18 read phase (predefined googleApi credential
// with httpNode+scopes). Replaces the chained Get-Rows reads whose per-input-item re-execution (read.operation runs
// once per INPUT item for typeVersion>4.1) exploded a 6-read chain into ~1000 requests -> 429. The spreadsheet id
// stays an $env expression; ranges are bounded A1 (the extractor drops empty-header columns).
function httpSheetsBatchGet(id, name, pos, tabs) {
  var rq = tabs.map(function (t) { return 'ranges=' + (t + '!A:ZZ').replace(/!/g, '%21').replace(/:/g, '%3A'); }).join('&');
  var url = '=https://sheets.googleapis.com/v4/spreadsheets/{{ $env.MS_SPREADSHEET_ID || "PASTE_SPREADSHEET_ID" }}' +
    '/values:batchGet?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&' + rq;
  return {
    parameters: { method: 'GET', url: url, authentication: 'predefinedCredentialType', nodeCredentialType: 'googleApi', options: {} },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name, credentials: credGoogle()
  };
}
// A "Read <tab>" replacement: a Code node (runs ONCE for all items -> no per-item amplification) that projects the
// batchGet response for `tab` into the EXACT legacy Get-Rows shape, so every downstream $('Read <tab>').all() is
// unchanged. The projection lives in n8n/lib/sheets_access.js (drift-proof embed; parity test + live shadow gate).
function sheetExtract(id, name, pos, tab) {
  // n8n stops a branch when a node emits 0 items, so an EMPTY projected tab would otherwise halt the read chain
  // before the dispatch/persist phase. extractTab stays pure (legacy-exact); the node emits a single content-less
  // sentinel {} when the tab is empty to keep the chain alive. Every WF18 consumer filters reads by content
  // (conversation_id/owner/agent_request_id/idempotency_key), so the sentinel is naturally ignored.
  return code(id, name, pos, ['sheets_access'],
    "var b=$('Batch Read Sheets').first().json;var r=extractTab(b, " + JSON.stringify(tab) + ");return r.length?r:[{json:{}}];");
}
// appendOrUpdate (upsert) keyed by matchCol — used for the single-latest-row conversation_state.
function sheetsUpsert(id, name, pos, tab, matchCol) {
  return {
    parameters: {
      authentication: 'serviceAccount',   // SHEETS-AUTH-001: see sheetsAppend()
      operation: 'appendOrUpdate',
      documentId: { __rl: true, value: '={{ $env.MS_SPREADSHEET_ID || "PASTE_SPREADSHEET_ID" }}', mode: 'id' },
      sheetName: { __rl: true, value: tab, mode: 'name' },
      // SHEETS-UPSERT-001: appendOrUpdate's `columns` is a resourceMapper — n8n reads columns.schema/value/
      // matchingColumns at runtime. A partial object (no `value`) throws "Could not get parameter columns.schema".
      // Send the FULL resourceMapper (autoMapInputData -> value:null; matchingColumns is the key column).
      columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [matchCol], schema: [], attemptToConvertTypes: false, convertFieldsToString: false }, options: {}
    },
    type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: pos, id: id, name: name,
    credentials: credGoogle(), ...SHEETS_RETRY
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
function execWf(id, name, pos, note, inputs, opts) {
  var params = { workflowId: { __rl: true, value: 'PASTE_WORKFLOW_ID', mode: 'id', cachedResultName: note }, options: {} };
  if (inputs && Object.keys(inputs).length) {
    var keys = Object.keys(inputs);
    params.workflowInputs = {
      mappingMode: 'defineBelow', value: inputs,
      schema: keys.map(function (k) { return { id: k, displayName: k, required: false, type: 'string', display: true, removed: false }; }),
      matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: false
    };
  }
  // typeVersion MUST be >= 1.2: below 1.2 n8n hides the workflowInputs resourceMapper, so the defineBelow
  // expressions are silently ignored and the child receives only accidentally same-named passthrough keys
  // (live-observed on n8n 2.23.3: WF22 got domain/op/chat_id = null while agent_request_id passed by accident).
  // SOURCE-EMPTY-001 (live-observed: WF09 returned 0 items after an all-blocked Avito scrape and the parent
  // chain halted silently): alwaysOutputData turns an empty child return into the {} sentinel item, which
  // normalizeAdapterResult already maps to status='empty' -> the run continues with partial results.
  var node = { parameters: params, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: pos, id: id, name: name, alwaysOutputData: true };
  // tolerant dispatch (source collectors only): a CRASHED child degrades to an error item instead of
  // aborting the whole orchestration — the adapter contract turns it into a failed/empty source.
  if (opts && opts.tolerant) node.onError = 'continueRegularOutput';
  return node;
}
function httpClaude(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: 'https://aiprimetech.io/v1/messages', authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json',
      jsonBody: '={{ $json.claude_request_body }}', options: {}
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name,
    credentials: credClaude()
  };
}
function httpTelegram(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: '=https://api.telegram.org/bot{{ $env.MS_TELEGRAM_BOT_TOKEN }}/sendMessage',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.telegram_send_body }}', options: {}
    },
    // TELEGRAM-TOLERANT-001: a Telegram sendMessage failure (ack, plan reply, fast reply) must never abort the
    // claim→dispatch pipeline. Send Command Reply feeds Continue Heavy Path?; on error, continueRegularOutput
    // passes the item through so the approve/cancel dispatch still proceeds. Same fail-open as WF20 progress.
    onError: 'continueRegularOutput',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name
  };
}
// editMessageText reuses the SAME message (progress edits). Body carries chat_id + message_id + text.
// Like httpTelegram but the Bot API method is chosen at runtime ($json.tg_method: 'sendMessage'|'editMessageText'),
// so one node can either post a new message or edit an existing one. Body is the matching JSON payload.
function httpTelegramDynamic(id, name, pos) {
  return {
    parameters: {
      method: 'POST', url: '=https://api.telegram.org/bot{{ $env.MS_TELEGRAM_BOT_TOKEN }}/{{ $json.tg_method }}',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.telegram_send_body }}', options: {}
    },
    onError: 'continueRegularOutput',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name
  };
}
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
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: id, name: name,
    credentials: credHttpQuery()
  };
}
// Execute Sub-workflow Trigger ("When Called by Agent") declaring NAMED canonical input fields (mirrors WF04/08
// callable contract so the parent passes named fields, not positional/.first()). Array fields use type 'array'.
// TRIGGER-INPUTS-001: the TRIGGER's `workflowInputs` is a fixedCollection { values: [{name,type},...] } with
// minRequiredFields=1 (n8n-nodes-base executeWorkflowTrigger tv1.1). The caller-style resourceMapper shape
// ({mappingMode,value,schema}) counts as ZERO fields, so checkForWorkflowIssues flagged every callable with
// "At least 1 field is required" and the live dispatch died with WorkflowHasIssuesError. The resourceMapper
// shape belongs ONLY on the CALLER executeWorkflow node (execWf below).
function subTrigger(id, name, pos, fields) {
  return {
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: (fields || []).map(function (f) {
          var fld = (typeof f === 'string') ? { id: f, type: 'string' } : f;
          return { name: fld.id, type: fld.type === 'array' ? 'array' : (fld.type || 'string') };
        })
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
// Registry of every workflow this generator builds. write() records here ALWAYS, but only touches disk when
// the file is run directly as a CLI (require.main === module). When required as a module (e.g. by the
// generated-Code compilation test) it builds the workflows in memory with NO disk side-effects.
const GENERATED = [];
function write(file, obj) {
  GENERATED.push({ file: file, workflow: obj });
  if (require.main === module) { fs.writeFileSync(path.join(WF, file), JSON.stringify(obj, null, 2) + '\n'); console.log('wrote', file, '(' + obj.nodes.length + ' nodes)'); }
}

const ENV = "var __env=(typeof $env!=='undefined'&&$env)?$env:{};";
// Robust caller-input read for a CALLABLE child: read the named Execute Sub-workflow Trigger output (the canonical
// fields the parent passed) and fall back to $json for manual diagnosis. A child must NEVER rely on $json alone,
// because an intervening config/Sheets node replaces $json (RUNTIME-002 / ORCH-CONTRACT-001).
const CALLER = "function callerInput(){try{var __t=$('When Called by Agent').first().json;if(__t&&Object.keys(__t).length)return __t;}catch(e){}return $json||{};}";

// =========================================================================================== WF17 config
write('17_agent_settings_config.json', wf('17 — Agent Settings & Config Loader', [
  manual('wf17-trig', 'Manual Start', [-260, 0]),
  code('wf17-cfg', 'Resolve Agent Config', [-40, 0], ['agent_config'],
    ENV + "\nvar cfg=resolveConfig(__env);\nreturn [{json:cfg}];")
], [['Manual Start', 'Resolve Agent Config']]));

// =========================================================================================== WF18 gateway
// Conversational front door, REARCHITECTED (DEC-161):
//   webhook -> FAIL-CLOSED ingress security (secret + kill-switch + supported-type + private-chat + auth) ->
//   hard-stop branches for every reject (NO Sheets / NO business send) -> durable idempotency claim ->
//   owner-isolated reads -> route intent -> intake decision (real dispatch target) -> shaped persistence ->
//   REAL dispatcher (executeWorkflow) to WF19 plan / WF20 orchestrate / WF21 deep / WF22 control / WF24 report.
// Approval is bound to a durable plan (execution_plans) persisted BEFORE the approval message is sent.
write('18_telegram_agent_gateway.json', wf('18 — Telegram Agent Gateway (secure dispatcher)', [
  webhook('wf18-hook', 'Telegram Webhook', [-1180, 0], 'ms-telegram-agent'),
  // ---- ingress security: ONE pure node, NO side effects (the secret never leaves it / is never persisted) ----
  code('wf18-gate', 'Ingress Security Gate', [-960, 0], ['telegram_io', 'agent_config'], `
${ENV}
var cfg=resolveConfig(__env);
var hook=$('Telegram Webhook').first().json||{};
var headers=hook.headers||{};
var update=hook.body||hook;
var dec=ingressDecision({update:update,headers:headers,expectedSecret:__env.MS_TELEGRAM_WEBHOOK_SECRET,cfg:cfg});
var gate={accepted:dec.accepted,stop_reason:dec.stop_reason,secret_ok:dec.secret_ok,telegram_enabled:dec.telegram_enabled,supported:dec.supported,is_private:dec.is_private,authorized:dec.authorized,is_callback:dec.is_callback,ack_needed:dec.ack_needed,callback_query_id:dec.callback_query_id,idempotency_key:dec.idempotency_key};
return [{json:{gate:gate,parsed:dec.parsed,cfg:cfg}}];`),
  ifNode('wf18-ifacc', 'Ingress Accepted?', [-740, 0], '={{ $json.gate.accepted }}'),
  // ---- §8 FAST-LANE-001: static commands (/start, /help, who-am-I) reply BEFORE any Sheets call. Pure render
  //      from config; zero side effects; duplicate-safe by content; every stateful path stays claim-protected. ----
  code('wf18-fastlane', 'Fast Static Lane', [-740, -220], ['fast_lane', 'plan_render_ru', 'agent_charter'], `
var g=$('Ingress Security Gate').first().json;var cfg=g.cfg;var p=g.parsed||{};
var d=fastLaneDecision(p);
if(!d.fast){return [{json:{fast:false}}];}
// UPDATE-DEDUP-001 (DEFECT-2): the fast lane runs BEFORE the durable claim, so a double-delivered update_id would
// reply twice (observed: same /help update processed twice). Dedup via workflow staticData — concurrency=1 makes
// this race-free; entries older than 10 min are pruned so it never grows.
var __sd=$getWorkflowStaticData('global');var __seen=__sd.fast_seen||{};var __uid=String(p.update_id||p.message_id||'');var __now=Date.now();
Object.keys(__seen).forEach(function(k){if(__now-__seen[k]>600000)delete __seen[k];});
if(__uid&&__seen[__uid]){__sd.fast_seen=__seen;return [{json:{fast:false,duplicate:true}}];}
if(__uid)__seen[__uid]=__now;__sd.fast_seen=__seen;
var text='';
if(d.kind==='start'){text=ruStartMessage();}
else if(d.kind==='whoami'){text=ruWhoAmIMessage();}
else {text=ruHelpMessage(availableCapabilities(cfg));}
return [{json:{fast:true,fast_kind:d.kind,telegram_send_body:JSON.stringify({chat_id:String(p.chat_id||''),text:text})}}];`),
  // DEFECT-2: a fast-lane duplicate (same update_id already answered) must STOP — not fall through to the heavy
  // path (which would re-send the static reply). Only non-duplicates continue to Fast Static Reply?.
  ifNode('wf18-ifdup', 'Duplicate Update?', [-620, -220], '={{ $json.duplicate === true }}'),
  ifNode('wf18-iffast', 'Fast Static Reply?', [-460, -220], '={{ $json.fast }}'),
  httpTelegram('wf18-sendfast', 'Send Fast Reply', [-280, -300]),
  // ---- §8 command lane: /status renders from the ALREADY-READ batch (no context assembly, no persistence
  //      chain, no WF22 dispatch); /cancel gets an immediate ack and CONTINUES to the real WF22 cancel. Both
  //      run AFTER the durable claim (Resolve Winner), so idempotency is intact. ----
  code('wf18-cmdlane', 'Command Lane', [20, -220], ['plan_render_ru', 'sheets_access', 'telegram_io', 'request_lifecycle'], `
var g=$('Resolve Winner').first().json;var p=g.parsed||{};var gate=g.gate||{};
var kind=String(p.kind||'');
if(kind==='cancel'){
  return [{json:{lane:'cancel_ack',continue_heavy:true,has_reply:true,telegram_send_body:JSON.stringify({chat_id:String(p.chat_id||''),text:'⏳ Отменяю текущую операцию…'})}}];
}
// §9 PROGRESS-ACK-001: the heavy path takes ~30-60s to first reply; every accepted NEW update gets an
// immediate ack here (post-claim, so exactly once per update). Approve callbacks also clear the button
// spinner via answerCallbackQuery. WF20's single editable progress message follows for approved runs.
if(kind==='callback'){
  if(/^approve:/.test(String(p.callback_data||''))){
    return [{json:{lane:'approve_ack',continue_heavy:true,has_reply:true,telegram_send_body:JSON.stringify({chat_id:String(p.chat_id||''),text:'✅ Принято! Запускаю анализ — прогресс покажу здесь.'}),answer_callback_body:JSON.stringify(answerCallbackBody(String(gate.callback_query_id||''),'Принято'))}}];
  }
  // DISCOVERY-004: candidate buttons (disc_add/disc_all/disc_more/disc_none) — clear the spinner instantly with a
  // short toast; WF22 (domain=discovery) sends the real reply on the heavy path.
  var __dcb=String(p.callback_data||'').match(/^disc_(add|all|more|none):/);
  if(__dcb){var __t={add:'Добавляю…',all:'Показываю кандидатов…',more:'Ищу ещё…',none:'Хорошо'}[__dcb[1]]||'Готово';
    return [{json:{lane:'disc_ack',continue_heavy:true,has_reply:false,answer_callback_body:JSON.stringify(answerCallbackBody(String(gate.callback_query_id||''),__t))}}];}
  return [{json:{lane:'none',continue_heavy:true,has_reply:false}}];
}
if(kind==='request'){
  // DEFECT-11: quick deterministic commands (memory view, source list/add/pause/remove/check) resolve to an
  // instant local reply — the "⏳ Принял запрос" ack is just noise there. Suppress it; the heavy path still sends
  // the real reply. The processing ack stays for genuine long-running analysis/discovery requests.
  var __qt=String(p.text||'');
  var __quick=/что\\s+ты\\s+помнишь|покажи\\s+память|какие\\s+(мои\\s+)?предпочтен|(мои|покажи|список|убери|удали|проверь|добавь|поставь|возобнов).{0,20}(источник|канал|сообществ|мониторинг|паузу)|проверь\\s+отслеживаем|отслеживаем[а-яё]*\\s+(сайт|канал|источник|сообществ)/i.test(__qt);
  if(__quick){return [{json:{lane:'quick',continue_heavy:true,has_reply:false}}];}
  return [{json:{lane:'request_ack',continue_heavy:true,has_reply:true,telegram_send_body:JSON.stringify({chat_id:String(p.chat_id||''),text:'⏳ Принял запрос, обрабатываю…'})}}];
}
if(kind!=='status'){return [{json:{lane:'none',continue_heavy:true,has_reply:false}}];}
var plans=[];try{plans=extractTab($('Batch Read Sheets').first().json,'execution_plans').map(function(i){return i.json;});}catch(e){}
// STATUS-SELECT-001: the ONE canonical active-request selector (owner+chat scoped, newest valid, TTL-expired
// approvals + terminal/QA/foreign rows ignored) — identical to /cancel in WF22.
var sel=selectActiveRequest(plans,{owner_user_id:p.user_id,chat_id:p.chat_id,now_iso:new Date().toISOString()});
var text;
if(!sel.found){text=sel.has_delivered_report?'Сейчас активных запросов нет. Последний отчёт уже отправлен.':'Сейчас активных запросов нет. Напишите, что нужно изучить, — я подготовлю план анализа.';}
else{var p0=sel.request;var srcs=String(p0.sources||'').split(',').map(function(x){return x.trim();}).filter(Boolean);text=ruStatusReport({status:p0.status,sources:srcs});if(sel.active_count>1){text+='\\n\\nЕщё в работе: '+sel.others.map(planStatusLineRu).join('; ')+'.';}}
return [{json:{lane:'status',continue_heavy:false,has_reply:true,telegram_send_body:JSON.stringify({chat_id:String(p.chat_id||''),text:text})}}];`),
  ifNode('wf18-ifcmdreply', 'Command Reply?', [200, -220], '={{ $json.has_reply }}'),
  httpTelegram('wf18-sendcmd', 'Send Command Reply', [380, -300]),
  ifNode('wf18-ifcmdcont', 'Continue Heavy Path?', [380, -140], "={{ $('Command Lane').first().json.continue_heavy }}"),
  ifNode('wf18-ifcmdack', 'Callback Ack Needed?', [200, -360], '={{ !!$json.answer_callback_body }}'),
  httpTelegramAnswer('wf18-cmdanswer', 'Answer Command Callback', [380, -420]),
  // ---- shared safe-stop path (used by ingress reject AND duplicate): no business, fast 200, optional ack ----
  code('wf18-term', 'Terminate Safely', [-520, 260], ['telegram_io'], `
var inp=$json||{};var gate=inp.gate||{};
var dup=inp.duplicate===true;
var reason=dup?'duplicate':(gate.stop_reason||'stopped');
var ack=false,body='';
if(gate.ack_needed){ack=true;body=JSON.stringify(answerCallbackBody(gate.callback_query_id,dup?'Уже обработано.':'Доступ ограничен.'));}
return [{json:{terminated:true,reason:reason,ack:ack,answer_callback_body:body}}];`),
  ifNode('wf18-iftermack', 'Terminate Ack Needed?', [-300, 260], '={{ $json.ack }}'),
  httpTelegramAnswer('wf18-termack', 'Send Terminate Ack', [-80, 200]),
  // WEBHOOK-001: respond 200 IMMEDIATELY (Telegram never retries on a slow downstream); the Respond node passes
  // its input through, so all fail-closed processing + dispatch continues afterwards.
  respond('wf18-respond', 'Respond 200', [-1180, 200]),
  // ---- SHEETS-READ-AMPLIFICATION-001: ONE batchGet for the whole read phase; extractors project per tab ----
  httpSheetsBatchGet('wf18-batchread', 'Batch Read Sheets', [-740, -60],
    ['agent_request_events', 'conversation_state', 'conversation_messages', 'conversation_summaries', 'durable_memories', 'execution_plans']),
  // ---- ATOMIC idempotency claim BEFORE any persistence / dispatch (IDEMP-001): append-then-verify winner. A
  //      read-then-write check races under genuine concurrency; here every execution APPENDS a claim_candidate row
  //      first, then RE-READS, and the lowest physical row_number for the idempotency_key is the deterministic
  //      winner. Every loser (sequential OR concurrent) terminates before WF19/request/plan/state/send. ----
  sheetExtract('wf18-readev', 'Read agent_request_events', [-740, -60], 'agent_request_events'),
  code('wf18-mintclaim', 'Mint Claim', [-560, -60], ['idempotency_claim'], `
var g=$('Ingress Security Gate').first().json;var gate=g.gate;
var token=newClaimToken();
return [{json:claimEventRow({claim_token:token,idempotency_key:gate.idempotency_key,ts:new Date().toISOString()})}];`),
  sheetsAppend('wf18-appendclaim', 'Append Claim', [-380, -60], 'agent_request_events'),
  httpSheetsBatchGet('wf18-rereadclaims', 'Re-read Claims', [-200, -60], ['agent_request_events']),
  code('wf18-resolvewinner', 'Resolve Winner', [-20, -60], ['sheets_access', 'idempotency_claim'], `
var g=$('Ingress Security Gate').first().json;var gate=g.gate;
var myToken=$('Mint Claim').first().json.agent_request_id;
var rows=extractTab($('Re-read Claims').first().json,'agent_request_events').map(function(i){return i.json;});
var w=resolveClaimWinner(rows,gate.idempotency_key,myToken);
return [{json:{duplicate:w.is_duplicate,winner_token:w.winner_token,claim_verified:w.claim_verified,candidate_count:w.candidate_count,gate:gate,parsed:g.parsed,cfg:g.cfg}}];`),
  ifNode('wf18-ifnew', 'New Update?', [160, -60], '={{ !$json.duplicate }}'),
  // ---- owner-isolated reads (only after we know the update is accepted + new) ----
  sheetExtract('wf18-readstate', 'Read conversation_state', [140, -60], 'conversation_state'),
  sheetExtract('wf18-readmsg', 'Read conversation_messages', [360, -60], 'conversation_messages'),
  sheetExtract('wf18-readsum', 'Read conversation_summaries', [580, -60], 'conversation_summaries'),
  sheetExtract('wf18-readmem', 'Read durable_memories', [800, -60], 'durable_memories'),
  sheetExtract('wf18-readplans', 'Read execution_plans', [1020, -60], 'execution_plans'),
  code('wf18-route', 'Route Intent', [1240, -60], ['intent_router', 'agent_charter', 'telegram_io', 'request_planner'], `
var g=$('Ingress Security Gate').first().json;var cfg=g.cfg;var p=g.parsed;
function J(v){try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return v;}}
var convId='conv_'+String(p.chat_id||'')+'_'+String(p.user_id||'');
var stateRows=[];try{stateRows=($('Read conversation_state').all()||[]).map(function(r){return r.json;});}catch(e){}
var mine=stateRows.filter(function(r){return String(r.conversation_id)===convId&&String(r.owner_user_id)===String(p.user_id);});
mine.sort(function(a,b){var dr=(Number(b.revision)||0)-(Number(a.revision)||0);if(dr)return dr;return String(b.updated_at)<String(a.updated_at)?-1:1;});
var ctx=mine.length?Object.assign({},mine[0]):{};
if(ctx.last_report)ctx.last_report=J(ctx.last_report);
if(ctx.selected_competitors)ctx.selected_competitors=J(ctx.selected_competitors);
var routed=routeIntent(p,ctx,cfg);
var planRows=[];try{planRows=($('Read execution_plans').all()||[]).map(function(r){return r.json;});}catch(e){}
var pending=pendingPlansForOwner(planRows,p.user_id);
var ftSignal=(p.kind==='request')?freetextApprovalSignal(p.text):'';
var freetext_approval={signal:ftSignal,pending_count:pending.length,bound_request_id:'',ambiguous:false,nothing:false};
if(ftSignal){
  if(pending.length===1){var bound=pending[0];routed={route:'deterministic',intent:Object.assign({},routed.intent||{},{intent:bound.intent||'competitor_search',requested_action:ftSignal,from:'freetext'}),clarification:''};freetext_approval.bound_request_id=bound.agent_request_id;}
  else if(pending.length===0){freetext_approval.nothing=true;routed={route:'clarify',intent:{intent:'clarify_request',requested_action:'clarify'},clarification:'Сейчас нечего подтверждать — нет плана, ожидающего запуска.'};}
  else {freetext_approval.ambiguous=true;routed={route:'clarify',intent:{intent:'clarify_request',requested_action:'clarify'},clarification:'Есть несколько запросов на подтверждение — уточните, какой именно запустить.'};}
}
var caps=availableCapabilities(cfg);
var capId=routed.intent?routed.intent.intent:'clarify_request';
var cap=null;for(var i=0;i<caps.length;i++){if(caps[i].id===capId)cap=caps[i];}
return [{json:{parsed:p,conversation_id:convId,route:routed.route,intent:routed.intent,clarification:routed.clarification,capability:cap,capability_available:cap?cap.available:true,capability_execution_available:cap?cap.execution_available:true,freetext_approval:freetext_approval,ctx:ctx,cfg:cfg,charter:charterText()}}];`),
  code('wf18-intake', 'Build Intake Decision', [1460, -60], ['agent_state', 'request_planner'], `
var r=$('Route Intent').first().json;var p=r.parsed;var cfg=r.cfg;
var stamp=(new Date()).toISOString();
var intent=r.intent||{intent:'clarify_request',requested_action:'clarify'};
var action=intent.requested_action||'clarify';
var isCallback=p.kind==='callback';
var boundArid=(r.freetext_approval&&r.freetext_approval.bound_request_id)||'';
if(!boundArid&&isCallback&&p.callback_data){var m=String(p.callback_data).match(/^(approve|reject|cancel):(.+)$/);if(m)boundArid=m[2];}
// DISCOVERY-004: candidate-management callbacks (disc_add/disc_all/disc_more/disc_none:<run_id>) map to the
// WF22 'discovery' domain. disc_all -> list, others pass through. Overrides whatever routeIntent guessed.
var __disc=isCallback&&p.callback_data?String(p.callback_data).match(/^disc_(add|all|more|none):(.+)$/):null;
if(__disc){var __op=__disc[1]==='all'?'list':__disc[1];action='manage_discovery';intent={intent:'competitor_discovery',requested_action:'manage_discovery',entities:{disc_op:__op,run_id:__disc[2]}};}
var isLifecycle=(action==='approve'||action==='reject');
var arid=((isLifecycle||action==='cancel')&&boundArid)?boundArid:('req_'+(p.update_id||p.message_id||stamp.replace(/[^0-9]/g,'')));
var rec={agent_request_id:arid,update_id:p.update_id,chat_id:p.chat_id,user_id:p.user_id,owner_user_id:p.user_id,request_text:p.text||p.callback_data,kind:p.kind,intent:intent.intent,requested_action:action,idempotency_key:p.idempotency_key,plan_source:'',data_mode:cfg.report_data_mode||'live',created_at:stamp,state:'received'};
var t=transition(rec,'classified',{ts:stamp});
var request=t.record;
var planRowsAll=[];try{planRowsAll=($('Read execution_plans').all()||[]).map(function(x){return x.json;});}catch(e){}
var approval={ok:false,reason:'',plan:null};
var dispatch_target='local';var dispatch_reason=action;
if(action==='build_plan'){dispatch_target=(r.capability_available===true)?'wf19':'local';if(r.capability_available!==true)dispatch_reason='capability_unavailable';}
else if(action==='approve'){
  var planRow=null;for(var i=0;i<planRowsAll.length;i++){if(String(planRowsAll[i].agent_request_id)===String(arid)&&String(planRowsAll[i].status)==='awaiting_approval'){planRow=planRowsAll[i];}}
  var v=validateApproval(planRow,{owner_user_id:p.user_id,chat_id:p.chat_id,agent_request_id:arid});
  approval={ok:v.ok,reason:v.reason,plan:planRow};
  if(v.ok){dispatch_target=(String(planRow.intent).indexOf('deep')>=0)?'wf21':'wf20';}
  else{dispatch_target='local';dispatch_reason='approval_invalid:'+v.reason;}
}
else if(action==='reject'){dispatch_target='wf22';dispatch_reason='reject';}
else if(action==='cancel'||action==='status'||action==='manage_memory'||action==='manage_sources'||action==='manage_discovery'){dispatch_target='wf22';}
else if(action==='discovery'){dispatch_target='wf27';}
else if(['export_report','show_chart','show_evidence','filter_report','compare_periods'].indexOf(intent.intent)>=0){dispatch_target='wf24';}
else{dispatch_target='local';}
return [{json:{decision:'accepted',is_new_request:!isLifecycle,is_lifecycle:isLifecycle,request:request,intent:intent,action:action,event:t.event,dispatch_target:dispatch_target,dispatch_reason:dispatch_reason,approval:approval,routed:r,conversation_id:r.conversation_id}}];`),
  code('wf18-ctx', 'Build Conversation Context', [1680, -60], ['conversation_memory'], `
var d=$('Build Intake Decision').first().json;var r=d.routed;var cfg=r.cfg;var p=r.parsed||{};
var convId=d.conversation_id;var owner=String(p.user_id||'');
var newest=String((d.request&&d.request.request_text)||p.text||'');
var msgs=[];try{msgs=($('Read conversation_messages').all()||[]).map(function(x){return x.json;}).filter(function(m){return String(m.conversation_id)===convId;});}catch(e){}
msgs=msgs.concat([{role:'user',message_id:p.message_id,text:newest}]);
var win=recentWindow(msgs,cfg.recent_window||8);
var sumRows=[];try{sumRows=($('Read conversation_summaries').all()||[]).map(function(x){return x.json;});}catch(e){}
var prevSummary=selectLatestSummary(sumRows,convId,owner);
var summary_row=null;var did=false;
if(shouldSummarize(msgs,cfg)){var older=msgs.slice(0,msgs.length-win.length);if(older.length){var sum=rollingSummary(prevSummary,older,{ts:(new Date()).toISOString()});summary_row={conversation_id:convId,owner_user_id:owner,version:sum.version,prev_version:sum.prev_version,text:sum.text,preserved_ids:(sum.preserved_ids||[]).join(','),covers_message_ids:(sum.covers_message_ids||[]).join(','),decisions:JSON.stringify(sum.decisions||[]),entities:(sum.entities||[]).join(','),unresolved:(sum.unresolved||[]).join(','),created_at:sum.created_at};did=true;}}
var memRows=[];try{memRows=($('Read durable_memories').all()||[]).map(function(x){return x.json;});}catch(e){}
var durable=memoriesForUser(memRows,owner).map(function(m){return m.memory_type+':'+m.key+'='+(typeof m.value_json==='string'?m.value_json:JSON.stringify(m.value_json));}).join('\\n');
var artifacts='';
if(['report_followup','generate_ideas','compare_periods','export_report','show_chart','show_evidence','filter_report','deep_competitor_analysis'].indexOf((d.intent&&d.intent.intent))>=0){artifacts=(r.ctx&&r.ctx.last_report_id)?('last_report_id='+r.ctx.last_report_id):'';}
var recentText=win.map(function(m){return (m.role||'user')+': '+String(m.text||'');}).join('\\n');
var state='conv='+convId+' intent='+((d.intent&&d.intent.intent)||'')+' arid='+((d.request&&d.request.agent_request_id)||'')+' target='+d.dispatch_target;
var safety=cfg.require_approval!==false?'APPROVAL REQUIRED before paid/external work':'approval not required';
var sections={charter:r.charter,state:state,safety:safety,newest:newest,artifacts:artifacts,recent:recentText,summary:summary_row?summary_row.text:(prevSummary?prevSummary.text:''),summary_version:summary_row?summary_row.version:(prevSummary?prevSummary.version:0),durable:durable};
var ctxRes=buildContext(sections,cfg);
var usage=contextUsageRecord(ctxRes,{conversation_id:convId,agent_request_id:(d.request&&d.request.agent_request_id)||'',ts:(new Date()).toISOString()});
var prevState=selectLatestState(($('Read conversation_state').all()||[]).map(function(x){return x.json;}),convId,owner);
var state_row=advanceState(prevState,{conversation_id:convId,owner_user_id:owner,chat_id:p.chat_id,active_agent_request_id:(d.request&&d.request.agent_request_id)||'',current_intent:(d.intent&&d.intent.intent)||'',current_state:(d.request&&d.request.state)||'classified',pending_approval:false},(new Date()).toISOString());
return [{json:{context:ctxRes,context_usage:usage,decision:d,conversation_id:convId,owner_user_id:owner,summary_row:summary_row,did_summarize:did,state_row:state_row}}];`),
  // ---- shaped persistence (DATA-001): one explicit shape node per Append, only declared columns ----
  code('wf18-shapereq', 'Shape Agent Request Row', [1900, -260], ['telegram_io'], `
var d=$('Build Intake Decision').first().json;var req=d.request||{};var esc=escapeSheetValue;
return [{json:{agent_request_id:req.agent_request_id,update_id:req.update_id,chat_id:req.chat_id,user_id:req.user_id,request_text:esc(req.request_text),idempotency_key:req.idempotency_key,state:req.state,plan_source:req.plan_source||'',created_ts:req.created_at,updated_ts:req.created_at,created_at:req.created_at,requested_by:req.user_id,request_type:req.kind,query:esc(req.request_text),status:req.state,approval_required:((d.routed&&d.routed.cfg&&d.routed.cfg.require_approval)!==false),next_action:d.dispatch_target,notes:esc(d.dispatch_reason||'')}}];`),
  sheetsAppend('wf18-apreq', 'Append agent_requests', [2120, -260], 'agent_requests'),
  code('wf18-shapeev', 'Shape Agent Request Event Row', [1900, -120], [], `
var d=$('Build Intake Decision').first().json;var e=d.event||{};
return [{json:{agent_request_id:e.agent_request_id||(d.request&&d.request.agent_request_id),from_state:e.from_state,to_state:e.to_state,accepted:e.accepted,reason:e.reason||d.dispatch_reason||'',idempotency_key:(d.request&&d.request.idempotency_key)||'',ts:e.ts}}];`),
  sheetsAppend('wf18-apev', 'Append agent_request_events', [2120, -120], 'agent_request_events'),
  code('wf18-pstate', 'Persist State Row', [1900, 20], [], `
return [{json:$('Build Conversation Context').first().json.state_row}];`),
  sheetsUpsert('wf18-upstate', 'Upsert conversation_state', [2120, 20], 'conversation_state', 'conversation_id'),
  code('wf18-pmsg', 'Persist Message Row', [1900, 160], ['telegram_io'], `
var c=$('Build Conversation Context').first().json;var d=c.decision;var p=(d.routed&&d.routed.parsed)||{};
return [{json:{conversation_id:c.conversation_id,message_id:p.message_id,role:'user',text:escapeSheetValue(p.text||p.callback_data),intent:(d.intent&&d.intent.intent)||'',created_at:(new Date()).toISOString(),archived:false}}];`),
  sheetsAppend('wf18-apmsg', 'Append conversation_messages', [2120, 160], 'conversation_messages'),
  code('wf18-shapectx', 'Shape Context Usage Row', [1900, 300], [], `
return [{json:$('Build Conversation Context').first().json.context_usage}];`),
  sheetsAppend('wf18-apctx', 'Append context_usage', [2120, 300], 'context_usage'),
  // summary side-branch (non-critical audit)
  ifNode('wf18-ifsum', 'Summary Created?', [1900, 440], '={{ $json.did_summarize }}'),
  code('wf18-shapesum', 'Shape Summary Row', [2120, 440], [], `
var c=$('Build Conversation Context').first().json;return [{json:c.summary_row||{conversation_id:c.conversation_id,version:0}}];`),
  sheetsAppend('wf18-apsum', 'Append conversation_summaries', [2340, 440], 'conversation_summaries'),
  // ---- REAL dispatcher (RUNTIME-001/003): deterministic IF-chain on dispatch_target -> executeWorkflow ----
  ifNode('wf18-d19', 'Dispatch WF19?', [2340, -60], "={{ $('Build Intake Decision').first().json.dispatch_target === 'wf19' }}"),
  execWf('wf18-wf19', 'Run WF19 (Planner)', [2560, -200], 'WF19 request planner', {
    agent_request_id: "={{ $('Build Intake Decision').first().json.request.agent_request_id }}",
    chat_id: "={{ $('Build Intake Decision').first().json.request.chat_id }}",
    owner_user_id: "={{ $('Build Intake Decision').first().json.request.user_id }}",
    conversation_id: "={{ $('Build Intake Decision').first().json.conversation_id }}",
    request_text: "={{ $('Build Intake Decision').first().json.request.request_text }}",
    data_mode: "={{ $('Build Intake Decision').first().json.request.data_mode }}"
  }),
  code('wf18-planres', 'Handle Plan Result', [2780, -200], ['request_planner', 'telegram_io', 'plan_render_ru', 'cost_model'], `
var d=$('Build Intake Decision').first().json;var req=d.request||{};
var res=$json||{};
var status=res.status||(res.plan?'plan_ready':'planning_failed');
var p=(d.routed&&d.routed.parsed)||{};var chat=String(req.chat_id||p.chat_id||'');var owner=String(req.user_id||p.user_id||'');
if(status!=='plan_ready'||!res.plan){
  // WF19 supplies the honest human message (clarification OR no_active_sources fail-closed text)
  var ctext=res.user_message||res.clarification||'Не удалось построить план. Уточните запрос, пожалуйста.';
  return [{json:{plan_ready:false,status:status,telegram_send_body:JSON.stringify({chat_id:chat,text:ctext}),plan_row:null}}];
}
var plan=res.plan;
// B4: an EQUIVALENT non-terminal request must reuse the existing plan, not create a duplicate awaiting_approval.
var __existPlans=[];try{__existPlans=($('Read execution_plans').all()||[]).map(function(x){return x.json;});}catch(e){}
var __reuse=findReusablePlan(__existPlans,plan,{owner_user_id:owner,chat_id:chat},{ttl_min:30});
var __arid=String(req.agent_request_id),__planReused=false,ident;
if(__reuse.reused){__arid=String(__reuse.plan.agent_request_id||req.agent_request_id);__planReused=true;ident={plan_id:String(__reuse.plan.plan_id),plan_hash:String(__reuse.plan.plan_hash),plan_version:Number(__reuse.plan.plan_version)||1};}
else{ident=planIdentity(plan,req.agent_request_id,1);}
var planRow=buildPlanRow(plan,ident,{agent_request_id:__arid,owner_user_id:owner,chat_id:chat,ts:(new Date()).toISOString()});
var kb=approvalKeyboard(__arid);
// UX-RU-001: exactly ONE plan block — WF19's humanized text verbatim (fallback renders the same format), no suffix.
var cfg18=(d.routed&&d.routed.cfg)||{};
// CAP-CLAUDE-001: WF19 resolved the real AI capability from telemetry; carry it so this FALLBACK render quotes the
// same AI cost/promise as WF19's canonical text (a Code node cannot see the n8n credential itself).
var __cap=res.claude_capability||{};
if(__cap.available!=null)cfg18=Object.assign({},cfg18,{claude_available:__cap.available===true,claude_auth_mode:String(__cap.mode||'')});
var proj18=projectRequestCost(plan,cfg18);
var text=res.approval_text||planApprovalMessageRu(plan,{data_mode:String(req.data_mode||''),projected_cost_usd:proj18.projected_cost_usd,projected_reliable:proj18.reliable,cost:proj18}).text;
return [{json:{plan_ready:true,plan_reused:__planReused,status:'plan_ready',plan:plan,plan_id:ident.plan_id,plan_hash:ident.plan_hash,plan_row:planRow,agent_request_id:__arid,telegram_send_body:JSON.stringify({chat_id:chat,text:text,reply_markup:kb})}}];`),
  ifNode('wf18-ifplan', 'Plan Ready?', [3000, -200], '={{ $json.plan_ready }}'),
  code('wf18-shapeplan', 'Shape Plan Row', [3220, -300], [], `
return [{json:$('Handle Plan Result').first().json.plan_row}];`),
  ifNode('wf18-ifnewplan', 'Persist New Plan?', [3330, -300], "={{ $('Handle Plan Result').first().json.plan_reused !== true }}"),
  sheetsAppend('wf18-applan', 'Append execution_plans', [3440, -300], 'execution_plans'),
  code('wf18-shapeawait', 'Shape Awaiting State', [3660, -300], [], `
var c=$('Build Conversation Context').first().json;var h=$('Handle Plan Result').first().json;var base=c.state_row||{};
return [{json:Object.assign({},base,{current_state:'awaiting_approval',current_plan_id:h.plan_id,pending_approval:true,revision:(Number(base.revision)||1)+1,updated_at:(new Date()).toISOString()})}];`),
  sheetsUpsert('wf18-upawait', 'Upsert Awaiting State', [3880, -300], 'conversation_state', 'conversation_id'),
  code('wf18-planbody', 'Plan Reply Body', [4100, -300], [], `
return [{json:{telegram_send_body:$('Handle Plan Result').first().json.telegram_send_body}}];`),
  httpTelegram('wf18-sendplan', 'Send Plan Reply', [3220, -120]),
  ifNode('wf18-d20', 'Dispatch WF20?', [2340, 80], "={{ $('Build Intake Decision').first().json.dispatch_target === 'wf20' }}"),
  execWf('wf18-wf20', 'Run WF20 (Orchestrator)', [2560, 40], 'WF20 agent orchestrator', {
    agent_request_id: "={{ $('Build Intake Decision').first().json.request.agent_request_id }}",
    chat_id: "={{ $('Build Intake Decision').first().json.request.chat_id }}",
    owner_user_id: "={{ $('Build Intake Decision').first().json.request.user_id }}",
    conversation_id: "={{ $('Build Intake Decision').first().json.conversation_id }}",
    plan_id: "={{ ($('Build Intake Decision').first().json.approval.plan || {}).plan_id || '' }}",
    plan_hash: "={{ ($('Build Intake Decision').first().json.approval.plan || {}).plan_hash || '' }}",
    data_mode: "={{ $('Build Intake Decision').first().json.request.data_mode }}",
    state: 'approved',
    // PROGRESS-UNIFY-001: the "✅ Принято!" ack (sent upstream on this same branch) becomes WF20's ONE progress
    // message — WF20 edits it through stages instead of posting a second message. Empty on a failed ack -> WF20
    // falls back to sending its own progress message.
    progress_message_id: "={{ (($('Send Command Reply').first().json || {}).result || {}).message_id || '' }}"
  }),
  ifNode('wf18-d21', 'Dispatch WF21?', [2340, 220], "={{ $('Build Intake Decision').first().json.dispatch_target === 'wf21' }}"),
  execWf('wf18-wf21', 'Run WF21 (Deep Analysis)', [2560, 180], 'WF21 deep competitor analysis', {
    agent_request_id: "={{ $('Build Intake Decision').first().json.request.agent_request_id }}",
    chat_id: "={{ $('Build Intake Decision').first().json.request.chat_id }}",
    owner_user_id: "={{ $('Build Intake Decision').first().json.request.user_id }}",
    conversation_id: "={{ $('Build Intake Decision').first().json.conversation_id }}",
    plan_id: "={{ ($('Build Intake Decision').first().json.approval.plan || {}).plan_id || '' }}",
    plan_hash: "={{ ($('Build Intake Decision').first().json.approval.plan || {}).plan_hash || '' }}",
    data_mode: "={{ $('Build Intake Decision').first().json.request.data_mode }}",
    state: 'approved'
  }),
  ifNode('wf18-d22', 'Dispatch WF22?', [2340, 360], "={{ $('Build Intake Decision').first().json.dispatch_target === 'wf22' }}"),
  execWf('wf18-wf22', 'Run WF22 (Control)', [2560, 320], 'WF22 conversation control', {
    domain: "={{ ($('Build Intake Decision').first().json.action === 'manage_memory') ? 'memory' : (($('Build Intake Decision').first().json.action === 'manage_sources') ? 'source' : (($('Build Intake Decision').first().json.action === 'manage_discovery') ? 'discovery' : 'request')) }}",
    op: "={{ ($('Build Intake Decision').first().json.action === 'manage_discovery') ? (($('Build Intake Decision').first().json.intent.entities || {}).disc_op || 'list') : $('Build Intake Decision').first().json.action }}",
    arg: "={{ (($('Build Intake Decision').first().json.intent.entities || {}).run_id) || (($('Build Intake Decision').first().json.routed.intent || {}).entities || {}).arg || '' }}",
    text: "={{ $('Build Intake Decision').first().json.request.request_text }}",
    owner_user_id: "={{ $('Build Intake Decision').first().json.request.user_id }}",
    chat_id: "={{ $('Build Intake Decision').first().json.request.chat_id }}",
    agent_request_id: "={{ $('Build Intake Decision').first().json.request.agent_request_id }}",
    conversation_id: "={{ $('Build Intake Decision').first().json.conversation_id }}"
  }),
  ifNode('wf18-d24', 'Dispatch WF24?', [2340, 500], "={{ $('Build Intake Decision').first().json.dispatch_target === 'wf24' }}"),
  execWf('wf18-wf24', 'Run WF24 (Reporting)', [2560, 460], 'WF24 report export delivery', {
    owner_user_id: "={{ $('Build Intake Decision').first().json.request.user_id }}",
    agent_request_id: "={{ $('Build Intake Decision').first().json.request.agent_request_id }}",
    report_id: "={{ $('Build Intake Decision').first().json.routed.ctx.last_report_id || '' }}",
    action: "={{ $('Build Intake Decision').first().json.intent.intent }}",
    filter_text: "={{ $('Build Intake Decision').first().json.request.request_text }}",
    data_mode: "={{ $('Build Intake Decision').first().json.request.data_mode }}"
  }),
  // DISCOVERY-003: a discovery intent ("найди новых конкурентов …") dispatches to WF27 (Firecrawl Search).
  ifNode('wf18-d27', 'Dispatch WF27?', [2340, 640], "={{ $('Build Intake Decision').first().json.dispatch_target === 'wf27' }}"),
  execWf('wf18-wf27', 'Run WF27 (Discovery)', [2560, 600], 'WF27 competitor discovery', {
    agent_request_id: "={{ $('Build Intake Decision').first().json.request.agent_request_id }}",
    chat_id: "={{ $('Build Intake Decision').first().json.request.chat_id }}",
    owner_user_id: "={{ $('Build Intake Decision').first().json.request.user_id }}",
    text: "={{ $('Build Intake Decision').first().json.request.request_text }}",
    platform: "={{ (($('Build Intake Decision').first().json.routed.intent || {}).entities || {}).platform || '' }}",
    region: "={{ (($('Build Intake Decision').first().json.routed.intent || {}).entities || {}).region || '' }}",
    niche: "={{ (($('Build Intake Decision').first().json.routed.intent || {}).entities || {}).niche || '' }}",
    data_mode: "={{ $('Build Intake Decision').first().json.request.data_mode }}",
    auto_add: "={{ /(найди?\\s*и\\s*добав|добавь\\s*найден)/i.test($('Build Intake Decision').first().json.request.request_text || '') ? 'true' : '' }}"
  }),
  // local answer (help / clarify / answer-from-context / unavailable / invalid-approval) — WF18 owns this delivery
  code('wf18-reply', 'Build Conversational Reply', [2560, 620], ['conversation_response', 'agent_charter', 'plan_render_ru'], `
var d=$('Build Intake Decision').first().json;var r=d.routed;var cfg=r.cfg;
var chat=String((d.request&&d.request.chat_id)||(r.parsed&&r.parsed.chat_id)||'');
var caps=availableCapabilities(cfg);var text;
var utext=String((r.parsed&&r.parsed.text)||'');
// UX-RU-002: every user-visible branch renders through the canonical Russian layer (plan_render_ru).
// Internal reasons/enums (dispatch_reason, unavailable_reason, intent ids) stay in execution data only.
if(d.dispatch_reason&&d.dispatch_reason.indexOf('approval_invalid')===0){text='Это подтверждение нельзя применить: '+approvalFailureRu(d.dispatch_reason.replace('approval_invalid:',''))+'.';}
else if(d.dispatch_reason==='capability_unavailable'){text=ruCapabilityUnavailableMessage(r.capability);}
else if(r.route==='clarify'){text=clarificationReply(r.clarification);}
else if(d.intent&&d.intent.intent==='help'){
 if(d.intent.entities&&d.intent.entities.start){text=ruStartMessage();}
 else if(ruIsWhoAmI(utext)){text=ruWhoAmIMessage();}
 else{text=ruHelpMessage(caps);}
}
else{text=buildConversationalReply({understood:(r.capability&&r.capability.name)||ruIntentAny(d.intent&&d.intent.intent),next:'готов помочь'});}
return [{json:{telegram_send_body:JSON.stringify({chat_id:chat,text:text}),intent:(d.intent&&d.intent.intent)||'clarify_request',dispatch_target:d.dispatch_target}}];`),
  httpTelegram('wf18-send', 'Send Telegram Reply', [2780, 620])
], [
  ['Telegram Webhook', 'Respond 200'],
  ['Respond 200', 'Ingress Security Gate'],
  ['Ingress Security Gate', 'Ingress Accepted?'],
  ['Ingress Accepted?', 'Fast Static Lane', 0],
  ['Fast Static Lane', 'Duplicate Update?'],
  ['Duplicate Update?', 'Fast Static Reply?', 1],
  ['Fast Static Reply?', 'Send Fast Reply', 0],
  ['Fast Static Reply?', 'Batch Read Sheets', 1],
  ['Ingress Accepted?', 'Terminate Safely', 1],
  ['Batch Read Sheets', 'Read agent_request_events'],
  ['Read agent_request_events', 'Mint Claim'],
  ['Mint Claim', 'Append Claim'],
  ['Append Claim', 'Re-read Claims'],
  ['Re-read Claims', 'Resolve Winner'],
  ['Resolve Winner', 'New Update?'],
  ['New Update?', 'Command Lane', 0],
  ['Command Lane', 'Command Reply?'],
  ['Command Lane', 'Callback Ack Needed?'],
  ['Callback Ack Needed?', 'Answer Command Callback', 0],
  ['Command Reply?', 'Send Command Reply', 0],
  ['Command Reply?', 'Continue Heavy Path?', 1],
  ['Send Command Reply', 'Continue Heavy Path?'],
  ['Continue Heavy Path?', 'Read conversation_state', 0],
  ['New Update?', 'Terminate Safely', 1],
  ['Terminate Safely', 'Terminate Ack Needed?'],
  ['Terminate Ack Needed?', 'Send Terminate Ack', 0],
  ['Read conversation_state', 'Read conversation_messages'],
  ['Read conversation_messages', 'Read conversation_summaries'],
  ['Read conversation_summaries', 'Read durable_memories'],
  ['Read durable_memories', 'Read execution_plans'],
  ['Read execution_plans', 'Route Intent'],
  ['Route Intent', 'Build Intake Decision'],
  ['Build Intake Decision', 'Build Conversation Context'],
  ['Build Conversation Context', 'Shape Agent Request Row'],
  ['Shape Agent Request Row', 'Append agent_requests'],
  ['Append agent_requests', 'Shape Agent Request Event Row'],
  ['Shape Agent Request Event Row', 'Append agent_request_events'],
  ['Append agent_request_events', 'Persist State Row'],
  ['Persist State Row', 'Upsert conversation_state'],
  ['Upsert conversation_state', 'Persist Message Row'],
  ['Persist Message Row', 'Append conversation_messages'],
  ['Append conversation_messages', 'Shape Context Usage Row'],
  ['Shape Context Usage Row', 'Append context_usage'],
  ['Build Conversation Context', 'Summary Created?'],
  ['Summary Created?', 'Shape Summary Row', 0],
  ['Shape Summary Row', 'Append conversation_summaries'],
  ['Append context_usage', 'Dispatch WF19?'],
  ['Dispatch WF19?', 'Run WF19 (Planner)', 0],
  ['Dispatch WF19?', 'Dispatch WF20?', 1],
  ['Run WF19 (Planner)', 'Handle Plan Result'],
  ['Handle Plan Result', 'Plan Ready?'],
  ['Plan Ready?', 'Shape Plan Row', 0],
  ['Plan Ready?', 'Send Plan Reply', 1],
  ['Shape Plan Row', 'Persist New Plan?'],
  ['Persist New Plan?', 'Append execution_plans', 0],
  ['Persist New Plan?', 'Shape Awaiting State', 1],
  ['Append execution_plans', 'Shape Awaiting State'],
  ['Shape Awaiting State', 'Upsert Awaiting State'],
  ['Upsert Awaiting State', 'Plan Reply Body'],
  ['Plan Reply Body', 'Send Plan Reply'],
  ['Dispatch WF20?', 'Run WF20 (Orchestrator)', 0],
  ['Dispatch WF20?', 'Dispatch WF21?', 1],
  ['Dispatch WF21?', 'Run WF21 (Deep Analysis)', 0],
  ['Dispatch WF21?', 'Dispatch WF22?', 1],
  ['Dispatch WF22?', 'Run WF22 (Control)', 0],
  ['Dispatch WF22?', 'Dispatch WF24?', 1],
  ['Dispatch WF24?', 'Run WF24 (Reporting)', 0],
  ['Dispatch WF24?', 'Dispatch WF27?', 1],
  ['Dispatch WF27?', 'Run WF27 (Discovery)', 0],
  ['Dispatch WF27?', 'Build Conversational Reply', 1],
  ['Build Conversational Reply', 'Send Telegram Reply']
]));

// =========================================================================================== WF22 control
// Conversational control plane, CALLABLE + REAL persistence (WF22-CALLABLE/PERSIST/CANCEL-001):
//   memory (/new,/context,/memory,/forget,/forget_all), source (add/list/pause/resume/remove/check) and request
//   lifecycle (cancel/reject/status). Mutations are UPSERTED to the canonical stores (durable_memories /
//   tracked_sources / execution_plans) and the lifecycle event is appended; an audit row is written only AFTER
//   the mutation is applied (an audit never claims a change that did not happen). Per-user isolation; no secrets.
write('22_conversation_control.json', wf('22 — Conversation Control & Sources', [
  manual('wf22-trig', 'Manual Start', [-780, -160]),
  subTrigger('wf22-sub', 'When Called by Agent', [-780, 60], ['domain', 'op', 'arg', 'text', 'owner_user_id', 'chat_id', 'agent_request_id', 'conversation_id', 'confirmed']),
  code('wf22-cfg', 'Resolve Agent Config', [-560, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  sheetsRead('wf22-readmem', 'Read durable_memories', [-340, -160], 'durable_memories'),
  sheetsRead('wf22-readsrc', 'Read tracked_sources', [-340, 0], 'tracked_sources'),
  sheetsRead('wf22-readplans', 'Read execution_plans', [-340, 160], 'execution_plans'),
  sheetsRead('wf22-readcand', 'Read candidate_sources', [-340, 320], 'candidate_sources'),
  code('wf22-apply', 'Apply Control Command', [-120, 0], ['conversation_memory', 'tracked_sources', 'plan_render_ru', 'request_lifecycle'], CALLER + `
var cfg=$('Resolve Agent Config').first().json;
var inp=callerInput();var owner=String(inp.owner_user_id||'');
var ts=(new Date()).toISOString();
var memories=[];try{memories=($('Read durable_memories').all()||[]).map(function(r){return r.json;});}catch(e){}
var sources=[];try{sources=($('Read tracked_sources').all()||[]).map(function(r){return r.json;});}catch(e){}
var plans=[];try{plans=($('Read execution_plans').all()||[]).map(function(r){return r.json;});}catch(e){}
var candidates=[];try{candidates=($('Read candidate_sources').all()||[]).map(function(r){return r.json;});}catch(e){}
function truthy(v){return v===true||String(v).toLowerCase()==='true';}
// SOURCE-OP-001: WF18 dispatches the COARSE action ('manage_sources'); resolve the concrete sub-op (+arg) from the
// user's text so list/add/pause/resume/remove/check actually run instead of falling through to "not recognized".
if(inp.domain==='source'&&['add','list','pause','resume','remove','check'].indexOf(String(inp.op))<0){var __so=parseSourceOp(String(inp.text||inp.arg||''));inp.op=__so.op;if(!inp.arg)inp.arg=__so.arg;}
// MEMORY-INTENT-001: same for memory — the coarse action 'manage_memory' must resolve to a concrete op. NL memory
// questions default to 'view'; explicit forget/reset/new are detected from the text. (Slash commands already carry op.)
if(inp.domain==='memory'&&['memory','view','forget','forget_all','new','context'].indexOf(String(inp.op))<0){var __mt=String(inp.text||'').toLowerCase();inp.op=(/забудь\\s+(всё|все)|очисти\\s*памят|сотри\\s*всё|forget[_ ]?all/.test(__mt))?'forget_all':((/новый\\s+контекст|начн[иё]м\\s+заново|\\bnew\\b/.test(__mt))?'new':((/забудь(?:\\s|$)|удали\\s+из\\s+памяти/.test(__mt))?'forget':'view'));}
var out={domain:inp.domain,op:inp.op,owner_user_id:owner,chat_id:String(inp.chat_id||''),agent_request_id:String(inp.agent_request_id||''),reply:'',memory_audit:[],source_audit:[],changed_memories:[],changed_sources:[],changed_plans:[],request_event:null};
function diff(before,after,key){var b={};before.forEach(function(x){b[x[key]]=JSON.stringify(x);});return after.filter(function(x){return b[x[key]]!==JSON.stringify(x);});}
if(inp.domain==='memory'){
 if(inp.op==='memory'||inp.op==='view'){var mv=memoryView(memoriesForUser(memories,owner));var mvl=(mv||[]).map(function(m){var v=String(m.value||'');try{var pv=JSON.parse(v);v=typeof pv==='string'?pv:v;}catch(e){}return '• '+(m.key?String(m.key)+': ':'')+v;}).filter(function(t){return t.length>2;});out.reply=mvl.length?('Что я помню:\\n'+mvl.join('\\n')):'Пока я не сохранил явных предпочтений. Могу запомнить нишу, регион, источники или формат отчёта.';out.memory_view=mv;}
 else if(inp.op==='forget'){var f=forgetMemory(memories,inp.arg,{owner_user_id:owner,ts:ts});out.changed_memories=diff(memories,f.memories,'memory_id');out.memory_audit=f.audit;out.reply=f.removed?('Удалено: '+f.removed):'Не нашёл.';}
 else if(inp.op==='forget_all'){var fa=forgetAll(memories,{owner_user_id:owner,confirmed:inp.confirmed===true,ts:ts});if(!fa.ok){out.reply='Подтвердите удаление (/forget_all confirm).';}else{out.changed_memories=diff(memories,fa.memories,'memory_id');out.memory_audit=fa.audit;out.reply='Память очищена ('+fa.removed+').';}}
 else if(inp.op==='new'){out.reply='Новый контекст. Предпочтения сохранены.';}
 else if(inp.op==='context'){out.reply='Контекст: '+(inp.arg||'(пусто)');}
 else{out.reply='Команда памяти не распознана.';}
}else if(inp.domain==='source'){
 if(inp.op==='add'){var a=addSource(sources,inp.arg,{owner_user_id:owner,cfg:cfg,ts:ts});out.changed_sources=diff(sources,a.sources,'source_id');if(a.audit)out.source_audit=[a.audit];out.reply=a.added?('Источник добавлен: '+a.source.label+'. Буду проверять его на новые публикации.'):('Источник не добавлен: '+ruSourceOpFailure(a.reason)+'.');}
 else if(inp.op==='list'){var ls=listSources(sources,owner);out.reply=ls.length?('Отслеживаемые источники:\\n'+ls.map(function(s){return '• '+String(s.label||s.ref)+' — '+ruSourceStatusLabel(s.status);}).join('\\n')):'Пока нет отслеживаемых источников. Пришлите ссылку на сайт, канал или сообщество — я добавлю его в мониторинг.';}
 else if(inp.op==='pause'||inp.op==='resume'||inp.op==='remove'){var st=inp.op==='pause'?'paused':(inp.op==='resume'?'active':'removed');var r2=setSourceStatus(sources,inp.arg,st,{owner_user_id:owner,ts:ts});out.changed_sources=diff(sources,r2.sources,'source_id');if(r2.audit)out.source_audit=[r2.audit];var opRu={pause:'поставлен на паузу',resume:'снова активен',remove:'удалён из мониторинга'};out.reply=r2.changed?('Готово: источник '+(opRu[inp.op]||'обновлён')+'.'):('Не изменено: '+ruSourceOpFailure(r2.reason)+'.');}
 else if(inp.op==='check'){var ck=checkSource(sources,inp.arg,{owner_user_id:owner});out.source_check=ck;out.reply=(ck&&ck.found)?('Источник «'+String(ck.ref||inp.arg)+'» — '+ruSourceStatusLabel(ck.status)+'.'):'Такой источник не найден среди отслеживаемых.';}
 else{out.reply='Команда источников не распознана.';}
}else if(inp.domain==='request'){
 var arid=String(inp.agent_request_id||'');
 // STATUS-SELECT-001: /cancel and /status share the ONE canonical selector with WF18 (owner+chat scoped, newest
 // valid active, TTL-expired approvals + terminal/QA/foreign ignored). An explicit agent_request_id (from an
 // approve/reject/cancel callback) still targets that exact plan; otherwise the newest active request is chosen.
 var __selCancel=selectActiveRequest(plans,{owner_user_id:owner,chat_id:out.chat_id,now_iso:ts});
 // STATUS-SELECT-002: a callback (approve/reject/cancel:<plan>) binds a REAL plan agent_request_id; a TEXT command
 // carries the update's own id (req_<update_id>) which matches no plan — so only treat arid as an explicit target
 // when a plan with that id actually exists, otherwise fall back to the canonical newest-active selector.
 var __planForArid=arid?plans.filter(function(p){return String(p.owner_user_id)===owner&&String(p.agent_request_id)===arid;})[0]:null;
 if(inp.op==='cancel'){
  var tg=__planForArid?(rlIsActive(__planForArid.status)?__planForArid:null):__selCancel.request;
  if(!tg){out.reply='Сейчас нет активного запроса для отмены.';}
  else{out.changed_plans=[Object.assign({},tg,{status:'cancelled',decided_at:ts,decided_by:owner})];out.request_event={agent_request_id:tg.agent_request_id,from_state:tg.status,to_state:'cancelled',accepted:true,reason:'user_cancel',idempotency_key:'cancel::'+tg.plan_id,ts:ts};out.reply='Запрос отменён. Дальнейшие шаги выполняться не будут.';}
 }else if(inp.op==='reject'){
  var t2=__planForArid?(String(__planForArid.status)==='awaiting_approval'?__planForArid:null):((__selCancel.request&&String(__selCancel.request.status)==='awaiting_approval')?__selCancel.request:null);
  if(!t2){out.reply='Нет плана, ожидающего подтверждения.';}
  else{out.changed_plans=[Object.assign({},t2,{status:'rejected',decided_at:ts,decided_by:owner})];out.request_event={agent_request_id:t2.agent_request_id,from_state:'awaiting_approval',to_state:'cancelled',accepted:true,reason:'user_reject',idempotency_key:'reject::'+t2.plan_id,ts:ts};out.reply='План отклонён. Запуск не выполнен.';}
 }else if(inp.op==='status'){
  var __selStatus=selectActiveRequest(plans,{owner_user_id:owner,chat_id:out.chat_id,now_iso:ts});
  if(!__selStatus.found){out.reply=__selStatus.has_delivered_report?'Сейчас активных запросов нет. Последний отчёт уже отправлен.':'Сейчас активных запросов нет. Напишите, что нужно изучить, — я подготовлю план анализа.';}
  else{var p0=__selStatus.request;var srcs=String(p0.sources||'').split(',').map(function(x){return x.trim();}).filter(Boolean);
  out.reply=ruStatusReport({status:p0.status,sources:srcs});
  if(__selStatus.active_count>1){out.reply+='\\n\\nЕщё в работе: '+__selStatus.others.map(planStatusLineRu).join('; ')+'.';}}
 }else{out.reply='Команда не распознана.';}
}else if(inp.domain==='discovery'){
 // DISCOVERY-004: candidate buttons — add best competitors to monitoring / list all / dismiss / search-more guidance.
 var rid=String(inp.arg||'');
 var mine=candidates.filter(function(c){return String(c.owner_user_id)===owner&&String(c.discovery_run_id)===rid;});
 if(inp.op==='none'){out.reply=mine.length?('Хорошо, ничего не добавляю. '+mine.length+' кандидат(ов) сохранены — можно вернуться к ним позже.'):'Хорошо, ничего не добавляю.';}
 else if(inp.op==='more'){var q=(mine[0]&&mine[0].query_text)||'';out.reply='Чтобы расширить поиск, отправьте запрос ещё раз или уточните нишу/регион/площадку'+(q?(' (например: «'+q+'»)'):'')+'.';}
 else if(inp.op==='list'){
  if(!mine.length){out.reply='Кандидатов по этому запросу не найдено.';}
  else{var comp=mine.filter(function(c){return truthy(c.is_competitor);});var lead=mine.filter(function(c){return truthy(c.is_lead_source);});var oth=mine.filter(function(c){return !truthy(c.is_competitor)&&!truthy(c.is_lead_source);});
   function fmtc(c){return '• '+String(c.display_name||c.normalized_key)+(c.confidence?(' (уверенность '+c.confidence+'/100)'):'')+(c.classification_reason?(' — '+String(c.classification_reason).slice(0,70)):'');}
   var L=['Кандидаты по запросу ('+mine.length+'):'];
   if(comp.length){L.push('');L.push('Похожи на конкурентов:');comp.slice(0,10).forEach(function(c){L.push(fmtc(c));});}
   if(lead.length){L.push('');L.push('Сообщества с аудиторией:');lead.slice(0,5).forEach(function(c){L.push(fmtc(c));});}
   if(oth.length){L.push('');L.push('Прочее:');oth.slice(0,5).forEach(function(c){L.push(fmtc(c));});}
   out.reply=L.join('\\n');}
 }
 else if(inp.op==='add'){
  var thr=Number((cfg&&cfg.discovery_add_min_confidence)||60);
  // DISCOVERY-006 add policy: only VALIDATED, in-region competitors above threshold; never aggregators/directories/
  // news, never a region mismatch, never unvalidated, never already tracked.
  var pick=mine.filter(function(c){return truthy(c.is_competitor)&&!truthy(c.is_news_or_aggregator)&&String(c.region)!=='mismatch'&&String(c.quality_status)==='validated'&&Number(c.confidence||0)>=thr&&!truthy(c.already_tracked);});
  pick.sort(function(a,b){return (Number(b.confidence)||0)-(Number(a.confidence)||0);});
  var sk={};pick=pick.filter(function(c){var k=String(c.normalized_key).toLowerCase();if(!k||sk[k])return false;sk[k]=1;return true;}).slice(0,3);
  if(!pick.length){out.reply='Пока нечего добавить: среди кандидатов нет проверенных конкурентов с достаточной уверенностью. Можно посмотреть всех кандидатов («Показать всех кандидатов») или уточнить поиск.';}
  else{var sources0=sources.slice();var added=[],failed=[];
   pick.forEach(function(c){var ref=c.source_url||c.normalized_key||c.display_name;var a=addSource(sources,ref,{owner_user_id:owner,cfg:cfg,ts:ts});if(a.added){sources=a.sources;if(a.audit)out.source_audit.push(a.audit);added.push(a.source.label||c.display_name);}else{failed.push(String(c.display_name||ref)+(a.reason==='platform_unavailable'?' (площадка недоступна)':(a.reason==='duplicate'?' (уже отслеживается)':'')));}});
   out.changed_sources=diff(sources0,sources,'source_id');
   out.reply=added.length?('Добавил в мониторинг: '+added.join(', ')+'. Буду проверять их на новые публикации.'+(failed.length?('\\nНе удалось: '+failed.join(', ')+'.'):'')):('Не удалось добавить: '+(failed.join(', ')||'нет подходящих кандидатов')+'.');}
 }
 else{out.reply='Команда по кандидатам не распознана.';}
}else{out.reply='Неизвестный домен команды.';}
return [{json:out}];`),
  // ---- mutation branches (write to the canonical store BEFORE the audit) ----
  code('wf22-shapemem', 'Shape Memory Upserts', [120, -200], [],
    "return ($('Apply Control Command').first().json.changed_memories||[]).map(function(m){return {json:m};});"),
  sheetsUpsert('wf22-upmem', 'Upsert durable_memories', [340, -200], 'durable_memories', 'memory_id'),
  code('wf22-shapememaud', 'Shape Memory Audit', [560, -200], [],
    "return ($('Apply Control Command').first().json.memory_audit||[]).map(function(a){return {json:a};});"),
  sheetsAppend('wf22-apmem', 'Append memory_audit_events', [780, -200], 'memory_audit_events'),
  code('wf22-shapesrc', 'Shape Source Upserts', [120, -60], [],
    "return ($('Apply Control Command').first().json.changed_sources||[]).map(function(s){return {json:s};});"),
  sheetsUpsert('wf22-upsrc', 'Upsert tracked_sources', [340, -60], 'tracked_sources', 'source_id'),
  code('wf22-shapesrcaud', 'Shape Source Audit', [560, -60], [],
    "return ($('Apply Control Command').first().json.source_audit||[]).map(function(a){return {json:a};});"),
  sheetsAppend('wf22-apsrc', 'Append source_audit_events', [780, -60], 'source_audit_events'),
  code('wf22-shapeplan', 'Shape Plan Upserts', [120, 100], [],
    "return ($('Apply Control Command').first().json.changed_plans||[]).map(function(p){return {json:p};});"),
  sheetsUpsert('wf22-upplan', 'Upsert execution_plans', [340, 100], 'execution_plans', 'plan_id'),
  code('wf22-shapeev', 'Shape Request Event', [120, 240], [],
    "var ev=$('Apply Control Command').first().json.request_event;return ev?[{json:ev}]:[];"),
  sheetsAppend('wf22-apev', 'Append agent_request_events', [340, 240], 'agent_request_events'),
  code('wf22-reply', 'Build Control Reply', [120, 380], ['conversation_response'],
    "var o=$('Apply Control Command').first().json;\nvar chat=String(o.chat_id||'');\nvar body={chat_id:chat,text:clarificationReply(o.reply)};\nreturn [{json:{telegram_send_body:JSON.stringify(body),domain:o.domain,op:o.op}}];"),
  httpTelegram('wf22-send', 'Send Control Reply', [340, 380])
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['When Called by Agent', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Read durable_memories'],
  ['Read durable_memories', 'Read tracked_sources'],
  ['Read tracked_sources', 'Read execution_plans'],
  ['Read execution_plans', 'Read candidate_sources'],
  ['Read candidate_sources', 'Apply Control Command'],
  ['Apply Control Command', 'Shape Memory Upserts'],
  ['Shape Memory Upserts', 'Upsert durable_memories'],
  ['Upsert durable_memories', 'Shape Memory Audit'],
  ['Shape Memory Audit', 'Append memory_audit_events'],
  ['Apply Control Command', 'Shape Source Upserts'],
  ['Shape Source Upserts', 'Upsert tracked_sources'],
  ['Upsert tracked_sources', 'Shape Source Audit'],
  ['Shape Source Audit', 'Append source_audit_events'],
  ['Apply Control Command', 'Shape Plan Upserts'],
  ['Shape Plan Upserts', 'Upsert execution_plans'],
  ['Apply Control Command', 'Shape Request Event'],
  ['Shape Request Event', 'Append agent_request_events'],
  ['Apply Control Command', 'Build Control Reply'],
  ['Build Control Reply', 'Send Control Reply']
]));

// =========================================================================================== WF19 planner
write('19_request_planner.json', wf('19 — Request Planner (deterministic + guarded Claude)', [
  manual('wf19-trig', 'Manual Start', [-480, -160]),
  subTrigger('wf19-sub', 'When Called by Agent', [-480, 60], ['agent_request_id', 'chat_id', 'owner_user_id', 'conversation_id', 'request_text', 'data_mode']),
  code('wf19-cfg', 'Resolve Agent Config', [-260, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  // CAP-CLAUDE-001: production Claude auth is an n8n CREDENTIAL, invisible to a Code node — so the plan's AI cost
  // cannot be decided from MS_CLAUDE_API_KEY. The authoritative signal is our OWN telemetry: a recent call that
  // reached the provider proves the bound credential works; the newest auth_error proves it does not. Reads only
  // provider-outcome columns, never a secret and never another owner's analysis content.
  sheetsRead('wf19-readtel', 'Read llm_analysis_telemetry', [-260, 200], 'llm_analysis_telemetry'),
  code('wf19-det', 'Deterministic Plan', [-40, 0], ['request_planner', 'llm_capability'],
    CALLER + "\nvar ci=callerInput();\nvar cfg0=$('Resolve Agent Config').first().json;\nvar tel=[];try{tel=($('Read llm_analysis_telemetry').all()||[]).map(function(x){return x.json;});}catch(e){tel=[];}\n// Fold the observed AI capability into the config so cost_model + the RU renderer tell the same truth.\nvar cfg=withClaudeCapability(cfg0,tel,{});\nvar text=String(ci.request_text||ci.text||'');\nvar plan=deterministicPlan(text,cfg);\nreturn [{json:{request_text:text,agent_request_id:String(ci.agent_request_id||''),chat_id:String(ci.chat_id||''),owner_user_id:String(ci.owner_user_id||''),conversation_id:String(ci.conversation_id||''),data_mode:String(ci.data_mode||'live'),plan:plan,cfg:cfg,claude_capability:{available:cfg.claude_available,mode:cfg.claude_auth_mode,proof_at:cfg.claude_proof_at}}}];"),
  code('wf19-guard', 'Planner LLM Guard', [180, 0], ['approval_gate'],
    "var j=$('Deterministic Plan').first().json;var cfg=j.cfg;\nvar approvalTok=String(($json&&$json.planner_approval_token)||'');\nvar enabled=cfg.enable_llm_planner===true;\nvar tokOk=approvalTok==='WF19_PLANNER_APPROVED';\nvar budgetOk=Number(cfg.llm_budget_usd)>=0.01;\nvar call_llm=enabled&&tokOk&&budgetOk;\nvar reason=!enabled?'planner_llm_disabled':(!tokOk?'planner_token_invalid':(!budgetOk?'over_llm_budget':'ok'));\nreturn [{json:Object.assign({},j,{call_llm:call_llm,llm_guard_reason:reason})}];"),
  ifNode('wf19-if', 'LLM Planner Enabled?', [400, 0], '={{ $json.call_llm }}'),
  code('wf19-prompt', 'Build Planner Prompt', [620, -120], ['request_planner'],
    "var j=$('Planner LLM Guard').first().json;\nif(j.call_llm!==true){throw new Error('planner budget/guard: refused');}\nvar facts={request_text:j.request_text,allowlist:j.cfg.source_allowlist,default_region:j.cfg.default_region,default_niche:j.cfg.default_niche,max_items:j.cfg.max_items_per_source};\nvar sys='Return ONLY strict JSON for an execution plan: {intent,niche,service,region,sources[],max_items,max_external_calls,expected_output}. Use only allowlisted sources.';\nvar body={model:'claude-sonnet-4-6',max_tokens:512,system:sys,messages:[{role:'user',content:JSON.stringify(facts)}]};\nreturn [{json:Object.assign({},j,{claude_request_body:JSON.stringify(body)})}];"),
  httpClaude('wf19-claude', 'Claude Planner API Request', [840, -120]),
  code('wf19-validate', 'Validate Plan', [1060, -120], ['request_planner'],
    "var j=$('Build Planner Prompt').first().json;var cfg=j.cfg;\nvar text='';try{var c=($json&&$json.content)||[];for(var i=0;i<c.length;i++){if(c[i]&&c[i].type==='text')text+=String(c[i].text||'');}}catch(e){}\nvar v=validatePlanJSON(text,cfg);\nvar plan=v.valid?v.plan:deterministicPlan(j.request_text,cfg);\nreturn [{json:{plan:plan,plan_valid:v.valid,plan_reason:v.reason,plan_source:plan.plan_source,cfg:cfg}}];"),
  // Canonical planner RESULT (WF19-PLAN-002): one of plan_ready / clarification_required / planning_failed.
  // WF19 NEVER sends Telegram directly — WF18 owns the approval-message delivery and the durable plan persistence.
  code('wf19-approval', 'Build Approval Message', [840, 120], ['request_planner', 'telegram_io', 'scope_preview', 'plan_render_ru', 'cost_model'],
    "var src;try{src=$('Validate Plan').first().json;}catch(e){src=$('Deterministic Plan').first().json;}\nvar dp=$('Deterministic Plan').first().json;\nvar plan=src.plan;var cfg=src.cfg||{};\nif(!plan||!(plan.sources&&plan.sources.length)){return [{json:{status:'clarification_required',clarification:'Уточните нишу/регион и источник для поиска конкурентов.',user_message:'Уточните нишу/регион и источник для поиска конкурентов.',plan:null}}];}\nvar arid=String(dp.agent_request_id||'req_pending');\n// UX-RU-001: ONE humanized Russian approval block; internal enums/counters stay in plan rows + scope_preview (logs only).\n// §7 COST-UX-001: projection from the ACTUAL planned provider calls; the hard cap is never rendered.\nvar proj=projectRequestCost(plan,cfg);\nvar rend=planApprovalMessageRu(plan,{data_mode:String(dp.data_mode||''),projected_cost_usd:proj.projected_cost_usd,projected_reliable:proj.reliable,cost:proj});\nif(!rend.ok){return [{json:{status:rend.status,clarification:rend.text,user_message:rend.text,plan:null,agent_request_id:arid,chat_id:String(dp.chat_id||''),owner_user_id:String(dp.owner_user_id||'')}}];}\n// AVITO-BLOCK-001: if the user explicitly named a currently-blocked source (Avito), tell them honestly instead of silently dropping it.\nvar blockedReq=blockedRequestedSources(String(dp.request_text||''),cfg);\nif(blockedReq.indexOf('avito')>=0){rend.text=ruAvitoUnavailableMessage()+'\\n\\n'+rend.text;}\nvar kb=approvalKeyboard(arid);\n// structured scope+cost preview kept for logs/evidence — NEVER concatenated into the user message\nvar preview=buildScopePreview({goal:plan.intent||plan.expected_output,niche:plan.niche,region:plan.region,competitors:plan.competitors||[],platforms:plan.sources||['website'],cfg:cfg,refresh_plan:{expected_calls:Number(plan.max_external_calls)||0},expected_llm_calls:0,max_items:Number(plan.max_items)||undefined,outputs:{telegram_summary:true,xlsx:true,charts:true,evidence:true}});\nreturn [{json:{status:'plan_ready',plan:plan,plan_source:plan.plan_source,approval_text:rend.text,projected_cost_usd:proj.projected_cost_usd,projected_cost_reliable:proj.reliable,hard_cap_usd:proj.hard_cap_usd,cost_breakdown:proj.breakdown,scope_preview:preview,scope_preview_text:preview.text,approval_keyboard:kb,state_transition:'awaiting_approval',agent_request_id:arid,chat_id:String(dp.chat_id||''),owner_user_id:String(dp.owner_user_id||''),claude_capability:dp.claude_capability||{}}}];")
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['When Called by Agent', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Read llm_analysis_telemetry'],
  ['Read llm_analysis_telemetry', 'Deterministic Plan'],
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
  manual('wf20-trig', 'Manual Start', [-940, -180]),
  subTrigger('wf20-sub', 'When Called by Agent', [-940, 60], ['agent_request_id', 'chat_id', 'owner_user_id', 'conversation_id', 'plan_id', 'plan_hash', 'data_mode', 'state', 'enable_llm_summary', 'enable_llm_analysis', 'progress_message_id']),
  code('wf20-cfg', 'Resolve Agent Config', [-720, 0], ['agent_config'],
    ENV + "\n" + CALLER + "\n// DETERMINISTIC-RUN-001: a caller may force the paid LLM features OFF (fail-safe direction ONLY) for a bounded / deterministic run. It can NEVER enable an LLM feature and NEVER touches the allowlist, budgets, approval or any fail-closed gate — resolveConfig also independently pins llm off when enable_claude is false.\nvar __ci=callerInput();var __ov={};\nif(String(__ci.enable_llm_summary)==='false')__ov.enable_llm_summary=false;\nif(String(__ci.enable_llm_analysis)==='false')__ov.enable_llm_analysis=false;\nreturn [{json:resolveConfig(__env,__ov)}];"),
  // Stage 5 (PLAN-EXEC-001): the orchestrator executes the STORED approved plan, not a caller-supplied shape.
  // Fail-closed: missing plan / hash mismatch / not awaiting approval all block before any external call. The
  // plan is flipped to approved (decided_at) BEFORE collection so a second approval press can never re-run it.
  sheetsRead('wf20-readplans', 'Read execution_plans', [-720, 200], 'execution_plans'),
  code('wf20-planres', 'Resolve Approved Plan', [-610, 100], ['request_planner'],
    CALLER + "\nvar ci=callerInput();\nvar out={plan:null,plan_row:null,plan_blocked:false,plan_block_reason:'',plan_resolution:'none'};\nvar pid=String(ci.plan_id||'');\nif(pid){\n  var rows=[];try{rows=$('Read execution_plans').all().map(function(i){return i.json;});}catch(e){rows=[];}\n  var row=null;for(var i=0;i<rows.length;i++){if(String(rows[i].plan_id)===pid){row=rows[i];break;}}\n  if(!row){out.plan_blocked=true;out.plan_block_reason='no_plan';}\n  else if(String(ci.plan_hash||'')&&String(row.plan_hash)!==String(ci.plan_hash)){out.plan_blocked=true;out.plan_block_reason='plan_hash_mismatch';}\n  else if(String(row.status)!=='awaiting_approval'){out.plan_blocked=true;out.plan_block_reason='not_awaiting_approval:'+String(row.status);}\n  else{\n    out.plan={intent:String(row.intent||''),niche:String(row.niche||''),service:String(row.service||row.niche||''),region:String(row.region||''),sources:String(row.sources||'').split(',').map(function(x){return x.trim().toLowerCase();}).filter(Boolean),urls:String(row.urls||'').split(/\\s+/).map(function(x){return x.trim();}).filter(Boolean),telegram_channels:String(row.telegram_channels||'').split(',').map(function(x){return x.trim();}).filter(Boolean),vk_communities:String(row.vk_communities||'').split(',').map(function(x){return x.trim();}).filter(Boolean),explicit_sources:String(row.explicit_sources||'')==='true',max_items:Number(row.max_items)||10,max_external_calls:Number(row.max_external_calls)||0,est_source_cost_usd:Number(row.est_source_cost_usd)||0,est_llm_cost_usd:Number(row.est_llm_cost_usd)||0,expected_output:String(row.expected_output||''),plan_source:String(row.plan_source||'deterministic'),source_execution_mode:String(row.source_execution_mode||'auto'),force_reprocess:String(row.force_reprocess||'')==='true',refresh_reason:String(row.refresh_reason||'')};\n    out.plan_row=row;out.plan_resolution='resolved';\n  }\n}\n// PLAN-TERMINAL-001: a plain boolean for the approval-flip guard (an IF cannot reliably test a null object).\nout.needs_approval_flip=(out.plan_row!==null&&out.plan_blocked!==true);\nreturn [{json:out}];"),
  // PLAN-TERMINAL-001: the approval flip MUST be sequenced BEFORE collection, not left as a floating parallel
  // branch. n8n executionOrder v1 defers a side branch to the END of the run: live (WF20 exec 904) 'Mark Plan
  // Approved' ran at +112310ms — 1.9s AFTER 'Mark Plan Complete' at +110400ms — and overwrote status
  // completed -> approved. That both defeated this node's own stated intent (flip before collection, so a second
  // approval press cannot re-run it) and left every finished run non-terminal, so B4 reused it inside the TTL and
  // the next approval could never dispatch. Chaining it into the main path fixes both.
  ifNode('wf20-ifapprove', 'Plan To Approve?', [-610, 260], "={{ $('Resolve Approved Plan').first().json.needs_approval_flip === true }}"),
  code('wf20-planflip', 'Shape Plan Approval Upsert', [-500, 260], [],
    "var pr=$('Resolve Approved Plan').first().json;\nif(!pr.plan_row||pr.plan_blocked){return [];}\nreturn [{json:Object.assign({},pr.plan_row,{status:'approved',decided_at:(new Date()).toISOString(),decided_by:String(pr.plan_row.owner_user_id||'')})}];"),
  Object.assign(sheetsUpsert('wf20-markapproved', 'Mark Plan Approved', [-380, 260], 'execution_plans', 'plan_id'), { alwaysOutputData: true }),
  code('wf20-reuse', 'Orchestration Reuse Decision', [-500, 0], ['orchestration_policy'],
    CALLER + "\nvar cfg=$('Resolve Agent Config').first().json;\nvar ci=callerInput();\nvar inp;\nif(ci&&ci.request){inp=ci;}else{var st=String(ci.state||'approved');inp={request:{agent_request_id:String(ci.agent_request_id||'req'),chat_id:String(ci.chat_id||''),owner_user_id:String(ci.owner_user_id||''),state:st,approved:st==='approved',data_mode:String(ci.data_mode||'live'),plan_id:String(ci.plan_id||''),plan_hash:String(ci.plan_hash||'')},intent:{intent:'competitor_search',entities:{}},ctx:{conversation_id:String(ci.conversation_id||'')},plan:{sources:['website'],source:'website'}};}\nvar intent=inp.intent||{intent:(inp.request&&inp.request.intent)||'competitor_search',entities:inp.entities||{}};\nvar ctx=inp.ctx||{};\ntry{var rp=$('Resolve Approved Plan').first().json;if(rp){if(rp.plan)inp.plan=rp.plan;inp.plan_blocked=rp.plan_blocked===true;inp.plan_block_reason=String(rp.plan_block_reason||'');}}catch(e){}\nvar dec=reuseDecision({intent:intent,ctx:ctx,cfg:cfg,now:(new Date()).toISOString()});\nvar rec=decisionRecord(dec,{agent_request_id:(inp.request&&inp.request.agent_request_id)||'req',conversation_id:ctx.conversation_id||'',intent:intent.intent,ts:(new Date()).toISOString()});\nreturn [{json:Object.assign({},inp,{reuse_decision:dec,needs_external_call:dec.needs_external_call,orchestration_decision:rec,cfg:cfg})}];"),
  sheetsAppend('wf20-apdec', 'Append orchestration_decisions', [-500, 180], 'orchestration_decisions'),
  ifNode('wf20-needext', 'Needs External Call?', [-380, 0], '={{ $json.needs_external_call }}'),
  code('wf20-reuseresp', 'Build Reuse Response', [-160, 200], ['conversation_response'],
    "var inp=$json||{};var dec=inp.reuse_decision||{};\nvar chat=String((inp.request&&inp.request.chat_id)||'');\nvar text=buildConversationalReply({understood:(inp.intent&&inp.intent.intent)||'follow-up',result:'\\u041e\\u0442\\u0432\\u0435\\u0447\\u0430\\u044e \\u043f\\u043e \\u0443\\u0436\\u0435 \\u0441\\u043e\\u0431\\u0440\\u0430\\u043d\\u043d\\u044b\\u043c \\u0434\\u0430\\u043d\\u043d\\u044b\\u043c (\\u0431\\u0435\\u0437 \\u043d\\u043e\\u0432\\u044b\\u0445 \\u043f\\u043b\\u0430\\u0442\\u043d\\u044b\\u0445 \\u0432\\u044b\\u0437\\u043e\\u0432\\u043e\\u0432). \\u041f\\u0440\\u0438\\u0447\\u0438\\u043d\\u0430: '+(dec.reason||'reuse')+'.',next:'\\u043c\\u043e\\u0433\\u0443 \\u043f\\u043e\\u0434\\u0433\\u043e\\u0442\\u043e\\u0432\\u0438\\u0442\\u044c \\u0438\\u0434\\u0435\\u0438 \\u0438\\u043b\\u0438 \\u0441\\u0440\\u0430\\u0432\\u043d\\u0435\\u043d\\u0438\\u0435'});\nvar body={chat_id:chat,text:text};\nreturn [{json:{telegram_send_body:JSON.stringify(body),reuse_reason:dec.reason}}];"),
  httpTelegram('wf20-sendreuse', 'Send Reuse Reply', [60, 200]),
  code('wf20-gate', 'Approval & Budget Gate', [-160, -40], ['approval_gate', 'agent_state'],
    "var cfg=$('Resolve Agent Config').first().json;\nvar req=($json&&$json.request)?$json.request:($json||{});\nvar plan=($json&&$json.plan)?$json.plan:{source:'website',est_items:cfg.max_items_per_source,est_external_calls:5,est_source_cost_usd:0.05,est_llm_cost_usd:0.10};\nplan.source=plan.source||(plan.sources&&plan.sources[0])||'website';\nvar pb=false,pbr='';try{var rp=$('Resolve Approved Plan').first().json;pb=rp.plan_blocked===true;pbr=String(rp.plan_block_reason||'');}catch(e){}\nif(pb){return [{json:{gate_allowed:false,gate_reason:pbr||'plan_blocked',idempotency_key:'',plan:plan,request:req,cfg:cfg}}];}\nvar ctx={agent_request_id:req.agent_request_id||'req',state:req.state||'approved',approved:req.approved===true||req.state==='approved',cancelled:req.state==='cancelled'||req.cancelled===true,completed_keys:req.completed_keys||[],external_calls_made:0,source_spend_usd:0,llm_spend_usd:0};\nvar canCall=canMakeExternalCall(ctx.state);\nvar g=evaluateGate(plan,ctx,cfg);\nvar allowed=g.allowed&&canCall;\nreturn [{json:{gate_allowed:allowed,gate_reason:allowed?'ok':(g.reason||'state_blocks_external_call'),idempotency_key:g.idempotency_key,plan:plan,request:req,cfg:cfg}}];"),
  ifNode('wf20-if', 'Gate Allowed?', [-40, 0], '={{ $json.gate_allowed }}'),
  // Stage 5 fan-out: the APPROVED plan's sources drive which collectors run; each is flag-gated (agent_config
  // collectorEnabled), bounded by the plan, normalized to the ONE adapter contract, and a failed/disabled source
  // degrades to a partial result instead of aborting the request.
  code('wf20-colset', 'Resolve Collection Set', [60, -160], ['agent_config', 'scope_policy'],
    "var g=$('Approval & Budget Gate').first().json;var cfg=g.cfg||{};var plan=g.plan||{};\nvar want=(plan.sources||[]).map(function(x){return String(x).toLowerCase();});\nif(!want.length)want=['website'];\nvar per=Math.min(Number(plan.max_items)||10,Number(cfg.max_items_per_source)||25);\nfunction on(sk){return want.indexOf(sk)>=0&&collectorEnabled(cfg,sk);}\nvar set={website:on('website'),avito:on('avito'),telegram:on('telegram'),vk:on('vk')};\nvar unavailable=want.filter(function(sk){return !set[sk];});\n// URL-INTAKE-001: prefer user-supplied URLs (on the approved plan), then request urls, then preset competitors.\nvar urls=(plan.urls&&plan.urls.length)?plan.urls:((g.request&&g.request.urls&&g.request.urls.length)?g.request.urls:(cfg.website_competitor_urls||[]));\n// URL-INTAKE-002: prefer user-supplied Telegram channels / VK communities (on the approved plan) over presets.\nvar tgList=(plan.telegram_channels&&plan.telegram_channels.length)?plan.telegram_channels.map(function(c){return String(c).replace(/^@/,'');}):(cfg.telegram_channels||[]);\nvar vkList=(plan.vk_communities&&plan.vk_communities.length)?plan.vk_communities.map(function(c){return String(c).replace(/^vk\\.com\\//,'');}):(cfg.vk_communities||[]);\n// SOURCE-EXEC-001: an explicit approved refresh re-collects an already-registered url (bypasses ONLY freshness).\nvar forceReprocess=(plan.force_reprocess===true);\nvar __scope=resolveScope(plan,{});\nreturn [{json:{set:set,unavailable_sources:unavailable,per_source_items:per,website_urls:urls,force_reprocess:forceReprocess,source_execution_mode:String(plan.source_execution_mode||'auto'),scope_mode:__scope.scope_mode,apply_region_filter:__scope.apply_region_filter,region_filter:__scope.region_filter,requested_region:__scope.requested_region,avito_queries:(cfg.avito_queries||[]).join('; '),telegram_channels:tgList.join(','),vk_communities:vkList.slice(0,3),supplied_sources:{websites:(plan.urls||[]),telegram:(plan.telegram_channels||[]),vk:(plan.vk_communities||[]),explicit:plan.explicit_sources===true},data_mode:String((g.request&&g.request.data_mode)||'live'),request:g.request,cfg:cfg,idempotency_key:g.idempotency_key}}];"),
  ifNode('wf20-ifweb', 'Collect Website?', [280, -160], "={{ $('Resolve Collection Set').first().json.set.website }}"),
  execWf('wf20-wf04', 'Run Website Source (WF04)', [500, -260], 'WF04 firecrawl url list', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Approval & Budget Gate').first().json.idempotency_key }}",
    workflow_run_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    data_mode: "={{ $('Resolve Collection Set').first().json.data_mode }}",
    urls: "={{ $('Resolve Collection Set').first().json.website_urls }}",
    // SOURCE-EXEC-001: only an EXPLICIT, approved refresh bypasses the source freshness/dedup check. Default false.
    force_reprocess: "={{ $('Resolve Collection Set').first().json.force_reprocess === true ? 'true' : 'false' }}"
  }, { tolerant: true }),
  code('wf20-normweb', 'Normalize Website Result', [720, -260], ['source_adapter'],
    "var g=$('Approval & Budget Gate').first().json;\nvar raw=($json&&$json.live_source_run)?$json.live_source_run:($json||{});\nif(raw.source_cost_status&&!raw.cost_status)raw=Object.assign({},raw,{cost_status:raw.source_cost_status});\nif(raw.items_unique!=null&&raw.items_written==null)raw=Object.assign({},raw,{items_written:Number(raw.items_unique)||0});\nvar res=normalizeAdapterResult('website',raw,{agent_request_id:g.request.agent_request_id});\nreturn [{json:{adapter:res,plan:g.plan,request:g.request,cfg:g.cfg}}];"),
  ifNode('wf20-ifavito', 'Collect Avito?', [940, -160], "={{ $('Resolve Collection Set').first().json.set.avito }}"),
  execWf('wf20-wf09', 'Run Avito Source (WF09)', [1160, -260], 'WF09 avito classifieds connector', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Resolve Collection Set').first().json.idempotency_key + '::avito' }}",
    workflow_run_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    data_mode: "={{ $('Resolve Collection Set').first().json.data_mode }}",
    search_queries: "={{ $('Resolve Collection Set').first().json.avito_queries }}",
    max_items: "={{ $('Resolve Collection Set').first().json.per_source_items }}",
    approval_token: 'AVITO_LIVE_APPROVED',
    max_budget_usd: "={{ $('Approval & Budget Gate').first().json.plan.est_source_cost_usd || 0.5 }}"
  }, { tolerant: true }),
  code('wf20-normavito', 'Normalize Avito Result', [1380, -260], ['source_adapter'],
    "var g=$('Approval & Budget Gate').first().json;\nvar raw=($json&&$json.live_source_run)?$json.live_source_run:($json||{});\nif(raw.source_cost_status&&!raw.cost_status)raw=Object.assign({},raw,{cost_status:raw.source_cost_status});\nif(raw.items_unique!=null&&raw.items_written==null)raw=Object.assign({},raw,{items_written:Number(raw.items_unique)||0});\nvar res=normalizeAdapterResult('avito',raw,{agent_request_id:g.request.agent_request_id});\nreturn [{json:{adapter:res,plan:g.plan,request:g.request,cfg:g.cfg}}];"),
  ifNode('wf20-iftg', 'Collect Telegram?', [1600, -160], "={{ $('Resolve Collection Set').first().json.set.telegram }}"),
  execWf('wf20-wf11', 'Run Telegram Source (WF11)', [1820, -260], 'WF11 telegram public channel preview', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Resolve Collection Set').first().json.idempotency_key + '::telegram' }}",
    workflow_run_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    data_mode: "={{ $('Resolve Collection Set').first().json.data_mode }}",
    channels: "={{ $('Resolve Collection Set').first().json.telegram_channels }}",
    max_posts: "={{ $('Resolve Collection Set').first().json.per_source_items }}",
    approval_token: 'I_APPROVE_LIVE_TELEGRAM_PREVIEW',
    transport: 'http_get'
  }, { tolerant: true }),
  code('wf20-normtg', 'Normalize Telegram Result', [2040, -260], ['source_adapter'],
    "var g=$('Approval & Budget Gate').first().json;\nvar raw=($json&&$json.live_source_run)?$json.live_source_run:($json||{});\nif(raw.source_cost_status&&!raw.cost_status)raw=Object.assign({},raw,{cost_status:raw.source_cost_status});\nif(raw.items_unique!=null&&raw.items_written==null)raw=Object.assign({},raw,{items_written:Number(raw.items_unique)||0});\nvar res=normalizeAdapterResult('telegram',raw,{agent_request_id:g.request.agent_request_id});\nreturn [{json:{adapter:res,plan:g.plan,request:g.request,cfg:g.cfg}}];"),
  ifNode('wf20-ifvk', 'Collect VK?', [2260, -160], "={{ $('Resolve Collection Set').first().json.set.vk }}"),
  code('wf20-vktargets', 'Shape VK Targets', [2480, -260], [],
    "var rs=$('Resolve Collection Set').first().json;\nreturn (rs.vk_communities||[]).map(function(c){return {json:{community:String(c)}};});"),
  execWf('wf20-wf26', 'Run VK Source (WF26)', [2700, -260], 'WF26 VK public community collector', {
    owner_user_id: "={{ $('Approval & Budget Gate').first().json.request.owner_user_id || '' }}",
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Resolve Collection Set').first().json.idempotency_key + '::vk::' + $json.community }}",
    workflow_run_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    community: "={{ $json.community }}",
    data_mode: "={{ $('Resolve Collection Set').first().json.data_mode }}",
    mode: 'agent'
  }, { tolerant: true }),
  code('wf20-normvk', 'Normalize VK Result', [2920, -260], ['source_adapter'],
    "var g=$('Approval & Budget Gate').first().json;\nvar items=[];try{items=$input.all().map(function(i){return i.json;});}catch(e){items=[$json||{}];}\nvar recv=0,written=0,calls=0,errs=[];\nitems.forEach(function(it){var r=(it&&it.live_source_run)?it.live_source_run:(it||{});recv+=Number(r.items_received)||0;written+=Number(r.items_written!=null?r.items_written:(r.items_unique!=null?r.items_unique:r.items_received))||0;calls+=Number(r.external_calls)||0;[].concat(r.errors||[]).forEach(function(x){if(x)errs.push(String(x));});if(r.error)errs.push(String(r.error));});\nvar raw={agent_request_id:g.request.agent_request_id,items_received:recv,items_written:written,external_calls:calls,errors:errs,cost_status:'free_tier'};\nvar res=normalizeAdapterResult('vk',raw,{agent_request_id:g.request.agent_request_id});\nreturn [{json:{adapter:res,plan:g.plan,request:g.request,cfg:g.cfg}}];"),
  execWf('wf20-wf16', 'Run WF16 Quality Gate', [3140, -160], 'WF16 source quality gate', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Approval & Budget Gate').first().json.idempotency_key }}",
    data_mode: "={{ $('Resolve Collection Set').first().json.data_mode }}",
    platform_filter: '',
    // WF16-WRITE-001: agent runs must PERSIST source_health — WF10/WF12 gate on it fail-closed.
    write_result: 'true'
  }),
  execWf('wf20-wf08', 'Run WF08 Analyzer', [840, -160], 'WF08 touchpoint analyzer', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Approval & Budget Gate').first().json.idempotency_key }}",
    data_mode: "={{ $('Approval & Budget Gate').first().json.request.data_mode || 'live' }}",
    // WF08-LLMAGENT-001: unarmed agent runs degrade every record to review_queue/report_eligible=false and the
    // report is no_data. Plan approval covers this LLM budget; WF08 keeps its own token/budget/kill-switch guards.
    // WF08-LLM-GATE-001: gated on its OWN default-OFF flag, NOT enable_llm_analysis. WF08's per-record classifier
    // costs one 16-28s Claude call PER RECORD (~12/run) on the pre-Stage-F transport, and cost_model only quotes it
    // when enable_wf08_llm is set — so riding on the Stage-F flag would spend materially more than the user approved.
    llm_enabled: "={{ $('Approval & Budget Gate').first().json.cfg.enable_wf08_llm === true ? 'true' : 'false' }}",
    llm_approval_token: 'WF08_LLM_APPROVED'
  }),
  execWf('wf20-wf10', 'Run WF10 Aggregator', [1060, -160], 'WF10 audience aggregator', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    source_run_id: "={{ $('Approval & Budget Gate').first().json.idempotency_key }}",
    data_mode: "={{ $('Approval & Budget Gate').first().json.request.data_mode || 'live' }}",
    // EXPLICIT-SOURCE-SCOPE-001: the region_filter comes from the ONE canonical scope policy (Resolve Collection
    // Set -> scope_policy.resolveScope), never from an ad-hoc ternary here. explicit_source/comparison/monitoring
    // pass ANY (the named source IS the scope); discovery/niche-scan still pass the real requested region.
    region_filter: "={{ $('Resolve Collection Set').first().json.region_filter }}"
  }),
  execWf('wf20-wf12', 'Run WF12 Report', [1280, -160], 'WF12 report builder', {
    agent_request_id: "={{ $('Approval & Budget Gate').first().json.request.agent_request_id }}",
    data_mode: "={{ $('Approval & Budget Gate').first().json.request.data_mode || 'live' }}",
    // URL-INTAKE-002: pass the user-supplied sources so the report is scoped to them ("Проверенные источники").
    supplied_sources: "={{ JSON.stringify($('Resolve Collection Set').first().json.supplied_sources || {}) }}",
    // Plan approval covers the guarded Claude RU summary; WF12 still enforces its own budget/endpoint guards.
    enable_llm_summary: "={{ $('Approval & Budget Gate').first().json.cfg.enable_llm_summary === false ? 'false' : 'true' }}",
    llm_approval_token: 'I_APPROVE_CLAUDE_REPORT_SUMMARY'
  }),
  // ---- Stage F: evidence-bound Claude analysis of the deterministic result (STAGE-F-INTEGRATION) --------------
  // Placed AFTER collection + WF16 quality gate + WF08/WF10 + WF12, so Claude only ever sees bounded, quality-gated,
  // request-scoped CURRENT-RUN facts — never raw pages and never the whole Sheets history. Fail-open by
  // construction: every downstream node reads WF12 by NAME, so a disabled/empty/failed analysis still delivers the
  // full deterministic report + XLSX.
  code('wf20-anainputs', 'Build Analysis Inputs', [1500, -320], ['analysis_bridge', 'agent_config'], `
var g=$('Approval & Budget Gate').first().json;var cfg=g.cfg||{};
var rep={};try{rep=$('Run WF12 Report').first().json||{};}catch(e){rep={};}
var b={};try{b=JSON.parse(String(rep.report_bundle||'{}'));}catch(e){b={};}
var rs={};try{rs=$('Resolve Collection Set').first().json||{};}catch(e){rs={};}
var plan=g.plan||{};var req=g.request||{};
// Stage-F rollout gate (default OFF). WF28 re-checks it independently — this only avoids a pointless child call.
var enabled=(cfg.enable_claude!==false)&&(cfg.enable_llm_analysis===true);
var ctx={agent_request_id:String(req.agent_request_id||''),owner_user_id:String(req.owner_user_id||''),chat_id:String(req.chat_id||''),
  report_id:String(rep.report_id||b.report_id||''),niche:String(plan.niche||b.niche||''),region:String(plan.region||b.region||''),
  data_mode:String(req.data_mode||'live'),requested_sources:(plan.sources||[])};
var built=buildAnalysisTargets(b,ctx,{max_targets:Number(cfg.llm_max_analyses_per_run)||5});
var targets=enabled?built.targets:[];
return [{json:{do_analyze:targets.length>0,analysis_reason:enabled?built.reason:'disabled',
  targets:targets.map(function(t){return {source_key:t.source_key,source_kind:t.source_kind,
    evidence_input:JSON.stringify(t.evidence_input),agent_request_id:ctx.agent_request_id,owner_user_id:ctx.owner_user_id,
    chat_id:ctx.chat_id,report_id:ctx.report_id,niche:ctx.niche,region:ctx.region,
    source_run_id:String(g.idempotency_key||'')+'::'+t.source_key};}),
  targets_considered:built.considered}}];`),
  ifNode('wf20-ifana', 'Analyze Sources?', [1720, -320], '={{ $json.do_analyze }}'),
  code('wf20-anashape', 'Shape Analysis Targets', [1940, -400], [],
    "return ($('Build Analysis Inputs').first().json.targets||[]).map(function(t){return {json:t};});"),
  // One WF28 call per LOGICAL SOURCE (the executeWorkflow node runs once per input item — same fan-out the VK
  // collector already uses). tolerant: a crashed analyst degrades to the deterministic report, never aborts the run.
  execWf('wf20-wf28', 'Run WF28 (Claude Analyst)', [2160, -400], 'WF28 claude analyst', {
    agent_request_id: '={{ $json.agent_request_id }}',
    source_run_id: '={{ $json.source_run_id }}',
    report_id: '={{ $json.report_id }}',
    owner_user_id: '={{ $json.owner_user_id }}',
    chat_id: '={{ $json.chat_id }}',
    analysis_type: 'single_source',
    evidence_input: '={{ $json.evidence_input }}',
    niche: '={{ $json.niche }}',
    region: '={{ $json.region }}'
  }, { tolerant: true }),
  code('wf20-anamerge', 'Merge Analyses', [2380, -320], ['analysis_bridge'], `
var rets=[];try{rets=($('Run WF28 (Claude Analyst)').all()||[]).map(function(i){return i.json;});}catch(e){rets=[];}
var ai={};try{ai=$('Build Analysis Inputs').first().json||{};}catch(e){ai={};}
var col=collectAnalyses(rets);
return [{json:{analysis:Object.assign({},col,{reason:String(ai.analysis_reason||'disabled'),requested:(ai.targets||[]).length})}}];`),
  code('wf20-summary', 'Build Execution Summary', [2600, -320], ['source_adapter', 'execution_summary', 'cost_model'],
    "var g=$('Approval & Budget Gate').first().json;\nvar adapters=[];\n['Normalize Website Result','Normalize Avito Result','Normalize Telegram Result','Normalize VK Result'].forEach(function(nm){try{var a=$(nm).first().json;if(a&&a.adapter)adapters.push(a.adapter);}catch(e){}});\nvar rs=null;try{rs=$('Resolve Collection Set').first().json;}catch(e){rs=null;}\n((rs&&rs.unavailable_sources)||[]).forEach(function(sk){adapters.push({agent_request_id:g.request.agent_request_id,source:sk,source_family:'unknown',platform:sk,status:'failed',errors:['collector_unavailable'],items_written:0,items_received:0,quarantined:false});});\nvar n={adapter:adapters[0]||null,plan:g.plan,request:g.request,cfg:g.cfg};\nvar roll=rollupCollection(adapters,(n.plan&&n.plan.sources)||[]);\n// STAGE-F-INTEGRATION: the Stage-F analysis chain now sits between WF12 and here, so $json is the merged analysis.\n// Read the report from WF12 BY NAME — the deterministic report must never depend on what the analyst returned.\nvar rep={};try{rep=$('Run WF12 Report').first().json||{};}catch(e){rep={};}\nvar ana={};try{ana=($('Merge Analyses').first().json||{}).analysis||{};}catch(e){ana={};}\nvar summary=buildExecutionSummary({config_complete:(n.cfg&&n.cfg.config_complete),request:Object.assign({},n.request,{state:roll.outcome==='complete'?'reporting':(roll.outcome==='failed'?'failed':'partial'),failed_sources:roll.failed_sources||[]}),plan:n.plan,collection:roll,adapters:adapters,analysis:{records_unique:rep.records_unique,records_eligible:rep.records_eligible,records_analyzed:rep.records_analyzed,llm_primary_calls:rep.llm_primary_calls,llm_repair_calls:rep.llm_repair_calls,llm_cost_status:rep.llm_cost_status||'unknown'},aggregation:{rows_after_filters:rep.rows_after_filters},report:rep,delivery:{}});\n// §7: persist projected/actual cost + remaining budget (best-available: observed provider calls x configured unit prices).\nvar usage={firecrawl_pages:0,apify_searches:0,claude_calls:0};\nadapters.forEach(function(a){var c=Number(a.external_calls)||0;if(a.source==='website')usage.firecrawl_pages+=c;if(a.source==='avito')usage.apify_searches+=c;});\nusage.claude_calls=(Number(rep.llm_primary_calls)||0)+(Number(rep.llm_repair_calls)||0)+(Number(rep.llm_cost_usd)>0?1:0);\nif(Number(rep.llm_cost_usd)>0)usage.measured_llm_cost_usd=(Number(rep.llm_cost_usd)||0)+((Number(rep.llm_primary_calls)||0)+(Number(rep.llm_repair_calls)||0))*(Number(n.cfg&&n.cfg.cost_claude_call_usd)||0.02);\n// Stage F: WF28's REAL per-call cost (from response usage tokens) is its own actual component (§4).\nusage.claude_analysis_cost_usd=Number(ana.analysis_cost_usd)||0;\nvar proj=projectRequestCost(g.plan,n.cfg);\nvar act=actualRequestCost(usage,n.cfg);\nsummary=Object.assign({},summary,{projected_cost_usd:proj.projected_cost_usd,hard_cap_usd:act.hard_cap_usd,actual_cost_usd:act.actual_cost_usd,remaining_budget_usd:act.remaining_budget_usd,actual_collection_usd:act.actual_collection_usd,actual_ai_usd:act.actual_ai_usd,llm_analyses:Number(ana.count_enriched)||0,llm_analyses_reused:Number(ana.count_reused)||0,llm_analyses_fallback:Number(ana.count_fallback)||0});\nreturn [{json:{summary:summary,report:rep,request:n.request,cfg:n.cfg,analysis:ana}}];"),
  code('wf20-outbox', 'Build Delivery Outbox', [2820, -320], ['telegram_io', 'conversation_response', 'agent_charter', 'analysis_report_ru'],
    "var s=$('Build Execution Summary').first().json;\nvar cfg=s.cfg||{};\nvar caps=availableCapabilities(cfg);\nvar chat=String((s.request&&s.request.chat_id)||'');\nvar state=String((s.summary&&s.summary.final_state)||'completed');\nvar noData=Number((s.summary&&s.summary.records_reported)||0)===0&&state!=='completed';\nvar stateForActions=noData?'no_data':state;\nvar report=s.report||{};\n// Stage F §5: EXTEND the deterministic report with «Подтверждённые факты / Аналитические выводы / Рекомендации /\n// Доказательства и ограничения». Ungrounded claims are dropped by the renderer; a failed/disabled analyst yields\n// no sections (or one honest note) and the deterministic markdown ships unchanged — delivery is never blocked.\nvar __md=String(report.report_markdown||'');\ntry{var __b={};try{__b=JSON.parse(String(report.report_bundle||'{}'));}catch(e){__b={};}\nvar __rend=renderAnalysisSectionsRu(((s.analysis||{}).analyses)||[],__b,{});\n__md=appendAnalysisToReportRu(__md,__rend);}catch(e){}\nvar body=deliveryBody({report_markdown:__md,summary_text:report.summary_text},s.summary,caps);\nvar ptxt=proactiveText(stateForActions,caps);\nvar dlv=makeDelivery((s.request&&s.request.agent_request_id)||'req',(report.report_id)||'rep',chat,body);\nvar chunks=chunkMessage(body);\nvar kb=proactiveKeyboard(stateForActions,caps);\nvar bodies=chunks.map(function(t,i){var b={chat_id:chat,text:t};if(i===chunks.length-1&&kb)b.reply_markup=kb;return b;});\nreturn [{json:{delivery:dlv,telegram_send_body:JSON.stringify(bodies[0]),telegram_send_bodies:JSON.stringify(bodies),final_keyboard:kb?JSON.stringify(kb):'',chunk_count:chunks.length,proactive_text:ptxt,summary:s.summary}}];"),
  sheetsAppend('wf20-apout', 'Append telegram_outbox', [1940, -160], 'telegram_outbox'),
  httpTelegram('wf20-send', 'Send Telegram Report', [2160, -160]),
  code('wf20-shapesum', 'Shape Execution Summary Row', [1500, 60], [],
    "var s=$('Build Execution Summary').first().json;return [{json:s.summary}];"),
  sheetsAppend('wf20-apsum', 'Append execution_summaries', [1720, 60], 'execution_summaries'),
  // STATUS-TTL-002: mark the plan TERMINAL after the report is built, so /status/​/cancel never show a delivered
  // run as still "готовится запуск". completed on data, no_data on an empty run, failed on a failure.
  code('wf20-planclose', 'Shape Plan Completion', [1940, 60], [],
    "var pr=null;try{pr=$('Resolve Approved Plan').first().json;}catch(e){}\nif(!pr||!pr.plan_row||pr.plan_blocked){return [];}\nvar s=$('Build Execution Summary').first().json;var st=String((s.summary&&s.summary.final_state)||'completed');\nvar term=(st==='no_data')?'no_data':((st==='failed'||st==='error')?'failed':'completed');\nvar ts=(new Date()).toISOString();\nreturn [{json:Object.assign({},pr.plan_row,{status:term,decided_at:ts,decided_by:String(pr.plan_row.owner_user_id||'')})}];"),
  sheetsUpsert('wf20-markcomplete', 'Mark Plan Complete', [2160, 60], 'execution_plans', 'plan_id'),
  // EXPORT-BUNDLE-001: nothing wrote report_bundles, so WF24 export/XLSX had no report to select. WF20 is
  // the producer: persist the WF12-built structured bundle (owner-stamped) after each run.
  code('wf20-shapebundle', 'Shape Report Bundle', [1940, 60], ['analysis_report_ru'], `
var s=$('Build Execution Summary').first().json;
var rep=s.report||{};var req=s.request||{};
var b={};try{b=JSON.parse(String(rep.report_bundle||'{}'));}catch(e){b={};}
b.report_id=String(rep.report_id||b.report_id||'');
b.agent_request_id=String(req.agent_request_id||b.agent_request_id||'');
b.owner_user_id=String(req.owner_user_id||'');
if(!b.created_at)b.created_at=(new Date()).toISOString();
// Stage F §6: the bundle is the single source for BOTH the live XLSX and WF24's later export, so the analysis
// rows live here. Grounded rows only; analysis_id/telemetry are consumed exclusively by the HIDDEN technical sheet.
try{var __ana=s.analysis||{};var __rend=renderAnalysisSectionsRu(__ana.analyses||[],b,{});
var __x=analysisXlsxData(__ana.analyses||[],__rend);
if((__x.inferences||[]).length||(__x.recommendations||[]).length||(__x.pains||[]).length||(__x.evidence||[]).length){
  b.analysis=Object.assign({},__x,{analysis_ids:__ana.analysis_ids||[],count_enriched:Number(__ana.count_enriched)||0,
    count_reused:Number(__ana.count_reused)||0,count_fallback:Number(__ana.count_fallback)||0,
    analysis_cost_usd:Number(__ana.analysis_cost_usd)||0,model:String((s.cfg&&s.cfg.llm_model)||'claude-sonnet-4-6')});
}}catch(e){}
return [{json:{report_id:b.report_id,owner_user_id:b.owner_user_id,agent_request_id:b.agent_request_id,created_at:String(b.created_at),report_type:String(rep.report_type||''),bundle:JSON.stringify(b),notes:'wf20 run bundle (export/digest source)'}}];`),
  sheetsAppend('wf20-apbundle', 'Append report_bundles', [2160, 60], 'report_bundles'),
  // DEFECT-5: the plan promises "таблица Excel" — auto-deliver the XLSX right after the report for an approved
  // analysis run (only when the run has data; an empty workbook is never sent). Same bundle -> counts agree.
  code('wf20-xlsx', 'Build Report XLSX', [2380, 160], ['report_export', 'xlsx_writer', 'report_package'], `
var sb=$('Shape Report Bundle').first().json;
var b={};try{b=JSON.parse(String(sb.bundle||'{}'));}catch(e){b={};}
var s=$('Build Execution Summary').first().json;var summary=s.summary||{};
var records=Number(summary.records_reported||0);
var __an=b.analysis||{};
var hasContent=(b.competitors&&b.competitors.length)||(b.offers&&b.offers.length)||(b.evidence&&b.evidence.length)||records>0
  ||((__an.inferences||[]).length+(__an.recommendations||[]).length+(__an.pains||[]).length)>0;
if(!hasContent||!b.report_id){return [];}
var chat=String((s.request&&s.request.chat_id)||b.owner_user_id||'');
var scope={owner_user_id:String(b.owner_user_id||''),agent_request_id:String(b.agent_request_id||''),report_id:String(b.report_id||'')};
var pkg;try{pkg=buildReportPackage(b,scope,{omit_empty:true});}catch(e){return [];}
return [{json:{chat_id:chat,caption:'Таблица Excel по анализу конкурентов',xlsx_filename:pkg.filename,xlsx_sheets:pkg.sheet_names},binary:{attachment:{data:Buffer.from(pkg.buffer).toString('base64'),fileName:pkg.filename,mimeType:pkg.mime}}}];`),
  Object.assign(httpTelegramFile('wf20-sendxlsx', 'Send Report XLSX', [2600, 160], 'sendDocument', 'document', 'attachment'), { onError: 'continueRegularOutput' }),
  // REPORT-CONTEXT-001: last_report_id was never persisted, so export/followup intents always failed the
  // history gate. Persist it on the conversation state row (same conv_<chat>_<user> key WF18 derives).
  code('wf20-shapectx2', 'Shape Report Context', [2380, 60], [], `
var s=$('Build Execution Summary').first().json;
var rep=s.report||{};var req=s.request||{};
var convId='conv_'+String(req.chat_id||'')+'_'+String(req.owner_user_id||'');
return [{json:{conversation_id:convId,owner_user_id:String(req.owner_user_id||''),last_report_id:String(rep.report_id||''),active_agent_request_id:String(req.agent_request_id||''),updated_at:(new Date()).toISOString()}}];`),
  sheetsUpsert('wf20-upctx2', 'Upsert Report Context', [2600, 60], 'conversation_state', 'conversation_id'),
  code('wf20-blocked', 'Build Blocked Response', [180, 160], ['telegram_io', 'plan_render_ru'],
    "var g=$('Approval & Budget Gate').first().json;\nvar chat=String((g.request&&g.request.chat_id)||'');\nvar human=approvalFailureRu(g.gate_reason);\nif(human==='подтверждение устарело или не может быть применено'&&!/no_plan|mismatch|not_awaiting/.test(String(g.gate_reason))){human='лимиты бюджета или настройки источников не позволяют запуск сейчас';}\nvar body={chat_id:chat,text:'Запрос не запущен: '+human+'.'};\nreturn [{json:{telegram_send_body:JSON.stringify(body),gate_reason:g.gate_reason}}];"),
  httpTelegram('wf20-sendblock', 'Send Blocked Reply', [400, 160]),
  // one progress message per request (created here; later stages EDIT the same message id; final report is a
  // SEPARATE idempotent delivery via the outbox). Runs as a parallel branch off the allowed gate.
  // PROGRESS-UNIFY-001: WF18 already posted the "✅ Принято!" ack and passes its message_id. When present we EDIT
  // that same message into the progress line (one chat message end-to-end, ending "✅ Анализ завершён"); when
  // absent (manual run / ack send failed) we fall back to sending a NEW progress message — worst case = prior
  // behaviour, never worse. The method is chosen dynamically so a single Send Progress node handles both.
  code('wf20-progress', 'Build Progress Update', [180, -300], ['progress_tracker'],
    "var g=$('Approval & Budget Gate').first().json;\nvar chat=String((g.request&&g.request.chat_id)||'');\nvar seedMid='';try{seedMid=String(($('When Called by Agent').first().json||{}).progress_message_id||'');}catch(e){}\nvar st=initProgress({agent_request_id:(g.request&&g.request.agent_request_id)||'req',chat_id:chat});\nif(seedMid)st=setMessageId(st,seedMid);\nvar up=advance(st,2,{now:(new Date()).toISOString()});\nvar body=seedMid?{chat_id:chat,message_id:Number(seedMid),text:up.text}:{chat_id:chat,text:up.text};\nvar method=seedMid?'editMessageText':'sendMessage';\nreturn [{json:{telegram_send_body:JSON.stringify(body),tg_method:method,seed_message_id:seedMid,progress_state:up.state,progress_action:up.action,is_final_delivery:up.is_final_delivery}}];"),
  Object.assign(httpTelegramDynamic('wf20-sendprogress', 'Send Progress', [400, -300]), { onError: 'continueRegularOutput' }),
  // §9 PROGRESS-EDIT-001: the ONE progress message (created above) is EDITED at each real stage transition.
  // Each editor rebuilds the tracker state (init + setMessageId from the Send Progress response) and advances
  // to a hardcoded distinct stage — advance() throttles any repeat, so there is never per-item spam. A missing
  // message_id (progress send failed) or a Telegram edit error degrades silently (onError continue) — progress
  // is UX, never a run-killer. Final report delivery stays a SEPARATE idempotent message.
  ...[[4, 'Quality Gate', 660], [5, 'Analysis', 880], [6, 'Comparison', 1100], [7, 'Report', 1320], [10, 'Done', 2380]].flatMap(function (sp) {
    var stage = sp[0], label = sp[1], x = sp[2];
    var slug = label.toLowerCase().replace(/[^a-z]+/g, '');
    return [
      code('wf20-prog' + slug, 'Progress: ' + label, [x, -340], ['progress_tracker'],
        "var g=$('Approval & Budget Gate').first().json;\nvar chat=String((g.request&&g.request.chat_id)||'');\nvar mid='';try{mid=String(($('When Called by Agent').first().json||{}).progress_message_id||'');}catch(e){}\nif(!mid){try{var r=$('Send Progress').first().json;mid=String(((r||{}).result||{}).message_id||'');}catch(e){}}\nvar st=initProgress({agent_request_id:(g.request&&g.request.agent_request_id)||'req',chat_id:chat});\nst.stage=" + (stage - 1) + ";st.status='running';\nst=setMessageId(st,mid);\nvar up=advance(st," + stage + ",{now:(new Date()).toISOString()});\nif(!mid||up.action!=='edit'){return [{json:{progress_skipped:true,telegram_edit_body:JSON.stringify({})}}];}\nreturn [{json:{progress_skipped:false,progress_stage:" + stage + ",telegram_edit_body:JSON.stringify({chat_id:chat,message_id:Number(mid),text:" + (stage === 10 ? "'✅ Анализ завершён. Отчёт отправлен ниже.'" : 'up.text') + "})}}];"),
      Object.assign(httpTelegramEdit('wf20-editprog' + slug, 'Edit Progress (' + label + ')', [x + 110, -340]), { onError: 'continueRegularOutput' })
    ];
  })
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['When Called by Agent', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Read execution_plans'],
  ['Read execution_plans', 'Resolve Approved Plan'],
  ['Resolve Approved Plan', 'Plan To Approve?'],
  ['Plan To Approve?', 'Shape Plan Approval Upsert', 0],
  ['Plan To Approve?', 'Orchestration Reuse Decision', 1],
  ['Shape Plan Approval Upsert', 'Mark Plan Approved'],
  ['Mark Plan Approved', 'Orchestration Reuse Decision'],
  ['Orchestration Reuse Decision', 'Append orchestration_decisions'],
  ['Append orchestration_decisions', 'Needs External Call?'],
  ['Needs External Call?', 'Approval & Budget Gate', 0],
  ['Needs External Call?', 'Build Reuse Response', 1],
  ['Build Reuse Response', 'Send Reuse Reply'],
  ['Approval & Budget Gate', 'Gate Allowed?'],
  ['Gate Allowed?', 'Resolve Collection Set', 0],
  ['Gate Allowed?', 'Build Progress Update', 0],
  ['Build Progress Update', 'Send Progress'],
  ['Gate Allowed?', 'Build Blocked Response', 1],
  ['Resolve Collection Set', 'Collect Website?'],
  ['Collect Website?', 'Run Website Source (WF04)', 0],
  ['Collect Website?', 'Collect Avito?', 1],
  ['Run Website Source (WF04)', 'Normalize Website Result'],
  ['Normalize Website Result', 'Collect Avito?'],
  ['Collect Avito?', 'Run Avito Source (WF09)', 0],
  ['Collect Avito?', 'Collect Telegram?', 1],
  ['Run Avito Source (WF09)', 'Normalize Avito Result'],
  ['Normalize Avito Result', 'Collect Telegram?'],
  ['Collect Telegram?', 'Run Telegram Source (WF11)', 0],
  ['Collect Telegram?', 'Collect VK?', 1],
  ['Run Telegram Source (WF11)', 'Normalize Telegram Result'],
  ['Normalize Telegram Result', 'Collect VK?'],
  ['Collect VK?', 'Shape VK Targets', 0],
  ['Collect VK?', 'Progress: Quality Gate', 1],
  ['Progress: Quality Gate', 'Edit Progress (Quality Gate)'],
  ['Edit Progress (Quality Gate)', 'Run WF16 Quality Gate'],
  ['Shape VK Targets', 'Run VK Source (WF26)'],
  ['Run VK Source (WF26)', 'Normalize VK Result'],
  ['Normalize VK Result', 'Progress: Quality Gate'],
  ['Run WF16 Quality Gate', 'Progress: Analysis'],
  ['Progress: Analysis', 'Edit Progress (Analysis)'],
  ['Edit Progress (Analysis)', 'Run WF08 Analyzer'],
  ['Run WF08 Analyzer', 'Progress: Comparison'],
  ['Progress: Comparison', 'Edit Progress (Comparison)'],
  ['Edit Progress (Comparison)', 'Run WF10 Aggregator'],
  ['Run WF10 Aggregator', 'Progress: Report'],
  ['Progress: Report', 'Edit Progress (Report)'],
  ['Edit Progress (Report)', 'Run WF12 Report'],
  // Stage F: the analysis chain sits between the report build and the summary. BOTH branches of "Analyze Sources?"
  // converge on Merge Analyses, so the run always reaches Build Execution Summary — with or without Claude.
  ['Run WF12 Report', 'Build Analysis Inputs'],
  ['Build Analysis Inputs', 'Analyze Sources?'],
  ['Analyze Sources?', 'Shape Analysis Targets', 0],
  ['Analyze Sources?', 'Merge Analyses', 1],
  ['Shape Analysis Targets', 'Run WF28 (Claude Analyst)'],
  ['Run WF28 (Claude Analyst)', 'Merge Analyses'],
  ['Merge Analyses', 'Build Execution Summary'],
  ['Build Execution Summary', 'Build Delivery Outbox'],
  ['Build Execution Summary', 'Shape Execution Summary Row'],
  ['Build Execution Summary', 'Shape Plan Completion'],
  ['Shape Plan Completion', 'Mark Plan Complete'],
  ['Shape Execution Summary Row', 'Append execution_summaries'],
  ['Append execution_summaries', 'Shape Report Bundle'],
  ['Shape Report Bundle', 'Append report_bundles'],
  ['Append report_bundles', 'Shape Report Context'],
  ['Append report_bundles', 'Build Report XLSX'],
  ['Build Report XLSX', 'Send Report XLSX'],
  ['Shape Report Context', 'Upsert Report Context'],
  ['Build Delivery Outbox', 'Append telegram_outbox'],
  ['Append telegram_outbox', 'Send Telegram Report'],
  ['Send Telegram Report', 'Progress: Done'],
  ['Progress: Done', 'Edit Progress (Done)'],
  ['Build Blocked Response', 'Send Blocked Reply']
]));

// =========================================================================================== WF21 deep analysis
// Bounded deep competitor analysis: build an explicit, approval-gated plan that degrades gracefully across only
// the configured sources; collect; separate evidence-backed FACTS from RECOMMENDATIONS; deliver.
write('21_deep_competitor_analysis.json', wf('21 — Deep Competitor Analysis (bounded, evidence-based)', [
  manual('wf21-trig', 'Manual Start', [-820, -160]),
  subTrigger('wf21-sub', 'When Called by Agent', [-820, 60], ['agent_request_id', 'chat_id', 'owner_user_id', 'conversation_id', 'plan_id', 'plan_hash', 'competitors', 'data_mode', 'state']),
  code('wf21-cfg', 'Resolve Agent Config', [-600, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  sheetsRead('wf21-readsrc', 'Read tracked_sources', [-380, 160], 'tracked_sources'),
  code('wf21-plan', 'Build Deep Plan', [-160, 0], ['deep_analysis', 'agent_charter'],
    CALLER + "\nvar cfg=$('Resolve Agent Config').first().json;\nvar inp=callerInput();\nfunction J(v){try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return v;}}\nvar comps=Array.isArray(inp.competitors)?inp.competitors:(inp.competitors?J(inp.competitors):[]);\nvar tracked=[];try{tracked=($('Read tracked_sources').all()||[]).map(function(r){return r.json;});}catch(e){}\nvar plan=buildDeepPlan({competitors:comps||[],requested_platforms:inp.requested_platforms||['website'],cfg:cfg,history_available:inp.history_available===true,tracked_sources:tracked});\nvar caps=availableCapabilities(cfg);var cap=null;for(var i=0;i<caps.length;i++){if(caps[i].id==='deep_competitor_analysis')cap=caps[i];}\nvar req=inp.request||{agent_request_id:String(inp.agent_request_id||'req'),chat_id:String(inp.chat_id||''),owner_user_id:String(inp.owner_user_id||''),data_mode:String(inp.data_mode||'live'),state:String(inp.state||'approved'),approved:inp.approved===true||String(inp.state||'approved')==='approved'};\nreturn [{json:{deep_plan:plan,capability:cap,capability_available:cap?cap.available:true,request:req,cfg:cfg}}];"),
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
  code('wf21-blocked', 'Build Deep Blocked Reply', [500, 160], ['conversation_response', 'plan_render_ru'],
    "var g=$('Deep Approval & Budget Gate').first().json;\nvar chat=String((g.request&&g.request.chat_id)||'');\n// UX-RU-002: gate_reason is an internal code (logs only); the user sees a Russian action-oriented message.\nvar human=(String(g.gate_reason)==='capability_unavailable')?'эта функция пока настраивается':'настройки источников или лимиты не позволяют начать сбор';\nvar body={chat_id:chat,text:clarificationReply('Глубокий анализ сейчас не запущен: '+human+'. Могу подготовить обычный план анализа — напишите, что изучить.')};\nreturn [{json:{telegram_send_body:JSON.stringify(body),gate_reason:g.gate_reason}}];"),
  httpTelegram('wf21-sendblock', 'Send Deep Blocked', [720, 160])
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['When Called by Agent', 'Resolve Agent Config'],
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
${CALLER}
// EXPORT-CHAT-001: the caller (owner/agent_request_id/report_id) MUST come from the trigger. The upstream Google
// Sheets Read nodes replace $json with sheet rows, so reading $json here loses the caller and leaves the delivery
// chat_id empty (Telegram 400 "chat_id is empty") — the reason the export was never delivered. Use callerInput().
var inp=callerInput();
var owner=String(inp.owner_user_id||'');var arid=String(inp.agent_request_id||'');var rid=String(inp.report_id||'');
var action=String(inp.action||'export');var filter_text=String(inp.filter_text||'');
function J(v){try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return v;}}
var rows=[];try{rows=($('Read report_bundles').all()||[]).map(function(r){return r.json;});}catch(e){}
var match=null;
// EXPORT-SCOPE-001: the OWNER is the isolation boundary. An explicit report_id selects exactly; without
// one, export the caller's NEWEST bundle. The export request's own agent_request_id differs from the
// report's — scope derives from the MATCHED bundle, never from the caller's request id.
for(var i=0;i<rows.length;i++){var b=J(rows[i].bundle||rows[i].report_bundle||rows[i]);
  if(!b||String(b.owner_user_id)!==owner||!String(b.report_id||''))continue;
  if(rid){if(String(b.report_id)===rid){match=b;break;}continue;}
  if(!match||String(b.created_at||'')>String(match.created_at||''))match=b;}
if(!match&&inp.report_bundle)match=J(inp.report_bundle);
if(!match)throw new Error('report not found / out of scope: '+owner+'/'+arid+'/'+rid);
var scope={owner_user_id:owner||String(match.owner_user_id),agent_request_id:String(match.agent_request_id),report_id:String(match.report_id)};
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
  code('wf24-exports', 'Build Exports & Outbox', [220, 40], ['report_export', 'xlsx_writer', 'report_package', 'report_charts', 'attachment_router', 'telegram_io'], `
var s=$('Apply Action').first().json;var b=s.bundle;var scope=s.scope;
var csv=exportCsv(b,'report',scope);
var pkg=buildReportPackage(b,scope,{omit_empty:true});
var chart=renderChart(b,'competitor_score',scope);
var existing=[];try{existing=($('Read attachment_outbox').all()||[]).map(function(r){return r.json;});}catch(e){}
var xlsxDeliv=attachmentDelivery(scope,'xlsx',pkg.size_bytes+'|'+pkg.sheet_names.join(','));
var csvDeliv=attachmentDelivery(scope,'csv',csv.content);
var chartDeliv=attachmentDelivery(scope,'chart',chart.svg||chart.title||'chart');
var xlsxSend=shouldSendAttachment(existing,xlsxDeliv);var chartSend=shouldSendAttachment(existing,chartDeliv);
// QA-004: route every attachment through the canonical MIME policy (fail-closed). The chart is SVG (vector) so it
// MUST go via sendDocument, never sendPhoto; the XLSX workbook is a document too.
var chartMime=chart.mime||'image/svg+xml';
var docRoute=routeAttachment(pkg.mime);
var chartRoute=routeAttachment(chartMime);
var json={scope:scope,csv_filename:csv.filename,csv_row_count:csv.row_count,xlsx_filename:pkg.filename,xlsx_size:pkg.size_bytes,xlsx_sheets:pkg.sheet_names,chart_title:chart.title,chart_mime:chartMime,chart_insufficient:!!chart.insufficient_data,doc_api_method:docRoute.api_method,doc_form_field:docRoute.form_field,chart_api_method:chartRoute.api_method,chart_form_field:chartRoute.form_field,chat_id:String(scope.owner_user_id||''),caption:'Отчёт по анализу конкурентов',attachment_deliveries:[xlsxDeliv,csvDeliv,chartDeliv],xlsx_should_send:xlsxSend.send,chart_should_send:chartSend.send,external_calls:0};
return [{json:json,binary:{attachment:{data:Buffer.from(pkg.buffer).toString('base64'),fileName:pkg.filename,mimeType:pkg.mime},chart:{data:Buffer.from(String(chart.svg||''),'utf8').toString('base64'),fileName:'chart.svg',mimeType:chartMime}}}];`),
  httpTelegramFile('wf24-senddoc', 'Send Document', [440, -60], 'sendDocument', 'document', 'attachment'),
  // EXPORT-CHART-001: the chart is a best-effort EXTRA. When the report has no chartable numeric series the
  // chart binary is absent — sending must degrade silently (never error the run after the XLSX already went out).
  Object.assign(httpTelegramFile('wf24-sendchart', 'Send Chart (SVG via sendDocument)', [440, 120], 'sendDocument', 'document', 'chart'), { onError: 'continueRegularOutput' }),
  code('wf24-outrows', 'Shape Attachment Outbox', [440, 280], [], `
var e=$('Build Exports & Outbox').first().json;
return (e.attachment_deliveries||[]).map(function(d){return {json:d};});`),
  sheetsAppend('wf24-apout', 'Append attachment_outbox', [660, 280], 'attachment_outbox'),
  code('wf24-reply', 'Build Result Reply', [660, 40], [], `
var s=$('Apply Action').first().json;var e=$('Build Exports & Outbox').first().json;var r=s.result||{};
var chat=String(s.scope.owner_user_id||'');
// UX-RU-002: report/baseline ids and reason codes stay in execution data; the user sees business wording.
var lines=['Готово. Отчёт по анализу конкурентов:'];
if(r.action==='filter'&&r.filtered){lines.push('После фильтра: '+(r.filtered.competitors||[]).length+' конкурентов, '+(r.filtered.offers||[]).length+' предложений.');}
else if(r.action==='evidence'&&r.evidence){lines.push('Подтверждающих цитат и ссылок: '+(r.evidence.total||0)+'.');}
else if(r.action==='compare'){lines.push(r.comparison?'Сравнение с прошлым отчётом готово.':'Подходящего прошлого отчёта для сравнения не нашлось — покажу текущие данные.');}
else if(r.action==='refresh'&&r.refresh_plan){lines.push('Обновление: заново соберу '+((r.refresh_plan.refreshed||[]).length)+' источников, ещё '+((r.refresh_plan.reused||[]).length)+' актуальны и взяты из сохранённых данных.');}
lines.push('Файлы: Excel-таблица и CSV'+(e.chart_insufficient?'':', график')+' — отправляю следом.');
return [{json:{telegram_send_body:JSON.stringify({chat_id:chat,text:lines.join('\\n')}),report_id:s.bundle.report_id,baseline_reason:r.baseline_reason||''}}];`),
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
  ['Send Document', 'Send Chart (SVG via sendDocument)'],
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
if(cur&&cfg.digest_attach_xlsx===true){var scope={owner_user_id:cur.owner_user_id,agent_request_id:cur.agent_request_id,report_id:cur.report_id};var pkg=buildReportPackage(cur,scope,{omit_empty:true});var deliv=attachmentDelivery({owner_user_id:dg.owner_user_id,agent_request_id:dg.digest_id,report_id:cur.report_id},'digest_xlsx',pkg.size_bytes+'');out.has_attachment=true;out.attachment_delivery=deliv;out.xlsx_filename=pkg.filename;binary={attachment:{data:Buffer.from(pkg.buffer).toString('base64'),fileName:pkg.filename,mimeType:pkg.mime}};}
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
  subTrigger('wf26-sub', 'When Called by Agent', [-1200, 220], ['owner_user_id', 'agent_request_id', 'source_run_id', 'workflow_run_id', 'community', 'data_mode', 'mode', 'vk_enable_approval', 'vk_comments_approval']),
  code('wf26-cfg', 'Resolve Agent Config', [-980, 0], ['agent_config'],
    ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  code('wf26-gate', 'VK Credential Gate', [-760, 0], ['vk_collector'], `
var cfg=$('Resolve Agent Config').first().json;
// VK-ENABLE-001: per-call inputs (community, approval, owner) arrive on the trigger, NOT on the prior node's
// $json; merge the trigger over $json so the gate actually sees the requested community + approval.
var __trig={}; try{ __trig=$('When Called by Agent').first().json||{}; }catch(e){ __trig={}; }
var inp=Object.assign({}, ($json||{}), __trig);
// An explicit operator approval enables the VK collector for THIS run without an env restart (env MS_ENABLE_VK
// stays the default kill-switch for un-approved calls). The token is NEVER here — it stays in the n8n
// credential bound to the VK HTTP nodes; the real API call validates it (error 5 -> setup_required fail-closed).
var __vkAppr=String(inp.vk_enable_approval||'')==='VK_LIVE_APPROVED';
if(__vkAppr){ cfg=Object.assign({}, cfg, {enable_vk:true, enable_vk_collector:true, vk_token_present:true}); }
// VK-COMMENTS-001 (Stage D · D2): bounded public comment collection is a SEPARATE per-call approval — the wall
// (posts) path stays unchanged, and comments stay disabled unless this explicit token is present.
var __cmAppr=String(inp.vk_comments_approval||'')==='VK_COMMENTS_APPROVED';
if(__cmAppr){ cfg=Object.assign({}, cfg, {vk_enable_comments:true}); }
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
var __wall=(($('VK wall.get').first()||{}).json)||{}; // VK-PARSE-001: wall response is on VK wall.get, not $json
var parsed=parseWall(__wall,c.identity,ctx,{});
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
  // D1 (Stage D): normalize every collected VK post into the canonical 40-column raw_market_records shape so VK
  // flows through the SAME pipeline as Website/Telegram: WF16 quality gate -> WF08 role classifier -> WF10
  // aggregation -> WF12 report. Relevance/scoring uses the embedded semantic_core.classifyOffline — the ONE
  // canonical contract (no VK-specific scoring). Off-topic posts classify as irrelevant here and are excluded
  // downstream by WF16 (report_candidate=0) / WF08 (record_type_hint='irrelevant' -> skipped_log). Every row
  // carries confidence_score + a grounded manager_note reason. Column set mirrors WF07/WF09/WF11 exactly.
  code('wf26-buildrmr', 'Build VK raw_market_records Rows', [1000, -380], ['semantic_core'], `
var d=$('Parse Wall & Detect Changes').first().json;
var recs=(d&&d.records)?d.records:[];
var comm=(d&&d.community)?d.community:{};
function vstr(v){return v==null?'':String(v).trim();}
function vid(v){return vstr(v).replace(/[^A-Za-z0-9]+/g,'_');}
function vkw(cls){var a=[];if(cls.service_primary&&cls.service_primary!=='unknown')a.push(cls.service_primary);(cls.content_topics||[]).forEach(function(t){if(t)a.push(t);});(cls.pain_tags||[]).forEach(function(t){if(t)a.push(t);});((cls.offer_terms&&cls.offer_terms.documents_not_required)||[]).forEach(function(t){if(t)a.push(t);});return Array.from(new Set(a)).join(', ');}
var out=[];
for(var i=0;i<recs.length;i++){
  var p=recs[i];
  var text=vstr(p.text);
  var url=vstr(p.canonical_url);
  var cls=classifyOffline({text_context:text,text:text,title:'',platform:'vk',source_type:'vk_community_wall',post_url:url,source_url:vstr(comm.canonical_url),exact_evidence_url:url,competitor_name:vstr(comm.display_name),profile_name:vstr(comm.display_name),published_at:vstr(p.published_at)});
  var compRel=(cls.record_type==='competitor_activity');
  var reason='VK '+(vstr(comm.display_name)||'сообщество')+' — '+cls.record_type+' (уверенность '+cls.confidence_score+'): '+(((cls.confidence_reasons||[]).slice(0,3).join('; '))||'нет явных сигналов');
  out.push({json:{
    record_id:'wf26_'+vid(p.source_run_id||p.agent_request_id)+'_'+vstr(p.owner_id)+'_'+vstr(p.post_id),
    agent_request_id:vstr(p.agent_request_id),
    source_run_id:vstr(p.source_run_id)||vstr(p.agent_request_id),
    data_mode:vstr(p.data_mode)||'live',
    created_at:vstr(p.collected_at),
    source_type:'vk_community_wall',
    platform:'vk',
    source_url:vstr(comm.canonical_url),
    post_url:url,
    profile_url:vstr(comm.canonical_url),
    profile_name:vstr(comm.display_name),
    author_handle:vstr(comm.screen_name),
    published_at:vstr(p.published_at),
    region_hint:'',
    service_hint:vstr(cls.service_primary),
    query:'',
    text_context:text,
    comment_text:'',
    contact_public:'',
    contact_channel:'',
    dedup_key:'vk::vk_community_wall::'+url,
    record_type_hint:vstr(cls.record_type),
    touchpoint_type:'',
    lead_intent_hint:'',
    urgency_hint:'',
    interest_topic:vstr(cls.offer_text)||vkw(cls),
    probable_need:'',
    competitor_related:compRel,
    competitor_name:compRel?(vstr(cls.competitor_name)||vstr(comm.display_name)):'',
    semantic_keywords:vkw(cls),
    ad_channel_hint:'vk',
    confidence_score:Number(cls.confidence_score)||0,
    lead_temperature:'',
    next_action:'',
    responsible:'',
    dedup_status:'unique',
    approval_status:'new',
    approved_by:'',
    approved_at:'',
    estimated_analysis_cost_usd:0,
    manager_note:reason,
    notes:'stage_d_vk_post_normalized; source_record_id='+vstr(p.source_record_id)+'; route='+vstr(cls.route)+'; hard_skip='+(cls.hard_skip===true)+'; evidence='+url
  }});
}
return out;`),
  sheetsAppend('wf26-aprmr', 'Append raw_market_records', [1220, -380], 'raw_market_records'),
  // D2 (Stage D): bounded PUBLIC comment collection -> canonical raw_market_records (touchpoint_type=public_comment,
  // source_type=public_discussion) so WF14 triages them into public_lead_signals. Gated behind vk_comments_approval
  // (separate from the wall/posts approval); INERT with 0 API calls unless approved. Scoring = the single canonical
  // classifyOffline audience branch. Community-owned comments (from_id<0 or == owner) can NEVER be a lead; obvious
  // noise (stickers/emoji/greeting/praise/contest/too-short) is rejected deterministically (audit kept in the parse
  // node output). Public data only: comment id, parent post, public numeric author id, text, date — no author PII.
  code('wf26-cmreq', 'Build VK Comment Requests', [1000, 340], ['vk_collector'], `
var g=$('VK Credential Gate').first().json;var cfg=(g&&g.cfg)||{};
var c=collectorConfig(cfg);
if(!c.comments_enabled){return [];} // gated: no vk_comments_approval -> zero wall.getComments calls
var d=$('Parse Wall & Detect Changes').first().json;
var posts=(d&&d.records)?d.records:[];
var ident=(d&&d.community)||g.identity||{};
var ctx={agent_request_id:g.agent_request_id,source_run_id:g.source_run_id,workflow_run_id:g.workflow_run_id,owner_user_id:g.owner_user_id,now:(new Date()).toISOString(),data_mode:g.data_mode};
var out=[];var cap=Math.min(posts.length,c.max_comment_posts);
for(var i=0;i<cap;i++){var p=posts[i];var req=commentsRequest(ident,{post_id:p.post_id},cfg);if(!req)continue;
  out.push({json:{vk_method:req.method,vk_params:req.params,_post:{post_id:p.post_id,owner_id:p.owner_id},_community:ident,_ctx:ctx}});}
return out;`),
  httpVk('wf26-cmhttp', 'VK wall.getComments', [1220, 340]),
  code('wf26-cmparse', 'Parse & Classify VK Comments', [1440, 340], ['semantic_core', 'vk_collector'], `
var reqs=[];try{reqs=$('Build VK Comment Requests').all().map(function(i){return i.json;});}catch(e){reqs=[];}
var resps=$input.all().map(function(i){return i.json;});
var out=[];
for(var i=0;i<resps.length;i++){
  var req=reqs[i]||{};var ident=req._community||{};var ctx=req._ctx||{};var post=req._post||{};
  var parsed=parseComments(resps[i]||{},post,ident,ctx);
  if(!parsed.ok){out.push({json:{_kind:'error',post_id:post.post_id,noise_reason:'',relevance_reason:((parsed.error&&parsed.error.kind)||'parse_error')}});continue;}
  for(var j=0;j<parsed.comments.length;j++){
    var cm=parsed.comments[j];var rec=buildCommentRecord(cm,ident,ctx);var noise=commentNoiseClass(cm.text);
    var verdict,rt='',conf=1,reason='';
    if(noise.noise){verdict='rejected_noise';reason='noise: '+noise.reason;}
    else if(rec.owner_authored){verdict='competitor_owned';rt='competitor_activity';conf=60;reason='community-authored (from_id='+cm.from_id+') — competitor/content context, never a lead';}
    else{var cls=classifyOffline({text_context:cm.text,text:cm.text,source_type:'public_discussion',touchpoint_type:'public_comment',post_url:rec.canonical_url,source_url:rec.community_url,exact_evidence_url:rec.canonical_url,competitor_name:''});
      rt=cls.record_type;conf=Number(cls.confidence_score)||1;reason=(cls.confidence_reasons||[]).slice(0,3).join('; ')||'audience comment';verdict='accepted';}
    out.push({json:Object.assign({},rec,{_kind:verdict,record_type_hint:rt,confidence_score:conf,relevance_reason:reason,noise_reason:noise.reason})});
  }
}
return out;`),
  code('wf26-cmshape', 'Shape VK Comment Rows', [1660, 340], [], `
var items=$input.all().map(function(i){return i.json;});
function s(v){return v==null?'':String(v).trim();}
function safe(v){v=s(v);return /^[+=]/.test(v)?("'"+v):v;}
function contact(t){t=s(t);var ph=t.match(/(?:\\+7|8)[\\s\\-(]*\\d{3}[\\s\\-)]*\\d{3}[\\s\\-]*\\d{2}[\\s\\-]*\\d{2}/);if(ph)return {v:ph[0],ch:'phone'};var h=t.match(/@[a-zA-Z0-9_]{5,32}/);if(h)return {v:h[0],ch:'telegram'};return {v:'',ch:''};}
var out=[];
for(var i=0;i<items.length;i++){var r=items[i];
  if(r._kind!=='accepted'&&r._kind!=='competitor_owned')continue; // noise/error not persisted (audit stays in parse node)
  var compRel=(r.record_type_hint==='competitor_activity');
  var ct=(r._kind==='accepted')?contact(r.text):{v:'',ch:''};
  out.push({json:{
    record_id:'wf26c_'+s(r.owner_id)+'_'+s(r.post_id)+'_'+s(r.comment_id),
    agent_request_id:s(r.agent_request_id),source_run_id:s(r.source_run_id)||s(r.agent_request_id),data_mode:s(r.data_mode)||'live',
    created_at:s(r.collected_at),source_type:'public_discussion',platform:'vk',
    source_url:s(r.community_url),post_url:s(r.canonical_url),profile_url:'',profile_name:s(r.community_name),author_handle:'',
    published_at:s(r.published_at),region_hint:'',service_hint:'',query:'',
    text_context:s(r.text),comment_text:s(r.text),contact_public:safe(ct.v),contact_channel:ct.ch,
    dedup_key:s(r.dedup_key),record_type_hint:s(r.record_type_hint),touchpoint_type:'public_comment',
    lead_intent_hint:'',urgency_hint:'',interest_topic:'audience comment',probable_need:'',
    competitor_related:compRel,competitor_name:compRel?s(r.community_name):'',semantic_keywords:'',ad_channel_hint:'vk',
    confidence_score:Number(r.confidence_score)||1,lead_temperature:'',next_action:'',responsible:'',
    dedup_status:'unique',approval_status:'new',approved_by:'',approved_at:'',estimated_analysis_cost_usd:0,
    manager_note:'VK комментарий ('+s(r._kind)+'): '+s(r.relevance_reason),
    notes:'stage_d_vk_comment; from_id='+s(r.from_id)+'; parent_post='+s(r.post_id)+'; comment_id='+s(r.comment_id)+'; owner_authored='+(r.owner_authored===true)+'; evidence='+s(r.canonical_url)
  }});}
return out;`),
  sheetsAppend('wf26-cmappend', 'Append VK Comment Records', [1880, 340], 'raw_market_records'),
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
  code('wf26-setup', 'Build Setup-Required Reply', [-320, 160], ['vk_collector', 'conversation_response', 'plan_render_ru'], `
var g=$('VK Credential Gate').first().json;var chat=String(g.owner_user_id||'');
// UX-RU-002: the credential/config reason code stays in execution data; the user gets a plain Russian note.
var reason=(g.credential&&g.credential.reason)||(g.identity&&g.identity.reason)||'vk_setup_required';
var text=clarificationReply(ruUnavailableSourceMessage('vk'));
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
  ['Parse Wall & Detect Changes', 'Build VK raw_market_records Rows'],
  ['Build VK raw_market_records Rows', 'Append raw_market_records'],
  ['Parse Wall & Detect Changes', 'Build VK Comment Requests'],
  ['Build VK Comment Requests', 'VK wall.getComments'],
  ['VK wall.getComments', 'Parse & Classify VK Comments'],
  ['Parse & Classify VK Comments', 'Shape VK Comment Rows'],
  ['Shape VK Comment Rows', 'Append VK Comment Records'],
  ['Parse Wall & Detect Changes', 'Shape VK Post State'],
  ['Shape VK Post State', 'Append vk_post_state'],
  ['Parse Wall & Detect Changes', 'VK Change?'],
  ['VK Change?', 'Shape VK Change Events', 0],
  ['VK Change?', 'Build VK Alert', 1],
  ['Shape VK Change Events', 'Append source_change_events'],
  ['Append source_change_events', 'Build VK Alert'],
  ['Build VK Alert', 'Send VK Alert']
]));

// ===================== WF27 — Cross-Source Competitor Discovery (DISCOVERY-003) =========================
// "найди новых конкурентов [по ПТС] [в Telegram/VK/на сайтах]" -> bounded Firecrawl Search per expanded query ->
// normalize + classify candidates -> present top competitors with an approve/add prompt -> persist candidate_sources.
// Paid (Firecrawl Search) but strictly bounded + budget-gated + fail-closed. NO Claude. Avito is never a target.
write('27_competitor_discovery.json', wf('27 — Cross-Source Competitor Discovery (Firecrawl Search, bounded)', [
  manual('wf27-trig', 'Manual Start', [-820, -160]),
  subTrigger('wf27-sub', 'When Called by Agent', [-820, 60], ['agent_request_id', 'chat_id', 'owner_user_id', 'text', 'platform', 'region', 'niche', 'data_mode', 'auto_add']),
  code('wf27-cfg', 'Resolve Agent Config', [-600, 0], ['agent_config'], ENV + "\nreturn [{json:resolveConfig(__env)}];"),
  sheetsRead('wf27-readtracked', 'Read tracked_sources', [-600, 200], 'tracked_sources'),
  code('wf27-queries', 'Build Discovery Queries', [-380, 0], ['discovery_query', 'agent_config'], CALLER + "\nvar cfg=$('Resolve Agent Config').first().json;\nvar ci=callerInput();\nvar text=String(ci.text||'');\nvar canSearch=paidCallsAllowed(cfg)&&cfg.enable_firecrawl===true;\n// discovery is web-search based (site:t.me/s | site:vk.com | web) — never Avito. VK is discoverable even if the\n// VK API collector is off, because search is public web. Bound the run tightly.\nvar qregion=String(ci.region||cfg.default_region||'');\nvar queries=buildDiscoveryQueries({text:text,region:qregion,platform:ci.platform,allowlist:['website','telegram','vk'],max_variants:3,max_results:6,cost_search_usd:cfg.cost_firecrawl_page_usd});\nvar CAP=Number(cfg.discovery_max_searches)||4;queries=queries.slice(0,CAP);\nvar proj=projectDiscoveryCost(queries,cfg);\nvar withinBudget=(proj.projected_cost_usd==null)||(proj.projected_cost_usd<=Number(cfg.source_budget_usd||5));\nvar ctx={chat_id:String(ci.chat_id||''),owner_user_id:String(ci.owner_user_id||''),agent_request_id:String(ci.agent_request_id||'req'),text:text,query_region:qregion,auto_add:String(ci.auto_add||'')==='true',discovery_run_id:'disc_'+String(ci.agent_request_id||'req')};\nif(!queries.length||!canSearch||!withinBudget){return [{json:Object.assign({allowed:false,reason:(!queries.length?'no_queries':(!canSearch?'search_disabled':'over_budget'))},ctx)}];}\nreturn queries.map(function(q){return {json:Object.assign({allowed:true,search_body:buildFirecrawlSearchBody(q),query_meta:q},ctx)};});"),
  ifNode('wf27-if', 'Discovery Allowed?', [-160, 0], '={{ $json.allowed }}'),
  httpFirecrawlSearch('wf27-search', 'Firecrawl Search', [60, -80]),
  code('wf27-classify', 'Classify Candidates', [280, -80], ['discovery_query', 'candidate_classifier', 'tracked_sources'], "var qmeta=[];try{qmeta=$('Build Discovery Queries').all().map(function(i){return i.json;});}catch(e){}\nvar first=qmeta[0]||{};var chat=String(first.chat_id||'');\nvar tracked=[];try{tracked=$('Read tracked_sources').all().map(function(i){return i.json;});}catch(e){}\nvar trackedKeys={};tracked.forEach(function(s){if(String(s.owner_user_id)===String(first.owner_user_id)&&s.key&&s.status!=='removed')trackedKeys[String(s.key).toLowerCase()]=1;});\nvar items=[];try{items=$input.all();}catch(e){items=[];}\nvar cands=[];\nitems.forEach(function(it,idx){var meta=qmeta[idx]||first;var results=parseFirecrawlSearchResults(it.json);var pt=(meta.query_meta&&meta.query_meta.platform_target)||'website';var c=candidatesFromResults(results,{platform_target:pt},normalizeSourceRef);c.forEach(function(x){x.query_text=(meta.query_meta&&meta.query_meta.query_text)||'';x.product=(meta.query_meta&&meta.query_meta.product)||'';cands.push(x);});});\nvar qRegion=String(first.query_region||'');try{if(!qRegion)qRegion=String($('Resolve Agent Config').first().json.default_region||'');}catch(e){}\nvar seen={},uniq=[];cands.forEach(function(x){var k=String(x.normalized_key).toLowerCase();if(!k||seen[k])return;seen[k]=1;x.already_tracked=trackedKeys[k]===1;var cl=classifyCandidate({title:x.title,description:x.description,platform:x.platform,host:x.host,url:x.source_url,display_name:x.display_name,normalized_key:x.normalized_key,query_region:qRegion,already_tracked:x.already_tracked,validated:false});x.is_competitor=cl.is_competitor;x.is_lead_source=cl.is_lead_source;x.is_content_creator=cl.is_content_creator;x.is_news_or_aggregator=cl.is_news_or_aggregator;x.category=cl.category;x.confidence=cl.confidence;x.relevance_score=cl.relevance_score;x.classification_reason=cl.classification_reason;x.region_match=cl.region_match;x.region_reason=cl.region_reason;x.validated=cl.validated;uniq.push(x);});\nreturn [{json:{candidates:uniq,first:first,chat:chat,qRegion:qRegion}}];"),
  // DISCOVERY-006: pick the top competitors (in-region, non-aggregator) to VALIDATE against fetched evidence — a
  // sentinel item guarantees Finalize still runs (and sends a reply) when there is nothing to validate.
  code('wf27-selectval', 'Select Validation Targets', [500, -200], ['agent_config'], "var j={};try{j=$('Classify Candidates').first().json;}catch(e){}\nvar cands=j.candidates||[];\nvar cfg={};try{cfg=$('Resolve Agent Config').first().json;}catch(e){}\nvar maxV=Number(cfg.discovery_validate_max)||5;\nvar doValidate=(cfg.enable_discovery_validation!==false)&&paidCallsAllowed(cfg)&&cfg.enable_firecrawl===true;\nvar rank=cands.filter(function(c){return c.is_competitor&&!c.is_news_or_aggregator&&c.region_match!=='mismatch'&&!c.already_tracked;});\nrank.sort(function(a,b){return (Number(b.confidence)||0)-(Number(a.confidence)||0);});\nvar targets=doValidate?rank.slice(0,maxV):[];\nif(!targets.length)return [{json:{validate:false}}];\nreturn targets.map(function(c){var url=c.source_url;if(c.platform==='telegram'){var h=String(c.normalized_key).split('::')[1]||'';url='https://t.me/s/'+h;}return {json:{validate:true,normalized_key:c.normalized_key,platform:c.platform,scrape_url:url,scrape_body:JSON.stringify({url:url,formats:['markdown'],onlyMainContent:true,timeout:15000})}};});"),
  ifNode('wf27-ifval', 'Validate Candidates?', [720, -200], '={{ $json.validate === true }}'),
  httpFirecrawlScrape('wf27-scrape', 'Firecrawl Scrape', [940, -280]),
  code('wf27-finalize', 'Finalize Discovery', [1160, -80], ['candidate_classifier'], "var j={};try{j=$('Classify Candidates').first().json;}catch(e){}\nvar cands=(j.candidates||[]).slice();var first=j.first||{};var chat=String(j.chat||'');var qRegion=String(j.qRegion||'');\nvar targets=[];try{targets=$('Select Validation Targets').all().map(function(x){return x.json;});}catch(e){}\nvar scraped=[];try{scraped=$('Firecrawl Scrape').all().map(function(x){return x.json;});}catch(e){}\nvar byKey={};targets.forEach(function(t,i){if(t&&t.validate){var r=scraped[i]||{};var d=(r&&r.data)||{};var md=String(d.markdown||'');var meta=d.metadata||{};if(md||meta.title){byKey[String(t.normalized_key)]={content:md.slice(0,4000),title:String(meta.title||''),description:String(meta.description||'')};}}});\nvar validated_count=0;\ncands=cands.map(function(c){var ev=byKey[String(c.normalized_key)];if(!ev)return c;validated_count++;var scrapedBody=[ev.title,ev.description,ev.content].filter(Boolean).join(' \\n ');var cl=classifyCandidate({title:c.title,description:c.description,content:scrapedBody,platform:c.platform,host:c.host,url:c.source_url,display_name:c.display_name,normalized_key:c.normalized_key,query_region:qRegion,already_tracked:c.already_tracked,validated:true});return Object.assign({},c,{is_competitor:cl.is_competitor,is_lead_source:cl.is_lead_source,is_content_creator:cl.is_content_creator,is_news_or_aggregator:cl.is_news_or_aggregator,category:cl.category,confidence:cl.confidence,relevance_score:cl.relevance_score,classification_reason:cl.classification_reason,region_match:cl.region_match,region_reason:cl.region_reason,validated:true,evidence_excerpt:String(scrapedBody||c.evidence_excerpt||c.description||'').slice(0,300),recent_posts_sample:((c.platform==='telegram'||c.platform==='vk')?String(scrapedBody||'').slice(0,500):'')});});\nvar uniq=cands;var ranked=rankCandidates(uniq);\nvar compEligible=ranked.competitors.filter(function(c){return !c.already_tracked;});\nvar comps=compEligible.filter(function(c){return c.region_match!=='mismatch';}).slice(0,5);\nvar allow=[];try{allow=($('Resolve Agent Config').first().json.source_allowlist||[]).map(function(s){return String(s).toLowerCase();});}catch(e){}\nfunction platAddable(p){p=String(p).toLowerCase();var sh=(p==='telegram')?'telegram':((p==='vk')?'vk':'website');return allow.indexOf(sh)>=0;}\nfunction platLabelRu(p){p=String(p).toLowerCase();return p==='telegram'?'Telegram-каналы':(p==='vk'?'VK-сообщества':'сайты');}\nvar addableComps=comps.filter(function(c){return platAddable(c.platform);});\nvar mismatch=compEligible.filter(function(c){return c.region_match==='mismatch';}).slice(0,3);\nvar leads=ranked.lead_sources.slice(0,2);\nvar aggrs=ranked.aggregators.slice(0,3);\nvar lines=[];\nif(!uniq.length){lines.push('Новых источников-кандидатов по запросу не найдено. Можно расширить регион, изменить формулировку или проверить другие площадки.');}else{lines.push('Нашёл '+uniq.length+' источник(ов)-кандидатов. Из них похожи на конкурентов: '+ranked.competitors.length+'.');lines.push('');comps.forEach(function(c,i){lines.push((i+1)+'. '+c.display_name+' — вероятный конкурент, уверенность '+c.confidence+'/100');lines.push('   Почему: '+c.classification_reason);if(c.source_url)lines.push('   Evidence: '+c.source_url);});if(mismatch.length){lines.push('');lines.push('Не в вашем регионе (не добавляю в топ):');mismatch.forEach(function(c){lines.push('• '+c.display_name+' — похоже на поставщика услуги, но '+c.region_reason+'.');});}leads.forEach(function(c){lines.push('• '+c.display_name+' — сообщество с аудиторией (не конкурент), уверенность '+c.confidence+'/100');});if(aggrs.length){lines.push('');lines.push('Прочее:');aggrs.forEach(function(c){lines.push('• '+c.display_name+' — каталог/справочник/СМИ, не конкурент. Можно использовать как источник для поиска компаний.');});}if(addableComps.length){lines.push('');lines.push('Добавить '+Math.min(addableComps.length,3)+' лучших в мониторинг?');}else if(comps.length){lines.push('');lines.push('Кандидаты найдены, но '+platLabelRu(comps[0].platform)+' пока нельзя добавить в мониторинг.');}}\nvar rid=first.discovery_run_id;var kbRows=[];if(addableComps.length)kbRows.push([{text:'Добавить лучших в мониторинг',callback_data:'disc_add:'+rid}]);if(uniq.length)kbRows.push([{text:'Показать всех кандидатов',callback_data:'disc_all:'+rid}]);kbRows.push([{text:'Искать ещё',callback_data:'disc_more:'+rid}]);kbRows.push([{text:'Не добавлять',callback_data:'disc_none:'+rid}]);\nvar body={chat_id:chat,text:lines.join('\\n'),reply_markup:{inline_keyboard:kbRows}};\nvar ts=(new Date()).toISOString();\nvar clampConf=function(v){v=Number(v)||0;return v<0?0:(v>100?100:v);};\nvar rows=uniq.map(function(c){return {candidate_id:String(first.discovery_run_id)+'::'+c.normalized_key,owner_user_id:String(first.owner_user_id||''),chat_id:chat,discovery_run_id:String(first.discovery_run_id||''),platform:c.platform,source_url:c.source_url,normalized_key:c.normalized_key,display_name:c.display_name,title:String(c.title).slice(0,200),description:String(c.description).slice(0,300),region:String(c.region_match||'unknown'),niche:c.product||'',query_text:c.query_text,provider:'firecrawl_search',provider_result_url:String(c.provider_result_url||c.source_url||''),evidence_url:c.source_url,evidence_excerpt:String(c.evidence_excerpt||c.description||'').slice(0,300),recent_posts_sample:String(c.recent_posts_sample||'').slice(0,500),is_competitor:c.is_competitor,is_lead_source:c.is_lead_source,is_content_creator:c.is_content_creator,is_news_or_aggregator:c.is_news_or_aggregator,confidence:clampConf(c.confidence),relevance_score:clampConf(c.relevance_score),quality_status:(c.validated?'validated':'unvalidated'),classification_reason:c.classification_reason,dedup_status:'unique',already_tracked:c.already_tracked?'true':'',status:'candidate',created_at:ts,collected_at:ts,source_run_id:String(first.agent_request_id||''),cost_usd:''};});\nreturn [{json:{telegram_send_body:JSON.stringify(body),candidate_rows:rows,candidate_count:uniq.length,competitor_count:ranked.competitors.length,validated_count:validated_count}}];"),
  code('wf27-shaperows', 'Shape Candidate Rows', [1380, 20], [], "var j=$('Finalize Discovery').first().json;return (j.candidate_rows||[]).map(function(r){return {json:r};});"),
  Object.assign(sheetsAppend('wf27-appendcand', 'Append candidate_sources', [720, 20], 'candidate_sources'), { onError: 'continueRegularOutput' }),
  httpTelegram('wf27-send', 'Send Discovery Reply', [500, -140]),
  code('wf27-blocked', 'Build Blocked Reply', [60, 180], [], "var j=$json||{};var chat=String(j.chat_id||'');var reason=String(j.reason||'');var msg=(reason==='search_disabled')?'Поиск новых источников сейчас недоступен: внешний поиск отключён. Могу проанализировать уже отслеживаемые источники или источники, которые вы пришлёте ссылками.':((reason==='over_budget')?'Поиск новых источников сейчас недоступен из-за лимита бюджета. Попробуйте позже или уточните площадку.':'Не удалось составить поисковый запрос. Уточните нишу, продукт (например «ПТС») и регион.');return [{json:{telegram_send_body:JSON.stringify({chat_id:chat,text:msg})}}];"),
  httpTelegram('wf27-sendblocked', 'Send Blocked Reply', [280, 180])
], [
  ['Manual Start', 'Resolve Agent Config'],
  ['When Called by Agent', 'Resolve Agent Config'],
  ['Resolve Agent Config', 'Read tracked_sources'],
  ['Read tracked_sources', 'Build Discovery Queries'],
  ['Build Discovery Queries', 'Discovery Allowed?'],
  ['Discovery Allowed?', 'Firecrawl Search', 0],
  ['Discovery Allowed?', 'Build Blocked Reply', 1],
  ['Firecrawl Search', 'Classify Candidates'],
  ['Classify Candidates', 'Select Validation Targets'],
  ['Select Validation Targets', 'Validate Candidates?'],
  ['Validate Candidates?', 'Firecrawl Scrape', 0],
  ['Validate Candidates?', 'Finalize Discovery', 1],
  ['Firecrawl Scrape', 'Finalize Discovery'],
  ['Finalize Discovery', 'Send Discovery Reply'],
  ['Finalize Discovery', 'Shape Candidate Rows'],
  ['Shape Candidate Rows', 'Append candidate_sources'],
  ['Build Blocked Reply', 'Send Blocked Reply']
]));

// =========================================================================================== WF28 Claude Analyst
// Stage F production Claude call. Callable child. Fail-closed + feature-gated + budget-gated + reuse-by-hash.
// Transport: tool_choice:auto submit tool (the measured gateway contract). Deterministic fallback always yields a
// usable typed result. Persists llm_analysis_results + llm_analysis_telemetry with full lineage; NO secret, NO
// thinking block ever leaves the node. Max 2 Claude calls (primary + at most one repair) — no loops.
var WF28_LIBS_FULL = ['agent_config', 'claude_adapter', 'claude_contracts', 'evidence_package', 'llm_cost', 'claude_analysis', 'llm_telemetry'];
var WF28_LIBS_PARSE = ['claude_adapter', 'claude_contracts', 'evidence_package', 'llm_cost', 'claude_analysis'];
write('28_claude_analyst.json', wf('28 — Claude Analyst (Stage F, evidence-bound, feature-gated)', [
  subTrigger('wf28-trigger', 'When Called by Agent', [-60, 0],
    ['agent_request_id', 'source_run_id', 'report_id', 'owner_user_id', 'chat_id', 'analysis_type', 'evidence_input', 'niche', 'region']),
  sheetsRead('wf28-readres', 'Read llm_analysis_results', [160, -180], 'llm_analysis_results'),
  code('wf28-prep', 'Prepare Analysis', [160, 0], WF28_LIBS_FULL, CALLER + ENV + `
var inp=callerInput();
var cfg=resolveConfig(__env);
var evIn={};try{evIn=(typeof inp.evidence_input==='string')?JSON.parse(inp.evidence_input||'{}'):(inp.evidence_input||{});}catch(e){evIn={};}
var pkgRes=buildEvidencePackage(evIn,{});
var model=(cfg.llm_model||'claude-sonnet-4-6');
var ctx={owner_user_id:String(inp.owner_user_id||''),chat_id:String(inp.chat_id||''),agent_request_id:String(inp.agent_request_id||''),source_run_id:String(inp.source_run_id||''),report_id:String(inp.report_id||''),analysis_type:String(inp.analysis_type||'single_source'),evidence_package_hash:pkgRes.package_hash,source_scope:(evIn.source||{}),schema_version:CC_SCHEMA_VERSION,prompt_version:CC_PROMPT_VERSION,model:model};
// Runtime gate: the dedicated Stage-F rollout flag (default OFF). Auth is enforced by the n8n credential on the
// HTTP node — a missing/invalid credential simply fails the call and falls back (claude_key_present is a
// cost-model concern, not a runtime gate).
var enabled=(cfg.enable_claude!==false)&&(cfg.enable_llm_analysis===true);
var haveEvidence=(pkgRes.allowed_evidence_ids||[]).length>0;
var reuseRows=[];try{reuseRows=($('Read llm_analysis_results').all()||[]).map(function(x){return x.json;});}catch(e){}
var reuse=findReusableAnalysis(reuseRows,ctx);
var base={ctx:ctx,pkg:{package:pkgRes.package,allowed_evidence_ids:pkgRes.allowed_evidence_ids,package_hash:pkgRes.package_hash}};
if(reuse){base.mode='reuse';base.do_call=false;base.reuse_analysis=reuse.analysis;}
else if(!enabled){base.mode='disabled';base.do_call=false;}
else if(!haveEvidence){base.mode='no_evidence';base.do_call=false;}
else{var built=buildSourceAnalysisCall(base.pkg,{llm_model:model});base.mode='call';base.do_call=true;base.claude_body=built.body;base.allowed_ids=built.allowed_evidence_ids;base.ctx.estimated_cost_usd=estimateCost((evIn.evidence||[]).length*200,700,cfg).est_cost_usd;}
// WF28-LATENCY-001: the clock the parser needs. n8n's HTTP node reports no timing, so latency is measured across
// the node boundary or not at all — and "not at all" is what shipped: parseClaudeResponse reads http.latency_ms
// from an object this workflow builds WITHOUT that key, so every call recorded latency_ms=0, including the
// successful ones. That blinded us to a p50 sitting near the timeout until it started failing.
base.__t0=Date.now();
return [{json:base}];`),
  ifNode('wf28-ifcall', 'Call Claude?', [400, 0], '={{ $json.do_call }}'),
  httpClaudeMsg('wf28-http1', 'Claude Primary', [620, -120]),
  code('wf28-parse1', 'Parse Primary', [840, -120], WF28_LIBS_PARSE, `
var prep=$('Prepare Analysis').first().json;var raw=$json;
// An absent __t0 must read as "not measured" (0), never as time-since-epoch.
var __t0=Number(prep.__t0)||0;
var http={status:Number(raw.statusCode||raw.status||0)||(raw.body?200:0),body:raw.body||raw,headers:raw.headers||{},latency_ms:__t0?(Date.now()-__t0):0};
var res=parseClaudeResponse(http,{model:prep.ctx.model});
function lr(r){return {usage:r.usage,request_id:r.request_id,stop_reason:r.stop_reason,schema_mode:r.schema_mode,latency_ms:r.latency_ms,provider:r.provider,error_category:r.error_category};}
var out={prep:prep,res1:lr(res)};
if(res.ok){var v=validateAnalysisResult(res.content,prep.allowed_ids,CC_ANALYSIS_SCHEMA);if(v.ok){out.status='valid';out.analysis=res.content;}else{out.status='repair';out.errors=v.errors;out.rejected=res.content;var rep=buildRepairCall(res.content,v.errors,prep.allowed_ids,{llm_model:prep.ctx.model});out.claude_body=rep.body;out.__t1=Date.now();}}
else{out.status='fail';out.error_category=res.error_category;}
return [{json:out}];`),
  ifNode('wf28-ifrep', 'Need Repair?', [1060, -120], "={{ $json.status === 'repair' }}"),
  httpClaudeMsg('wf28-http2', 'Claude Repair', [1280, -220]),
  code('wf28-parse2', 'Parse Repair', [1500, -220], WF28_LIBS_PARSE, `
var pp=$('Parse Primary').first().json;var prep=pp.prep;var raw=$json;
// The repair call has its OWN clock, stamped by Parse Primary when it built the repair body.
var __t1=Number(pp.__t1)||0;
var http={status:Number(raw.statusCode||raw.status||0)||(raw.body?200:0),body:raw.body||raw,headers:raw.headers||{},latency_ms:__t1?(Date.now()-__t1):0};
var res=parseClaudeResponse(http,{model:prep.ctx.model});
function lr(r){return {usage:r.usage,request_id:r.request_id,stop_reason:r.stop_reason,schema_mode:r.schema_mode,latency_ms:r.latency_ms,provider:r.provider,error_category:r.error_category};}
var out={prep:prep,res1:pp.res1,res2:lr(res),repair_used:true,prev_errors:pp.errors||[]};
if(res.ok){var v=validateAnalysisResult(res.content,prep.allowed_ids,CC_ANALYSIS_SCHEMA);if(v.ok){out.status='repaired';out.analysis=res.content;out.repair_success=true;}else{out.status='fallback';out.repair_success=false;out.errors=v.errors;}}
else{out.status='fallback';out.repair_success=false;out.error_category=res.error_category;}
return [{json:out}];`),
  code('wf28-fin', 'Finalize Analysis', [1720, 0], WF28_LIBS_FULL, `
var prep=$('Prepare Analysis').first().json;var ctx=prep.ctx;var now=(new Date()).toISOString();
var pkgRes={package:prep.pkg.package,allowed_evidence_ids:prep.pkg.allowed_evidence_ids,package_hash:prep.pkg.package_hash};
var pp=null,pr=null;try{pp=$('Parse Primary').first().json;}catch(e){}try{pr=$('Parse Repair').first().json;}catch(e){}
function agg(cs){return {input_tokens:cs.reduce(function(a,c){return a+((c&&c.input_tokens)||0);},0),output_tokens:cs.reduce(function(a,c){return a+((c&&c.output_tokens)||0);},0)};}
function mk(analysis,meta){return {ok:!meta.fallback_used,analysis:analysis,schema_mode:meta.schema_mode||'',repair_used:!!meta.repair_used,repair_success:!!meta.repair_success,fallback_used:!!meta.fallback_used,validation_errors:meta.validation_errors||[],usage:meta.usage||{input_tokens:0,output_tokens:0},cost_usd:meta.cost_usd||0,request_id:meta.request_id||'',stop_reason:meta.stop_reason||'',error_category:meta.error_category||'',provider:'aiprimetech',latency_ms:meta.latency_ms||0};}
var result,persist=false,enriched=false;
if(prep.mode==='reuse'){result=mk(prep.reuse_analysis,{schema_mode:'reuse',stop_reason:'reuse'});enriched=true;}
else if(prep.mode==='disabled'||prep.mode==='no_evidence'){result=mk(deterministicAnalysisFallback(pkgRes),{fallback_used:true,error_category:prep.mode});}
else if(pr){var cs=[costFromUsage((pp&&pp.res1&&pp.res1.usage)||{},{}),costFromUsage((pr.res2&&pr.res2.usage)||{},{})];if(pr.status==='repaired'){result=mk(pr.analysis,{schema_mode:(pr.res2&&pr.res2.schema_mode)||'tool_use',repair_used:true,repair_success:true,validation_errors:pr.prev_errors||[],usage:agg(cs),cost_usd:sumCosts(cs),request_id:(pr.res2&&pr.res2.request_id),stop_reason:(pr.res2&&pr.res2.stop_reason),latency_ms:(pr.res2&&pr.res2.latency_ms)});enriched=true;}else{result=mk(deterministicAnalysisFallback(pkgRes),{schema_mode:(pr.res2&&pr.res2.schema_mode)||'',repair_used:true,repair_success:false,fallback_used:true,validation_errors:pr.errors||[pr.error_category],usage:agg(cs),cost_usd:sumCosts(cs),request_id:(pr.res2&&pr.res2.request_id),stop_reason:(pr.res2&&pr.res2.stop_reason),error_category:pr.error_category||'validation_failed'});}persist=true;}
else if(pp){var c1=[costFromUsage((pp.res1&&pp.res1.usage)||{},{})];if(pp.status==='valid'){result=mk(pp.analysis,{schema_mode:(pp.res1&&pp.res1.schema_mode)||'tool_use',usage:agg(c1),cost_usd:sumCosts(c1),request_id:(pp.res1&&pp.res1.request_id),stop_reason:(pp.res1&&pp.res1.stop_reason),latency_ms:(pp.res1&&pp.res1.latency_ms)});enriched=true;}else{result=mk(deterministicAnalysisFallback(pkgRes),{fallback_used:true,usage:agg(c1),cost_usd:sumCosts(c1),request_id:(pp.res1&&pp.res1.request_id),stop_reason:(pp.res1&&pp.res1.stop_reason),error_category:pp.error_category||'no_structured_output'});}persist=true;}
else{result=mk(deterministicAnalysisFallback(pkgRes),{fallback_used:true,error_category:'unknown'});}
ctx.estimated_cost_usd=prep.ctx.estimated_cost_usd||0;
var resultRow=buildAnalysisResultRow(ctx,result,now);
var telRow=buildTelemetryRow(ctx,result,now);
var a=result.analysis||{};
// The renderer must cite SOURCES, not internal ev_N ids — so hand back the id->URL map the package assigned.
// Deterministic: the same evidence_input always yields the same ev_N, so a reused analysis maps identically.
var evMap=((pkgRes.package&&pkgRes.package.evidence_items)||[]).map(function(e){return {id:e.evidence_id,url:e.source_url,type:e.source_type};});
var typedReturn={analysis_id:resultRow.analysis_id,enriched:enriched,quality_status:resultRow.quality_status,mode:prep.mode,analysis:a,overall_confidence:a.overall_confidence||0,repair_used:result.repair_used,repair_success:result.repair_success,fallback_used:result.fallback_used,error_category:result.error_category,cost_usd:result.cost_usd,evidence_package_hash:ctx.evidence_package_hash,evidence_map:evMap,source:ctx.source_scope||{}};
return [{json:{persist:persist,result_row:resultRow,telemetry_row:telRow,typed_return:typedReturn}}];`),
  ifNode('wf28-ifpersist', 'Persist?', [1940, 0], '={{ $json.persist }}'),
  code('wf28-shaperes', 'Shape Result Row', [2160, -120], [], `return [{json:$('Finalize Analysis').first().json.result_row}];`),
  sheetsAppend('wf28-appres', 'Persist llm_analysis_results', [2380, -120], 'llm_analysis_results'),
  code('wf28-shapetel', 'Shape Telemetry Row', [2600, -120], [], `return [{json:$('Finalize Analysis').first().json.telemetry_row}];`),
  sheetsAppend('wf28-apptel', 'Persist llm_analysis_telemetry', [2820, -120], 'llm_analysis_telemetry'),
  code('wf28-return', 'Return Result', [3040, 0], [], `return [{json:$('Finalize Analysis').first().json.typed_return}];`)
], [
  ['When Called by Agent', 'Read llm_analysis_results'],
  ['Read llm_analysis_results', 'Prepare Analysis'],
  ['Prepare Analysis', 'Call Claude?'],
  ['Call Claude?', 'Claude Primary', 0],
  ['Call Claude?', 'Finalize Analysis', 1],
  ['Claude Primary', 'Parse Primary'],
  ['Parse Primary', 'Need Repair?'],
  ['Need Repair?', 'Claude Repair', 0],
  ['Need Repair?', 'Finalize Analysis', 1],
  ['Claude Repair', 'Parse Repair'],
  ['Parse Repair', 'Finalize Analysis'],
  ['Finalize Analysis', 'Persist?'],
  ['Persist?', 'Shape Result Row', 0],
  ['Persist?', 'Return Result', 1],
  ['Shape Result Row', 'Persist llm_analysis_results'],
  ['Persist llm_analysis_results', 'Shape Telemetry Row'],
  ['Shape Telemetry Row', 'Persist llm_analysis_telemetry'],
  ['Persist llm_analysis_telemetry', 'Return Result']
]));

if (require.main === module) console.log('Stage 4 workflows generated.');

// Exported so the generated-Code compilation test can build the Stage 4-8 workflows in memory and parse every
// Code node body BEFORE it is written to disk — catching embed/composition syntax defects at generation time.
module.exports = { generated: GENERATED };
