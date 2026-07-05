// test_report_gate.js — unit tests for the shared n8n/lib/report_gate.js source_health gate that WF10
// and WF12 embed. Pure, deterministic, $0. (Drift between the lib and the embedded mirrors is proven
// separately in test_wf10_source_health.js / test_wf12_closure.js.)
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');
const RG = require('../n8n/lib/report_gate.js');

// --- embedded-mirror sync proof: WF10/WF12 embed report_gate.js verbatim (minus 'use strict'/exports) ---
A.section('report_gate — embedded mirrors are byte-identical to the shared library (no drift)');
const libCore = (function () {
  let s = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', 'report_gate.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  return s.trim();
})();
for (const [file, node] of [
  ['10_competitor_audience_intelligence_aggregator.json', 'Aggregate Market Intelligence'],
  ['12_market_intelligence_report_builder.json', 'Build Deterministic Report']
]) {
  const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', file), 'utf8'));
  const code = wf.nodes.find(n => n.name === node).parameters.jsCode;
  const m = code.match(/embedded n8n\/lib\/report_gate\.js[^\n]*\n([\s\S]*?)\n\/\/ --- end embedded report_gate ---/);
  A.ok(node + ' contains the embedded report_gate block', !!m);
  A.eq(node + ' embed === n8n/lib/report_gate.js core', m ? m[1] : '(missing)', libCore);
}

