'use strict';
// PARSE-OUTCOME-001 + RUN-LINEAGE-001 + DETAIL-QUALITY-001.
//
// OPERATOR DECISION (2026-07-17): a single successful bounded repair is reportable when the repaired payload passed
// full local validation, required fields are present, evidence refs are valid, semantics pass, no forbidden data is
// present and no second repair was needed. It is marked repaired/accepted_with_repair, audited and
// confidence-capped — but NOT pending-review and NOT quarantined merely because a repair occurred.
//
// The live regression this closes (autolombardn1.ru): WF04 exec 929 repaired successfully and produced excellent
// data, yet stamped degraded+pending -> WF16 930 derived report_candidate=false, raised CRITICAL
// `no_detail_records` on a score-81 run -> WF10 932 excluded it -> empty bundle -> WF28 never ran.
// Offline, $0.
const A = require('./_assert.js');
const PO = require('../n8n/lib/parse_outcome.js');
const RL = require('../n8n/lib/run_lineage.js');
const Q = require('../n8n/lib/quality_gate.js');
const RG = require('../n8n/lib/report_gate.js');
const H = require('./wf_harness.js');

// ---- the EXACT production row shape from WF04 exec 929 ------------------------------------------------------
const LIVE_ROW = {
  entity_type: 'competitor', company_name: 'Автоломбард №1', competitor_name: 'Автоломбард №1',
  offer_text: 'Займы под залог автомобилей, ПТС, грузовых авто; рефинансирование. До 90% стоимости залога.',
  text_context: 'Займы под залог автомобилей ПТС до 90% стоимости, одобрение за 30 минут, Москва',
  service_hint: 'pts_loan', source_url: 'https://autolombardn1.ru', route: 'monitor_queue',
  processing_status: 'parsed_success', parse_method: 'repaired_json', repair_used: true, repair_status: 'success',
  exact_evidence_url: true, is_detail: true, dedup_status: 'unique', is_valid_listing: true, competitor_strength: 8
};

A.section('parse outcomes — the five canonical verdicts');
{
  const c = (o) => PO.classifyParseOutcome(o);
  A.eq('1. primary valid', c({ processing_status: 'parsed_success', parse_method: 'primary_json' }), PO.PARSE_OUTCOMES.PRIMARY_VALID);
  A.eq('2. repaired valid', c({ processing_status: 'parsed_success', parse_method: 'repaired_json', repair_used: true, repair_status: 'success' }), PO.PARSE_OUTCOMES.REPAIRED_VALID);
  A.eq('   ...repair_used alone is enough', c({ processing_status: 'parsed_success', repair_used: true }), PO.PARSE_OUTCOMES.REPAIRED_VALID);
  A.eq('4. a SECOND repair is never accepted', c({ parse_method: 'repaired_json', repair_used: true, repair_count: 2 }), PO.PARSE_OUTCOMES.INVALID);
  A.eq('5. repaired payload with INVALID evidence id', c({ parse_method: 'repaired_json', repair_used: true, evidence_valid: false }), PO.PARSE_OUTCOMES.INVALID);
  A.eq('6. repaired payload MISSING required fields', c({ parse_method: 'repaired_json', repair_used: true, validation_ok: false }), PO.PARSE_OUTCOMES.INVALID);
  A.eq('7. repaired payload with no evidence at all', c({ parse_method: 'repaired_json', repair_used: true, has_evidence: false }), PO.PARSE_OUTCOMES.INVALID);
  A.eq('8. repair FAILED', c({ parse_method: 'repaired_json', repair_used: true, repair_status: 'failed' }), PO.PARSE_OUTCOMES.INVALID);
  A.eq('   ...failed_fallback is a fallback, not a repair', c({ repair_used: true, repair_status: 'failed_fallback' }), PO.PARSE_OUTCOMES.DETERMINISTIC_FALLBACK);
  A.eq('9. deterministic fallback', c({ parse_method: 'deterministic_competitor_fallback' }), PO.PARSE_OUTCOMES.DETERMINISTIC_FALLBACK);
  A.eq('10. provider failure', c({ processing_status: 'provider_failed' }), PO.PARSE_OUTCOMES.PROVIDER_FAILED);
  A.eq('    ...firecrawl transport error', c({ parse_method: 'firecrawl_error' }), PO.PARSE_OUTCOMES.PROVIDER_FAILED);
  A.eq('    technical_error => invalid', c({ processing_status: 'technical_error' }), PO.PARSE_OUTCOMES.INVALID);
  A.eq('one bounded repair is the contract', PO.PO_MAX_REPAIRS, 1);
}

