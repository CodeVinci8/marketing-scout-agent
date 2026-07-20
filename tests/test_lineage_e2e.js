// test_lineage_e2e.js — Stage C Closure Patch 3 (audit B1/C1/C2/D1/D5). End-to-end source-lineage
// enforcement on PRODUCTION-SHAPED records (no row is given source_run_id by hand at the gate — it is
// produced by running the real WF09 -> WF08 pipeline). Proves:
//   * a real WF09 raw row -> WF08 queue row carries a joinable canonical source_run_id + data_mode +
//     quality_status + report_eligible + review_status, identical on the deterministic path;
//   * WF10 physically excludes a row whose connector run is quarantined in source_health (before any
//     competitor profile / angle / aggregate stat is built);
//   * WF12's rendered body excludes that competitor and the source-quality section agrees (no contradiction);
//   * healthy / degraded-opt-in / fixture / manual_test / pending / stale / missing-health / empty-health /
//     missing-lineage behaviours match the contract (production fail-closed; explicit override to fail-open).
// $0, no network, no live actor/API.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const RG = require('../n8n/lib/report_gate.js');

const WF09 = H.loadWorkflow('09_avito_classifieds_listing_connector.json');
const WF08 = H.loadWorkflow('08_touchpoint_analyzer.json');
const WF10 = H.loadWorkflow('10_competitor_audience_intelligence_aggregator.json');
const WF12 = H.loadWorkflow('12_market_intelligence_report_builder.json');
// Anchored 5 days before "now" so the record stays inside WF10's 30-day freshness window as wall-clock advances
// (a fixed date silently ages out of the window and breaks the suite). WHEN_DATE is the date-only form.
const WHEN = new Date(Date.now() - 5 * 86400000).toISOString().replace('Z', '+03:00');
const WHEN_DATE = WHEN.slice(0, 10);

// Run the REAL WF09 -> WF08 path and return a production-shaped monitor_queue row.
function queueRow(dataMode) {
  const r9 = H.makeRun();
  const c9 = H.runCodeNode(r9, WF09, 'Set Avito Connector Config', [])[0].json;
  c9.fixture_mode = false; c9.data_mode = dataMode;
  r9.outputs['Set Avito Connector Config'] = [{ json: c9 }];
  const listing = { listing_id: '4379480780', isDetail: true, title: 'Кредитный брокер', description: 'Поможем получить кредит после отказов, работаем по договору, оплата за результат.', url: 'https://www.avito.ru/moskva/predlozheniya_uslug/kreditnyy_broker_4379480780', price: 'от 30 000 ₽', location: 'Москва', seller_name: 'Финанс Групп', published_at: WHEN_DATE, category: 'Предложения услуг', query: c9.query_plan[0].search_query, parentSourceUrl: c9.query_plan[0].source_search_url };
  const norm = H.runCodeNode(r9, WF09, 'Normalize Avito Listings', [{ json: listing }]);
  H.inject(r9, 'Read market_record_registry', []);
  const raw = H.runCodeNode(r9, WF09, 'Build raw_market_records Rows', H.runCodeNode(r9, WF09, 'Deduplicate Listings', norm))[0].json;
  const r8 = H.makeRun();
  H.runCodeNode(r8, WF08, 'Set Analyzer Config', []);
  H.runCodeNode(r8, WF08, 'Prepare Record', [{ json: raw }]);
  const q = H.runCodeNode(r8, WF08, 'Build Deterministic Row', [{ json: raw }])[0].json;
  q.created_at = WHEN; q.entity_type = 'competitor'; // within-window competitor (other fields already lineage-stamped)
  return { raw, q };
}

