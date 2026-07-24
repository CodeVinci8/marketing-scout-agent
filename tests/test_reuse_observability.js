'use strict';
// REUSE-OBS-001 + COST-SPLIT-001 — a reused analysis names its origin, every WF28 invocation records an explicit
// cache decision, the cache key honestly includes the model, and the actual cost is split into canonical
// components (collection / summary AI / deep analysis AI / repair / total) all the way to the user-visible line
// and the hidden XLSX audit sheet. Offline, $0, no external calls.
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const LT = require('../n8n/lib/llm_telemetry.js');
const AB = require('../n8n/lib/analysis_bridge.js');
const CM = require('../n8n/lib/cost_model.js');
const CR = require('../n8n/lib/conversation_response.js');
const RP = require('../n8n/lib/report_package.js');
const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
const wf28 = JSON.parse(fs.readFileSync(path.join(WFD, '28_claude_analyst.json'), 'utf8'));
const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
const node = (wf, n) => wf.nodes.find(x => x.name === n);

const NOW = new Date().toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
// A persisted llm_analysis_results row as production writes it (exec 962 shape).
function row(over) {
  return Object.assign({
    analysis_id: 'an_f91a9fd1', owner_user_id: 'u1', agent_request_id: 'req_old', source_run_id: 'sr_old',
    analysis_type: 'single_source', evidence_package_hash: '753b287e', schema_version: 'stageF.analysis.v1',
    prompt_version: 'stageF.prompt.v1', model: 'claude-sonnet-4-6',
    structured_result_json: JSON.stringify({ overall_confidence: 0.8, inferences: [{ text: 'x' }] }),
    quality_status: 'ok', created_at: ago(3)
  }, over || {});
}
const ctx = { owner_user_id: 'u1', agent_request_id: 'req_new', source_run_id: 'sr_new',
  analysis_type: 'single_source', evidence_package_hash: '753b287e',
  schema_version: 'stageF.analysis.v1', prompt_version: 'stageF.prompt.v1', model: 'claude-sonnet-4-6' };

A.section('REUSE-OBS-001 — the cache hit names its origin');
{
  const hit = LT.findReusableAnalysis([row()], ctx);
  A.ok('same evidence + same contract => hit', !!hit);
  A.eq('hit names the ORIGIN analysis id', hit.reused_from_analysis_id, 'an_f91a9fd1');
  A.eq('hit carries the origin created_at', hit.reused_created_at, ago(3).slice(0, 13) === hit.reused_created_at.slice(0, 13) ? hit.reused_created_at : '(mismatch)');
  A.eq('hit carries the origin model', hit.reused_model, 'claude-sonnet-4-6');
  A.ok('hit records an explicit reason naming the matched keys',
    /owner\+analysis_type\+evidence_hash\+schema\+prompt\+model/.test(hit.cache_reason) && hit.cache_reason.indexOf('an_f91a9fd1') >= 0);
  A.ok('current lineage stays separate: analysis_id is derived from the CURRENT ctx, not the origin row',
    hit.analysis_id !== 'an_f91a9fd1' && hit.analysis_id === LT.ltAnalysisId(ctx));
}

A.section('REUSE-OBS-001 — cache-key audit: model is part of the key (both-present rule)');
{
  A.eq('a row produced by a DIFFERENT model is not reused',
    LT.findReusableAnalysis([row({ model: 'claude-opus-4-8' })], ctx), null);
  A.ok('a legacy row WITHOUT a model column stays reusable (both-present rule)',
    !!LT.findReusableAnalysis([row({ model: '' })], ctx));
  A.ok('a ctx without a model does not exclude anything',
    !!LT.findReusableAnalysis([row()], Object.assign({}, ctx, { model: '' })));
  // The existing invalidation keys still hold with the model key added.
  A.eq('schema version move still invalidates', LT.findReusableAnalysis([row({ schema_version: 'stageF.analysis.v0' })], ctx), null);
  A.eq('prompt version move still invalidates', LT.findReusableAnalysis([row({ prompt_version: 'stageF.prompt.v0' })], ctx), null);
  A.eq('owner mismatch still isolates', LT.findReusableAnalysis([row({ owner_user_id: 'u2' })], ctx), null);
}

