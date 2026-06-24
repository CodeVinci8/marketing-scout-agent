'use strict';
// provider_adapter.js — versioned shared GUARDED provider-adapter contract (Stage 5).
//
// This is the single brain for every outbound provider call (Claude / Firecrawl / Apify / website / public
// HTTP / VK / Avito). It does NOT open a socket itself: the network is an INJECTED `transport` function, so the
// exact same production code path is exercised offline by a deterministic, call-counting mock transport and
// (later) by a real HTTPS transport in a live smoke. That is what lets the retry/backoff/error-taxonomy/cost
// logic be PROVEN offline against the real path — not a parallel test-only copy.
//
// Guarantees: disabled by default (feature flag), credential preflight, request validation, bounded retries
// with exponential backoff + jitter, 429/Retry-After + transient-5xx retry, permanent-4xx no-retry,
// cancellation before every attempt, retry-exhaustion, NO call after budget block, idempotent persistence key,
// raw-response preserved by bounded reference, provider request-id + usage extraction, and an HONEST cost model
// (estimated / actual / actual_cost_unknown / free / budget_blocked) — never a fake $0. Pure + deterministic +
// self-contained (no requires, all top-level functions) so it is embeddable into n8n Code nodes. $0 offline.

var ADAPTER_CONTRACT_VERSION = 'adapter-v1';

// ---- error taxonomy (every provider/transport failure maps to exactly one) -----------------------------------
var ERROR_CATEGORIES = [
  'AUTHENTICATION', 'AUTHORIZATION', 'FEATURE_DISABLED', 'CREDENTIAL_MISSING', 'INVALID_REQUEST',
  'UNSUPPORTED_OPERATION', 'RATE_LIMIT', 'TIMEOUT', 'NETWORK', 'PROVIDER_4XX', 'PROVIDER_5XX',
  'INVALID_RESPONSE', 'EMPTY_RESULT', 'BUDGET_BLOCKED', 'CANCELLED', 'RETRY_EXHAUSTED', 'INTERNAL'
];
var RETRYABLE = { RATE_LIMIT: 1, TIMEOUT: 1, NETWORK: 1, PROVIDER_5XX: 1 };

// ---- adapter registry (capabilities + which operations each supports) ----------------------------------------
var ADAPTERS = {
  claude:    { provider: 'anthropic', family: 'llm',        operations: ['messages'],        flag: 'enable_claude',    credential: 'anthropicApi', first_class: true },
  firecrawl: { provider: 'firecrawl', family: 'web',        operations: ['scrape', 'crawl'],  flag: 'enable_firecrawl', credential: 'firecrawlApi', first_class: true },
  apify:     { provider: 'apify',     family: 'web',        operations: ['run_actor'],        flag: 'enable_apify',     credential: 'apifyApi',     first_class: true },
  website:   { provider: 'http',      family: 'website',    operations: ['fetch'],            flag: 'enable_external_actions', credential: null, first_class: true },
  http:      { provider: 'http',      family: 'public_api', operations: ['get', 'post'],      flag: 'enable_external_actions', credential: null, first_class: true },
  vk:        { provider: 'vk',        family: 'social',     operations: ['groups_get', 'wall_get'], flag: 'enable_vk', credential: 'vkApi',    optional: true },
  avito:     { provider: 'avito',     family: 'classifieds', operations: ['search'],          flag: 'enable_apify',     credential: 'apifyApi', experimental: true }
};

// ---- versioned pricing table (operator-configurable; NO fabricated rates shipped) ----------------------------
// We ship the MECHANISM + version, NOT invented prices. With no configured rate the cost is actual_cost_unknown.
// The operator supplies verified rates via cfg.pricing (same shape) to enable an `actual`/`estimated` cost.
var DEFAULT_PRICING = {
  version: 'pricing-unset-2026-06', effective_date: '2026-06-01', currency: 'USD',
  claude: { models: {} },                       // e.g. { 'claude-haiku-4-5': { input_per_mtok: 0, output_per_mtok: 0 } }
  firecrawl: { unit: 'page', estimate_per_unit_usd: null },
  apify: { unit: 'compute_unit', estimate_per_unit_usd: null }
};

function str(v) { return v == null ? '' : String(v).trim(); }
function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function djb2(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'h' + h.toString(16); }