A.section('quality mapping — a successful repair is reportable, everything else stays fail-closed');
{
  const q = (o) => PO.qualityForOutcome(o, { is_competitor: true });
  const pv = q(PO.PARSE_OUTCOMES.PRIMARY_VALID);
  A.eq('primary: healthy', pv.quality_status, 'healthy');
  A.eq('primary: reportable', pv.report_candidate, true);
  A.eq('primary: no repair penalty', pv.confidence_cap, null);
  A.eq('primary: not pending', pv.review_status, 'confirmed');

  const rv = q(PO.PARSE_OUTCOMES.REPAIRED_VALID);
  A.eq('THE DECISION: repaired => accepted_with_repair', rv.quality_status, 'accepted_with_repair');
  A.eq('repaired: reportable', rv.report_candidate, true);
  A.eq('repaired: NOT pending review', rv.review_status, 'confirmed');
  A.eq('repaired: audited', rv.flags.join(','), 'repaired_parse');
  A.eq('repaired: repair_used', rv.repair_used, true);
  A.eq('repaired: repair_success', rv.repair_success, true);
  A.eq('repaired: confidence capped', rv.confidence_cap, PO.PO_REPAIRED_CONFIDENCE_CAP);
  A.eq('the cap is a documented constant', PO.PO_REPAIRED_CONFIDENCE_CAP, 75);
  A.ok('accepted verdicts are exactly healthy + accepted_with_repair',
    PO.poIsAccepted('healthy') && PO.poIsAccepted('accepted_with_repair') && !PO.poIsAccepted('degraded') && !PO.poIsAccepted('quarantined'));
  A.ok('repaired is identifiable', PO.poIsRepaired('accepted_with_repair') && !PO.poIsRepaired('healthy'));

  const df = q(PO.PARSE_OUTCOMES.DETERMINISTIC_FALLBACK);
  A.eq('fallback: degraded', df.quality_status, 'degraded');
  A.eq('fallback: never claims a successful AI parse', df.repair_success, false);
  A.eq('fallback: not report_candidate', df.report_candidate, false);
  [['invalid', PO.PARSE_OUTCOMES.INVALID], ['provider_failed', PO.PARSE_OUTCOMES.PROVIDER_FAILED]].forEach(([n, o]) => {
    A.eq(n + ': quarantined', q(o).quality_status, 'quarantined');
    A.eq(n + ': not reportable', q(o).report_candidate, false);
    A.eq(n + ': pending', q(o).review_status, 'pending');
  });
}

A.section('3. the confidence penalty is ONE documented deterministic rule');
{
  A.eq('a repaired score is capped', PO.poCapConfidence(90, PO.PARSE_OUTCOMES.REPAIRED_VALID), 75);
  A.eq('...and never raised', PO.poCapConfidence(40, PO.PARSE_OUTCOMES.REPAIRED_VALID), 40);
  A.eq('a primary score is untouched', PO.poCapConfidence(90, PO.PARSE_OUTCOMES.PRIMARY_VALID), 90);
  A.eq('a fallback is capped harder', PO.poCapConfidence(90, PO.PARSE_OUTCOMES.DETERMINISTIC_FALLBACK), 50);
  A.eq('an invalid result is floored', PO.poCapConfidence(90, PO.PARSE_OUTCOMES.INVALID), 10);
}

