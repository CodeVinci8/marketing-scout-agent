// test_sheets_access.js — SHEETS-READ-AMPLIFICATION-001 read-projection parity (offline, $0, no network).
// Proves extractTab() reproduces the n8n "Get Rows" (detectAutomatically, UNFORMATTED_VALUE) projection across the
// operator's required fixtures. The live shadow-parity gate (scripts) cross-checks against the REAL read on
// production data; this pins the contract so a regression fails CI.
'use strict';
const A = require('./_assert');
const S = require('../n8n/lib/sheets_access.js');

// helper: wrap a 2D values array as a one-range batchGet response for `tab`
const resp = (tab, values) => ({ valueRanges: [{ range: tab + '!A:ZZ', values }] });
const rows = (tab, values) => S.extractTab(resp(tab, values), tab, 0);

A.section('empty sheet / header-only -> no data rows');
A.eq('empty values -> []', rows('t', []), []);
A.eq('header-only -> []', rows('t', [['a', 'b', 'c']]), []);
A.eq('missing range -> []', S.extractTab({ valueRanges: [] }, 'absent', 0), []);

A.section('one matching row -> one item keyed by header + sheet row_number (2)');
{
  const r = rows('t', [['id', 'name'], ['x1', 'Alice']]);
  A.eq('one item', r.length, 1);
  A.eq('keyed by header + row_number first', Object.keys(r[0].json), ['row_number', 'id', 'name']);
  A.eq('row_number is the sheet row (2)', r[0].json.row_number, 2);
  A.eq('values preserved', [r[0].json.id, r[0].json.name], ['x1', 'Alice']);
}

A.section('multiple rows incl. duplicate keys -> all kept, row_number tracks sheet position');
{
  const r = rows('t', [['k', 'v'], ['dup', '1'], ['other', '2'], ['dup', '3']]);
  A.eq('three items', r.length, 3);
  A.eq('row_numbers 2,3,4', r.map(x => x.json.row_number), [2, 3, 4]);
  A.eq('duplicate keys both present', r.filter(x => x.json.k === 'dup').length, 2);
}

A.section('removeEmptyRows: a fully-empty data row is dropped but row_number of later rows is preserved');
{
  const r = rows('t', [['k', 'v'], ['a', '1'], ['', ''], ['b', '2']]);
  A.eq('empty row dropped (2 items)', r.length, 2);
  A.eq('row_numbers 2 and 4 (gap preserved)', r.map(x => x.json.row_number), [2, 4]);
}

A.section('removeEmptyColumns: an empty-header column is excluded from the projection');
{
  const r = rows('t', [['k', '', 'v'], ['a', 'IGNORED', '1']]);
  A.eq('empty-header column dropped', Object.keys(r[0].json), ['row_number', 'k', 'v']);
}

A.section('missing optional trailing values -> empty string');
{
  const r = rows('t', [['k', 'v', 'w'], ['a', 'b']]); // third cell missing
  A.eq('missing trailing cell -> ""', r[0].json.w, '');
  A.eq('present cells intact', [r[0].json.k, r[0].json.v], ['a', 'b']);
}

A.section('type fidelity: numeric / boolean / date(FORMATTED_STRING) / formula-result / special chars');
{
  const r = rows('t', [['n', 'b', 'd', 'f', 's'], [42, true, '2026-06-29', 7, 'a,b;c\nd "q"']]);
  A.eq('number stays number (UNFORMATTED)', r[0].json.n, 42);
  A.eq('boolean stays boolean', r[0].json.b, true);
  A.eq('date is the FORMATTED_STRING the API returned', r[0].json.d, '2026-06-29');
  A.eq('formula result value is whatever the API returned (no formula text)', r[0].json.f, 7);
  A.eq('special characters preserved verbatim', r[0].json.s, 'a,b;c\nd "q"');
}

A.section('rows beyond 1000 are projected (no 1000-row cap in the extractor)');
{
  const big = [['k']]; for (let i = 0; i < 1500; i++) big.push(['r' + i]);
  const r = rows('t', big);
  A.eq('all 1500 data rows projected', r.length, 1500);
  A.eq('last row_number is 1501', r[r.length - 1].json.row_number, 1501);
}

A.section('multi-range batchGet: each tab extracted by name regardless of order');
{
  const multi = { valueRanges: [
    { range: 'beta!A:Z', values: [['k'], ['b1']] },
    { range: 'alpha!A:Z', values: [['k'], ['a1'], ['a2']] }
  ] };
  A.eq('alpha by name -> 2 rows', S.extractTab(multi, 'alpha').length, 2);
  A.eq('beta by name -> 1 row', S.extractTab(multi, 'beta').length, 1);
}

A.section('buildRanges / batchGetUrl shape (bounded, env-expression spreadsheet id, never a literal id)');
{
  A.eq('buildRanges default A:ZZ', S.buildRanges(['a', 'b']), ['a!A:ZZ', 'b!A:ZZ']);
  A.eq('buildRanges per-tab override', S.buildRanges(['a'], { a: 'G' }), ['a!A:G']);
  const url = S.batchGetUrl('{{EXPR}}', ['a!A:G']);
  A.ok('url targets values:batchGet', /\/values:batchGet\?/.test(url));
  A.ok('url requests UNFORMATTED + FORMATTED_STRING', /valueRenderOption=UNFORMATTED_VALUE/.test(url) && /dateTimeRenderOption=FORMATTED_STRING/.test(url));
  A.ok('ranges url-encoded', /ranges=a%21A%3AG/.test(url));
  A.ok('spreadsheet id stays an expression (no literal)', url.indexOf('{{EXPR}}') >= 0);
}

console.log('\nSHEETS_ACCESS_PROJECTION_PARITY=PASS');
A.report('sheets-access');
