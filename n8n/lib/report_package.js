'use strict';
// report_package.js — assemble the 8-sheet user-facing XLSX report package from a stored report bundle
// (Sections 3.2 / 19). Operational Sheets stay internal; this is the intentionally-designed user workbook.
//
// Sheets (fixed order): Summary, Competitors, Offers_Prices, Evidence, Recommendations, Source_Quality,
// Changes, Run_Metadata. Generated from stored report data only — never re-collected. Scope is re-asserted
// before anything is produced (report isolation). Pure + deterministic, $0, offline.

const { assertScope, safeReportId } = require('./report_export.js');
const { workbookBuffer } = require('./xlsx_writer.js');

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function join(a) { return Array.isArray(a) ? a.join('; ') : str(a); }

const SHEET_NAMES = ['Summary', 'Competitors', 'Offers_Prices', 'Evidence', 'Recommendations', 'Source_Quality', 'Changes', 'Run_Metadata'];

// quality/status -> highlight bucket (good/warn/bad). Unknown -> no highlight.
function qualityHighlight(v) {
  const s = low(v);
  if (['healthy', 'ok', 'eligible', 'active', 'good'].indexOf(s) >= 0) return 'good';
  if (['degraded', 'warn', 'stale', 'paused', 'pending'].indexOf(s) >= 0) return 'warn';
  if (['quarantined', 'failed', 'error', 'excluded', 'unavailable', 'bad'].indexOf(s) >= 0) return 'bad';
  return null;
}

