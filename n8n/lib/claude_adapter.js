'use strict';
// claude_adapter.js — the ONE Claude transport for Stage F. Speaks the aiprimetech.io Messages gateway as it
// ACTUALLY behaves (see docs/STAGE_F_API_CAPABILITY_MATRIX.md), not as the public Anthropic docs describe:
//
//   * extended thinking is always on  -> responses carry `thinking`/`text` blocks; we extract only `tool_use`.
//   * forced tool_choice is unreliable -> we use tool_choice:{type:"auto"} + a single submit_* tool + a hard
//     "You MUST call submit_X" instruction. This is the ONLY robust structured-output transport.
//   * native response_format / output_config are ignored, max_tokens is not honored, caching is ineffective.
//   * latency is 16-28 s/call -> generous timeouts, minimal calls.
//
// Because tool_use returns a real JSON object, the primary path has ZERO JSON-syntax errors: parsing is
// structural. Repair (elsewhere) is reserved for schema/evidence validation only.
//
// Split into pure functions (no I/O, fully unit-testable) + one async callClaude() that takes an INJECTED
// fetchFn so tests drive it offline and n8n injects a real HTTP client. No secret is ever read or logged here.
// Embeddable: unique claude*-prefixed names, no cross-lib require.

var CLAUDE_ENDPOINT_PATH = '/v1/messages';
var CLAUDE_ANTHROPIC_VERSION = '2023-06-01';

function claudeStr(v) { return v == null ? '' : String(v); }
function claudeNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

// Build the Messages request body for a structured (tool) call. `tool` = { name, description, input_schema }.
// We ALWAYS append a hard instruction to call the tool, because tool_choice:auto + a strong nudge is what the
// gateway respects. max_tokens is set (generous) even though the gateway ignores it — belt and suspenders.
function buildToolRequest(opts) {
  opts = opts || {};
  var tool = opts.tool || {};
  var sys = claudeStr(opts.system);
  var callLine = 'You MUST call the ' + claudeStr(tool.name) + ' tool exactly once with your complete result. '
    + 'Do not answer in prose. Base every field ONLY on the provided evidence.';
  var messages = [];
  var userText = claudeStr(opts.user);
  messages.push({ role: 'user', content: userText + '\n\n' + callLine });
  var body = {
    model: claudeStr(opts.model) || 'claude-sonnet-4-6',
    max_tokens: claudeNum(opts.max_tokens, 2048),
    messages: messages,
    tools: [{ name: tool.name, description: claudeStr(tool.description), input_schema: tool.input_schema || {} }],
    tool_choice: { type: 'auto' }
  };
  if (sys) body.system = sys;
  if (opts.temperature != null) body.temperature = claudeNum(opts.temperature, 0.2);
  return body;
}

// Map an HTTP status + parsed body to a stable error category. Never throws.
function classifyClaudeError(status, body) {
  status = claudeNum(status, 0);
  // Provider-context leak: the gateway (a Claude-Code-wrapped proxy) may return its own internal message like
  // "Your conversation is too long. Please use /compact". That is NOT user content — treat it as a provider
  // error so the caller shrinks the evidence package / falls back, and NEVER surfaces it.
  var msg = claudeStr((body && body.error && body.error.message) || (body && body.message) || (body && body.__unparsed) || '');
  if (/conversation is too long|please use \/compact|context (length|window) exceeded|too many tokens/i.test(msg)) return 'context_too_long';
  if (status === 0) return 'timeout';               // client/network timeout or connreset (caller sets 0)
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  if (status === 400 || status === 404 || status === 422) return 'bad_request';
  if (status !== 200) return 'http_error';
  // 200 but content problems
  var b = body || {};
  if (b.type === 'error' || b.error) return 'provider_error';
  if (!Array.isArray(b.content)) return 'empty_content';
  return '';
}
function isTransientClaudeError(cat) { return cat === 'timeout' || cat === 'rate_limited' || cat === 'server_error'; }

