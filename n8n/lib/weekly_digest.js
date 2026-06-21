'use strict';
// weekly_digest.js — one weekly digest per owner per ISO week, built ONLY from already-stored data (Section 11).
//
// The digest never recollects sources: it reads completed reports, source change events, tracked sources,
// source health, execution summaries and existing recommendations that are already in storage, and assembles a
// per-owner weekly summary. Strict owner isolation (no other owner's rows ever leak). Deterministic digest id +
// idempotency key in (owner, ISO week), so the same week is emitted exactly once. An empty week is suppressed
// unless explicitly enabled. Enabling/disabling the scheduled digest requires confirmation. Pure + $0, 0 calls.
// Self-contained (no cross-require) so it can be embedded verbatim into the generated workflow.

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function num(v) { if (v == null || str(v).trim() === '') return null; const n = Number(v); return isFinite(n) ? n : null; }
function arr(v) { return Array.isArray(v) ? v : []; }
function canonDomain(c) { return low(c && (c.domain || c.competitor)).replace(/^www\./, ''); }
function offerKey(o) { return low(o.competitor) + '::' + low(o.offer); }
// "4,5%" / "5.9" -> 4.5 / 5.9 ; non-numeric -> null (never fabricate a number)
function rateNum(v) { const s = str(v).replace('%', '').replace(',', '.').trim(); if (s === '') return null; const n = Number(s); return isFinite(n) ? n : null; }

// --- ISO 8601 week (deterministic, UTC, no deps) ----------------------------------------------------
function isoWeek(iso) {
  const d = new Date(str(iso));
  if (isNaN(d.getTime())) return { year: 0, week: 0, key: '0000-W00' };
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;            // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);      // Thursday decides the year/week
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThu.getTime()) / (7 * 86400000));
  return { year: date.getUTCFullYear(), week: week, key: date.getUTCFullYear() + '-W' + (week < 10 ? '0' : '') + week };
}
function inWeek(iso, weekKey) { return isoWeek(iso).key === weekKey; }

function digestId(owner, weekKey) { return 'digest_' + str(owner) + '_' + str(weekKey); }
// idempotency is exactly (owner, ISO week): a re-run for the same owner/week produces the same key.
function idempotencyKey(owner, weekKey) { return digestId(owner, weekKey); }

// minimal report-to-report diff (self-contained; the rich diff lives in report_compare.js for the compare feature)
function diffReports(current, baseline) {
  const cur = current || {}, base = baseline || {};
  const curComp = arr(cur.competitors), baseComp = arr(base.competitors);
  const baseDomains = {}; baseComp.forEach(c => { baseDomains[canonDomain(c)] = c; });
  const new_competitors = curComp.filter(c => !baseDomains[canonDomain(c)]).map(c => ({ competitor: str(c.competitor), domain: canonDomain(c), score: num(c.score), report_id: str(cur.report_id) }));

  const curOffers = arr(cur.offers), baseOffers = arr(base.offers);
  const baseByKey = {}; baseOffers.forEach(o => { baseByKey[offerKey(o)] = o; });
  const curByKey = {}; curOffers.forEach(o => { curByKey[offerKey(o)] = o; });
  const new_offers = curOffers.filter(o => !baseByKey[offerKey(o)]).map(o => ({ competitor: str(o.competitor), offer: str(o.offer), price_rate: str(o.price_rate), evidence_url: str(o.evidence_url) }));
  const removed_offers = baseOffers.filter(o => !curByKey[offerKey(o)]).map(o => ({ competitor: str(o.competitor), offer: str(o.offer), price_rate: str(o.price_rate) }));
  const rate_changes = [];
  curOffers.forEach(o => {
    const b = baseByKey[offerKey(o)]; if (!b) return;
    const a = rateNum(o.price_rate), p = rateNum(b.price_rate);
    if (a != null && p != null && a !== p) rate_changes.push({ competitor: str(o.competitor), offer: str(o.offer), before: str(b.price_rate), after: str(o.price_rate), direction: a < p ? 'down' : 'up', evidence_url: str(o.evidence_url) });
  });
  return { new_competitors: new_competitors, new_offers: new_offers, removed_offers: removed_offers, rate_changes: rate_changes };
}

