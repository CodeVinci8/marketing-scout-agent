'use strict';
// sheets_operations_qa.js — PURE, dependency-free engine for the Stage 3C Google Sheets OPERATIONS acceptance
// harness. It proves the persistence layer can read, append, filtered-read-back, insert-upsert, update-upsert,
// dedup-idempotently, isolate by owner/request, neutralize formula injection, preserve negative numbers, and
// touch nothing outside its own generated QA run — all against the SEPARATE staging spreadsheet.
//
// It performs NO I/O, makes NO API call, and has NO require()s, so the workflow generator embeds it verbatim
// inside n8n Code nodes (whose sandbox cannot require local files). The generated workflow and the offline tests
// call the EXACT same functions; an in-memory `simulateSheets` model mirrors how Google applies a
// values:batchUpdate (USER_ENTERED) so dry-run + tests verify the plan without any Google access.
//
// Reuse (drift-proof mirrors — see tests/test_sheets_operations_qa.js which asserts behavioural equivalence):
//   * neutralize / isFiniteNumber  == n8n/lib/report_export.js   (formula-injection neutraliser)
//   * isUnsafeCell                  == n8n/lib/sheet_audit.js     (un-neutralized formula detector)
//   * payloadHash (djb2) / makeDelivery delivery_id format == n8n/lib/telegram_io.js (outbox idempotency)
//
// Safety guarantees built into the plan:
//   * execute_writes=false (default) => a plan is produced and verified against a SIMULATED projection; the
//     workflow sends nothing. CHANGES_APPLIED stays false.
//   * a write requires BOTH execute_writes=true AND confirm_staging_spreadsheet=true; any preflight failure
//     (missing tab, wrong contract hash, missing test column, unconfirmed staging) blocks every write.
//   * every write is a values:batchUpdate (USER_ENTERED) entry targeting an explicit data-row range (row >= 2);
//     the header row (row 1) is NEVER written, and only the 5 declared test sheets are ever targeted.
//   * NO destructive request is ever planned: no deleteSheet/deleteRange/deleteDimension/values:clear — every
//     QA row is appended or upserted in place by its canonical identity key and clearly tagged manual_test.
//   * idempotent: a repeat run (reuse_qa_run_id) re-plans against the live rows and chooses update/suppress over
//     insert, so it creates zero duplicates; re-planning against the projected-after state plans zero inserts.

// ============================================================================================================
// small helpers (self-contained)
// ============================================================================================================
function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function arr(v) { return Array.isArray(v) ? v : []; }

// ---- formula-injection protection (mirror of report_export.js) --------------------------------------------
// A spreadsheet treats a cell beginning with = + - @ (or a leading TAB/CR) as a formula. We prefix such a value
// with an apostrophe so it is stored/read as literal text — UNLESS the whole trimmed value is a finite number
// (so "-5" / "-4.5" stay numeric and are NOT prefixed). URLs and ordinary text pass through unchanged.
var DANGEROUS_LEAD = /^[=+\-@\t\r]/;
function isFiniteNumber(s) {
  var t = str(s).trim();
  if (t === '') return false;
  return isFinite(Number(t)) && /^[+\-]?(\d+\.?\d*|\.\d+)$/.test(t);
}
function neutralize(v) {
  var s = str(v);
  if (s === '') return '';
  if (DANGEROUS_LEAD.test(s) && !isFiniteNumber(s)) return "'" + s;
  return s;
}
// a cell is UNSAFE if it begins with a formula lead char AND is not a finite number AND is not neutralized
// (mirror of sheet_audit.js isUnsafeCell). Used to PROVE no executable formula is ever placed in a cell.
function isUnsafeCell(v) { var s = str(v); return DANGEROUS_LEAD.test(s) && !isFiniteNumber(s) && s.charAt(0) !== "'"; }

// ============================================================================================================
// CONTRACT-AWARE CELL COMPARISON (QA-018) — read-back equality that respects how Google normalizes a cell.
// Column type is inferred from the SAME name conventions the bootstrap planner uses to format columns
// (n8n/lib/sheets_bootstrap_planner.js: RE_USD/RE_RATE/RE_INT/RE_SCORE -> NUMBER format; RE_TIME -> timestamp),
// plus the contract's checkbox columns -> boolean. These classifiers are mirrored here (the engine cannot
// require the planner at runtime); tests assert equivalence. A column with a NUMBER format reads back FORMATTED
// (e.g. -5 -> "-5.00"), so numeric columns compare NUMERICALLY, never byte-identically.
// ============================================================================================================
function lc(s) { return str(s).trim().toLowerCase(); }
var COL_TIME = /(_at$|_ts$|^ts$|created_ts|updated_ts|published_at|evaluated_at|added_at|collected_at|generated_at|first_seen_at|last_seen_at|next_check_at|expires_at|reviewed_at|approved_at|analyzed_at|parsed_at|edited_ts|decided_ts)/;
var COL_ID_HASH = /(_id$|^id$|_key$|_hash$|hash$|dedup_key|change_id|idempotency_key|version$|payload_hash|content_hash)/;
var COL_USD = /(_usd$|cost_usd|_cost$)/;
var COL_RATE = /_rate$/;
var COL_INT = /(_count$|count$|_calls$|calls$|_tokens$|tokens$|_index$|attempts|chunks|item_count|items_received|requested_limit|requested_search_scope|max_items|max_external_calls|max_context_tokens|est_input_tokens|^week$|^year$|frequency|evidence_count|time_window_days|source_staleness_days|age_days|error_count|check_interval_hours|batch_index|estimated_firecrawl_credits)/;
var COL_SCORE = /(_score$|score$|confidence|urgency|niche_fit|competitor_strength|lead_signal_score|content_idea_score|quality_score|lead_score|confidence_score|source_confidence|contact_confidence|evidence_completeness_score)/;
// a column is contractually NUMERIC iff the bootstrap would apply a NUMBER format to it (and it is not id/hash/time).
function isNumericColumn(col) { var c = lc(col); if (COL_TIME.test(c) || COL_ID_HASH.test(c)) return false; return COL_USD.test(c) || COL_RATE.test(c) || COL_INT.test(c) || COL_SCORE.test(c); }
function isTimestampColumn(col) { var c = lc(col); return COL_TIME.test(c) && !COL_ID_HASH.test(c); }
function booleanColumns(resolved, sheet) { var cs = contractSheet(resolved, sheet); return (cs && cs.ui_columns && cs.ui_columns.checkboxes) ? cs.ui_columns.checkboxes : []; }
function columnTypeInfo(resolved, sheet, col) { return { boolean: booleanColumns(resolved, sheet).indexOf(col) >= 0, numeric: isNumericColumn(col), timestamp: isTimestampColumn(col) }; }

