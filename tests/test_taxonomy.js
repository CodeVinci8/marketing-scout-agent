// test_taxonomy.js — canonical taxonomy internal consistency + alias/route mapping (§4, §17).
'use strict';
const path = require('path');
const A = require('./_assert');
const C = require('../n8n/lib/semantic_core.js');
const TX = C.TAXONOMY;

A.section('source-of-truth consistency');
// semantic_core loads config/taxonomy.json -> the runtime mirror IS the JSON (no drift possible).
const fileTx = require('../config/taxonomy.json');
A.eq('semantic_core.TAXONOMY === config/taxonomy.json', TX, fileTx);
A.ok('taxonomy_version present', !!TX.taxonomy_version);

A.section('enum integrity');
A.includes('record_type has competitor_activity', TX.record_type, 'competitor_activity');
A.includes('record_type has system_event', TX.record_type, 'system_event');
A.includes('record_type has unknown', TX.record_type, 'unknown');
A.includes('entity_type has audience_signal', TX.entity_type, 'audience_signal');
A.ok('service has pts_loan + auto_lease_refinance', TX.service.indexOf('pts_loan') >= 0 && TX.service.indexOf('auto_lease_refinance') >= 0);

A.section('every record_type maps to a valid route');
for (const rt of TX.record_type) {
  const route = C.routeForRecordType(rt);
  A.includes('route_map[' + rt + ']=' + route + ' in valid_routes', TX.valid_routes, route);
}
A.section('every record_type has an entity + legacy entity');
for (const rt of TX.record_type) {
  A.includes('entity_for_record_type[' + rt + ']', TX.entity_type, C.entityForRecordType(rt));
  A.ok('legacy_entity[' + rt + '] present', !!C.legacyEntityForRecordType(rt));
}
A.section('aliases resolve into canonical sets');
for (const k of Object.keys(TX.record_type_aliases)) A.includes('record alias ' + k, TX.record_type, TX.record_type_aliases[k]);
for (const k of Object.keys(TX.service_aliases)) A.includes('service alias ' + k, TX.service, TX.service_aliases[k]);
for (const k of Object.keys(TX.service_keyword_aliases_cyrillic)) A.includes('cyr alias ' + k, TX.service, TX.service_keyword_aliases_cyrillic[k]);

A.section('contract alias examples (§4.4)');
A.eq('secured_auto_loan -> pts_loan', C.normalizeService('secured_auto_loan').normalized_service_type, 'pts_loan');
A.eq('auto_collateral_loan -> pts_loan', C.normalizeService('auto_collateral_loan').normalized_service_type, 'pts_loan');
A.eq('return_lease_refinancing -> auto_lease_refinance', C.normalizeService('return_lease_refinancing').normalized_service_type, 'auto_lease_refinance');
A.eq('sale_leaseback_refinancing -> auto_lease_refinance', C.normalizeService('sale_leaseback_refinancing').normalized_service_type, 'auto_lease_refinance');
A.eq('credit_broker(legacy) -> credit_brokerage', C.normalizeService('credit_broker').normalized_service_type, 'credit_brokerage');
A.eq('secured_real_estate_loan -> real_estate_secured_loan', C.normalizeService('secured_real_estate_loan').normalized_service_type, 'real_estate_secured_loan');
A.eq('question_objection -> audience_question', C.normalizeRecordType('question_objection').value, 'audience_question');
A.eq('content_idea(record) -> market_signal alias', C.normalizeRecordType('content_idea').value, 'market_signal');

A.section('unresolved alias surfaces a flag, never silently passes');
const bogus = C.normalizeService('quantum_credit_thing', '');
A.eq('bogus normalized_service_type=unknown', bogus.normalized_service_type, 'unknown');
A.ok('bogus unresolved=true', bogus.unresolved === true);
A.ok('raw preserved', bogus.raw_model_service_type === 'quantum_credit_thing');

A.report('taxonomy');