// buildWeeklyDigest(input) -> { ok, empty, suppressed, digest }
// input: { owner_user_id, now, reports[], change_events[], tracked_sources[], execution_summaries[], cfg, force }
function buildWeeklyDigest(input) {
  input = input || {};
  const owner = str(input.owner_user_id);
  const cfg = input.cfg || {};
  const wk = isoWeek(input.now || new Date().toISOString());
  const weekKey = wk.key;

  // OWNER ISOLATION: every collection is filtered to this owner before anything else is computed.
  const ownReports = arr(input.reports).filter(r => str(r.owner_user_id) === owner);
  const reportsThisWeek = ownReports.filter(r => inWeek(r.created_at, weekKey))
    .sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)));
  const current = reportsThisWeek.length ? reportsThisWeek[reportsThisWeek.length - 1] : null;
  // baseline = the latest owner report strictly BEFORE this week (no recollection, just history)
  const earlier = ownReports.filter(r => str(r.created_at).localeCompare(str(current && current.created_at || input.now)) < 0 && !inWeek(r.created_at, weekKey))
    .sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)));
  const baseline = earlier.length ? earlier[earlier.length - 1] : null;

  const diff = current ? diffReports(current, baseline) : { new_competitors: [], new_offers: [], removed_offers: [], rate_changes: [] };

  const changeEvents = arr(input.change_events)
    .filter(e => str(e.owner_user_id) === owner && inWeek(e.ts, weekKey))
    .map(e => ({ change_id: str(e.change_id), platform: str(e.platform), ref: str(e.ref), summary: str(e.summary), ts: str(e.ts) }));

  const sources = arr(input.tracked_sources).filter(s => str(s.owner_user_id) === owner);
  const degraded_sources = sources
    .filter(s => ['degraded', 'quarantined', 'failed', 'error'].indexOf(low(s.status)) >= 0)
    .map(s => ({ ref: str(s.ref || s.label), platform: str(s.platform), status: low(s.status) }));
  const unavailable_sources = sources
    .filter(s => ['setup_required', 'unsupported', 'paused'].indexOf(low(s.status)) >= 0)
    .map(s => ({ ref: str(s.ref || s.label), platform: str(s.platform), status: low(s.status) }));

  // health from the current report's source_quality (already stored — no recollection)
  const health = current ? arr(current.source_quality).map(q => ({ source: str(q.source), status: low(q.status), health_score: num(q.health_score), exclusions: arr(q.exclusions) })) : [];

  const recs = current ? arr(current.recommendations) : [];
  const high_priority_recommendations = recs.filter(r => low(r.priority) === 'high')
    .map(r => ({ recommendation: str(r.recommendation), rationale: str(r.rationale), linked_finding_ids: arr(r.linked_finding_ids) }));

  // call/cost summary from stored execution summaries (this owner+week) — falls back to report run_metadata
  const summaries = arr(input.execution_summaries).filter(s => str(s.owner_user_id) === owner && inWeek(s.created_at || s.generated_at, weekKey));
  let external_calls = 0, llm_primary = 0, llm_repair = 0;
  summaries.forEach(s => { external_calls += num(s.external_calls) || 0; llm_primary += num(s.llm_primary_calls) || 0; llm_repair += num(s.llm_repair_calls) || 0; });
  if (!summaries.length && current && current.run_metadata) { external_calls = num(current.run_metadata.calls) || 0; llm_primary = num(current.run_metadata.llm_primary) || 0; }
  const llm_cost_status = (current && current.summary && str(current.summary.llm_cost_status)) || 'unknown';

  const report_links = reportsThisWeek.map(r => ({ report_id: str(r.report_id), created_at: str(r.created_at), agent_request_id: str(r.agent_request_id) }));

  const major_changes = changeEvents.map(e => e.summary).filter(Boolean);

  const sections = {
    major_changes: major_changes,
    new_offers: diff.new_offers,
    removed_offers: diff.removed_offers,
    rate_changes: diff.rate_changes,
    new_competitors: diff.new_competitors,
    degraded_sources: degraded_sources,
    unavailable_sources: unavailable_sources,
    monitoring_status: { tracked: sources.length, active: sources.filter(s => low(s.status) === 'active').length, degraded: degraded_sources.length, unavailable: unavailable_sources.length },
    high_priority_recommendations: high_priority_recommendations,
    call_summary: { external_calls: external_calls, llm_primary_calls: llm_primary, llm_repair_calls: llm_repair, llm_cost_status: llm_cost_status },
    report_links: report_links,
    source_health: health
  };

  const meaningful = major_changes.length + diff.new_offers.length + diff.removed_offers.length + diff.rate_changes.length +
    diff.new_competitors.length + degraded_sources.length + high_priority_recommendations.length;
  const empty = meaningful === 0;
  const allowEmpty = cfg.allow_empty_digest === true || input.force === true;
  const suppressed = empty && !allowEmpty;

  const digest = {
    digest_id: digestId(owner, weekKey),
    idempotency_key: idempotencyKey(owner, weekKey),
    owner_user_id: owner,
    iso_week: weekKey, year: wk.year, week: wk.week,
    generated_at: str(input.now),
    current_report_id: current ? str(current.report_id) : '',
    baseline_report_id: baseline ? str(baseline.report_id) : '',
    sections: sections,
    item_count: meaningful,
    empty: empty,
    external_calls: 0,            // a digest NEVER collects
    text: ''
  };
  digest.text = renderDigestText(digest);
  return { ok: !suppressed, empty: empty, suppressed: suppressed, digest: digest };
}

