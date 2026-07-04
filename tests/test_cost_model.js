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
  A.eq('claude calls = per-record (max_items capped at 12) + summary + repair', c.claude_calls, 12);
  const noweb = CM.plannedProviderCalls({ sources: ['telegram'], max_items: 10 }, cfg);
  A.eq('telegram-only plan needs no Firecrawl', noweb.firecrawl_pages, 0);
  A.eq('telegram-only plan needs no Apify', noweb.apify_searches, 0);
  const nollm = CM.plannedProviderCalls(plan, Object.assign({}, cfg, { enable_claude: false }));
  A.eq('enable_claude=false => zero Claude calls projected', nollm.claude_calls, 0);
}

A.section('projection math + hard cap separation');
{
  const p = CM.projectRequestCost(plan, cfg);
  // 3*0.01 + 3*0.01 + 12*0.02 = 0.30
  A.eq('projected_cost_usd = planned calls x unit prices', p.projected_cost_usd, 0.3);
  A.eq('projection is reliable with positive prices + sources', p.reliable, true);
  A.eq('hard_cap_usd = source+llm budgets (technical, separate value)', p.hard_cap_usd, 8);
  A.ok('projection is far below the $8 cap for a normal request', p.projected_cost_usd < 1);
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
  A.ok('approval message shows the projection as an estimate', msg.text.indexOf('Ориентировочная стоимость: около $0.30') >= 0);
  A.ok('approval message NEVER contains $8.00', msg.text.indexOf('8.00') < 0);
  A.ok("approval message NEVER says 'потратит до'", msg.text.indexOf('потратит до') < 0);
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
