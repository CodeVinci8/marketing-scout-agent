'use strict';
// §7 real per-request cost — projection from planned calls, configurable unit prices, actuals, and the
// UX regression: the $8 hard cap must never be presented as the expected price of one request.
const A = require('./_assert.js');
const CM = require('../n8n/lib/cost_model.js');
const CFG = require('../n8n/lib/agent_config.js');
const R = require('../n8n/lib/plan_render_ru.js');
const fs = require('fs'); const path = require('path');
const WFD = path.join(__dirname, '..', 'n8n', 'workflows');

const cfg = {
  website_competitor_urls: ['https://www.lioncredit.ru/', 'https://finardi.ru/', 'https://mkbkfin.ru/'],
  avito_queries: ['кредитный брокер Москва', 'помощь в получении кредита Москва', 'кредит под ПТС Москва'],
  cost_firecrawl_page_usd: 0.01, cost_apify_search_usd: 0.01, cost_claude_call_usd: 0.02,
  source_budget_usd: 5, llm_budget_usd: 3, enable_claude: true
};
const plan = { sources: ['website', 'avito', 'telegram'], max_items: 10, max_external_calls: 6, est_source_cost_usd: 5, est_llm_cost_usd: 3 };

A.section('planned provider calls derive from the plan sources + configured targets');
{
  const c = CM.plannedProviderCalls(plan, cfg);
  A.eq('website => one Firecrawl page per configured site', c.firecrawl_pages, 3);
  A.eq('avito => one Apify run per configured query', c.apify_searches, 3);
  // B3: pre-Stage-F the enrichment flags are off, so Claude does NOT run and is NOT counted in the estimate.
  A.eq('pre-F (no enrichment flag) => zero Claude calls projected', c.claude_calls, 0);
  A.eq('pre-F => llm_enabled=false', c.llm_enabled, false);
  const withLlm = CM.plannedProviderCalls(plan, Object.assign({}, cfg, { enable_llm_analysis: true }));
  A.eq('Stage-F (enable_llm_analysis) => per-record (capped 12) + summary + repair', withLlm.claude_calls, 12);
  A.eq('Stage-F => llm_enabled=true', withLlm.llm_enabled, true);
  const noweb = CM.plannedProviderCalls({ sources: ['telegram'], max_items: 10 }, cfg);
  A.eq('telegram-only plan needs no Firecrawl', noweb.firecrawl_pages, 0);
  A.eq('telegram-only plan needs no Apify', noweb.apify_searches, 0);
  const nollm = CM.plannedProviderCalls(plan, Object.assign({}, cfg, { enable_claude: false, enable_llm_analysis: true }));
  A.eq('enable_claude=false master switch => zero Claude calls even if enrichment asked', nollm.claude_calls, 0);
  // B3: a single supplied website is ONE page, not the operator preset count of 3.
  const oneSite = CM.plannedProviderCalls({ sources: ['website'], urls: ['https://autolombardn1.ru'] }, cfg);
  A.eq('one supplied website => 1 Firecrawl page (not preset 3)', oneSite.firecrawl_pages, 1);
  // B3: discovery is modelled as Firecrawl SEARCH + bounded SCRAPE validation, with no source list.
  const disc = CM.plannedProviderCalls({ intent: 'competitor_discovery', discovery: true, validate_top_n: 3 }, Object.assign({}, cfg, { discovery_queries: ['a', 'b', 'c', 'd'] }));
  A.eq('discovery => Firecrawl search queries', disc.firecrawl_searches, 4);
  A.eq('discovery => bounded scrape validation', disc.firecrawl_scrapes, 3);
}

