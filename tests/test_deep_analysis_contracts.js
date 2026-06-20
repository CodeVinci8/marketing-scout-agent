// test_deep_analysis_contracts.js — unit contracts for deep_analysis + orchestration_policy. Offline, $0.
'use strict';
const A = require('./_assert');
const deep = require('../n8n/lib/deep_analysis');
const pol = require('../n8n/lib/orchestration_policy');

const COMPS = [{ company_name: 'CASHMOTOR', root_url: 'https://cashmotor.ru/' }, { company_name: 'CarCapital', root_url: 'https://carcapital.ru/' }];
const CFG_WEB = { source_allowlist: ['website'], require_approval: true, max_external_calls: 40, source_budget_usd: 0.20, llm_budget_usd: 0.50, deep_page_limit: 6, max_competitors_deep: 3 };
const CFG_FULL = Object.assign({}, CFG_WEB, { source_allowlist: ['website', 'telegram_channel', 'vk_community'] });
const TRACKED = [
  { platform: 'telegram_channel', ref: '@cashmotor', status: 'active' },
  { platform: 'vk_community', ref: 'vk.com/cashmotor', status: 'active' }
];

// ============================================================================================================
A.section('deep_analysis — graceful plan degradation + honest source availability');
const pWeb = deep.buildDeepPlan({ competitors: COMPS, requested_platforms: ['website'], cfg: CFG_WEB });
A.eq('website-only plan tier', pWeb.scope_tier, 'website_only');
A.eq('website-only selects website', pWeb.selected_platforms.join(','), 'website');
A.eq('deep plan requires approval', pWeb.requires_approval, true);

const pHist = deep.buildDeepPlan({ competitors: COMPS, requested_platforms: ['website'], cfg: CFG_WEB, history_available: true });
A.eq('website + history tier', pHist.scope_tier, 'website_history');

const pTgUnavail = deep.buildDeepPlan({ competitors: COMPS, requested_platforms: ['website', 'telegram_channel'], cfg: CFG_WEB });
A.ok('telegram unavailable reported honestly', pTgUnavail.unavailable_sources.some(u => u.platform === 'telegram_channel'));
A.eq('telegram not silently selected', pTgUnavail.selected_platforms.indexOf('telegram_channel'), -1);
A.ok('telegram unavailable reason names allowlist/adapter', /allowlist|adapter/.test(pTgUnavail.unavailable_sources.find(u => u.platform === 'telegram_channel').reason));

const pVkUnavail = deep.buildDeepPlan({ competitors: COMPS, requested_platforms: ['website', 'vk_community'], cfg: CFG_WEB });
A.ok('vk unavailable reported honestly', pVkUnavail.unavailable_sources.some(u => u.platform === 'vk_community'));

const pFull = deep.buildDeepPlan({ competitors: COMPS, requested_platforms: ['website', 'telegram_channel', 'vk_community'], cfg: CFG_FULL, tracked_sources: TRACKED });
A.eq('configured tg+vk with tracked sources => full tier', pFull.scope_tier, 'full');
A.ok('monitored telegram source included', pFull.monitored_telegram.indexOf('@cashmotor') >= 0);
A.ok('monitored vk source included', pFull.monitored_vk.indexOf('vk.com/cashmotor') >= 0);
// tg/vk allowlisted but NO tracked source => still unavailable (honest)
const pNoTracked = deep.buildDeepPlan({ competitors: COMPS, requested_platforms: ['website', 'telegram_channel'], cfg: CFG_FULL, tracked_sources: [] });
A.ok('allowlisted tg with no tracked source => unavailable', pNoTracked.unavailable_sources.some(u => u.platform === 'telegram_channel'));

A.section('deep_analysis — page/call/budget limits enforced');
const pClamp = deep.buildDeepPlan({ competitors: COMPS, requested_platforms: ['website'], cfg: CFG_WEB, page_limit: 999, est_source_cost: 99, est_llm_cost: 99 });
A.eq('page limit clamped to config', pClamp.page_limit_per_competitor, 6);
A.ok('external calls clamped to config max', pClamp.est_external_calls <= CFG_WEB.max_external_calls);
A.ok('source budget clamped', pClamp.est_source_budget_usd <= CFG_WEB.source_budget_usd);
A.ok('llm budget clamped', pClamp.est_llm_budget_usd <= CFG_WEB.llm_budget_usd);
const pCompCap = deep.buildDeepPlan({ competitors: [COMPS[0], COMPS[1], { company_name: 'C3' }, { company_name: 'C4' }], requested_platforms: ['website'], cfg: CFG_WEB });
A.ok('competitors capped at max_competitors_deep', pCompCap.selected_competitors.length <= 3);

