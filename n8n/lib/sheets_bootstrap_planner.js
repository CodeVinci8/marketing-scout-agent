'use strict';
// sheets_bootstrap_planner.js — PURE, dependency-free planner for the Stage 3 Google Sheets staging bootstrap.
//
// It takes a resolved contract snapshot + the current spreadsheet state and returns deterministic Google Sheets
// `spreadsheets.batchUpdate` requests plus a machine-readable summary. It performs NO I/O, makes NO API call,
// and has NO require()s, so it can be embedded verbatim inside an n8n Code node (whose sandbox cannot require
// local files). The n8n workflow and the offline tests call the exact same functions.
//
// Safety guarantees built into the plan:
//   * dry-run (apply_changes=false) emits requests for PREVIEW only — the workflow never sends them.
//   * a non-empty header row that conflicts with the contract aborts ALL mutations (dangerous_mismatch).
//   * headers are only written to brand-new or completely blank sheets, or APPENDED to the right of an
//     exact-prefix older schema — existing populated header cells are never overwritten.
//   * __qa_connection and any other non-contract sheet are preserved, never edited, never deleted, never cleared.
//   * idempotent: a second apply against a correct spreadsheet plans zero mutations (formatting/validation are
//     gated by a spreadsheet developerMetadata marker; structure is gated by reading current metadata/headers).
//   * unknown/blank values are never coerced — number formats never write, validations are non-coercive.

// ----- marker -------------------------------------------------------------------------------------------------
var MARKER_KEY = 'marketing_scout_bootstrap';

// ----- small helpers (self-contained) -------------------------------------------------------------------------
function str(v) { return v == null ? '' : String(v); }
function trimTrailingBlank(arr) { var a = (arr || []).slice(); while (a.length && str(a[a.length - 1]).trim() === '') a.pop(); return a.map(function (x) { return str(x); }); }
function lower(s) { return str(s).toLowerCase(); }
function rgb(r, g, b) { return { red: r, green: g, blue: b }; }

// ----- semantic width rules (reusable; no per-sheet width table) ----------------------------------------------
var W_NARROW = 90, W_MEDIUM = 160, W_WIDE = 320, W_XWIDE = 480;
var RE_LONGTEXT = /(summary|summary_ru|recommendations_ru|reason|reasons|offer|offer_text|offer_summary|excerpt|evidence|description|snippet|text$|text_context|comment_text|notes?$|note$|prompt|plan_summary|markdown|sections|value_json|bundle|terms|guarantees|detected_pains|pain_points_targeted|observed_strengths|observed_weaknesses|policy_note|score_reasons|request_text|result_summary|operator_next_action|next_operator_action|top_competitors|top_angles|audience_summary|recommended_posts|recommended_ads|faq_topics|counterarguments|lead_magnets|source_evidence)/;
var RE_URL = /(url|_url|link|_link|profile_url|canonical_url|source_link|report_markdown_path|source_urls|example_sources)/;
var RE_ID_HASH = /(_id$|^id$|_key$|_hash$|hash$|dedup_key|change_id|idempotency_key|version$|payload_hash|content_hash)/;
var RE_TIME = /(_at$|_ts$|^ts$|created_ts|updated_ts|published_at|evaluated_at|added_at|collected_at|generated_at|first_seen_at|last_seen_at|next_check_at|expires_at|reviewed_at|approved_at|analyzed_at|parsed_at|edited_ts|decided_ts)/;
var RE_INT = /(_count$|count$|_calls$|calls$|_tokens$|tokens$|_index$|attempts|chunks|item_count|items_received|requested_limit|requested_search_scope|max_items|max_external_calls|max_context_tokens|est_input_tokens|^week$|^year$|frequency|evidence_count|time_window_days|source_staleness_days|age_days|error_count|check_interval_hours|batch_index|estimated_firecrawl_credits)/;
var RE_SCORE = /(_score$|score$|confidence|urgency|niche_fit|competitor_strength|lead_signal_score|content_idea_score|quality_score|lead_score|confidence_score|source_confidence|contact_confidence|evidence_completeness_score)/;
var RE_RATE = /_rate$/;
var RE_USD = /(_usd$|cost_usd|_cost$)/;
var RE_ENUM = /(status$|_status$|_type$|type$|_band$|_class$|^route$|^platform$|^mode$|^category$|data_mode|cost_status|service|^state$|_state$|priority|recommended_action|source_family|change_type|page_type|intent_type|score_band)/;

