'use strict';
// scope_policy.js — EXPLICIT-SOURCE-SCOPE-001. ONE decision for "may an INFERRED filter exclude this row?"
//
// The bug this exists to kill (live: WF10 exec 922, request req_1784253162). The user asked for
// «обнови данные и сделай отчёт по autolombardn1.ru» — an EXPLICIT source. Collection worked: the page was
// re-scraped, classified entity_type=competitor, and persisted with a matching run family. Then the report
// aggregator dropped it, because the SITE reported region "Россия" while the PLAN had defaulted to "Москва/МО".
// rows_after_isolation=0, empty bundle, no analysis, and the user was told there were no facts about the very
// site they named.
//
// The principle: when the user names a source outright, THE NAMED SOURCE IS THE SCOPE. An inferred default
// (region, niche, window) is a helpful guess for a broad search; it must never be an admission filter against an
// explicit instruction. Region stays useful CONTEXT for the analysis and a reportable limitation — it is simply
// not a gate. Discovery is the opposite case: there the region IS the user's real constraint, so it still filters.
//
// This is the fourth instance of one defect class (ISO-ARID-001 / ISO-RUNID-001 / data_mode / region): a filter
// silently subtracting rows the user explicitly asked for. Centralising the decision here means the planner, WF20,
// WF10 and the report metadata cannot drift apart on it.
//
// Embeddable: unique sc*-prefixed names, no cross-lib require.

function scStr(v) { return v == null ? '' : String(v); }
function scLow(v) { return scStr(v).trim().toLowerCase(); }
function scArr(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }

var SCOPE_MODES = {
  EXPLICIT_SOURCE: 'explicit_source',  // user named exactly one source
  COMPARISON: 'comparison',            // user named several sources
  DISCOVERY: 'discovery',              // user asked us to FIND sources — their region is a real constraint
  MONITORING: 'monitoring'             // a tracked source's own run — its identity is authoritative
};
// The sentinel a consumer passes when an inferred filter must NOT apply. It is an explicit value (not '') because
// WF10's config override ignores empty strings and would silently fall back to its 'Москва/МО' default.
var SCOPE_ANY = 'ANY';
function scIsAny(v) { return scLow(v) === 'any'; }

// How many sources did the user name outright?
function scExplicitCount(plan) {
  plan = plan || {};
  return scArr(plan.urls).length + scArr(plan.telegram_channels).length + scArr(plan.vk_communities).length;
}

// resolveScope(plan, opts) -> { scope_mode, apply_region_filter, requested_region, region_filter, reason }
function resolveScope(plan, opts) {
  plan = plan || {}; opts = opts || {};
  var requested = scStr(plan.region);
  var n = scExplicitCount(plan);
  var explicitFlag = plan.explicit_sources === true || scStr(plan.explicit_sources) === 'true';
  var isDiscovery = /discovery/.test(scLow(plan.intent)) || plan.discovery === true;
  var isMonitoring = opts.monitoring === true || /monitor/.test(scLow(plan.intent));

  var mode, apply, reason;
  if (isMonitoring) {
    mode = SCOPE_MODES.MONITORING; apply = false;
    reason = 'a tracked source must never vanish from its own monitoring run';
  } else if (isDiscovery) {
    // The ONLY mode where region is the user's real constraint: they asked us to find sources THERE.
    mode = SCOPE_MODES.DISCOVERY; apply = true;
    reason = 'discovery: the requested region is a genuine candidate filter';
  } else if (n >= 2 || (explicitFlag && n >= 2)) {
    mode = SCOPE_MODES.COMPARISON; apply = false;
    reason = 'every named comparison source stays in; a region difference is a reportable dimension, not a filter';
  } else if (explicitFlag || n === 1) {
    mode = SCOPE_MODES.EXPLICIT_SOURCE; apply = false;
    reason = 'the user named the source: the named source IS the scope';
  } else {
    // A broad niche scan with no named source — the inferred region is the only scope there is.
    mode = SCOPE_MODES.DISCOVERY; apply = true;
    reason = 'niche scan: the inferred region is the only scope available';
  }
  return {
    scope_mode: mode,
    apply_region_filter: apply,
    requested_region: requested,
    // What a consumer passes downstream as region_filter.
    region_filter: apply ? (requested || SCOPE_ANY) : SCOPE_ANY,
    reason: reason
  };
}

// Should THIS row be admitted, given the scope? Region is compared loosely (Москва matches Москва/МО) and an
// ABSENT region is never a mismatch — the recurring defect class.
function scRegionAdmits(rowRegion, filter) {
  if (!scStr(filter) || scIsAny(filter)) return true;
  var reg = scLow(rowRegion);
  if (!reg) return true;                       // absent is not a mismatch
  var f = scLow(filter);
  return reg.indexOf(f) >= 0 || f.indexOf(reg) >= 0;
}

// Report metadata: what the user should be told about how region was treated.
function scScopeNoteRu(scope, sourceReportedRegion) {
  scope = scope || {};
  if (scope.apply_region_filter) return '';
  var src = scStr(sourceReportedRegion);
  if (scope.scope_mode === SCOPE_MODES.EXPLICIT_SOURCE && src && scope.requested_region &&
    !scRegionAdmits(src, scope.requested_region)) {
    // Honest: we did NOT silently drop it, and we do not pretend the region matched.
    return 'Источник указан вами напрямую, поэтому он проанализирован целиком. Регион источника (' + src +
      ') шире запрошенного (' + scope.requested_region + ') — учитывайте это при сравнении.';
  }
  return '';
}

module.exports = { SCOPE_MODES, SCOPE_ANY, resolveScope, scRegionAdmits, scScopeNoteRu, scExplicitCount, scIsAny };
