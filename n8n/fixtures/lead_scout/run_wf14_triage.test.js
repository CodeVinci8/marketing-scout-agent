// run_wf14_triage.test.js — WF14 Lead Scout deterministic checks ($0, no network).
// Vector A: standalone F1–F10 fixtures -> WF14 (per-scenario classification proof).
// Vector B: WF13 fixture -> raw_market_records -> WF14 (Stage C check C3) + repeat-run dedup.
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./_harness');

const WF13 = H.loadWorkflow('13_public_discussion_or_reviews_connector_foundation.json');
const WF14 = H.loadWorkflow('14_public_lead_signal_triage.json');
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'lead_signals_fixtures.json'), 'utf8'));

// Keep the fixture leads inside WF14's rolling 30-day recency window as wall-clock advances (freshness feeds the
// lead score → high/medium band). Shift every published_at so the MOST RECENT fixture sits ~1 day before "now",
// preserving the relative time structure between leads; an intentionally-stale lead stays proportionally stale.
(function reanchorFixtureDates() {
  const rows = (FIX && FIX.rows) || [];
  const pick = (r) => (r && r.raw && r.raw.published_at != null) ? r.raw : (r || {});
  let maxT = -Infinity;
  rows.forEach(r => { const o = pick(r); const t = Date.parse(o.published_at); if (!isNaN(t)) maxT = Math.max(maxT, t); });
  if (!isFinite(maxT)) return;
  const delta = (Date.now() - 2 * 3600000) - maxT;
  rows.forEach(r => { const o = pick(r); const t = Date.parse(o.published_at); if (!isNaN(t)) o.published_at = new Date(t + delta).toISOString().replace('Z', '+03:00'); });
})();

// ---- run the real WF13 fixture path -> array of raw_market_records json rows ------------------
function runWf13Fixture() {
  const run = H.makeRun();
  H.runCodeNode(run, WF13, 'Set Connector Config', []);
  const items = H.runCodeNode(run, WF13, 'Build Fixture VK Group Items', []);
  H.runCodeNode(run, WF13, 'Normalize VK Items', items);
  H.inject(run, 'Read market_record_registry', []);
  H.runCodeNode(run, WF13, 'Deduplicate Items', run.outputs['Normalize VK Items']);
  const raw = H.runCodeNode(run, WF13, 'Build raw_market_records Rows', run.outputs['Deduplicate Items']);
  const summary = H.runCodeNode(run, WF13, 'Final Summary Output', []);
  return { rawRows: raw.map(i => i.json), summary: summary[0].json, run };
}

// ---- run the real WF14 triage path ------------------------------------------------------------
function runWf14(rawRows, existingRows, reviewRows) {
  const run = H.makeRun();
  H.runCodeNode(run, WF14, 'Set Triage Config', []);
  H.inject(run, 'Read review_queue', reviewRows || []);
  H.inject(run, 'Read raw_market_records', rawRows || []);
  H.inject(run, 'Read public_lead_signals', existingRows || []);
  const classified = H.runCodeNode(run, WF14, 'Build Candidate Pool & Classify', []);
  const noSignals = classified.length === 1 && classified[0].json._no_signals === true;
  const signals = noSignals ? [] : classified.map(i => i.json);
  const agentReq = H.runCodeNode(run, WF14, 'Build agent_requests Row', classified)[0].json;
  const summary = H.runCodeNode(run, WF14, 'Final Summary Output', classified)[0].json;
  return { signals, agentReq, summary };
}

function band(signals, b) { return signals.filter(s => s.review_priority === b).length; }

// =============================== VECTOR A ======================================================
H.section('Vector A — standalone F1–F10 -> WF14 (empty public_lead_signals)');
const rawA = FIX.rows.map(r => r.raw);
const A = runWf14(rawA, [], []);
H.eq('A candidates_considered = 9', A.summary.candidates_considered, 9);
H.eq('A signals_written = 7', A.signals.length, 7);
H.eq('A priority high = 3', band(A.signals, 'high'), 3);
H.eq('A priority medium = 2', band(A.signals, 'medium'), 2);
H.eq('A priority low = 2', band(A.signals, 'low'), 2);
H.eq('A duplicates_skipped = 1', A.summary.duplicates_skipped, 1);
H.eq('A irrelevant_skipped = 1', A.summary.irrelevant_skipped, 1);
H.eq('A supplier_skipped = 0', A.summary.supplier_skipped, 0);
H.eq('A contacts_found_public = 2', A.summary.contacts_found_public, 2);
H.eq('A contacts_blank_due_to_policy = 1', A.summary.contacts_blank_due_to_policy, 1);
H.ok('A outreach_allowed=false on every row', A.signals.every(s => s.outreach_allowed === false));
H.ok('A recommended_action in allowed set', A.signals.every(s => ['manual_review', 'content_idea', 'monitor', 'ignore'].includes(s.recommended_action)));
H.ok('A self_test_passed', A.summary.self_test_passed === true);
// Closure C1-D4 / S?: successful write must NOT leave an ambiguous empty zero_write_reason.
H.eq('A zero_write_reason = not_applicable (successful write)', A.summary.zero_write_reason, 'not_applicable');
H.ok('A zero_write_reason is non-empty', String(A.summary.zero_write_reason).length > 0);
// Defect B (service_type) — F2 = PTS, F5 = business
const f2 = A.signals.find(s => /ПТС/.test(s.evidence_text || ''));
const f5 = A.signals.find(s => /бизнеса/.test(s.evidence_text || ''));
H.ok('A F2 found', !!f2, f2 && f2.service_type);
H.eq('A F2 service_type = pts_loan', f2 && f2.service_type, 'pts_loan');
H.eq('A F5 service_type = business_credit', f5 && f5.service_type, 'business_credit');
// F10 contact blanked -> do_not_use + privacy flag
const f10 = A.signals.find(s => /000-00-10/.test(JSON.stringify(s)) || (/после отказа/.test(s.evidence_text || '') && !s.source_post_url));
H.ok('A F10 found', !!f10);
H.eq('A F10 public_contact_type empty', f10 && f10.public_contact_type, '');
H.eq('A F10 contact_use_policy = do_not_use', f10 && f10.contact_use_policy, 'do_not_use');
H.ok('A F10 privacy_flags contact_blanked_no_source_url', f10 && /contact_blanked_no_source_url/.test(f10.privacy_flags));

