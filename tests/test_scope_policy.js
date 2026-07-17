'use strict';
// EXPLICIT-SOURCE-SCOPE-001 — an INFERRED filter must never exclude a source the user named outright.
//
// Live regression (WF10 exec 922, req_1784253162): the user asked «обнови данные и сделай отчёт по
// autolombardn1.ru». Collection worked — the page was re-scraped and classified entity_type=competitor with a
// matching run family. The aggregator then dropped it because the SITE reported region "Россия" while the PLAN
// had defaulted to "Москва/МО". rows_after_isolation=0, empty bundle, and the user was told there were no facts
// about the very site they named.
//
// Fourth instance of one defect class (ISO-ARID-001 / ISO-RUNID-001 / data_mode / region): a filter silently
// subtracting rows the user explicitly asked for. Offline, $0.
const A = require('./_assert.js');
const S = require('../n8n/lib/scope_policy.js');
const RP = require('../n8n/lib/request_planner.js');
const H = require('./wf_harness.js');
const fs = require('fs'); const path = require('path');

const MSK = 'Москва/МО';
const explicitSite = { urls: ['https://autolombardn1.ru'], explicit_sources: true, region: MSK, intent: 'competitor_market_scan' };

A.section('§2 acceptance 1-4 — an explicitly named source is never filtered out by an inferred region');
{
  // 1. explicit website + inferred regional default survives
  const s1 = S.resolveScope(explicitSite);
  A.eq('scope_mode', s1.scope_mode, S.SCOPE_MODES.EXPLICIT_SOURCE);
  A.eq('region is NOT an admission filter', s1.apply_region_filter, false);
  A.eq('=> region_filter is the ANY sentinel', s1.region_filter, S.SCOPE_ANY);
  A.eq('the requested region is still remembered as context', s1.requested_region, MSK);

  // 2. explicit website whose row has NO region survives
  A.eq('empty row region is admitted', S.scRegionAdmits('', s1.region_filter), true);
  // 3. THE live case: row says "Россия", request said "Москва/МО"
  A.eq('THE REGRESSION: row region "Россия" survives a Москва/МО request', S.scRegionAdmits('Россия', s1.region_filter), true);
  A.eq('...and any other broad region too', S.scRegionAdmits('РФ', s1.region_filter), true);

  // 4. two explicitly named comparison sources in different regions BOTH survive
  const s4 = S.resolveScope({ urls: ['https://a.ru', 'https://b.ru'], explicit_sources: true, region: MSK });
  A.eq('two named sources => comparison', s4.scope_mode, S.SCOPE_MODES.COMPARISON);
  A.eq('comparison does not region-filter', s4.apply_region_filter, false);
  A.eq('source A (Москва) survives', S.scRegionAdmits('Москва', s4.region_filter), true);
  A.eq('source B (Санкт-Петербург) survives', S.scRegionAdmits('Санкт-Петербург', s4.region_filter), true);

  // explicit telegram / vk behave identically — the rule is about being NAMED, not about the platform
  A.eq('explicit telegram channel', S.resolveScope({ telegram_channels: ['chan'], explicit_sources: true, region: MSK }).scope_mode, S.SCOPE_MODES.EXPLICIT_SOURCE);
  A.eq('explicit vk community', S.resolveScope({ vk_communities: ['club1'], explicit_sources: true, region: MSK }).scope_mode, S.SCOPE_MODES.EXPLICIT_SOURCE);
  A.eq('mixed platforms => comparison', S.resolveScope({ urls: ['https://a.ru'], telegram_channels: ['c'], explicit_sources: true }).scope_mode, S.SCOPE_MODES.COMPARISON);
}

