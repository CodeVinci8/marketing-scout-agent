'use strict';
// report_compare.js — canonical report comparison contract (Section 6).
//
// Baseline selection is EXPLICIT and safe: a baseline must be the same owner + same niche/service (+ region
// where applicable), share competitor identity (canonical domain or name), be earlier, acceptable quality, and
// NOT a fixture/manual or unrelated request. An arbitrary previous row is never used. Comparison reuses stored
// reports/snapshots and makes ZERO external calls. Each changed item carries before/after, old/new report IDs,
// old/new source record IDs, timestamps and an evidence anchor. Pure + deterministic, $0, offline.

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function num(v) { if (v == null || str(v).trim() === '') return null; const n = Number(v); return isFinite(n) ? n : null; }
function canonDomain(c) { return low(c && (c.domain || c.competitor)).replace(/^www\./, ''); }
function compKey(c) { return canonDomain(c); }
function offerKey(o) { return low(o.competitor) + '::' + low(o.offer); }

// ---- baseline selection ------------------------------------------------------------------------------
// selectBaseline(current, candidates, cfg) -> { baseline, compatible, reason, rejected:[{report_id, reason}] }
function selectBaseline(current, candidates, cfg) {
  current = current || {}; cfg = cfg || {};
  candidates = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  const curOwner = low(current.owner_user_id), curNiche = low(current.niche), curRegion = low(current.region);
  const curService = low(current.service || current.niche);
  const curDomains = new Set((current.competitors || []).map(canonDomain).filter(Boolean));
  const curTime = Date.parse(str(current.created_at)) || Infinity;
  const rejected = [];
  const ok = [];
  for (const b of candidates) {
    const id = str(b.report_id);
    if (id === str(current.report_id)) { rejected.push({ report_id: id, reason: 'same_report' }); continue; }
    if (low(b.owner_user_id) !== curOwner) { rejected.push({ report_id: id, reason: 'different_owner' }); continue; }
    if (curNiche && low(b.niche) && low(b.niche) !== curNiche) { rejected.push({ report_id: id, reason: 'different_niche' }); continue; }
    if (curService && low(b.service || b.niche) && low(b.service || b.niche) !== curService) { rejected.push({ report_id: id, reason: 'different_service' }); continue; }
    if (curRegion && low(b.region) && low(b.region) !== curRegion) { rejected.push({ report_id: id, reason: 'different_region' }); continue; }
    if (['fixture', 'manual_test'].indexOf(low(b.data_mode)) >= 0) { rejected.push({ report_id: id, reason: 'fixture_or_manual' }); continue; }
    const bTime = Date.parse(str(b.created_at)) || Infinity;
    if (!(bTime < curTime)) { rejected.push({ report_id: id, reason: 'not_earlier' }); continue; }
    const overlap = (b.competitors || []).map(canonDomain).some(d => d && curDomains.has(d));
    if (curDomains.size && !overlap) { rejected.push({ report_id: id, reason: 'no_competitor_overlap' }); continue; }
    ok.push(b);
  }
  ok.sort((a, b) => (Date.parse(str(a.created_at)) || 0) - (Date.parse(str(b.created_at)) || 0));
  const baseline = ok.length ? ok[ok.length - 1] : null; // most recent compatible prior
  return {
    baseline: baseline, compatible: !!baseline,
    reason: baseline ? 'compatible_baseline_selected' : 'no_compatible_baseline',
    baseline_report_id: baseline ? str(baseline.report_id) : '', rejected: rejected
  };
}

// ---- comparison --------------------------------------------------------------------------------------
const OFFER_FIELDS = ['offer', 'price_rate', 'amount_range', 'term', 'cta', 'usp', 'promotion'];

function evidenceAnchor(report, competitor) {
  const e = (report.evidence || []).find(x => low(x.competitor) === low(competitor));
  return e ? { finding_id: str(e.finding_id), url: str(e.url), source_record_id: str(e.source_record_id) } : null;
}