function buildSheets(b) {
  const sum = b.summary || {};
  const meta = b.run_metadata || {};
  const budgets = b.budgets || {};
  const scopeStr = [b.niche, b.region, (b.time_window_days ? b.time_window_days + 'd' : '')].filter(Boolean).join(' · ');
  const filterStr = b.active_filters ? join(b.active_filters) : '';

  return [
    {
      name: 'Summary', freeze_header: true, autofilter: false,
      columns: [
        { header: 'Request', key: 'request', width: 22 },
        { header: 'Niche', key: 'niche', width: 18 },
        { header: 'Region', key: 'region', width: 16 },
        { header: 'Report date', key: 'date', type: 'datetime', width: 20 },
        { header: 'Competitors found', key: 'competitors', type: 'integer', width: 16 },
        { header: 'Sources checked', key: 'sources', type: 'integer', width: 14 },
        { header: 'Quality status', key: 'quality', width: 14 },
        { header: 'Scope', key: 'scope', width: 26 },
        { header: 'Active filters', key: 'filters', width: 24 },
        { header: 'Key findings', key: 'findings', width: 50 },
        { header: 'Key recommendations', key: 'recs', width: 50 },
        { header: 'External calls', key: 'calls', type: 'integer', width: 12 },
        { header: 'Source cost', key: 'source_cost', width: 12 },
        { header: 'LLM cost', key: 'llm_cost', width: 12 }
      ],
      rows: [{
        request: b.agent_request_id, niche: b.niche, region: b.region, date: b.created_at,
        competitors: sum.competitors_found != null ? sum.competitors_found : (b.competitors || []).length,
        sources: sum.sources_checked != null ? sum.sources_checked : (b.source_quality || []).length,
        quality: sum.quality_status, scope: scopeStr, filters: filterStr,
        findings: join(sum.key_findings), recs: join(sum.key_recommendations),
        calls: sum.external_calls, source_cost: sum.source_cost_status || 'unknown', llm_cost: sum.llm_cost_status || 'unknown'
      }],
      highlight: (r, c) => c.key === 'quality' ? qualityHighlight(r.quality) : null
    },
    {
      name: 'Competitors', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Competitor', key: 'competitor', width: 26 },
        { header: 'Domain', key: 'domain', width: 24 },
        { header: 'Region', key: 'region', width: 16 },
        { header: 'Positioning', key: 'positioning', width: 40 },
        { header: 'Score', key: 'score', type: 'number', width: 10 },
        { header: 'Quality', key: 'quality', width: 12 },
        { header: 'Last checked', key: 'last_checked', type: 'datetime', width: 20 },
        { header: 'Source link', key: 'source_url', type: 'url', width: 36 }
      ],
      rows: b.competitors || [],
      highlight: (r, c) => c.key === 'quality' ? qualityHighlight(r.quality) : null
    },
    {
      name: 'Offers_Prices', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Competitor', key: 'competitor', width: 26 },
        { header: 'Offer', key: 'offer', width: 44 },
        { header: 'Price / rate', key: 'price_rate', width: 16 },
        { header: 'Amount range', key: 'amount_range', width: 18 },
        { header: 'Term', key: 'term', width: 14 },
        { header: 'CTA', key: 'cta', width: 20 },
        { header: 'Promotion', key: 'promotion', width: 24 },
        { header: 'Collected at', key: 'collected_at', type: 'datetime', width: 20 },
        { header: 'Evidence link', key: 'evidence_url', type: 'url', width: 36 }
      ],
      rows: b.offers || []
    },
    {
      name: 'Evidence', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Finding', key: 'finding', width: 40 },
        { header: 'Competitor', key: 'competitor', width: 24 },
        { header: 'Excerpt', key: 'excerpt', width: 60 },
        { header: 'URL', key: 'url', type: 'url', width: 36 },
        { header: 'Source quality', key: 'source_quality', width: 14 },
        { header: 'Confidence', key: 'confidence', width: 12 },
        { header: 'Collected at', key: 'collected_at', type: 'datetime', width: 20 }
      ],
      rows: b.evidence || [],
      highlight: (r, c) => c.key === 'source_quality' ? qualityHighlight(r.source_quality) : null
    },
    {
      name: 'Recommendations', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Recommendation', key: 'recommendation', width: 50 },
        { header: 'Priority', key: 'priority', width: 12 },
        { header: 'Rationale', key: 'rationale', width: 50 },
        { header: 'Linked finding IDs', key: 'linked_finding_ids', width: 28 },
        { header: 'Suggested next action', key: 'next_action', width: 40 }
      ],
      rows: (b.recommendations || []).map(r => Object.assign({}, r, { linked_finding_ids: join(r.linked_finding_ids) }))
    },
    {
      name: 'Source_Quality', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Source', key: 'source', width: 30 },
        { header: 'Platform', key: 'platform', width: 16 },
        { header: 'Health score', key: 'health_score', type: 'number', width: 12 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Freshness', key: 'freshness', width: 18 },
        { header: 'Exclusions', key: 'exclusions', width: 30 },
        { header: 'Error', key: 'error', width: 30 }
      ],
      rows: (b.source_quality || []).map(r => Object.assign({}, r, { exclusions: join(r.exclusions) })),
      highlight: (r, c) => c.key === 'status' ? qualityHighlight(r.status) : null
    },
    {
      name: 'Changes', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Competitor / source', key: 'entity', width: 28 },
        { header: 'Change category', key: 'change_category', width: 20 },
        { header: 'Before', key: 'before', width: 40 },
        { header: 'After', key: 'after', width: 40 },
        { header: 'Detected at', key: 'detected_at', type: 'datetime', width: 20 },
        { header: 'Evidence', key: 'evidence_url', type: 'url', width: 36 }
      ],
      rows: b.changes || []
    },
    {
      name: 'Run_Metadata', freeze_header: true, autofilter: false,
      columns: [
        { header: 'Agent request ID', key: 'agent_request_id', width: 28 },
        { header: 'Report ID', key: 'report_id', width: 28 },
        { header: 'Run IDs', key: 'run_ids', width: 40 },
        { header: 'External calls', key: 'calls', type: 'integer', width: 12 },
        { header: 'LLM primary calls', key: 'llm_primary', type: 'integer', width: 14 },
        { header: 'Source budget ceiling', key: 'source_budget', width: 18 },
        { header: 'LLM budget ceiling', key: 'llm_budget', width: 18 },
        { header: 'Source cost status', key: 'source_cost', width: 16 },
        { header: 'LLM cost status', key: 'llm_cost', width: 16 },
        { header: 'Data mode', key: 'data_mode', width: 12 },
        { header: 'Generated at', key: 'generated_at', type: 'datetime', width: 20 }
      ],
      rows: [{
        agent_request_id: b.agent_request_id, report_id: b.report_id,
        run_ids: join(b.run_ids ? Object.values(b.run_ids).filter(Boolean) : meta.run_ids),
        calls: meta.calls != null ? meta.calls : sum.external_calls,
        llm_primary: meta.llm_primary != null ? meta.llm_primary : sum.llm_primary_calls,
        source_budget: budgets.source_budget_usd != null ? budgets.source_budget_usd : 'unknown',
        llm_budget: budgets.llm_budget_usd != null ? budgets.llm_budget_usd : 'unknown',
        source_cost: sum.source_cost_status || 'unknown', llm_cost: sum.llm_cost_status || 'unknown',
        data_mode: b.data_mode || meta.data_mode || 'live', generated_at: meta.generated_at || b.created_at
      }]
    }
  ];
}

// buildReportPackage(bundle, scope, opts) -> { filename, mime, buffer, sheet_names, row_counts, size_bytes }
function buildReportPackage(bundle, scope, opts) {
  bundle = bundle || {}; opts = opts || {};
  assertScope(bundle, scope || {});
  const sheets = buildSheets(bundle);
  const buffer = workbookBuffer(sheets);
  const maxBytes = opts.max_bytes || 25 * 1024 * 1024; // reasonable file-size ceiling
  if (buffer.length > maxBytes) throw new Error('report package exceeds size limit (' + buffer.length + ' > ' + maxBytes + ')');
  const row_counts = {};
  sheets.forEach(s => { row_counts[s.name] = (s.rows || []).length; });
  return {
    filename: 'marketing_scout_' + safeReportId(bundle.report_id) + '_report.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: buffer, sheet_names: sheets.map(s => s.name), row_counts: row_counts, size_bytes: buffer.length,
    report_id: str(bundle.report_id).trim(), agent_request_id: str(bundle.agent_request_id).trim()
  };
}

module.exports = { buildReportPackage, buildSheets, SHEET_NAMES, qualityHighlight };