A.section('projection math + hard cap separation');
{
  const p = CM.projectRequestCost(plan, cfg);
  // pre-F: 3 Firecrawl*0.01 + 3 Apify*0.01 + 0 Claude = 0.06 (Claude excluded until Stage F)
  A.eq('projected_cost_usd = planned calls x unit prices (no Claude pre-F)', p.projected_cost_usd, 0.06);
  A.eq('projection is reliable with positive prices + sources', p.reliable, true);
  A.eq('pre-F projection reports llm_enabled=false', p.llm_enabled, false);
  A.eq('cost_low = projected', p.cost_low_usd, 0.06);
  A.eq('cost_high = projected + 50% reserve', p.cost_high_usd, 0.09);
  A.eq('hard_cap_usd = source+llm budgets (technical, separate value)', p.hard_cap_usd, 8);
  A.ok('projection is far below the $8 cap for a normal request', p.projected_cost_usd < 1);
  const pLlm = CM.projectRequestCost(plan, Object.assign({}, cfg, { enable_llm_analysis: true }));
  A.eq('Stage-F projection includes Claude (0.06 + 12*0.02 = 0.30)', pLlm.projected_cost_usd, 0.3);
  A.eq('Stage-F projection reports llm_enabled=true', pLlm.llm_enabled, true);
  const bad = CM.projectRequestCost(plan, Object.assign({}, cfg, { cost_firecrawl_page_usd: 0 }));
  A.eq('a missing/zero unit price for a planned provider => unreliable', bad.reliable, false);
  const nosrc = CM.projectRequestCost({ sources: [] }, cfg);
  A.eq('no sources => unreliable (no amount shown)', nosrc.reliable, false);
}

A.section('actuals + remaining budget');
{
  const a = CM.actualRequestCost({ firecrawl_pages: 3, apify_searches: 3, claude_calls: 11 }, cfg);
  A.eq('actual = observed calls x unit prices', a.actual_cost_usd, 0.28);
  A.eq('remaining = cap - actual', a.remaining_budget_usd, 7.72);
  const m = CM.actualRequestCost({ firecrawl_pages: 0, apify_searches: 0, claude_calls: 5, measured_llm_cost_usd: 0.04 }, cfg);
  A.eq('measured LLM cost wins over the per-call estimate', m.actual_cost_usd, 0.04);
}

A.section('agent_config exposes operator-controlled unit prices');
{
  const rc = CFG.resolveConfig({});
  A.eq('default Firecrawl page price', rc.cost_firecrawl_page_usd, 0.01);
  A.eq('default Apify search price', rc.cost_apify_search_usd, 0.01);
  A.eq('default Claude call price', rc.cost_claude_call_usd, 0.02);
  const ov = CFG.resolveConfig({ MS_COST_CLAUDE_CALL_USD: '0.005' });
  A.eq('MS_COST_CLAUDE_CALL_USD overrides', ov.cost_claude_call_usd, 0.005);
}

A.section('$8 regression — the cap is never shown as the expected request price');
{
  const proj = CM.projectRequestCost(plan, cfg);
  const msg = R.planApprovalMessageRu(plan, { projected_cost_usd: proj.projected_cost_usd, projected_reliable: proj.reliable });
  A.ok('approval message shows the projection as an estimate', msg.text.indexOf('Ориентировочная стоимость: около $0.06') >= 0);
  A.ok('approval message NEVER contains $8.00', msg.text.indexOf('8.00') < 0);
  A.ok("approval message NEVER says 'потратит до'", msg.text.indexOf('потратит до') < 0);
}

A.section('B3 — cost breakdown band names AI as OFF pre-F, never quotes a Claude cost that will not run');
{
  const proj = CM.projectRequestCost(plan, cfg);
  const msg = R.planApprovalMessageRu(plan, { cost: proj });
  A.ok('shows a low–high band', /Оценка стоимости: \$0\.06–0\.09/.test(msg.text), msg.text);
  A.ok('names AI enrichment as off until Stage F', msg.text.indexOf('AI-анализ: пока выключен') >= 0, msg.text);
  A.ok('shows the run hard cap line', msg.text.indexOf('максимальный лимит запуска: $8') >= 0, msg.text);
  A.ok('breakdown never quotes a Claude $ amount pre-F', msg.text.indexOf('AI-анализ: ~$') < 0, msg.text);
  const projLlm = CM.projectRequestCost(plan, Object.assign({}, cfg, { enable_llm_analysis: true }));
  const msgLlm = R.planApprovalMessageRu(plan, { cost: projLlm });
  A.ok('Stage-F band quotes the AI cost', msgLlm.text.indexOf('AI-анализ: ~$0.24') >= 0, msgLlm.text);
}