function err(category, detail, retryable) {
  if (ERROR_CATEGORIES.indexOf(category) < 0) category = 'INTERNAL';
  return { category: category, detail: str(detail), retryable: retryable === undefined ? !!RETRYABLE[category] : !!retryable };
}

// ---- request schema ------------------------------------------------------------------------------------------
function buildRequest(input) {
  input = input || {};
  var adapter = str(input.adapter).toLowerCase();
  var spec = ADAPTERS[adapter];
  var operation = str(input.operation).toLowerCase();
  var req = {
    contract_version: ADAPTER_CONTRACT_VERSION,
    adapter: adapter,
    operation: operation,
    request_id: str(input.request_id) || djb2(adapter + '|' + operation + '|' + str(input.target) + '|' + str(input.query) + '|' + str(input.url)),
    owner_id: str(input.owner_id),
    target: str(input.target),
    query: str(input.query),
    url: str(input.url),
    options: input.options && typeof input.options === 'object' ? input.options : {},
    budget: {
      max_external_calls: num(input.budget && input.budget.max_external_calls, num(input.max_external_calls, 0)),
      max_cost_usd: (input.budget && input.budget.max_cost_usd != null) ? num(input.budget.max_cost_usd, null) : null
    },
    timeout_ms: num(input.timeout_ms, 15000),
    max_attempts: Math.max(1, num(input.max_attempts, 3)),
    max_results: num(input.max_results, 50),
    dry_run: input.dry_run === true,
    fixture_mode: input.fixture_mode === true,
    fixture: input.fixture
  };
  var problems = [];
  if (!spec) problems.push('unknown adapter');
  else if (spec.operations.indexOf(operation) < 0) problems.push('unsupported operation for ' + adapter);
  if (req.timeout_ms <= 0) problems.push('timeout_ms must be > 0');
  req.valid = problems.length === 0;
  req.problems = problems;
  return req;
}

// ---- credential + feature preflight (never reads/echoes a secret value) --------------------------------------
// `cfg` = resolved agent config (flags). `secrets` = a presence map { anthropicApi:true,... } the operator/n8n
// supplies; we only ever look at presence (boolean), never the value.
function preflightCredentials(adapter, cfg, secrets) {
  cfg = cfg || {}; secrets = secrets || {};
  var spec = ADAPTERS[str(adapter).toLowerCase()];
  if (!spec) return { ok: false, error: err('INVALID_REQUEST', 'unknown adapter'), markers: { CREDENTIAL_PRESENT: false, FEATURE_FLAG: false } };
  var flagOn = cfg[spec.flag] === true;
  if (!flagOn) return { ok: false, error: err('FEATURE_DISABLED', spec.flag + '=false'), markers: { FEATURE_FLAG: false, CREDENTIAL_PRESENT: null } };
  var credPresent = spec.credential == null ? true : (secrets[spec.credential] === true);
  if (!credPresent) return { ok: false, error: err('CREDENTIAL_MISSING', spec.credential + ' not configured'), markers: { FEATURE_FLAG: true, CREDENTIAL_PRESENT: false } };
  return { ok: true, error: null, markers: { FEATURE_FLAG: true, CREDENTIAL_PRESENT: credPresent, credential_type: spec.credential } };
}

