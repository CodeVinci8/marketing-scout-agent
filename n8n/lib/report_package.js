'use strict';
// report_package.js — assemble the user-facing XLSX report package from a stored report bundle (Sections 3.2 / 19).
// Operational Sheets stay internal; this is the intentionally-designed user workbook. Russian sheet names AND
// headers (B7 + Stage F §6); the only technical sheet is hidden.
//
// Sheets (fixed order): Сводка, Конкуренты, Офферы и цены, Аналитические выводы*, Рекомендации, Боли и сигналы*,
// Доказательства, Качество данных, Изменения, Технические данные(hidden). (* = Stage F, present only when the
// analyst produced grounded rows.) Generated from stored report data only — never re-collected. Scope is
// re-asserted before anything is produced (report isolation). Pure + deterministic, $0, offline.

const { assertScope, safeReportId } = require('./report_export.js');
const { workbookBuffer } = require('./xlsx_writer.js');

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function join(a) { return Array.isArray(a) ? a.join('; ') : str(a); }

// Stage F adds «Аналитические выводы» + «Боли и сигналы» and FEEDS the existing «Рекомендации» / «Доказательства»
// sheets (the deterministic bundle leaves evidence empty). Every Stage-F sheet is omit-empty: it exists only when
// the analyst actually produced grounded rows, so a deterministic-only run ships exactly the workbook it did before.
const SHEET_NAMES = ['Сводка', 'Конкуренты', 'Офферы и цены', 'Аналитические выводы', 'Рекомендации',
  'Боли и сигналы', 'Доказательства', 'Качество данных', 'Изменения', 'Технические данные'];
const STAGE_F_SHEETS = ['Аналитические выводы', 'Боли и сигналы'];

// quality/status -> highlight bucket (good/warn/bad). Unknown -> no highlight.
function qualityHighlight(v) {
  const s = low(v);
  if (['healthy', 'ok', 'eligible', 'active', 'good'].indexOf(s) >= 0) return 'good';
  if (['degraded', 'warn', 'stale', 'paused', 'pending'].indexOf(s) >= 0) return 'warn';
  if (['quarantined', 'failed', 'error', 'excluded', 'unavailable', 'bad'].indexOf(s) >= 0) return 'bad';
  return null;
}

// REPORT-TRUTH-D helpers ----------------------------------------------------------------------------------------
const RP_MODE_RU = {
  source_analysis: 'анализ текущего состояния источника', change_report: 'отчёт об изменениях',
  comparison: 'сравнение источников', synthesis: 'сводный анализ', candidate_enrichment: 'оценка кандидатов',
  public_lead_interpretation: 'интерпретация публичных сигналов', opportunity_radar: 'поиск возможностей',
  monitoring_insight: 'мониторинговое уведомление'
};
function rpModeRu(v) { return RP_MODE_RU[low(v)] || RP_MODE_RU.source_analysis; }
function rpHost(u) { const m = str(u).match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1].replace(/^www\./i, '') : ''; }
function rpSourceType(u) {
  const h = low(rpHost(u));
  if (/(^|\.)t\.me$|telegram/.test(h)) return 'telegram';
  if (/(^|\.)vk\.com$/.test(h)) return 'vk';
  if (/avito\.ru$/.test(h)) return 'avito';
  return h ? 'website' : '';
}
function rpMoney(v) { const n = Number(v); return isFinite(n) ? ('$' + (Math.round(n * 10000) / 10000)) : ''; }
// Offer text is machine-built upstream — internal enums and boilerplate never reach a user sheet.
function rpCleanOffer(text) {
  return str(text)
    .replace(/^Предложение конкурента\s*\([^)]*\)[,.]?\s*/i, '')
    .replace(/услуга:\s*[a-z0-9_]+\.?\s*/gi, '')
    .replace(/^условия:\s*/i, '').trim();
}
function rpNorm(s) { return low(s).replace(/[^а-яёa-z0-9%]+/gi, ' ').replace(/\s+/g, ' ').trim(); }
function rpDedupOffers(offers) {
  const seen = {}; const out = [];
  (offers || []).forEach(o => {
    const clean = Object.assign({}, o, { offer: rpCleanOffer(o && o.offer) });
    const key = rpNorm(str(clean.competitor) + '|' + str(clean.offer) + '|' + str(clean.price_rate));
    if (seen[key]) return; seen[key] = true;
    out.push(clean);
  });
  return out;
}
// Execution data mode for the Summary: reuse vs fresh collection, from the reused_sources audit.
function rpDataModeRu(sum, b) {
  const reused = Array.isArray(sum.reused_sources) ? sum.reused_sources.length : 0;
  if (!reused) return 'свежий сбор';
  const total = (b.source_quality || []).length || (b.competitors || []).length || reused;
  return reused >= total ? 'сохранённые данные (без нового сбора)' : 'смешанный (часть из сохранённых данных)';
}