// =============================== VECTOR B ======================================================
H.section('Vector B — WF13 fixture -> raw_market_records -> WF14 (Stage C / C3)');
const wf13 = runWf13Fixture();
H.eq('WF13 items_received = 9', wf13.summary.items_received, 9);
H.eq('WF13 hard_skipped = 1', wf13.summary.hard_skipped_items, 1);
H.eq('WF13 unique = 7', wf13.summary.unique_count, 7);
H.eq('WF13 duplicate_in_batch = 1', wf13.summary.duplicate_count, 1);
H.eq('WF13 raw rows written = 8', wf13.summary.raw_market_records_written, 8);
H.eq('WF13 registry rows written = 7', wf13.summary.registry_rows_written, 7);

const B = runWf14(wf13.rawRows, [], []);
H.eq('B candidates_considered = 6', B.summary.candidates_considered, 6);
H.eq('B signals_written = 5', B.signals.length, 5);
H.eq('B priority high = 2', band(B.signals, 'high'), 2);
H.eq('B priority medium = 2', band(B.signals, 'medium'), 2);
H.eq('B priority low = 1', band(B.signals, 'low'), 1);
H.eq('B irrelevant_skipped = 1', B.summary.irrelevant_skipped, 1);
H.eq('B contacts_found_public = 2', B.summary.contacts_found_public, 2);
H.eq('B contacts_blank_due_to_policy = 0', B.summary.contacts_blank_due_to_policy, 0);
H.ok('B outreach_allowed=false everywhere', B.signals.every(s => s.outreach_allowed === false));
// Defect B end-to-end: the PTS lead must classify as pts_loan even though WF13 emitted service_hint=unknown
const bp = B.signals.find(s => /ПТС/.test(s.evidence_text || ''));
H.ok('B PTS lead found', !!bp, bp && JSON.stringify({ service_type: bp.service_type, service_hint_via_raw: true }));
H.eq('B PTS service_type = pts_loan (NOT unknown)', bp && bp.service_type, 'pts_loan');
const bbiz = B.signals.find(s => /бизнеса/.test(s.evidence_text || ''));
H.eq('B business lead service_type = business_credit', bbiz && bbiz.service_type, 'business_credit');

// =============================== VECTOR B — repeat (dedup) =====================================
H.section('Vector B repeat — dedup + zero-write diagnosis');
const Brep = runWf14(wf13.rawRows, B.signals, []);
H.eq('B-repeat signals_written = 0', Brep.signals.length, 0);
H.eq('B-repeat duplicates_skipped = 5', Brep.summary.duplicates_skipped, 5);
// Defect E: the zero-write diagnosis must name successful dedup, NOT suggest lowering thresholds.
H.ok('B-repeat next_action names dedup / already-exist',
  /dedup|already exist|already present|уже|существ/i.test(String(Brep.summary.next_action)));
H.ok('B-repeat next_action does NOT suggest lowering min_lead_score',
  !/lower\s+min_lead_score|снизить\s+min_lead_score|lower the threshold/i.test(String(Brep.summary.next_action)),
  String(Brep.summary.next_action));
// Closure C1-D4: zero-write run must carry an explicit (non-empty) reason from the allowed set.
H.eq('B-repeat zero_write_reason = all_eligible_already_exist', Brep.summary.zero_write_reason, 'all_eligible_already_exist');
H.ok('B-repeat zero_write_reason in allowed enum',
  ['all_eligible_already_exist', 'no_eligible_records', 'no_source_rows', 'no_audience_rows', 'below_threshold',
    'supplier_excluded', 'none_relevant', 'append_cap', 'no_new_signals', 'quality_gate_blocked', 'validation_failed']
    .includes(String(Brep.summary.zero_write_reason)));

const r = H.report('WF14 triage (vectors A + B + repeat)');
if (require.main === module) process.exit(r.fail ? 1 : 0);
module.exports = { runWf13Fixture, runWf14 };