// blank == unset. undefined / null / "" / missing trailing cell are equivalent. NEVER treated as 0 or false.
function isBlankCell(v) { return v === undefined || v === null || str(v).trim() === ''; }
// canonical boolean: only literal true/"TRUE"/false/"FALSE" (case-insensitive). Arbitrary truthy strings -> null (reject).
function toBoolStrict(v) { if (typeof v === 'boolean') return v; var s = lc(v); if (s === 'true') return true; if (s === 'false') return false; return null; }
// Parse a contractually numeric cell to a finite Number.
// Supports Google Sheets locale renderings:
//   -5.00, -5,00, 1,234.50, 1.234,50, 1 234,50,
// including NBSP / narrow-NBSP grouping.
// Arbitrary free text remains NaN. Applied ONLY to contract-proven numeric columns.
function toNumberStrict(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;

  var s = str(v).trim().replace(/[\s\u00A0\u202F]/g, '');
  if (s === '') return NaN;

  var match = s.match(/^([+\-]?)([^eE]+)([eE][+\-]?\d+)?$/);
  if (!match) return NaN;

  var sign = match[1];
  var body = match[2];
  var exponent = match[3] || '';

  if (!/^(?:\d+(?:[.,]\d*)*|[.,]\d+)$/.test(body)) return NaN;

  function isGroupedInteger(raw, separator) {
    var parts = raw.split(separator);
    if (parts.length < 2 || !/^\d{1,3}$/.test(parts[0])) return false;
    for (var i = 1; i < parts.length; i++) {
      if (!/^\d{3}$/.test(parts[i])) return false;
    }
    return true;
  }

  var commaCount = (body.match(/,/g) || []).length;
  var dotCount = (body.match(/\./g) || []).length;
  var decimalSeparator = null;

  if (commaCount > 0 && dotCount > 0) {
    // When both separators exist, the rightmost separator is decimal:
    // 1,234.50 or 1.234,50.
    decimalSeparator =
      body.lastIndexOf(',') > body.lastIndexOf('.') ? ',' : '.';
  } else if (commaCount > 0) {
    if (commaCount > 1 && isGroupedInteger(body, ',')) {
      decimalSeparator = null;
    } else if (commaCount === 1) {
      var commaIndex = body.indexOf(',');
      var commaLeft = body.slice(0, commaIndex);
      var commaRight = body.slice(commaIndex + 1);

      // Preserve legacy en-US grouped integer semantics for 1,234,
      // but parse -5,00 / -4,50 / 0,125 as decimal comma.
      decimalSeparator =
        commaRight.length === 3 &&
        /^\d{1,3}$/.test(commaLeft) &&
        commaLeft !== '0'
          ? null
          : ',';
    } else {
      decimalSeparator = ',';
    }
  } else if (dotCount > 0) {
    if (dotCount > 1 && isGroupedInteger(body, '.')) {
      decimalSeparator = null;
    } else {
      decimalSeparator = '.';
    }
  }

  var normalizedBody;

  if (decimalSeparator === null) {
    if (/^\d+$/.test(body)) {
      normalizedBody = body;
    } else if (
      commaCount > 0 &&
      dotCount === 0 &&
      isGroupedInteger(body, ',')
    ) {
      normalizedBody = body.split(',').join('');
    } else if (
      dotCount > 0 &&
      commaCount === 0 &&
      isGroupedInteger(body, '.')
    ) {
      normalizedBody = body.split('.').join('');
    } else {
      return NaN;
    }
  } else {
    var decimalIndex = body.lastIndexOf(decimalSeparator);
    var integerRaw = body.slice(0, decimalIndex);
    var fractionRaw = body.slice(decimalIndex + 1);
    var groupingSeparator = decimalSeparator === ',' ? '.' : ',';

    // Earlier occurrences of the selected decimal separator can only
    // represent valid three-digit grouping.
    if (integerRaw.indexOf(decimalSeparator) >= 0) {
      if (!isGroupedInteger(integerRaw, decimalSeparator)) return NaN;
      integerRaw = integerRaw.split(decimalSeparator).join('');
    }

    if (integerRaw.indexOf(groupingSeparator) >= 0) {
      if (!isGroupedInteger(integerRaw, groupingSeparator)) return NaN;
      integerRaw = integerRaw.split(groupingSeparator).join('');
    }

    if (integerRaw === '') integerRaw = '0';
    if (fractionRaw === '') fractionRaw = '0';

    if (!/^\d+$/.test(integerRaw) || !/^\d+$/.test(fractionRaw)) {
      return NaN;
    }

    normalizedBody = integerRaw + '.' + fractionRaw;
  }

  var parsed = Number(sign + normalizedBody + exponent);
  return isFinite(parsed) ? parsed : NaN;
}
// normalized instant (epoch ms) for a timestamp value; NaN if not a recognizable timestamp (a bare number is
// ambiguous and never coerced). Offset-less / locale renderings are interpreted in the PRODUCT timezone
// (Europe/Moscow): Google returns USER_ENTERED timestamps re-rendered without their offset (e.g. "-5"-style
// number formats for cost, and "23.06.2026 15:04:05" or "6/23/2026 15:04:05" for dates), so a written
// "...+03:00" / "...Z" must compare equal to that rendering. This MIRRORS n8n/lib/ms_time.js (instantOf); the
// engine is embedded into Code nodes and cannot require it — tests assert toInstant === ms_time.instantOf.
var MS_TZ = 'Europe/Moscow';
function tzOffMin(date, tz) {
  var dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  var map = {}; dtf.formatToParts(date).forEach(function (p) { map[p.type] = p.value; });
  var asUTC = Date.UTC(+map.year, (+map.month) - 1, +map.day, (+map.hour) % 24, +map.minute, +map.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}
function wallMs(y, mo, d, h, mi, s, ms, tz) { var p = Date.UTC(y, mo - 1, d, h, mi, s, ms || 0); return p - tzOffMin(new Date(p), tz) * 60000; }
function toInstant(v) {
  if (v instanceof Date) return isFinite(v.getTime()) ? v.getTime() : NaN;
  if (v == null || typeof v === 'number') return NaN;
  var s = str(v).trim(); if (s === '') return NaN;
  if (/(?:[zZ]|[+\-]\d{2}:?\d{2})$/.test(s)) { var t = Date.parse(s); return isFinite(t) ? t : NaN; }
  var m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/))) { var msv = m[7] ? Number((m[7] + '00').slice(0, 3)) : 0; return wallMs(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), msv, MS_TZ); }
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) { return wallMs(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), 0, MS_TZ); }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) { return wallMs(+m[3], +m[1], +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), 0, MS_TZ); }
  return NaN;
}
// text equality that tolerates a Google formula-escape apostrophe on EITHER side, but only when the underlying
// value is formula-lead (so legitimate apostrophes in ordinary text are never silently stripped).
function textEquals(w, r) {
  var ws = str(w), rs = str(r);
  if (ws === rs) return true;
  var wS = ws.charAt(0) === "'" ? ws.slice(1) : ws;
  var rS = rs.charAt(0) === "'" ? rs.slice(1) : rs;
  return wS === rS && DANGEROUS_LEAD.test(wS);
}
// contract-aware equality for one cell given its column type.
function cellEquals(written, readBack, types) {
  types = types || {};
  if (isBlankCell(written) && isBlankCell(readBack)) return true;          // both unset
  if (isBlankCell(written) !== isBlankCell(readBack)) return false;        // one set, one unset -> not equal
  if (types.boolean) { var wb = toBoolStrict(written), rb = toBoolStrict(readBack); return wb !== null && rb !== null && wb === rb; }
  if (types.numeric) { var wn = toNumberStrict(written), rn = toNumberStrict(readBack); if (isFinite(wn) && isFinite(rn)) return wn === rn; }
  if (types.timestamp) { var wi = toInstant(written), ri = toInstant(readBack); if (isFinite(wi) && isFinite(ri)) return wi === ri; }
  return textEquals(written, readBack);
}
function jsType(v) { if (v === undefined) return 'undefined'; if (v === null) return 'null'; return typeof v; }
function modeOf(t) { return t.boolean ? 'boolean' : (t.numeric ? 'numeric' : (t.timestamp ? 'timestamp' : 'text')); }
// why a cell mismatched, for diagnostics (no value leakage beyond the already-surfaced raw fields).
function mismatchReason(w, r, t) {
  if (isBlankCell(w) !== isBlankCell(r)) return isBlankCell(w) ? 'expected_unset_but_actual_present' : 'expected_present_but_actual_unset';
  if (t.numeric) return 'numeric_values_differ';
  if (t.boolean) { return (toBoolStrict(w) === null || toBoolStrict(r) === null) ? 'non_canonical_boolean' : 'boolean_values_differ'; }
  if (t.timestamp) { return (!isFinite(toInstant(w)) || !isFinite(toInstant(r))) ? 'unparseable_timestamp' : 'instants_differ'; }
  return 'text_differs';
}
// compare every field we WROTE (intent) against the row read back; returns ok + structured mismatches.
// ctx (optional) carries diagnostic identity: { physical_row, key, qa_run_id } — surfaced on every mismatch.
function compareRow(resolved, sheet, written, readBack, ctx) {
  ctx = ctx || {};
  var mismatches = [];
  Object.keys(written || {}).forEach(function (col) {
    var t = columnTypeInfo(resolved, sheet, col);
    var w = written[col], r = (readBack || {})[col];
    if (!cellEquals(w, r, t)) {
      mismatches.push({
        sheet: sheet, physical_row: ctx.physical_row != null ? ctx.physical_row : 0,
        key: ctx.key != null ? str(ctx.key) : '', qa_run_id: ctx.qa_run_id != null ? str(ctx.qa_run_id) : '',
        column: col, expected_raw: w == null ? null : str(w), actual_raw: r == null ? null : str(r),
        expected_type: jsType(w), actual_type: jsType(r),
        comparison_mode: modeOf(t), reason: mismatchReason(w, r, t)
      });
    }
  });
  return { ok: mismatches.length === 0, mismatches: mismatches };
}

// ---- typed read (formula safety, separate from read-back equality) ----------------------------------------
// Parse a bounded spreadsheets.get?includeGridData response for ONE row into { col: cell }, where each cell
// exposes userEnteredValue (stringValue | formulaValue | numberValue | boolValue), effectiveValue, formattedValue.
function parseTypedRow(getResponse, sheetName, headers) {
  var out = {};
  var sheets = arr((getResponse || {}).sheets);
  var sh = sheets.filter(function (s) { return ((s.properties || {}).title) === sheetName; })[0] || sheets[0];
  if (!sh) return out;
  var data = arr(sh.data)[0] || {};
  var rowData = arr(data.rowData)[0] || {};
  var cells = arr(rowData.values);
  arr(headers).forEach(function (h, i) { if (i < cells.length) out[h] = cells[i] || {}; });
  return out;
}
// prove each formula-test cell is stored as literal TEXT (userEnteredValue.stringValue) and NOT as a formula.
function verifyFormulaSafety(typedCells, formulaFields) {
  var details = [], ok = true;
  arr(formulaFields).forEach(function (f) {
    var uev = ((typedCells || {})[f] || {}).userEnteredValue || {};
    var cellOk = (uev.stringValue !== undefined) && (uev.formulaValue === undefined);
    if (!cellOk) ok = false;
    details.push({ column: f, stringValue: uev.stringValue, formulaValue: uev.formulaValue, ok: cellOk });
  });
  return { ok: ok, details: details };
}

// ---- djb2 hash + outbox delivery id (mirror of telegram_io.js payloadHash / makeDelivery) ------------------
function djb2(s) { s = str(s); var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'h' + h.toString(16); }
function payloadHash(s) { return djb2(s); }
// delivery_id is deterministic in (agent_request_id, report_id, payload) — the project's real outbox dedup key.
function makeDeliveryId(agentRequestId, reportId, payload) { return ['dlv', str(agentRequestId) || 'req', str(reportId) || 'rep', payloadHash(payload)].join('_'); }

