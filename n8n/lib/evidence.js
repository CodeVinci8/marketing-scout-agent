'use strict';
// evidence.js — first-class evidence inspection (Section 5).
//
// Answers "покажи доказательства по X" / "откуда взялась ставка 4,5%?" / "какие данные подтверждают эту
// рекомендацию?" purely from STORED records — zero external calls by default. It never invents an excerpt; an
// empty excerpt stays empty and is flagged. It states clearly when evidence is unavailable and offers an
// explicit (separate) refresh. Recommendations are anchored back to the findings they depend on, so an
// unanchored recommendation is never represented as a confirmed fact. Pagination + scoped export friendly.
// Pure + deterministic, $0, offline.

const { assertScope } = require('./report_export.js');

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }

// freshness label from a collected timestamp vs now and a staleness window (days)
function freshness(collectedAt, now, maxAgeDays) {
  const t0 = Date.parse(str(collectedAt));
  if (!isFinite(t0)) return { age_days: null, status: 'unknown' };
  const t1 = Date.parse(str(now)) || Date.now();
  const age = Math.max(0, (t1 - t0) / 86400000);
  const max = Number(maxAgeDays) || 7;
  return { age_days: Math.round(age * 10) / 10, status: age <= max ? 'fresh' : 'stale' };
}

// Is the source behind a finding currently available? Derived from the matching source_quality row
// (quarantined/error => not available) and the evidence row's own `available` flag.
function sourceAvailability(bundle, ev) {
  if (ev.available === false) return false;
  const runId = low(ev.source_run_id);
  const sq = (bundle.source_quality || []).find(s => low(s.source_run_id) === runId && runId !== '') ||
    (bundle.source_quality || []).find(s => low(s.source) && (low(ev.url).indexOf(low(s.source)) >= 0));
  if (sq && ['quarantined', 'error', 'unavailable', 'failed'].indexOf(low(sq.status)) >= 0) return false;
  return true;
}

// Normalise one stored evidence row into the canonical evidence response item.
function shape(bundle, ev, now, cfg) {
  cfg = cfg || {};
  const excerpt = str(ev.excerpt);
  const fr = freshness(ev.collected_at, now, cfg.evidence_max_age_days);
  return {
    finding_id: str(ev.finding_id), finding: str(ev.finding), competitor: str(ev.competitor),
    source_url: str(ev.url), source_record_id: str(ev.source_record_id), source_run_id: str(ev.source_run_id),
    collected_at: str(ev.collected_at), excerpt: excerpt, has_excerpt: excerpt !== '',
    quality_status: low(ev.source_quality) || 'unknown', confidence: low(ev.confidence) || 'unknown',
    freshness: fr.status, age_days: fr.age_days, currently_available: sourceAvailability(bundle, ev)
  };
}

// queryEvidence(bundle, query, scope, cfg) -> { items, page, page_size, total, has_more, unavailable_note }
// query: { competitor?, finding_id?, text?, links_only?, page?, page_size? }
function queryEvidence(bundle, query, scope, cfg) {
  bundle = bundle || {}; query = query || {}; cfg = cfg || {};
  assertScope(bundle, scope || {});
  const now = cfg.now || bundle.created_at;
  let rows = (bundle.evidence || []).slice();
  if (query.finding_id) rows = rows.filter(e => low(e.finding_id) === low(query.finding_id));
  if (query.competitor) rows = rows.filter(e => low(e.competitor).indexOf(low(query.competitor)) >= 0);
  if (query.text) { const q = low(query.text).replace(',', '.'); rows = rows.filter(e => low(e.excerpt).replace(',', '.').indexOf(q) >= 0 || low(e.finding).replace(',', '.').indexOf(q) >= 0); }

  const items = rows.map(e => shape(bundle, e, now, cfg));
  const page = Math.max(1, Number(query.page) || 1);
  const size = Math.max(1, Math.min(50, Number(query.page_size) || 10));
  const start = (page - 1) * size;
  const pageItems = items.slice(start, start + size).map(it => query.links_only ? { competitor: it.competitor, finding: it.finding, source_url: it.source_url, collected_at: it.collected_at, currently_available: it.currently_available } : it);

  // honest unavailable note: a competitor was asked for but we hold no evidence, or all matches are unavailable
  let unavailable_note = '';
  if (items.length === 0) {
    if (query.competitor) {
      const known = (bundle.competitors || []).find(c => low(c.competitor).indexOf(low(query.competitor)) >= 0);
      unavailable_note = known
        ? ('Нет сохранённых доказательств по «' + str(query.competitor) + '» (источник: ' + low(known.quality) + '). Могу запустить отдельный сбор по запросу.')
        : ('Конкурент «' + str(query.competitor) + '» не найден в этом отчёте.');
    } else unavailable_note = 'Доказательств по запросу не найдено.';
  } else if (items.every(it => !it.currently_available)) {
    unavailable_note = 'Доказательства есть, но источник(и) сейчас недоступны/в карантине — данные из последнего сбора. Могу запустить повторный сбор по запросу.';
  }

  return {
    items: pageItems, page: page, page_size: size, total: items.length,
    has_more: start + size < items.length, unavailable_note: unavailable_note,
    report_id: str(bundle.report_id), agent_request_id: str(bundle.agent_request_id), external_calls: 0
  };
}

// recommendationAnchors(bundle) -> per recommendation: which linked findings resolve to real evidence and
// whether it is therefore evidence-backed. An unanchored recommendation is confirmed=false (never a fact).
function recommendationAnchors(bundle) {
  bundle = bundle || {};
  const evById = {}; (bundle.evidence || []).forEach(e => { if (e.finding_id) evById[str(e.finding_id)] = e; });
  return (bundle.recommendations || []).map(r => {
    const ids = (Array.isArray(r.linked_finding_ids) ? r.linked_finding_ids : str(r.linked_finding_ids).split(/[;,]\s*/)).filter(Boolean);
    const resolved = ids.filter(id => evById[str(id)]);
    return {
      recommendation: str(r.recommendation), priority: low(r.priority),
      linked_finding_ids: ids, resolved_finding_ids: resolved.map(String),
      evidence_backed: resolved.length > 0, confirmed: resolved.length > 0,
      label: resolved.length > 0 ? 'подтверждено доказательствами' : 'гипотеза — нет подтверждающих доказательств'
    };
  });
}

// evidenceForRecommendation(bundle, recId) -> the evidence items its findings depend on (or an honest note).
function evidenceForRecommendation(bundle, recName, scope, cfg) {
  bundle = bundle || {};
  const anchors = recommendationAnchors(bundle).find(a => low(a.recommendation).indexOf(low(recName)) >= 0);
  if (!anchors) return { found: false, note: 'Рекомендация не найдена.', items: [] };
  if (!anchors.evidence_backed) return { found: true, evidence_backed: false, note: anchors.label, items: [] };
  const out = [];
  for (const id of anchors.resolved_finding_ids) {
    const r = queryEvidence(bundle, { finding_id: id }, scope, cfg);
    out.push.apply(out, r.items);
  }
  return { found: true, evidence_backed: true, note: anchors.label, items: out, external_calls: 0 };
}

module.exports = { queryEvidence, recommendationAnchors, evidenceForRecommendation, freshness, sourceAvailability, shape };
