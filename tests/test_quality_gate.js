// test_quality_gate.js — WF16 source-health scoring: healthy / degraded / quarantined + critical rules (§7, §16.5/16.6).
'use strict';
const A = require('./_assert');
const Q = require('../n8n/lib/quality_gate.js');

const CFG = { now_iso: '2026-06-19T12:00:00+03:00', freshness_window_days: 30, taxonomy_version: 'semantic-v2.0' };
function rec(over) {
  return Object.assign({ structurally_valid: true, unique: true, exact_evidence_url: true, report_candidate: true, published_at: '2026-06-15T10:00:00+03:00' }, over || {});
}
function many(n, over) { const a = []; for (let i = 0; i < n; i++) a.push(rec(over)); return a; }

A.section('HEALTHY — clean live Telegram run');
{
  const h = Q.computeRunHealth({ data_mode: 'live', source_run_id: 'tg_h', workflow: 'WF11', source_family: 'social_channel', platform: 'telegram', items_received: 6, external_calls: 1, source_cost_status: 'not_applicable', llm_calls: 0 }, many(6), CFG);
  A.eq('status=healthy', h.quality_status, 'healthy');
  A.ok('score >= 80', h.quality_score >= 80, 'score=' + h.quality_score);
  A.eq('report_eligible=true', h.report_eligible, true);
  A.eq('llm_eligible=true', h.llm_eligible, true);
  A.eq('no critical flags', h.quality_flags.filter(f => Q.CRITICAL_FLAGS.indexOf(f) >= 0).length, 0);
}

A.section('DEGRADED — recoverable quality problems, excluded by default');
{
  const recs = many(6);
  recs[0].structurally_valid = false;
  recs[0].repaired = true; recs[1].repaired = true; recs[2].repaired = true; recs[3].repaired = true;
  recs[0].primary_parse_failure = true;
  recs[0].unknown_service = true; recs[1].unknown_service = true; recs[2].unknown_service = true;
  recs[0].generic_offer = true; recs[1].generic_offer = true;
  recs[0].exact_evidence_url = false; recs[1].exact_evidence_url = false; recs[2].exact_evidence_url = false;
  recs[0].missing_description = true; recs[1].missing_description = true; recs[2].missing_description = true;
  recs[0].published_at = '2026-01-01'; recs[1].published_at = '2026-01-05'; recs[2].published_at = '2026-02-01';
  const d = Q.computeRunHealth({ data_mode: 'live', source_run_id: 'av_d', workflow: 'WF09', source_family: 'classifieds', platform: 'avito', items_received: 6, external_calls: 1, source_cost_status: 'unknown' }, recs, CFG);
  A.eq('status=degraded', d.quality_status, 'degraded');
  A.ok('50 <= score <= 79', d.quality_score >= 50 && d.quality_score <= 79, 'score=' + d.quality_score);
  A.eq('report_eligible default false', d.report_eligible, false);
  A.includes('flags high_repair_rate', d.quality_flags, 'high_repair_rate');
  A.includes('flags cost_unknown', d.quality_flags, 'cost_unknown');
  A.ok('no critical flag forces quarantine', d.quality_flags.filter(f => Q.CRITICAL_FLAGS.indexOf(f) >= 0).length === 0);
  // allow_degraded_report opt-in -> eligible WITH visible warning
  const d2 = Q.computeRunHealth({ data_mode: 'live', source_run_id: 'av_d', workflow: 'WF09', source_family: 'classifieds', platform: 'avito', items_received: 6, external_calls: 1, source_cost_status: 'unknown' }, recs, Object.assign({ allow_degraded_report: true }, CFG));
  A.eq('opt-in report_eligible=true', d2.report_eligible, true);
  A.includes('opt-in adds report_quality_warning', d2.quality_flags, 'report_quality_warning');
}

A.section('QUARANTINED — Avito search cards only, no detail evidence');
{
  const recs = many(5, { placeholder_title: true, missing_description: true, missing_seller_identity: true, missing_published_at: true, report_candidate: false, degraded: true, exact_evidence_url: true, published_at: '' });
  const q = Q.computeRunHealth({ data_mode: 'live', source_run_id: 'av_q', workflow: 'WF09', source_family: 'classifieds', platform: 'avito', items_received: 5, external_calls: 1, source_cost_status: 'unknown' }, recs, CFG);
  A.eq('status=quarantined', q.quality_status, 'quarantined');
  A.eq('report_eligible=false', q.report_eligible, false);
  A.eq('llm_eligible=false', q.llm_eligible, false);
  A.includes('flags placeholder_titles', q.quality_flags, 'placeholder_titles');
  A.includes('flags no_detail_records', q.quality_flags, 'no_detail_records');
}

A.section('QUARANTINED — semantic validation failure is critical');
{
  const q = Q.computeRunHealth({ data_mode: 'live', source_run_id: 'wf08_q', workflow: 'WF08', items_received: 6, external_calls: 0, llm_calls: 6, llm_cost_status: 'known', actual_llm_cost_usd: 0.12, semantic_validation_failed_count: 2 }, many(6), CFG);
  A.eq('status=quarantined (semantic_validation_failed)', q.quality_status, 'quarantined');
  A.includes('flags semantic_validation_failed', q.quality_flags, 'semantic_validation_failed');
}

A.section('FIXTURE / MANUAL_TEST never report_eligible by default (§13, §16.5)');
{
  const f = Q.computeRunHealth({ data_mode: 'fixture', source_run_id: 'fx', items_received: 6 }, many(6), CFG);
  A.eq('fixture report_eligible=false', f.report_eligible, false);
  A.includes('fixture flag', f.quality_flags, 'fixture_data');
  const m = Q.computeRunHealth({ data_mode: 'manual_test', source_run_id: 'mt', items_received: 6 }, many(6), CFG);
  A.eq('manual_test report_eligible=false', m.report_eligible, false);
  A.includes('manual_test flag', m.quality_flags, 'manual_test_data');
}

A.section('NO-DATA baseline is quarantined, never a trend baseline (§11.4, §16.5)');
{
  const n = Q.computeRunHealth({ data_mode: 'live', source_run_id: 'empty', items_received: 0 }, [], CFG);
  A.eq('no-data status=quarantined', n.quality_status, 'quarantined');
  A.eq('no-data score=0', n.quality_score, 0);
  A.includes('no_compatible_baseline flag', n.quality_flags, 'no_compatible_baseline');
  A.eq('no-data report_eligible=false', n.report_eligible, false);
}

A.section('COST semantics: unknown != zero (§12)');
{
  const c = Q.computeRunHealth({ data_mode: 'live', source_run_id: 'cost', items_received: 6, external_calls: 1, source_cost_status: 'unknown' }, many(6), CFG);
  A.ok('unknown source cost -> null not 0', c.actual_source_cost_usd === null);
  A.eq('source_cost_status=unknown', c.source_cost_status, 'unknown');
  const z = Q.computeRunHealth({ data_mode: 'fixture', source_run_id: 'nocalls', items_received: 6, external_calls: 0, llm_calls: 0 }, many(6), CFG);
  A.eq('no-call source_cost_status=not_applicable', z.source_cost_status, 'not_applicable');
}

A.report('quality-gate');
