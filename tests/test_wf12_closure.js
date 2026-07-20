// test_wf12_closure.js — WF12 Stage C Closure on the REAL Build Deterministic Report node ($0, no network).
// Covers: no dangling "(x34 =)" trend marker (C1-D1); compatible-baseline selection / no_compatible_baseline
// (S3-D7); changed_domains=0 neutral action (S2-D19); fixture watermark (§11.7); unambiguous contact counters
// (C1-D2); WF16 source_health enforcement in the report (§11.5) + drift proof vs n8n/lib/report_gate.js.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const RG = require('../n8n/lib/report_gate.js');

const wf = H.loadWorkflow('12_market_intelligence_report_builder.json');
const NICHE = 'credit_brokerage', REGION = 'Москва/МО';
const CUR = '20260619_100000', PREV = '20260618_100000';

const health = [
  { source_run_id: 'run_healthy', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' },
  { source_run_id: 'run_fixture', data_mode: 'fixture', quality_status: 'healthy', report_eligible: false, quality_flags: 'fixture_data' },
  { source_run_id: 'run_manual', data_mode: 'manual_test', quality_status: 'healthy', report_eligible: false, quality_flags: 'manual_test_data' },
  { source_run_id: 'run_quar', data_mode: 'live', quality_status: 'quarantined', report_eligible: false, quality_flags: 'broken_brand' },
  { source_run_id: 'run_degraded', data_mode: 'live', quality_status: 'degraded', report_eligible: false, quality_flags: 'high_repair_rate' },
  { source_run_id: 'run_pending', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: 'pending_review', review_status: 'pending' }
];

function plan(stamp, niche, rows) {
  return { plan_id: 'plan_' + stamp, niche: niche, region: REGION, top_angles: 'скорость (x34)', source_evidence: 'rows=' + rows + ' (window 30d)' };
}
// Patch 3: WF10 now stamps source lineage onto its outputs; a healthy run keeps the body intact.
const LIN = { source_run_ids: 'run_healthy', data_mode: 'live', report_eligible: true };
function angle(stamp, freq) { return Object.assign({ angle_id: 'angle_speed_' + stamp, angle_text: 'скорость / срочность', category: 'speed', frequency: freq, recommended_content_response: 'Пост про реальные сроки' }, LIN); }
const profile = Object.assign({ competitor_id: 'comp_1', competitor_name: 'Финард', platforms: 'avito', offers: 'Кредитный брокер', prices_terms: 'от 30 000 ₽', evidence_count: 3, source_confidence_score: 80, notes: 'wf10 v0.3; run wf10_' + CUR + '; window 30d' }, LIN);
const cleanSnap = { domain: 'finardi.ru', company_name: 'Финард', offer_summary: 'Кредитный брокер', prices_terms: 'от 30 000 ₽', change_type: 'baseline', created_at: '2026-06-15', quality_status: 'healthy', report_eligible: true };
const degradedSnap = { domain: 'mkbk.ru', company_name: 'МКБ', offer_summary: '# RAW MARKDOWN DUMP\n\n## very long', change_type: 'baseline', created_at: '2026-06-15', quality_status: 'degraded', report_eligible: false, quality_flags: 'raw_markdown_fallback' };
const leads = [
  { review_status: 'new', source_platform: 'vk', lead_score: 80, score_band: 'high', intent_type: 'buying', pain_type: 'отказы банков', public_phone: '+7 900 000-00-01', contact_source_url: 'https://vk.com/wall-1_2', recommended_action: 'manual_review' },
  { review_status: 'new', source_platform: 'avito', lead_score: 40, score_band: 'low', intent_type: 'research', pain_type: 'просрочки', contact_use_policy: 'do_not_use', privacy_flags: 'contact_blanked_no_source_url', recommended_action: 'manual_review' }
];

function buildReport(plans, angles, cfgOverride, snaps) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf, 'Set Report Config', [])[0].json;
  Object.assign(cfg, { niche_id: NICHE, region: REGION }, cfgOverride || {});
  run.outputs['Set Report Config'] = [{ json: cfg }];
  H.inject(run, 'Read competitor_profiles', [profile]);
  H.inject(run, 'Read market_angles', angles);
  H.inject(run, 'Read audience_activity_signals', [Object.assign({ signal_id: 'sig_vk_' + CUR, platform: 'vk', question_count: 5, objection_count: 2, complaint_count: 0, buying_intent_count: 3, top_pains: 'отказы банков' }, LIN)]);
  H.inject(run, 'Read content_positioning_plan', plans);
  H.inject(run, 'Read competitor_site_snapshots', snaps || [cleanSnap]);
  H.inject(run, 'Read public_lead_signals', leads);
  H.inject(run, 'Read source_health', health);
  const rep = H.runCodeNode(run, wf, 'Build Deterministic Report', [])[0].json;
  return { cfg, rep };
}

