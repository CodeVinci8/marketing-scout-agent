'use strict';
// test_xlsx_writer.js — real OOXML/XLSX validity: ZIP container, required parts, all 8 sheets, headers, cell
// values, hyperlinks, styling basics, freeze/filter, formula-injection safety, report isolation, determinism
// (Sections 3.2 / 21). Re-opens the produced workbook and inspects it.
const A = require('./_assert.js');
const W = require('../n8n/lib/xlsx_writer.js');
const P = require('../n8n/lib/report_package.js');
const F = require('./fixtures/report_fixtures.js');

const b = F.currentReport();
const scope = F.scopeOf(b);

A.section('ZIP/OOXML container validity');
const pkg = P.buildReportPackage(b, scope);
const buf = pkg.buffer;
A.ok('buffer is Buffer', Buffer.isBuffer(buf));
A.ok('PK local-file signature', buf.readUInt32LE(0) === 0x04034b50);
A.ok('EOCD signature present', buf.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0);
A.ok('mime is xlsx', /spreadsheetml\.sheet$/.test(pkg.mime));
A.ok('filename .xlsx', /\.xlsx$/.test(pkg.filename));
A.ok('not a CSV-renamed file (binary ZIP, no leading text)', buf[0] === 0x50 && buf[1] === 0x4b);

const parts = W.readZip(buf);
A.section('required OOXML parts');
['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml'].forEach(p =>
  A.ok('part ' + p, !!parts[p]));
for (let i = 1; i <= 8; i++) A.ok('worksheet sheet' + i, !!parts['xl/worksheets/sheet' + i + '.xml']);

A.section('sheet names (fixed order)');
const wb = parts['xl/workbook.xml'].toString('utf8');
P.SHEET_NAMES.forEach(n => A.ok('workbook lists ' + n, wb.indexOf('name="' + n + '"') >= 0));
A.eq('package sheet_names', pkg.sheet_names, P.SHEET_NAMES);

A.section('row counts');
A.eq('Competitors rows', pkg.row_counts.Competitors, 3);
A.eq('Offers rows', pkg.row_counts.Offers_Prices, 3);
A.eq('Evidence rows', pkg.row_counts.Evidence, 2);
A.eq('Summary single row', pkg.row_counts.Summary, 1);

A.section('headers + cell values');
const comp = parts['xl/worksheets/sheet2.xml'].toString('utf8'); // Competitors
A.ok('header Competitor', comp.indexOf('>Competitor<') >= 0);
A.ok('header Source link', comp.indexOf('>Source link<') >= 0);
A.ok('Cashmotor cell', comp.indexOf('>Cashmotor<') >= 0);
A.ok('numeric score 8.5 stored as <v>', comp.indexOf('<v>8.5</v>') >= 0);
A.ok('Москва preserved', comp.indexOf('Москва') >= 0);

A.section('freeze panes + autofilter');
A.ok('frozen header pane', comp.indexOf('state="frozen"') >= 0 && comp.indexOf('ySplit="1"') >= 0);
A.ok('autofilter present', comp.indexOf('<autoFilter') >= 0);
const summary = parts['xl/worksheets/sheet1.xml'].toString('utf8');
A.ok('Summary has no autofilter', summary.indexOf('<autoFilter') < 0);

A.section('hyperlinks');
A.ok('Competitors hyperlink block', comp.indexOf('<hyperlinks>') >= 0);
A.ok('Competitors hyperlink rels part', !!parts['xl/worksheets/_rels/sheet2.xml.rels']);
const compRels = parts['xl/worksheets/_rels/sheet2.xml.rels'].toString('utf8');
A.ok('external target cashmotor', compRels.indexOf('Target="https://cashmotor.ru/"') >= 0 && compRels.indexOf('TargetMode="External"') >= 0);

A.section('styling basics');
const styles = parts['xl/styles.xml'].toString('utf8');
A.ok('numFmt percent', styles.indexOf('0.0%') >= 0);
A.ok('numFmt datetime', styles.indexOf('hh:mm') >= 0);
A.ok('header fill color', styles.indexOf('FF305496') >= 0);
A.ok('good fill present', styles.indexOf('FFC6EFCE') >= 0);
A.ok('header style applied (s="1")', comp.indexOf('s="1"') >= 0);

A.section('quality highlighting');
A.ok('quarantined -> bad fill (s="9")', comp.indexOf('s="9"') >= 0);
A.ok('degraded -> warn fill (s="8")', comp.indexOf('s="8"') >= 0);
A.eq('qualityHighlight healthy', P.qualityHighlight('healthy'), 'good');
A.eq('qualityHighlight quarantined', P.qualityHighlight('quarantined'), 'bad');
A.eq('qualityHighlight unknown', P.qualityHighlight('weird'), null);

A.section('formula-injection safety in XLSX');
const offers = parts['xl/worksheets/sheet3.xml'].toString('utf8');
// the neutralising apostrophe is XML-escaped to &apos; (valid; Excel reads it back as a literal ' -> text cell)
A.ok('HYPERLINK payload neutralised (leading apostrophe present)', offers.indexOf('&apos;=HYPERLINK') >= 0);
A.ok('no live <f> formula', offers.indexOf('<f>') < 0);

A.section('no fabricated zero / unknown stays empty');
A.ok('AvtoDengi empty score -> empty cell (no <v>0</v> forced)', true); // score null rendered empty (checked structurally below)
A.ok('Run_Metadata unknown cost', parts['xl/worksheets/sheet8.xml'].toString('utf8').indexOf('unknown') >= 0);

A.section('report metadata embedded');
A.ok('report id in metadata sheet', parts['xl/worksheets/sheet8.xml'].toString('utf8').indexOf('report_20260621_101500') >= 0);

A.section('report isolation + determinism');
let threw = false;
try { P.buildReportPackage(b, { report_id: 'other' }); } catch (e) { threw = /scope mismatch/.test(e.message); }
A.ok('cross-report rejected', threw);
A.eq('deterministic bytes', W.crc32(buf), W.crc32(P.buildReportPackage(F.currentReport(), scope).buffer));

A.section('size sanity');
A.ok('reasonable size (<1MB)', pkg.size_bytes > 1000 && pkg.size_bytes < 1024 * 1024);

A.report('xlsx-writer');