function widthFor(col, isCheckbox) {
  var c = lower(col);
  if (isCheckbox) return W_NARROW;
  if (RE_LONGTEXT.test(c)) return W_XWIDE;
  if (RE_URL.test(c)) return W_WIDE;
  if (RE_TIME.test(c)) return W_MEDIUM;
  if (RE_ID_HASH.test(c)) return W_MEDIUM;
  if (RE_RATE.test(c)) return W_MEDIUM;
  if (RE_USD.test(c)) return W_MEDIUM;
  if (RE_INT.test(c)) return W_NARROW;
  if (RE_SCORE.test(c)) return W_NARROW;
  if (RE_ENUM.test(c)) return W_MEDIUM;
  return W_MEDIUM;
}

// number/date formats: only numeric columns get a NUMBER format (never coerces blanks). Timestamps are written as
// ISO text by the workflows, so we deliberately do NOT apply a date numberFormat (it would be a no-op on text and
// risks confusing blank cells). Percentages are avoided because the storage scale (fraction vs *100) is not known.
function numberFormatFor(col) {
  var c = lower(col);
  if (RE_TIME.test(c) || RE_ID_HASH.test(c)) return null;
  if (RE_USD.test(c)) return { type: 'NUMBER', pattern: '#,##0.00####' };
  if (RE_RATE.test(c)) return { type: 'NUMBER', pattern: '0.00' };
  if (RE_INT.test(c)) return { type: 'NUMBER', pattern: '0' };
  if (RE_SCORE.test(c)) return { type: 'NUMBER', pattern: '0' };
  return null;
}
function isLongText(col) { return RE_LONGTEXT.test(lower(col)); }

// ----- header-row style ---------------------------------------------------------------------------------------
function headerFormatCell() {
  return {
    userEnteredFormat: {
      backgroundColorStyle: { rgbColor: rgb(0.91, 0.94, 0.98) },
      textFormat: { bold: true, foregroundColorStyle: { rgbColor: rgb(0.13, 0.13, 0.13) } },
      verticalAlignment: 'MIDDLE',
      wrapStrategy: 'WRAP'
    }
  };
}

// ----- spreadsheet model normalization ------------------------------------------------------------------------
// Accepts the shape returned by spreadsheets.get(fields=sheets.properties,developerMetadata) plus a headerRows map
// { title -> [cells] } from values.batchGet. Returns a normalized model.
function normalizeSpreadsheet(spreadsheet, headerRows) {
  spreadsheet = spreadsheet || {};
  headerRows = headerRows || {};
  var sheets = (spreadsheet.sheets || []).map(function (s) {
    var p = s.properties || s;
    var gp = p.gridProperties || {};
    return {
      sheetId: p.sheetId,
      title: str(p.title),
      index: typeof p.index === 'number' ? p.index : 0,
      rowCount: gp.rowCount || 1000,
      columnCount: gp.columnCount || 26,
      frozenRowCount: gp.frozenRowCount || 0,
      headerRow: trimTrailingBlank(headerRows[str(p.title)] || [])
    };
  });
  var marker = null;
  (spreadsheet.developerMetadata || []).forEach(function (m) {
    if (str(m.metadataKey) === MARKER_KEY) { try { marker = JSON.parse(m.metadataValue); } catch (e) { marker = { _raw: str(m.metadataValue) }; } }
  });
  return { sheets: sheets, marker: marker };
}

// compare an existing (trailing-blank-trimmed) header row against desired headers.
//   'blank'    -> sheet has no header row yet (safe to initialise)
//   'match'    -> exactly equals desired (no write)
//   'prefix'   -> existing is an exact prefix of desired but shorter (safe to APPEND the missing trailing headers)
//   'conflict' -> a shared position differs, or existing has extra/renamed columns (DANGEROUS — abort)
function classifyHeader(actual, desired) {
  if (!actual || actual.length === 0) return { kind: 'blank' };
  if (actual.length > desired.length) return { kind: 'conflict' };
  for (var i = 0; i < actual.length; i++) { if (str(actual[i]) !== str(desired[i])) return { kind: 'conflict' }; }
  if (actual.length === desired.length) return { kind: 'match' };
  return { kind: 'prefix', from: actual.length };
}