function buildSheets(b) {
  const sum = b.summary || {};
  const meta = b.run_metadata || {};
  const budgets = b.budgets || {};
  // Stage-F analysis rows (analysis_report_ru.analysisXlsxData). Absent on a deterministic-only run -> every
  // Stage-F sheet stays empty and omit_empty drops it.
  const an = b.analysis || {};
  const scopeStr = [b.niche, b.region, (b.time_window_days ? b.time_window_days + 'd' : '')].filter(Boolean).join(' · ');
  const filterStr = b.active_filters ? join(b.active_filters) : '';
  const offers = rpDedupOffers(b.offers);
  const limitations = join(an.unknowns);

  return [
    {
      name: 'Сводка', freeze_header: true, autofilter: false,
      columns: [
        { header: 'Запрос', key: 'request', width: 22 },
        { header: 'Тип отчёта', key: 'mode', width: 26 },
        { header: 'Режим данных', key: 'data_mode', width: 26 },
        { header: 'Ниша', key: 'niche', width: 18 },
        { header: 'Регион запроса', key: 'region', width: 16 },
        { header: 'Дата отчёта', key: 'date', type: 'datetime', width: 20 },
        { header: 'Найдено конкурентов', key: 'competitors', type: 'integer', width: 18 },
        { header: 'Проверено источников (в этом запросе)', key: 'sources', type: 'integer', width: 20 },
        { header: 'Качество данных', key: 'quality', width: 16 },
        { header: 'Охват', key: 'scope', width: 26 },
        { header: 'Активные фильтры', key: 'filters', width: 24 },
        { header: 'Ключевые находки', key: 'findings', width: 50 },
        { header: 'Ключевые рекомендации', key: 'recs', width: 50 },
        { header: 'Ограничения данных', key: 'limitations', width: 50 },
        { header: 'Внешних запросов', key: 'calls', type: 'integer', width: 16 },
        // REPORT-TRUTH-D: actual component costs, not status enums.
        { header: 'Стоимость: сбор', key: 'cost_collection', width: 14 },
        { header: 'Стоимость: AI-сводка', key: 'cost_summary_ai', width: 16 },
        { header: 'Стоимость: AI-анализ', key: 'cost_deep_ai', width: 16 },
        { header: 'Стоимость: восстановление', key: 'cost_repair', width: 18 },
        { header: 'Стоимость: итого', key: 'cost_total', width: 14 }
      ],
      rows: [{
        request: b.agent_request_id, mode: rpModeRu(b.analysis_mode), data_mode: rpDataModeRu(sum, b),
        niche: b.niche, region: b.region, date: b.created_at,
        competitors: sum.competitors_found != null ? sum.competitors_found : (b.competitors || []).length,
        // Scope truth: this counts the sources of THIS request, never the global inventory.
        sources: sum.sources_checked != null ? sum.sources_checked : (b.source_quality || []).length,
        quality: sum.quality_status, scope: scopeStr, filters: filterStr,
        findings: join(sum.key_findings),
        recs: join([].concat(sum.key_recommendations || []).map(str).filter(s => s.trim())),
        limitations: limitations,
        calls: sum.external_calls_actual != null ? sum.external_calls_actual : sum.external_calls,
        cost_collection: rpMoney(sum.actual_collection_usd), cost_summary_ai: rpMoney(sum.actual_summary_ai_usd),
        cost_deep_ai: rpMoney(sum.actual_deep_analysis_usd), cost_repair: rpMoney(sum.actual_repair_usd),
        cost_total: rpMoney(sum.actual_cost_usd)
      }],
      highlight: (r, c) => c.key === 'quality' ? qualityHighlight(r.quality) : null
    },
    {
      name: 'Конкуренты', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Конкурент', key: 'competitor', width: 26 },
        { header: 'Домен', key: 'domain', width: 24 },
        { header: 'Тип источника', key: 'source_type', width: 14 },
        // The region shown is the REQUEST scope — an evidenced source region is a separate future field, and the
        // two must never be conflated (§7).
        { header: 'Регион запроса', key: 'region', width: 16 },
        { header: 'Позиционирование', key: 'positioning', width: 40 },
        { header: 'Оценка', key: 'score', type: 'number', width: 10 },
        { header: 'Качество', key: 'quality', width: 12 },
        { header: 'Последняя проверка', key: 'last_checked', type: 'datetime', width: 20 },
        { header: 'Ссылка на источник', key: 'source_url', type: 'url', width: 38 }
      ],
      rows: (b.competitors || []).map(c => Object.assign({}, c, {
        domain: str(c.domain) || rpHost(c.source_url),
        source_type: rpSourceType(c.source_url)
      })),
      highlight: (r, c) => c.key === 'quality' ? qualityHighlight(r.quality) : null
    },
    {
      name: 'Офферы и цены', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Конкурент', key: 'competitor', width: 26 },
        { header: 'Оффер', key: 'offer', width: 44 },
        { header: 'Цена / ставка', key: 'price_rate', width: 18 },
        { header: 'Диапазон суммы', key: 'amount_range', width: 18 },
        { header: 'Срок', key: 'term', width: 14 },
        { header: 'Призыв к действию', key: 'cta', width: 20 },
        { header: 'Акция', key: 'promotion', width: 24 },
        { header: 'Собрано', key: 'collected_at', type: 'datetime', width: 20 },
        { header: 'Ссылка на доказательство', key: 'evidence_url', type: 'url', width: 38 }
      ],
      rows: offers
    },
    // Stage F: ONLY kind=inference — interpretation, kept physically apart from facts so it can never read as one.
    {
      name: 'Аналитические выводы', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Источник', key: 'source', width: 26 },
        { header: 'Тема', key: 'dimension', width: 22 },
        { header: 'Вывод (интерпретация, не факт)', key: 'text', width: 70 },
        { header: 'Доказательства', key: 'evidence', width: 16 }
      ],
      rows: an.inferences || []
    },
    {
      name: 'Рекомендации', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Рекомендация', key: 'recommendation', width: 50 },
        { header: 'Приоритет', key: 'priority', width: 12 },
        { header: 'Обоснование', key: 'rationale', width: 50 },
        { header: 'Доказательства', key: 'linked_finding_ids', width: 20 },
        { header: 'Следующий шаг', key: 'next_action', width: 40 }
      ],
      // deterministic angles first (authoritative), then the analyst's evidence-cited proposals.
      // REPORT-TRUTH-D: no empty placeholder rows; a recommendation without evidence is explicitly a hypothesis.
      rows: (b.recommendations || []).map(r => Object.assign({}, r, { linked_finding_ids: join(r.linked_finding_ids) }))
        .concat((an.recommendations || []).map(r => ({
          recommendation: str(r.text), priority: str(r.priority), rationale: str(r.source),
          linked_finding_ids: str(r.evidence), next_action: ''
        })))
        .filter(r => str(r.recommendation).trim())
        .map(r => (str(r.linked_finding_ids).trim() ? r
          : Object.assign({}, r, { rationale: (str(r.rationale) ? str(r.rationale) + ' — ' : '') + 'гипотеза (без прямых доказательств в этом отчёте)' })))
    },
    // Stage F: recurring pains/objections — the "what hurts customers" view, evidence-cited.
    {
      name: 'Боли и сигналы', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Источник', key: 'source', width: 26 },
        { header: 'Тип', key: 'kind', width: 18 },
        { header: 'Что видно в данных', key: 'text', width: 70 },
        { header: 'Доказательства', key: 'evidence', width: 16 }
      ],
      rows: an.pains || []
    },
    {
      name: 'Доказательства', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Ссылка', key: 'ref', width: 10 },
        { header: 'Наблюдение', key: 'finding', width: 40 },
        { header: 'Конкурент', key: 'competitor', width: 24 },
        { header: 'Цитата', key: 'excerpt', width: 60 },
        { header: 'URL', key: 'url', type: 'url', width: 40 },
        { header: 'Качество источника', key: 'source_quality', width: 18 },
        { header: 'Собрано', key: 'collected_at', type: 'datetime', width: 20 }
      ],
      // The deterministic bundle ships evidence:[]; Stage F fills this sheet with the exact sources every
      // analytical claim cites, so [1]/[2] markers in the report resolve to a clickable URL here.
      // Honest blanks: a field we did not capture stays empty — it is never fabricated.
      rows: (b.evidence || []).concat((an.evidence || []).map(e => ({
        ref: str(e.ref), finding: str(e.type) ? ('цитируемый источник анализа (' + str(e.type) + ')') : '',
        competitor: str(e.source), excerpt: '', url: str(e.url),
        source_quality: '', collected_at: ''
      }))),
      highlight: (r, c) => c.key === 'source_quality' ? qualityHighlight(r.source_quality) : null
    },
    {
      name: 'Качество данных', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Источник', key: 'source', width: 30 },
        { header: 'Платформа', key: 'platform', width: 16 },
        { header: 'Оценка здоровья', key: 'health_score', type: 'number', width: 16 },
        { header: 'Статус', key: 'status', width: 14 },
        { header: 'Свежесть', key: 'freshness', width: 18 },
        { header: 'Исключения', key: 'exclusions', width: 30 },
        { header: 'Ошибка', key: 'error', width: 30 }
      ],
      rows: (b.source_quality || []).map(r => Object.assign({}, r, { exclusions: join(r.exclusions) })),
      highlight: (r, c) => c.key === 'status' ? qualityHighlight(r.status) : null
    },
    {
      name: 'Изменения', freeze_header: true, autofilter: true,
      columns: [
        { header: 'Конкурент / источник', key: 'entity', width: 28 },
        { header: 'Тип изменения', key: 'change_category', width: 20 },
        { header: 'Было', key: 'before', width: 40 },
        { header: 'Стало', key: 'after', width: 40 },
        { header: 'Обнаружено', key: 'detected_at', type: 'datetime', width: 20 },
        { header: 'Доказательство', key: 'evidence_url', type: 'url', width: 38 }
      ],
      rows: b.changes || []
    },
    {
      name: 'Технические данные', hidden: true, freeze_header: true, autofilter: false,
      columns: [
        { header: 'Agent request ID', key: 'agent_request_id', width: 28 },
        { header: 'Report ID', key: 'report_id', width: 28 },
        { header: 'Run IDs', key: 'run_ids', width: 40 },
        { header: 'Внешних запросов', key: 'calls', type: 'integer', width: 16 },
        { header: 'LLM primary calls', key: 'llm_primary', type: 'integer', width: 14 },
        { header: 'Source budget ceiling', key: 'source_budget', width: 18 },
        { header: 'LLM budget ceiling', key: 'llm_budget', width: 18 },
        { header: 'Source cost status', key: 'source_cost', width: 16 },
        { header: 'LLM cost status', key: 'llm_cost', width: 16 },
        { header: 'Data mode', key: 'data_mode', width: 12 },
        { header: 'Analysis mode', key: 'analysis_mode', width: 18 },
        { header: 'Generated at', key: 'generated_at', type: 'datetime', width: 20 },
        // Stage F: analysis lineage + AI telemetry live ONLY here (§6) — never in a user-facing sheet.
        { header: 'Analysis IDs', key: 'analysis_ids', width: 40 },
        { header: 'AI analyses', key: 'ai_analyses', type: 'integer', width: 12 },
        { header: 'AI reused', key: 'ai_reused', type: 'integer', width: 12 },
        { header: 'AI fallbacks', key: 'ai_fallbacks', type: 'integer', width: 12 },
        { header: 'AI cost usd', key: 'ai_cost_usd', width: 14 },
        { header: 'AI repair cost usd', key: 'ai_repair_cost_usd', width: 16 },
        { header: 'AI model', key: 'ai_model', width: 22 },
        // REUSE-OBS-001: the audit trail for cached analyses — which persisted analysis a reused result came
        // from, and the explicit cache decision + reason for every WF28 invocation. Hidden sheet only (§6).
        { header: 'AI reused from', key: 'ai_reused_from', width: 40 },
        { header: 'AI cache decisions', key: 'ai_cache_decisions', width: 60 },
        // REPORT-TRUTH-D: full run telemetry — component costs, tokens, latency, final outcome.
        { header: 'Cost collection usd', key: 'cost_collection', width: 16 },
        { header: 'Cost summary AI usd', key: 'cost_summary_ai', width: 16 },
        { header: 'Cost deep AI usd', key: 'cost_deep_ai', width: 16 },
        { header: 'Cost repair usd', key: 'cost_repair', width: 16 },
        { header: 'Cost total usd', key: 'cost_total', width: 14 },
        { header: 'AI tokens in', key: 'ai_tokens_in', type: 'integer', width: 12 },
        { header: 'AI tokens out', key: 'ai_tokens_out', type: 'integer', width: 12 },
        { header: 'AI latency ms', key: 'ai_latency_ms', type: 'integer', width: 12 },
        { header: 'Final state', key: 'final_state', width: 14 },
        { header: 'Claim audit', key: 'claim_audit', width: 60 }
      ],
      rows: [{
        analysis_ids: join(an.analysis_ids), ai_analyses: an.count_enriched, ai_reused: an.count_reused,
        ai_fallbacks: an.count_fallback, ai_cost_usd: an.analysis_cost_usd,
        ai_repair_cost_usd: an.repair_cost_usd != null ? an.repair_cost_usd : '', ai_model: str(an.model),
        ai_reused_from: join((an.reuse_lineage || []).map(l => str(l.reused_from_analysis_id)).filter(Boolean)),
        ai_cache_decisions: join((an.cache_decisions || []).map(d => str(d.decision) + (d.reason ? (': ' + str(d.reason)) : ''))),
        agent_request_id: b.agent_request_id, report_id: b.report_id,
        run_ids: join(b.run_ids ? Object.values(b.run_ids).filter(Boolean) : meta.run_ids),
        calls: meta.calls != null ? meta.calls : (sum.external_calls_actual != null ? sum.external_calls_actual : sum.external_calls),
        llm_primary: meta.llm_primary != null ? meta.llm_primary : sum.llm_primary_calls,
        source_budget: budgets.source_budget_usd != null ? budgets.source_budget_usd : 'unknown',
        llm_budget: budgets.llm_budget_usd != null ? budgets.llm_budget_usd : 'unknown',
        source_cost: sum.source_cost_status || 'unknown', llm_cost: sum.llm_cost_status || 'unknown',
        data_mode: b.data_mode || meta.data_mode || 'live', generated_at: meta.generated_at || b.created_at,
        analysis_mode: str(b.analysis_mode) || 'source_analysis',
        cost_collection: rpMoney(sum.actual_collection_usd), cost_summary_ai: rpMoney(sum.actual_summary_ai_usd),
        cost_deep_ai: rpMoney(sum.actual_deep_analysis_usd), cost_repair: rpMoney(sum.actual_repair_usd),
        cost_total: rpMoney(sum.actual_cost_usd),
        ai_tokens_in: an.tokens_in != null ? an.tokens_in : '', ai_tokens_out: an.tokens_out != null ? an.tokens_out : '',
        ai_latency_ms: an.latency_ms != null ? an.latency_ms : '',
        final_state: str(sum.final_state), claim_audit: b.claim_audit ? JSON.stringify(b.claim_audit).slice(0, 500) : ''
      }]
    }
  ];
}

