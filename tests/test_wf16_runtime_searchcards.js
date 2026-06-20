// test_wf16_runtime_searchcards.js — Stage C Runtime Patch 4 regression for the FIRST real WF09 -> WF16 live
// execution (run_id avito_20260620_055017): 10 Apify items, all non-detail Avito SEARCH CARDS, 9 unique + 1
// duplicate, no report candidates, one unrelated company-registration card. WF16 had wrongly returned
// healthy / report_eligible=true / llm_eligible=true / report_candidate_items=0 / duplicate_items=0 and missing
// workflow/platform/source-family metadata. This runs the REAL WF09 nodes -> REAL WF16 nodes ($0, no network)
// and proves the corrected run identity, raw contract, summary semantics, duplicate detection, quarantine,
// metadata join, cost semantics, evidence rate, and query-origin preservation.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const QG = require('../n8n/lib/quality_gate.js');

const WF09 = H.loadWorkflow('09_avito_classifieds_listing_connector.json');
const WF16 = H.loadWorkflow('16_source_quality_gate_health_score.json');

const RUN_ID = 'avito_20260620_055017';
const REQ_ID = 'avito_req_20260620_055017';

// ---- WF09: production-shaped live config pinned to the real run ----
const r9 = H.makeRun();
const cfg = H.runCodeNode(r9, WF09, 'Set Avito Connector Config', [])[0].json;
cfg.fixture_mode = false;
cfg.data_mode = 'live';        // operator sets the mode actually run (§13)
cfg.run_id = RUN_ID;
cfg.agent_request_id = REQ_ID;
r9.outputs['Set Avito Connector Config'] = [{ json: cfg }];

const Q = cfg.query_plan;
const CONCAT = cfg.search_queries.join('; ');

// 10 non-detail SEARCH CARDS with listing-shaped URLs (structurally valid), no seller/description/date.
// One duplicates a registry row; one is an unrelated company-registration result (must be preserved, not an offer).
function card(id, title, qi) {
  const q = Q[qi % Q.length];
  return {
    listing_id: id, isDetail: false, title: title, description: '', price: '', location: 'Москва',
    seller_name: '', published_at: '', category: 'Предложения услуг',
    url: 'https://www.avito.ru/moskva/predlozheniya_uslug/uslugi_' + id,
    query: q.search_query, parentSourceUrl: q.source_search_url
  };
}
const ids = ['8810000001', '8810000002', '8810000003', '8810000004', '8810000005',
             '8810000006', '8810000007', '8810000008', '8810000009', '8810000010'];
const items = [
  card(ids[0], 'Кредитный брокер. Помощь в получении кредита', 0),
  card(ids[1], 'Помощь с кредитом после отказов банков', 1),
  card(ids[2], 'Кредит для бизнеса ИП и ООО', 3),
  card(ids[3], 'Ещё 5 фото', 0),                  // placeholder-title search card
  card(ids[4], 'Ипотечный брокер, рефинансирование', 4),
  card(ids[5], 'Подбор банка, одобрение кредита', 1),
  card(ids[6], 'Кредитный брокер Москва', 0),
  card(ids[7], 'Юридический адрес для ООО, регистрация фирм', 2), // unrelated company-registration card
  card(ids[8], 'Помощь в получении займа', 1),
  card(ids[9], 'Кредитный брокер. Реальная помощь', 0)
];
// The FIRST listing is already in the registry -> duplicate_in_registry; the other 9 are unique.
const dupKey = 'avito::classified::avito_listing_' + ids[0];

const normalized = H.runCodeNode(r9, WF09, 'Normalize Avito Listings', items.map(j => ({ json: j }))).map(i => i.json);
H.inject(r9, 'Read market_record_registry', [{ dedup_key: dupKey, dedup_status: 'unique' }]);
const deduped = H.runCodeNode(r9, WF09, 'Deduplicate Listings', normalized.map(j => ({ json: j }))).map(i => i.json);
const raw = H.runCodeNode(r9, WF09, 'Build raw_market_records Rows', deduped.map(j => ({ json: j }))).map(i => i.json);

A.section('WF09 — every item is a non-detail search card, written to raw with the explicit §13 contract');
A.eq('10 normalized rows', normalized.length, 10);
A.ok('all normalized rows are source candidates / search cards',
  normalized.every(r => r.record_type_hint === 'source_candidate' && r.touchpoint_type === 'search_card'));