// ----- main planner -------------------------------------------------------------------------------------------
// input: { resolved, config:{apply_changes,apply_formatting,apply_validations}, spreadsheet, headerRows }
function plan(input) {
  input = input || {};
  var resolved = input.resolved || {};
  var cfg = input.config || {};
  var applyChanges = cfg.apply_changes === true;
  var applyFormatting = cfg.apply_formatting !== false;   // default true
  var applyValidations = cfg.apply_validations !== false;  // default true
  var dryRun = !applyChanges;

  var model = normalizeSpreadsheet(input.spreadsheet, input.headerRows);
  var contractSheets = resolved.sheets || [];
  var hash = str(resolved.contract_hash);
  var fmtVer = str(resolved.fmt_version);
  var valVer = str(resolved.validation_version);

  var byTitle = {}; model.sheets.forEach(function (s) { byTitle[s.title] = s; });
  var contractNames = {}; contractSheets.forEach(function (cs) { contractNames[cs.sheet_name] = true; });

  // marker staleness (gates the formatting + validation buckets so a correct second run is a no-op)
  var marker = model.marker || null;
  var fmtStale = !marker || str(marker.contract_hash) !== hash || str(marker.fmt_version) !== fmtVer;
  var valStale = !marker || str(marker.contract_hash) !== hash || str(marker.validation_version) !== valVer;
  var doFormatting = applyFormatting && fmtStale;
  var doValidations = applyValidations && valStale;

  // --- desired ordering: contract sheets at indices 0..N-1 (sheet_order); extras preserved AFTER, in their
  // current relative order (sorted by current index → stable across runs) ---
  var extras = model.sheets.filter(function (s) { return !contractNames[s.title]; }).slice()
    .sort(function (a, b) { return a.index - b.index; });
  var desiredIndex = {};
  contractSheets.forEach(function (cs, i) { desiredIndex[cs.sheet_name] = i; });
  extras.forEach(function (s, i) { desiredIndex[s.title] = contractSheets.length + i; });

  // --- per-sheet diagnosis ---
  var create_requests = [];
  var header_requests = [];
  var freeze_requests = [];
  var format_requests = [];
  var width_requests = [];
  var filter_requests = [];
  var validation_requests = [];
  var reorder_requests = [];
  var dangerous = [];

  var s = {
    DECLARED_TABS: contractSheets.length,
    EXISTING_CONTRACT_TABS: 0, CREATED_TABS: 0, BLANK_TABS_INITIALIZED: 0, MATCHING_HEADERS: 0,
    HEADER_MISMATCHES: 0, HEADERS_APPENDED: 0, MISSING_TABS: 0, CONTRACT_TABS_ORDERED: contractSheets.length,
    ORDER_MISMATCHES: 0, FORMATTED_SHEETS: 0, DROPDOWN_COLUMNS_CONFIGURED: 0, CHECKBOX_COLUMNS_CONFIGURED: 0,
    VALIDATION_MISMATCHES: 0, EXTRA_PRESERVED_TABS: extras.map(function (e) { return e.title; }),
    HELPER_VALIDATION_SHEET_CREATED: false, CHANGES_APPLIED: false, CONTRACT_HASH: hash, RESULT: 'PASS'
  };

  // projected model: every contract sheet present. Missing sheets get a REAL sheetId assigned now
  // (max existing id + k) so a single batchUpdate can create them AND configure them in one pass — addSheet
  // is applied before later requests that reference the new id (Google applies a batch in array order).
  var maxId = 0; model.sheets.forEach(function (sh) { if (typeof sh.sheetId === 'number' && sh.sheetId > maxId) maxId = sh.sheetId; });
  var nextId = maxId + 1;
  var projected = {};
  contractSheets.forEach(function (cs, i) {
    var ex = byTitle[cs.sheet_name];
    if (ex) {
      s.EXISTING_CONTRACT_TABS++;
      projected[cs.sheet_name] = { sheetId: ex.sheetId, index: ex.index, frozenRowCount: ex.frozenRowCount, headerRow: ex.headerRow, created: false };
    } else {
      s.CREATED_TABS++; s.MISSING_TABS++;
      var rid = nextId++;
      // a created sheet starts with the correct index + frozen header row, so the reorder/freeze passes skip it.
      projected[cs.sheet_name] = { sheetId: rid, index: i, frozenRowCount: 1, headerRow: [], created: true };
      create_requests.push({ addSheet: { properties: { sheetId: rid, title: cs.sheet_name, index: i, gridProperties: { rowCount: 1000, columnCount: Math.max(26, cs.headers.length), frozenRowCount: 1 } } } });
    }
  });

  // header classification (must run before any mutation to detect dangerous conflicts → abort)
  contractSheets.forEach(function (cs) {
    var pj = projected[cs.sheet_name];
    var cls = classifyHeader(pj.headerRow, cs.headers);
    if (cls.kind === 'conflict') { dangerous.push({ sheet: cs.sheet_name, expected_headers: cs.headers.slice(), actual_headers: pj.headerRow.slice() }); s.HEADER_MISMATCHES++; }
    else if (cls.kind === 'match') { s.MATCHING_HEADERS++; }
  });

  var blocked = dangerous.length > 0;

  if (!blocked) {
    contractSheets.forEach(function (cs) {
      var pj = projected[cs.sheet_name];
      var sid = pj.sheetId;
      var pending = pj.created;  // (kept for builder signature compatibility; ids are always real)
      var ncols = cs.headers.length;
      var cls = classifyHeader(pj.headerRow, cs.headers);

      // headers: write for blank/new sheets; append missing trailing headers for an exact-prefix older schema
      if (cls.kind === 'blank') {
        if (pj.created) { /* counted as created; its header init also counts */ } else { s.BLANK_TABS_INITIALIZED++; }
        header_requests.push(writeHeaderRequest(sid, 0, cs.headers, pending));
      } else if (cls.kind === 'prefix') {
        s.HEADERS_APPENDED++;
        header_requests.push(writeHeaderRequest(sid, cls.from, cs.headers.slice(cls.from), pending));
      }

      // ordering
      if (pj.index !== desiredIndex[cs.sheet_name]) {
        s.ORDER_MISMATCHES++;
        reorder_requests.push({ updateSheetProperties: { properties: { sheetId: sid, index: desiredIndex[cs.sheet_name] }, fields: 'index' } });
      }

      // freeze row 1 (independent idempotency via frozenRowCount; always in apply mode)
      if (pj.frozenRowCount !== 1) {
        freeze_requests.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
      }

      // formatting bucket (gated by marker)
      if (doFormatting) {
        s.FORMATTED_SHEETS++;
        // header row style
        format_requests.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: ncols }, cell: headerFormatCell(), fields: 'userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment,wrapStrategy)' } });
        // long-text body columns: Clip + top align (keeps long markdown/notes rows readable, no row-height blowup)
        cs.headers.forEach(function (col, ci) {
          if (isLongText(col)) {
            format_requests.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 1, startColumnIndex: ci, endColumnIndex: ci + 1 }, cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)' } });
          }
          var nf = numberFormatFor(col);
          if (nf) format_requests.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 1, startColumnIndex: ci, endColumnIndex: ci + 1 }, cell: { userEnteredFormat: { numberFormat: nf } }, fields: 'userEnteredFormat.numberFormat' } });
        });
        // widths (grouped runs of equal width → one request each)
        var checkSet = {}; cs.ui_columns.checkboxes.forEach(function (c) { checkSet[c] = true; });
        var widths = cs.headers.map(function (col) { return widthFor(col, !!checkSet[col]); });
        mergeRuns(widths).forEach(function (run) {
          width_requests.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: run.start, endIndex: run.end }, properties: { pixelSize: run.value }, fields: 'pixelSize' } });
        });
        // basic filter across the table columns
        filter_requests.push({ setBasicFilter: { filter: { range: { sheetId: sid, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: ncols } } } });
      }

      // validation bucket (gated by marker): dropdowns + checkboxes from row 2 down (never the header)
      if (doValidations) {
        var dds = cs.ui_columns.dropdowns;
        Object.keys(dds).forEach(function (col) {
          var ci = cs.headers.indexOf(col); if (ci < 0) return;
          s.DROPDOWN_COLUMNS_CONFIGURED++;
          validation_requests.push(dropdownRequest(sid, ci, dds[col].values, dds[col].strict, pending));
        });
        cs.ui_columns.checkboxes.forEach(function (col) {
          var ci = cs.headers.indexOf(col); if (ci < 0) return;
          s.CHECKBOX_COLUMNS_CONFIGURED++;
          validation_requests.push(checkboxRequest(sid, ci, pending));
        });
        if (Object.keys(dds).length || cs.ui_columns.checkboxes.length) s.VALIDATION_MISMATCHES++;
      }
    });

    // extras (incl. __qa_connection) are preserved and only repositioned AFTER the 40 contract sheets so the
    // contract occupies the first 40 visible positions. Their content/headers/validation are never touched.
    extras.forEach(function (ex) {
      if (ex.index !== desiredIndex[ex.title]) {
        s.ORDER_MISMATCHES++;
        reorder_requests.push({ updateSheetProperties: { properties: { sheetId: ex.sheetId, index: desiredIndex[ex.title] }, fields: 'index' } });
      }
    });
    // apply reorders in target-index order (robust against sequential index shifts during a live batchUpdate)
    reorder_requests.sort(function (a, b) { return a.updateSheetProperties.properties.index - b.updateSheetProperties.properties.index; });
  }

  // a dangerous header mismatch aborts EVERY mutation — even creating the other missing sheets is withheld so the
  // operator inspects the conflict first (the create pass would otherwise commit a partial bootstrap).
  if (blocked) create_requests = [];

  // assemble configure_requests in a safe order: reorder, freeze, headers, formatting, widths, filters, validations
  var configure_requests = [].concat(reorder_requests, freeze_requests, header_requests, format_requests, width_requests, filter_requests, validation_requests);

  // marker write: only when something else changed OR the marker is stale/missing (so a clean run writes nothing)
  var markerNeeded = !blocked && (configure_requests.length > 0 || !marker || str(marker.contract_hash) !== hash ||
    (applyFormatting && str(marker.fmt_version) !== fmtVer) || (applyValidations && str(marker.validation_version) !== valVer));
  var marker_request = null;
  if (markerNeeded) {
    var value = { contract_hash: hash, fmt_version: fmtVer, validation_version: valVer, applied_at: str(cfg.now) };
    marker_request = marker ? updateMarkerRequest(value) : createMarkerRequest(value);
  }

  s.CHANGES_APPLIED = applyChanges && !blocked;
  s.RESULT = blocked ? 'BLOCKED_HEADER_MISMATCH' : 'PASS';

  // single ordered batchUpdate: addSheet(s) first (so later requests can reference the assigned ids), then
  // structure, formatting, validations, and the developerMetadata marker last.
  var requests = blocked ? [] : [].concat(create_requests, configure_requests, marker_request ? [marker_request] : []);
  var mutationsPlanned = requests.length;

  return {
    dry_run: dryRun,
    blocked: blocked,
    dangerous_mismatches: dangerous,
    requests: requests,
    create_requests: create_requests,
    configure_requests: configure_requests,
    marker_request: marker_request,
    mutations_planned: mutationsPlanned,
    buckets: { formatting_applied: doFormatting, validations_applied: doValidations, formatting_current: !fmtStale, validations_current: !valStale },
    summary: s
  };
}