A.section('B2 — plan wording matches request shape (no false "сравнение"/"до N с каждого" for one source)');
{
  const oneSite = { intent: 'competitor_search', region: 'Москва/МО', sources: ['website'], urls: ['https://autolombardn1.ru'], explicit_sources: true, max_items: 10, max_external_calls: 1 };
  const m1 = R.planApprovalMessageRu(oneSite, {});
  A.ok('single site: "Проверю сайт autolombardn1.ru"', m1.text.indexOf('Проверю сайт autolombardn1.ru') >= 0, m1.text);
  A.ok('single site: no "до N результатов с каждого источника"', m1.text.indexOf('результатов с каждого источника') < 0, m1.text);
  A.ok('single site: no "сравнение" claim', m1.text.indexOf('сравнение') < 0, m1.text);
  A.ok('single site: names offers/CTA/strengths scope', m1.text.indexOf('офферы и цены') >= 0 && m1.text.indexOf('сильные и слабые стороны') >= 0, m1.text);

  const oneTg = { intent: 'competitor_search', region: 'Москва/МО', sources: ['telegram'], telegram_channels: ['@da_credit'], explicit_sources: true, max_items: 20, max_external_calls: 1 };
  const m2 = R.planApprovalMessageRu(oneTg, {});
  A.ok('single TG: "публичный Telegram-канал @da_credit ... до 20 ... публикаций"', /Telegram-канал @da_credit.*до 20.*публикаци/.test(m2.text), m2.text);
  A.ok('single TG: no "сравнение"', m2.text.indexOf('сравнение') < 0, m2.text);

  const multi = { intent: 'competitor_search', region: 'Москва/МО', sources: ['website'], urls: ['https://a.ru', 'https://b.ru', 'https://c.ru'], explicit_sources: true, max_items: 10, max_external_calls: 3 };
  const m3 = R.planApprovalMessageRu(multi, {});
  A.ok('multi source: claims "Сравню 3 ... источника"', /Сравню 3 указанны. источника/.test(m3.text), m3.text);
  A.ok('multi source: comparison is offered', m3.text.indexOf('сравнение и основные выводы') >= 0, m3.text);
}

A.section('workflow wiring — WF19 projects, WF18 fallback projects, WF20 persists actuals');
{
  const wf19 = JSON.parse(fs.readFileSync(path.join(WFD, '19_request_planner.json'), 'utf8'));
  const ap = wf19.nodes.find(n => n.name === 'Build Approval Message');
  A.ok('WF19 approval node embeds cost_model (projectRequestCost)', ap.parameters.jsCode.indexOf('projectRequestCost') >= 0);
  A.ok('WF19 passes projected_cost_usd into the renderer', ap.parameters.jsCode.indexOf('projected_cost_usd:proj.projected_cost_usd') >= 0);
  const wf18 = JSON.parse(fs.readFileSync(path.join(WFD, '18_telegram_agent_gateway.json'), 'utf8'));
  const hp = wf18.nodes.find(n => n.name === 'Handle Plan Result');
  A.ok('WF18 fallback renderer also projects (no capped fallback text)', hp.parameters.jsCode.indexOf('projectRequestCost') >= 0);
  const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
  const es = wf20.nodes.find(n => n.name === 'Build Execution Summary');
  A.ok('WF20 computes actualRequestCost', es.parameters.jsCode.indexOf('actualRequestCost') >= 0);
  for (const col of ['projected_cost_usd', 'hard_cap_usd', 'actual_cost_usd', 'remaining_budget_usd']) {
    A.ok('WF20 summary carries ' + col, es.parameters.jsCode.indexOf(col) >= 0);
  }
  const contracts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sheets_contracts.json'), 'utf8'));
  for (const col of ['projected_cost_usd', 'hard_cap_usd', 'actual_cost_usd', 'remaining_budget_usd']) {
    A.ok('execution_summaries headers declare ' + col, contracts.headers.execution_summaries.indexOf(col) >= 0);
  }
}

A.report('cost-model');
