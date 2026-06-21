'use strict';
// report_export.js — scoped CSV export subsystem for the conversational report (Section 3.1 / 19).
//
// The export ALWAYS operates on a single report bundle that is already scoped to one
// (owner_user_id, agent_request_id, report_id). Before producing anything we re-assert that scope and throw
// on any mismatch, so a duplicate/cross-request row can never leak into a user's file. Output is deterministic
// (stable column order), Excel-friendly Cyrillic (UTF-8 BOM), RFC-4180 quoted, and every value is run through
// a formula-injection neutraliser. Null/unknown stays empty — we never fabricate a zero. Pure + offline, $0.

function str(v) { return v == null ? '' : String(v); }
function trim(v) { return str(v).trim(); }

// ---- formula-injection protection -------------------------------------------------------------------
// A spreadsheet treats a cell beginning with = + - @ (or a leading TAB/CR) as a formula. We prefix such a
// value with an apostrophe so it is read as literal text — UNLESS the whole trimmed value is a finite number
// (so "-5" / "4.5" stay numeric and correct). URLs and ordinary text pass through unchanged.
const DANGEROUS_LEAD = /^[=+\-@\t\r]/;
function isFiniteNumber(s) {
  const t = trim(s);
  if (t === '') return false;
  return isFinite(Number(t)) && /^[+\-]?(\d+\.?\d*|\.\d+)$/.test(t);
}
function neutralize(v) {
  const s = str(v);
  if (s === '') return '';
  if (DANGEROUS_LEAD.test(s) && !isFiniteNumber(s)) return "'" + s;
  return s;
}

