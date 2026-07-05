// test_wf10_source_health.js — WF10 Stage C Closure: strict run isolation, observed-vs-inferred split,
// pending-review exclusion, and WF16 source_health enforcement, run on the REAL aggregate node code.
// Also proves the node-embedded gate equals n8n/lib/report_gate.js (drift-proof). ($0, no network.)
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const RG = require('../n8n/lib/report_gate.js');

const wf = H.loadWorkflow('10_competitor_audience_intelligence_aggregator.json');

const WHEN = '2026-06-15T10:00:00+03:00';
function comp(source_run_id, extra) {
  return Object.assign({
    entity_type: 'competitor', company_name: 'Брокер ' + source_run_id, platform: 'avito', service_type: 'credit_broker',
    region: 'Москва', source_url: 'https://www.avito.ru/moskva/x_' + source_run_id + '_4379480780',
    offer_text: 'Кредитный брокер: помощь в получении кредита после отказов банков, без предоплаты, оплата за результат',
    terms: 'от 30 000 ₽', created_at: WHEN, source_run_id: source_run_id
  }, extra || {});
}
const monitor = [
  comp('run_healthy'),
  comp('run_fixture'),
  comp('run_manual'),
  comp('run_quar'),
  comp('run_degraded'),
  comp('run_pending'),
  comp('run_healthy', { company_name: 'Pending Rec', review_status: 'pending' }),
  comp('run_healthy', { company_name: 'Uncertain Rec', parse_method: 'deterministic_uncertain_no_llm' })
];
const health = [
  { source_run_id: 'run_healthy', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' },
  { source_run_id: 'run_fixture', data_mode: 'fixture', quality_status: 'healthy', report_eligible: false, quality_flags: 'fixture_data' },
  { source_run_id: 'run_manual', data_mode: 'manual_test', quality_status: 'healthy', report_eligible: false, quality_flags: 'manual_test_data' },
  { source_run_id: 'run_quar', data_mode: 'live', quality_status: 'quarantined', report_eligible: false, quality_flags: 'broken_brand' },
  { source_run_id: 'run_degraded', data_mode: 'live', quality_status: 'degraded', report_eligible: false, quality_flags: 'high_repair_rate' },
  { source_run_id: 'run_pending', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: 'pending_review', review_status: 'pending' }
];

function aggregate(cfgOverride) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf, 'Set Aggregator Config', [])[0].json;
  Object.assign(cfg, cfgOverride || {});
  run.outputs['Set Aggregator Config'] = [{ json: cfg }];
  H.inject(run, 'Read monitor_queue', monitor);
  H.inject(run, 'Read content_queue', []);
  H.inject(run, 'Read review_queue', []);
  H.inject(run, 'Read source_confidence_rules', []);
  H.inject(run, 'Read source_health', health);
  const out = H.runCodeNode(run, wf, 'Aggregate Market Intelligence', [])[0].json;
  return { cfg, out };
}

// ---------- default config: only the healthy live run survives ----------
const def = aggregate({});
const s = def.out.stats;
A.section('WF10 — source_health enforcement (default: degraded/fixture/manual/quarantined/pending excluded)');
A.eq('only run_healthy is gate-eligible', s.source_health_gate.eligible_run_ids.sort(), ['run_healthy']);
A.eq('rows_after_filters = 1 (only the clean healthy-run row)', s.rows_after_filters, 1);
A.eq('included competitor is from run_healthy', def.out.competitor_profiles.length, 1);
A.ok('fixture run excluded', s.source_health_gate.excluded_run_ids.indexOf('run_fixture') >= 0);
A.ok('manual_test run excluded', s.source_health_gate.excluded_run_ids.indexOf('run_manual') >= 0);
A.ok('quarantined run excluded', s.source_health_gate.excluded_run_ids.indexOf('run_quar') >= 0);
A.ok('degraded run excluded by default', s.source_health_gate.excluded_run_ids.indexOf('run_degraded') >= 0);
A.ok('pending run excluded', s.source_health_gate.excluded_run_ids.indexOf('run_pending') >= 0);
A.ok('record-level pending + uncertain excluded by review', s.rows_excluded_by_review >= 2);
A.eq('no degraded silently included', s.source_health_gate.has_degraded_included, false);

A.section('WF10 — drift proof: embedded gate === n8n/lib/report_gate.js');
const libDef = RG.buildEligibility(health, def.cfg);
A.eq('eligible_run_ids match lib', s.source_health_gate.eligible_run_ids.sort(), libDef.eligible_run_ids.sort());
A.eq('excluded_run_ids match lib', s.source_health_gate.excluded_run_ids.sort(), libDef.excluded_run_ids.sort());

// ---------- explicit degraded opt-in: degraded run included WITH warning ----------
const deg = aggregate({ allow_degraded_report: true });
A.section('WF10 — degraded included ONLY with explicit opt-in + visible warning');
A.ok('degraded run now eligible', deg.out.stats.source_health_gate.eligible_run_ids.indexOf('run_degraded') >= 0);
A.eq('degraded marked as included', deg.out.stats.source_health_gate.has_degraded_included, true);
A.ok('degraded carries a quality warning', deg.out.stats.source_health_gate.warnings.some(w => w.source_run_id === 'run_degraded' && w.warning === 'degraded'));
A.eq('rows_after_filters now 2 (healthy + degraded)', deg.out.stats.rows_after_filters, 2);
const libDeg = RG.buildEligibility(health, deg.cfg);
A.eq('opt-in eligible_run_ids match lib', deg.out.stats.source_health_gate.eligible_run_ids.sort(), libDeg.eligible_run_ids.sort());

