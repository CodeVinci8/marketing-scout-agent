'use strict';
// request_planner.js — Stage 4 request planner (B3).
//
// Turns a plain-text Telegram request into a bounded, schema-valid execution plan. Obvious fields are
// parsed deterministically (region, niche, sources, intent) so a plan ALWAYS exists even with the LLM
// planner off. The Claude planner is optional and guarded; its JSON is validated against the same schema
// and, on any invalid/over-budget output, the deterministic plan is used — invalid LLM output can never
// start external work.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }

// Region/niche dictionaries kept tiny + deterministic (the brokerage MVP). Region defaults from cfg.
const REGION_HINTS = [
  [/москв|msk|moscow|мо\b/i, 'Москва/МО'],
  [/питер|спб|петербург|spb/i, 'Санкт-Петербург'],
  [/росси|по рф|вся страна/i, 'Россия']
];
const NICHE_HINTS = [
  [/птс|залог авто|займ под авто|autopawn/i, 'pts_loan'],
  [/брокер|кредитн|кредит наличными|рефинанс/i, 'credit_brokerage'],
  [/микрозайм|мфо|до зарплаты/i, 'microloans']
];
const SOURCE_HINTS = [
  [/сайт|website|firecrawl|конкурент.{0,12}сайт/i, 'website'],
  [/avito|авито|объявлен/i, 'avito'],
  [/telegram|телеграм|t\.me|канал/i, 'telegram'],
  [/vk|вконтакте|соцсет/i, 'vk']
];

// AVITO-BLOCK-001: the sources the user EXPLICITLY named in the request text that are currently blocked (listed
// in cfg.blocked_sources). Lets the approval flow tell the user honestly that e.g. Avito is temporarily
// unavailable, instead of silently clamping the plan to the remaining allowlisted sources. Pure; reuses the
// SAME SOURCE_HINTS the planner parses, so detection can never drift from what the planner would have selected.
function blockedRequestedSources(text, cfg) {
  cfg = cfg || {};
  const blocked = ((cfg.blocked_sources) || []).map(low);
  if (!blocked.length) return [];
  const t = str(text);
  const named = [];
  for (const [rx, v] of SOURCE_HINTS) { if (rx.test(t) && named.indexOf(v) < 0) named.push(v); }
  return named.filter(s => blocked.indexOf(s) >= 0);
}

