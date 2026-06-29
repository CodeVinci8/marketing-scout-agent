// sheets_access.js — bounded Google Sheets read access for the WF18 hot path (SHEETS-READ-AMPLIFICATION-001).
//
// The standard n8n "Get Row(s)" read runs ONCE PER INPUT ITEM (read.operation: length=items.length for
// typeVersion>4.1). Chaining whole-sheet reads (each emitting ~1000 row-items) makes the next read execute ~1000
// times -> request explosion -> 429. We replace the chained reads with ONE values:batchGet HTTP request (predefined
// googleApi credential, httpNode+scopes) and parse each tab out with this pure extractor. Code nodes run once for
// all items, so there is no per-item amplification.
//
// extractTab() reproduces the legacy read projection EXACTLY (proven by the shadow parity gate), matching n8n's
// prepareSheetData under the default `detectAutomatically` range:
//   * valueRenderOption=UNFORMATTED_VALUE, dateTimeRenderOption=FORMATTED_STRING (the caller MUST request these);
//   * removeEmptyColumns: a column whose HEADER cell is empty is dropped;
//   * removeEmptyRows: a data row whose kept cells are all empty is dropped;
//   * row_number = the cell's ORIGINAL sheet row (header is row 1 -> first data row_number = 2), preserved across
//     removed rows (addRowNumber happens before removeEmptyRows);
//   * each surviving row -> { row_number, <header>:value, ... } keyed by the header row, values left UNFORMATTED
//     (numbers/booleans keep their type; missing trailing cells become '').
'use strict';

function tabName(rangeStr) {
  // "conversation_state!A2:G7" or "'my sheet'!A:Z" -> "conversation_state"
  const s = String(rangeStr == null ? '' : rangeStr);
  const bang = s.lastIndexOf('!');
  const name = bang >= 0 ? s.slice(0, bang) : s;
  return name.replace(/^'(.*)'$/, '$1');
}

// Find the valueRange object for `tab` in a values:batchGet response. batchGet preserves request order, so a
// caller may also pass the expected index; we match by name first, then fall back to index.
function findRange(batchResponse, tab, index) {
  const ranges = (batchResponse && batchResponse.valueRanges) || [];
  for (let i = 0; i < ranges.length; i++) {
    if (tabName(ranges[i].range) === tab) return ranges[i];
  }
  if (typeof index === 'number' && ranges[index]) return ranges[index];
  return null;
}

function isEmptyCell(v) { return v === undefined || v === null || String(v) === ''; }

// Replicate n8n prepareSheetData(detectAutomatically) + the row->object structuring used by the read operation.
function projectValues(values) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) return [];
  const header = (rows[0] || []).map(h => (h == null ? '' : String(h)));
  // removeEmptyColumns: keep only columns whose header is non-empty.
  const cols = [];
  for (let c = 0; c < header.length; c++) if (header[c] !== '') cols.push(c);
  if (!cols.length) return [];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    // removeEmptyRows: drop rows whose kept cells are all empty.
    let allEmpty = true;
    for (let k = 0; k < cols.length; k++) { if (!isEmptyCell(row[cols[k]])) { allEmpty = false; break; } }
    if (allEmpty) continue;
    const obj = { row_number: r + 1 }; // header is sheet row 1 -> data row index r maps to sheet row r+1
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k];
      const v = row[c];
      obj[header[c]] = (v === undefined || v === null) ? '' : v;
    }
    out.push({ json: obj });
  }
  return out;
}

// Public: extract one tab's rows (legacy-read-shaped items) from a values:batchGet response.
function extractTab(batchResponse, tab, index) {
  const vr = findRange(batchResponse, tab, index);
  return projectValues(vr && vr.values);
}

// Build the bounded A1 range list for a set of tabs. Default column bound A:ZZ (the extractor drops empty-header
// columns, so over-wide bounds are harmless); a per-tab override map may pin tighter ranges.
function buildRanges(tabs, lastColByTab) {
  const m = lastColByTab || {};
  return (tabs || []).map(t => t + '!A:' + (m[t] || 'ZZ'));
}

// Build the full values:batchGet URL (the spreadsheet id stays an $env expression supplied by the caller).
function encodeRange(r) {
  // encodeURIComponent leaves '!' and "'" untouched; encode the A1 separators explicitly so the query is byte-stable
  // and matches the proven-working probe (Sheets accepts %21/%3A).
  return encodeURIComponent(String(r)).replace(/!/g, '%21').replace(/'/g, '%27');
}
function batchGetUrl(spreadsheetIdExpr, ranges) {
  const q = ['majorDimension=ROWS', 'valueRenderOption=UNFORMATTED_VALUE', 'dateTimeRenderOption=FORMATTED_STRING']
    .concat((ranges || []).map(r => 'ranges=' + encodeRange(r)));
  return 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetIdExpr + '/values:batchGet?' + q.join('&');
}

module.exports = { extractTab, projectValues, findRange, tabName, buildRanges, batchGetUrl, encodeRange };