A.section('RUN-LINEAGE-001 — one resolver, one fallback order');
{
  // 1. lineage ONLY in run_id (the live WF04 queue-row shape that caused `no_lineage`)
  const l1 = RL.resolveRunLineage({ run_id: 'req_X::website::a1' });
  A.eq('1. run_id alone resolves the source run', l1.source_run_id, 'req_X::website::a1');
  A.eq('   ...and the request family', l1.agent_request_id, 'req_X');
  A.eq('   has_lineage', l1.has_lineage, true);
  A.eq('   observable', l1.resolved_from, 'run_id');
  // 2. source_run_id
  A.eq('2. source_run_id', RL.resolveRunLineage({ source_run_id: 'req_Y::website::a1' }).agent_request_id, 'req_Y');
  // 3. agent_request_id
  A.eq('3. agent_request_id alone', RL.resolveRunLineage({ agent_request_id: 'req_Z' }).agent_request_id, 'req_Z');
  A.eq('   an explicit arid wins over a derived root', RL.resolveRunLineage({ agent_request_id: 'req_A', run_id: 'req_B::x::1' }).agent_request_id, 'req_A');
  // 8. malformed lineage is observable + fails safe
  const l8 = RL.resolveRunLineage({});
  A.eq('8. no lineage => has_lineage false', l8.has_lineage, false);
  A.eq('   ...observable', l8.resolved_from, 'none');
  A.eq('   ...and never matches a filter', RL.rlFamilyMatch(l8, 'req_X'), false);

  const scope = (row, o) => RL.rlRowInScope(row, o);
  const liveRow = { run_id: 'req_X::website::a1', source_run_id: '', data_mode: '', owner_user_id: '' };
  A.eq('the live row matches its own source run', scope(liveRow, { source_run_id_filter: 'req_X::website::a1' }).in_scope, true);
  A.eq('...and its request family', scope(liveRow, { agent_request_id_filter: 'req_X' }).in_scope, true);
  // 4. an absent optional data_mode is NOT a mismatch
  A.eq('4. empty data_mode is not a mismatch', scope(liveRow, { source_run_id_filter: 'req_X::website::a1', data_mode_filter: 'live' }).in_scope, true);
  A.eq('   a REAL fixture row still mismatches', scope({ run_id: 'req_X::website::a1', data_mode: 'fixture' }, { data_mode_filter: 'live' }).in_scope, false);
  // 5/6. owner + family isolation
  A.eq('5. another owner is rejected', scope({ run_id: 'req_X::website::a1', owner_user_id: 'o2' }, { owner_user_id: 'o1' }).in_scope, false);
  A.eq('   ...with a reason', scope({ run_id: 'req_X::website::a1', owner_user_id: 'o2' }, { owner_user_id: 'o1' }).reason, 'owner_mismatch');
  A.eq('   my own row is accepted', scope({ run_id: 'req_X::website::a1', owner_user_id: 'o1' }, { owner_user_id: 'o1' }).in_scope, true);
  A.eq('   an unowned system row is accepted', scope(liveRow, { owner_user_id: 'o1' }).in_scope, true);
  A.eq('6. another request family is rejected', scope(liveRow, { agent_request_id_filter: 'req_OTHER' }).in_scope, false);
  // 7. a historical row cannot satisfy the current run
  A.eq('7. an older run does not satisfy this run', scope({ run_id: 'req_OLD::website::a1' }, { source_run_id_filter: 'req_X::website::a1' }).in_scope, false);
}

