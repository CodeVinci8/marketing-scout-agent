'use strict';
// test_report_charts.js — deterministic charts: real SVG, correct report ID, honest insufficient-data, no
// fabricated values, idempotency, report isolation (Sections 4 / 21).
const A = require('./_assert.js');
const C = require('../n8n/lib/report_charts.js');
const F = require('./fixtures/report_fixtures.js');

const b = F.currentReport();
const scope = F.scopeOf(b);

A.section('competitor score chart');
const score = C.renderChart(b, 'competitor_score', scope);
A.ok('valid SVG', /^<\?xml/.test(score.svg) && score.svg.indexOf('<svg') >= 0 && score.svg.indexOf('</svg>') >= 0);
A.ok('mime svg', score.mime === 'image/svg+xml');
A.ok('title present', score.svg.indexOf('Сравнение конкурентов') >= 0);
A.ok('report id in subtitle', score.svg.indexOf('report_20260621_101500') >= 0);
A.ok('data timestamp present', score.svg.indexOf('2026-06-21') >= 0);
A.ok('Cashmotor bar labelled', score.svg.indexOf('Cashmotor') >= 0);
A.ok('numeric value 8.5 shown', score.svg.indexOf('>8.5<') >= 0);
A.ok('not insufficient', score.insufficient_data === false);
A.eq('data points', score.data_points, 3);

A.section('unknown values stay explicit (no fabricated 0)');
A.ok('AvtoDengi unknown -> н/д', score.svg.indexOf('н/д') >= 0);
A.ok('no 0-bar for unknown (dashed marker)', score.svg.indexOf('stroke-dasharray') >= 0);

A.section('offer count + price/rate charts');
const cnt = C.renderChart(b, 'competitor_offer_count', scope);
A.ok('offer count not insufficient', cnt.insufficient_data === false);
const price = C.renderChart(b, 'price_rate', scope);
A.ok('price chart parses 4,5% -> 4.5', price.svg.indexOf('>4.5<') >= 0);
A.ok('price chart excludes empty price', price.data_points === 2);

A.section('source quality + platform coverage + change categories');
const sq = C.renderChart(b, 'source_quality_distribution', scope);
A.ok('quality distribution has healthy', sq.svg.indexOf('healthy') >= 0);
const cov = C.renderChart(b, 'platform_coverage', scope);
A.ok('platform coverage website', cov.svg.indexOf('website') >= 0);
A.ok('coverage value 3', cov.svg.indexOf('>3<') >= 0);

A.section('insufficient data is honest (no fabrication)');
const ch = C.renderChart(b, 'change_categories', scope); // no changes in current bundle
A.ok('changes chart insufficient', ch.insufficient_data === true);
A.eq('reason', ch.reason, 'no_data_points');
A.ok('honest message in svg', ch.svg.indexOf('Недостаточно данных') >= 0);
A.eq('zero data points', ch.data_points, 0);

A.section('all-values-unknown is honest');
const b2 = F.currentReport();
b2.competitors = [{ competitor: 'X', score: null }, { competitor: 'Y', score: '' }];
const allUnknown = C.renderChart(b2, 'competitor_score', scope);
A.ok('all unknown -> insufficient', allUnknown.insufficient_data === true);
A.eq('reason all unknown', allUnknown.reason, 'all_values_unknown');
A.ok('says values unknown, not fabricated', allUnknown.svg.indexOf('не выдуманы') >= 0);

A.section('renderAll + idempotency + isolation');
const all = C.renderAllCharts(b, scope);
A.eq('all chart types rendered', all.length, C.CHART_TYPES.length);
A.eq('idempotent svg', C.renderChart(b, 'competitor_score', scope).svg, C.renderChart(F.currentReport(), 'competitor_score', scope).svg);
A.ok('filename scoped to report', score.filename === 'marketing_scout_report_20260621_101500_chart_competitor_score.svg');
let threw = false;
try { C.renderChart(b, 'competitor_score', { report_id: 'other' }); } catch (e) { threw = /scope mismatch/.test(e.message); }
A.ok('cross-report rejected', threw);
let threw2 = false;
try { C.renderChart(b, 'bogus', scope); } catch (e) { threw2 = /unknown chart type/.test(e.message); }
A.ok('unknown chart type rejected', threw2);

A.report('report-charts');
