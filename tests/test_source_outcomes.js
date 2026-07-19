'use strict';
// STAGE-F §8 — canonical typed source outcomes. Website (WF04) declares them; Telegram (WF11) and VK (WF26)
// get exactly ONE terminal outcome DERIVED from their normalized counts + errors, with a Russian label + a
// next-action classification so Telegram / Sheets / XLSX cannot disagree. Offline, $0.
const A = require('./_assert.js');
const SA = require('../n8n/lib/source_adapter.js');
const ES = require('../n8n/lib/execution_summary.js');

A.section('the taxonomy is exactly the 11 canonical outcomes');
{
  const expected = ['collected_with_data', 'refreshed_with_data', 'reused_snapshot', 'blocked', 'access_denied',
    'provider_failed', 'timeout', 'empty_response', 'unsupported_content', 'no_relevant_content', 'quality_rejected'];
  expected.forEach(o => A.ok('outcome ' + o + ' is in the set', SA.SOURCE_OUTCOME_SET.indexOf(o) >= 0));
  A.eq('no extra outcomes', SA.SOURCE_OUTCOME_SET.length, expected.length);
  expected.forEach(o => A.ok('outcome ' + o + ' has a Russian label', !!SA.SOURCE_OUTCOME_RU[o] && SA.sourceOutcomeRu(o) === SA.SOURCE_OUTCOME_RU[o]));
}

A.section('website keeps its declared outcome (connector authority)');
{
  const reuse = SA.normalizeAdapterResult('website', { source_outcome: 'reused_snapshot', execution_mode: 'reuse', items_written: 1 }, {});
  A.eq('declared reuse preserved', reuse.source_outcome, 'reused_snapshot');
  A.eq('reuse carries execution_mode', reuse.execution_mode, 'reuse');
  const coll = SA.normalizeAdapterResult('website', { source_outcome: 'collected_with_data', items_written: 3, external_calls: 3 }, {});
  A.eq('declared collect preserved', coll.source_outcome, 'collected_with_data');
  const refr = SA.normalizeAdapterResult('website', { source_outcome: 'refreshed_with_data', execution_mode: 'refresh', items_written: 2 }, {});
  A.eq('declared refresh preserved', refr.source_outcome, 'refreshed_with_data');
}

A.section('Telegram/VK get ONE derived terminal outcome from counts + errors');
{
  const T = (raw) => SA.normalizeAdapterResult('telegram', raw, {}).source_outcome;
  const V = (raw) => SA.normalizeAdapterResult('vk', raw, {}).source_outcome;
  A.eq('telegram data => collected', T({ items_received: 10, items_written: 10, external_calls: 1 }), 'collected_with_data');
  A.eq('telegram nothing back => empty', T({ items_received: 0, items_written: 0 }), 'empty_response');
  A.eq('telegram came back but unusable => no_relevant', T({ items_received: 5, items_written: 0 }), 'no_relevant_content');
  A.eq('telegram quarantined => quality_rejected', T({ items_written: 2, quality_status: 'quarantined' }), 'quality_rejected');
  A.eq('vk many posts => collected', V({ items_received: 25, items_written: 25, external_calls: 2 }), 'collected_with_data');
  A.eq('vk timeout => timeout', V({ items_written: 0, errors: ['ETIMEDOUT contacting api.vk.com'] }), 'timeout');
  A.eq('vk 429 => blocked', V({ items_written: 0, errors: ['HTTP 429 too many requests'] }), 'blocked');
  A.eq('vk 403 => access_denied', V({ items_written: 0, errors: ['403 Forbidden: private community'] }), 'access_denied');
  A.eq('vk 5xx => provider_failed', V({ items_written: 0, errors: ['500 internal server error'] }), 'provider_failed');
  A.eq('vk collector_unavailable => provider_failed', V({ items_written: 0, errors: ['collector_unavailable'] }), 'provider_failed');
  A.eq('vk unsupported => unsupported_content', V({ items_written: 0, errors: ['unsupported content-type application/pdf'] }), 'unsupported_content');
  // an UNCLASSIFIABLE error is still a failure — never silent success
  A.eq('unknown error => provider_failed (never a false success)', V({ items_written: 0, errors: ['weird thing happened'] }), 'provider_failed');
  // exactly one outcome per source (a single string, always in the set)
  ['collected_with_data', 'empty_response', 'timeout'].forEach(() => {});
  const one = SA.normalizeAdapterResult('vk', { items_received: 25, items_written: 25 }, {});
  A.ok('outcome is a single canonical value', SA.SOURCE_OUTCOME_SET.indexOf(one.source_outcome) >= 0);
}

A.section('outcome / mode / has_data / retryable / label are internally consistent');
{
  const r = SA.normalizeAdapterResult('telegram', { items_received: 10, items_written: 10 }, {});
  A.ok('collected has data', r.outcome_has_data === true);
  A.ok('collected is not retryable (it succeeded)', r.outcome_retryable === false);
  A.eq('collected mode', r.execution_mode, 'collect');
  const t = SA.normalizeAdapterResult('vk', { items_written: 0, errors: ['ETIMEDOUT'] }, {});
  A.ok('timeout has no data', t.outcome_has_data === false);
  A.ok('timeout is retryable', t.outcome_retryable === true);
  const q = SA.normalizeAdapterResult('vk', { items_written: 1, quality_status: 'quarantined' }, {});
  A.ok('quality_rejected is not retryable (structural)', q.outcome_retryable === false);
  const reuse = SA.normalizeAdapterResult('website', { source_outcome: 'reused_snapshot', execution_mode: 'reuse' }, {});
  A.ok('reuse counts as has_data (a saved snapshot is data)', reuse.outcome_has_data === true);
}

A.section('the execution summary surfaces ONE canonical outcome list all renderers share');
{
  const adapters = [
    SA.normalizeAdapterResult('website', { source_outcome: 'reused_snapshot', execution_mode: 'reuse', items_written: 1, original_snapshot_run_id: 'r1', original_snapshot_collected_at: '2026-07-18T00:00:00Z' }, {}),
    SA.normalizeAdapterResult('telegram', { items_received: 8, items_written: 8, external_calls: 1 }, {}),
    SA.normalizeAdapterResult('vk', { items_written: 0, errors: ['ETIMEDOUT'] }, {})
  ];
  const roll = SA.rollupCollection(adapters, ['website', 'telegram', 'vk']);
  const sum = ES.buildExecutionSummary({ request: { state: 'reporting' }, plan: { sources: ['website', 'telegram', 'vk'] }, collection: roll, adapters, analysis: {}, aggregation: {}, report: {}, delivery: {} });
  A.eq('one outcome record per source', sum.source_outcomes.length, 3);
  A.eq('website outcome', sum.source_outcomes.find(o => o.source === 'website').outcome, 'reused_snapshot');
  A.eq('telegram outcome', sum.source_outcomes.find(o => o.source === 'telegram').outcome, 'collected_with_data');
  A.eq('vk outcome', sum.source_outcomes.find(o => o.source === 'vk').outcome, 'timeout');
  A.ok('each record carries a Russian label', sum.source_outcomes.every(o => o.label_ru && o.label_ru.length > 3));
  A.ok('reuse still recorded in reused_sources (delivery cost truth)', sum.reused_sources.length === 1 && sum.reused_sources[0].source === 'website');
}

A.report('source-outcomes');