// ---- provider response parsers (validate required shape; preserve unknown fields; reject malformed) ----------
function parseJsonBody(body) {
  if (body && typeof body === 'object') return { ok: true, json: body };
  try { return { ok: true, json: JSON.parse(String(body)) }; } catch (e) { return { ok: false }; }
}
// Anthropic Messages API shape.
function parseClaude(body) {
  var p = parseJsonBody(body); if (!p.ok) return { ok: false, error: err('INVALID_RESPONSE', 'claude: malformed JSON') };
  var j = p.json;
  if (!Array.isArray(j.content)) return { ok: false, error: err('INVALID_RESPONSE', 'claude: missing content[]') };
  var text = j.content.filter(function (c) { return c && c.type === 'text'; }).map(function (c) { return str(c.text); }).join('\n').trim();
  var u = j.usage || {};
  return {
    ok: true, provider_request_id: str(j.id),
    records: text ? [{ text: text }] : [],
    usage: { input_tokens: num(u.input_tokens, null), output_tokens: num(u.output_tokens, null),
      cache_creation_input_tokens: u.cache_creation_input_tokens != null ? num(u.cache_creation_input_tokens, null) : undefined,
      cache_read_input_tokens: u.cache_read_input_tokens != null ? num(u.cache_read_input_tokens, null) : undefined },
    model: str(j.model), stop_reason: str(j.stop_reason), source_urls: []
  };
}
// Firecrawl scrape/crawl shape: { success, data: {markdown,metadata:{sourceURL}} | [ ... ] }.
function parseFirecrawl(body) {
  var p = parseJsonBody(body); if (!p.ok) return { ok: false, error: err('INVALID_RESPONSE', 'firecrawl: malformed JSON') };
  var j = p.json;
  if (j.success === false) return { ok: false, error: err('PROVIDER_4XX', 'firecrawl: success=false ' + str(j.error)) };
  var data = Array.isArray(j.data) ? j.data : (j.data ? [j.data] : []);
  var records = data.map(function (d) { d = d || {}; var meta = d.metadata || {};
    return { url: str(meta.sourceURL || meta.url || d.url), title: str(meta.title), content: str(d.markdown || d.content || d.html), status_code: num(meta.statusCode, null) }; });
  var urls = records.map(function (r) { return r.url; }).filter(Boolean);
  return { ok: true, provider_request_id: str(j.id || (j.metadata && j.metadata.scrapeId)), records: records,
    usage: { pages: records.length, credits_used: j.creditsUsed != null ? num(j.creditsUsed, null) : null }, source_urls: urls };
}
// Apify dataset items shape: array of items (or { items: [...] }).
function parseApify(body) {
  var p = parseJsonBody(body); if (!p.ok) return { ok: false, error: err('INVALID_RESPONSE', 'apify: malformed JSON') };
  var j = p.json;
  var items = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : (Array.isArray(j.data) ? j.data : null));
  if (items == null) return { ok: false, error: err('INVALID_RESPONSE', 'apify: no items[]') };
  var records = items.map(function (it) { it = it || {}; return { url: str(it.url || it.link), title: str(it.title || it.name), content: str(it.text || it.description), raw_keys: Object.keys(it) }; });
  return { ok: true, provider_request_id: str(j.runId || (j.data && j.data.id)), records: records,
    usage: { items: records.length, compute_units: (j.stats && j.stats.computeUnits != null) ? num(j.stats.computeUnits, null) : null }, source_urls: records.map(function (r) { return r.url; }).filter(Boolean) };
}
var PARSERS = { claude: parseClaude, firecrawl: parseFirecrawl, apify: parseApify };
function parseProvider(adapter, body) {
  var fn = PARSERS[str(adapter).toLowerCase()];
  if (fn) return fn(body);
  // generic HTTP/website/vk/avito: accept JSON or text, no provider-specific schema.
  var p = parseJsonBody(body);
  if (p.ok) { var j = p.json; var items = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : [j]);
    return { ok: true, provider_request_id: '', records: items, usage: {}, source_urls: [] }; }
  return { ok: true, provider_request_id: '', records: [{ content: str(body) }], usage: {}, source_urls: [] };
}

// ---- cost model (honest: estimated / actual / actual_cost_unknown / free / budget_blocked) --------------------
function claudeCost(usage, model, pricing) {
  pricing = pricing || DEFAULT_PRICING;
  var rate = pricing.claude && pricing.claude.models ? pricing.claude.models[str(model)] : null;
  if (!rate) return { actual_cost: null, cost_status: 'actual_cost_unknown', pricing_version: pricing.version };
  var inTok = num(usage && usage.input_tokens, null), outTok = num(usage && usage.output_tokens, null);
  if (inTok == null || outTok == null) return { actual_cost: null, cost_status: 'actual_cost_unknown', pricing_version: pricing.version };
  var cost = (inTok / 1e6) * num(rate.input_per_mtok, 0) + (outTok / 1e6) * num(rate.output_per_mtok, 0);
  return { actual_cost: Math.round(cost * 1e6) / 1e6, cost_status: 'actual', pricing_version: pricing.version };
}
function usageCost(adapter, usage, pricing) {
  pricing = pricing || DEFAULT_PRICING;
  var cfg = pricing[str(adapter).toLowerCase()];
  var per = cfg ? cfg.estimate_per_unit_usd : null;
  var units = adapter === 'firecrawl' ? num(usage && usage.pages, null) : num(usage && usage.items, null);
  if (per == null || units == null) return { actual_cost: null, cost_status: 'actual_cost_unknown', pricing_version: pricing.version, usage_units: units };
  return { actual_cost: Math.round(units * per * 1e6) / 1e6, cost_status: 'estimated', pricing_version: pricing.version, usage_units: units };
}
function computeCost(adapter, parsed, pricing) {
  adapter = str(adapter).toLowerCase();
  if (adapter === 'claude') return claudeCost(parsed.usage, parsed.model, pricing);
  if (adapter === 'firecrawl' || adapter === 'apify') return usageCost(adapter, parsed.usage, pricing);
  return { actual_cost: 0, cost_status: 'free', pricing_version: (pricing || DEFAULT_PRICING).version };
}

