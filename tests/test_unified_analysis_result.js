'use strict';
// test_unified_analysis_result.js — WIP4 UAR-001: canonical contract + deterministic migration + invariants.
const A = require('./_assert');
const U = require('../n8n/lib/unified_analysis_result.js');
const SR = require('../n8n/lib/source_role.js');

// A WF28 "Return Result"-shaped object (rusmicrofinance an_3f6ccdb3 shape), fresh_call.
function wf28(over) {
  return Object.assign({
    analysis_id: 'an_3f6ccdb3', enriched: true, mode: 'call', fallback_used: false, repair_used: false,
    cost_usd: 0.1045, tokens_in: 2719, tokens_out: 6426, model: 'claude-sonnet-4-6',
    overall_confidence: 18,
    evidence_map: {
      0: { evidence_id: 'ev_1', source_id: 't.me/rusmicrofinance', source_url: 'https://t.me/rusmicrofinance/6176', excerpt: 'Инвестиции в долговые портфели МФО', published_at: '2026-07-07' },
      1: { evidence_id: 'ev_2', source_url: 'https://t.me/rusmicrofinance/6178', excerpt: 'НАУМИР приглашает на вебинар' },
      2: { evidence_id: 'ev_3', source_url: 'https://t.me/rusmicrofinance/6179', excerpt: 'Банк России составил ренкинг МФО' },
      3: { evidence_id: 'ev_4', source_url: 'https://t.me/rusmicrofinance/6181', excerpt: 'Эксперт РА: рынок ломбардов +35%' }
    },
    analysis: {
      executive_summary_ru: 'Канал освещает рынок МФО и ломбардов.',
      items: [
        { dimension: 'positioning', kind: 'fact', text_ru: 'Канал публикует отраслевую аналитику', evidence_ids: ['ev_1', 'ev_4'] },
        { dimension: 'prices_terms', kind: 'fact', text_ru: 'Прямой рекламы в постах нет', evidence_ids: ['ev_1'] },
        { dimension: 'target_audience', kind: 'inference', text_ru: 'Аудитория — профессионалы рынка', evidence_ids: ['ev_2'] }
      ],
      recommended_actions: [{ text_ru: 'Отслеживать регуляторные сигналы', priority: 'medium', evidence_ids: ['ev_3'] }],
      unknowns_ru: ['Нет данных об офферах и ценах'], overall_confidence: 18, used_evidence_ids: ['ev_1', 'ev_2', 'ev_3', 'ev_4']
    }
  }, over || {});
}

A.section('UAR — empty shell + schema');
{
  const e = U.emptyUnifiedResult({ agent_request_id: 'req_1', owner_user_id: 'u1', analysis_mode: 'source_analysis' });
  A.eq('schema_version', e.schema_version, 'uar.v1');
  ['source_ids', 'source_roles', 'confirmed_facts', 'inferences', 'recommendations', 'comparisons', 'opportunities', 'public_lead_interpretations', 'evidence', 'limitations', 'next_actions'].forEach(k => A.ok('has array ' + k, Array.isArray(e[k])));
  ['quality', 'costs', 'telemetry', 'lineage'].forEach(k => A.ok('has object ' + k, e[k] && typeof e[k] === 'object'));
}

A.section('UAR — migration from a fresh WF28 result');
{
  const uar = U.migrateToUnifiedResult(wf28(), { report_id: 'report_x', owner_user_id: 'u1', agent_request_id: 'req_1', analysis_mode: 'source_analysis' });
  A.eq('confirmed_facts count', uar.confirmed_facts.length, 2);
  A.eq('inferences count', uar.inferences.length, 1);
  A.eq('recommendations count', uar.recommendations.length, 1);
  A.eq('evidence count', uar.evidence.length, 4);
  A.eq('fresh call -> llm_primary_calls=1', uar.telemetry.llm_primary_calls, 1);
  A.eq('no repair -> llm_repair_calls=0', uar.telemetry.llm_repair_calls, 0);
  A.eq('tokens carried', uar.telemetry.tokens_in, 2719);
  A.eq('cost carried', uar.costs.analysis_cost_usd, 0.1045);
  A.ok('every fact has a stable item_id', uar.confirmed_facts.every(f => /^fact_[0-9a-f]{8}$/.test(f.item_id)));
  A.ok('item_id is deterministic (stable across migrations)', U.migrateToUnifiedResult(wf28(), { report_id: 'report_x' }).confirmed_facts[0].item_id === uar.confirmed_facts[0].item_id);
  A.ok('every fact cites evidence', uar.confirmed_facts.every(f => f.evidence_ids.length > 0));
  A.ok('limitations captured', uar.limitations.length >= 1);
  A.eq('validates OK', U.validateUnifiedResult(uar).ok, true);
}

