'use strict';
// test_analysis_router.js — F-7 ANALYSIS-ROUTE-001.
//
// The defect this locks down: request_planner maps 2 named sources -> 'comparison' and >=3 -> 'synthesis',
// plan_render_ru PROMISES «сравнение указанных источников» in the approval message, and WF28 nevertheless ran
// analyzeSource once per source. `analysis_type` only ever entered the cache key. A user who named two
// competitors was told in writing that a comparison would be produced and never received one.
const A = require('./_assert.js');
const R = require('../n8n/lib/analysis_router.js');

// Bridge-shaped targets. A target only CONTRIBUTES when it carries at least one citable evidence item.
function target(id, evCount, extra) {
  const ev = [];
  for (let i = 0; i < evCount; i++) ev.push({ evidence_id: 'x' + i, source_url: 'https://' + id + '/p' + i, excerpt: 'цитата ' + i, collected_at: '2026-07-22T20:00:00Z', quality_status: 'accepted' });
  return Object.assign({
    source_key: id, source_kind: 'website',
    evidence_input: {
      request: { agent_request_id: 'req_x', niche: 'credit_brokerage', region: 'Москва/МО', data_mode: 'live', requested_sources: ['website'] },
      source: { source_id: id, kind: 'website', source_run_id: 'run_' + id, quality_status: 'accepted' },
      current_run_facts: { company_name: 'Компания ' + id, positioning: 'позиционирование ' + id, offer_summary: 'оффер ' + id, prices_terms: 'от 2,4%', cta_text: 'заявка' },
      evidence: ev,
      limitations: ['ограничение ' + id]
    }
  }, extra || {});
}

A.section('contributing sources — a source with no evidence must not inflate the mode');
{
  A.eq('two evidenced sources', R.arCountContributing([target('a', 2), target('b', 1)]), 2);
  A.eq('an empty source does not count', R.arCountContributing([target('a', 2), target('b', 0)]), 1);
  A.eq('all empty', R.arCountContributing([target('a', 0), target('b', 0)]), 0);
  A.eq('null-safe', R.arCountContributing(null), 0);
}

A.section('single source → analyzeSource');
{
  const r = R.resolveAnalysisMode({ requested_mode: 'source_analysis', targets: [target('a', 3)] });
  A.eq('mode', r.mode, 'source_analysis');
  A.eq('impl', r.impl, 'analyzeSource');
  A.ok('not multi-source', !r.multi_source);
  A.ok('not downgraded', !r.downgraded);
  A.eq('legacy alias normalizes', R.arNormalizeMode('single_source'), 'source_analysis');
  A.eq('unknown mode is safe', R.arNormalizeMode('nonsense'), 'source_analysis');
}

A.section('exactly two contributing sources → comparison via analyzeComparison');
{
  const r = R.resolveAnalysisMode({ requested_mode: 'comparison', targets: [target('a', 2), target('b', 2)] });
  A.eq('mode', r.mode, 'comparison');
  A.eq('impl', r.impl, 'analyzeComparison');
  A.ok('multi-source', r.multi_source);
  A.ok('not downgraded', !r.downgraded);
  A.eq('contributing', r.contributing, 2);
}

A.section('three or more → synthesis (also via analyzeComparison, synthesis contract)');
{
  const r = R.resolveAnalysisMode({ requested_mode: 'synthesis', targets: [target('a', 1), target('b', 1), target('c', 1)] });
  A.eq('mode', r.mode, 'synthesis');
  A.eq('impl', r.impl, 'analyzeComparison');
  A.ok('multi-source', r.multi_source);
  A.eq('contributing', r.contributing, 3);
}

A.section('ONE SOURCE CANNOT MASQUERADE AS A COMPARISON');
{
  const r = R.resolveAnalysisMode({ requested_mode: 'comparison', targets: [target('a', 5)] });
  A.eq('downgraded to single-source', r.mode, 'source_analysis');
  A.eq('impl follows the mode', r.impl, 'analyzeSource');
  A.ok('flagged as downgraded', r.downgraded);
  A.eq('requested mode retained for audit', r.requested_mode, 'comparison');
  A.eq('machine reason', r.reason, 'insufficient_sources_for_comparison');
  A.ok('explains itself in Russian', r.reason_ru.indexOf('одному источнику') > 0);

  // A second source that collected NOTHING must not rescue the comparison.
  const r2 = R.resolveAnalysisMode({ requested_mode: 'comparison', targets: [target('a', 4), target('b', 0)] });
  A.eq('empty second source cannot create a comparison', r2.mode, 'source_analysis');
  A.ok('downgraded', r2.downgraded);
}

