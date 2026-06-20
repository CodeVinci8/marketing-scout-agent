// test_wf04_accounting.js — Stage C Closure Patch 3 (audit B2). Executes the REAL WF04 nodes
// (Set URL List -> Parse Primary JSON -> [Parse Repaired JSON] -> Normalize + Route -> snapshot ->
// Final Summary Output) through every outcome and asserts the ACTUALLY ACCUMULATED counters.
// No injected staticData; counters are produced by running the production node code. $0, no network.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('04_firecrawl_url_list_resilient.json');
const run = H.makeRun();
H.runCodeNode(run, wf, 'Set URL List', []); // resets staticData.wf04_run (per-run, no cross-run leakage)

const SRC = { source_url: 'https://x.ru/', run_id: 'firecrawl_demo', batch_index: 0, parsed_at: '2026-06-15T10:00:00+03:00' };
function claudeJson(obj) { return { content: [{ type: 'text', text: JSON.stringify(obj) }] }; }
function claudeGarbage(t) { return { content: [{ type: 'text', text: t }] }; }
const COMP = { entity_type: 'competitor', company_name: 'Тест', service_type: 'credit_broker', offer_text: 'Кредитный брокер', terms: 'оплата за результат', region: 'Москва', text_context: 'кредитный брокер помощь в получении кредита', lead_signal_score: 1, content_idea_score: 1, competitor_strength: 60, quality_score: 60, recommended_action: 'monitor', reason: 'ok' };
// rich-signal page so the deterministic fallback path (>=5 niche signals) triggers
const RICH = 'кредит займ под залог птс авто рефинанс ипотека ставка сумма одобрение москва руб 5%';

// One full URL pass through the real nodes. primaryText/repairText: null = no node run; object = Claude JSON; string = garbage.
function runUrl(srcCtx, primaryResp, repairResp) {
  H.inject(run, 'Normalize Firecrawl Output', [Object.assign({}, SRC, { text_context: srcCtx })]);
  const pp = H.runCodeNode(run, wf, 'Parse Primary JSON', [{ json: primaryResp }])[0].json;
  let rec = pp;
  if (!pp.parse_ok) {
    rec = H.runCodeNode(run, wf, 'Parse Repaired JSON', [{ json: repairResp }])[0].json;
  }
  const nr = H.runCodeNode(run, wf, 'Normalize + Route', [{ json: rec }])[0].json;
  // snapshot branch (returns [] for technical_errors / skipped)
  H.runCodeNode(run, wf, 'Build competitor_site_snapshots Row', [{ json: nr }]);
  return nr;
}

// 1) primary success
runUrl('кредитный брокер', claudeJson(COMP), null);
// 2) primary fail -> repair success
runUrl('кредитный брокер', claudeGarbage('totally not json'), claudeJson(COMP));
// 3) primary fail -> repair fail -> deterministic competitor fallback (rich signals => degraded snapshot)
runUrl(RICH, claudeGarbage('nope'), claudeGarbage('still nope'));
// 4) primary fail -> repair fail -> technical_error (sparse signals => no fallback, repair_failure)
runUrl('пустая страница без сигналов', claudeGarbage('nope'), claudeGarbage('still nope'));

const a = run.staticData.wf04_run;
A.section('WF04 — call counters from real node execution');
A.eq('primary_calls = 4', a.primary_calls, 4);
A.eq('primary_parse_success = 1', a.primary_parse_success, 1);
A.eq('primary_parse_failure = 3', a.primary_parse_failure, 3);
A.eq('repair_calls = 3', a.repair_calls, 3);
A.eq('firecrawl_calls = 4', a.firecrawl_calls, 4);
A.eq('claude_calls = primary+repair = 7', a.claude_calls, 7);

A.section('WF04 — outcome counters (mutually exclusive, no double count)');
A.eq('repair_success = 1', a.repair_success, 1);
A.eq('deterministic_fallback = 1', a.deterministic_fallback, 1);
A.eq('repair_failure = 1', a.repair_failure, 1);
A.ok('outcomes sum (success+failure+fallback) <= repair_calls', (a.repair_success + a.repair_failure + a.deterministic_fallback) <= a.repair_calls);
A.eq('a successful repair is distinct from fallback and failure', [a.repair_success, a.deterministic_fallback, a.repair_failure].join(','), '1,1,1');

A.section('WF04 — snapshot-level quality counters');
A.eq('snapshots_written = 3 (healthy, healthy, degraded; technical_error has none)', a.snapshots_written, 3);
A.eq('degraded = 1 (the deterministic fallback)', a.degraded, 1);
A.eq('quarantined = 0', a.quarantined, 0);

A.section('WF04 — Final Summary Output reflects the REAL accumulated counters');
H.inject(run, 'Set URL List', [{ run_id: 'firecrawl_demo' }, {}, {}, {}]);
// NOTE: re-injecting Set URL List output for the run_id ref must NOT reset counters — Final Summary reads staticData.
run.staticData.wf04_run = a; // (inject helper above only set node OUTPUT, not staticData; keep accumulated state)
const done = [{ note: 'processed_by_workflow_04' }, { note: 'processed_by_workflow_04' }, { note: 'processed_by_workflow_04' }];
const sum = H.runCodeNode(run, wf, 'Final Summary Output', done.map(j => ({ json: j })))[0].json;
A.eq('summary primary_parse_successes', sum.primary_parse_successes, 1);
A.eq('summary primary_parse_failures', sum.primary_parse_failures, 3);
A.eq('summary repair_successes', sum.repair_successes, 1);
A.eq('summary repair_failures', sum.repair_failures, 1);
A.eq('summary deterministic_fallback_count', sum.deterministic_fallback_count, 1);
A.eq('summary degraded_count', sum.degraded_count, 1);
A.eq('summary repair_rate_pct = 75', sum.repair_rate_pct, 75);
A.ok('high repair rate surfaced as degraded action', /HIGH repair rate/.test(sum.next_action));

A.section('WF04 — honest cost semantics (unknown != zero)');
A.eq('cost_status unknown', sum.cost_status, 'unknown');
A.eq('actual_source_cost_usd null', sum.actual_source_cost_usd, null);
A.eq('actual_llm_cost_usd null', sum.actual_llm_cost_usd, null);

A.section('WF04 — per-run reset prevents cross-run leakage');
const run2 = H.makeRun();
H.runCodeNode(run2, wf, 'Set URL List', []);
A.eq('fresh run zeroes primary_calls', run2.staticData.wf04_run.primary_calls, 0);
A.eq('fresh run zeroes repair_success', run2.staticData.wf04_run.repair_success, 0);
A.eq('fresh run zeroes deterministic_fallback', run2.staticData.wf04_run.deterministic_fallback, 0);

A.report('wf04-accounting');