// one digest per owner per ISO week: an already-emitted (owner, week) is never emitted again.
function dedupeDigest(existingDigests, digest) {
  const prior = arr(existingDigests).filter(d => str(d.idempotency_key) === str(digest.idempotency_key) || (str(d.owner_user_id) === str(digest.owner_user_id) && str(d.iso_week) === str(digest.iso_week)));
  if (prior.length) return { emit: false, reason: 'already_emitted_this_week' };
  return { emit: true, reason: '' };
}

// enabling/disabling the SCHEDULED digest is a state change -> requires confirmation. Default is disabled.
function scheduleDecision(cfg, op, confirmed) {
  cfg = cfg || {};
  const currently = cfg.enable_weekly_digest === true;
  if (op === 'enable') {
    if (confirmed !== true) return { changed: false, needs_confirmation: true, enabled: currently, reply: 'Включить еженедельный отчёт? Он будет приходить раз в неделю. Подтвердите (да/нет).' };
    return { changed: !currently, needs_confirmation: false, enabled: true, reply: 'Еженедельный отчёт включён.' };
  }
  if (op === 'disable') {
    if (confirmed !== true) return { changed: false, needs_confirmation: true, enabled: currently, reply: 'Выключить еженедельный отчёт? Подтвердите (да/нет).' };
    return { changed: currently, needs_confirmation: false, enabled: false, reply: 'Еженедельный отчёт выключен.' };
  }
  return { changed: false, needs_confirmation: false, enabled: currently, reply: '' };
}

function renderDigestText(d) {
  const s = d.sections; const L = [];
  L.push('🗓 Недельная сводка ' + d.iso_week + (d.current_report_id ? ' (отчёт ' + d.current_report_id + ')' : ''));
  if (s.major_changes.length) L.push('• Главные изменения: ' + s.major_changes.slice(0, 5).join('; '));
  if (s.new_competitors.length) L.push('• Новые конкуренты: ' + s.new_competitors.map(c => c.competitor).join(', '));
  if (s.new_offers.length) L.push('• Новые предложения: ' + s.new_offers.map(o => o.competitor + ' — ' + o.offer).join('; '));
  if (s.removed_offers.length) L.push('• Убранные предложения: ' + s.removed_offers.map(o => o.competitor + ' — ' + o.offer).join('; '));
  if (s.rate_changes.length) L.push('• Изменения ставок: ' + s.rate_changes.map(r => r.competitor + ' ' + r.before + '→' + r.after).join('; '));
  if (s.degraded_sources.length) L.push('• Проблемные источники: ' + s.degraded_sources.map(x => x.ref + ' (' + x.status + ')').join(', '));
  L.push('• Мониторинг: отслеживается ' + s.monitoring_status.tracked + ', активно ' + s.monitoring_status.active + ', проблемных ' + s.monitoring_status.degraded);
  if (s.high_priority_recommendations.length) L.push('• Приоритетные рекомендации: ' + s.high_priority_recommendations.map(r => r.recommendation).join('; '));
  L.push('• Вызовы за неделю: внешних ' + s.call_summary.external_calls + ', LLM ' + s.call_summary.llm_primary_calls + ' (стоимость LLM: ' + s.call_summary.llm_cost_status + ')');
  if (s.report_links.length) L.push('• Отчёты: ' + s.report_links.map(r => r.report_id).join(', '));
  if (d.empty) L.push('За эту неделю значимых изменений не зафиксировано.');
  return L.join('\n');
}

module.exports = { isoWeek, inWeek, digestId, idempotencyKey, diffReports, buildWeeklyDigest, dedupeDigest, scheduleDecision, renderDigestText };