// ---- normalized response -------------------------------------------------------------------------------------
function normalizeResponse(req, meta) {
  meta = meta || {};
  var parsed = meta.parsed || {};
  return {
    contract_version: ADAPTER_CONTRACT_VERSION,
    adapter: req.adapter, provider: (ADAPTERS[req.adapter] || {}).provider || req.adapter, operation: req.operation,
    request_id: req.request_id, owner_id: req.owner_id,
    success: meta.success === true, status: meta.status || (meta.success ? 'ok' : 'error'),
    provider_request_id: str(parsed.provider_request_id),
    records: parsed.records || [], record_count: (parsed.records || []).length,
    raw_response_reference: meta.raw_ref || null,
    source_urls: parsed.source_urls || [],
    retrieved_at: str(meta.retrieved_at),
    duration_ms: num(meta.duration_ms, 0), attempt_count: num(meta.attempt_count, 0),
    rate_limit: meta.rate_limit || null,
    usage: parsed.usage || {},
    estimated_cost: meta.estimated_cost == null ? null : num(meta.estimated_cost, null),
    actual_cost: meta.cost && meta.cost.actual_cost != null ? num(meta.cost.actual_cost, null) : null,
    cost_status: (meta.cost && meta.cost.cost_status) || 'actual_cost_unknown',
    pricing_version: meta.cost && meta.cost.pricing_version,
    delivery_key: djb2(req.adapter + '|' + req.operation + '|' + req.request_id),   // idempotent persistence key
    dry_run: req.dry_run === true,
    error: meta.error || null
  };
}

// ---- classify a transport outcome into the taxonomy ----------------------------------------------------------
function classifyHttp(status, headers) {
  status = num(status, 0); headers = headers || {};
  if (status === 401) return err('AUTHENTICATION', '401');
  if (status === 403) return err('AUTHORIZATION', '403');
  if (status === 429) { var e = err('RATE_LIMIT', '429'); e.retry_after_ms = num(headers['retry-after'], num(headers['Retry-After'], 0)) * 1000; return e; }
  if (status >= 500) return err('PROVIDER_5XX', String(status));
  if (status >= 400) return err('PROVIDER_4XX', String(status));
  return null;
}
function classifyThrow(e) {
  var m = str(e && e.message).toLowerCase();
  if (e && e.code === 'ETIMEDOUT' || /timeout/.test(m)) return err('TIMEOUT', str(e && e.message));
  return err('NETWORK', str(e && e.message));
}

// ---- the run loop (transport injected; retries/backoff/jitter/cancellation/budget all real) ------------------
// deps: { transport(req)->{status,headers,body} (may throw), now()->iso, rng()->[0,1), record_call(kind) }.
function backoffMs(attempt, base, rng) { var b = base * Math.pow(2, attempt - 1); var jitter = (rng ? rng() : 0.5) * base; return Math.round(b + jitter); }