// Parse a raw gateway response (HTTP {status, body, latency_ms, headers}) into the normalized adapter result.
// Extracts the tool_use block's input as `content`; ignores thinking/text. Falls back to a JSON object parsed
// from the last text block ONLY if there is no tool_use (schema_mode='text_json'). No secret/thinking is kept.
function parseClaudeResponse(http, ctx) {
  http = http || {}; ctx = ctx || {};
  var status = claudeNum(http.status, 0);
  var body = http.body || {};
  var cat = classifyClaudeError(status, body);
  var reqId = (http.headers && (http.headers['x-request-id'] || http.headers['request-id'])) || body.id || '';
  var out = {
    ok: false, provider: 'aiprimetech', model: claudeStr(body.model) || claudeStr(ctx.model),
    request_id: claudeStr(reqId), stop_reason: claudeStr(body.stop_reason),
    content: null, text: '', schema_mode: '',
    usage: normalizeUsage(body.usage), latency_ms: claudeNum(http.latency_ms, 0),
    error_category: cat, error_message: ''
  };
  if (cat) {
    out.error_message = claudeStr((body.error && body.error.message) || body.message || cat).slice(0, 240);
    return out;
  }
  var blocks = Array.isArray(body.content) ? body.content : [];
  var toolBlock = null, lastText = '';
  for (var i = 0; i < blocks.length; i++) {
    var bl = blocks[i] || {};
    if (bl.type === 'tool_use' && bl.input && typeof bl.input === 'object') toolBlock = bl;
    else if (bl.type === 'text' && typeof bl.text === 'string') lastText = bl.text;
  }
  if (toolBlock) { out.ok = true; out.content = toolBlock.input; out.schema_mode = 'tool_use'; out.text = ''; return out; }
  // fallback: a JSON object embedded in the text block (gateway declined the tool)
  var parsed = extractJsonObject(lastText);
  if (parsed) { out.ok = true; out.content = parsed; out.schema_mode = 'text_json'; out.text = ''; return out; }
  out.error_category = 'no_structured_output'; out.text = claudeStr(lastText).slice(0, 240); return out;
}

function normalizeUsage(u) {
  u = u || {};
  return {
    input_tokens: claudeNum(u.input_tokens, 0), output_tokens: claudeNum(u.output_tokens, 0),
    cache_creation_input_tokens: claudeNum(u.cache_creation_input_tokens, 0),
    cache_read_input_tokens: claudeNum(u.cache_read_input_tokens, 0)
  };
}

// Best-effort extraction of the first balanced top-level JSON object from arbitrary text (fallback path only).
function extractJsonObject(s) {
  s = claudeStr(s);
  var start = s.indexOf('{');
  if (start < 0) return null;
  var depth = 0, inStr = false, esc = false;
  for (var i = start; i < s.length; i++) {
    var ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}

// callClaude(fetchFn, body, opts) -> Promise<normalized result>. fetchFn(body, {timeoutMs}) must resolve to
// { status, body, latency_ms, headers }. Retries ONLY transient categories, bounded, with backoff+jitter.
// Deterministic 4xx/schema errors are never blind-retried. Pure of secrets (fetchFn owns auth).
function callClaude(fetchFn, body, opts) {
  opts = opts || {};
  var maxAttempts = claudeNum(opts.max_attempts, 3);
  var baseDelay = claudeNum(opts.base_delay_ms, 500);
  var timeoutMs = claudeNum(opts.timeout_ms, 75000);
  var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var rand = opts.rand || Math.random;
  function attempt(n) {
    return Promise.resolve(fetchFn(body, { timeoutMs: timeoutMs })).then(function (http) {
      var res = parseClaudeResponse(http, { model: body.model });
      if (res.ok) { res.attempts = n; return res; }
      if (isTransientClaudeError(res.error_category) && n < maxAttempts) {
        var delay = Math.round(baseDelay * Math.pow(2, n - 1) * (1 + rand()));
        return sleep(delay).then(function () { return attempt(n + 1); });
      }
      res.attempts = n; return res;
    }, function (err) {
      var res = { ok: false, error_category: 'timeout', error_message: claudeStr(err && (err.code || err.message)).slice(0, 120), usage: normalizeUsage(), attempts: n, latency_ms: 0, request_id: '', stop_reason: '', content: null, schema_mode: '', provider: 'aiprimetech' };
      if (n < maxAttempts) { var d = Math.round(baseDelay * Math.pow(2, n - 1) * (1 + rand())); return sleep(d).then(function () { return attempt(n + 1); }); }
      return res;
    });
  }
  return attempt(1);
}

module.exports = {
  CLAUDE_ENDPOINT_PATH, CLAUDE_ANTHROPIC_VERSION,
  buildToolRequest, classifyClaudeError, isTransientClaudeError, parseClaudeResponse,
  normalizeUsage, extractJsonObject, callClaude
};