function aggregate(qRow, health, cfgOver) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, WF10, 'Set Aggregator Config', [])[0].json;
  Object.assign(cfg, cfgOver || {});
  run.outputs['Set Aggregator Config'] = [{ json: cfg }];
  H.inject(run, 'Read monitor_queue', qRow ? [qRow] : []);
  H.inject(run, 'Read content_queue', []);
  H.inject(run, 'Read review_queue', []);
  H.inject(run, 'Read source_confidence_rules', []);
  H.inject(run, 'Read source_health', health || []);
  return H.runCodeNode(run, WF10, 'Aggregate Market Intelligence', [])[0].json;
}

const live = queueRow('live');
const sid = live.q.source_run_id;

A.section('Lineage — WF09 raw -> WF08 queue carries identical joinable lineage');
A.ok('raw carries a non-empty source_run_id', !!live.raw.source_run_id);
A.eq('queue source_run_id === raw source_run_id (joinable)', live.q.source_run_id, live.raw.source_run_id);
A.eq('queue data_mode = live', live.q.data_mode, 'live');
A.eq('queue quality_status = healthy', live.q.quality_status, 'healthy');
A.eq('queue report_eligible = true', live.q.report_eligible, true);
A.eq('queue review_status = confirmed', live.q.review_status, 'confirmed');

A.section('WF10 — NEGATIVE: quarantined connector run is physically excluded before aggregation (B1)');
const quarHealth = [{ source_run_id: sid, data_mode: 'live', quality_status: 'quarantined', report_eligible: false, quality_flags: 'broken_brand' }];
const negAgg = aggregate(live.q, quarHealth);
A.eq('rows_after_filters = 0', negAgg.stats.rows_after_filters, 0);
A.eq('NO competitor profile built from the quarantined run', negAgg.competitor_profiles.length, 0);
A.eq('NO market angle built', negAgg.market_angles.length, 0);
A.ok('source_health gate marks the run excluded', negAgg.stats.source_health_gate.excluded_run_ids.indexOf(sid) >= 0);

A.section('WF10 — POSITIVE: healthy run is included and the profile is lineage-stamped');
const okHealth = [{ source_run_id: sid, data_mode: 'live', quality_status: 'healthy', report_eligible: true }];
const posAgg = aggregate(live.q, okHealth);
A.eq('rows_after_filters = 1', posAgg.stats.rows_after_filters, 1);
A.eq('one competitor profile built', posAgg.competitor_profiles.length, 1);
A.eq('profile stamped with the source run id', posAgg.competitor_profiles[0].source_run_ids, sid);
A.eq('profile stamped data_mode=live', posAgg.competitor_profiles[0].data_mode, 'live');
const goodProfile = posAgg.competitor_profiles[0];
const goodAngle = posAgg.market_angles[0];

A.section('WF10 — mode / verification matrix on production-shaped rows');
// fail-closed (production default require_source_health=true): self-attestation cannot bypass a missing health join
A.eq('empty source_health + live self-attest -> EXCLUDED (fail-closed default)', aggregate(live.q, []).stats.rows_after_filters, 0);
A.eq('empty source_health + live self-attest + require_source_health=false -> included (dev opt-in)', aggregate(live.q, [], { require_source_health: false }).stats.rows_after_filters, 1);
A.eq('fixture data_mode (default) -> excluded', aggregate(queueRow('fixture').q, []).stats.rows_after_filters, 0);
A.eq('fixture + allow_fixture_report -> included', aggregate(queueRow('fixture').q, [], { allow_fixture_report: true }).stats.rows_after_filters, 1);
A.eq('manual_test (default) -> excluded', aggregate(queueRow('manual_test').q, []).stats.rows_after_filters, 0);
// pending review record (production-shaped) excluded
const pendingRow = Object.assign({}, live.q, { review_status: 'pending' });
A.eq('pending review -> excluded', aggregate(pendingRow, okHealth).stats.rows_after_filters, 0);
// stale via source_health flag
A.eq('stale source run -> excluded', aggregate(live.q, [{ source_run_id: sid, data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: 'stale_source' }]).stats.rows_after_filters, 0);
// missing lineage (production fail-closed) vs explicit override
const noLineage = Object.assign({}, live.q); delete noLineage.source_run_id; delete noLineage.data_mode; delete noLineage.quality_status; delete noLineage.report_eligible;
A.eq('missing lineage -> excluded by default (fail closed)', aggregate(noLineage, []).stats.rows_after_filters, 0);
A.eq('missing lineage + allow_unverified_source -> included (explicit fail-open)', aggregate(noLineage, [], { allow_unverified_source: true }).stats.rows_after_filters, 1);