const DANGLING = /\(x\d+\s*=\s*\)/; // the forbidden "(x34 =)" pattern (and whitespace variants)

// ---- no compatible baseline: marker has no dangling "=" and items are not all NEW ----
const noBase = buildReport([plan(CUR, NICHE, 5)], [angle(CUR, 34)], {});
A.section('WF12 — no compatible baseline: clean marker, no dangling "(x34 =)" (C1-D1/S3-D7)');
A.eq('trend_status = no_compatible_baseline', noBase.rep.trend_status, 'no_compatible_baseline');
A.ok('top_angles shows (x34) with no trailing operator', /\(x34\)/.test(noBase.rep.top_angles));
A.ok('NO dangling (x34 =) in top_angles', !DANGLING.test(noBase.rep.top_angles));
A.ok('NO dangling (xN =) anywhere in report markdown', !DANGLING.test(noBase.rep.notes));
A.ok('no spurious NEW marker without a baseline', !/\bNEW\b/.test(noBase.rep.top_angles));

// ---- compatible baseline, equal frequency: old code would emit "(x34 =)" ----
const withBase = buildReport([plan(PREV, NICHE, 5), plan(CUR, NICHE, 5)], [angle(CUR, 34), angle(PREV, 34)], {});
A.section('WF12 — compatible baseline selected, unchanged value renders a word not "="');
A.eq('trend_status = baseline_selected', withBase.rep.trend_status, 'baseline_selected');
A.eq('prev_wf10_run_id points at compatible baseline', withBase.rep.prev_wf10_run_id, 'wf10_' + PREV);
A.ok('unchanged angle renders (x34, flat)', /\(x34, flat\)/.test(withBase.rep.top_angles));
A.ok('STILL no dangling (x34 =)', !DANGLING.test(withBase.rep.top_angles) && !DANGLING.test(withBase.rep.notes));

// ---- incompatible baseline (different niche) -> no_compatible_baseline, not NEW ----
const incompat = buildReport([plan(PREV, 'other_niche', 5), plan(CUR, NICHE, 5)], [angle(CUR, 34), angle(PREV, 34)], {});
A.section('WF12 — incompatible previous run is NOT used as a baseline (S3-D7)');
A.eq('trend_status = no_compatible_baseline', incompat.rep.trend_status, 'no_compatible_baseline');
A.ok('no NEW marker spam', !/\bNEW\b/.test(incompat.rep.top_angles));

// ---- changed_domains=0 neutral action (S2-D19) ----
A.section('WF12 — changed_domains=0 yields a neutral no-change action');
A.ok('no "0 изменённых доменов" recommendation', !/0 изменённых доменов/.test(noBase.rep.notes));
A.ok('neutral no-change action rendered', /изменений за период нет/.test(noBase.rep.notes));

// ---- contact counters (C1-D2) ----
A.section('WF12 — unambiguous contact counters; report never contains contacts');
A.eq('report_contains_contacts=false', noBase.rep.report_contains_contacts, false);
A.eq('contacts_detected=1', noBase.rep.contacts_detected, 1);
A.eq('contacts_excluded_from_report=1', noBase.rep.contacts_excluded_from_report, 1);
A.eq('contacts_redacted=1', noBase.rep.contacts_redacted, 1);

// ---- VK wording: clean user-facing phrasing, no internal Stage/C.x/live-smoke codes (REPORT-CLEAN-001) ----
A.section('WF12 — VK source action is clean user-facing Russian');
A.ok('VK source action present in clean Russian', /VK: сбор из публичных сообществ/.test(noBase.rep.report_markdown));
A.ok('no internal Stage/C.x/live-smoke codes leak', !/C\.\d|live-smoke|Stage C/.test(noBase.rep.report_markdown));
A.ok('does NOT claim VK does not block MVP generally', !/не блокирует MVP-закрытие/.test(noBase.rep.report_markdown));

