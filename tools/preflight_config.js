// preflight_config.js — fail-closed runtime configuration check for n8n deployment (QA-006). Validates the
// NON-secret runtime environment (credentials always stay in the n8n credential store and are never read here).
// Secret-ish values are never printed — only their validation verdict and a masked length.
//
// Severity model:
//   error   — a required value is missing/invalid, or zlib is required (XLSX-capable activation) but absent.
//   warning — an optional value is present but malformed (deploy may still --dry-run; activation must not).
//
// Checks:
//   required : MS_SPREADSHEET_ID, MS_TELEGRAM_ALLOWED_USER_IDS (and zlib when --require-zlib)
//   zlib     : NODE_FUNCTION_ALLOW_BUILTIN must list "zlib" for the XLSX writer Code node
//   booleans : MS_MONITORING_ENABLED, MS_WEEKLY_DIGEST_ENABLED, MS_ENABLE_LLM_PLANNER, MS_ENABLE_LLM_SUMMARY,
//              MS_REQUIRE_APPROVAL, MS_REQUIRE_SOURCE_HEALTH
//   numbers  : MS_SOURCE_BUDGET_USD, MS_LLM_BUDGET_USD, MS_MAX_ITEMS_PER_SOURCE, MS_MAX_EXTERNAL_CALLS,
//              MS_MAX_SOURCES (must be present-and-finite-and-non-negative when set)
//   allowlist: MS_SOURCE_ALLOWLIST tokens must be from the known source vocabulary
//   placeholders: no value may look like an unfilled template (PASTE…, CHANGEME, your-…, xxxx, <…>)
//
// Usage:
//   node tools/preflight_config.js [--json] [--require-zlib] [--soft] [--for apply|dry-run|activate]
//   --soft : downgrade required-missing to warnings (dry-run continues); exit stays 0 unless a hard parse fails.
'use strict';

const PLACEHOLDER_RE = /(^|[^a-z])(paste|changeme|change_me|your[-_]|placeholder|todo|xxxx+|<[^>]+>|replace[-_]?me)/i;
const BOOL_TRUE = ['true', 'yes', '1'];
const BOOL_FALSE = ['false', 'no', '0'];
const BOOL_FLAGS = ['MS_MONITORING_ENABLED', 'MS_WEEKLY_DIGEST_ENABLED', 'MS_ENABLE_LLM_PLANNER', 'MS_ENABLE_LLM_SUMMARY', 'MS_REQUIRE_APPROVAL', 'MS_REQUIRE_SOURCE_HEALTH',
  'MS_ENABLE_TELEGRAM', 'MS_ENABLE_EXTERNAL_ACTIONS', 'MS_ENABLE_APIFY', 'MS_ENABLE_FIRECRAWL', 'MS_ENABLE_VK', 'MS_ENABLE_CLAUDE'];
const NUM_VARS = ['MS_SOURCE_BUDGET_USD', 'MS_LLM_BUDGET_USD', 'MS_MAX_ITEMS_PER_SOURCE', 'MS_MAX_EXTERNAL_CALLS', 'MS_MAX_SOURCES'];
const ALLOWLIST_VOCAB = ['website', 'vk', 'telegram', 'avito', 'reviews', 'forum', 'classifieds', 'social'];
const REPORT_DATA_MODES = ['live', 'production', 'fixture', 'manual_test'];
// Telegram bot token: "<bot-id>:<35+ url-safe chars>". We validate SHAPE only and never echo the value.
const TELEGRAM_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

// The explicit, auditable zero-paid runtime profile (CONFIG-002): no paid call can ever fire under it.
const ZERO_PAID_PROFILE = {
  MS_ENABLE_TELEGRAM: 'true', MS_ENABLE_EXTERNAL_ACTIONS: 'false', MS_ENABLE_APIFY: 'false',
  MS_ENABLE_FIRECRAWL: 'false', MS_ENABLE_VK: 'false', MS_ENABLE_CLAUDE: 'false',
  MS_ENABLE_LLM_PLANNER: 'false', MS_ENABLE_LLM_SUMMARY: 'false', MS_REQUIRE_APPROVAL: 'true',
  MS_REQUIRE_SOURCE_HEALTH: 'true', MS_MONITORING_ENABLED: 'false', MS_WEEKLY_DIGEST_ENABLED: 'false',
  MS_SOURCE_BUDGET_USD: '0', MS_LLM_BUDGET_USD: '0', MS_MAX_EXTERNAL_CALLS: '0', MS_MAX_SOURCES: '1',
  MS_MAX_ITEMS_PER_SOURCE: '10', MS_SOURCE_ALLOWLIST: 'website', MS_TIMEZONE: 'Europe/Moscow',
  N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false', NODE_FUNCTION_ALLOW_BUILTIN: 'zlib', MS_REPORT_DATA_MODE: 'live'
};

