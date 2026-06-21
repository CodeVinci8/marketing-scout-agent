'use strict';
// report_charts.js — deterministic chart generation from FACTUAL report data (Section 4).
//
// Charts are derived ONLY from validated numeric/categorical fields already in the report bundle — Claude is
// never asked to invent values. Every chart carries a title, the data timestamp and the report ID. Insufficient
// data returns an honest explanation instead of a misleading picture; a trend is never implied from a single
// observation; unknown categories stay explicit ("н/д"), never silently coerced to 0. Output is deterministic
// SVG (the safe local/offline fallback when no PNG renderer is present). Pure, $0, offline. Charts use the
// same scoped/idempotent attachment contract as the XLSX package.

const { assertScope, safeReportId } = require('./report_export.js');

function str(v) { return v == null ? '' : String(v); }
function num(v) { if (v == null || String(v).trim() === '') return null; const n = Number(v); return isFinite(n) ? n : null; }
function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

const CHART_TYPES = [
  'competitor_score', 'competitor_offer_count', 'price_rate', 'source_quality_distribution',
  'platform_coverage', 'change_categories', 'cta_frequency'
];
const TITLES = {
  competitor_score: 'Сравнение конкурентов по оценке',
  competitor_offer_count: 'Количество предложений по конкурентам',
  price_rate: 'Сравнение ставок / цен',
  source_quality_distribution: 'Качество источников',
  platform_coverage: 'Покрытие по платформам',
  change_categories: 'Категории обнаруженных изменений',
  cta_frequency: 'Частота CTA / УТП'
};

// ---- deterministic data extraction (factual only) ----------------------------------------------------
function countBy(rows, keyFn) {
  const m = {};
  for (const r of rows) { const k = keyFn(r); if (k == null || k === '') { m['н/д'] = (m['н/д'] || 0) + 1; } else { m[k] = (m[k] || 0) + 1; } }
  return Object.keys(m).sort().map(k => ({ label: k, value: m[k] }));
}

function chartData(bundle, type) {
  bundle = bundle || {};
  if (type === 'competitor_score') {
    const items = (bundle.competitors || []).map(c => ({ label: str(c.competitor), value: num(c.score), unknown: num(c.score) == null }));
    return finalize(items, 'оценка');
  }
  if (type === 'competitor_offer_count') {
    const byComp = {};
    (bundle.offers || []).forEach(o => { const c = str(o.competitor) || 'н/д'; byComp[c] = (byComp[c] || 0) + 1; });
    const items = Object.keys(byComp).sort().map(c => ({ label: c, value: byComp[c] }));
    return finalize(items, 'предложений');
  }
  if (type === 'price_rate') {
    // only offers whose price/rate has an extractable number (e.g. "4,5%" -> 4.5)
    const items = (bundle.offers || []).map(o => {
      const m = str(o.price_rate).replace(',', '.').match(/-?\d+(\.\d+)?/);
      return { label: str(o.competitor) + ' — ' + str(o.offer).slice(0, 24), value: m ? Number(m[0]) : null, unknown: !m };
    }).filter(x => x.value != null);
    return finalize(items, '%/цена');
  }
  if (type === 'source_quality_distribution') return finalize(countBy(bundle.source_quality || [], r => str(r.status).toLowerCase()), 'источников');
  if (type === 'platform_coverage') return finalize(countBy(bundle.source_quality || [], r => str(r.platform).toLowerCase()), 'источников');
  if (type === 'change_categories') return finalize(countBy(bundle.changes || [], r => str(r.change_category).toLowerCase()), 'изменений');
  if (type === 'cta_frequency') return finalize(countBy(bundle.offers || [], r => str(r.cta).toLowerCase()), 'предложений');
  return { insufficient_data: true, reason: 'unknown_chart_type:' + type, items: [] };
}
function finalize(items, unit) {
  items = (items || []).filter(Boolean);
  if (items.length === 0) return { insufficient_data: true, reason: 'no_data_points', items: [], unit: unit };
  const known = items.filter(i => !i.unknown && num(i.value) != null);
  if (known.length === 0) return { insufficient_data: true, reason: 'all_values_unknown', items: items, unit: unit };
  return { insufficient_data: false, items: items, unit: unit };
}