const health = [
  { source_run_id: 'h', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' },
  { source_run_id: 'fx', data_mode: 'fixture', quality_status: 'healthy', report_eligible: false, quality_flags: 'fixture_data' },
  { source_run_id: 'mt', data_mode: 'manual_test', quality_status: 'healthy', report_eligible: false, quality_flags: 'manual_test_data' },
  { source_run_id: 'q', data_mode: 'live', quality_status: 'quarantined', report_eligible: false, quality_flags: 'broken_brand' },
  { source_run_id: 'd', data_mode: 'live', quality_status: 'degraded', report_eligible: false, quality_flags: 'high_repair_rate' },
  // PENDING-MINORITY-001: 'p' is a run with SOME records pending — WF16 keeps report_eligible=true because
  // they are not ALL pending. The run stays eligible; the per-record gate drops the individual pending rows.
  { source_run_id: 'p', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: 'pending_review' },
  // 'pp' is a run whose records are ALL pending — WF16 sets report_eligible=false + review_status=pending. Fail closed.
  { source_run_id: 'pp', data_mode: 'live', quality_status: 'healthy', report_eligible: false, quality_flags: 'pending_review', review_status: 'pending' },
  { source_run_id: 'st', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: 'stale_source' },
  { source_run_id: 'sf', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: 'semantic_validation_failed' }
];

A.section('report_gate — default excludes everything non-healthy');
const def = RG.buildEligibility(health, {});
A.eq('healthy + minority-pending runs eligible (PENDING-MINORITY-001)', def.eligible_run_ids, ['h', 'p']);
A.ok('fixture excluded', def.excluded_run_ids.indexOf('fx') >= 0);
A.ok('manual_test excluded', def.excluded_run_ids.indexOf('mt') >= 0);
A.ok('quarantined excluded', def.excluded_run_ids.indexOf('q') >= 0);
A.ok('degraded excluded by default', def.excluded_run_ids.indexOf('d') >= 0);
A.ok('minority-pending run NOW eligible (PENDING-MINORITY-001)', def.eligible_run_ids.indexOf('p') >= 0);
A.ok('fully-pending run still fail-closed excluded', def.excluded_run_ids.indexOf('pp') >= 0);
A.ok('stale excluded', def.excluded_run_ids.indexOf('st') >= 0);
A.ok('semantic-failed excluded', def.excluded_run_ids.indexOf('sf') >= 0);
A.eq('no degraded silently included', def.has_degraded_included, false);

A.section('report_gate — explicit opt-ins');
const deg = RG.buildEligibility(health, { allow_degraded_report: true });
A.ok('degraded eligible with opt-in', deg.eligible_run_ids.indexOf('d') >= 0);
A.eq('degraded marked included', deg.has_degraded_included, true);
A.ok('degraded carries warning', deg.warnings.some(w => w.source_run_id === 'd' && w.warning === 'degraded'));
const fix = RG.buildEligibility(health, { allow_fixture_report: true });
A.ok('fixture eligible with opt-in', fix.eligible_run_ids.indexOf('fx') >= 0);
A.ok('manual_test eligible with opt-in', fix.eligible_run_ids.indexOf('mt') >= 0);
A.ok('fixture warning surfaced', fix.has_fixture_warning === true);
A.ok('quarantined STILL excluded even with fixture opt-in', fix.excluded_run_ids.indexOf('q') >= 0);

A.section('report_gate — per-record gate');
A.eq('pending record excluded', RG.rowEligible({ source_run_id: 'h', review_status: 'pending' }, def, {}).eligible, false);
A.eq('uncertain deterministic record excluded', RG.rowEligible({ source_run_id: 'h', parse_method: 'deterministic_uncertain_no_llm' }, def, {}).eligible, false);
A.eq('clean record on eligible run included', RG.rowEligible({ source_run_id: 'h' }, def, {}).eligible, true);
A.eq('record on excluded run excluded', RG.rowEligible({ source_run_id: 'q' }, def, {}).eligible, false);
A.eq('require_source_health drops unknown-run record', RG.rowEligible({ source_run_id: 'unknown_run' }, def, { require_source_health: true }).eligible, false);

A.section('report_gate — PENDING-MINORITY-001: one pending sibling never poisons confirmed records');
// The real website run (req_..::website::a1): two confirmed report candidates (mkbkfin.ru, lioncredit.ru) plus
// one pending-review sibling. WF16 keeps the run report_eligible=true (not ALL pending) and emits a run-level
// pending_review flag. The run must stay eligible so the two confirmed records aggregate, while the pending
// record is dropped at the RECORD level only.
const webHealth = RG.buildEligibility([{ source_run_id: 'web', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: 'missing_published_at; pending_review; cost_unknown' }], {});
A.ok('minority-pending source run stays eligible', webHealth.eligible_run_ids.indexOf('web') >= 0);
const confRec = { source_run_id: 'web', review_status: 'confirmed', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' };
A.eq('confirmed record #1 (mkbkfin) enters aggregation', RG.rowEligible(Object.assign({}, confRec), webHealth, {}).eligible, true);
A.eq('confirmed record #2 (lioncredit) enters aggregation', RG.rowEligible(Object.assign({}, confRec), webHealth, {}).eligible, true);
A.eq('the pending sibling is still excluded at record level', RG.rowEligible({ source_run_id: 'web', review_status: 'pending', data_mode: 'live', quality_status: 'healthy' }, webHealth, {}).eligible, false);
// a run that is FULLY pending stays fail-closed (WF16 emits report_eligible=false + review_status=pending).
const allPend = RG.buildEligibility([{ source_run_id: 'apr', data_mode: 'live', quality_status: 'healthy', report_eligible: false, quality_flags: 'pending_review', review_status: 'pending' }], {});
A.ok('fully-pending run excluded (fail closed)', allPend.excluded_run_ids.indexOf('apr') >= 0);

A.section('report_gate — Patch 3 merge + production fail-closed verification');
const empty = RG.buildEligibility([], {});
// missing lineage entirely -> excluded by default; included only with explicit override
A.eq('no lineage, no health -> excluded (fail closed)', RG.rowEligible({}, empty, {}).eligible, false);
A.eq('no lineage + allow_unverified_source -> included', RG.rowEligible({}, empty, { allow_unverified_source: true }).eligible, true);
// record self-attests live + healthy, source_health empty -> included (no join required)
A.eq('live+healthy self-attest, empty health -> included', RG.rowEligible({ source_run_id: 'x', data_mode: 'live', quality_status: 'healthy', report_eligible: true }, empty, {}).eligible, true);
// record-local fixture excluded even when source_health is empty (does not rely on join)
A.eq('record-local fixture -> excluded (no health needed)', RG.rowEligible({ source_run_id: 'x', data_mode: 'fixture' }, empty, {}).eligible, false);
A.eq('record-local fixture + allow_fixture_report -> included', RG.rowEligible({ source_run_id: 'x', data_mode: 'fixture', quality_status: 'healthy' }, empty, { allow_fixture_report: true }).eligible, true);
// stricter-wins merge: health says healthy/eligible but the record itself is quarantined -> excluded
const okIdx = RG.buildEligibility([{ source_run_id: 'r', data_mode: 'live', quality_status: 'healthy', report_eligible: true }], {});
A.eq('health healthy but record-local quarantined -> excluded (stricter wins)', RG.rowEligible({ source_run_id: 'r', data_mode: 'live', quality_status: 'quarantined' }, okIdx, {}).eligible, false);
A.eq('health healthy + record live/healthy -> included', RG.rowEligible({ source_run_id: 'r', data_mode: 'live', quality_status: 'healthy' }, okIdx, {}).eligible, true);
// health quarantined overrides a live/healthy-looking record
const quarIdx = RG.buildEligibility([{ source_run_id: 'r', data_mode: 'live', quality_status: 'quarantined', report_eligible: false }], {});
A.eq('health quarantined overrides record self-attestation -> excluded', RG.rowEligible({ source_run_id: 'r', data_mode: 'live', quality_status: 'healthy', report_eligible: true }, quarIdx, {}).eligible, false);

A.section('report_gate — baseline selection (S3-D7)');
const cands = [
  { run_stamp: '20260601_000000', niche_id: 'credit_brokerage', region: 'Москва/МО', data_mode: 'live', report_eligible: true, rows_after_filters: 5, time_window_days: 30 },
  { run_stamp: '20260610_000000', niche_id: 'credit_brokerage', region: 'Москва/МО', data_mode: 'live', report_eligible: true, rows_after_filters: 7, time_window_days: 30 },
  { run_stamp: '20260612_000000', niche_id: 'other', region: 'Москва/МО', data_mode: 'live', report_eligible: true, rows_after_filters: 9, time_window_days: 30 },
  { run_stamp: '20260613_000000', niche_id: 'credit_brokerage', region: 'Москва/МО', data_mode: 'fixture', report_eligible: false, rows_after_filters: 9, time_window_days: 30 }
];
const cur = { run_stamp: '20260619_000000', niche_id: 'credit_brokerage', region: 'Москва/МО', time_window_days: 30 };
const bl = RG.selectBaseline(cands, cur, {});
A.eq('most recent compatible baseline chosen', bl.baseline_run_stamp, '20260610_000000');
A.eq('trend_status baseline_selected', bl.trend_status, 'baseline_selected');
A.eq('no candidates -> no_compatible_baseline', RG.selectBaseline([], cur, {}).trend_status, 'no_compatible_baseline');
A.eq('incompatible-only -> no_compatible_baseline', RG.selectBaseline([cands[2], cands[3]], cur, {}).trend_status, 'no_compatible_baseline');

A.section('report_gate — trend marker never dangles');
A.eq('no baseline -> empty marker', RG.trendMarker(34, 34, false), '');
A.eq('no baseline -> (x34)', RG.freqSuffix(34, RG.trendMarker(34, undefined, false)), '(x34)');
A.eq('baseline equal -> flat word', RG.trendMarker(34, 34, true), 'flat');
A.eq('baseline equal suffix is (x34, flat)', RG.freqSuffix(34, RG.trendMarker(34, 34, true)), '(x34, flat)');
A.eq('baseline up', RG.trendMarker(40, 34, true), 'up');
A.eq('baseline new (no prev freq)', RG.trendMarker(40, undefined, true), 'new');
A.ok('no suffix ever renders bare "="', !/\(x\d+\s*=\s*\)/.test(RG.freqSuffix(34, RG.trendMarker(34, 34, true))));

A.report('report-gate');