A.section('REUSE-OBS-001 — WF28 forwards origin + cache decision in the typed return');
{
  const prep = node(wf28, 'Prepare Analysis').parameters.jsCode;
  const fin = node(wf28, 'Finalize Analysis').parameters.jsCode;
  A.ok('Prepare keeps the reuse origin ref', /base\.reuse_ref=\{reused_from_analysis_id/.test(prep));
  A.ok('Prepare records a cache decision on HIT', /decision:'reuse',reason:String\(reuse\.cache_reason/.test(prep));
  A.ok('Prepare records a cache decision on MISS (fresh call)', /decision:'fresh_call'/.test(prep));
  A.ok('Prepare records a cache decision when analysis is disabled', /decision:'skip_disabled'/.test(prep));
  A.ok('Prepare records a cache decision when there is no evidence', /decision:'skip_no_evidence'/.test(prep));
  A.ok('Finalize forwards reused_from_analysis_id into the typed return', /reused_from_analysis_id:\(reusedRef/.test(fin));
  A.ok('Finalize forwards the cache decision + reason', /cache_decision:String\(cacheDec\.decision/.test(fin) && /cache_reason:String\(cacheDec\.reason/.test(fin));
  A.ok('Finalize forwards the repair cost as its own component', /repair_cost_usd:repairCost/.test(fin));
  A.ok('repair cost is captured from the SECOND (repair) call only', /repairCost=sumCosts\(\[cs\[1\]\]\)/.test(fin));
  A.ok('typed return names the model that would be used', /model:String\(ctx\.model/.test(fin));
}

A.section('REUSE-OBS-001 — collectAnalyses aggregates the audit trail');
{
  const rets = [
    { analysis_id: 'an_cur', enriched: true, analysis: { overall_confidence: 0.8 }, mode: 'reuse', cost_usd: 0,
      repair_cost_usd: 0, model: 'claude-sonnet-4-6', reused_from_analysis_id: 'an_f91a9fd1',
      reused_from_created_at: ago(3), cache_decision: 'reuse', cache_reason: 'match: … → an_f91a9fd1' },
    { analysis_id: 'an_fresh', enriched: true, analysis: { overall_confidence: 0.7 }, mode: 'call', cost_usd: 0.02,
      repair_cost_usd: 0.006, repair_used: true, model: 'claude-sonnet-4-6',
      cache_decision: 'fresh_call', cache_reason: 'miss: no persisted analysis matched …' }
  ];
  const col = AB.collectAnalyses(rets);
  A.eq('reuse lineage has exactly the reused row', col.reuse_lineage.length, 1);
  A.eq('lineage names origin', col.reuse_lineage[0].reused_from_analysis_id, 'an_f91a9fd1');
  A.eq('lineage keeps CURRENT analysis id separate', col.reuse_lineage[0].analysis_id, 'an_cur');
  A.eq('every invocation contributed a cache decision', col.cache_decisions.length, 2);
  A.eq('repair cost aggregated as its own component', col.analysis_repair_cost_usd, 0.006);
  A.eq('model surfaced for the audit sheet', col.model, 'claude-sonnet-4-6');
  A.eq('total analysis cost unchanged by the split', col.analysis_cost_usd, 0.02);
  // WIP3-A: a primary provider call is counted ONLY for mode==='call' (reuse=0 calls); repair from telemetry.
  A.eq('llm_primary_calls counts only the real call (reuse excluded)', col.llm_primary_calls, 1);
  A.eq('llm_repair_calls from real telemetry', col.llm_repair_calls, 1);
}

A.section('WIP3-A — deterministic fallback WITHOUT a provider call is not a primary call');
{
  // mode 'disabled' / 'no_evidence' → deterministic fallback, ZERO provider calls; only 'call' counts.
  const rets = [
    { analysis_id: 'a1', mode: 'call', enriched: true, analysis: { overall_confidence: 0.7 }, cost_usd: 0.02 },
    { analysis_id: 'a2', mode: 'call', fallback_used: true, repair_used: true, analysis: { _fallback: true }, cost_usd: 0.01 }, // called, failed → still 1 primary + 1 repair
    { analysis_id: 'a3', mode: 'disabled', fallback_used: true, analysis: { _fallback: true }, cost_usd: 0 },   // NO call
    { analysis_id: 'a4', mode: 'no_evidence', fallback_used: true, analysis: { _fallback: true }, cost_usd: 0 }, // NO call
    { analysis_id: 'a5', mode: 'reuse', enriched: true, analysis: { overall_confidence: 0.6 }, cost_usd: 0 }     // cache hit, NO call
  ];
  const col = AB.collectAnalyses(rets);
  A.eq('only the two mode=call rows are primary calls', col.llm_primary_calls, 2);
  A.eq('disabled/no_evidence/reuse are NOT counted as calls', col.count_total - col.count_reused, 4); // sanity: old naive metric would have been 4
  A.eq('repair from telemetry (one repaired call)', col.llm_repair_calls, 1);
}

A.section('COST-SPLIT-001 — actualRequestCost splits without double counting');
{
  const act = CM.actualRequestCost({ firecrawl_pages: 2, measured_llm_cost_usd: 0.03,
    claude_analysis_cost_usd: 0.0132, claude_repair_cost_usd: 0.006 }, { cost_firecrawl_page_usd: 0.01, source_budget_usd: 1, llm_budget_usd: 1 });
  A.eq('collection component', act.actual_collection_usd, 0.02);
  A.eq('summary AI component', act.actual_summary_ai_usd, 0.03);
  A.eq('deep analysis component EXCLUDES the repair share', act.actual_deep_analysis_usd, 0.0072);
  A.eq('repair component', act.actual_repair_usd, 0.006);
  A.ok('components sum to the total (no double count)',
    Math.abs((act.actual_collection_usd + act.actual_summary_ai_usd + act.actual_deep_analysis_usd + act.actual_repair_usd) - act.actual_cost_usd) < 1e-9);
  A.eq('actual_ai_usd unchanged (summary + full analysis)', act.actual_ai_usd, 0.0432);
  // Repair can never exceed what the analysis actually cost (defensive clamp).
  const clamped = CM.actualRequestCost({ claude_analysis_cost_usd: 0.004, claude_repair_cost_usd: 0.01 }, {});
  A.eq('repair clamped to the analysis actual', clamped.actual_repair_usd, 0.004);
  A.eq('deep analysis never negative', clamped.actual_deep_analysis_usd, 0);
}

A.section('COST-SPLIT-001 — the user-visible cost line is honest per component');
{
  // The live analysis-reuse run (req_1784277311282): collection $0, deep analysis $0 (cache), WF12 summary $0.03.
  const line = CR.costLine({ actual_cost_usd: 0.03, actual_collection_usd: 0, actual_summary_ai_usd: 0.03,
    actual_deep_analysis_usd: 0, actual_repair_usd: 0 });
  A.ok('a run with a real summary-AI cost is NEVER rendered as $0', line.indexOf('$0.03') >= 0 && !/\$0\.\s*$/.test(line));
  A.ok('the paid component is named', line.indexOf('AI-сводка') >= 0);
  A.ok('zero components are not listed', line.indexOf('AI-анализ') < 0 && line.indexOf('сбор данных') < 0);
  const full = CR.costLine({ actual_cost_usd: 0.0632, actual_collection_usd: 0.02, actual_summary_ai_usd: 0.03,
    actual_deep_analysis_usd: 0.0072, actual_repair_usd: 0.006 });
  ['сбор данных', 'AI-сводка', 'AI-анализ', 'восстановление ответа'].forEach(p =>
    A.ok('full split names: ' + p, full.indexOf(p) >= 0));
  A.ok('full split shows the total', full.indexOf('= $0.0632') >= 0);
  A.eq('an unknown total renders NOTHING (no fabricated $0)', CR.costLine({}), '');
  A.eq('a genuinely free run says $0 plainly', CR.costLine({ actual_cost_usd: 0 }), '💰 Фактическая стоимость: $0.');
  // deliveryBody carries the line.
  const body = CR.deliveryBody({ report_markdown: '# Отчёт\nфакты' },
    { final_state: 'completed', records_reported: 3, actual_cost_usd: 0.03, actual_summary_ai_usd: 0.03 }, []);
  A.ok('deliveryBody includes the cost line', body.indexOf('💰 Фактическая стоимость:') >= 0);
}

A.section('REUSE-OBS-001 — summary and bundle carry the audit trail to XLSX');
{
  const sum = node(wf20, 'Build Execution Summary').parameters.jsCode;
  A.ok('summary feeds the repair share into the cost model', /claude_repair_cost_usd=Number\(ana\.analysis_repair_cost_usd\)/.test(sum));
  A.ok('summary persists the component split', /actual_summary_ai_usd:act\.actual_summary_ai_usd/.test(sum) && /actual_repair_usd:act\.actual_repair_usd/.test(sum));
  A.ok('summary persists reuse lineage + cache decisions', /llm_reuse_lineage:JSON\.stringify\(ana\.reuse_lineage/.test(sum) && /llm_cache_decisions:JSON\.stringify\(ana\.cache_decisions/.test(sum));
  const bun = node(wf20, 'Shape Report Bundle').parameters.jsCode;
  A.ok('bundle keeps reuse lineage + cache decisions + repair cost', /reuse_lineage:__ana\.reuse_lineage/.test(bun) && /cache_decisions:__ana\.cache_decisions/.test(bun) && /repair_cost_usd:Number\(__ana\.analysis_repair_cost_usd\)/.test(bun));
  A.ok('bundle records the model that actually ran (not just config)', /model:String\(__ana\.model\|\|/.test(bun));

  // The hidden XLSX tech sheet proves the origin; no user-facing sheet shows internal ids.
  const bundle = { report_id: 'rep_1', agent_request_id: 'req_new', owner_user_id: 'u1', niche: 'займы', region: 'РФ',
    created_at: NOW, competitors: [], offers: [], recommendations: [], evidence: [], source_quality: [], changes: [],
    summary: {}, analysis: { analysis_ids: ['an_cur'], count_enriched: 1, count_reused: 1, count_fallback: 0,
      analysis_cost_usd: 0, repair_cost_usd: 0, model: 'claude-sonnet-4-6',
      reuse_lineage: [{ analysis_id: 'an_cur', reused_from_analysis_id: 'an_f91a9fd1', reused_from_created_at: ago(3) }],
      cache_decisions: [{ analysis_id: 'an_cur', decision: 'reuse', reason: 'match: … → an_f91a9fd1' }],
      inferences: [{ source: 's', dimension: 'd', text: 't', evidence: '[1]' }], recommendations: [], pains: [], evidence: [] } };
  const sheets = RP.buildSheets(bundle);
  const tech = sheets.find(s => s.name === 'Технические данные');
  A.ok('tech sheet stays hidden', tech.hidden === true);
  A.eq('tech sheet names the origin analysis', tech.rows[0].ai_reused_from, 'an_f91a9fd1');
  A.ok('tech sheet records the cache decision + reason', /reuse: match:/.test(tech.rows[0].ai_cache_decisions));
  const userSheets = sheets.filter(s => !s.hidden);
  userSheets.forEach(s => (s.rows || []).forEach(r => Object.keys(r).forEach(k =>
    A.ok('no user-facing sheet leaks an internal analysis id (' + s.name + ')', String(r[k]).indexOf('an_f91a9fd1') < 0))));
}

A.report('reuse-observability');
