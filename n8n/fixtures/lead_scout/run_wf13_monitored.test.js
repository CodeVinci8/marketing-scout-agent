// run_wf13_monitored.test.js — WF13 checks ($0, no network):
//  (1) default fixture-path counters (vector B WF13 side) + Defect C (evidence-based probable_need) + Defect F
//      (audience-only author aggregates);
//  (2) monitored Mode-2 simulation (§5 + §6.4 — 20 cases): group -> posts -> relevant posts -> public comments.
'use strict';
const H = require('./_harness');
const WF13 = H.loadWorkflow('13_public_discussion_or_reviews_connector_foundation.json');

function setCfg(run, overrides) {
  H.runCodeNode(run, WF13, 'Set Connector Config', []);
  if (overrides) Object.assign(run.outputs['Set Connector Config'][0].json, overrides);
  return run.outputs['Set Connector Config'][0].json;
}

// =============================== WF13 default fixture path ======================================
H.section('WF13 default fixture path (Defects C, D, F)');
(function () {
  const r = H.makeRun();
  setCfg(r);
  const it = H.runCodeNode(r, WF13, 'Build Fixture VK Group Items', []);
  H.runCodeNode(r, WF13, 'Normalize VK Items', it);
  H.inject(r, 'Read market_record_registry', []);
  H.runCodeNode(r, WF13, 'Deduplicate Items', r.outputs['Normalize VK Items']);
  H.runCodeNode(r, WF13, 'Build raw_market_records Rows', r.outputs['Deduplicate Items']);
  const fs = H.runCodeNode(r, WF13, 'Final Summary Output', [])[0].json;
  const ar = H.runCodeNode(r, WF13, 'Build agent_requests Row', [])[0].json;
  const norm = r.outputs['Normalize VK Items'].map(i => i.json);

  H.eq('items_received = 9', fs.items_received, 9);
  H.eq('hard_skipped = 1', fs.hard_skipped_items, 1);
  H.eq('unique = 7', fs.unique_count, 7);
  H.eq('raw written = 8', fs.raw_market_records_written, 8);
  H.eq('registry written = 7', fs.registry_rows_written, 7);
  // Defect F: audience authors only (5 consumer comment authors; NOT the broker post + editor post = was 7)
  H.eq('audience_author_count = 5', fs.audience_author_count, 5);
  H.ok('no stale active_author_count key', fs.active_author_count === undefined);
  H.ok('agent_requests result_summary uses audience_author_count', /audience_author_count=5/.test(ar.result_summary));
  // Defect D: handoff -> WF14, not WF08-mandatory
  H.ok('FinalSummary.next_action -> WF14', /WF14/.test(fs.next_action));
  H.ok('FinalSummary.next_action not "run Workflow 08"', !/run Workflow 08/.test(fs.next_action));
  H.ok('agent_requests.next_action -> WF14', /WF14/.test(ar.next_action) && !/run Workflow 08/.test(ar.next_action));
  // Defect C: evidence-based probable_need — business-credit comment must NOT get a refusal hint
  const biz = norm.find(x => /для бизнеса/.test(x.comment_text) && x.record_type_hint === 'question_objection');
  H.ok('business comment found', !!biz, biz && biz.probable_need);
  H.ok('business probable_need is business-financing (NOT refusal)',
    biz && /бизнес/i.test(biz.probable_need) && !/после отказ/i.test(biz.probable_need), biz && biz.probable_need);
  const refusal = norm.find(x => /после отказа двух банков/.test(x.comment_text));
  H.ok('refusal comment keeps refusal hint (evidence present)', refusal && /после отказ/.test(refusal.probable_need));
  const pts = norm.find(x => /под залог ПТС/.test(x.comment_text) && x.record_type_hint === 'question_objection');
  H.eq('PTS comment service_hint = pts_loan', pts && pts.service_hint, 'pts_loan');
})();

