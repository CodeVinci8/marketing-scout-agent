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
  [/vk|вконтакте|соцсет/i, 'vk']
];

function deterministicPlan(text, cfg) {
  cfg = cfg || {};
  const t = str(text);
  let region = cfg.default_region || 'Москва/МО';
  for (const [rx, v] of REGION_HINTS) { if (rx.test(t)) { region = v; break; } }
  let niche = cfg.default_niche || 'credit_brokerage';
  for (const [rx, v] of NICHE_HINTS) { if (rx.test(t)) { niche = v; break; } }
  const sources = [];
  for (const [rx, v] of SOURCE_HINTS) { if (rx.test(t)) sources.push(v); }
  // default to the first-class website path when nothing specific is asked, intersect with allowlist
  let requested = sources.length ? sources : ['website'];
  const allow = (cfg.source_allowlist || ['website']).map(low);
  requested = requested.filter(s => allow.indexOf(s) >= 0);
  if (!requested.length) requested = allow.slice(0, 1);
  const maxItems = num(cfg.max_items_per_source, 25);
  const maxCalls = num(cfg.max_external_calls, 40);
  return normalizePlan({
    intent: 'competitor_market_scan',
    niche: niche,
    service: niche,
    region: region,
    sources: requested,
    max_items: maxItems,
    max_external_calls: Math.min(maxCalls, requested.length * Math.max(2, Math.ceil(maxItems / 5))),
    est_source_cost_usd: Number(cfg.source_budget_usd || 0.20),
    est_llm_cost_usd: Number(cfg.llm_budget_usd || 0.50),
    expected_output: 'competitor_market_report',
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
  return {
    intent: str(p.intent) || 'competitor_market_scan',
    niche: str(p.niche) || str(p.service) || (cfg.default_niche || 'credit_brokerage'),
    service: str(p.service) || str(p.niche) || (cfg.default_niche || 'credit_brokerage'),
    region: str(p.region) || (cfg.default_region || 'Москва/МО'),
    sources: sources,
    max_items: Math.min(num(p.max_items, num(cfg.max_items_per_source, 25)), num(cfg.max_items_per_source, 25)),
    max_external_calls: Math.min(num(p.max_external_calls, num(cfg.max_external_calls, 40)), num(cfg.max_external_calls, 40)),
    est_source_cost_usd: Math.min(num(p.est_source_cost_usd, num(cfg.source_budget_usd, 0.20)), num(cfg.source_budget_usd, 0.20)),
    est_llm_cost_usd: Math.min(num(p.est_llm_cost_usd, num(cfg.llm_budget_usd, 0.50)), num(cfg.llm_budget_usd, 0.50)),
    expected_output: str(p.expected_output) || 'competitor_market_report',
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
// One flat durable row for the execution_plans tab (the canonical plan store). Status starts awaiting_approval.
function buildPlanRow(plan, identity, ctx) {
  plan = plan || {}; identity = identity || {}; ctx = ctx || {};
  return {
    plan_id: str(identity.plan_id), plan_version: num(identity.plan_version, 1), plan_hash: str(identity.plan_hash),
    agent_request_id: str(ctx.agent_request_id), owner_user_id: str(ctx.owner_user_id), chat_id: str(ctx.chat_id),
    intent: str(plan.intent), niche: str(plan.niche), service: str(plan.service), region: str(plan.region),
    sources: (Array.isArray(plan.sources) ? plan.sources : []).join(','),
    max_items: num(plan.max_items, 0), max_external_calls: num(plan.max_external_calls, 0),
    est_source_cost_usd: num(plan.est_source_cost_usd, 0), est_llm_cost_usd: num(plan.est_llm_cost_usd, 0),
    expected_output: str(plan.expected_output), plan_source: str(plan.plan_source),
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
  planHash, planIdentity, buildPlanRow, validateApproval, pendingPlansForOwner
};