A.section('WF10 — degraded run only with explicit opt-in');
const degHealth = [{ source_run_id: sid, data_mode: 'live', quality_status: 'degraded', report_eligible: false, quality_flags: 'high_repair_rate' }];
A.eq('degraded default -> excluded', aggregate(live.q, degHealth).stats.rows_after_filters, 0);
A.eq('degraded + allow_degraded_report -> included', aggregate(live.q, degHealth, { allow_degraded_report: true }).stats.rows_after_filters, 1);

// ---------------- WF12 body consistency ----------------
function buildReport(profiles, angles, signals, health, cfgOver) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, WF12, 'Set Report Config', [])[0].json;
  Object.assign(cfg, { niche_id: 'credit_brokerage', region: 'Москва/МО' }, cfgOver || {});
  run.outputs['Set Report Config'] = [{ json: cfg }];
  const stamp = '20260619_100000';
  const plan = { plan_id: 'plan_' + stamp, niche: 'credit_brokerage', region: 'Москва/МО', top_angles: 'x', source_evidence: 'rows=1 (window 30d)' };
  // tie the WF10 snapshot rows to this report run stamp
  profiles = profiles.map(p => Object.assign({}, p, { notes: 'wf10 v0.3; run wf10_' + stamp }));
  angles = angles.map(a => Object.assign({}, a, { angle_id: 'angle_speed_' + stamp }));
  signals = signals.map(s => Object.assign({}, s, { signal_id: 'sig_avito_' + stamp }));
  H.inject(run, 'Read competitor_profiles', profiles);
  H.inject(run, 'Read market_angles', angles);
  H.inject(run, 'Read audience_activity_signals', signals);
  H.inject(run, 'Read content_positioning_plan', [plan]);
  H.inject(run, 'Read competitor_site_snapshots', []);
  H.inject(run, 'Read public_lead_signals', []);
  H.inject(run, 'Read source_health', health || []);
  return H.runCodeNode(run, WF12, 'Build Deterministic Report', [])[0].json;
}

A.section('WF12 — NEGATIVE: a now-quarantined run is absent from the BODY, and the section agrees (C1/Obj1.11)');
const repNeg = buildReport([goodProfile], [goodAngle], [], quarHealth);
A.ok('top_competitors does NOT contain the quarantined competitor', !/Финанс Групп|Брокер|Финард/.test(String(repNeg.top_competitors)) || repNeg.top_competitors === '');
A.eq('top_competitors empty (only source was quarantined)', repNeg.top_competitors, '');
A.eq('top_angles empty', repNeg.top_angles, '');
A.ok('body_records_excluded > 0', repNeg.body_records_excluded > 0);
A.ok('source-quality section lists the run as excluded', String(repNeg.source_runs_excluded).indexOf(sid) >= 0);
A.ok('no contradiction: excluded run is not in the body', String(repNeg.notes).indexOf('Финанс Групп') < 0);

A.section('WF12 — POSITIVE: a healthy run renders in the body');
const repPos = buildReport([goodProfile], [goodAngle], [], okHealth);
A.ok('top_competitors present for the healthy run', String(repPos.top_competitors).length > 0);
A.eq('body_records_excluded = 0', repPos.body_records_excluded, 0);

A.section('WF12 — drift proof: embedded gate === n8n/lib/report_gate.js');
const lib = RG.buildEligibility(quarHealth, {});
A.eq('excluded run matches lib', repNeg.source_runs_excluded, lib.excluded_run_ids.join(', '));

A.report('lineage-e2e');