A.section('UAR — reuse migration shows zero new provider calls + lineage');
{
  const reuse = U.migrateToUnifiedResult(wf28({ mode: 'reuse', cost_usd: 0, reused_from_analysis_id: 'an_3f6ccdb3', reused_from_created_at: '2026-07-21T12:12:30Z', tokens_in: 0, tokens_out: 0 }), {});
  A.eq('reuse -> llm_primary_calls=0', reuse.telemetry.llm_primary_calls, 0);
  A.eq('reuse cost 0', reuse.costs.analysis_cost_usd, 0);
  A.eq('reuse lineage set', reuse.lineage.reused_from_analysis_id, 'an_3f6ccdb3');
  A.ok('reuse original timestamp set', reuse.lineage.original_created_at.length > 0);
}

A.section('UAR — legacy bundle migration (inferences/recommendations/pains, no items[])');
{
  const legacy = U.migrateToUnifiedResult({}, { report_id: 'r', analysis_mode: 'source_analysis',
    evidence: [{ evidence_id: 'ev_1', source_url: 'https://x.ru', excerpt: 'оффер' }],
    analysis: { inferences: [{ text_ru: 'вывод', evidence_ids: ['ev_1'] }], recommendations: [{ text_ru: 'рекомендация', evidence_ids: ['ev_1'] }], pains: [{ text_ru: 'боль', evidence_ids: ['ev_1'] }] } });
  A.eq('legacy inferences migrated (inference + pain)', legacy.inferences.length, 2);
  A.eq('legacy recommendations migrated', legacy.recommendations.length, 1);
  A.eq('legacy evidence migrated', legacy.evidence.length, 1);
}

A.section('UAR — source_roles normalized from classifier');
{
  const role = SR.classifySourceRole({ source_id: 't.me/rusmicrofinance', kind: 'telegram', niche: 'credit_brokerage',
    evidence: [{ evidence_id: 'ev_1', excerpt: 'Банк России составил ренкинг МФО' }, { evidence_id: 'ev_2', excerpt: 'Эксперт РА: рынок ломбардов' }] });
  const uarRole = U.uarSourceRole(Object.assign({ source_url: 'https://t.me/rusmicrofinance', source_type: 'telegram' }, role));
  A.eq('role carried', uarRole.source_role, 'industry_source');
  A.eq('not a direct competitor', uarRole.direct_competitor, false);
  A.ok('relationship_to_niche present', uarRole.relationship_to_niche.length > 0);
}

A.section('UAR — validation catches unsafe items');
{
  const bad = U.emptyUnifiedResult({ agent_request_id: 'r' });
  bad.evidence = [{ evidence_id: 'ev_1' }];
  bad.confirmed_facts = [U.uarMakeItem('fact', { kind: 'fact', text_ru: 'x', evidence_ids: ['ev_MISSING'] })];
  A.eq('cites unknown evidence -> invalid', U.validateUnifiedResult(bad).ok, false);

  const mkt = U.emptyUnifiedResult({ agent_request_id: 'r' });
  mkt.evidence = [{ evidence_id: 'ev_1' }];
  mkt.confirmed_facts = [U.uarMakeItem('fact', { kind: 'fact', text_ru: 'максимум рынка', evidence_ids: ['ev_1'], wording_scope: 'market_wide', source_scope: 'single_source' })];
  A.eq('market_wide wording w/o market scope -> invalid', U.validateUnifiedResult(mkt).ok, false);

  const dc = U.emptyUnifiedResult({ agent_request_id: 'r' });
  dc.source_roles = [U.uarSourceRole({ source_role: 'news_source', direct_competitor: true })];
  A.ok('direct_competitor flag is dropped for non-competitor role', dc.source_roles[0].direct_competitor === false);
}

A.report('unified-analysis-result');