// ---- deterministic SVG -------------------------------------------------------------------------------
function barChartSvg(title, subtitle, items, unit) {
  const W = 720, pad = 16, labelW = 220, rowH = 28, top = 64;
  const H = top + items.length * rowH + 28;
  const max = Math.max.apply(null, items.map(i => Math.max(0, num(i.value) || 0)).concat([1]));
  const barMaxW = W - labelW - pad * 2 - 60;
  const bars = items.map((it, i) => {
    const y = top + i * rowH;
    const unknown = it.unknown || num(it.value) == null;
    const v = unknown ? 0 : num(it.value);
    const w = unknown ? 0 : Math.round((v / max) * barMaxW);
    const color = unknown ? '#cccccc' : '#305496';
    const valText = unknown ? 'н/д' : String(v);
    return '<text x="' + pad + '" y="' + (y + 18) + '" font-size="13" fill="#222">' + esc(it.label.slice(0, 34)) + '</text>' +
      '<rect x="' + (labelW + pad) + '" y="' + (y + 6) + '" width="' + w + '" height="16" fill="' + color + '"' + (unknown ? ' stroke="#999" stroke-dasharray="3,2"' : '') + '/>' +
      '<text x="' + (labelW + pad + w + 6) + '" y="' + (y + 18) + '" font-size="12" fill="#444">' + esc(valText) + '</text>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Arial,Helvetica,sans-serif">' +
    '<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>' +
    '<text x="' + pad + '" y="26" font-size="17" font-weight="bold" fill="#1a1a1a">' + esc(title) + '</text>' +
    '<text x="' + pad + '" y="46" font-size="11" fill="#777">' + esc(subtitle) + (unit ? ('  ·  ед.: ' + esc(unit)) : '') + '</text>' +
    bars + '</svg>';
}
function insufficientSvg(title, subtitle, reason) {
  const W = 720, H = 160;
  const msg = reason === 'no_data_points' ? 'Недостаточно данных для построения диаграммы.'
    : reason === 'all_values_unknown' ? 'Значения неизвестны — диаграмма не строится (данные не выдуманы).'
    : 'Недостаточно данных: ' + reason;
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Arial,Helvetica,sans-serif">' +
    '<rect width="' + W + '" height="' + H + '" fill="#fff"/>' +
    '<text x="16" y="28" font-size="17" font-weight="bold" fill="#1a1a1a">' + esc(title) + '</text>' +
    '<text x="16" y="48" font-size="11" fill="#777">' + esc(subtitle) + '</text>' +
    '<text x="16" y="96" font-size="14" fill="#b00020">' + esc(msg) + '</text></svg>';
}

// renderChart(bundle, type, scope) -> { type, title, filename, mime, svg, insufficient_data, reason?, data_points }
function renderChart(bundle, type, scope) {
  bundle = bundle || {};
  assertScope(bundle, scope || {});
  if (CHART_TYPES.indexOf(type) < 0) throw new Error('unknown chart type: ' + type + ' (valid: ' + CHART_TYPES.join(', ') + ')');
  const title = TITLES[type];
  const subtitle = 'report ' + str(bundle.report_id) + ' · данные на ' + (str(bundle.created_at) || 'unknown');
  const d = chartData(bundle, type);
  const filename = 'marketing_scout_' + safeReportId(bundle.report_id) + '_chart_' + type + '.svg';
  if (d.insufficient_data) {
    return { type: type, title: title, filename: filename, mime: 'image/svg+xml', svg: insufficientSvg(title, subtitle, d.reason),
      insufficient_data: true, reason: d.reason, data_points: 0, report_id: str(bundle.report_id) };
  }
  return { type: type, title: title, filename: filename, mime: 'image/svg+xml', svg: barChartSvg(title, subtitle, d.items, d.unit),
    insufficient_data: false, data_points: d.items.length, report_id: str(bundle.report_id) };
}

function renderAllCharts(bundle, scope) { return CHART_TYPES.map(t => renderChart(bundle, t, scope)); }

module.exports = { renderChart, renderAllCharts, chartData, CHART_TYPES, TITLES };