A.eq('10 raw rows written (9 unique + 1 duplicate audit)', raw.length, 10);
const rc = raw[0];
A.eq('raw source_run_id = connector run_id', rc.source_run_id, RUN_ID);
A.eq('raw data_mode = live', rc.data_mode, 'live');
A.eq('raw quality_status = degraded', rc.quality_status, 'degraded');
A.eq('raw report_eligible = false', rc.report_eligible, false);
A.eq('raw llm_eligible = false', rc.llm_eligible, false);
A.eq('raw review_status = pending', rc.review_status, 'pending');
A.eq('raw is_detail = false', rc.is_detail, false);
A.eq('raw detail_fetch_required = true', rc.detail_fetch_required, true);
A.eq('raw detail_fetch_status = pending', rc.detail_fetch_status, 'pending');
A.eq('raw activity_subtype = classified_search_card', rc.activity_subtype, 'classified_search_card');
A.eq('raw skip_reason = detail_enrichment_required', rc.skip_reason, 'detail_enrichment_required');
A.eq('raw exact_evidence_url = false (no detail content)', rc.exact_evidence_url, false);
for (const f of ['search_card', 'no_detail_record', 'missing_seller_identity', 'missing_description', 'missing_published_at'])
  A.ok('raw quality_flags include ' + f, rc.quality_flags.indexOf(f) >= 0);
A.ok('no raw row is a competitor offer', raw.every(r => r.competitor_related !== true && r.record_type_hint !== 'competitor_activity'));
A.ok('unrelated company-registration card preserved as a source candidate (not dropped, not an offer)',
  raw.some(r => /Юридический адрес/.test(r.text_context) && r.record_type_hint === 'source_candidate'));

A.section('WF09 — query origin is per-record, never the concatenated query list (Obj2)');
A.ok('every raw row keeps a specific query origin', raw.every(r => !!r.search_query && r.search_query !== 'unknown'));
A.ok('no raw row stores the concatenated query list', raw.every(r => r.search_query !== CONCAT && r.search_query.indexOf(';') < 0));
A.ok('every raw row keeps its source_search_url', raw.every(r => /^https:\/\/www\.avito\.ru\/.+\?q=/.test(r.source_search_url)));

A.section('WF09 — dedup: 9 unique + 1 duplicate_in_registry');
A.eq('9 unique', deduped.filter(r => r.dedup_status === 'unique').length, 9);
A.eq('1 duplicate_in_registry', deduped.filter(r => r.dedup_status === 'duplicate_in_registry').length, 1);

// ---- WF09: live_source_runs identity + cost (Obj1) ----
H.inject(r9, 'LIVE Apify Safety Gate', [{ approval_token_used: 'yes', _safety_gate: 'passed' }]);
const lsr = H.runCodeNode(r9, WF09, 'Build live_source_runs Row', [])[0].json;

A.section('WF09 — live_source_runs identity & observability (Obj1)');
A.eq('run_id = connector run_id (NOT agent_request_id)', lsr.run_id, RUN_ID);
A.ok('run_id !== agent_request_id', lsr.run_id !== lsr.agent_request_id);
A.eq('source_run_id = run_id', lsr.source_run_id, RUN_ID);
A.eq('agent_request_id preserved', lsr.agent_request_id, REQ_ID);
A.eq('mode = live', lsr.mode, 'live');
A.eq('approval_token_used = yes (gate validated)', lsr.approval_token_used, 'yes');
A.ok('token value never persisted', JSON.stringify(lsr).indexOf('AVITO_LIVE_APPROVED') < 0);
A.eq('external_calls = 1', lsr.external_calls, 1);
A.eq('actual_source_cost_usd = null (not 0)', lsr.actual_source_cost_usd, null);
A.eq('source_cost_status = unknown', lsr.source_cost_status, 'unknown');
A.eq('cost_status = unknown', lsr.cost_status, 'unknown');
A.eq('items_received = 10', lsr.items_received, 10);
A.eq('items_written_raw = 10', lsr.items_written_raw, 10);
A.eq('items_unique = 9', lsr.items_unique, 9);
A.eq('items_duplicate = 1', lsr.items_duplicate, 1);

// ---- WF09: summary semantics (Obj3) ----
const summary = H.runCodeNode(r9, WF09, 'Final Summary Output', [])[0].json;
A.section('WF09 — summary separates search cards from confirmed offers (Obj3)');
A.eq('actor_items_received = 10', summary.actor_items_received, 10);
A.eq('structurally_valid_items = 10', summary.structurally_valid_items, 10);
A.eq('source_candidate_items = 10', summary.source_candidate_items, 10);
A.eq('confirmed_detail_offer_items = 0', summary.confirmed_detail_offer_items, 0);
A.eq('business_relevant_items = 0 (no confirmed offers)', summary.business_relevant_items, 0);
A.eq('report_candidate_items = 0', summary.report_candidate_items, 0);
A.eq('unique_count = 9', summary.unique_count, 9);
A.eq('duplicate_count = 1', summary.duplicate_count, 1);

