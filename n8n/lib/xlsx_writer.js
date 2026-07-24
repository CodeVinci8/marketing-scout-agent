'use strict';
// xlsx_writer.js — zero-dependency, deterministic OOXML (.xlsx) writer (Section 3.2).
//
// Produces a REAL, valid multi-sheet XLSX workbook (a ZIP of OOXML parts), not a CSV renamed to .xlsx. It
// uses only Node built-ins (`zlib` for DEFLATE) — no third-party dependency, no lockfile, $0, offline. The
// output is byte-deterministic (fixed ZIP timestamps, stable part order) so tests can hash it and re-open it.
//
// Supports: frozen header row, autofilter, column widths, wrapped long text, a distinct header style,
// date/number/percent number-formats (percentages stay numerically correct as fractions), clickable external
// hyperlinks, and status highlighting (good/warn/bad fills). Text cells starting with = + - @ are neutralised
// (formula-injection safe) exactly like the CSV path.
const zlib = require('zlib');
const { neutralize, isFiniteNumber } = require('./report_export.js');

// ---- tiny ZIP container (deflate, deterministic) -----------------------------------------------------
const CRC_TABLE = (function () {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zip(entries) {
  // entries: [{ name, data:Buffer }]. Fixed DOS time/date for determinism (1980-01-01 00:00:00).
  const DOS_TIME = 0, DOS_DATE = 0x21;
  const locals = []; const central = []; let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(8, 10); cen.writeUInt16LE(DOS_TIME, 12); cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}

// ---- OOXML helpers -----------------------------------------------------------------------------------
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function colLetter(n) { let s = ''; n = n + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function cellRef(r, c) { return colLetter(c) + (r + 1); }

// REPORT-TRUTH-E (defect 4): user-facing dates render in Moscow wall-clock (MSK = UTC+3, no DST), matching the
// filename and Telegram time. The datetime column headers are labelled «(МСК)» so the timezone is explicit.
var XLSX_MSK_OFFSET_MIN = 180;
// TIMESTAMP CONTRACT — aligned with the CANONICAL producer contract in ms_time.js (instantOf), applied exactly once:
//   1. ISO WITH a zone — «…Z» or «…±HH:MM» (e.g. 2026-07-24T09:00:00Z, 2026-07-24T12:00:00+03:00): Date.parse
//      resolves the true UTC instant; add ONE fixed MSK offset → Moscow wall-clock. Both forms of the same instant
//      render identically. This is what every real producer emits (.toISOString() → Z, ms_time.toRFC3339 → +03:00).
//   2. ISO WITHOUT a zone (timezone-naive, e.g. 2026-07-24T12:00:00): ms_time interprets a zone-less value as
//      product-timezone (Moscow) WALL-CLOCK — so the written digits ARE already МСК. We render them LITERALLY (parse
//      the digits at UTC, add NO offset). Date-only (YYYY-MM-DD) → that calendar date at 00:00, never day-shifted.
//   3. Anything unparseable → null (rejected; the cell renders empty, never a wrong date).
// The MSK offset is added ONLY on the zoned path (case 1). A naive value never gets it — so a naive «12:00» shows
// «12:00 МСК», not «15:00». There is no double shift: cases 1 and 2 are mutually exclusive by the zone test.
var XLSX_ZONED_RE = /(?:[zZ]|[+\-]\d{2}:?\d{2})$/;                                       // ends in Z or ±HH:MM
var XLSX_NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/; // zone-less ISO / date-only
// Excel serial date (1900 system, 1899-12-30 = 0). Returns null when not a parseable date.
function excelSerial(iso) {
  var s = String(iso == null ? '' : iso).trim();
  if (!s) return null;
  if (XLSX_ZONED_RE.test(s)) {                                     // case 1: zoned instant → Moscow wall-clock
    var tz = Date.parse(s);
    return isFinite(tz) ? (tz + XLSX_MSK_OFFSET_MIN * 60000) / 86400000 + 25569 : null;
  }
  var m = s.match(XLSX_NAIVE_RE);                                  // case 2: zone-less digits ARE Moscow wall-clock
  if (!m) return null;                                            // case 3: unparseable → rejected
  var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return isFinite(t) ? t / 86400000 + 25569 : null;               // rendered literally, NO offset
}

// Style indices baked into styles.xml below (cellXfs order is fixed).
const STYLE = { default: 0, header: 1, wrap: 2, datetime: 3, percent: 4, number: 5, hyperlink: 6, good: 7, warn: 8, bad: 9, integer: 10 };

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3">' +
    '<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/>' +
    '<numFmt numFmtId="165" formatCode="0.0%"/>' +
    '<numFmt numFmtId="166" formatCode="#,##0.00"/>' +
    '</numFmts>' +
    '<fonts count="3">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +                                   // 0 default
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +        // 1 header
    '<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font>' +        // 2 hyperlink
    '</fonts>' +
    '<fills count="6">' +
    '<fill><patternFill patternType="none"/></fill>' +                                     // 0
    '<fill><patternFill patternType="gray125"/></fill>' +                                  // 1 (reserved)
    '<fill><patternFill patternType="solid"><fgColor rgb="FF305496"/></patternFill></fill>' + // 2 header
    '<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/></patternFill></fill>' + // 3 good
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/></patternFill></fill>' + // 4 warn
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/></patternFill></fill>' + // 5 bad
    '</fills>' +
    '<borders count="2"><border/><border><bottom style="thin"><color rgb="FF999999"/></bottom></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="11">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                  // 0 default
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>' + // 1 header
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +             // 2 wrap
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                          // 3 datetime
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                          // 4 percent
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                          // 5 number
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                    // 6 hyperlink
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +                                    // 7 good
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>' +                                    // 8 warn
    '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>' +                                    // 9 bad
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                            // 10 integer
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
}

// Render one cell given its column type + a per-cell style override (highlight).
function renderCell(rowIdx, colIdx, value, colType, override) {
  const ref = cellRef(rowIdx, colIdx);
  const empty = value == null || String(value) === '';
  if (empty) return '<c r="' + ref + '"' + (override != null ? ' s="' + override + '"' : '') + '/>';
  if (colType === 'number' && isFiniteNumber(value)) return '<c r="' + ref + '" s="' + (override != null ? override : STYLE.number) + '"><v>' + Number(value) + '</v></c>';
  if (colType === 'integer' && isFiniteNumber(value)) return '<c r="' + ref + '" s="' + (override != null ? override : STYLE.integer) + '"><v>' + Math.round(Number(value)) + '</v></c>';
  if (colType === 'percent' && isFiniteNumber(value)) return '<c r="' + ref + '" s="' + (override != null ? override : STYLE.percent) + '"><v>' + Number(value) + '</v></c>';
  if (colType === 'datetime') { const s = excelSerial(value); if (s != null) return '<c r="' + ref + '" s="' + (override != null ? override : STYLE.datetime) + '"><v>' + s + '</v></c>'; }
  // text / url / fallback -> inline string (formula-injection neutralised)
  const style = override != null ? override : (colType === 'url' ? STYLE.hyperlink : STYLE.wrap);
  return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + esc(neutralize(value)) + '</t></is></c>';
}

function sheetXml(sheet) {
  const cols = sheet.columns || [];
  const rows = sheet.rows || [];
  const nCols = cols.length;
  const lastRow = rows.length + 1; // +1 header
  const dim = 'A1:' + colLetter(Math.max(0, nCols - 1)) + lastRow;

  let colsXml = '';
  if (nCols) {
    colsXml = '<cols>' + cols.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (Number(c.width) || 18) + '" customWidth="1"/>').join('') + '</cols>';
  }
  const pane = sheet.freeze_header === false ? '' : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>';
  const sheetViews = '<sheetViews><sheetView workbookViewId="0">' + pane + '</sheetView></sheetViews>';

  // header row
  let body = '<row r="1">' + cols.map((c, i) => '<c r="' + cellRef(0, i) + '" s="' + STYLE.header + '" t="inlineStr"><is><t xml:space="preserve">' + esc(c.header + (c.type === 'datetime' ? ' (МСК)' : '')) + '</t></is></c>').join('') + '</row>';
  // hyperlinks collected for the rels + <hyperlinks> block
  const links = [];
  rows.forEach((r, ri) => {
    const cells = cols.map((c, ci) => {
      const val = r[c.key];
      const override = (sheet.highlight ? styleForHighlight(sheet.highlight(r, c)) : null);
      if (c.type === 'url' && val) links.push({ ref: cellRef(ri + 1, ci), target: String(val) });
      return renderCell(ri + 1, ci, val, c.type || 'text', override);
    }).join('');
    body += '<row r="' + (ri + 2) + '">' + cells + '</row>';
  });

  let linksXml = '';
  if (links.length) linksXml = '<hyperlinks>' + links.map((l, i) => '<hyperlink ref="' + l.ref + '" r:id="rId' + (i + 1) + '"/>').join('') + '</hyperlinks>';
  const autoFilter = (sheet.autofilter === false || nCols === 0) ? '' : '<autoFilter ref="A1:' + colLetter(nCols - 1) + lastRow + '"/>';

  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="' + dim + '"/>' + sheetViews + '<sheetFormatPr defaultRowHeight="15"/>' +
    colsXml + '<sheetData>' + body + '</sheetData>' + autoFilter + linksXml + '</worksheet>';
  return { xml: xml, links: links };
}
function styleForHighlight(name) {
  if (name === 'good') return STYLE.good;
  if (name === 'warn') return STYLE.warn;
  if (name === 'bad') return STYLE.bad;
  return null;
}

// ---- workbook assembly -------------------------------------------------------------------------------
// sheets: [{ name, columns:[{header,key,type,width}], rows:[...], freeze_header, autofilter, highlight }]
function workbookBuffer(sheets) {
  sheets = (sheets || []).slice(0, 64);
  const usedNames = {};
  sheets.forEach((s, i) => { let n = sanitizeSheetName(s.name || ('Sheet' + (i + 1))); while (usedNames[n.toLowerCase()]) n = n.slice(0, 28) + '_' + (i + 1); usedNames[n.toLowerCase()] = 1; s._name = n; });

  const entries = [];
  // content types
  const overrides = sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
  entries.push({ name: '[Content_Types].xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    overrides + '</Types>' });
  entries.push({ name: '_rels/.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>' });

  // workbook.xml + its rels (sheet rels + styles rel)
  // B7: a sheet flagged hidden renders with state="hidden" (Excel/LibreOffice/Sheets hide it) — but never the
  // first sheet, since a workbook must keep at least one visible tab.
  const sheetsXml = sheets.map((s, i) => '<sheet name="' + esc(s._name) + '" sheetId="' + (i + 1) + '"' + ((s.hidden && i > 0) ? ' state="hidden"' : '') + ' r:id="rId' + (i + 1) + '"/>').join('');
  entries.push({ name: 'xl/workbook.xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheetsXml + '</sheets></workbook>' });
  const wbRels = sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('');
  entries.push({ name: 'xl/_rels/workbook.xml.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    wbRels + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>' });
  entries.push({ name: 'xl/styles.xml', data: stylesXml() });

  // each sheet + (optional) its hyperlink rels
  sheets.forEach((s, i) => {
    const r = sheetXml(s);
    entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: r.xml });
    if (r.links.length) {
      entries.push({ name: 'xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        r.links.map((l, k) => '<Relationship Id="rId' + (k + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + esc(l.target) + '" TargetMode="External"/>').join('') +
        '</Relationships>' });
    }
  });
  return zip(entries);
}

// Excel sheet-name rules: <=31 chars, no : \ / ? * [ ]
function sanitizeSheetName(n) {
  let s = String(n == null ? '' : n).replace(/[:\\\/?*\[\]]/g, ' ').trim().slice(0, 31);
  return s || 'Sheet';
}

// ---- read-back (for tests / re-open) -----------------------------------------------------------------
// Minimal ZIP reader: returns { name -> Buffer } by scanning local file headers. Handles the deflate method
// this writer emits. Lets tests re-open the workbook and assert OOXML parts, sheet names, cells, hyperlinks.
function readZip(buf) {
  const out = {};
  let i = 0;
  while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart = i + 30 + nameLen + extraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    out[name] = method === 0 ? comp : zlib.inflateRawSync(comp);
    i = dataStart + compSize;
  }
  return out;
}

module.exports = { workbookBuffer, zip, readZip, crc32, colLetter, cellRef, excelSerial, sanitizeSheetName, STYLE, esc };
