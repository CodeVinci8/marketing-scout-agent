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
// phrase list: split ONLY on ; or | (items may contain spaces, e.g. Avito search queries)
function phraseList(v) { return str(v).split(/[;|]/).map(s => s.trim()).filter(Boolean); }

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
  report_data_mode: 'live',
  // ---- Stage 4 free-path / zero-paid-call guards (all fail-closed) -------------------------------------------
  // Telegram conversation is allowed; every PAID external action is OFF by default. The free path runs the full
  // conversation -> plan -> approval -> persistence loop while making zero paid calls. `max_external_calls` (above)
  // is the master kill-switch: 0 means no paid source/LLM call can occur even after approval.
  timezone: 'Europe/Moscow',
  // WF18-CONFIG-001: the Telegram ingress is fail-closed. The bot does NOTHING (no parse, no Sheets, no send)
  // until the operator explicitly sets MS_ENABLE_TELEGRAM=true. WF18 branches on this as a HARD ingress gate.
  enable_telegram: false,
  enable_external_actions: false,   // master switch for any paid collection/analysis
  enable_claude: false,             // Claude (planner/summary) only when explicitly enabled
  enable_apify: false,
  enable_firecrawl: false,
  enable_vk: false,
  // Stage 5: Telegram PUBLIC channel preview collector (t.me/s/<channel>, no per-call fee but still an external
  // fetch — gated like every collector). Distinct from enable_telegram (the bot ingress).
  enable_telegram_collector: false,
  monitoring_enabled: false,
  weekly_digest_enabled: false,
  // Stage 5 MVP source targets (overridable by env; NON-secret). Avito queries are phrases (split on ';').
  avito_queries: ['кредитный брокер Москва', 'помощь в получении кредита Москва', 'кредит под ПТС Москва'],
  telegram_channels: ['mfo_market', 'da_credit', 'broker_Aleksey'],
  vk_communities: ['kredit874', 'da_credit', 'anna_findoctor'],
  // real Moscow competitor sites for the website source (set via MS_WEBSITE_COMPETITOR_URLS; https only)
  // MVP v1 verified Moscow credit-broker competitor sites (live-checked 2026-07-03: помощь в получении
  // кредита / залог / ПТС / рефинансирование / ипотека, все https). MS_WEBSITE_COMPETITOR_URLS overrides.
  website_competitor_urls: ['https://www.lioncredit.ru/', 'https://finardi.ru/', 'https://mkbkfin.ru/']
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
    report_data_mode: str(env.MS_REPORT_DATA_MODE) || DEFAULTS.report_data_mode,
    timezone: str(env.MS_TIMEZONE) || DEFAULTS.timezone,
    enable_telegram: bool(env.MS_ENABLE_TELEGRAM, DEFAULTS.enable_telegram),
    enable_external_actions: bool(env.MS_ENABLE_EXTERNAL_ACTIONS, DEFAULTS.enable_external_actions),
    enable_claude: bool(env.MS_ENABLE_CLAUDE, DEFAULTS.enable_claude),
    enable_apify: bool(env.MS_ENABLE_APIFY, DEFAULTS.enable_apify),
    enable_firecrawl: bool(env.MS_ENABLE_FIRECRAWL, DEFAULTS.enable_firecrawl),
    enable_vk: bool(env.MS_ENABLE_VK, DEFAULTS.enable_vk),
    enable_telegram_collector: bool(env.MS_ENABLE_TELEGRAM_COLLECTOR, DEFAULTS.enable_telegram_collector),
    monitoring_enabled: bool(env.MS_MONITORING_ENABLED, DEFAULTS.monitoring_enabled),
    weekly_digest_enabled: bool(env.MS_WEEKLY_DIGEST_ENABLED, DEFAULTS.weekly_digest_enabled),
    avito_queries: (phraseList(env.MS_AVITO_QUERIES).length ? phraseList(env.MS_AVITO_QUERIES) : DEFAULTS.avito_queries.slice()).slice(0, 3),
    telegram_channels: (list(env.MS_TELEGRAM_CHANNELS).length ? list(env.MS_TELEGRAM_CHANNELS) : DEFAULTS.telegram_channels.slice()).slice(0, 3),
    vk_communities: (list(env.MS_VK_COMMUNITIES).length ? list(env.MS_VK_COMMUNITIES) : DEFAULTS.vk_communities.slice()).slice(0, 3),
    website_competitor_urls: (list(env.MS_WEBSITE_COMPETITOR_URLS).length ? list(env.MS_WEBSITE_COMPETITOR_URLS) : DEFAULTS.website_competitor_urls.slice()).filter(u => /^https:\/\//i.test(u)).slice(0, 3)
  };
  for (const k in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, k)) cfg[k] = overrides[k];
  }
  // fail-closed reconciliation: Claude master switch gates the LLM features; the external-actions master switch
  // (or a zero call ceiling) forces the effective paid-call budget to zero so no approval can spend.
  if (!cfg.enable_claude) { cfg.enable_llm_planner = false; cfg.enable_llm_summary = false; }
  // WF19-LLM-001: there is NO in-graph Claude intent-classifier node in WF18, so the intent router's guarded
  // LLM branch is unreachable by construction. Pin enable_llm_intent=false in the resolved config so the router
  // always resolves deterministically or asks ONE clarification — we never advertise a classification path that
  // cannot run. (The router lib still supports the branch for a future, explicitly-wired classifier.)
  cfg.enable_llm_intent = false;
  cfg.zero_paid_mode = (cfg.enable_external_actions !== true) || (Number(cfg.max_external_calls) <= 0);
  cfg.effective_max_external_calls = cfg.zero_paid_mode ? 0 : Number(cfg.max_external_calls);
  // scope_preview/collector naming alias — one flag, two historical names
  cfg.enable_vk_collector = cfg.enable_vk === true;
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
// true only when a PAID external action may run: external actions enabled AND a positive call ceiling.
// This is the single fail-closed predicate the orchestrator/monitor consult before any paid call.
function paidCallsAllowed(cfg) {
  return !!(cfg && cfg.enable_external_actions === true && Number(cfg.max_external_calls) > 0);
}
// per-collector gate: paid calls must be globally allowed AND the specific collector enabled AND on the allowlist.
function collectorEnabled(cfg, source) {
  if (!paidCallsAllowed(cfg)) return false;
  const s = String(source).toLowerCase();
  const flag = {
    website: 'enable_firecrawl', firecrawl: 'enable_firecrawl',
    apify: 'enable_apify', avito: 'enable_apify',
    vk: 'enable_vk', vk_community: 'enable_vk',
    telegram: 'enable_telegram_collector', telegram_channel: 'enable_telegram_collector'
  }[s];
  return sourceAllowed(cfg, s) && (flag ? cfg[flag] === true : false);
}
function llmAllowed(cfg) { return !!(cfg && cfg.enable_claude === true && (cfg.enable_llm_planner === true || cfg.enable_llm_summary === true)); }
// machine-readable free-path snapshot for the execution summary / tests.
function freePathStatus(cfg) {
  return {
    zero_paid_mode: !!(cfg && cfg.zero_paid_mode),
    enable_telegram: !!(cfg && cfg.enable_telegram),
    paid_calls_allowed: paidCallsAllowed(cfg),
    llm_allowed: llmAllowed(cfg),
    effective_max_external_calls: cfg ? Number(cfg.effective_max_external_calls) : 0,
    collectors: {
      firecrawl: collectorEnabled(cfg, 'website'), apify: collectorEnabled(cfg, 'apify'),
      vk: collectorEnabled(cfg, 'vk'), avito: collectorEnabled(cfg, 'avito'), telegram: collectorEnabled(cfg, 'telegram')
    }
  };
}

module.exports = { DEFAULTS, resolveConfig, isAllowedUser, sourceAllowed, paidCallsAllowed, collectorEnabled, llmAllowed, freePathStatus, str, num, bool, list };