A.section('deep_analysis — facts retain evidence; recommendations cannot become facts');
const goodEv = { source_url: 'https://cashmotor.ru/tariffs', source_record_id: 'firecrawl_x::rec1', source_run_id: 'firecrawl_x', excerpt: 'ставка от 0,1% в день', collected_at: '2026-06-21', quality_status: 'healthy', confidence: 0.9 };
const f1 = deep.deepFinding('prices', 'от 0,1%/день', goodEv);
A.eq('valid finding is a fact', f1.type, 'fact');
A.eq('valid finding passes validation', deep.validateFinding(f1).valid, true);
A.ok('finding retains source url', !!f1.evidence.source_url);
A.ok('finding retains source run id', !!f1.evidence.source_run_id);
const fNoEv = deep.deepFinding('offer', 'great offer', { excerpt: 'x' }); // no source anchor / run id
A.eq('finding without evidence anchor is invalid', deep.validateFinding(fNoEv).valid, false);
const rec1 = deep.deepRecommendation('снизить ставку до 0,09%/день', [f1.finding_id], 0.6);
A.eq('recommendation is typed as recommendation', rec1.type, 'recommendation');
const recOrphan = deep.deepRecommendation('сделать редизайн', [], 0.5);
const report = deep.assembleDeepReport('CASHMOTOR', [f1, fNoEv], [rec1, recOrphan]);
A.eq('report keeps only evidence-backed facts', report.fact_count, 1);
A.eq('invalid finding excluded from facts', report.invalid_findings.length, 1);
A.eq('recommendation referencing a fact is kept', report.recommendation_count, 1);
A.eq('recommendation without a supporting fact is orphaned (not a fact)', report.orphan_recommendations.length, 1);
A.ok('kept recommendation references a real finding', report.recommendations[0].derived_from.indexOf(f1.finding_id) >= 0);
A.ok('no recommendation is ever typed as fact', report.recommendations.every(r => r.type === 'recommendation'));

A.section('orchestration_policy — reuse vs collect vs extend');
const ctxFresh = { last_report: { competitors: COMPS }, last_report_id: 'rep_1', last_collected_at: '2026-06-20', collected_platforms: ['website'] };
const ctxStale = { last_report_id: 'rep_1', last_collected_at: '2026-01-01', collected_platforms: ['website'] };
const now = '2026-06-21';
A.eq('generate_ideas with report => reuse, no call', pol.reuseDecision({ intent: { intent: 'generate_ideas' }, ctx: ctxFresh, cfg: CFG_WEB, now }).needs_external_call, false);
A.eq('report_followup with report => reuse', pol.reuseDecision({ intent: { intent: 'report_followup' }, ctx: ctxFresh, cfg: CFG_WEB, now }).action, 'reuse');
A.eq('compare_periods => reuse stored', pol.reuseDecision({ intent: { intent: 'compare_periods' }, ctx: ctxFresh, cfg: CFG_WEB, now }).needs_external_call, false);
A.eq('ideas with NO report => collect', pol.reuseDecision({ intent: { intent: 'generate_ideas' }, ctx: {}, cfg: CFG_WEB, now }).action, 'collect');
A.eq('deep on fresh same-platform evidence => reuse', pol.reuseDecision({ intent: { intent: 'deep_competitor_analysis', entities: { platforms: ['website'] } }, ctx: ctxFresh, cfg: CFG_WEB, now }).action, 'reuse');
A.eq('deep requesting NEW platform => extend (configured only)', pol.reuseDecision({ intent: { intent: 'deep_competitor_analysis', entities: { platforms: ['telegram_channel'] } }, ctx: ctxFresh, cfg: CFG_FULL, now }).action, 'extend');
A.eq('deep on stale evidence => collect', pol.reuseDecision({ intent: { intent: 'deep_competitor_analysis', entities: { platforms: ['website'] } }, ctx: ctxStale, cfg: CFG_WEB, now }).action, 'collect');
A.eq('explicit refresh => collect (new source run)', pol.reuseDecision({ intent: { intent: 'deep_competitor_analysis', entities: { refresh: true, platforms: ['website'] } }, ctx: ctxFresh, cfg: CFG_WEB, now }).action, 'collect');
A.eq('rerun_request => collect', pol.reuseDecision({ intent: { intent: 'rerun_request' }, ctx: ctxFresh, cfg: CFG_WEB, now }).action, 'collect');
A.eq('add_source => no external collection', pol.reuseDecision({ intent: { intent: 'add_source' }, ctx: ctxFresh, cfg: CFG_WEB, now }).needs_external_call, false);
A.eq('new competitor_search => collect', pol.reuseDecision({ intent: { intent: 'competitor_search' }, ctx: {}, cfg: CFG_WEB, now }).action, 'collect');
A.ok('extend only targets the new platform', pol.reuseDecision({ intent: { intent: 'deep_competitor_analysis', entities: { platforms: ['telegram_channel'] } }, ctx: ctxFresh, cfg: CFG_FULL, now }).target_sources.join(',') === 'telegram_channel');
const drec = pol.decisionRecord(pol.reuseDecision({ intent: { intent: 'generate_ideas' }, ctx: ctxFresh, cfg: CFG_WEB, now }), { agent_request_id: 'req_1', conversation_id: 'conv_1', intent: 'generate_ideas', ts: 't' });
A.eq('decision record persists reason', drec.reason, 'answerable_from_last_report');
A.eq('decision record persists no-call flag', drec.needs_external_call, false);

A.report('deep-analysis-contracts');
