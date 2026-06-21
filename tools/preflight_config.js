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
const BOOL_FLAGS = ['MS_MONITORING_ENABLED', 'MS_WEEKLY_DIGEST_ENABLED', 'MS_ENABLE_LLM_PLANNER', 'MS_ENABLE_LLM_SUMMARY', 'MS_REQUIRE_APPROVAL', 'MS_REQUIRE_SOURCE_HEALTH'];
const NUM_VARS = ['MS_SOURCE_BUDGET_USD', 'MS_LLM_BUDGET_USD', 'MS_MAX_ITEMS_PER_SOURCE', 'MS_MAX_EXTERNAL_CALLS', 'MS_MAX_SOURCES'];
const ALLOWLIST_VOCAB = ['website', 'vk', 'telegram', 'avito', 'reviews', 'forum', 'classifieds', 'social'];

function str(v) { return v == null ? '' : String(v).trim(); }
function isBool(v) { const s = str(v).toLowerCase(); return BOOL_TRUE.indexOf(s) >= 0 || BOOL_FALSE.indexOf(s) >= 0; }
function looksPlaceholder(v) { return PLACEHOLDER_RE.test(str(v)); }
function mask(v) { const s = str(v); return s ? 'set(len=' + s.length + ')' : 'unset'; }

// evaluate(env, opts) -> { ok, errors, warnings, checks, summary }
function evaluate(env, opts) {
  env = env || {};
  opts = opts || {};
  const soft = !!opts.soft;
  const requireZlib = !!opts.requireZlib;
  const errors = [];
  const warnings = [];
  const checks = [];
  const need = soft ? warnings : errors;

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

  const ok = errors.length === 0;
  return {
    ok: ok,
    require_zlib: requireZlib,
    zlib_allowed: zlibAllowed,
    soft: soft,
    error_count: errors.length,
    warning_count: warnings.length,
    errors: errors,
    warnings: warnings,
    checks: checks
  };
}

module.exports = { evaluate, looksPlaceholder, isBool };

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.indexOf('--json') >= 0;
  const opts = { soft: args.indexOf('--soft') >= 0, requireZlib: args.indexOf('--require-zlib') >= 0 };
  const rep = evaluate(process.env, opts);
  if (json) {
    console.log(JSON.stringify(rep, null, 2));
  } else {
    console.log('Runtime config preflight (' + (opts.soft ? 'soft/dry-run' : 'fail-closed') + (opts.requireZlib ? ', zlib required' : '') + '):');
    for (const c of rep.checks) console.log('  [' + c.status + '] ' + c.name + (c.detail ? '  ' + c.detail : ''));
    if (rep.warnings.length) { console.log('WARNINGS:'); rep.warnings.forEach(w => console.log('  - ' + w)); }
    if (rep.errors.length) { console.log('ERRORS:'); rep.errors.forEach(e => console.log('  - ' + e)); }
    console.log(rep.ok ? 'PREFLIGHT_OK=true' : 'PREFLIGHT_OK=false');
  }
  process.exit(rep.ok ? 0 : 1);
}