// URL-INTAKE-001: extract the safe, PUBLIC https URL(s) a user pasted so a request can target THOSE sites instead
// of the preset competitor list. Self-contained (embeddable): https-only; reject localhost / private+loopback IPs /
// link-local / cloud-metadata / credentials-in-url / non-web schemes; normalize (lowercase host, drop fragment);
// dedup; cap. A pasted URL is never trusted content — only its structure is used, never its page text here.
function extractSafeUrls(text, max) {
  const out = [], seen = {};
  const cap = num(max, 3);
  const raw = str(text);
  const rx = /\bhttps?:\/\/[^\s<>"'`)]+/gi;
  let m;
  while ((m = rx.exec(raw)) !== null && out.length < cap) {
    let u = m[0].replace(/[.,;:!?)]+$/, '');
    if (u.toLowerCase().indexOf('https://') !== 0) continue;          // public https only
    const afterScheme = u.slice(8);
    const authority = afterScheme.split(/[/?#]/)[0];
    if (authority.indexOf('@') >= 0) continue;                        // credentials in url
    const host = authority.split(':')[0].toLowerCase();
    if (!host || host === 'localhost' || host.indexOf('.') < 0) continue;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) continue;        // loopback / private / link-local IPv4
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) continue;                    // 172.16-31.x private
    if (/^\[?::1\]?$/.test(host) || /^\[?f[cd][0-9a-f]{2}:/i.test(host)) continue; // ipv6 loopback / ULA
    if (host === '169.254.169.254' || host === 'metadata.google.internal') continue; // cloud metadata
    const path = afterScheme.slice(authority.length).split('#')[0] || '';
    const norm = 'https://' + host + path;
    const key = norm.replace(/\/+$/, '').toLowerCase();
    if (seen[key]) continue; seen[key] = 1;
    out.push(norm.replace(/\/+$/, '/') === norm ? norm : norm);
  }
  return out;
}

// URL-INTAKE-002: general explicit-source extraction — a user may paste 1..N mixed PUBLIC sources (websites,
// Telegram channels, VK communities) in one message. Returns {websites, telegram_channels, vk_sources, rejected}.
// Self-contained (embeddable). Total explicit sources capped (default 3). Invite-only Telegram (t.me/+…, joinchat)
// and VK service links are rejected with a reason; unsafe/private websites are dropped by extractSafeUrls.
function extractExplicitSources(text, maxTotal) {
  const raw = str(text);
  const cap = num(maxTotal, 3);
  const websites = [], telegram = [], vk = [], rejected = [];
  const seen = {};
  function total() { return websites.length + telegram.length + vk.length; }
  function add(arr, val) { const k = low(val); if (seen[k]) return; if (total() >= cap) return; seen[k] = 1; arr.push(val); }
  let m;
  // Telegram public channels: t.me/<ch>, t.me/s/<ch>, https://t.me/<ch>. Reject invite links (t.me/+…, joinchat).
  const tgRx = /(?:https?:\/\/)?(?:t|telegram)\.me\/(s\/)?(\+?[a-z0-9_]{1,64})/gi;
  while ((m = tgRx.exec(raw)) !== null) {
    const h = m[2];
    if (/^\+/.test(h) || /joinchat/i.test(m[0]) || h.length < 3) { rejected.push({ raw: m[0], platform: 'telegram', reason: 'invite_only_or_private' }); continue; }
    add(telegram, '@' + h.toLowerCase());
  }
  // VK public communities/profiles: vk.com/<public>. Reject service paths (away/share/widget/…).
  const vkRx = /(?:https?:\/\/)?(?:www\.)?vk\.com\/([a-z0-9_.]{2,64})/gi;
  while ((m = vkRx.exec(raw)) !== null) {
    const h = m[1].toLowerCase();
    if (/^(away|share|widget|search|feed|im|id0)$/.test(h)) { rejected.push({ raw: m[0], platform: 'vk', reason: 'not_a_public_community' }); continue; }
    add(vk, 'vk.com/' + h);
  }
  // Websites: safe public https URLs, excluding t.me / vk.com hosts (handled above).
  extractSafeUrls(raw, cap).forEach(function (u) {
    const host = u.slice(8).split('/')[0];
    if (/(^|\.)(t\.me|telegram\.me|vk\.com)$/i.test(host)) return;
    add(websites, u);
  });
  // E2-ROUTE-001: also accept a BARE domain typed without a scheme ("дай отчёт по autolombardn1.ru") — normalize to
  // https://<domain>. Real TLD required so ordinary text never trips it; email hosts (preceded by @) and t.me/vk.com
  // are excluded; deduped against the https websites above.
  const bareRx = /(^|[\s(«"'“„])(([a-z0-9][a-z0-9-]{0,62}\.)+(ru|рф|com|net|org|io|su|by|kz|ua|info|biz|pro|site|online|store|shop|club|team|app))\b/gi;
  let bm;
  while ((bm = bareRx.exec(raw)) !== null && total() < cap) {
    const dom = bm[2].toLowerCase();
    if (/(^|\.)(t\.me|telegram\.me|vk\.com)$/i.test(dom)) continue;              // handled as tg/vk above
    if (websites.some(function (w) { return w.slice(8).split('/')[0] === dom; })) continue; // already captured as https
    add(websites, 'https://' + dom);
  }
  return { websites: websites, telegram_channels: telegram, vk_sources: vk, rejected: rejected };
}

// SOURCE-EXEC-001: an explicit "collect it again" request. Kept in sync with source_execution_policy.SX_REFRESH_RE
// (test asserts equality) — this lib must stay require-free to remain embeddable in a Code node.
// Cyrillic \b/\w never fire in JS, so the boundaries are explicit [а-яё] classes. Deliberately narrow: an
// accidental refresh spends the user's money on a repeat scrape.
const PLAN_REFRESH_RE = /(^|[^а-яёa-z])(обнови(ть|те)?|переобнови(ть|те)?|пересобери|пересобрать|пересоберите|заново|повтори(ть|те)? сбор|повторный сбор|принудительн(о|ый|ая)|ещё раз собери|еще раз собери|свеж(ие|их) данн(ые|ых)|актуализируй|перепроверь)([^а-яёa-z]|$)/i;
// "обнови отчёт" alone = rebuild the report from stored data; NOT a paid re-collection.
const PLAN_REPORT_ONLY_RE = /обнови(ть|те)?\s+отч[её]т/i;
function planWantsRefresh(text) {
  const t = str(text);
  if (!t) return false;
  if (PLAN_REPORT_ONLY_RE.test(t) && !/данн|сбор|источник|сайт/i.test(t)) return false;
  return PLAN_REFRESH_RE.test(t);
}

function deterministicPlan(text, cfg) {
  cfg = cfg || {};
  const t = str(text);
  let region = cfg.default_region || 'Москва/МО';
  for (const [rx, v] of REGION_HINTS) { if (rx.test(t)) { region = v; break; } }
  let niche = cfg.default_niche || 'credit_brokerage';
  for (const [rx, v] of NICHE_HINTS) { if (rx.test(t)) { niche = v; break; } }
  const sources = [];
  for (const [rx, v] of SOURCE_HINTS) { if (rx.test(t)) sources.push(v); }
  // a generic competitor scan collects from EVERY allowlisted source (Stage 5 multi-source); an explicit source
  // mention narrows it. Always intersected with the allowlist and capped by max_sources_per_request.
  const allow = (cfg.source_allowlist || ['website']).map(low);
  // URL-INTAKE-002: explicit pasted sources (websites/Telegram/VK) drive the plan to EXACTLY those platforms.
  const ex = extractExplicitSources(t);
  const explicitPlatforms = [];
  if (ex.websites.length) explicitPlatforms.push('website');
  if (ex.telegram_channels.length) explicitPlatforms.push('telegram');
  if (ex.vk_sources.length) explicitPlatforms.push('vk');
  let requested;
  if (explicitPlatforms.length) {
    requested = explicitPlatforms.filter(s => allow.indexOf(s) >= 0);   // only allowlisted supplied platforms
  } else {
    requested = sources.length ? sources : allow.slice();
    requested = requested.filter(s => allow.indexOf(s) >= 0);
  }
  if (!requested.length) requested = allow.slice(0, 1);
  requested = requested.slice(0, Math.max(1, num(cfg.max_sources_per_request, 3)));
  const maxItems = num(cfg.max_items_per_source, 25);
  const maxCalls = num(cfg.max_external_calls, 40);
  return normalizePlan({
    intent: 'competitor_market_scan',
    niche: niche,
    service: niche,
    region: region,
    sources: requested,
    // only carry supplied sources for allowlisted platforms — never plan/promise a platform we cannot run.
    urls: (allow.indexOf('website') >= 0) ? ex.websites : [],
    telegram_channels: (allow.indexOf('telegram') >= 0) ? ex.telegram_channels : [],
    vk_communities: (allow.indexOf('vk') >= 0) ? ex.vk_sources : [],
    explicit_sources: requested.length > 0 && explicitPlatforms.length > 0,
    max_items: maxItems,
    max_external_calls: Math.min(maxCalls, requested.length * Math.max(2, Math.ceil(maxItems / 5))),
    est_source_cost_usd: Number(cfg.source_budget_usd || 0.20),
    est_llm_cost_usd: Number(cfg.llm_budget_usd || 0.50),
    expected_output: 'competitor_market_report',
    // SOURCE-EXEC-001: an explicit refresh re-collects an already-registered source. It bypasses ONLY the freshness
    // check — approval, budget, quality and global dedup all still apply, and the approval text says so.
    // EXPLICIT-SOURCE-SCOPE-001: when the user names a source, the named source IS the scope — an inferred region
    // must not exclude it later (live: site said "Россия", plan defaulted "Москва/МО", WF10 dropped the row and the
    // user was told there were no facts about the site they named). Kept in sync with scope_policy.resolveScope
    // (test asserts equality); this lib stays require-free to remain embeddable in a Code node.
    scope_mode: (function () {
      var n = (ex.websites || []).length + (ex.telegram_channels || []).length + (ex.vk_sources || []).length;
      if (/discovery/.test(String(t).toLowerCase()) || explicitPlatforms.length === 0) return n >= 2 ? 'comparison' : (n === 1 ? 'explicit_source' : 'discovery');
      return n >= 2 ? 'comparison' : 'explicit_source';
    })(),
    source_execution_mode: planWantsRefresh(t) ? 'refresh' : 'auto',
    force_reprocess: planWantsRefresh(t),
    refresh_reason: planWantsRefresh(t) ? 'user_requested_refresh' : '',
    requires_approval: cfg.require_approval !== false,
    plan_source: 'deterministic'
  }, cfg);
}

// Coerce any plan object onto the strict schema with safe clamps; returns a normalized plan.
function normalizePlan(p, cfg) {
  p = p || {}; cfg = cfg || {};
  const allow = (cfg.source_allowlist || ['website']).map(low);
  let sources = (Array.isArray(p.sources) ? p.sources : str(p.sources).split(/[\s,;]+/)).map(low).filter(Boolean)
    .filter(s => allow.indexOf(s) >= 0);
  if (!sources.length) sources = allow.slice(0, 1);
  sources = sources.slice(0, Math.max(1, num(cfg.max_sources_per_request, 3)));
  return {
    intent: str(p.intent) || 'competitor_market_scan',
    niche: str(p.niche) || str(p.service) || (cfg.default_niche || 'credit_brokerage'),
    service: str(p.service) || str(p.niche) || (cfg.default_niche || 'credit_brokerage'),
    region: str(p.region) || (cfg.default_region || 'Москва/МО'),
    sources: sources,
    // URL-INTAKE-001/002: re-sanitize supplied sources through the same safe extractor (never trust a carried value).
    urls: extractSafeUrls(Array.isArray(p.urls) ? p.urls.join(' ') : str(p.urls)),
    telegram_channels: (function () { var r = extractExplicitSources((Array.isArray(p.telegram_channels) ? p.telegram_channels.join(' ') : str(p.telegram_channels)).replace(/@/g, ' t.me/')); return r.telegram_channels; })(),
    vk_communities: (function () { var r = extractExplicitSources(Array.isArray(p.vk_communities) ? p.vk_communities.join(' ') : str(p.vk_communities)); return r.vk_sources; })(),
    explicit_sources: p.explicit_sources === true,
    max_items: Math.min(num(p.max_items, num(cfg.max_items_per_source, 25)), num(cfg.max_items_per_source, 25)),
    max_external_calls: Math.min(num(p.max_external_calls, num(cfg.max_external_calls, 40)), num(cfg.max_external_calls, 40)),
    est_source_cost_usd: Math.min(num(p.est_source_cost_usd, num(cfg.source_budget_usd, 0.20)), num(cfg.source_budget_usd, 0.20)),
    est_llm_cost_usd: Math.min(num(p.est_llm_cost_usd, num(cfg.llm_budget_usd, 0.50)), num(cfg.llm_budget_usd, 0.50)),
    expected_output: str(p.expected_output) || 'competitor_market_report',
    scope_mode: ['explicit_source', 'comparison', 'discovery', 'monitoring'].indexOf(str(p.scope_mode)) >= 0 ? str(p.scope_mode) : 'discovery',
    source_execution_mode: ['refresh', 'reuse', 'collect'].indexOf(str(p.source_execution_mode)) >= 0 ? str(p.source_execution_mode) : 'auto',
    force_reprocess: p.force_reprocess === true || str(p.force_reprocess) === 'true',
    refresh_reason: str(p.refresh_reason),
    requires_approval: p.requires_approval === false ? false : (cfg.require_approval !== false),
    plan_source: str(p.plan_source) || 'deterministic'
  };
}

// Validate raw LLM planner JSON. Returns { valid, plan, reason }. Anything malformed => valid:false and
// the caller MUST fall back to the deterministic plan (no external work off an invalid plan).
function validatePlanJSON(rawText, cfg) {
  let obj;
  try { obj = typeof rawText === 'string' ? JSON.parse(rawText) : rawText; }
  catch (e) { return { valid: false, plan: null, reason: 'not_json' }; }
  if (!obj || typeof obj !== 'object') return { valid: false, plan: null, reason: 'not_object' };
  const sources = Array.isArray(obj.sources) ? obj.sources : null;
  if (!sources || !sources.length) return { valid: false, plan: null, reason: 'no_sources' };
  if (!(num(obj.max_items, 0) > 0)) return { valid: false, plan: null, reason: 'bad_max_items' };
  if (!str(obj.region)) return { valid: false, plan: null, reason: 'no_region' };
  const plan = normalizePlan(obj, cfg);
  plan.plan_source = 'llm';
  return { valid: true, plan: plan, reason: '' };
}

// Render the plan for the Telegram approval message (readable, bounded, no secrets).
function planToApprovalText(plan) {
  plan = plan || {};
  return [
    'План запроса (подтвердите перед запуском):',
    '• Интент: ' + str(plan.intent),
    '• Ниша/услуга: ' + str(plan.niche),
    '• Регион: ' + str(plan.region),
    '• Источники: ' + (plan.sources || []).join(', '),
    '• Лимит элементов/источник: ' + num(plan.max_items, 0),
    '• Лимит внешних вызовов: ' + num(plan.max_external_calls, 0),
    '• Бюджет источников: ~$' + num(plan.est_source_cost_usd, 0),
    '• Бюджет LLM: ~$' + num(plan.est_llm_cost_usd, 0),
    '• Результат: ' + str(plan.expected_output),
    '• План построен: ' + str(plan.plan_source)
  ].join('\n');
}

// --- durable plan identity + approval binding (WF19-PLAN-001 / WF18-APPROVAL-002) --------------------------
// A plan shown for approval MUST be persisted first, and approval MUST execute the exact reviewed plan. We
// derive a deterministic plan_hash over the immutable plan fields so a later/modified plan cannot be approved
// under an old callback. djb2 keeps it dependency-free (mirrors telegram_io.payloadHash; inlined to avoid a
// cross-lib require inside a single Code node).
function planHash(plan) {
  plan = plan || {};
  const canon = JSON.stringify([
    str(plan.intent), str(plan.niche), str(plan.service), str(plan.region),
    (Array.isArray(plan.sources) ? plan.sources : []).map(low).sort(),
    // URL-INTAKE-001/002: bind approval to the exact supplied source set — a change can't be approved under an old callback.
    (Array.isArray(plan.urls) ? plan.urls : []).map(low).sort(),
    (Array.isArray(plan.telegram_channels) ? plan.telegram_channels : []).map(low).sort(),
    (Array.isArray(plan.vk_communities) ? plan.vk_communities : []).map(low).sort(),
    num(plan.max_items, 0), num(plan.max_external_calls, 0),
    num(plan.est_source_cost_usd, 0), num(plan.est_llm_cost_usd, 0),
    str(plan.expected_output), str(plan.plan_source)
  ]);
  let h = 5381;
  for (let i = 0; i < canon.length; i++) h = ((h << 5) + h + canon.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}
function planIdentity(plan, agentRequestId, version) {
  const hash = planHash(plan);
  const v = num(version, 1) || 1;
  return { plan_id: ['plan', str(agentRequestId) || 'req', hash].join('_'), plan_hash: hash, plan_version: v };
}
// --- B4: owner-scoped plan fingerprint + reuse selector -----------------------------------------------------
// A LOGICAL request identity independent of agent_request_id, so two equivalent requests do not create two
// awaiting_approval plans. Covers owner+chat, intent, normalized (order-independent) sources, niche/service,
// region, window/scope and output. Derived on the fly from either an in-memory plan (arrays) OR a stored plan
// row (comma/space-joined strings) — no new sheet column is needed. Cost estimates are excluded (they are
// derived and may drift); the logical request is what matters.
function planNormList(v) {
  if (Array.isArray(v)) return v.map(low).filter(Boolean).sort();
  return low(v).split(/[,\s]+/).map(function (x) { return x.trim(); }).filter(Boolean).sort();
}
function planFingerprint(planOrRow, ctx) {
  planOrRow = planOrRow || {}; ctx = ctx || {};
  var owner = str(ctx.owner_user_id) || str(planOrRow.owner_user_id);
  var chat = str(ctx.chat_id) || str(planOrRow.chat_id);
  var canon = JSON.stringify([
    'fp1', owner, chat,
    low(planOrRow.intent), low(planOrRow.niche), low(planOrRow.service), low(planOrRow.region),
    planNormList(planOrRow.sources),
    planNormList(planOrRow.urls),
    planNormList(planOrRow.telegram_channels),
    planNormList(planOrRow.vk_communities),
    num(planOrRow.max_items, 0), low(planOrRow.expected_output),
    // SOURCE-EXEC-001: refresh semantics are part of the request's IDENTITY. "обнови carmoney.ru" asks for a paid
    // re-collection and must NOT silently reuse an awaiting-approval non-refresh plan for the same site (the user
    // would approve a refresh and get a dedup skip). Derived identically from a plan OR a stored row: the row
    // persists force_reprocess as the string 'true'.
    (planOrRow.force_reprocess === true || low(planOrRow.force_reprocess) === 'true') ? 'refresh' : 'auto'
    // NB: data_mode is intentionally excluded — it is not persisted on the execution_plans row, so including it
    // would make a stored row and its originating in-memory plan hash differently and break reuse detection.
  ]);
  var h = 5381;
  for (var i = 0; i < canon.length; i++) h = ((h << 5) + h + canon.charCodeAt(i)) >>> 0;
  return 'fp' + h.toString(16);
}
// Among existing execution_plans rows, find the newest NON-TERMINAL plan for THIS owner whose fingerprint equals
// the new plan's — the canonical plan to REUSE instead of creating a duplicate. Terminal plans never block. TTL:
// an awaiting_approval row older than ttlMin is abandoned and does not count (mirrors request_lifecycle).
var PLAN_TERMINAL = ['completed', 'done', 'delivered', 'failed', 'error', 'cancelled', 'canceled', 'rejected', 'expired', 'no_data', 'superseded'];
function planIsTerminal(s) { return PLAN_TERMINAL.indexOf(low(s)) >= 0; }
function findReusablePlan(existingRows, newPlan, ctx, opts) {
  ctx = ctx || {}; opts = opts || {};
  var fp = planFingerprint(newPlan, ctx);
  var owner = str(ctx.owner_user_id);
  var ttlMs = (num(opts.ttl_min, 30) || 30) * 60000;
  var nowMs = num(opts.now_ms, Date.now());
  var best = null, bestT = -1;
  (Array.isArray(existingRows) ? existingRows : []).forEach(function (r) {
    if (!r) return;
    if (str(r.owner_user_id) !== owner) return;
    if (planIsTerminal(r.status)) return;
    // STATUS-TTL-002 parity: ANY non-terminal plan older than the TTL is abandoned (a crashed/never-finalized run
    // or a stale approval prompt) and must NOT be reused — a real run finishes in minutes. Applies to
    // awaiting_approval AND in-flight (approved/collecting/…) alike.
    var t = Date.parse(str(r.created_at)); if (!isNaN(t) && (nowMs - t) > ttlMs) return;
    if (planFingerprint(r, { owner_user_id: str(r.owner_user_id), chat_id: str(r.chat_id) }) !== fp) return;
    var ct = Date.parse(str(r.created_at)); if (isNaN(ct)) ct = 0;
    if (ct >= bestT) { bestT = ct; best = r; }
  });
  return best ? { plan: best, fingerprint: fp, reused: true } : { plan: null, fingerprint: fp, reused: false };
}

// One flat durable row for the execution_plans tab (the canonical plan store). Status starts awaiting_approval.
function buildPlanRow(plan, identity, ctx) {
  plan = plan || {}; identity = identity || {}; ctx = ctx || {};
  return {
    plan_id: str(identity.plan_id), plan_version: num(identity.plan_version, 1), plan_hash: str(identity.plan_hash),
    agent_request_id: str(ctx.agent_request_id), owner_user_id: str(ctx.owner_user_id), chat_id: str(ctx.chat_id),
    intent: str(plan.intent), niche: str(plan.niche), service: str(plan.service), region: str(plan.region),
    sources: (Array.isArray(plan.sources) ? plan.sources : []).join(','),
    // URL-INTAKE-001/002: persist user-supplied sources so WF20 targets THEM (space/comma-joined; empty when none).
    urls: (Array.isArray(plan.urls) ? plan.urls : []).join(' '),
    telegram_channels: (Array.isArray(plan.telegram_channels) ? plan.telegram_channels : []).join(','),
    vk_communities: (Array.isArray(plan.vk_communities) ? plan.vk_communities : []).join(','),
    explicit_sources: plan.explicit_sources === true ? 'true' : '',
    max_items: num(plan.max_items, 0), max_external_calls: num(plan.max_external_calls, 0),
    est_source_cost_usd: num(plan.est_source_cost_usd, 0), est_llm_cost_usd: num(plan.est_llm_cost_usd, 0),
    expected_output: str(plan.expected_output), plan_source: str(plan.plan_source),
    // SOURCE-EXEC-001: the refresh decision MUST survive approval — WF20 reads it off the stored row.
    scope_mode: str(plan.scope_mode) || 'discovery',
    source_execution_mode: str(plan.source_execution_mode) || 'auto',
    force_reprocess: plan.force_reprocess === true ? 'true' : '',
    refresh_reason: str(plan.refresh_reason),
    status: 'awaiting_approval', created_at: str(ctx.ts), decided_at: '', decided_by: ''
  };
}
// Validate an approval callback against the stored plan (WF18-APPROVAL-002 / TELEGRAM-013). Fails CLOSED:
// wrong owner/chat, missing plan, hash mismatch, or a request not awaiting approval all reject. `claim` carries
// owner_user_id, chat_id, agent_request_id and (optionally) plan_hash from the callback context.
function validateApproval(planRow, claim) {
  planRow = planRow || null; claim = claim || {};
  const reasons = [];
  if (!planRow || !str(planRow.plan_id)) reasons.push('no_plan');
  else {
    if (str(planRow.owner_user_id) !== str(claim.owner_user_id)) reasons.push('owner_mismatch');
    if (claim.chat_id != null && str(planRow.chat_id) !== str(claim.chat_id)) reasons.push('chat_mismatch');
    if (str(planRow.agent_request_id) !== str(claim.agent_request_id)) reasons.push('request_mismatch');
    if (str(planRow.status) !== 'awaiting_approval') reasons.push('not_awaiting_approval:' + str(planRow.status));
    if (claim.plan_hash != null && str(planRow.plan_hash) !== str(claim.plan_hash)) reasons.push('plan_hash_mismatch');
  }
  return { ok: reasons.length === 0, reason: reasons.join('; '), plan_id: planRow ? str(planRow.plan_id) : '' };
}
// Resolve the single latest awaiting-approval plan for one owner (free-text approval needs exactly one).
function pendingPlansForOwner(planRows, ownerUserId) {
  return (planRows || []).filter(r => str(r.owner_user_id) === str(ownerUserId) && str(r.status) === 'awaiting_approval');
}

module.exports = {
  deterministicPlan, normalizePlan, validatePlanJSON, planToApprovalText,
  planHash, planIdentity, buildPlanRow, validateApproval, pendingPlansForOwner,
  blockedRequestedSources, extractSafeUrls, extractExplicitSources,
  planFingerprint, findReusablePlan, planIsTerminal
};