A.section('§2 acceptance 5-6 — discovery STILL filters by region (there it is a real constraint)');
{
  const d = S.resolveScope({ intent: 'competitor_discovery', discovery: true, region: MSK });
  A.eq('discovery scope', d.scope_mode, S.SCOPE_MODES.DISCOVERY);
  A.eq('discovery DOES region-filter', d.apply_region_filter, true);
  A.eq('=> passes the real requested region', d.region_filter, MSK);
  // 5. a candidate outside the requested region is still filtered
  A.eq('candidate in Владивосток is filtered out of a Москва discovery', S.scRegionAdmits('Владивосток', d.region_filter), false);
  A.eq('candidate in Россия is filtered (too broad for a regional discovery)', S.scRegionAdmits('Россия', d.region_filter), false);
  A.eq('candidate in Москва is admitted', S.scRegionAdmits('Москва', d.region_filter), true);
  A.eq('candidate in Москва/МО is admitted', S.scRegionAdmits('Москва/МО', d.region_filter), true);
  // 6. a missing region in discovery: documented policy = admit (absent is not a mismatch; the recurring class)
  A.eq('missing region in discovery is ADMITTED (absent != mismatch, documented policy)', S.scRegionAdmits('', d.region_filter), true);
  // a broad niche scan with no named source is discovery-shaped
  const n = S.resolveScope({ sources: ['website'], region: MSK, intent: 'competitor_market_scan' });
  A.eq('niche scan with no named source => region applies', n.apply_region_filter, true);
  A.eq('=> real region', n.region_filter, MSK);
}

A.section('monitoring — a tracked source never vanishes from its own run');
{
  const m = S.resolveScope({ urls: ['https://a.ru'] }, { monitoring: true });
  A.eq('monitoring scope', m.scope_mode, S.SCOPE_MODES.MONITORING);
  A.eq('monitoring does not region-filter', m.apply_region_filter, false);
  A.eq('a tracked source in any region survives its own monitoring run', S.scRegionAdmits('Россия', m.region_filter), true);
}

A.section('the region is reported as a LIMITATION, never silently dropped');
{
  const sc = S.resolveScope(explicitSite);
  const note = S.scScopeNoteRu(sc, 'Россия');
  A.ok('an honest note is produced when the source region is broader', /Регион источника/.test(note), note);
  A.ok('it says the source was analysed in full', /проанализирован целиком/.test(note));
  A.ok('it names both regions', note.indexOf('Россия') >= 0 && note.indexOf(MSK) >= 0);
  A.ok('it leaks no internal enum', !/explicit_source|region_filter|ANY/.test(note), note);
  A.eq('no note when the regions agree', S.scScopeNoteRu(sc, 'Москва'), '');
  A.eq('no note when there is no source region', S.scScopeNoteRu(sc, ''), '');
  A.eq('no note for discovery (region really did filter)', S.scScopeNoteRu(S.resolveScope({ intent: 'discovery', discovery: true, region: MSK }), 'Россия'), '');
}

A.section('§2 acceptance 7-8 — explicit scope does NOT bypass isolation, quality or budget');
{
  // scope_policy decides ONE thing (may an inferred filter exclude?) and nothing else.
  const api = Object.keys(S);
  ['owner', 'quality', 'budget', 'cost', 'evidence', 'access'].forEach(k =>
    A.ok('scope_policy exposes no ' + k + ' control', !api.some(x => x.toLowerCase().indexOf(k) >= 0)));
  A.eq('ANY only ever relaxes the REGION comparison', S.scRegionAdmits('anything', 'ANY'), true);
  // and it never affects the run-family isolation, which is a separate predicate in WF10
  const wf10 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '10_competitor_audience_intelligence_aggregator.json'), 'utf8'));
  const code = wf10.nodes.find(n => n.name === 'Aggregate Market Intelligence').parameters.jsCode;
  A.ok('WF10 still isolates by run family regardless of scope', /runFamilyMatch/.test(code));
  A.ok('WF10 still enforces the source_health gate regardless of scope', /enforce_source_health/.test(code));
  A.ok("the ANY sentinel relaxes ONLY the inferred filters", /low\(rf\)!=='any'/.test(code), 'region');
  A.ok('...platform too', /low\(pf\)!=='any'/.test(code));
  A.ok('...and service_type', /low\(stf\)!=='any'/.test(code));
}