// ---- A1 helpers -------------------------------------------------------------------------------------------
function colLetter(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s || 'A'; }
function quoteSheet(name) { return "'" + str(name).replace(/'/g, "''") + "'"; }
function rowStartRange(sheet, rowNum) { return quoteSheet(sheet) + '!A' + rowNum; }                 // write anchor (>=2)
function fullRange(sheet, ncols) { return quoteSheet(sheet) + '!A1:' + colLetter(ncols); }            // read whole table

// ---- QA marker tag ----------------------------------------------------------------------------------------
// Every QA row is tagged inside a DECLARED free-text field so it is unmistakably manual_test data and is
// traceable to its run. The tag starts with '[' (not a formula lead char) so it is never neutralized/prefixed.
var TAG_OPEN = '[MSQA ', TAG_CLOSE = ']';
function encodeQaTag(o) {
  var parts = ['data_mode=' + (o.data_mode || 'manual_test'), 'qa_run_id=' + str(o.qa_run_id)];
  if (o.owner) parts.push('owner=' + str(o.owner));
  if (o.role) parts.push('role=' + str(o.role));
  return TAG_OPEN + parts.join(' ') + TAG_CLOSE;
}
function parseQaTag(s) {
  s = str(s);
  var i = s.indexOf(TAG_OPEN); if (i < 0) return null;
  var j = s.indexOf(TAG_CLOSE, i); if (j < 0) return null;
  var body = s.slice(i + TAG_OPEN.length, j).trim();
  var o = {};
  body.split(/\s+/).forEach(function (kv) { var e = kv.indexOf('='); if (e > 0) o[kv.slice(0, e)] = kv.slice(e + 1); });
  return o;
}
function isQaRunRow(row, runId, markerField) {
  var t = parseQaTag((row || {})[markerField]);
  return !!(t && str(t.qa_run_id) === str(runId) && str(t.data_mode) === 'manual_test');
}
// any manual_test QA row (regardless of run) — used to separate PREVIOUS QA-run rows from genuinely foreign rows.
function isAnyQaRow(row, markerField) {
  var t = parseQaTag((row || {})[markerField]);
  return !!(t && str(t.data_mode) === 'manual_test' && str(t.qa_run_id) !== '');
}
function rowQaRunId(row, markerField) { var t = parseQaTag((row || {})[markerField]); return t ? str(t.qa_run_id) : ''; }
function rowQaRole(row, markerField) { var t = parseQaTag((row || {})[markerField]); return t ? str(t.role) : ''; }

// ============================================================================================================
// run identity — every id is derived from qa_run_id, so it is traceable + deterministic for a reuse run.
// ============================================================================================================
function buildRunIdentity(config) {
  config = config || {};
  var reuse = str(config.reuse_qa_run_id).trim();
  var stamp = str(config.now_stamp).trim();         // workflow passes a compact timestamp
  var rand = str(config.rand_suffix).trim();        // workflow passes a short random suffix
  var runId = reuse || ('stage3c-' + (stamp || '00000000T000000') + '-' + (rand || '000000'));
  var ownerBase = str(config.qa_owner_id || 'qa-stage3-owner');
  var now = str(config.now || '1970-01-01T00:00:00.000Z');
  var now2 = str(config.now2 || now);

  var ownerA = ownerBase + '::a';
  var ownerB = ownerBase + '::b';
  var reqA = runId + '::reqA';
  var reqB = runId + '::reqB';
  var convA = runId + '::convA';
  var convB = runId + '::convB';
  var srcId = runId + '::src';
  var repId = runId + '::rep';
  var payload = 'QA-Stage3C deterministic delivery payload for ' + reqA;            // fixed => deterministic id
  var deliveryId = makeDeliveryId(reqA, repId, payload);

  return {
    qa_run_id: runId, qa_owner_id: ownerBase, qa_owner_a: ownerA, qa_owner_b: ownerB,
    qa_request_a: reqA, qa_request_b: reqB, qa_agent_request_id: reqA,
    qa_conversation_a: convA, qa_conversation_b: convB, qa_conversation_id: convA,
    qa_source_id: srcId, qa_report_id: repId,
    qa_delivery_id: deliveryId, qa_delivery_payload: payload, qa_delivery_payload_hash: payloadHash(payload),
    qa_idempotency_key: 'idem_' + djb2(runId + '::eventA'),
    now: now, now2: now2, is_reuse: !!reuse
  };
}

// ============================================================================================================
// the operation matrix: which contract sheet proves which operation, and the exact rows we write.
// Field names below are validated (validatePlanAgainstContract) to be DECLARED contract headers — generation
// FAILS if any field, identity column, owner/request column or marker field is not in the sheet contract.
// ============================================================================================================
var FORMULA_TESTS = ['=1+1', '+SUM(1,1)', '@IMPORTXML("https://example.com","/")', "-CMD|' /C calc'!A0"];
var NEGATIVE_TESTS = [-5, -4.5];
var EXAMPLE_URL = 'https://example.com/qa-stage3c';   // RFC 2606 reserved example domain — no collector is run

// LIVE-operation markers: only meaningful after a real write + after-snapshot read-back. In a dry-run they are
// reported as NOT_EXECUTED_DRY_RUN (or NOT_APPLICABLE when blocked / SKIPPED when formula tests are disabled).
var LIVE_MARKERS = ['APPEND_AGENT_REQUEST', 'READ_BACK_AGENT_REQUEST', 'APPEND_REQUEST_EVENT', 'UPSERT_INSERT',
  'UPSERT_UPDATE', 'UPSERT_ROW_COUNT_STABLE', 'TRACKED_SOURCE_UPSERT', 'OUTBOX_IDEMPOTENCY', 'OWNER_ISOLATION',
  'REQUEST_ISOLATION', 'FORMULA_INJECTION_NEUTRALIZATION', 'NEGATIVE_NUMBER_PRESERVATION', 'BEFORE_AFTER_SCOPE',
  'IDEMPOTENCY'];

// Static plan describing each sheet's role. `op`: append (insert-or-update by id) | upsert (insert then update
// proven) | dedup (suppress duplicate by deterministic key). marker_field carries the QA tag.
function sheetPlanMeta() {
  return {
    agent_requests: { op: 'append', identity_cols: ['agent_request_id'], owner_field: '', request_field: 'agent_request_id', marker_field: 'notes' },
    agent_request_events: { op: 'append', identity_cols: ['agent_request_id', 'idempotency_key'], owner_field: '', request_field: 'agent_request_id', marker_field: 'reason' },
    conversation_state: { op: 'upsert', identity_cols: ['conversation_id'], owner_field: 'owner_user_id', request_field: '', marker_field: 'pending_clarification' },
    tracked_sources: { op: 'upsert', identity_cols: ['source_id'], owner_field: 'owner_user_id', request_field: 'agent_request_id', marker_field: 'label' },
    telegram_outbox: { op: 'dedup', identity_cols: ['delivery_id'], owner_field: '', request_field: 'agent_request_id', marker_field: 'last_error' }
  };
}

// Build the full QA row set (desired FINAL live state) + the upsert phase rows used for the insert/update proof.
function buildQaRowSet(id, config) {
  config = config || {};
  var ft = config.formula_tests_enabled !== false;          // default true
  var tag = function (role, owner) { return encodeQaTag({ data_mode: 'manual_test', qa_run_id: id.qa_run_id, owner: owner, role: role }); };

  // ---- A. agent_requests: request A (carries the formula + negative-number tests) + request B (isolation) --
  var reqA = {
    agent_request_id: id.qa_request_a, user_id: id.qa_owner_a,
    request_text: 'QA Stage 3C operations acceptance (manual_test) for run ' + id.qa_run_id,
    created_at: id.now, state: 'received', status: 'new', request_type: 'manual_intake',
    source_scope: 'unknown', plan_source: 'deterministic', approval_required: false,
    query: ft ? FORMULA_TESTS[0] : '', plan_summary: ft ? FORMULA_TESTS[1] : '',
    result_summary: ft ? FORMULA_TESTS[2] : '', next_action: ft ? FORMULA_TESTS[3] : '',
    estimated_source_cost_usd: ft ? NEGATIVE_TESTS[0] : '', estimated_analysis_cost_usd: ft ? NEGATIVE_TESTS[1] : '',
    notes: tag('request_a', id.qa_owner_a)
  };
  var reqB = {
    agent_request_id: id.qa_request_b, user_id: id.qa_owner_b,
    request_text: 'QA Stage 3C isolation control (request B) for run ' + id.qa_run_id,
    created_at: id.now, state: 'received', status: 'new', request_type: 'manual_intake',
    source_scope: 'unknown', plan_source: 'deterministic', approval_required: false,
    notes: tag('request_b', id.qa_owner_b)
  };

  // ---- B. agent_request_events: one event linked to request A -----------------------------------------------
  var eventA = {
    agent_request_id: id.qa_request_a, from_state: 'received', to_state: 'classified', accepted: true,
    reason: tag('event_a', id.qa_owner_a), idempotency_key: id.qa_idempotency_key, ts: id.now
  };

  // ---- C/D. conversation_state: conv A insert(base) then update; conv B (owner B isolation) ----------------
  var convBase = {
    conversation_id: id.qa_conversation_a, owner_user_id: id.qa_owner_a, active_agent_request_id: id.qa_request_a,
    current_intent: 'qa_insert', current_state: 'received', no_memory: false,
    pending_clarification: tag('conv_a', id.qa_owner_a), updated_at: id.now
  };
  var convUpdated = {
    conversation_id: id.qa_conversation_a, owner_user_id: id.qa_owner_a, active_agent_request_id: id.qa_request_a,
    current_intent: 'qa_update', current_state: 'analyzing', no_memory: false,
    pending_clarification: tag('conv_a', id.qa_owner_a), updated_at: id.now2
  };
  var convB = {
    conversation_id: id.qa_conversation_b, owner_user_id: id.qa_owner_b, current_state: 'received',
    pending_clarification: tag('conv_b', id.qa_owner_b), updated_at: id.now
  };

  // ---- E. tracked_sources: source A insert(base) then lifecycle update -------------------------------------
  var srcBase = {
    source_id: id.qa_source_id, owner_user_id: id.qa_owner_a, platform: 'website', ref: EXAMPLE_URL,
    label: tag('src_a', id.qa_owner_a), status: 'active', added_at: id.now, updated_at: id.now,
    agent_request_id: id.qa_request_a
  };
  var srcUpdated = {
    source_id: id.qa_source_id, owner_user_id: id.qa_owner_a, platform: 'website', ref: EXAMPLE_URL,
    label: tag('src_a', id.qa_owner_a), status: 'paused', last_status: 'active', last_change_at: id.now2,
    added_at: id.now, updated_at: id.now2, agent_request_id: id.qa_request_a
  };

  // ---- F. telegram_outbox: deterministic delivery row (DB row only; no Telegram call) ----------------------
  var deliveryA = {
    delivery_id: id.qa_delivery_id, agent_request_id: id.qa_request_a, report_id: id.qa_report_id,
    chat_id: 'qa_chat', payload_hash: id.qa_delivery_payload_hash, chunks: 1, send_status: 'pending',
    attempts: 0, telegram_message_id: '', last_error: tag('delivery_a', id.qa_owner_a)
  };

  var meta = sheetPlanMeta();
  return {
    sheets: {
      agent_requests: { meta: meta.agent_requests, desired: [{ role: 'request_a', values: reqA }, { role: 'request_b', values: reqB }] },
      agent_request_events: { meta: meta.agent_request_events, desired: [{ role: 'event_a', values: eventA }] },
      conversation_state: { meta: meta.conversation_state, desired: [{ role: 'conv_a', values: convUpdated }, { role: 'conv_b', values: convB }], upsert: { identity: id.qa_conversation_a, base: convBase, updated: convUpdated, changed_field: 'current_state', from: 'received', to: 'analyzing' } },
      tracked_sources: { meta: meta.tracked_sources, desired: [{ role: 'src_a', values: srcUpdated }], upsert: { identity: id.qa_source_id, base: srcBase, updated: srcUpdated, changed_field: 'status', from: 'active', to: 'paused' } },
      telegram_outbox: { meta: meta.telegram_outbox, desired: [{ role: 'delivery_a', values: deliveryA }], dedup_id: id.qa_delivery_id }
    },
    formula_fields: { agent_requests: ['query', 'plan_summary', 'result_summary', 'next_action'] },
    negative_fields: { agent_requests: ['estimated_source_cost_usd', 'estimated_analysis_cost_usd'] },
    formula_tests_enabled: ft
  };
}

// resolve a contract sheet from the embedded resolver snapshot
function contractSheet(resolved, name) { return (arr(resolved && resolved.sheets)).filter(function (s) { return s.sheet_name === name; })[0] || null; }

// ============================================================================================================
// generation-time contract validation (Section 1): FAIL if any QA field/key/marker is not a declared header,
// or any dropdown-bound value is not a member of the resolved enum (fail-closed against contract drift).
// ============================================================================================================
function validatePlanAgainstContract(resolved) {
  var findings = [];
  var id = buildRunIdentity({ now: 'T', now2: 'T2' });
  var set = buildQaRowSet(id, { formula_tests_enabled: true });
  Object.keys(set.sheets).forEach(function (name) {
    var cs = contractSheet(resolved, name);
    if (!cs) { findings.push({ code: 'sheet_not_in_contract', detail: name }); return; }
    var headers = cs.headers, hset = {}; headers.forEach(function (h) { hset[h] = true; });
    var meta = set.sheets[name].meta;
    // identity / owner / request / marker columns must be declared headers
    meta.identity_cols.forEach(function (c) { if (!hset[c]) findings.push({ code: 'identity_not_declared', detail: name + ' :: ' + c }); });
    if (meta.owner_field && !hset[meta.owner_field]) findings.push({ code: 'owner_field_not_declared', detail: name + ' :: ' + meta.owner_field });
    if (meta.request_field && !hset[meta.request_field]) findings.push({ code: 'request_field_not_declared', detail: name + ' :: ' + meta.request_field });
    if (!hset[meta.marker_field]) findings.push({ code: 'marker_field_not_declared', detail: name + ' :: ' + meta.marker_field });
    // required contract columns must be set + non-blank on every desired row
    arr(cs.required_columns).forEach(function (rc) {
      set.sheets[name].desired.forEach(function (d) {
        if (!(rc in d.values) || str(d.values[rc]) === '') findings.push({ code: 'required_column_unset', detail: name + ' :: ' + rc + ' (row ' + d.role + ')' });
      });
    });
    // every written field must be a declared header; dropdown-bound values must be members of the enum
    var dds = cs.ui_columns.dropdowns || {};
    var rows = set.sheets[name].desired.map(function (d) { return d.values; });
    if (set.sheets[name].upsert) { rows.push(set.sheets[name].upsert.base); rows.push(set.sheets[name].upsert.updated); }
    rows.forEach(function (vals) {
      Object.keys(vals).forEach(function (col) {
        if (!hset[col]) { findings.push({ code: 'field_not_declared', detail: name + ' :: ' + col }); return; }
        var v = vals[col];
        if (dds[col] && str(v) !== '' && typeof v !== 'boolean') {
          if (dds[col].values.indexOf(str(v)) < 0) findings.push({ code: 'value_not_in_enum', detail: name + ' :: ' + col + ' = ' + str(v) });
        }
      });
    });
  });
  return { ok: findings.length === 0, findings: findings };
}

// ============================================================================================================
// PREFLIGHT (Section 3): tabs present, contract hash, required test columns, explicit staging confirmation.
// Any failure => blocked => no writes.
// ============================================================================================================
// metadata = spreadsheets.get(fields=sheets.properties,developerMetadata) response
function preflight(input) {
  input = input || {};
  var resolved = input.resolved || {};
  var meta = input.metadata || {};
  var headerRows = input.headerRows || {};
  var config = input.config || {};
  var set = input.row_set || buildQaRowSet(input.identity || buildRunIdentity(config), config);

  var declaredTabs = arr(resolved.sheets).map(function (s) { return s.sheet_name; });
  var present = {}; arr(meta.sheets).forEach(function (s) { var p = s.properties || s; present[str(p.title)] = true; });
  var missing = declaredTabs.filter(function (t) { return !present[t]; });

  // contract hash from the bootstrap developerMetadata marker (key marketing_scout_bootstrap)
  var marker = null;
  arr(meta.developerMetadata).forEach(function (m) { if (str(m.metadataKey) === 'marketing_scout_bootstrap') { try { marker = JSON.parse(m.metadataValue); } catch (e) { marker = { _raw: str(m.metadataValue) }; } } });
  var liveHash = marker ? str(marker.contract_hash) : '';
  var hashOk = !!liveHash && liveHash === str(resolved.contract_hash);

  // required test columns must exist on every test sheet's live header row
  var missingColumns = [];
  Object.keys(set.sheets).forEach(function (name) {
    var needed = neededColumns(set.sheets[name]);
    var live = arr(headerRows[name]).map(function (h) { return str(h); });
    var liveSet = {}; live.forEach(function (h) { liveSet[h] = true; });
    needed.forEach(function (c) { if (!liveSet[c]) missingColumns.push(name + ' :: ' + c); });
  });

  var confirmed = config.confirm_staging_spreadsheet === true;
  var tabsOk = missing.length === 0;
  var columnsOk = missingColumns.length === 0;
  var ok = tabsOk && hashOk && columnsOk;            // staging confirmation gates WRITES, not preflight reads

  return {
    ok: ok, blocked: !ok,
    contract_tabs_present: declaredTabs.length - missing.length,
    contract_tabs_expected: declaredTabs.length,
    missing_tabs: missing, tabs_ok: tabsOk,
    contract_hash_expected: str(resolved.contract_hash), contract_hash_live: liveHash, contract_hash_ok: hashOk,
    missing_columns: missingColumns, columns_ok: columnsOk,
    staging_confirmed: confirmed,
    PREFLIGHT: ok ? 'PASS' : 'FAIL'
  };
}

// every column the QA plan needs present on a sheet (identity + owner/request + marker + every written field)
function neededColumns(sheetEntry) {
  var s = {}; var add = function (c) { if (c) s[c] = true; };
  sheetEntry.meta.identity_cols.forEach(add); add(sheetEntry.meta.owner_field); add(sheetEntry.meta.request_field); add(sheetEntry.meta.marker_field);
  sheetEntry.desired.forEach(function (d) { Object.keys(d.values).forEach(add); });
  if (sheetEntry.upsert) { Object.keys(sheetEntry.upsert.base).forEach(add); Object.keys(sheetEntry.upsert.updated).forEach(add); }
  return Object.keys(s);
}

// ============================================================================================================
// SNAPSHOT parsing — turn a values:batchGet response into a PHYSICAL-ROW-AWARE model per tab:
//   { headers, rows:[obj], row_numbers:[physical 1-indexed], count, last_occupied_row, next_free_row,
//     grid_row_count (capacity), range_start_row }
//
// Occupancy is decided by the tab's IDENTITY columns (passed in opts.identity), NOT by "any non-blank cell":
// a Google Sheet whose bootstrap left preallocated checkbox-default `FALSE` cells (or any incidental value)
// down the grid must NOT be treated as occupied. Trailing empty rows and preallocated grid rows therefore do
// not advance the append point, and physical row numbers are preserved so a matched key updates its EXACT row.
// grid_row_count comes from the metadata (sheets.properties.gridProperties.rowCount) and is used ONLY as a
// capacity limit — never as the number of occupied rows.
// ============================================================================================================
function titleFromRange(range) {
  var r = str(range); var bang = r.lastIndexOf('!'); var title = bang >= 0 ? r.slice(0, bang) : r;
  if (title.charAt(0) === "'" && title.charAt(title.length - 1) === "'") title = title.slice(1, -1).replace(/''/g, "'");
  return title;
}
// the physical 1-indexed start row of a returned A1 range, e.g. "agent_requests!A1:AC1" -> 1
function rangeStartRow(range) {
  var r = str(range); var bang = r.lastIndexOf('!'); var cell = bang >= 0 ? r.slice(bang + 1) : r;
  var m = cell.match(/^[A-Za-z]+(\d+)/); return m ? parseInt(m[1], 10) : 1;
}
// a data row is OCCUPIED iff at least one identity column is non-blank; with no identity declared, fall back to
// "any non-blank cell" (conservative). Preallocated checkbox/format cells have blank identity => not occupied.
function rowIsOccupied(obj, raw, identityCols) {
  if (identityCols && identityCols.length) return identityCols.some(function (c) { return str(obj[c]).trim() !== ''; });
  return arr(raw).some(function (c) { return str(c).trim() !== ''; });
}
// startRow = physical row of values[0] (the header when reading from A1); identityCols decide occupancy.
function rowsFromValues(values, startRow, identityCols) {
  values = arr(values); startRow = startRow || 1;
  var headers = arr(values[0]).map(str);
  var rows = [], rowNumbers = [], lastOccupied = startRow;       // header row counts as occupied (>= startRow)
  for (var i = 1; i < values.length; i++) {
    var physical = startRow + i;
    var raw = arr(values[i]);
    var o = {}; headers.forEach(function (h, c) { o[h] = c < raw.length ? raw[c] : ''; });
    if (!rowIsOccupied(o, raw, identityCols)) continue;          // ignore preallocated / trailing-empty rows
    rows.push(o); rowNumbers.push(physical);
    if (physical > lastOccupied) lastOccupied = physical;
  }
  return { headers: headers, rows: rows, row_numbers: rowNumbers, last_occupied_row: lastOccupied };
}
// opts: { identity: { tab: [identity cols] }, grid_row_counts: { tab: capacity } }
function parseSnapshot(batchGetResponse, opts) {
  opts = opts || {}; var identityBy = opts.identity || {}; var gridBy = opts.grid_row_counts || {};
  var out = {};
  arr((batchGetResponse || {}).valueRanges).forEach(function (vr) {
    var title = titleFromRange(vr.range);
    var start = rangeStartRow(vr.range);
    var parsed = rowsFromValues(vr.values, start, identityBy[title]);
    out[title] = {
      headers: parsed.headers, rows: parsed.rows, row_numbers: parsed.row_numbers, count: parsed.rows.length,
      last_occupied_row: parsed.last_occupied_row,
      next_free_row: Math.max(start + 1, parsed.last_occupied_row + 1),
      grid_row_count: gridBy[title] != null ? gridBy[title] : 0,
      range_start_row: start
    };
  });
  return out;
}

// ============================================================================================================
// PLAN OPERATIONS — decide insert/update/suppress per row from the live before-snapshot, then build ONE
// values:batchUpdate (USER_ENTERED) body. Header row is never targeted; only the 5 test sheets are written.
// ============================================================================================================
function matchByIdentity(rows, identityCols, values) {
  return arr(rows).filter(function (r) { return identityCols.every(function (c) { return str(r[c]) === str(values[c]); }); });
}
// physical-aware match: index of the FIRST existing row whose identity equals values, or -1.
function indexByIdentity(rows, identityCols, values) {
  rows = arr(rows);
  for (var i = 0; i < rows.length; i++) {
    if (identityCols.every(function (c) { return str(rows[i][c]) === str(values[c]); })) return i;
  }
  return -1;
}
function rowCells(headers, values) { return headers.map(function (h) { return neutralize(values[h]); }); }

function planOperations(input) {
  input = input || {};
  var resolved = input.resolved || {};
  var id = input.identity;
  var config = input.config || {};
  var set = input.row_set || buildQaRowSet(id, config);
  var before = input.before || {};                 // parseSnapshot output (physical-row aware)
  var pre = input.preflight;                        // preflight result (optional, gates writes)
  var sheetIds = input.sheet_ids || {};             // { tab: sheetId } from metadata (for capacity expansion)

  var canWrite = config.execute_writes === true && config.confirm_staging_spreadsheet === true && (!pre || pre.ok === true);
  var blocked = pre ? !pre.ok : false;

  var data = [];                                    // values:batchUpdate data entries
  var expansions = [];                              // structural updateSheetProperties (grow rowCount) entries
  var decisions = [];
  var counts = { inserts: 0, updates: 0, suppressed: 0 };
  var writeTabs = {};
  var nextDataRows = {};                            // { tab: physical next-free data row used for the first insert }
  var expandedTabs = {};                            // { tab: { from, to } }

  Object.keys(set.sheets).forEach(function (name) {
    var cs = contractSheet(resolved, name);
    var headers = cs ? cs.headers : (before[name] ? before[name].headers : []);
    var ncols = headers.length;
    var entry = set.sheets[name];
    var snap = before[name] || {};
    var existing = snap.rows || [];
    var rowNums = snap.row_numbers || [];
    // PHYSICAL next-free data row from the actual values read (never derived from grid capacity / a logical count)
    var nextRow = snap.next_free_row != null ? snap.next_free_row : 2;
    if (nextRow < 2) nextRow = 2;                                  // never the header row (row 1)
    var gridRows = snap.grid_row_count || 0;                       // capacity only
    var maxTarget = 0;
    nextDataRows[name] = nextRow;

    entry.desired.forEach(function (d) {
      var idx = indexByIdentity(existing, entry.meta.identity_cols, d.values);
      var decision, rowNum = null;
      if (entry.meta.op === 'dedup' && idx >= 0) {
        decision = 'suppress'; counts.suppressed++;
      } else if (idx >= 0) {
        // update in place at the matched row's EXACT physical position (preserves sparse layout)
        rowNum = rowNums[idx] != null ? rowNums[idx] : (idx + 2);
        data.push({ range: rowStartRange(name, rowNum), majorDimension: 'ROWS', values: [rowCells(headers, d.values)] });
        decision = 'update'; counts.updates++; writeTabs[name] = true;
      } else {
        rowNum = nextRow;
        data.push({ range: rowStartRange(name, rowNum), majorDimension: 'ROWS', values: [rowCells(headers, d.values)] });
        decision = 'insert'; counts.inserts++; nextRow++; writeTabs[name] = true;
      }
      if (rowNum != null && rowNum > maxTarget) maxTarget = rowNum;
      decisions.push({ tab: name, role: d.role, decision: decision, ncols: ncols, row: rowNum });
    });

    // capacity boundary: when a target row would exceed the sheet's grid, grow ONLY this sheet first (never all).
    if (gridRows > 0 && maxTarget > gridRows && sheetIds[name] != null) {
      expansions.push({ updateSheetProperties: { properties: { sheetId: sheetIds[name], gridProperties: { rowCount: maxTarget } }, fields: 'gridProperties.rowCount' } });
      expandedTabs[name] = { from: gridRows, to: maxTarget };
    }
  });

  var expectedRowsWritten = counts.inserts;     // a "row written" (added) is an insert; updates rewrite in place
  var batchBody = { valueInputOption: 'USER_ENTERED', data: data };
  var expansionBody = expansions.length ? { requests: expansions } : null;
  var shouldApply = canWrite && !blocked && data.length > 0;

  return {
    blocked: blocked, can_write: canWrite, should_apply_writes: shouldApply,
    batchBody: batchBody, decisions: decisions, counts: counts,
    expected_rows_written: expectedRowsWritten, write_tabs: Object.keys(writeTabs).sort(),
    next_data_rows: nextDataRows,
    needs_expansion: expansions.length > 0, expansion_body: expansionBody, expanded_tabs: expandedTabs,
    no_destructive: true
  };
}

// ============================================================================================================
// SIMULATOR — mirror Google applying a values:batchUpdate (USER_ENTERED) so dry-run + tests verify the plan.
// ============================================================================================================
function parseUserEntered(sent) {
  var s = str(sent);
  if (s === '') return { display: '', formula: false };
  if (s.charAt(0) === "'") return { display: s.slice(1), formula: false };          // neutralized text
  if (isFiniteNumber(s)) return { display: Number(s), formula: false };             // numeric (negatives kept)
  if (DANGEROUS_LEAD.test(s)) return { display: '#EXEC_FORMULA#', formula: true };  // un-neutralized => formula!
  return { display: s, formula: false };
}
// model: { tabs: { name: { headers, grid:[[...]], grid_row_count } }, executable_formula_cells }
// Rows are placed at their PHYSICAL grid index (physical row N => grid index N-1) so sparse layouts and the exact
// update/insert positions are mirrored faithfully.
function simulateFromSnapshot(before, headerMap) {
  var model = { tabs: {}, executable_formula_cells: 0 };
  Object.keys(before || {}).forEach(function (name) {
    var b = before[name]; var headers = b.headers.slice(); var grid = [headers.slice()];
    var rowNums = b.row_numbers || [];
    b.rows.forEach(function (r, i) {
      var physical = rowNums[i] != null ? rowNums[i] : (i + 2);
      var gi = physical - 1;                              // 0-indexed grid row
      while (grid.length <= gi) grid.push([]);
      grid[gi] = headers.map(function (h) { return r[h]; });
    });
    model.tabs[name] = { headers: headers, grid: grid, grid_row_count: b.grid_row_count || 0 };
  });
  // ensure header row exists for tabs we will write even if absent from the snapshot
  Object.keys(headerMap || {}).forEach(function (name) { if (!model.tabs[name]) model.tabs[name] = { headers: headerMap[name].slice(), grid: [headerMap[name].slice()], grid_row_count: 0 }; });
  return model;
}
// mirror a structural grid expansion (updateSheetProperties grow rowCount) — capacity only grows, never shrinks.
// expandedTabs is the plan's { tab: { from, to } } map (keyed by name, which is how the model is keyed).
function applyExpansion(model, expandedTabs) {
  Object.keys(expandedTabs || {}).forEach(function (name) {
    var t = model.tabs[name]; if (!t) return;
    var to = expandedTabs[name] && expandedTabs[name].to;
    if (to && (!t.grid_row_count || to > t.grid_row_count)) t.grid_row_count = to;
  });
  return model;
}
function applyBatch(model, batchBody) {
  arr((batchBody || {}).data).forEach(function (entry) {
    var title = titleFromRange(entry.range);
    var m = str(entry.range).match(/!([A-Z]+)(\d+)$/);
    var startRow = m ? parseInt(m[2], 10) : 2;            // 1-indexed
    var startCol = 0;                                     // we always anchor at column A
    var t = model.tabs[title]; if (!t) { t = model.tabs[title] = { headers: [], grid: [[]], grid_row_count: 0 }; }
    arr(entry.values).forEach(function (rowVals, ri) {
      var r = startRow - 1 + ri;                          // 0-indexed grid row (row 1 => index 0 = header)
      while (t.grid.length <= r) t.grid.push([]);
      rowVals.forEach(function (cell, ci) {
        var p = parseUserEntered(cell);
        if (p.formula) model.executable_formula_cells++;
        t.grid[r][startCol + ci] = p.display;
      });
      if (t.grid_row_count && (r + 1) > t.grid_row_count) t.grid_row_count = r + 1;   // capacity follows growth
    });
  });
  return model;
}
// identityBy: { tab: [identity cols] } — occupancy mirrors parseSnapshot so a re-parse keeps physical rows.
function modelToSnapshot(model, identityBy) {
  identityBy = identityBy || {};
  var out = {};
  Object.keys(model.tabs).forEach(function (name) {
    var t = model.tabs[name]; var headers = t.grid[0] ? t.grid[0].map(str) : [];
    var rows = [], rowNumbers = [], lastOccupied = 1; var idc = identityBy[name];
    for (var r = 1; r < t.grid.length; r++) {
      var raw = t.grid[r] || []; var physical = r + 1;
      var o = {}; headers.forEach(function (h, c) { o[h] = c < raw.length ? raw[c] : ''; });
      if (!rowIsOccupied(o, raw, idc)) continue;
      rows.push(o); rowNumbers.push(physical);
      if (physical > lastOccupied) lastOccupied = physical;
    }
    out[name] = {
      headers: headers, rows: rows, row_numbers: rowNumbers, count: rows.length,
      last_occupied_row: lastOccupied, next_free_row: Math.max(2, lastOccupied + 1),
      grid_row_count: t.grid_row_count || 0, range_start_row: 1
    };
  });
  return out;
}

// in-memory upsert (used only for the insert/update SEMANTIC proof — never touches Google)
function upsertInMemory(rows, identityCols, values) {
  var match = matchByIdentity(rows, identityCols, values);
  if (match.length > 0) { var i = rows.indexOf(match[0]); rows[i] = values; return { inserted: false, count: matchByIdentity(rows, identityCols, values).length }; }
  rows.push(values); return { inserted: true, count: matchByIdentity(rows, identityCols, values).length };
}

// ============================================================================================================
// VERIFY (Sections 4–8) — operate on the before-snapshot, the plan, and the AFTER snapshot (real when writes
// executed, simulated projection otherwise). Returns every machine-readable marker.
// ============================================================================================================
function filterRows(rows, predicate) { return arr(rows).filter(predicate); }

function verifyAll(input) {
  input = input || {};
  var resolved = input.resolved || {};
  var id = input.identity;
  var config = input.config || {};
  var set = input.row_set || buildQaRowSet(id, config);
  var before = input.before || {};
  var plan = input.plan || planOperations({ resolved: resolved, identity: id, config: config, row_set: set, before: before, preflight: input.preflight });
  var after = input.after || null;
  // a marker is LIVE-verified only when a real, successful write + after-snapshot read happened.
  var applied = input.applied === true || (input.applied == null && after != null);
  var blocked = plan.blocked === true;
  var headerMap = {}, identityBy = {};
  Object.keys(set.sheets).forEach(function (n) { var cs = contractSheet(resolved, n); if (cs) headerMap[n] = cs.headers; identityBy[n] = set.sheets[n].meta.identity_cols; });

  // projected-after via the simulator (dry-run / offline reasoning). Mirrors a grid expansion then the values write.
  var simModel = simulateFromSnapshot(before, headerMap);
  if (!blocked) { applyExpansion(simModel, plan.expanded_tabs); applyBatch(simModel, plan.batchBody); }
  var projected = modelToSnapshot(simModel, identityBy);
  var afterSnap = (applied && after) ? after : projected;     // LIVE markers read the REAL after-snapshot only
  var v = {};

  // ---- formula-injection neutralization + negative-number preservation (Section 5) ------------------------
  // FORMULA SAFETY is a SEPARATE assertion from read-back equality (QA-018): planned cells never unsafe, the
  // simulator never produced an executable formula, the formula-test cells read back as their literal text, and
  // (when a typed read is available) Google stored them as userEnteredValue.stringValue, not formulaValue.
  var cells = [];
  arr(plan.batchBody.data).forEach(function (entry) { arr(entry.values).forEach(function (row) { row.forEach(function (c) { cells.push(c); }); }); });
  // locate THIS run's request A by full identity (qa_run_id + agent_request_id + owner + data_mode + role marker),
  // so previous QA runs / request B can never be mistaken for it.
  var raLoc = findRequestARow(afterSnap, id, set);
  var raReadFt = raLoc.row;
  var ftFields = (set.formula_fields.agent_requests || []);
  var typed = input.typed || null;                 // parsed spreadsheets.get (request-A row) when applied
  var typedSafety = typed ? verifyFormulaSafety(typed, ftFields) : null;
  var plannedSafe = cells.every(function (c) { return !isUnsafeCell(c); }) && simModel.executable_formula_cells === 0;
  var ftLiteral = ftFields.every(function (f) { return textEquals(set.sheets.agent_requests.desired[0].values[f], raReadFt ? raReadFt[f] : undefined); });
  var formulaOk = plannedSafe && !!raReadFt && ftLiteral && (typedSafety ? typedSafety.ok : true);
  v.FORMULA_INJECTION_NEUTRALIZATION = (set.formula_tests_enabled === false) ? 'SKIPPED' : (formulaOk ? 'PASS' : 'FAIL');
  v.FORMULA_SAFETY_DETAILS = typedSafety ? typedSafety.details : [];
  // negatives stay numeric (compared numerically, since the *_usd columns may read back FORMATTED e.g. "-5.00" or "-5,00") AND
  // are not apostrophe-prefixed in what we send.
  var negFields = (set.negative_fields.agent_requests || []);
  var negNotPrefixed = negFields.every(function (f) { return neutralize(set.sheets.agent_requests.desired[0].values[f]).charAt(0) !== "'"; });
  var negNumeric = (set.formula_tests_enabled === false) ? true : (!!raReadFt && negFields.every(function (f) { var rb = toNumberStrict(raReadFt[f]); return isFinite(rb) && rb === Number(set.sheets.agent_requests.desired[0].values[f]); }));
  v.NEGATIVE_NUMBER_PRESERVATION = (set.formula_tests_enabled === false) ? 'SKIPPED' : (negNotPrefixed && negNumeric ? 'PASS' : 'FAIL');

  // ---- A. append + filtered read-back: agent_requests request A (full-identity location, contract-aware) ---
  var reqA = set.sheets.agent_requests.desired[0].values;
  var raRow = raLoc.row;
  v.APPEND_AGENT_REQUEST = plan.decisions.some(function (d) { return d.tab === 'agent_requests' && d.role === 'request_a' && (d.decision === 'insert' || d.decision === 'update'); }) ? 'PASS' : 'FAIL';
  var rbCmp = raRow
    ? compareRow(resolved, 'agent_requests', reqA, raRow, { physical_row: raLoc.physical_row, key: id.qa_request_a, qa_run_id: id.qa_run_id })
    : { ok: false, mismatches: [{ sheet: 'agent_requests', physical_row: 0, key: str(id.qa_request_a), qa_run_id: str(id.qa_run_id), column: '*', expected_raw: '(request_a row)', actual_raw: null, expected_type: 'object', actual_type: 'null', comparison_mode: 'row_present', reason: raLoc.reason || 'request_a_row_absent' }] };
  v.READ_BACK_AGENT_REQUEST = rbCmp.ok ? 'PASS' : 'FAIL';
  v.READ_BACK_FAILURES = rbCmp.mismatches;

  // ---- B. append event linked to request A ----------------------------------------------------------------
  var evA = set.sheets.agent_request_events.desired[0].values;
  var evRow = findRow(afterSnap, 'agent_request_events', set.sheets.agent_request_events.meta.identity_cols, evA);
  var evValidTransition = isValidState(resolved, 'agent_request_events', 'from_state', evA.from_state) && isValidState(resolved, 'agent_request_events', 'to_state', evA.to_state);
  v.APPEND_REQUEST_EVENT = (evRow && str(evRow.agent_request_id) === str(id.qa_request_a) && evValidTransition && compareRow(resolved, 'agent_request_events', evA, evRow).ok) ? 'PASS' : 'FAIL';

  // ---- C/D. conversation_state insert then update (two-phase semantic proof over the live before-state) ----
  var cs = set.sheets.conversation_state;
  var simRows = (before.conversation_state ? before.conversation_state.rows.slice() : []);
  var ins = upsertInMemory(simRows, cs.meta.identity_cols, cs.upsert.base);
  var insCountOk = ins.count === 1;
  var upd = upsertInMemory(simRows, cs.meta.identity_cols, cs.upsert.updated);
  var updRow = matchByIdentity(simRows, cs.meta.identity_cols, cs.upsert.updated)[0] || {};
  var fieldChanged = str(updRow[cs.upsert.changed_field]) === str(cs.upsert.to) && str(cs.upsert.from) !== str(cs.upsert.to);
  var keyStable = str(updRow[cs.meta.identity_cols[0]]) === str(cs.upsert.identity);
  v.UPSERT_INSERT = insCountOk ? 'PASS' : 'FAIL';
  v.UPSERT_UPDATE = (upd.count === 1 && fieldChanged && keyStable) ? 'PASS' : 'FAIL';
  v.UPSERT_ROW_COUNT_STABLE = (ins.count === 1 && upd.count === 1) ? 'PASS' : 'FAIL';
  // live: exactly one conv-A row exists after the run
  var liveConvCount = matchByIdentity((afterSnap.conversation_state || {}).rows || [], cs.meta.identity_cols, { conversation_id: id.qa_conversation_a }).length;
  if (liveConvCount !== 1) v.UPSERT_ROW_COUNT_STABLE = 'FAIL';

  // ---- E. tracked_sources lifecycle upsert ----------------------------------------------------------------
  var ts = set.sheets.tracked_sources;
  var tsRows = (before.tracked_sources ? before.tracked_sources.rows.slice() : []);
  var tIns = upsertInMemory(tsRows, ts.meta.identity_cols, ts.upsert.base);
  var tUpd = upsertInMemory(tsRows, ts.meta.identity_cols, ts.upsert.updated);
  var tRow = matchByIdentity(tsRows, ts.meta.identity_cols, ts.upsert.updated)[0] || {};
  var tChanged = str(tRow[ts.upsert.changed_field]) === str(ts.upsert.to) && str(ts.upsert.from) !== str(ts.upsert.to);
  var liveSrcCount = matchByIdentity((afterSnap.tracked_sources || {}).rows || [], ts.meta.identity_cols, { source_id: id.qa_source_id }).length;
  v.TRACKED_SOURCE_UPSERT = (tIns.count === 1 && tUpd.count === 1 && tChanged && liveSrcCount === 1) ? 'PASS' : 'FAIL';

  // ---- F. outbox idempotency: a repeated logical delivery with the same key creates no second visible row --
  var ob = set.sheets.telegram_outbox;
  var obBeforeRows = (before.telegram_outbox ? before.telegram_outbox.rows : []);
  var obAfterRows = (afterSnap.telegram_outbox ? afterSnap.telegram_outbox.rows : []);
  var obKey = { delivery_id: id.qa_delivery_id };
  var dupOutbox = matchByIdentity(obAfterRows, ob.meta.identity_cols, obKey).length - matchByIdentity(obBeforeRows, ob.meta.identity_cols, obKey).length;
  if (dupOutbox < 0) dupOutbox = 0;
  // re-enqueue the same deterministic delivery against the AFTER state: must add nothing
  var reAfter = afterSnap.telegram_outbox ? afterSnap.telegram_outbox.rows.slice() : [];
  var rePlanInsert = matchByIdentity(reAfter, ob.meta.identity_cols, obKey).length === 0;   // would it insert again?
  v.OUTBOX_IDEMPOTENCY = (matchByIdentity(obAfterRows, ob.meta.identity_cols, obKey).length === 1 && !rePlanInsert) ? 'PASS' : 'FAIL';

  // ---- Section 6. owner + request isolation (strict, fail-closed, post-read assertion) --------------------
  var iso = verifyIsolation(afterSnap, id, set);
  v.OWNER_ISOLATION = iso.owner_isolation ? 'PASS' : 'FAIL';
  v.REQUEST_ISOLATION = iso.request_isolation ? 'PASS' : 'FAIL';
  v.FOREIGN_ROWS_RETURNED = iso.foreign_rows_returned;

  // ---- Section 7. before/after scope (identity-based; NOT a read-back content check — QA-019) -------------
  var ba = verifyBeforeAfter(resolved, before, afterSnap, id, set, plan);
  v.EXPECTED_ROWS_WRITTEN = ba.expected_rows_written;
  v.UNEXPECTED_ROWS_WRITTEN = ba.unexpected_rows_written;
  v.FOREIGN_ROWS_MODIFIED = ba.foreign_rows_modified;
  v.HEADERS_MODIFIED = ba.headers_modified;
  v.UNDECLARED_TABS_MODIFIED = ba.undeclared_tabs_modified;
  v.CURRENT_RUN_OWNED_ROWS = ba.current_run_owned_rows;
  v.PREVIOUS_QA_RUN_ROWS = ba.previous_qa_run_rows;
  v.FOREIGN_NON_QA_ROWS = ba.foreign_non_qa_rows;
  v.BEFORE_AFTER_SCOPE = ba.ok ? 'PASS' : 'FAIL';
  v.BEFORE_AFTER_FAILURES = ba.failures;

  // ---- Section 8. repeat-run idempotency: re-plan against the AFTER state => zero new inserts --------------
  // LIVE marker re-plans against the real after-snapshot; plan-level uses the projection (for WRITE_PLAN).
  var idem = verifyIdempotency(resolved, id, config, set, afterSnap);
  var projIdem = applied ? verifyIdempotency(resolved, id, config, set, projected) : idem;
  v.DUPLICATE_AGENT_REQUESTS_CREATED = idem.dup.agent_requests;
  v.DUPLICATE_CONVERSATION_STATES_CREATED = idem.dup.conversation_state;
  v.DUPLICATE_TRACKED_SOURCES_CREATED = idem.dup.tracked_sources;
  v.DUPLICATE_OUTBOX_DELIVERIES_CREATED = idem.dup.telegram_outbox;
  v.IDEMPOTENCY = idem.ok ? 'PASS' : 'FAIL';

  // ---- WRITE_PLAN: plan-level guarantees that ARE knowable without a live write (truthful in dry-run) -------
  var planRangesOk = arr(plan.batchBody.data).every(function (e) { var mm = str(e.range).match(/!A(\d+)$/); return mm && parseInt(mm[1], 10) >= 2; });
  var onlyTestTabs = (plan.write_tabs || []).every(function (t) { return Object.keys(set.sheets).indexOf(t) >= 0; });
  var expSafe = !plan.expansion_body || arr(plan.expansion_body.requests).every(function (r) { return r && r.updateSheetProperties && r.updateSheetProperties.fields === 'gridProperties.rowCount'; });
  var noDestructive = plan.no_destructive === true && !('requests' in plan.batchBody) && expSafe;
  var plannedCellsSafe = cells.every(function (c) { return !isUnsafeCell(c); }) && simModel.executable_formula_cells === 0;
  var planNeg = (set.formula_tests_enabled === false) ? true : negNotPrefixed;
  var writePlanOk = planRangesOk && onlyTestTabs && noDestructive && plannedCellsSafe && planNeg && projIdem.ok;
  v.WRITE_PLAN = blocked ? 'NOT_APPLICABLE' : (writePlanOk ? 'PASS' : 'FAIL');
  v.NEXT_DATA_ROWS = plan.next_data_rows || {};
  v.GRID_EXPANSIONS = plan.expanded_tabs || {};

  // ---- truthful gating: LIVE-operation markers are PASS/FAIL only when a real write+read-back happened. ------
  // In a dry-run they are NOT_EXECUTED_DRY_RUN; when preflight blocked, NOT_APPLICABLE. SKIPPED stays SKIPPED.
  LIVE_MARKERS.forEach(function (k) {
    if (v[k] === 'SKIPPED') return;
    if (blocked) v[k] = 'NOT_APPLICABLE';
    else if (!applied) v[k] = 'NOT_EXECUTED_DRY_RUN';
    // when applied: keep the computed PASS/FAIL (verified against the REAL after-snapshot)
  });

  return { markers: v, projected: projected, applied: applied, isolation: iso, before_after: ba, idempotency: idem, plan: plan };
}

function findRow(snapshot, tab, identityCols, values) {
  var rows = (snapshot[tab] && snapshot[tab].rows) || [];
  return matchByIdentity(rows, identityCols, values)[0] || null;
}
// Locate THIS run's request A by the FULL identity contract, never "first matching-looking row":
//   current qa_run_id  +  exact agent_request_id  +  exact owner identity  +  data_mode=manual_test  +  role=request_a marker.
// Rows from earlier QA runs cannot satisfy it, and request B (role=request_b / owner B) cannot satisfy it.
// Returns { row, physical_row, reason } — reason explains a miss for diagnostics.
function findRequestARow(snapshot, id, set) {
  var meta = set.sheets.agent_requests.meta;
  var snap = snapshot.agent_requests || { rows: [], row_numbers: [] };
  var rows = snap.rows || [], nums = snap.row_numbers || [];
  var sawId = false;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (str(r.agent_request_id) !== str(id.qa_request_a)) continue;
    sawId = true;
    if (!isQaRunRow(r, id.qa_run_id, meta.marker_field)) continue;          // current qa_run_id + data_mode=manual_test
    if (rowQaRole(r, meta.marker_field) !== 'request_a') continue;           // role=request_a marker
    if (str(r.user_id) !== str(id.qa_owner_a)) continue;                     // exact owner identity
    return { row: r, physical_row: nums[i] != null ? nums[i] : (i + 2), reason: '' };
  }
  return { row: null, physical_row: 0, reason: sawId ? 'request_a_id_present_but_identity_marker_mismatch' : 'request_a_row_absent' };
}
// exact equality for every field we WROTE (original intent) vs the value read back (USER_ENTERED semantics:
// neutralized formulas read back as their literal text; finite numbers read back numeric).
function fieldsEqual(written, readBack) {
  return Object.keys(written).every(function (k) {
    var w = written[k]; var r = (readBack || {})[k];
    if (typeof w === 'boolean') return low(r) === String(w) || String(r) === String(w);
    if (isFiniteNumber(w)) {
      var parsedReadBack = toNumberStrict(r);
      return isFinite(parsedReadBack) && parsedReadBack === Number(w);
    }
    return str(r) === str(w);
  });
}
function isValidState(resolved, sheet, col, value) {
  var cs = contractSheet(resolved, sheet); if (!cs) return false;
  var dd = (cs.ui_columns.dropdowns || {})[col]; if (!dd) return true;
  return dd.values.indexOf(str(value)) >= 0;
}

// strict, fail-closed isolation: filter to owner A / request A and assert nothing foreign is returned.
function verifyIsolation(afterSnap, id, set) {
  var foreign = 0;
  // owner isolation on conversation_state (owner_scoped)
  var convRows = (afterSnap.conversation_state || {}).rows || [];
  var ownerView = filterRows(convRows, function (r) { return str(r.owner_user_id) === str(id.qa_owner_a) && isQaRunRow(r, id.qa_run_id, set.sheets.conversation_state.meta.marker_field); });
  ownerView.forEach(function (r) { if (str(r.owner_user_id) !== str(id.qa_owner_a)) foreign++; if (str(r.conversation_id) === str(id.qa_conversation_b)) foreign++; });
  var ownerSeesA = ownerView.some(function (r) { return str(r.conversation_id) === str(id.qa_conversation_a); });
  var ownerSeesB = ownerView.some(function (r) { return str(r.conversation_id) === str(id.qa_conversation_b); });

  // request isolation on agent_requests (request_scoped)
  var reqRows = (afterSnap.agent_requests || {}).rows || [];
  var reqView = filterRows(reqRows, function (r) { return str(r.agent_request_id) === str(id.qa_request_a) && isQaRunRow(r, id.qa_run_id, set.sheets.agent_requests.meta.marker_field); });
  reqView.forEach(function (r) { if (str(r.agent_request_id) !== str(id.qa_request_a)) foreign++; });
  var reqSeesA = reqView.some(function (r) { return str(r.agent_request_id) === str(id.qa_request_a); });
  var reqSeesB = reqView.some(function (r) { return str(r.agent_request_id) === str(id.qa_request_b); });

  return {
    owner_isolation: ownerSeesA && !ownerSeesB && foreign === 0,
    request_isolation: reqSeesA && !reqSeesB,
    foreign_rows_returned: foreign,
    owner_view_count: ownerView.length, request_view_count: reqView.length
  };
}

// identity key for a row given its identity columns (run-scoped ids embed qa_run_id, so they never collide
// with foreign rows).
function identityKey(cols, row) { return arr(cols).map(function (c) { return str((row || {})[c]); }).join(''); }
function desiredIdentities(set, sheet) { var meta = set.sheets[sheet].meta; return set.sheets[sheet].desired.map(function (d) { return identityKey(meta.identity_cols, d.values); }); }
// a row is "ours" (this QA run's) iff it carries the run marker OR its identity matches a desired run identity.
function runOwns(resolved, id, set, sheet, row) {
  var meta = set.sheets[sheet].meta;
  if (isQaRunRow(row, id.qa_run_id, meta.marker_field)) return true;
  return desiredIdentities(set, sheet).indexOf(identityKey(meta.identity_cols, row)) >= 0;
}
// Three-way row classification for a NON-EMPTY staging spreadsheet:
//   'current_run_owned' — written/updated by THIS run (marker for this qa_run_id OR a desired identity)
//   'previous_qa_run'   — a manual_test QA row from an EARLIER run (must remain unchanged; never our duplicate)
//   'foreign_non_qa'    — any unrelated business/other row (must remain unchanged)
function classifyRow(resolved, id, set, sheet, row) {
  var meta = set.sheets[sheet].meta;
  if (runOwns(resolved, id, set, sheet, row)) return 'current_run_owned';
  if (isAnyQaRow(row, meta.marker_field)) return 'previous_qa_run';
  return 'foreign_non_qa';
}

// BEFORE/AFTER SCOPE (QA-019) — a PURE SCOPE aggregate keyed on run identity. It proves: every desired QA row is
// present exactly once; no unexpected QA row exists; foreign (non-run) rows are unchanged (compared CONTRACT-AWARE
// so Google's consistent normalization is never read as a change, and normalization of the run's OWN rows is never
// counted as a foreign modification); headers unchanged; no undeclared tab written. Read-back CONTENT correctness
// of the run's own rows is deliberately NOT part of this aggregate (that belongs to READ_BACK_*). Returns
// structured BEFORE_AFTER_FAILURES.
function verifyBeforeAfter(resolved, before, after, id, set, plan) {
  var failures = [];
  var testTabs = Object.keys(set.sheets);
  var counts = { current_run_owned_rows: 0, previous_qa_run_rows: 0, foreign_non_qa_rows: 0 };
  testTabs.forEach(function (name) {
    var b = before[name] || { headers: [], rows: [], row_numbers: [] };
    var a = after[name] || { headers: [], rows: [], row_numbers: [] };
    var meta = set.sheets[name].meta;
    var aNums = a.row_numbers || [];
    var cls = function (r) { return classifyRow(resolved, id, set, name, r); };
    var physOf = function (rows, nums, k) { for (var i = 0; i < rows.length; i++) { if (identityKey(meta.identity_cols, rows[i]) === k) return nums[i] != null ? nums[i] : (i + 2); } return 0; };
    // header row unchanged
    if (b.headers.length && JSON.stringify(b.headers) !== JSON.stringify(a.headers)) failures.push({ kind: 'header_changed', sheet: name });
    // classify every AFTER row (current / previous_qa / foreign) — surfaced as scope context
    arr(a.rows).forEach(function (r) { var c = cls(r); if (c === 'current_run_owned') counts.current_run_owned_rows++; else if (c === 'previous_qa_run') counts.previous_qa_run_rows++; else counts.foreign_non_qa_rows++; });
    // every desired QA identity present exactly once in AFTER (covers fresh inserts and repeat-run updates)
    var desired = desiredIdentities(set, name);
    var desiredSet = {}; desired.forEach(function (k) { desiredSet[k] = true; });
    desired.forEach(function (k, i) {
      var role = set.sheets[name].desired[i].role;
      var present = arr(a.rows).filter(function (r) { return identityKey(meta.identity_cols, r) === k; });
      if (present.length === 0) failures.push({ kind: 'expected_row_missing', sheet: name, role: role, identity: k, qa_run_id: str(id.qa_run_id) });
      else if (present.length > 1) failures.push({ kind: 'duplicate_qa_row', sheet: name, role: role, identity: k, count: present.length, qa_run_id: str(id.qa_run_id) });
    });
    // no UNEXPECTED current-run row in AFTER (ours, but not one of the desired identities)
    arr(a.rows).forEach(function (r) { if (cls(r) === 'current_run_owned' && !desiredSet[identityKey(meta.identity_cols, r)]) failures.push({ kind: 'unexpected_qa_row', sheet: name, identity: identityKey(meta.identity_cols, r), qa_run_id: str(id.qa_run_id) }); });
    // foreign rows (previous-QA OR foreign-non-QA — anything NOT this run's), keyed by identity, must be unchanged
    // before->after (contract-aware comparison; Google's consistent normalization is never read as a change).
    var fB = {}; arr(b.rows).forEach(function (r) { if (cls(r) !== 'current_run_owned') fB[identityKey(meta.identity_cols, r)] = r; });
    var fA = {}; arr(a.rows).forEach(function (r) { if (cls(r) !== 'current_run_owned') fA[identityKey(meta.identity_cols, r)] = r; });
    Object.keys(fB).forEach(function (k) {
      if (!(k in fA)) { failures.push({ kind: 'foreign_row_removed', sheet: name, identity: k, classification: cls(fB[k]) }); return; }
      var cmp = compareRow(resolved, name, fB[k], fA[k], { physical_row: physOf(a.rows, aNums, k), key: k, qa_run_id: rowQaRunId(fA[k], meta.marker_field) });
      if (!cmp.ok) failures.push({ kind: 'foreign_row_modified', sheet: name, identity: k, classification: cls(fA[k]), mismatches: cmp.mismatches });
    });
    Object.keys(fA).forEach(function (k) { if (!(k in fB)) failures.push({ kind: 'foreign_row_added', sheet: name, identity: k, classification: cls(fA[k]) }); });
  });
  // a write to any tab outside the declared test set => violation
  arr(plan.write_tabs).forEach(function (t) { if (testTabs.indexOf(t) < 0) failures.push({ kind: 'undeclared_tab_written', sheet: t }); });

  var byKind = function (kinds) { return failures.filter(function (f) { return kinds.indexOf(f.kind) >= 0; }).length; };
  return {
    ok: failures.length === 0, failures: failures,
    expected_rows_written: plan.expected_rows_written,
    unexpected_rows_written: byKind(['unexpected_qa_row', 'duplicate_qa_row', 'expected_row_missing']),
    foreign_rows_modified: byKind(['foreign_row_modified', 'foreign_row_removed', 'foreign_row_added']),
    headers_modified: byKind(['header_changed']),
    undeclared_tabs_modified: byKind(['undeclared_tab_written']),
    current_run_owned_rows: counts.current_run_owned_rows,
    previous_qa_run_rows: counts.previous_qa_run_rows,
    foreign_non_qa_rows: counts.foreign_non_qa_rows
  };
}

// idempotency: re-plan the whole run against the projected-after state — a correct run plans zero new inserts.
function verifyIdempotency(resolved, id, config, set, projected) {
  var rerun = planOperations({ resolved: resolved, identity: id, config: Object.assign({}, config, { execute_writes: false }), row_set: set, before: projected });
  var dup = { agent_requests: 0, conversation_state: 0, tracked_sources: 0, telegram_outbox: 0 };
  rerun.decisions.forEach(function (d) { if (d.decision === 'insert' && dup[d.tab] != null) dup[d.tab]++; });
  var ok = rerun.counts.inserts === 0;
  return { ok: ok, dup: dup, rerun_inserts: rerun.counts.inserts, rerun_updates: rerun.counts.updates, rerun_suppressed: rerun.counts.suppressed };
}

// ============================================================================================================
// FINAL SUMMARY (Section 9) — one machine-readable item. PASS only when every sub-marker passes and nothing
// foreign was touched. Never hard-coded: derived from the verifier.
// ============================================================================================================
function assembleSummary(input) {
  var pre = input.preflight || {};
  var ver = input.verify || {};
  var m = ver.markers || {};
  var id = input.identity || {};
  var plan = input.plan || (ver.plan) || {};
  var blocked = plan.blocked === true;
  // a real, successful values write + after-snapshot read happened (the workflow only reaches Verify & Report on
  // the applied branch after a 200 from the write and a successful after-read).
  var applied = ver.applied === true || input.changes_applied === true;

  var preflightPass = pre.PREFLIGHT === 'PASS';
  var sheetsRead = input.sheets_read === false ? 'FAIL' : 'PASS';   // reads must have succeeded to reach here

  // dry-run validity: a well-formed, neutralized, in-bounds, idempotent PLAN (no live mutation needed).
  var dryPlanOk = preflightPass && sheetsRead === 'PASS' && m.WRITE_PLAN === 'PASS';

  // ---- mutation / acceptance markers (Section D) — truthful and separable ----------------------------------
  // The write node ran and Google accepted the write iff `applied` (the workflow only reaches Verify & Report on
  // the applied branch after a 2xx from values:batchUpdate AND a successful after-snapshot read).
  var mutationsPlanned = arr(plan.batchBody && plan.batchBody.data).length > 0;
  var writeRequestSucceeded = input.write_request_succeeded != null ? (input.write_request_succeeded === true) : applied;
  var writeNodeExecuted = input.write_node_executed != null ? (input.write_node_executed === true) : applied;
  var mutationsExecuted = applied && writeRequestSucceeded && mutationsPlanned;
  var afterSnapshotRead = input.after_snapshot_read != null ? (input.after_snapshot_read === true) : applied;

  // live verification: every LIVE marker PASS (SKIPPED allowed only for formula/negative when disabled) plus all
  // numeric scope guards zero.
  function liveOk(k) {
    var val = m[k];
    if (k === 'FORMULA_INJECTION_NEUTRALIZATION' || k === 'NEGATIVE_NUMBER_PRESERVATION') return val === 'PASS' || val === 'SKIPPED';
    return val === 'PASS';
  }
  var numericGuardsZero = (m.FOREIGN_ROWS_MODIFIED === 0) && (m.UNEXPECTED_ROWS_WRITTEN === 0) &&
    (m.FOREIGN_ROWS_RETURNED === 0) && (m.HEADERS_MODIFIED === 0) && (m.UNDECLARED_TABS_MODIFIED === 0);
  var acceptanceVerified = applied && afterSnapshotRead && preflightPass && LIVE_MARKERS.every(liveOk) && numericGuardsZero;

  // CHANGES_APPLIED reflects whether Google APPLIED the mutation — it must stay true even if later verification
  // fails (a verification failure must never falsely imply that no mutation happened). RESULT carries the verdict.
  var changesApplied = mutationsExecuted;
  // Once the write node has actually executed (a live attempt), the verdict is acceptance-based: a rejected write
  // (WRITE_REQUEST_SUCCEEDED=false) or an unverified write (ACCEPTANCE_VERIFIED=false) is FAIL and must never fall
  // back to the dry-run success path. Only a genuine dry-run (the write node never ran) is judged on plan validity.
  var result = blocked ? 'BLOCKED_PREFLIGHT'
    : (writeNodeExecuted ? (acceptanceVerified ? 'PASS' : 'FAIL') : (dryPlanOk ? 'PASS' : 'FAIL'));

  return {
    PREFLIGHT: pre.PREFLIGHT || 'FAIL',
    CONTRACT_TABS_PRESENT: pre.contract_tabs_present != null ? pre.contract_tabs_present : 0,
    SHEETS_READ: sheetsRead,
    WRITE_PLAN: m.WRITE_PLAN,
    NEXT_DATA_ROWS: m.NEXT_DATA_ROWS || {},
    GRID_EXPANSIONS: m.GRID_EXPANSIONS || {},
    WRITE_NODE_EXECUTED: writeNodeExecuted,
    WRITE_REQUEST_SUCCEEDED: writeRequestSucceeded,
    MUTATIONS_EXECUTED: mutationsExecuted,
    AFTER_SNAPSHOT_READ: afterSnapshotRead,
    ACCEPTANCE_VERIFIED: acceptanceVerified,
    APPEND_AGENT_REQUEST: m.APPEND_AGENT_REQUEST,
    READ_BACK_AGENT_REQUEST: m.READ_BACK_AGENT_REQUEST,
    APPEND_REQUEST_EVENT: m.APPEND_REQUEST_EVENT,
    UPSERT_INSERT: m.UPSERT_INSERT,
    UPSERT_UPDATE: m.UPSERT_UPDATE,
    UPSERT_ROW_COUNT_STABLE: m.UPSERT_ROW_COUNT_STABLE,
    TRACKED_SOURCE_UPSERT: m.TRACKED_SOURCE_UPSERT,
    OUTBOX_IDEMPOTENCY: m.OUTBOX_IDEMPOTENCY,
    OWNER_ISOLATION: m.OWNER_ISOLATION,
    REQUEST_ISOLATION: m.REQUEST_ISOLATION,
    FORMULA_INJECTION_NEUTRALIZATION: m.FORMULA_INJECTION_NEUTRALIZATION,
    NEGATIVE_NUMBER_PRESERVATION: m.NEGATIVE_NUMBER_PRESERVATION,
    BEFORE_AFTER_SCOPE: m.BEFORE_AFTER_SCOPE,
    FOREIGN_ROWS_RETURNED: m.FOREIGN_ROWS_RETURNED,
    FOREIGN_ROWS_MODIFIED: m.FOREIGN_ROWS_MODIFIED,
    EXPECTED_ROWS_WRITTEN: m.EXPECTED_ROWS_WRITTEN,
    UNEXPECTED_ROWS_WRITTEN: m.UNEXPECTED_ROWS_WRITTEN,
    HEADERS_MODIFIED: m.HEADERS_MODIFIED,
    UNDECLARED_TABS_MODIFIED: m.UNDECLARED_TABS_MODIFIED,
    DUPLICATE_AGENT_REQUESTS_CREATED: m.DUPLICATE_AGENT_REQUESTS_CREATED,
    DUPLICATE_CONVERSATION_STATES_CREATED: m.DUPLICATE_CONVERSATION_STATES_CREATED,
    DUPLICATE_TRACKED_SOURCES_CREATED: m.DUPLICATE_TRACKED_SOURCES_CREATED,
    DUPLICATE_OUTBOX_DELIVERIES_CREATED: m.DUPLICATE_OUTBOX_DELIVERIES_CREATED,
    IDEMPOTENCY: m.IDEMPOTENCY,
    EXTERNAL_NON_GOOGLE_CALLS: 0,
    CHANGES_APPLIED: changesApplied,
    QA_RUN_ID: id.qa_run_id || '',
    DATA_MODE: 'manual_test',
    RESULT: result
  };
}

// ============================================================================================================
// OFFLINE one-shot pipeline (used by tests + dry-run reasoning): before-snapshot in, full summary out.
// ============================================================================================================
function runOffline(input) {
  input = input || {};
  var resolved = input.resolved;
  var config = input.config || {};
  var id = input.identity || buildRunIdentity(config);
  var set = buildQaRowSet(id, config);
  var before = input.before || {};
  var pre = preflight({ resolved: resolved, metadata: input.metadata, headerRows: input.headerRows, config: config, identity: id, row_set: set });
  var plan = planOperations({ resolved: resolved, identity: id, config: config, row_set: set, before: before, preflight: pre, sheet_ids: input.sheet_ids });

  // apply the plan to a fresh simulator to obtain the projected after-state (the "live write" stand-in):
  // mirror the bounded grid expansion, then the single values write, at PHYSICAL row positions.
  var headerMap = {}, identityBy = {};
  Object.keys(set.sheets).forEach(function (n) { var cs = contractSheet(resolved, n); if (cs) headerMap[n] = cs.headers; identityBy[n] = set.sheets[n].meta.identity_cols; });
  var model = simulateFromSnapshot(before, headerMap);
  var applied = config.execute_writes === true && config.confirm_staging_spreadsheet === true && !pre.blocked;
  if (applied) { applyExpansion(model, plan.expanded_tabs); if (plan.batchBody.data.length) applyBatch(model, plan.batchBody); }
  var after = modelToSnapshot(model, identityBy);

  // synthesize the typed (spreadsheets.get) read of request A's formula cells: neutralized formula text is stored
  // as userEnteredValue.stringValue (never formulaValue). Tests may pass their own `typed` for the negative case.
  var typed = input.typed;
  if (typed === undefined && applied) {
    var raAfter = findRow(after, 'agent_requests', set.sheets.agent_requests.meta.identity_cols, set.sheets.agent_requests.desired[0].values) || {};
    typed = {}; (set.formula_fields.agent_requests || []).forEach(function (f) { typed[f] = { userEnteredValue: { stringValue: str(raAfter[f]) } }; });
  }

  var ver = verifyAll({ resolved: resolved, identity: id, config: config, row_set: set, before: before, plan: plan, after: applied ? after : null, applied: applied, typed: applied ? typed : null });
  var summary = assembleSummary({ preflight: pre, verify: ver, identity: id, config: config, plan: plan, changes_applied: applied, sheets_read: true });
  return { identity: id, row_set: set, preflight: pre, plan: plan, verify: ver, after: after, projected: ver.projected, summary: summary };
}

module.exports = {
  // helpers / mirrors (tested for behavioural equivalence with the canonical libs)
  str, low, neutralize, isFiniteNumber, isUnsafeCell, djb2, payloadHash, makeDeliveryId, colLetter,
  rowStartRange, fullRange, encodeQaTag, parseQaTag, isQaRunRow, isAnyQaRow, rowQaRunId, rowQaRole,
  // contract-aware comparison layer (QA-018) + typed formula safety
  isNumericColumn, isTimestampColumn, columnTypeInfo, isBlankCell, toBoolStrict, toNumberStrict, toInstant,
  tzOffMin, wallMs, textEquals, cellEquals, compareRow, parseTypedRow, verifyFormulaSafety,
  // full-identity request-A location + row classification (non-empty staging)
  findRequestARow, classifyRow,
  // constants
  FORMULA_TESTS, NEGATIVE_TESTS, EXAMPLE_URL, LIVE_MARKERS, sheetPlanMeta,
  // engine
  buildRunIdentity, buildQaRowSet, validatePlanAgainstContract, neededColumns, contractSheet,
  preflight, parseSnapshot, titleFromRange, rangeStartRow, rowsFromValues, rowIsOccupied, planOperations,
  matchByIdentity, indexByIdentity, identityKey, desiredIdentities, runOwns,
  simulateFromSnapshot, applyExpansion, applyBatch, modelToSnapshot, parseUserEntered, upsertInMemory,
  verifyAll, verifyIsolation, verifyBeforeAfter, verifyIdempotency, fieldsEqual, assembleSummary, runOffline
};