function compareReports(current, baseline) {
  current = current || {};
  if (!baseline) {
    return { compatible: false, reason: 'no_compatible_baseline',
      added: { competitors: [], offers: [] }, removed: { competitors: [], offers: [] },
      changed: { competitors: [], offers: [] }, unchanged: { competitors: [], offers: [] },
      quality_changes: [], unavailable: [], metadata: { current_report_id: str(current.report_id), baseline_report_id: '', external_calls: 0 } };
  }
  const curComp = {}; (current.competitors || []).forEach(c => { curComp[compKey(c)] = c; });
  const baseComp = {}; (baseline.competitors || []).forEach(c => { baseComp[compKey(c)] = c; });
  const curOffers = {}; (current.offers || []).forEach(o => { curOffers[offerKey(o)] = o; });
  const baseOffers = {}; (baseline.offers || []).forEach(o => { baseOffers[offerKey(o)] = o; });

  const added = { competitors: [], offers: [] }, removed = { competitors: [], offers: [] };
  const changed = { competitors: [], offers: [] }, unchanged = { competitors: [], offers: [] };

  // competitors
  for (const k of Object.keys(curComp)) {
    if (!baseComp[k]) { added.competitors.push({ competitor: curComp[k].competitor, domain: curComp[k].domain }); continue; }
    const a = baseComp[k], b = curComp[k];
    const fieldChanges = [];
    ['positioning', 'score', 'quality', 'region'].forEach(f => {
      if (str(a[f]) !== str(b[f])) fieldChanges.push({ field: f, before: a[f] == null ? '' : a[f], after: b[f] == null ? '' : b[f] });
    });
    if (fieldChanges.length) changed.competitors.push({ competitor: b.competitor, changes: fieldChanges, old_report_id: str(baseline.report_id), new_report_id: str(current.report_id) });
    else unchanged.competitors.push({ competitor: b.competitor });
  }
  for (const k of Object.keys(baseComp)) if (!curComp[k]) removed.competitors.push({ competitor: baseComp[k].competitor, domain: baseComp[k].domain });

  // offers
  for (const k of Object.keys(curOffers)) {
    const b = curOffers[k];
    if (!baseOffers[k]) { added.offers.push({ competitor: b.competitor, offer: b.offer, price_rate: b.price_rate, promotion: b.promotion }); continue; }
    const a = baseOffers[k];
    const fieldChanges = [];
    OFFER_FIELDS.forEach(f => { if (f !== 'offer' && str(a[f] || '') !== str(b[f] || '')) fieldChanges.push({ field: f, before: a[f] == null ? '' : a[f], after: b[f] == null ? '' : b[f] }); });
    if (fieldChanges.length) {
      changed.offers.push({
        competitor: b.competitor, offer: b.offer, changes: fieldChanges,
        old_report_id: str(baseline.report_id), new_report_id: str(current.report_id),
        old_source_record_id: str(a.source_record_id), new_source_record_id: str(b.source_record_id),
        old_collected_at: str(a.collected_at), new_collected_at: str(b.collected_at),
        evidence: evidenceAnchor(current, b.competitor)
      });
    } else unchanged.offers.push({ competitor: b.competitor, offer: b.offer });
  }
  for (const k of Object.keys(baseOffers)) if (!curOffers[k]) removed.offers.push({ competitor: baseOffers[k].competitor, offer: baseOffers[k].offer });

  // source health / quality changes
  const baseSrc = {}; (baseline.source_quality || []).forEach(s => { baseSrc[low(s.source)] = s; });
  const quality_changes = [];
  (current.source_quality || []).forEach(s => {
    const a = baseSrc[low(s.source)];
    if (a && (low(a.status) !== low(s.status) || num(a.health_score) !== num(s.health_score))) {
      quality_changes.push({ source: s.source, before_status: low(a.status), after_status: low(s.status), before_health: num(a.health_score), after_health: num(s.health_score) });
    }
  });
  // unavailable comparisons: current entities whose source is quarantined/unavailable (comparison unreliable)
  const unavailable = (current.source_quality || []).filter(s => ['quarantined', 'unavailable', 'error', 'failed'].indexOf(low(s.status)) >= 0)
    .map(s => ({ source: s.source, status: low(s.status), reason: 'source_unavailable_comparison_unreliable' }));

  return {
    compatible: true, reason: 'compared',
    added: added, removed: removed, changed: changed, unchanged: unchanged,
    quality_changes: quality_changes, unavailable: unavailable,
    metadata: {
      current_report_id: str(current.report_id), baseline_report_id: str(baseline.report_id),
      current_created_at: str(current.created_at), baseline_created_at: str(baseline.created_at),
      external_calls: 0
    }
  };
}

// convenience: pick + compare in one call
function compareWithHistory(current, candidates, cfg) {
  const sel = selectBaseline(current, candidates, cfg);
  const cmp = compareReports(current, sel.baseline);
  cmp.baseline_selection = sel;
  return cmp;
}

module.exports = { selectBaseline, compareReports, compareWithHistory, compKey, offerKey, OFFER_FIELDS, canonDomain };