// =============================== Monitored Mode-2 simulation ====================================
H.section('Monitored VK simulation (§5 + §6.4 — 20 cases, $0, no network)');
(function () {
  const r = H.makeRun();
  setCfg(r, { monitored_fixture_mode: true });
  const items = H.runCodeNode(r, WF13, 'Monitored VK Engine (inert + fixture sim)', []);
  const st = r.staticData.wf13_monitored;

  // ---- engine counters (deterministic, harness-derived) ----
  H.eq('groups_requested = 4', st.groups_requested, 4);
  H.eq('groups_processed = 4', st.groups_processed, 4);
  H.eq('posts_received = 13', st.posts_received, 13);
  H.eq('structurally_valid_posts = 10', st.structurally_valid_posts, 10);
  H.eq('business_relevant_posts = 7', st.business_relevant_posts, 7);
  H.eq('hard_skipped_posts = 1 (case 15)', st.hard_skipped_posts, 1);
  H.eq('market_signal_posts = 1 (case 8)', st.market_signal_posts, 1);
  H.eq('posts_selected_for_comments = 6', st.posts_selected_for_comments, 6);
  H.eq('comments_disabled_posts = 1 (case 11)', st.comments_disabled_posts, 1);
  H.eq('deleted_posts = 1 (case 12)', st.deleted_posts, 1);
  H.eq('api_errors = 1 (case 13)', st.api_errors, 1);
  H.eq('rate_limit_events = 1 (case 14)', st.rate_limit_events, 1);
  H.eq('duplicate_posts = 1 (case 9)', st.duplicate_posts, 1);
  H.eq('comments_received = 12', st.comments_received, 12);
  H.eq('business_relevant_comments = 6', st.business_relevant_comments, 6);
  H.eq('supplier_comments_skipped = 1 (case 6)', st.supplier_comments_skipped, 1);
  H.eq('admin_comments_skipped = 1 (case 7)', st.admin_comments_skipped, 1);
  H.eq('spam_comments_skipped = 1', st.spam_comments_skipped, 1);
  H.eq('irrelevant_comments_skipped = 2 (case 19)', st.irrelevant_comments_skipped, 2);
  H.eq('duplicate_comments = 1 (case 10)', st.duplicate_comments, 1);
  H.eq('contacts_found = 1 (case 16)', st.contacts_found, 1);
  H.eq('contacts_without_evidence = 1 (case 17)', st.contacts_without_evidence, 1);
  H.eq('unique_count = 8', st.unique_count, 8);
  H.eq('duplicate_count = 2', st.duplicate_count, 2);
  H.eq('run_mode = monitored_fixture_sim', st.run_mode, 'monitored_fixture_sim');
  H.eq('source_cost_usd = 0', st.source_cost_usd, 0);

  // ---- emitted shape ----
  H.eq('emitted items = 8 (2 posts + 6 comments)', items.length, 8);
  H.eq('emitted lead comments = 6', items.filter(i => i.json.item_type === 'comment').length, 6);
  // case 5: comment under an irrelevant ("С днём города") post must NOT be harvested
  H.ok('case 5: irrelevant-post comment not harvested', !items.some(i => /как дела/.test(i.json.text)) && !items.some(i => i.json.comment_id === '9121'));
  // case 17: unprovable contact stripped from emitted text (source-level blank)
  const c17 = items.find(i => i.json.comment_id === '9063');
  H.ok('case 17: unprovable contact found', !!c17);
  H.ok('case 17: phone stripped from emitted text', c17 && !/\+7\s*000\s*000-00-77/.test(c17.json.text));
  // case 16: provable contact retained verbatim
  const c16 = items.find(i => i.json.comment_id === '9061');
  H.ok('case 16: provable contact retained', c16 && /\+7 000 000-00-01/.test(c16.json.text));

  // ---- downstream: engine items -> Normalize -> WF14-ready records ----
  H.runCodeNode(r, WF13, 'Normalize VK Items', items);
  H.inject(r, 'Read market_record_registry', []);
  const dd = H.runCodeNode(r, WF13, 'Deduplicate Items', r.outputs['Normalize VK Items']);
  const norm = r.outputs['Normalize VK Items'].map(i => i.json);
  H.eq('Normalize: 6 audience comments (question_objection)', norm.filter(x => x.record_type_hint === 'question_objection').length, 6);
  H.eq('Normalize: 1 competitor post', norm.filter(x => x.record_type_hint === 'competitor_activity').length, 1);
  H.eq('Normalize: 1 market post', norm.filter(x => x.record_type_hint === 'market_signal').length, 1);
  const uniq = dd.map(i => i.json).filter(x => x.dedup_status === 'unique');
  // case 18: repeat run -> seed registry with this run's keys -> 0 new unique
  const r2 = H.makeRun();
  setCfg(r2);
  H.inject(r2, 'Read market_record_registry', uniq.map(x => ({ dedup_key: x.dedup_key })));
  // re-run dedup over the same normalized items against the seeded registry
  r2.outputs['Normalize VK Items'] = r.outputs['Normalize VK Items'];
  const dd2 = H.runCodeNode(r2, WF13, 'Deduplicate Items', r2.outputs['Normalize VK Items']);
  H.eq('case 18: repeat run writes 0 new unique', dd2.map(i => i.json).filter(x => x.dedup_status === 'unique').length, 0);
})();

const res = H.report('WF13 fixture + monitored simulation');
if (require.main === module) process.exit(res.fail ? 1 : 0);
