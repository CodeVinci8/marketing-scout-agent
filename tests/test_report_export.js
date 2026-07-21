'use strict';
// test_report_export.js — scoped CSV export: scoping, RFC-4180 quoting, UTF-8 BOM, formula-injection
// protection, deterministic output, report isolation (Section 3.1 / 21).
const A = require('./_assert.js');
const X = require('../n8n/lib/report_export.js');
const F = require('./fixtures/report_fixtures.js');

const b = F.currentReport();
const scope = F.scopeOf(b);

A.section('formula-injection neutralisation');
A.eq('= prefixed', X.neutralize('=SUM(A1)'), "'=SUM(A1)");
A.eq('+ formula prefixed', X.neutralize('+cmd|calc'), "'+cmd|calc");
A.eq('@ prefixed', X.neutralize('@import'), "'@import");
A.eq('negative number untouched', X.neutralize('-5'), '-5');
A.eq('decimal untouched', X.neutralize('4.5'), '4.5');
A.eq('- formula prefixed', X.neutralize('-2+3+cmd()'), "'-2+3+cmd()");
A.eq('plain text untouched', X.neutralize('Cashmotor'), 'Cashmotor');
A.eq('url untouched', X.neutralize('https://x.ru/a'), 'https://x.ru/a');
A.ok('isFiniteNumber true', X.isFiniteNumber('-3.14'));
A.ok('isFiniteNumber false on formula', !X.isFiniteNumber('-3+cmd'));

A.section('RFC-4180 quoting');
A.eq('comma quoted', X.csvCell('a,b'), '"a,b"');
A.eq('quote doubled', X.csvCell('say "hi"'), '"say ""hi"""');
A.eq('newline quoted', X.csvCell('line1\nline2'), '"line1\nline2"');
A.eq('plain unquoted', X.csvCell('plain'), 'plain');

A.section('competitors view');
const comp = X.exportCsv(b, 'competitors', scope);
A.ok('filename pattern', comp.filename === 'vinci_ai_pilot_report_20260621_101500_competitors.csv');
A.ok('has BOM', comp.bom === true && comp.content.charCodeAt(0) === 0xFEFF);
A.ok('mime csv', /text\/csv/.test(comp.mime));
A.eq('row count', comp.row_count, 3);
const compLines = comp.content.replace(/^﻿/, '').trim().split('\r\n');
A.eq('header order', compLines[0], 'competitor,domain,region,positioning,score,quality,last_checked,source_link');
A.ok('CRLF line endings', comp.content.indexOf('\r\n') >= 0);
A.ok('cyrillic preserved', /Cashmotor/.test(compLines[1]) && /Москва/.test(comp.content));
A.ok('AvtoDengi positioning neutralised', /,'-агрессивный/.test(comp.content) || comp.content.indexOf("'-агрессивный") >= 0);

A.section('offers view — formula payload neutralised');
const offers = X.exportCsv(b, 'offers', scope);
A.eq('offers rows', offers.row_count, 3);
A.ok('HYPERLINK payload neutralised', offers.content.indexOf("'=HYPERLINK") >= 0);
A.ok('no live formula', offers.content.indexOf(',=HYPERLINK') < 0);
A.ok('empty price stays empty (no fabricated 0)', /Звонок/.test(offers.content) && offers.content.indexOf(',0,') < 0);

A.section('evidence + recommendations views');
const ev = X.exportCsv(b, 'evidence', scope);
A.eq('evidence rows', ev.row_count, 2);
A.ok('evidence header', ev.content.indexOf('finding,competitor,excerpt,url,source_quality,confidence,collected_at') >= 0);
const rec = X.exportCsv(b, 'recommendations', scope);
A.ok('linked ids joined', rec.content.indexOf('f_rate_cashmotor') >= 0);
A.ok('empty linked ids stays empty', rec.row_count === 3);

A.section('complete flat report view');
const full = X.exportCsv(b, 'report', scope);
A.eq('flat rows = offers', full.row_count, 3);
A.ok('flat joins competitor domain', full.content.indexOf('cashmotor.ru') >= 0);

A.section('internal columns excluded unless requested');
A.ok('default hides source_record_id', offers.content.indexOf('source_record_id') < 0);
const withInternal = X.exportCsv(b, 'offers', scope, { include_internal: true });
A.ok('opt-in shows source_record_id', withInternal.content.indexOf('source_record_id') >= 0);

A.section('report isolation');
let threw = false;
try { X.exportCsv(b, 'competitors', { report_id: 'report_other_owner', owner_user_id: '999999' }); } catch (e) { threw = /scope mismatch/.test(e.message); }
A.ok('cross-report scope rejected', threw);
let threw2 = false;
try { X.exportCsv(b, 'nope', scope); } catch (e) { threw2 = /unknown export view/.test(e.message); }
A.ok('unknown view rejected', threw2);

A.section('determinism');
A.eq('same input same output', X.exportCsv(b, 'competitors', scope).content, X.exportCsv(F.currentReport(), 'competitors', scope).content);

A.report('report-export');
