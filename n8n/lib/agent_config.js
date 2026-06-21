'use strict';
// agent_config.js — Stage 4 central configuration contract (B1).
//
// ONE place resolves the entire agent runtime config from environment variables + safe defaults,
// so the operator never hand-edits a Spreadsheet ID (or any limit/flag) inside individual nodes.
// The orchestrator calls resolveConfig() once and passes the resolved object downstream; every other
// workflow receives config from the request record instead of carrying its own copy.
//
// NO secrets live here or in workflow JSON. Credentials (Google/Telegram/Claude/Apify) stay in the
// n8n credential store; this module only resolves NON-secret runtime settings + the spreadsheet id
// (an id, not a secret) from $env. In a Code node call it as resolveConfig($env) — the harness shims
// $env as {} so the same code runs offline.

function str(v) { return v == null ? '' : String(v).trim(); }
function num(v, d) { const n = Number(v); return isFinite(n) && str(v) !== '' ? n : d; }
function bool(v, d) {
  if (v === true) return true;
  if (v === false) return false;
  const s = str(v).toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;
  return d;
}
function list(v) { return str(v).split(/[\s,;]+/).filter(Boolean); }

// Production-safe defaults: fail-closed (approval + source-health required), website-only allowlist,
// LLM features OFF, tight budgets. Everything is overridable by env or explicit override.
const DEFAULTS = {
  spreadsheet_id: '',
  telegram_allowed_user_ids: [],
  max_sources_per_request: 3,
  max_items_per_source: 25,
  max_external_calls: 40,
  source_budget_usd: 0.20,
  llm_budget_usd: 0.50,
  default_region: 'Москва/МО',
  default_niche: 'credit_brokerage',
  source_allowlist: ['website'],
  require_approval: true,
  require_source_health: true,
  enable_llm_planner: false,
  enable_llm_summary: false,
  report_data_mode: 'live'
};

// Map env var -> resolved config. Unknown/blank env falls back to DEFAULTS; explicit overrides win last.
function resolveConfig(env, overrides) {
  env = env || {};
  overrides = overrides || {};
  const allowedUsers = list(env.MS_TELEGRAM_ALLOWED_USER_IDS);
  const allowlist = list(env.MS_SOURCE_ALLOWLIST).map(s => s.toLowerCase());
  const cfg = {
    spreadsheet_id: str(env.MS_SPREADSHEET_ID) || DEFAULTS.spreadsheet_id,
    telegram_allowed_user_ids: (allowedUsers.length ? allowedUsers : DEFAULTS.telegram_allowed_user_ids).map(String),
    max_sources_per_request: num(env.MS_MAX_SOURCES, DEFAULTS.max_sources_per_request),
    max_items_per_source: num(env.MS_MAX_ITEMS_PER_SOURCE, DEFAULTS.max_items_per_source),
    max_external_calls: num(env.MS_MAX_EXTERNAL_CALLS, DEFAULTS.max_external_calls),
    source_budget_usd: num(env.MS_SOURCE_BUDGET_USD, DEFAULTS.source_budget_usd),
    llm_budget_usd: num(env.MS_LLM_BUDGET_USD, DEFAULTS.llm_budget_usd),
    default_region: str(env.MS_DEFAULT_REGION) || DEFAULTS.default_region,
    default_niche: str(env.MS_DEFAULT_NICHE) || DEFAULTS.default_niche,
    source_allowlist: allowlist.length ? allowlist : DEFAULTS.source_allowlist.slice(),
    require_approval: bool(env.MS_REQUIRE_APPROVAL, DEFAULTS.require_approval),
    require_source_health: bool(env.MS_REQUIRE_SOURCE_HEALTH, DEFAULTS.require_source_health),
    enable_llm_planner: bool(env.MS_ENABLE_LLM_PLANNER, DEFAULTS.enable_llm_planner),
    enable_llm_summary: bool(env.MS_ENABLE_LLM_SUMMARY, DEFAULTS.enable_llm_summary),
    report_data_mode: str(env.MS_REPORT_DATA_MODE) || DEFAULTS.report_data_mode
  };
  for (const k in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, k)) cfg[k] = overrides[k];
  }
  // completeness check the orchestrator surfaces in the execution summary — never starts paid work blind
  cfg.missing = [];
  if (!cfg.spreadsheet_id) cfg.missing.push('MS_SPREADSHEET_ID');
  if (!cfg.telegram_allowed_user_ids.length) cfg.missing.push('MS_TELEGRAM_ALLOWED_USER_IDS');
  cfg.config_complete = cfg.missing.length === 0;
  return cfg;
}

function isAllowedUser(cfg, userId) {
  return ((cfg && cfg.telegram_allowed_user_ids) || []).indexOf(String(userId)) >= 0;
}
function sourceAllowed(cfg, source) {
  return ((cfg && cfg.source_allowlist) || []).indexOf(String(source).toLowerCase()) >= 0;
}

module.exports = { DEFAULTS, resolveConfig, isAllowedUser, sourceAllowed, str, num, bool, list };
