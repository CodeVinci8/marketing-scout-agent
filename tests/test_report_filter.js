'use strict';
// test_report_filter.js — NL filtering/sorting: Russian free-text, combined filters, sorting, invalid->one
// clarification, no code injection, zero external calls, mergeable follow-ups (Sections 8 / 21).
const A = require('./_assert.js');
const R = require('../n8n/lib/report_filter.js');
const F = require('./fixtures/report_fixtures.js');

const b = F.currentReport();
const names = b.competitors.map(c => c.competitor);

A.section('region filter — "конкуренты из Москвы"');
const f1 = R.parseFilter('Покажи только конкурентов из Москвы', names);
A.ok('ok', f1.ok === true);
A.ok('region parsed', f1.filters.region === 'москв');
const a1 = R.applyFilter(b, f1.filters, f1.sort);
A.ok('Cashmotor(Москва) kept', a1.competitors.some(c => c.competitor === 'Cashmotor'));
A.ok('CarCapital(Москва) kept', a1.competitors.some(c => c.competitor === 'CarCapital'));
// precise matching: «Москва» (city) does NOT match «Московская область» (different stem) — honest, not greedy
A.ok('AvtoDengi(Московская область) excluded by city filter', !a1.competitors.some(c => c.competitor === 'AvtoDengi'));
A.eq('zero external calls', a1.external_calls, 0);

A.section('rate filter — "ставки ниже 5%"');
const f2 = R.parseFilter('Оставь предложения со ставкой ниже 5%', names);
A.ok('max_value 5', f2.filters.max_value === 5);
const a2 = R.applyFilter(b, f2.filters);
A.ok('Cashmotor 4,5% kept', a2.offers.some(o => o.competitor === 'Cashmotor'));
A.ok('CarCapital 5,9% dropped', !a2.offers.some(o => o.competitor === 'CarCapital'));
A.ok('empty-rate offer dropped (no fabricated pass)', !a2.offers.some(o => o.competitor === 'AvtoDengi'));

A.section('source quality filter — "только healthy источники"');
const f3 = R.parseFilter('Покажи только healthy источники', names);
A.ok('source_quality healthy', f3.filters.source_quality === 'healthy');
const a3 = R.applyFilter(b, f3.filters);
A.ok('only healthy competitors', a3.competitors.every(c => c.quality === 'healthy') && a3.competitors.length === 1);

A.section('sorting');
const f4 = R.parseFilter('Отсортируй по силе предложения', names);
A.ok('sort score desc', f4.sort && f4.sort.by === 'score' && f4.sort.dir === 'desc');
const a4 = R.applyFilter(b, {}, f4.sort);
A.ok('Cashmotor first (8.5)', a4.competitors[0].competitor === 'Cashmotor');
const f5 = R.parseFilter('Отсортируй по качеству источников', names);
A.ok('sort quality', f5.sort.by === 'quality');
const f6 = R.parseFilter('Отсортируй по ставке', names);
A.ok('sort price_rate', f6.sort.by === 'price_rate');
const a6 = R.applyFilter(b, {}, f6.sort);
A.ok('cheapest first', R.rateNum(a6.offers[0].price_rate) === 4.5);

A.section('competitor + promotion + evidence filters');
const f7 = R.parseFilter('Покажи акции Cashmotor', names);
A.ok('competitor parsed', f7.filters.competitor === 'cashmotor');
A.ok('promotion flag', f7.filters.has_promotion === true);
const f8 = R.parseFilter('Убери записи без доказательств', names);
A.ok('require_evidence true', f8.filters.require_evidence === true);
const a8 = R.applyFilter(b, f8.filters);
A.ok('only evidence-backed competitors', a8.competitors.every(c => b.evidence.some(e => e.competitor === c.competitor)));

A.section('invalid filter -> exactly one clarification');
const bad = R.parseFilter('сделай красиво', names);
A.ok('not ok', bad.ok === false);
A.ok('one clarification', typeof bad.clarification === 'string' && bad.clarification.length > 0);
const badNum = R.parseFilter('покажи ставки ниже', names);
A.ok('comparator no number -> clarification', badNum.ok === false && /число/.test(badNum.clarification));

A.section('no code injection (strict schema)');
const inj = R.validate({ region: 'москв', __proto__: 'x', evilKey: 'y', max_value: 5 });
A.ok('unknown keys stripped', !('evilKey' in inj) && inj.region === 'москв' && inj.max_value === 5);
A.ok('no eval of input', R.parseFilter('process.exit(1)', names).ok === false);

A.section('mergeable follow-up — "а теперь только Москва"');
const prev = { source_quality: 'healthy' };
const follow = R.parseFilter('а теперь только из Москвы', names);
const merged = R.mergeFilters(prev, follow.filters);
A.ok('merge keeps prev + adds new', merged.source_quality === 'healthy' && merged.region === 'москв');

A.report('report-filter');