A.section('synthesis with only two contributing sources degrades ONE step, not to single-source');
{
  const r = R.resolveAnalysisMode({ requested_mode: 'synthesis', targets: [target('a', 2), target('b', 2)] });
  A.eq('becomes a comparison', r.mode, 'comparison');
  A.ok('still multi-source', r.multi_source);
  A.ok('downgraded', r.downgraded);
  A.eq('reason', r.reason, 'insufficient_sources_for_synthesis');
  A.ok('russian reason mentions comparison', r.reason_ru.indexOf('сравнение') > 0);

  const r1 = R.resolveAnalysisMode({ requested_mode: 'synthesis', targets: [target('a', 2)] });
  A.eq('one source cannot be a synthesis either', r1.mode, 'source_analysis');
}

A.section('candidate / public_lead route to their own implementations');
{
  A.eq('candidate', R.resolveAnalysisMode({ requested_mode: 'candidate', targets: [target('a', 1)] }).impl, 'enrichCandidate');
  A.eq('public_lead', R.resolveAnalysisMode({ requested_mode: 'public_lead', targets: [target('a', 1)] }).impl, 'interpretPublicLead');
  A.eq('change_report still uses analyzeSource', R.resolveAnalysisMode({ requested_mode: 'change_report', targets: [target('a', 1)] }).impl, 'analyzeSource');
  // These are single-source contracts: they must never be treated as multi-source.
  A.ok('candidate is not multi-source', !R.resolveAnalysisMode({ requested_mode: 'candidate', targets: [target('a', 1), target('b', 1)] }).multi_source);
}

A.section('multi-source package preserves identity, lineage and evidence attribution');
{
  const targets = [target('zalog24h.ru', 2), target('autolombardn1.ru', 3), target('t.me/probonds', 1)];
  const pkg = R.arBuildMultiSourcePackage(targets, { agent_request_id: 'req_cmp', niche: 'credit_brokerage', region: 'Москва/МО', analysis_mode: 'synthesis' });

  A.eq('three sources', pkg.source_count, 3);
  A.eq('six evidence items total', pkg.package.evidence_items.length, 6);
  A.eq('allowed ids match evidence', pkg.allowed_evidence_ids.length, 6);

  // Evidence ids must be unique ACROSS the package (they are cited globally by the model).
  A.eq('evidence ids are unique', new Set(pkg.allowed_evidence_ids).size, 6);

  // Every source keeps its identity and its own evidence ids, so a claim stays attributable.
  const s0 = pkg.package.sources[0], s1 = pkg.package.sources[1], s2 = pkg.package.sources[2];
  A.eq('source id preserved', s0.source_id, 'zalog24h.ru');
  A.eq('source run id preserved', s0.source_run_id, 'run_zalog24h.ru');
  A.eq('quality preserved', s0.quality_status, 'accepted');
  A.eq('source 1 owns 2 evidence ids', s0.evidence_ids.length, 2);
  A.eq('source 2 owns 3', s1.evidence_ids.length, 3);
  A.eq('source 3 owns 1', s2.evidence_ids.length, 1);
  A.eq('no id is shared between sources', new Set(s0.evidence_ids.concat(s1.evidence_ids, s2.evidence_ids)).size, 6);

  // Each evidence row carries back to its own source and URL.
  const ev = pkg.package.evidence_items.find((e) => e.evidence_id === s1.evidence_ids[0]);
  A.eq('evidence attributed to the right source', ev.source_id, 'autolombardn1.ru');
  A.ok('evidence keeps its URL', ev.source_url.indexOf('autolombardn1.ru') > 0);
  A.ok('evidence keeps its excerpt', ev.excerpt.length > 0);

  A.eq('request lineage carried', pkg.package.analysis_request.agent_request_id, 'req_cmp');
  A.eq('mode carried into the package', pkg.package.analysis_request.analysis_mode, 'synthesis');
  A.ok('limitations unioned', pkg.package.limitations.length >= 3);

  // Non-contributing sources are excluded from the package entirely.
  const pkg2 = R.arBuildMultiSourcePackage([target('a', 2), target('b', 0)], {});
  A.eq('empty source excluded from the package', pkg2.source_count, 1);
}

A.report('analysis-router');