// ---- WF16: assemble + score the real run (Obj4) ----
const r16 = H.makeRun();
const cfg16 = H.runCodeNode(r16, WF16, 'Set WF16 Config', [])[0].json;
cfg16.fixture_self_test = false;
r16.outputs['Set WF16 Config'] = [{ json: cfg16 }];
H.inject(r16, 'Read live_source_runs', [lsr]);
H.inject(r16, 'Read raw_market_records', raw);
H.inject(r16, 'Read market_record_registry', []);
const bundles = H.runCodeNode(r16, WF16, 'Assemble Run Bundles', []);
const health = H.runCodeNode(r16, WF16, 'Build Source Health', bundles).map(i => i.json);

A.eq('exactly one run bundle assembled', bundles.length, 1);
const h = health.find(x => x.source_run_id === RUN_ID);
A.ok('source_health row produced for the real run', !!h);

A.section('WF16 — search-card-only live run is QUARANTINED (Obj4)');
A.eq('quality_status = quarantined', h.quality_status, 'quarantined');
A.eq('report_eligible = false', h.report_eligible, false);
A.eq('llm_eligible = false', h.llm_eligible, false);
A.ok('quality_flags include search_cards_only (critical)', String(h.quality_flags).indexOf('search_cards_only') >= 0);

A.section('WF16 — corrected counts');
A.eq('items_received = 10', h.items_received, 10);
A.eq('unique_items = 9', h.unique_items, 9);
A.eq('duplicate_items = 1 (duplicate_in_registry recognized)', h.duplicate_items, 1);
A.eq('report_candidate_items = 0', h.report_candidate_items, 0);

A.section('WF16 — metadata joined via the corrected connector run_id (Obj4 #8/#9)');
A.eq('workflow joined', h.workflow, 'WF09 - Avito Classifieds Connector');
A.eq('source_family joined', h.source_family, 'classifieds');
A.eq('platform joined', h.platform, 'avito');
A.eq('agent_request_id joined', h.agent_request_id, REQ_ID);
A.eq('external_calls = 1', h.external_calls, 1);
A.eq('source_cost_status = unknown (not not_applicable)', h.source_cost_status, 'unknown');
A.eq('actual_source_cost_usd null (unknown != 0)', h.actual_source_cost_usd, null);

A.section('WF16 — non-detail cards do not inflate exact_evidence_url_rate (Obj4 #7)');
A.eq('exact_evidence_url_rate = 0', h.exact_evidence_url_rate, 0);

A.section('WF16 — embedded node scoring === n8n/lib/quality_gate.js for the real bundle (drift-proof)');
const b0 = bundles[0].json;
const lib = QG.computeRunHealth(b0.run, b0.records, { now_iso: '2026-06-20T06:00:00+03:00', freshness_window_days: 30, allow_degraded_report: false, taxonomy_version: 'semantic-v2.0' });
A.eq('quality_status match', h.quality_status, lib.quality_status);
A.eq('quality_score match', h.quality_score, lib.quality_score);
A.eq('report_eligible match', h.report_eligible, lib.report_eligible);
A.eq('llm_eligible match', h.llm_eligible, lib.llm_eligible);
A.eq('duplicate_items match', h.duplicate_items, lib.duplicate_items);
A.eq('report_candidate_items match', h.report_candidate_items, lib.report_candidate_items);
A.eq('quality_flags match', h.quality_flags, (lib.quality_flags || []).join('; '));

A.section('WF16 — legacy fallback: live_source_runs keyed by agent_request_id still joins');
const legacyLsr = Object.assign({}, lsr, { run_id: REQ_ID, source_run_id: '' }); // pre-patch shape
const r16b = H.makeRun();
const cfg16b = H.runCodeNode(r16b, WF16, 'Set WF16 Config', [])[0].json;
cfg16b.fixture_self_test = false;
r16b.outputs['Set WF16 Config'] = [{ json: cfg16b }];
H.inject(r16b, 'Read live_source_runs', [legacyLsr]);
H.inject(r16b, 'Read raw_market_records', raw);
H.inject(r16b, 'Read market_record_registry', []);
const hb = H.runCodeNode(r16b, WF16, 'Build Source Health',
  H.runCodeNode(r16b, WF16, 'Assemble Run Bundles', [])).map(i => i.json)[0];
A.eq('legacy agent_request_id join still resolves workflow', hb.workflow, 'WF09 - Avito Classifieds Connector');
A.eq('legacy join still quarantines', hb.quality_status, 'quarantined');

A.report('wf16-runtime-searchcards');
