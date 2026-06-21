'use strict';
// test_evidence.js — evidence mode: valid anchors, no invented excerpts, recommendation->finding references,
// zero external calls, honest unavailability, pagination, scoped export (Sections 5 / 21).
const A = require('./_assert.js');
const E = require('../n8n/lib/evidence.js');
const X = require('../n8n/lib/report_export.js');
const F = require('./fixtures/report_fixtures.js');

const b = F.currentReport();
const scope = F.scopeOf(b);

A.section('evidence by competitor');
const r = E.queryEvidence(b, { competitor: 'Cashmotor' }, scope, { now: b.created_at });
A.eq('one item', r.total, 1);
A.eq('zero external calls', r.external_calls, 0);
const it = r.items[0];
A.ok('finding present', it.finding === 'Ставка Cashmotor 4,5%');
A.ok('source url', it.source_url === 'https://cashmotor.ru/pts');
A.ok('source record id', it.source_record_id === 'rec_1');
A.ok('source run id', it.source_run_id === 'wf16_0621');
A.ok('collected at', it.collected_at === '2026-06-21T09:00:00+03:00');
A.ok('has excerpt', it.has_excerpt === true && it.excerpt.length > 0);
A.ok('confidence', it.confidence === 'high');
A.ok('freshness fresh', it.freshness === 'fresh');
A.ok('currently available', it.currently_available === true);

A.section('evidence by rate text "4,5%"');
const byRate = E.queryEvidence(b, { text: '4,5%' }, scope, { now: b.created_at });
A.ok('finds rate evidence', byRate.total >= 1 && /Cashmotor/.test(byRate.items[0].finding));

A.section('never invents excerpt; honest unavailable');
const none = E.queryEvidence(b, { competitor: 'AvtoDengi' }, scope, { now: b.created_at });
A.eq('no stored evidence for quarantined competitor', none.total, 0);
A.ok('honest unavailable note', /Нет сохранённых доказательств/.test(none.unavailable_note));
A.ok('offers explicit refresh', /сбор/.test(none.unavailable_note));
const unknown = E.queryEvidence(b, { competitor: 'НетТакого' }, scope, {});
A.ok('unknown competitor noted', /не найден/.test(unknown.unavailable_note));

A.section('links-only mode');
const links = E.queryEvidence(b, { links_only: true }, scope, { now: b.created_at });
A.ok('links-only shape', links.items[0].source_url && links.items[0].excerpt === undefined);

A.section('pagination');
const big = F.currentReport();
big.evidence = Array.from({ length: 23 }, (_, i) => ({ finding_id: 'f' + i, finding: 'F' + i, competitor: 'Cashmotor', excerpt: 'x' + i, url: 'https://x/' + i, source_record_id: 'r' + i, source_run_id: 'wf16_0621', source_quality: 'healthy', confidence: 'high', collected_at: b.created_at, available: true }));
const p1 = E.queryEvidence(big, { page: 1, page_size: 10 }, scope, { now: b.created_at });
A.eq('page1 size', p1.items.length, 10);
A.ok('has_more', p1.has_more === true);
A.eq('total', p1.total, 23);
const p3 = E.queryEvidence(big, { page: 3, page_size: 10 }, scope, { now: b.created_at });
A.eq('page3 size', p3.items.length, 3);
A.ok('no more', p3.has_more === false);

A.section('recommendation -> finding anchoring');
const anchors = E.recommendationAnchors(b);
const backed = anchors.find(a => /ставку ниже рынка/.test(a.recommendation));
A.ok('backed rec confirmed', backed.evidence_backed === true && backed.confirmed === true);
A.ok('backed rec resolves finding', backed.resolved_finding_ids.indexOf('f_rate_cashmotor') >= 0);
const hypo = anchors.find(a => /AvtoDengi/.test(a.recommendation));
A.ok('unanchored rec NOT confirmed', hypo.evidence_backed === false && hypo.confirmed === false);
A.ok('unanchored labelled as hypothesis', /гипотеза/.test(hypo.label));

A.section('evidence for a recommendation');
const efr = E.evidenceForRecommendation(b, 'Подсветить ставку ниже рынка', scope, { now: b.created_at });
A.ok('found + backed', efr.found && efr.evidence_backed && efr.items.length === 1);
A.eq('efr zero calls', efr.external_calls, 0);
const efr2 = E.evidenceForRecommendation(b, 'Проверить вручную агрессивные', scope, {});
A.ok('hypothesis rec returns no evidence', efr2.found && efr2.evidence_backed === false && efr2.items.length === 0);

A.section('scoped CSV export of evidence');
const csv = X.exportCsv(b, 'evidence', scope);
A.ok('evidence csv scoped + rows', csv.row_count === 2 && /Cashmotor/.test(csv.content));

A.section('report isolation');
let threw = false;
try { E.queryEvidence(b, { competitor: 'Cashmotor' }, { report_id: 'other' }, {}); } catch (e) { threw = /scope mismatch/.test(e.message); }
A.ok('cross-report rejected', threw);

A.report('evidence');