A.section('WF10 — the real node admits the exact live row that was dropped');
{
  const wf = H.loadWorkflow('10_competitor_audience_intelligence_aggregator.json');
  // The EXACT row shape from live exec 922.
  const row = {
    created_at: new Date().toISOString(), source_type: 'scraped_web', platform: 'website',
    source_url: 'https://autolombardn1.ru', entity_type: 'competitor', company_name: 'Автоломбард №1',
    service_type: 'pts_loan', region: 'Россия', offer_text: 'Займ под ПТС от 3%', competitor_strength: 8,
    quality_score: 8, run_id: 'req_X::website::a1', source_run_id: '', data_mode: '',
    route: 'monitor_queue', processing_status: 'parsed_success'
  };
  function iso(regionFilter) {
    const r = H.makeRun();
    const cfg = H.runCodeNode(r, wf, 'Set Aggregator Config', [{ json: {
      agent_request_id_filter: 'req_X', source_run_id_filter: 'req_X::website::a1',
      data_mode_filter: 'live', region_filter: regionFilter } }])[0].json;
    H.inject(r, 'Read monitor_queue', [row]);
    ['Read content_queue', 'Read review_queue', 'Read source_health', 'Read raw_market_records'].forEach(n => H.inject(r, n, [{}]));
    const o = H.runCodeNode(r, wf, 'Aggregate Market Intelligence', [{ json: cfg }])[0].json;
    return (o.stats || {}).rows_after_isolation;
  }
  A.eq('BEFORE: the inferred region drops the explicitly-named source', iso(MSK), 0);
  A.eq('AFTER: the ANY sentinel keeps it', iso(S.SCOPE_ANY), 1);
  A.eq('a discovery run still filters it', iso('Владивосток'), 0);
}

A.section('the plan carries the scope decision through persistence (planner parity with the policy)');
{
  const cfg = { source_allowlist: ['website'], default_region: MSK, default_niche: 'pts_loan', max_items_per_source: 10, max_external_calls: 5 };
  const p1 = RP.deterministicPlan('обнови данные и сделай отчёт по autolombardn1.ru', cfg);
  A.eq('an explicit-source request plans as explicit_source', p1.scope_mode, 'explicit_source');
  A.eq('planner agrees with the canonical policy', p1.scope_mode, S.resolveScope(p1).scope_mode);
  const row = RP.buildPlanRow(p1, { plan_id: 'p1', plan_hash: 'h', plan_version: 1 }, { owner_user_id: 'o1', chat_id: 'c1' });
  A.eq('the row persists scope_mode (it must survive approval)', row.scope_mode, 'explicit_source');
  A.eq('the stored row resolves to the same scope', S.resolveScope(Object.assign({}, p1, { scope_mode: row.scope_mode })).scope_mode, 'explicit_source');

  const p2 = RP.deterministicPlan('найди конкурентов в Москве', cfg);
  A.ok('a discovery-shaped request is not explicit_source', p2.scope_mode !== 'explicit_source', p2.scope_mode);
  A.eq('...and its region still filters', S.resolveScope(p2).apply_region_filter, true);
}

A.section('WF20 — region_filter comes from the ONE policy, not an ad-hoc ternary');
{
  const wf20 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '20_agent_orchestrator.json'), 'utf8'));
  const set = wf20.nodes.find(n => n.name === 'Resolve Collection Set').parameters.jsCode;
  A.ok('Resolve Collection Set uses the canonical policy', set.indexOf('resolveScope(plan') >= 0);
  A.ok('...and exposes the decision', set.indexOf('scope_mode:__scope.scope_mode') >= 0 && set.indexOf('region_filter:__scope.region_filter') >= 0);
  const call = wf20.nodes.find(n => n.name === 'Run WF10 Aggregator');
  const rf = call.parameters.workflowInputs.value.region_filter;
  A.ok('WF20 passes region_filter to WF10', !!rf);
  A.ok('...from Resolve Collection Set (single source of truth)', /Resolve Collection Set/.test(rf), rf);
  A.ok('...NOT from an inline explicit_sources ternary', !/explicit_sources/.test(rf), rf);
}

A.report('scope-policy');