// ---------- explicit fixture opt-in ----------
const fix = aggregate({ allow_fixture_report: true });
A.section('WF10 — fixture/manual_test included ONLY with explicit opt-in');
A.ok('fixture run eligible with opt-in', fix.out.stats.source_health_gate.eligible_run_ids.indexOf('run_fixture') >= 0);
A.ok('manual_test run eligible with opt-in', fix.out.stats.source_health_gate.eligible_run_ids.indexOf('run_manual') >= 0);
A.ok('fixture warning present', fix.out.stats.source_health_gate.has_warning === true);

// ---------- observed vs inferred split ----------
A.section('WF10 — observed audience signals separated from inferred insights (S3-D6)');
A.ok('observed_audience_signals present', Array.isArray(def.out.observed_audience_signals));
A.ok('inferred_audience_insights present', Array.isArray(def.out.inferred_audience_insights));
A.ok('observed entries carry counts only (no pain phrases)', def.out.observed_audience_signals.every(o => o.basis === 'observed' && o.inferred_pains === undefined && typeof o.question_count === 'number'));
A.ok('inferred entries are labelled inferred (no-LLM)', def.out.inferred_audience_insights.every(i => /inferred/.test(i.basis) && 'inferred_pains' in i));

// ---------- strict run isolation ----------
A.section('WF10 — strict run/request isolation (S3-D5)');
const iso = aggregate({ source_run_id_filter: 'run_healthy' });
A.eq('isolation keeps only run_healthy rows', iso.out.stats.rows_after_isolation, 3);
A.eq('then health gate yields 1 clean row', iso.out.stats.rows_after_filters, 1);
const isoNone = aggregate({ source_run_id_filter: 'run_quar' });
A.eq('isolating a quarantined run yields 0 report rows', isoNone.out.stats.rows_after_filters, 0);

// ---------- ISO-ARID-001 regression: queue rows carry no agent_request_id column ----------
// Live defect (exec 411): WF08 writes monitor/review_queue rows WITHOUT an agent_request_id column, but the
// orchestrator passes agent_request_id_filter=<request root> AND source_run_id_filter=<idempotency_key>.
// The old strict `r.agent_request_id === filter` dropped EVERY row (all had ''), so rows_after_isolation=0
// and the report was empty although the records were genuinely relevant + healthy. Isolation must key off the
// request family embedded in source_run_id (req_x::source::slot[::sub]) when the column is absent.
A.section('WF10 — ISO-ARID-001: isolate by source_run_id family when queue rows lack agent_request_id');
function aggregateWith(rows, healthRows, cfgOverride) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf, 'Set Aggregator Config', [])[0].json;
  Object.assign(cfg, cfgOverride || {});
  run.outputs['Set Aggregator Config'] = [{ json: cfg }];
  H.inject(run, 'Read monitor_queue', rows);
  H.inject(run, 'Read content_queue', []);
  H.inject(run, 'Read review_queue', []);
  H.inject(run, 'Read source_confidence_rules', []);
  H.inject(run, 'Read source_health', healthRows);
  return H.runCodeNode(run, wf, 'Aggregate Market Intelligence', [])[0].json;
}
const REQ = 'req_90112771';
const TG = REQ + '::website::a1::telegram';   // real telegram source-run form (family child of the idempotency key)
const WEB = REQ + '::website::a1';             // the idempotency key itself
// competitor rows as WF08 persists them: real source_run_id, but NO agent_request_id field at all.
const famRows = [
  comp(TG, { agent_request_id: undefined, company_name: 'Брокер ТГ 1' }),
  comp(TG, { agent_request_id: undefined, company_name: 'Брокер ТГ 2' })
];
const famHealth = [
  { source_run_id: TG, data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: 'cost_unknown' }
];
// Orchestrator passes BOTH filters (mirrors WF20 -> WF10 exactly): request root + idempotency key.
const fam = aggregateWith(famRows, famHealth, { agent_request_id_filter: REQ, source_run_id_filter: WEB });
A.eq('family rows survive isolation despite the missing agent_request_id column', fam.stats.rows_after_isolation, 2);
A.eq('and clear the source_health gate', fam.stats.rows_after_filters, 2);
A.eq('so a content-ful competitor profile is produced (not an empty report)', fam.competitor_profiles.length >= 1, true);
// strictness preserved: a row from a DIFFERENT request is still dropped.
const otherRows = famRows.concat([comp('req_OTHER::website::a1::telegram', { agent_request_id: undefined, company_name: 'Чужой' })]);
const otherHealth = famHealth.concat([{ source_run_id: 'req_OTHER::website::a1::telegram', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' }]);
const strict = aggregateWith(otherRows, otherHealth, { agent_request_id_filter: REQ, source_run_id_filter: WEB });
A.eq('a foreign request is still isolated out (no cross-request leakage)', strict.stats.rows_after_isolation, 2);

A.report('wf10-source-health');