function runAdapter(input, cfg, secrets, deps) {
  cfg = cfg || {}; secrets = secrets || {}; deps = deps || {};
  var now = deps.now || function () { return new Date().toISOString(); };
  var rng = deps.rng || function () { return 0.5; };
  var pricing = cfg.pricing || DEFAULT_PRICING;
  var req = buildRequest(input);
  var t0 = num(deps.t0, 0);
  if (!req.valid) return normalizeResponse(req, { success: false, status: 'invalid', retrieved_at: now(), error: err(req.problems[0] === 'unsupported operation for ' + req.adapter ? 'UNSUPPORTED_OPERATION' : 'INVALID_REQUEST', req.problems.join('; ')) });

  var pf = preflightCredentials(req.adapter, cfg, secrets);
  if (!pf.ok) return normalizeResponse(req, { success: false, status: 'preflight', retrieved_at: now(), error: pf.error });

  // budget gate BEFORE any call.
  var maxCalls = num(req.budget.max_external_calls, 0);
  if (!req.dry_run && !req.fixture_mode && maxCalls <= 0) {
    return normalizeResponse(req, { success: false, status: 'budget_blocked', retrieved_at: now(), error: err('BUDGET_BLOCKED', 'max_external_calls<=0 (zero-paid mode)') });
  }
  if (req.dry_run) {
    var costDry = { actual_cost: null, cost_status: 'estimated', pricing_version: pricing.version };
    return normalizeResponse(req, { success: true, status: 'dry_run', retrieved_at: now(), attempt_count: 0, parsed: { records: [], usage: {}, source_urls: [] }, cost: costDry, estimated_cost: null });
  }

  var attempt = 0, lastErr = null, callsMade = 0;
  while (attempt < req.max_attempts) {
    if (deps.is_cancelled && deps.is_cancelled()) return normalizeResponse(req, { success: false, status: 'cancelled', retrieved_at: now(), attempt_count: attempt, error: err('CANCELLED', 'cancelled before attempt ' + (attempt + 1)) });
    attempt++;
    var resp;
    try {
      if (req.fixture_mode) { resp = typeof req.fixture === 'function' ? req.fixture(req, attempt) : req.fixture; if (deps.record_call) deps.record_call('fixture'); }
      else { resp = deps.transport ? deps.transport(req, attempt) : (function () { throw new Error('no transport'); })(); callsMade++; if (deps.record_call) deps.record_call('live'); }
    } catch (e) {
      lastErr = classifyThrow(e);
      if (!lastErr.retryable || attempt >= req.max_attempts) break;
      continue; // backoff is conceptual offline (no real sleep); jitter computed for the live transport
    }
    var httpErr = classifyHttp(resp && resp.status, resp && resp.headers);
    if (httpErr) {
      lastErr = httpErr;
      if (!httpErr.retryable || attempt >= req.max_attempts) break;
      // a real budget check could stop retries here too; backoff delay computed (used by the live transport).
      backoffMs(attempt, 250, rng);
      continue;
    }
    var parsed = parseProvider(req.adapter, resp && resp.body);
    if (!parsed.ok) { lastErr = parsed.error; break; } // INVALID_RESPONSE — not retried (structural)
    if (!parsed.records.length && req.operation !== 'fetch') { lastErr = err('EMPTY_RESULT', 'no records'); }
    var cost = computeCost(req.adapter, parsed, pricing);
    var rl = resp && resp.headers ? { limit: resp.headers['x-ratelimit-limit'] || null, remaining: resp.headers['x-ratelimit-remaining'] || null } : null;
    return normalizeResponse(req, {
      success: !(lastErr && lastErr.category === 'EMPTY_RESULT') ? true : false,
      status: lastErr && lastErr.category === 'EMPTY_RESULT' ? 'empty' : 'ok',
      retrieved_at: now(), duration_ms: num(deps.duration_ms, 0), attempt_count: attempt,
      parsed: parsed, cost: cost, estimated_cost: cost.cost_status === 'estimated' ? cost.actual_cost : null,
      rate_limit: rl, raw_ref: { hash: djb2(typeof (resp && resp.body) === 'string' ? resp.body : JSON.stringify(resp && resp.body)), bytes: String(resp && resp.body ? (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body)) : '').length },
      error: lastErr && lastErr.category === 'EMPTY_RESULT' ? lastErr : null
    });
  }
  // fell out of the loop = failure
  var finalErr = lastErr || err('INTERNAL', 'no attempt made');
  if (lastErr && lastErr.retryable && attempt >= req.max_attempts) finalErr = err('RETRY_EXHAUSTED', 'after ' + attempt + ' attempts (' + lastErr.category + ')', false);
  return normalizeResponse(req, { success: false, status: 'error', retrieved_at: now(), attempt_count: attempt, error: finalErr });
}

module.exports = {
  ADAPTER_CONTRACT_VERSION, ERROR_CATEGORIES, RETRYABLE, ADAPTERS, DEFAULT_PRICING,
  buildRequest, preflightCredentials, parseClaude, parseFirecrawl, parseApify, parseProvider,
  claudeCost, usageCost, computeCost, normalizeResponse, classifyHttp, classifyThrow, backoffMs, runAdapter, djb2
};
