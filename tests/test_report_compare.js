'use strict';
// test_report_compare.js — compare mode: safe baseline selection (never arbitrary), added/removed/changed/
// unchanged, before/after + evidence, zero external calls (Sections 6 / 21).
const A = require('./_assert.js');
const C = require('../n8n/lib/report_compare.js');
const F = require('./fixtures/report_fixtures.js');

const cur = F.currentReport();
const prior = F.priorReport();
const unrelated = F.unrelatedReport();

A.section('baseline selection is safe (never arbitrary)');
const sel = C.selectBaseline(cur, [prior, unrelated]);
A.ok('compatible baseline found', sel.compatible === true);
A.eq('selected the prior compatible report', sel.baseline_report_id, 'report_20260614_101500');
A.ok('unrelated owner rejected', sel.rejected.some(r => r.report_id === 'report_other_owner' && r.reason === 'different_owner'));
const selNone = C.selectBaseline(cur, [unrelated]);
A.ok('no compatible baseline -> none', selNone.compatible === false && selNone.baseline === null);
A.eq('reason no baseline', selNone.reason, 'no_compatible_baseline');
// later report can never be a baseline
const future = F.priorReport(); future.report_id = 'report_future'; future.created_at = '2026-07-01T00:00:00+03:00';
A.ok('future report rejected (not earlier)', C.selectBaseline(cur, [future]).rejected.some(r => r.reason === 'not_earlier'));
// fixture/manual excluded
const fix = F.priorReport(); fix.report_id = 'report_fix'; fix.data_mode = 'fixture';
A.ok('fixture baseline rejected', C.selectBaseline(cur, [fix]).rejected.some(r => r.reason === 'fixture_or_manual'));

A.section('comparison structure');
const cmp = C.compareReports(cur, sel.baseline);
A.ok('compatible', cmp.compatible === true);
A.ok('AvtoDengi is added competitor', cmp.added.competitors.some(c => c.competitor === 'AvtoDengi'));
A.ok('no removed competitors', cmp.removed.competitors.length === 0);
A.ok('Cashmotor offer changed', cmp.changed.offers.some(o => o.competitor === 'Cashmotor'));

A.section('changed offer carries before/after + ids + evidence');
const ch = cmp.changed.offers.find(o => o.competitor === 'Cashmotor');
const rate = ch.changes.find(x => x.field === 'price_rate');
A.eq('before rate', rate.before, '5,5%');
A.eq('after rate', rate.after, '4,5%');
A.eq('old report id', ch.old_report_id, 'report_20260614_101500');
A.eq('new report id', ch.new_report_id, 'report_20260621_101500');
A.eq('old source record id', ch.old_source_record_id, 'rec_p1');
A.eq('new source record id', ch.new_source_record_id, 'rec_1');
A.ok('evidence anchor present', ch.evidence && ch.evidence.finding_id === 'f_rate_cashmotor');

A.section('unchanged + added offers');
A.ok('CarCapital refi unchanged', cmp.unchanged.offers.some(o => o.competitor === 'CarCapital'));
A.ok('AvtoDengi offer added', cmp.added.offers.some(o => o.competitor === 'AvtoDengi'));

A.section('quality + unavailable comparisons');
A.ok('CarCapital quality change healthy->degraded', cmp.quality_changes.some(q => /carcapital/.test(q.source.toLowerCase()) && q.before_status === 'healthy' && q.after_status === 'degraded'));
A.ok('AvtoDengi quarantined -> unavailable comparison', cmp.unavailable.some(u => /avtodengi/.test(u.source.toLowerCase())));

A.section('zero external calls + no baseline path');
A.eq('compare zero calls', cmp.metadata.external_calls, 0);
const noBase = C.compareReports(cur, null);
A.ok('no baseline -> empty diff, honest reason', noBase.compatible === false && noBase.reason === 'no_compatible_baseline');

A.section('compareWithHistory convenience');
const full = C.compareWithHistory(cur, [prior, unrelated]);
A.ok('selects + compares', full.compatible === true && full.baseline_selection.baseline_report_id === 'report_20260614_101500');

A.report('report-compare');