// buildReportPackage(bundle, scope, opts) -> { filename, mime, buffer, sheet_names, row_counts, size_bytes }
// XLSX-OMIT-EMPTY-001: sheets that are ALWAYS meaningful even with one row (the run's identity/scope).
const ALWAYS_KEEP_SHEETS = ['Сводка', 'Технические данные'];
function buildReportPackage(bundle, scope, opts) {
  bundle = bundle || {}; opts = opts || {};
  assertScope(bundle, scope || {});
  let sheets = buildSheets(bundle);
  // omit_empty (opt-in; WF24 sets it): a downloadable report should not carry header-only sheets for sections
  // that produced nothing. Summary + Run_Metadata always stay so the file is never contentless.
  if (opts.omit_empty) sheets = sheets.filter(s => (s.rows || []).length > 0 || ALWAYS_KEEP_SHEETS.indexOf(s.name) >= 0);
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

// djb2 — stable, dependency-free content hash (self-contained so this lib stays embeddable).
function djb2(s) { s = String(s == null ? '' : s); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'h' + h.toString(16); }

// An attachment outbox row, deterministic in (owner, agent_request_id, report_id, kind, content) so the SAME
// generated file for the SAME request can never be enqueued/sent twice. Scope is part of the id (isolation).
function attachmentDelivery(scope, kind, content) {
  scope = scope || {};
  const hash = djb2(str(kind) + '|' + (content == null ? '' : (typeof content === 'string' ? content : String(content))));
  const owner = str(scope.owner_user_id), arid = str(scope.agent_request_id), rep = str(scope.report_id);
  return {
    delivery_id: ['att', owner || 'own', arid || 'req', rep || 'rep', str(kind), hash].join('_'),
    owner_user_id: owner, agent_request_id: arid, report_id: rep,
    kind: str(kind), content_hash: hash, send_status: 'pending', attempts: 0, telegram_message_id: '', last_error: ''
  };
}
// Idempotent enqueue: if an existing attachment delivery with the same id is already sent, skip (no double-send).
function shouldSendAttachment(existing, delivery) {
  const prior = (existing || []).filter(d => str(d.delivery_id) === str(delivery.delivery_id));
  if (prior.some(d => str(d.send_status) === 'sent')) return { send: false, reason: 'already_sent' };
  return { send: true, reason: '' };
}

module.exports = { buildReportPackage, buildSheets, SHEET_NAMES, STAGE_F_SHEETS, ALWAYS_KEEP_SHEETS, qualityHighlight, attachmentDelivery, shouldSendAttachment, djb2 };