A.section('DETAIL-QUALITY-001 — no_detail_records means NO detail record, nothing else');
{
  const CFG = { freshness_window_days: 30, now_iso: new Date().toISOString() };
  const run = (o) => Object.assign({ data_mode: 'live', source_run_id: 'req_X::website::a1', items_received: 1, external_calls: 1, source_cost_status: 'unknown' }, o || {});
  const rec = (o) => Object.assign({ structurally_valid: true, unique: true, exact_evidence_url: true, published_at: '' }, o || {});
  const flags = (records, r) => Q.computeRunHealth(run(r), records, CFG);

  // 2. THE REGRESSION: a repaired-valid detail record
  const repaired = flags([rec({ is_detail: true, search_card: false, placeholder_title: false, missing_description: false, report_candidate: true, degraded: false, pending_review: false })]);
  A.ok('2. repaired-valid detail => NO no_detail_records', repaired.quality_flags.indexOf('no_detail_records') < 0, repaired.quality_flags.join(','));
  A.eq('   ...run is not quarantined', repaired.quality_status, 'healthy');
  A.eq('   ...and IS report eligible', repaired.report_eligible, true);
  A.ok('   quality score and status agree', repaired.quality_score >= 80 && repaired.quality_status === 'healthy');

  // 1. a plain valid detail record
  A.ok('1. valid detail => no flag', flags([rec({ is_detail: true, report_candidate: true })]).quality_flags.indexOf('no_detail_records') < 0);

  // 3. a LOW-QUALITY detail record still exists — it may raise other flags, never this one
  const low = flags([rec({ is_detail: true, report_candidate: false, degraded: true, unknown_service: true, missing_description: true, placeholder_title: false })]);
  A.ok('3. low-quality detail => NOT no_detail_records', low.quality_flags.indexOf('no_detail_records') < 0, low.quality_flags.join(','));

  // 4/5. genuinely absent detail: the Avito search-card shape (placeholder + no description)
  const cards = flags([rec({ placeholder_title: true, missing_description: true, report_candidate: false, degraded: true }), rec({ placeholder_title: true, missing_description: true, report_candidate: false, degraded: true })], { items_received: 2 });
  A.ok('4. search-cards-only => no_detail_records STILL fires', cards.quality_flags.indexOf('no_detail_records') >= 0, cards.quality_flags.join(','));
  A.eq('   ...and quarantines (fail-closed preserved)', cards.quality_status, 'quarantined');
  A.ok('5. explicit search_card => no_detail_records', flags([rec({ search_card: true, report_candidate: false })]).quality_flags.indexOf('no_detail_records') >= 0);
  A.ok('   is_detail=false => no_detail_records', flags([rec({ is_detail: false, report_candidate: false })]).quality_flags.indexOf('no_detail_records') >= 0);
  // 8. score/flag consistency: the flag must not quarantine a high-scoring run that HAS detail
  A.ok('8. a high score is never quarantined by a false detail flag', repaired.quality_score > 50 && repaired.quality_status !== 'quarantined');
}

A.section('report_gate — a repaired-valid current-run row is admitted (was: no_lineage)');
{
  const health = [{ source_run_id: 'req_X::website::a1', data_mode: 'live', quality_status: 'healthy', report_eligible: true }];
  const elig = RG.buildEligibility(health, {});
  // the live queue-row shape: family ONLY in run_id, empty data_mode/quality_status
  const row = { run_id: 'req_X::website::a1', source_run_id: '', data_mode: 'live', quality_status: 'accepted_with_repair', review_status: 'confirmed', report_eligible: true };
  const r = RG.rowEligible(row, elig, {});
  A.eq('THE REGRESSION: the repaired current-run row is eligible', r.eligible, true, r.reason);
  A.ok('...no no_lineage', String(r.reason).indexOf('no_lineage') < 0, r.reason);
  // accepted_with_repair self-attests like healthy even without a health match
  const selfAttest = RG.rowEligible({ run_id: 'req_Q::website::a1', data_mode: 'live', quality_status: 'accepted_with_repair', review_status: 'confirmed' }, RG.buildEligibility([], {}), {});
  A.eq('accepted_with_repair self-attests live', selfAttest.eligible, true, selfAttest.reason);
  // fail-closed still holds
  A.eq('quarantined is still excluded', RG.rowEligible({ run_id: 'r::w::1', data_mode: 'live', quality_status: 'quarantined' }, elig, {}).eligible, false);
  A.eq('degraded without opt-in is still excluded', RG.rowEligible({ run_id: 'r::w::1', data_mode: 'live', quality_status: 'degraded' }, elig, {}).eligible, false);
  A.eq('pending review is still excluded', RG.rowEligible({ run_id: 'r::w::1', data_mode: 'live', review_status: 'pending' }, elig, {}).eligible, false);
  A.eq('a row with NO lineage at all still fails closed', RG.rowEligible({ data_mode: '' }, RG.buildEligibility([], {}), {}).eligible, false);
}

