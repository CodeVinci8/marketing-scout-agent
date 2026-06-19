// test_semantic_contract.js — runs the §16 evidence fixtures through the offline semantic classifier.
// Proves the semantic contract (system events, owned-media, affiliate, negation, Avito completeness,
// classified->competitor, route mapping, report eligibility, exact-evidence-url preservation) with NO live calls.
'use strict';
const A = require('./_assert');
const C = require('../n8n/lib/semantic_core.js');
const FIX = require('./fixtures/semantic_cases.json');

for (const tc of FIX.cases) {
  A.section(tc.name + '  (' + (tc.ref || '') + ')');
  const r = C.classifyOffline(tc.input);
  const e = tc.expect;
  if (e.record_type) A.eq('record_type=' + e.record_type, r.record_type, e.record_type);
  if (e.not_record_type) A.ok('record_type != ' + e.not_record_type, r.record_type !== e.not_record_type, 'got=' + r.record_type);
  if (e.entity_type) A.eq('entity_type=' + e.entity_type, r.entity_type, e.entity_type);
  if (e.activity_subtype) A.eq('activity_subtype=' + e.activity_subtype, r.activity_subtype, e.activity_subtype);
  if (e.service_primary) A.eq('service_primary=' + e.service_primary, r.service_primary, e.service_primary);
  if (e.service_in) A.includes('service_primary in ' + JSON.stringify(e.service_in), e.service_in, r.service_primary);
  if (e.service_secondary_includes) A.includes('service_secondary includes ' + e.service_secondary_includes, r.service_secondary, e.service_secondary_includes);
  if (e.market_signal_subtype) A.eq('market_signal_subtype=' + e.market_signal_subtype, r.market_signal_subtype, e.market_signal_subtype);
  if (e.route) A.eq('route=' + e.route, r.route, e.route);
  if (e.not_route) A.ok('route != ' + e.not_route, r.route !== e.not_route, 'got=' + r.route);
  if (e.report_eligible !== undefined) A.eq('report_eligible=' + e.report_eligible, r.report_eligible, e.report_eligible);
  if (e.llm_eligible !== undefined) A.eq('llm_eligible=' + e.llm_eligible, r.llm_eligible, e.llm_eligible);
  if (e.hard_skip !== undefined) A.eq('hard_skip=' + e.hard_skip, r.hard_skip, e.hard_skip);
  if (e.skip_reason) A.eq('skip_reason=' + e.skip_reason, r.skip_reason, e.skip_reason);
  if (e.detail_fetch_required !== undefined) A.eq('detail_fetch_required=' + e.detail_fetch_required, r.detail_fetch_required, e.detail_fetch_required);
  if (e.min_confidence) A.ok('confidence >= ' + e.min_confidence, r.confidence_score >= e.min_confidence, 'conf=' + r.confidence_score);
  if (e.contains_flag) A.includes('semantic_flags contains ' + e.contains_flag, r.semantic_flags, e.contains_flag);
  if (e.quoted_claims_nonempty) A.ok('quoted_claims non-empty', Array.isArray(r.quoted_claims) && r.quoted_claims.length > 0, JSON.stringify(r.quoted_claims));
  if (e.no_author_speed_claim) A.ok('no author speed_text claim', !r.offer_terms || !r.offer_terms.speed_text, 'speed=' + (r.offer_terms && r.offer_terms.speed_text));
  if (e.no_offer_text) A.ok('no fabricated offer_text', !r.offer_text, 'offer_text=' + r.offer_text);
  if (e.offer_terms_speed) A.eq('offer_terms.speed_text=' + e.offer_terms_speed, r.offer_terms && r.offer_terms.speed_text, e.offer_terms_speed);
  // exact evidence URL preservation (§14): the routed record must keep the post/listing URL.
  const inUrl = tc.input.post_url || tc.input.listing_url || tc.input.source_url;
  if (inUrl) A.eq('exact_evidence_url preserved', r.exact_evidence_url, inUrl);
}

// the model never invents a sheet name: route is always a known physical queue.
A.section('route mapper produces only canonical routes');
for (const tc of FIX.cases) {
  const r = C.classifyOffline(tc.input);
  A.includes(tc.name + ' route in valid_routes', C.TAXONOMY.valid_routes, r.route);
}

A.report('semantic-contract');