// ---- RFC-4180 CSV ------------------------------------------------------------------------------------
function csvCell(v) {
  const s = neutralize(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCSV(headers, rows, fields) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(fields.map(f => csvCell(r[f])).join(','));
  return lines.join('\r\n') + '\r\n';
}
const BOM = '﻿';

// ---- safe filenames ----------------------------------------------------------------------------------
function safeReportId(id) {
  const s = trim(id).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'report';
}
function exportFilename(reportId, view, ext) {
  return 'marketing_scout_' + safeReportId(reportId) + '_' + view + '.' + (ext || 'csv');
}

// ---- canonical user-facing views (Section 19) --------------------------------------------------------
// Each view: display headers + the bundle keys (stable order) + the bundle array it reads. `service` keys
// (internal lineage) are only emitted when the caller asks for them via opts.include_internal.
const VIEWS = {
  competitors: {
    list: 'competitors',
    headers: ['competitor', 'domain', 'region', 'positioning', 'score', 'quality', 'last_checked', 'source_link'],
    fields: ['competitor', 'domain', 'region', 'positioning', 'score', 'quality', 'last_checked', 'source_url']
  },
  offers: {
    list: 'offers',
    headers: ['competitor', 'offer', 'price_rate', 'amount_range', 'term', 'cta', 'promotion', 'collected_at', 'evidence_link'],
    fields: ['competitor', 'offer', 'price_rate', 'amount_range', 'term', 'cta', 'promotion', 'collected_at', 'evidence_url']
  },
  evidence: {
    list: 'evidence',
    headers: ['finding', 'competitor', 'excerpt', 'url', 'source_quality', 'confidence', 'collected_at'],
    fields: ['finding', 'competitor', 'excerpt', 'url', 'source_quality', 'confidence', 'collected_at']
  },
  recommendations: {
    list: 'recommendations',
    headers: ['recommendation', 'priority', 'rationale', 'linked_finding_ids', 'suggested_next_action'],
    fields: ['recommendation', 'priority', 'rationale', 'linked_finding_ids', 'next_action']
  },
  source_quality: {
    list: 'source_quality',
    headers: ['source', 'platform', 'health_score', 'status', 'freshness', 'exclusions', 'error'],
    fields: ['source', 'platform', 'health_score', 'status', 'freshness', 'exclusions', 'error']
  },
  changes: {
    list: 'changes',
    headers: ['entity', 'change_category', 'before', 'after', 'detected_at', 'evidence'],
    fields: ['entity', 'change_category', 'before', 'after', 'detected_at', 'evidence_url']
  }
};
const VIEW_NAMES = Object.keys(VIEWS).concat(['report']); // 'report' = the flat complete export

// Internal/service columns we strip unless explicitly requested.
const INTERNAL_KEYS = ['source_record_id', 'source_run_id', 'finding_id', 'owner_user_id', 'agent_request_id'];

// ---- report scope guard ------------------------------------------------------------------------------
// Verify the bundle is the one requested. Any mismatch is a hard error (report isolation).
function assertScope(bundle, scope) {
  bundle = bundle || {}; scope = scope || {};
  const checks = [['report_id', bundle.report_id], ['agent_request_id', bundle.agent_request_id], ['owner_user_id', bundle.owner_user_id]];
  for (const [k, have] of checks) {
    const want = scope[k];
    if (want != null && trim(want) !== '' && trim(want) !== trim(have)) {
      throw new Error('report scope mismatch on ' + k + ': bundle=' + trim(have) + ' requested=' + trim(want));
    }
  }
  return true;
}

// Normalise a list of rows: coerce price/score etc. left as-is (strings or numbers), but make every cell a
// stable primitive and convert arrays (e.g. linked_finding_ids) to a "; "-joined string. Unknown stays ''.
function shapeRow(row, fields, includeInternal) {
  const out = {};
  for (const f of fields) {
    let v = row[f];
    if (Array.isArray(v)) v = v.join('; ');
    out[f] = (v == null) ? '' : v;
  }
  if (includeInternal) for (const k of INTERNAL_KEYS) if (k in row) out[k] = row[k] == null ? '' : row[k];
  return out;
}

// Build the flat "complete report" rows: one row per offer joined to its competitor + evidence link.
function flatReportRows(bundle) {
  const comps = {};
  (bundle.competitors || []).forEach(c => { comps[trim(c.competitor)] = c; });
  return (bundle.offers || []).map(o => {
    const c = comps[trim(o.competitor)] || {};
    return {
      competitor: o.competitor, domain: c.domain, region: c.region, score: c.score, quality: c.quality,
      offer: o.offer, price_rate: o.price_rate, amount_range: o.amount_range, term: o.term,
      cta: o.cta, promotion: o.promotion, collected_at: o.collected_at, evidence_url: o.evidence_url
    };
  });
}
const FLAT = {
  headers: ['competitor', 'domain', 'region', 'score', 'quality', 'offer', 'price_rate', 'amount_range', 'term', 'cta', 'promotion', 'collected_at', 'evidence_link'],
  fields: ['competitor', 'domain', 'region', 'score', 'quality', 'offer', 'price_rate', 'amount_range', 'term', 'cta', 'promotion', 'collected_at', 'evidence_url']
};

// ---- public API --------------------------------------------------------------------------------------
// exportCsv(bundle, view, scope, opts) -> { view, filename, mime, content, row_count, bom: true }
function exportCsv(bundle, view, scope, opts) {
  bundle = bundle || {}; opts = opts || {};
  assertScope(bundle, scope || {});
  if (VIEW_NAMES.indexOf(view) < 0) throw new Error('unknown export view: ' + view + ' (valid: ' + VIEW_NAMES.join(', ') + ')');

  let headers, fields, rawRows;
  if (view === 'report') { headers = FLAT.headers; fields = FLAT.fields; rawRows = flatReportRows(bundle); }
  else { const spec = VIEWS[view]; headers = spec.headers; fields = spec.fields; rawRows = bundle[spec.list] || []; }

  const include = opts.include_internal === true;
  const rows = rawRows.map(r => shapeRow(r, include ? fields.concat(INTERNAL_KEYS.filter(k => k in r)) : fields, include));
  const allHeaders = include ? headers.concat(INTERNAL_KEYS.filter(k => rows.some(r => k in r))) : headers;
  const allFields = include ? fields.concat(INTERNAL_KEYS.filter(k => rows.some(r => k in r))) : fields;

  const csv = toCSV(allHeaders, rows, allFields);
  return {
    view: view, filename: exportFilename(bundle.report_id, view, 'csv'),
    mime: 'text/csv; charset=utf-8', content: BOM + csv, row_count: rows.length, bom: true,
    report_id: trim(bundle.report_id), agent_request_id: trim(bundle.agent_request_id)
  };
}

module.exports = {
  exportCsv, toCSV, csvCell, neutralize, isFiniteNumber, exportFilename, safeReportId,
  assertScope, flatReportRows, VIEWS, VIEW_NAMES, BOM
};