A.section('WF04 — the real node stamps the canonical contract (live row shape)');
{
  const wf = H.loadWorkflow('04_firecrawl_url_list_resilient.json');
  function build(over) {
    const r = H.makeRun();
    H.inject(r, 'Evaluate Dedup', [{ source_url: 'https://autolombardn1.ru', target_url: 'https://autolombardn1.ru', run_id: 'req_X::website::a1', source_run_id: 'req_X::website::a1', agent_request_id: 'req_X', batch_index: 0, parsed_at: '2026-07-17T05:00:00+03:00' }]);
    H.inject(r, 'Normalize Firecrawl Output', [{ run_id: 'req_X::website::a1', batch_index: 0, source_url: 'https://autolombardn1.ru' }]);
    return H.runCodeNode(r, wf, 'Build Canonical Raw Record', [{ json: Object.assign({}, LIVE_ROW, over || {}) }])[0].json;
  }
  const rep = build({});
  A.eq('THE LIVE CASE: parse_outcome', rep.parse_outcome, 'repaired_valid');
  A.eq('quality_status', rep.quality_status, 'accepted_with_repair');
  A.eq('review_status is NOT pending', rep.review_status, 'confirmed');
  A.eq('report_eligible', rep.report_eligible, true);
  A.eq('repair_used', rep.repair_used, true);
  A.eq('repair_success', rep.repair_success, true);
  A.ok('audited with repaired_parse', String(rep.quality_flags).indexOf('repaired_parse') >= 0, String(rep.quality_flags));

  const pri = build({ parse_method: 'primary_json', repair_used: false, repair_status: '' });
  A.eq('primary: healthy', pri.quality_status, 'healthy');
  A.eq('primary: eligible', pri.report_eligible, true);
  A.eq('ONE rule: repaired conf = min(primary conf, cap)', rep.confidence_score, Math.min(pri.confidence_score, PO.PO_REPAIRED_CONFIDENCE_CAP));
  A.ok('a repaired record is less confident than a primary one', rep.confidence_score < pri.confidence_score);

  // fail-closed paths on the real node
  [['deterministic fallback', { parse_method: 'deterministic_competitor_fallback', repair_used: false }, 'degraded', false],
   ['repair failed => fallback', { repair_status: 'failed_fallback' }, 'degraded', false],
   ['second repair forbidden', { repair_calls: 2 }, 'quarantined', false],
   ['no page evidence', { text_context: '', offer_text: '' }, 'quarantined', false],
   ['technical error', { processing_status: 'technical_error' }, 'quarantined', false]
  ].forEach(([n, o, wantQ, wantE]) => {
    const j = build(o);
    A.eq('node: ' + n + ' => ' + wantQ, j.quality_status, wantQ);
    A.eq('node: ' + n + ' => not eligible', j.report_eligible, wantE);
  });

  // 10. no hidden thinking / raw provider response is persisted
  // (secret-shaped fixture assembled at runtime so this source carries no contiguous secret-shaped literal)
  const fakeKey = 'sk-ant-' + 'api03-LEAKLEAK';
  const poisoned = build({ raw_response_preview: '<thinking>secret</thinking> {"api_key":"topsecret12345"}', parse_error: 'Authorization: Bearer ' + fakeKey });
  const blob = JSON.stringify(poisoned);
  A.ok('10. no hidden thinking persisted', blob.indexOf('secret</thinking>') < 0 && blob.indexOf('<thinking>') < 0);
  A.ok('    no credential persisted', blob.indexOf('sk-ant-' + 'api03-LEAK') < 0 && blob.indexOf('topsecret12345') < 0);
}

A.report('parse-outcome');