// ---- website fallback (S2-D20): degraded/raw-markdown snapshot excluded ----
const withDeg = buildReport([plan(CUR, NICHE, 5)], [angle(CUR, 34)], {}, [cleanSnap, degradedSnap]);
A.section('WF12 — degraded/raw-markdown website snapshot excluded from clean intelligence (S2-D20)');
A.ok('at least one website snapshot excluded', withDeg.rep.website_snapshots_excluded >= 1);
A.ok('raw markdown dump not shown as clean offer', !/RAW MARKDOWN DUMP/.test(withDeg.rep.notes));

// ---- source_health enforcement + watermark + drift ----
A.section('WF12 — WF16 source_health enforcement in the report (§11.5) + drift proof');
A.eq('source_runs_evaluated=6', noBase.rep.source_runs_evaluated, 6);
A.eq('source_runs_included=1 (only run_healthy)', noBase.rep.source_runs_included, 1);
A.ok('excluded runs listed', /run_quar/.test(noBase.rep.source_runs_excluded) && /run_fixture/.test(noBase.rep.source_runs_excluded));
A.eq('default report_contains_degraded_data=false', noBase.rep.report_contains_degraded_data, false);
const lib = RG.buildEligibility(health, noBase.cfg);
A.eq('included count matches lib', noBase.rep.source_runs_included, lib.eligible_run_ids.length);

const fixRep = buildReport([plan(CUR, NICHE, 5)], [angle(CUR, 34)], { allow_fixture_report: true });
A.section('WF12 — explicit fixture report renders the watermark (§11.7)');
A.eq('is_fixture_report=true', fixRep.rep.is_fixture_report, true);
A.ok('watermark present in markdown', /TEST \/ FIXTURE DATA — NOT PRODUCTION INTELLIGENCE/.test(fixRep.rep.notes));

const degRep = buildReport([plan(CUR, NICHE, 5)], [angle(CUR, 34)], { allow_degraded_report: true });
A.section('WF12 — degraded opt-in renders a visible quality warning');
A.eq('report_contains_degraded_data=true with opt-in', degRep.rep.report_contains_degraded_data, true);
A.ok('quality warning rendered', /QUALITY WARNING/.test(degRep.rep.notes) && /DEGRADED/.test(degRep.rep.quality_warning));

// REPORT-CLEAN-001: the report_markdown is sent VERBATIM to the Telegram user (WF20 deliveryBody), so it must
// carry business content but expose NO internal identifiers, enums, workflow names, run stamps or DEC codes.
A.section('WF12 — REPORT-CLEAN-001: user-facing report_markdown exposes no internal diagnostics');
{
  const md = String(noBase.rep.report_markdown || '');
  const forbidden = [
    [/\bWF\d/, 'workflow name (WFnn)'],
    [/DEC-\d/, 'DEC code'],
    [/rows_after_filters\s*=/, 'rows_after_filters= diagnostic'],
    [/trend_status\s*=/, 'trend_status= enum'],
    [/report_contains_\w+\s*=/, 'report_contains_*= diagnostic'],
    [/outreach_allowed\s*=|review_status\s*=|manual_review|aggregate_only|no_data_notice/, 'internal flag/enum name'],
    [/wf10_\d/, 'wf10_ run stamp'],
    [/report_\d{8}/, 'raw report_id'],
    [/req_\d/, 'request id'],
    [/::/, 'source_run_id family separator'],
    [/executive_digest|competitor_snapshot|top_offers_and_prices|market_angles_summary|source_collection_actions|manager_review_actions|content_actions/, 'english section enum']
  ];
  for (const [re, label] of forbidden) A.ok('no ' + label + ' in user report', !re.test(md));
  // still content-ful: keeps the real business sections + a real competitor name + a source URL.
  A.ok('report still has a competitor section', /Снапшот конкурентов|Топ конкурентов/.test(md));
  A.ok('report still names a real competitor', /Брокер|LionCredit|finance|Кредитн/i.test(md));
}

A.report('wf12-closure');