// ----- request builders ---------------------------------------------------------------------------------------
function writeHeaderRequest(sheetId, startCol, headers, pending) {
  return {
    updateCells: {
      start: { sheetId: sheetId, rowIndex: 0, columnIndex: startCol },
      rows: [{ values: headers.map(function (h) { return { userEnteredValue: { stringValue: str(h) } }; }) }],
      fields: 'userEnteredValue'
    }
  };
}
function dropdownRequest(sheetId, colIndex, values, strict, pending) {
  return {
    setDataValidation: {
      range: { sheetId: sheetId, startRowIndex: 1, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: values.map(function (v) { return { userEnteredValue: str(v) }; }) },
        strict: !!strict, showCustomUi: true
      }
    }
  };
}
function checkboxRequest(sheetId, colIndex, pending) {
  return {
    setDataValidation: {
      range: { sheetId: sheetId, startRowIndex: 1, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
      // strict:false so a legacy blank/non-boolean cell is never rejected or coerced (stays blank, not 0/false)
      rule: { condition: { type: 'BOOLEAN' }, strict: false, showCustomUi: true }
    }
  };
}
function createMarkerRequest(value) {
  return { createDeveloperMetadata: { developerMetadata: { metadataKey: MARKER_KEY, metadataValue: JSON.stringify(value), location: { spreadsheet: true }, visibility: 'DOCUMENT' } } };
}
function updateMarkerRequest(value) {
  return { updateDeveloperMetadata: { dataFilters: [{ developerMetadataLookup: { metadataKey: MARKER_KEY } }], developerMetadata: { metadataKey: MARKER_KEY, metadataValue: JSON.stringify(value), location: { spreadsheet: true }, visibility: 'DOCUMENT' }, fields: 'metadataValue' } };
}

// merge consecutive equal values into [start,end) runs
function mergeRuns(values) {
  var runs = [], i = 0;
  while (i < values.length) { var j = i + 1; while (j < values.length && values[j] === values[i]) j++; runs.push({ start: i, end: j, value: values[i] }); i = j; }
  return runs;
}

// ----- second-run keys (documented machine-readable idempotency report) ---------------------------------------
function toSecondRunKeys(planResult) {
  var sm = planResult.summary;
  return {
    SECOND_RUN_CREATED: planResult.create_requests.length,
    SECOND_RUN_HEADERS_WRITTEN: planResult.configure_requests.filter(function (r) { return r.updateCells; }).length,
    SECOND_RUN_REORDERED: planResult.configure_requests.filter(function (r) { return r.updateSheetProperties && r.updateSheetProperties.fields === 'index'; }).length,
    SECOND_RUN_FORMATTING_CHANGED: planResult.configure_requests.filter(function (r) { return r.repeatCell || r.updateDimensionProperties || r.setBasicFilter; }).length,
    SECOND_RUN_VALIDATIONS_CHANGED: planResult.configure_requests.filter(function (r) { return r.setDataValidation; }).length,
    SECOND_RUN_HEADER_MISMATCHES: sm.HEADER_MISMATCHES,
    IDEMPOTENCY: (planResult.mutations_planned === 0 ? 'PASS' : 'FAIL')
  };
}

// ----- simulator (test + self-test): apply a single batch to a normalized model so re-planning proves idempotency.
// Mirrors how Google applies a batchUpdate in array order (addSheet ids are explicit, so later requests resolve).
function simulateApply(model, requests, markerValue) {
  model = model || { sheets: [], marker: null };
  var byId = {}; model.sheets.forEach(function (s) { byId[s.sheetId] = s; });
  (requests || []).forEach(function (req) {
    if (req.addSheet) {
      var p = req.addSheet.properties;
      var gp = p.gridProperties || {};
      var sheet = { sheetId: p.sheetId, title: str(p.title), index: p.index || 0, rowCount: gp.rowCount || 1000, columnCount: gp.columnCount || 26, frozenRowCount: gp.frozenRowCount || 0, headerRow: [] };
      model.sheets.push(sheet); byId[sheet.sheetId] = sheet;
    } else if (req.updateSheetProperties) {
      var u = req.updateSheetProperties, sh = byId[u.properties.sheetId];
      if (!sh) return;
      if (u.fields === 'index') sh.index = u.properties.index;
      if (u.fields === 'gridProperties.frozenRowCount') sh.frozenRowCount = (u.properties.gridProperties || {}).frozenRowCount || 0;
    } else if (req.updateCells) {
      var c = req.updateCells, sh2 = byId[c.start.sheetId]; if (!sh2) return;
      var vals = (c.rows[0].values || []).map(function (v) { return str((v.userEnteredValue || {}).stringValue); });
      var startCol = c.start.columnIndex || 0;
      var hdr = sh2.headerRow.slice();
      for (var k = 0; k < vals.length; k++) hdr[startCol + k] = vals[k];
      sh2.headerRow = trimTrailingBlank(hdr);
    }
    // repeatCell / setBasicFilter / setDataValidation / updateDimensionProperties: visual/validation state — not
    // tracked structurally; idempotency for those is governed by the developerMetadata marker.
  });
  if (markerValue) model.marker = markerValue;
  return model;
}

module.exports = {
  MARKER_KEY, plan, normalizeSpreadsheet, classifyHeader, widthFor, numberFormatFor, isLongText,
  mergeRuns, toSecondRunKeys, simulateApply, headerFormatCell
};