function str(v) { return v == null ? '' : String(v).trim(); }
function isBool(v) { const s = str(v).toLowerCase(); return BOOL_TRUE.indexOf(s) >= 0 || BOOL_FALSE.indexOf(s) >= 0; }
function boolTrue(v) { return BOOL_TRUE.indexOf(str(v).toLowerCase()) >= 0; }
function looksPlaceholder(v) { return PLACEHOLDER_RE.test(str(v)); }
function mask(v) { const s = str(v); return s ? 'set(len=' + s.length + ')' : 'unset'; }
function isValidTimeZone(tz) {
  if (!tz) return false;
  try { Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { void e; return false; }
}
function isHttpsUrl(u) {
  const s = str(u);
  if (!/^https:\/\/[^\s]+$/i.test(s)) return false;
  try { const url = new (require('url').URL)(s); return url.protocol === 'https:' && !!url.hostname; } catch (e) { void e; return false; }
}
// Compare an env against the zero-paid profile; returns mismatches (key, expected, got-mask for secret-ish keys).
function checkZeroPaidProfile(env) {
  env = env || {};
  const mismatches = [];
  for (const k of Object.keys(ZERO_PAID_PROFILE)) {
    const want = ZERO_PAID_PROFILE[k];
    const got = str(env[k]);
    const eq = k === 'NODE_FUNCTION_ALLOW_BUILTIN'
      ? (got === '*' || got.split(/[\s,;]+/).filter(Boolean).indexOf('zlib') >= 0)
      : got.toLowerCase() === want.toLowerCase();
    if (!eq) mismatches.push({ key: k, expected: want, got: got === '' ? '(unset)' : got });
  }
  return { ok: mismatches.length === 0, mismatches };
}

// evaluate(env, opts) -> { ok, errors, warnings, checks, summary }
// opts: { soft, requireZlib, forActivation, profile } . forActivation promotes activation-critical checks
// (Telegram token, $env access, public webhook url, webhook secret) from informational to fail-closed errors.
function evaluate(env, opts) {
  env = env || {};
  opts = opts || {};
  const soft = !!opts.soft;
  const requireZlib = !!opts.requireZlib;
  const forActivation = !!opts.forActivation;
  const errors = [];
  const warnings = [];
  const checks = [];
  const need = soft ? warnings : errors;
  // activation-critical bucket: errors when activating, warnings (still surfaced) otherwise.
  const activationNeed = forActivation ? errors : warnings;

  function record(name, status, detail) { checks.push({ name: name, status: status, detail: detail || '' }); }

  // --- required values ---
  const sid = str(env.MS_SPREADSHEET_ID);
  if (!sid) { need.push('MS_SPREADSHEET_ID is required'); record('MS_SPREADSHEET_ID', soft ? 'warn' : 'missing'); }
  else if (looksPlaceholder(sid)) { errors.push('MS_SPREADSHEET_ID looks like an unfilled placeholder'); record('MS_SPREADSHEET_ID', 'placeholder', mask(sid)); }
  else record('MS_SPREADSHEET_ID', 'ok', mask(sid));

  const ids = str(env.MS_TELEGRAM_ALLOWED_USER_IDS);
  const idList = ids.split(/[\s,;]+/).filter(Boolean);
  if (!idList.length) { need.push('MS_TELEGRAM_ALLOWED_USER_IDS is required (comma-separated numeric Telegram user ids)'); record('MS_TELEGRAM_ALLOWED_USER_IDS', soft ? 'warn' : 'missing'); }
  else if (looksPlaceholder(ids) || !idList.every(x => /^\d+$/.test(x))) { errors.push('MS_TELEGRAM_ALLOWED_USER_IDS must be numeric user ids'); record('MS_TELEGRAM_ALLOWED_USER_IDS', 'invalid', 'count=' + idList.length); }
  else record('MS_TELEGRAM_ALLOWED_USER_IDS', 'ok', 'count=' + idList.length);

  // --- zlib (XLSX writer Code node needs it; required only for XLSX-capable activation) ---
  const allowBuiltin = str(env.NODE_FUNCTION_ALLOW_BUILTIN);
  const zlibAllowed = allowBuiltin === '*' || allowBuiltin.split(/[\s,;]+/).filter(Boolean).indexOf('zlib') >= 0;
  if (zlibAllowed) record('NODE_FUNCTION_ALLOW_BUILTIN(zlib)', 'ok', allowBuiltin === '*' ? '*' : 'zlib listed');
  else if (requireZlib) { errors.push('NODE_FUNCTION_ALLOW_BUILTIN must include "zlib" to activate XLSX-capable workflows (WF24/WF25)'); record('NODE_FUNCTION_ALLOW_BUILTIN(zlib)', 'missing', 'XLSX export would fail at runtime'); }
  else { warnings.push('NODE_FUNCTION_ALLOW_BUILTIN does not include "zlib" — XLSX report export will fail until set'); record('NODE_FUNCTION_ALLOW_BUILTIN(zlib)', 'warn', 'required before activating WF24/WF25'); }

  // --- boolean flags ---
  for (const f of BOOL_FLAGS) {
    const v = env[f];
    if (str(v) === '') { record(f, 'default'); continue; }
    if (isBool(v)) record(f, 'ok', String(v).toLowerCase());
    else { warnings.push(f + ' is not a boolean (expected true/false)'); record(f, 'warn', 'not boolean'); }
  }

  // --- numeric budgets/limits ---
  for (const f of NUM_VARS) {
    const v = env[f];
    if (str(v) === '') { record(f, 'default'); continue; }
    const n = Number(v);
    if (!isFinite(n)) { warnings.push(f + ' is not a finite number'); record(f, 'warn', 'NaN'); }
    else if (n < 0) { errors.push(f + ' must be non-negative'); record(f, 'invalid', String(n)); }
    else record(f, 'ok', String(n));
  }

  // --- source allowlist vocabulary ---
  const al = str(env.MS_SOURCE_ALLOWLIST);
  if (al === '') record('MS_SOURCE_ALLOWLIST', 'default', "['website']");
  else {
    const toks = al.toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const bad = toks.filter(t => ALLOWLIST_VOCAB.indexOf(t) < 0);
    if (looksPlaceholder(al)) { errors.push('MS_SOURCE_ALLOWLIST looks like an unfilled placeholder'); record('MS_SOURCE_ALLOWLIST', 'placeholder'); }
    else if (bad.length) { warnings.push('MS_SOURCE_ALLOWLIST has unknown source(s): ' + bad.join(',')); record('MS_SOURCE_ALLOWLIST', 'warn', 'unknown:' + bad.join(',')); }
    else record('MS_SOURCE_ALLOWLIST', 'ok', toks.join(','));
  }

  // --- strict timezone (PREFLIGHT-005 / CONFIG-005): a malformed IANA zone breaks schedules + timestamps ---
  const tz = str(env.MS_TIMEZONE);
  if (tz === '') record('MS_TIMEZONE', 'default', 'Europe/Moscow');
  else if (!isValidTimeZone(tz)) { errors.push('MS_TIMEZONE is not a valid IANA timezone: ' + tz); record('MS_TIMEZONE', 'invalid', tz); }
  else record('MS_TIMEZONE', 'ok', tz);

  // --- report data mode enum (CONFIG-002/005) ---
  const rdm = str(env.MS_REPORT_DATA_MODE).toLowerCase();
  if (rdm === '') record('MS_REPORT_DATA_MODE', 'default', 'live');
  else if (REPORT_DATA_MODES.indexOf(rdm) < 0) { errors.push('MS_REPORT_DATA_MODE must be one of ' + REPORT_DATA_MODES.join('|')); record('MS_REPORT_DATA_MODE', 'invalid', rdm); }
  else record('MS_REPORT_DATA_MODE', 'ok', rdm);

  // --- LIVE-001 / PREFLIGHT-002: n8n Code nodes must be able to read $env; any other value breaks the runtime ---
  const blockEnv = str(env.N8N_BLOCK_ENV_ACCESS_IN_NODE).toLowerCase();
  if (blockEnv === 'false') record('N8N_BLOCK_ENV_ACCESS_IN_NODE', 'ok', 'false');
  else if (blockEnv === '') { activationNeed.push('N8N_BLOCK_ENV_ACCESS_IN_NODE must be set to false (Code nodes read $env)'); record('N8N_BLOCK_ENV_ACCESS_IN_NODE', forActivation ? 'missing' : 'warn'); }
  else { activationNeed.push('N8N_BLOCK_ENV_ACCESS_IN_NODE must be false, got "' + blockEnv + '" (Code nodes would lose $env)'); record('N8N_BLOCK_ENV_ACCESS_IN_NODE', forActivation ? 'invalid' : 'warn', blockEnv); }

  // --- PREFLIGHT-001 / TELEGRAM: bot token SHAPE only, never echoed; activation-critical ---
  const token = str(env.MS_TELEGRAM_BOT_TOKEN);
  if (token === '') { activationNeed.push('MS_TELEGRAM_BOT_TOKEN is required to register the Telegram webhook'); record('MS_TELEGRAM_BOT_TOKEN', forActivation ? 'missing' : 'default'); }
  else if (looksPlaceholder(token) || !TELEGRAM_TOKEN_RE.test(token)) { errors.push('MS_TELEGRAM_BOT_TOKEN does not look like a valid bot token (<id>:<secret>)'); record('MS_TELEGRAM_BOT_TOKEN', 'invalid', mask(token)); }
  else record('MS_TELEGRAM_BOT_TOKEN', 'ok', mask(token));

  // --- TELEGRAM-001 / §14: public ingress base url (activation-critical; HTTPS only) ---
  const webhookBase = str(env.PUBLIC_WEBHOOK_BASE_URL || env.WEBHOOK_URL);
  if (webhookBase === '') { activationNeed.push('PUBLIC_WEBHOOK_BASE_URL is required for the Telegram webhook (HTTPS, operator-provided)'); record('PUBLIC_WEBHOOK_BASE_URL', forActivation ? 'missing' : 'default'); }
  else if (looksPlaceholder(webhookBase) || !isHttpsUrl(webhookBase)) { activationNeed.push('PUBLIC_WEBHOOK_BASE_URL must be a valid HTTPS url'); record('PUBLIC_WEBHOOK_BASE_URL', forActivation ? 'invalid' : 'warn', 'not https'); }
  else record('PUBLIC_WEBHOOK_BASE_URL', 'ok', 'https');

  // --- TELEGRAM-002: webhook secret (activation-critical; strong, never echoed) ---
  const secret = str(env.MS_TELEGRAM_WEBHOOK_SECRET);
  if (secret === '') { activationNeed.push('MS_TELEGRAM_WEBHOOK_SECRET is required (validates X-Telegram-Bot-Api-Secret-Token)'); record('MS_TELEGRAM_WEBHOOK_SECRET', forActivation ? 'missing' : 'default'); }
  else if (looksPlaceholder(secret) || secret.length < 16) { activationNeed.push('MS_TELEGRAM_WEBHOOK_SECRET is too weak (use >= 16 random chars)'); record('MS_TELEGRAM_WEBHOOK_SECRET', forActivation ? 'invalid' : 'warn', mask(secret)); }
  else record('MS_TELEGRAM_WEBHOOK_SECRET', 'ok', mask(secret));

  // --- FUTURE-015: cross-field paid-config invariants (a contradiction must not silently default) ---
  const extActions = boolTrue(env.MS_ENABLE_EXTERNAL_ACTIONS);
  const collectors = { apify: boolTrue(env.MS_ENABLE_APIFY), firecrawl: boolTrue(env.MS_ENABLE_FIRECRAWL), vk: boolTrue(env.MS_ENABLE_VK) };
  const anyCollector = collectors.apify || collectors.firecrawl || collectors.vk;
  const claude = boolTrue(env.MS_ENABLE_CLAUDE);
  const maxCalls = Number(str(env.MS_MAX_EXTERNAL_CALLS) || '0');
  const llmBudget = Number(str(env.MS_LLM_BUDGET_USD) || '0');
  const monitoring = boolTrue(env.MS_MONITORING_ENABLED);
  function invariant(name, bad, msg) { if (bad) { need.push(msg); record('invariant:' + name, soft ? 'warn' : 'error', msg); } else record('invariant:' + name, 'ok'); }
  invariant('collector_requires_external_actions', anyCollector && !extActions, 'a collector is enabled but MS_ENABLE_EXTERNAL_ACTIONS=false');
  invariant('external_actions_need_calls', extActions && !(maxCalls > 0), 'MS_ENABLE_EXTERNAL_ACTIONS=true but MS_MAX_EXTERNAL_CALLS<=0');
  invariant('claude_needs_budget', claude && !(llmBudget > 0), 'MS_ENABLE_CLAUDE=true but MS_LLM_BUDGET_USD<=0');
  if (monitoring && !anyCollector) { warnings.push('MS_MONITORING_ENABLED=true but no collector is enabled — monitoring has nothing to collect'); record('invariant:monitoring_needs_collector', 'warn'); }
  // allowlist adapter whose enable flag is off (only meaningful once external actions are on)
  const alToks = str(env.MS_SOURCE_ALLOWLIST).toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const adapterFlag = { firecrawl: collectors.firecrawl, website: collectors.firecrawl, apify: collectors.apify, avito: collectors.apify, vk: collectors.vk };
  for (const t of alToks) {
    if (t in adapterFlag && extActions && !adapterFlag[t]) { warnings.push('MS_SOURCE_ALLOWLIST includes "' + t + '" but its collector is disabled'); record('invariant:allowlist_adapter_' + t, 'warn'); }
  }

  // --- optional explicit zero-paid profile assertion (CONFIG-002) ---
  if (opts.profile === 'zero-paid') {
    const z = checkZeroPaidProfile(env);
    for (const m of z.mismatches) { errors.push('zero-paid profile: ' + m.key + ' must be ' + m.expected + ' (got ' + m.got + ')'); record('zero_paid:' + m.key, 'invalid', m.expected); }
    if (z.ok) record('zero_paid_profile', 'ok', 'all ' + Object.keys(ZERO_PAID_PROFILE).length + ' keys match');
  }

  const ok = errors.length === 0;
  return {
    ok: ok,
    require_zlib: requireZlib,
    zlib_allowed: zlibAllowed,
    soft: soft,
    for_activation: forActivation,
    profile: opts.profile || null,
    error_count: errors.length,
    warning_count: warnings.length,
    errors: errors,
    warnings: warnings,
    checks: checks
  };
}

module.exports = { evaluate, looksPlaceholder, isBool, isValidTimeZone, isHttpsUrl, checkZeroPaidProfile, ZERO_PAID_PROFILE, REPORT_DATA_MODES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.indexOf('--json') >= 0;
  const profIdx = args.indexOf('--profile');
  const opts = {
    soft: args.indexOf('--soft') >= 0,
    requireZlib: args.indexOf('--require-zlib') >= 0,
    forActivation: args.indexOf('--for-activation') >= 0 || args.indexOf('--activate') >= 0,
    profile: profIdx >= 0 ? args[profIdx + 1] : null
  };
  // CHECKCONFIG-001: by default the preflight saw ONLY the current shell (process.env), so a production check
  // reported container/compose-provided vars as missing. With --discover it evaluates the EFFECTIVE environment the
  // running n8n actually sees (precedence container > file > process), via the SAME tools/env_discovery.js path the
  // deploy dry-run uses — so check-config and the deploy preflight can never disagree. Secret values are never shown.
  let env = process.env;
  let discoveryReport = null;
  if (args.indexOf('--discover') >= 0) {
    const ENV = require('./env_discovery.js');
    const sIdx = args.indexOf('--env-source');
    discoveryReport = ENV.discover({ source: sIdx >= 0 ? args[sIdx + 1] : undefined });
    env = Object.assign({}, process.env, discoveryReport.effective);
  }
  const rep = evaluate(env, opts);
  if (discoveryReport) {
    rep.env_sources = discoveryReport.sources_present;
    rep.env_precedence = discoveryReport.effective_precedence;
    rep.env_agreement = discoveryReport.agree ? 'PASS' : 'MISMATCH';
    rep.env_mismatches = discoveryReport.mismatches.map(m => ({ key: m.key, secret: m.secret })); // keys only, never values
  }
  if (json) {
    console.log(JSON.stringify(rep, null, 2));
  } else {
    console.log('Runtime config preflight (' + (opts.soft ? 'soft/dry-run' : 'fail-closed') + (opts.requireZlib ? ', zlib required' : '') + '):');
    if (discoveryReport) {
      console.log('  env sources: ' + (discoveryReport.sources_present.join(',') || 'none') + ' (precedence ' + (discoveryReport.effective_precedence.join('>') || 'none') + ')' + (discoveryReport.agree ? '' : ' [MATERIAL DISAGREEMENT file vs container — keys: ' + discoveryReport.mismatches.map(m => m.key).join(',') + ']'));
    }
    for (const c of rep.checks) console.log('  [' + c.status + '] ' + c.name + (c.detail ? '  ' + c.detail : ''));
    if (rep.warnings.length) { console.log('WARNINGS:'); rep.warnings.forEach(w => console.log('  - ' + w)); }
    if (rep.errors.length) { console.log('ERRORS:'); rep.errors.forEach(e => console.log('  - ' + e)); }
    console.log(rep.ok ? 'PREFLIGHT_OK=true' : 'PREFLIGHT_OK=false');
  }
  process.exit(rep.ok ? 0 : 1);
}
