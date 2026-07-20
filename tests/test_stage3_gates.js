// test_stage3_gates.js — Stage 3 closure: production analysis/aggregation/reporting gates on the REAL nodes.
// Covers WF08 guarded LLM, WF05 approval/budget, WF06 root detection, WF09 search-card semantics, WF10
// windowing/isolation/source_mix, WF12 summary guard + deterministic fallback. $0, no network, no Claude/Apify.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const WF05 = H.loadWorkflow('05_apify_search_candidate_discovery.json');
const WF06 = H.loadWorkflow('06_approved_candidates_runner.json');
const WF08 = H.loadWorkflow('08_touchpoint_analyzer.json');
const WF09 = H.loadWorkflow('09_avito_classifieds_listing_connector.json');
const WF10 = H.loadWorkflow('10_competitor_audience_intelligence_aggregator.json');
const WF12 = H.loadWorkflow('12_market_intelligence_report_builder.json');

// ---------------------------------------------------------------------------------------------------------
A.section('WF08 — production Claude node is ENABLED in JSON, gated by a runtime guard');
A.ok('Claude Primary API Request is NOT physically disabled', WF08.nodes.find(n => n.name === 'Claude Primary API Request').disabled !== true);
function prep(recOverride, cfgOverride) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, WF08, 'Set Analyzer Config', [])[0].json;
  H.inject(run, 'Set Analyzer Config', [Object.assign({}, cfg, cfgOverride || {})]);
  const rec = Object.assign({
    record_id: 'r1', source_run_id: 'firecrawl_X', quality_status: 'healthy', review_status: 'confirmed', analysis_status: 'pending',
    record_type_hint: 'competitor_activity', platform: 'website', source_type: 'scraped_web',
    text_context: 'CASHMOTOR — деньги под ПТС автомобиля, займ под залог ПТС по договору, без снятия с учёта.',
    interest_topic: 'займ под ПТС', service_hint: 'pts_loan', source_url: 'https://cashmotor.ru/', batch_index: 1
  }, recOverride || {});
  return H.runCodeNode(run, WF08, 'Prepare Record', [{ json: rec }])[0].json;
}
A.eq('llm_enabled=false => call_claude false (zero Claude calls)', prep({}, { llm_enabled: false }).call_claude, false);
A.eq('llm OFF guard reason', prep({}, { llm_enabled: false }).llm_guard_reason, 'llm_disabled');
A.eq('llm_enabled=true but NO approval token => no call', prep({}, { llm_enabled: true, llm_enrichment: true }).call_claude, false);
A.eq('reason approval_token_invalid', prep({}, { llm_enabled: true, llm_enrichment: true }).llm_guard_reason, 'approval_token_invalid');
const approved = { llm_enabled: true, llm_enrichment: true, llm_approval_token: 'WF08_LLM_APPROVED' };
A.eq('fully approved + quality-eligible => call_claude true', prep({}, approved).call_claude, true);
A.eq('degraded record blocked from Claude', prep({ quality_status: 'degraded' }, approved).call_claude, false);
A.eq('reason record_not_quality_eligible', prep({ quality_status: 'degraded' }, approved).llm_guard_reason, 'record_not_quality_eligible');
A.eq('already-analyzed record blocked', prep({ analysis_status: 'analyzed' }, approved).call_claude, false);
A.eq('cancelled request blocked', prep({}, Object.assign({ request_cancelled: true }, approved)).call_claude, false);
A.eq('over-budget per-call blocked', prep({}, Object.assign({ llm_budget_usd: 0.001 }, approved)).call_claude, false);
A.eq('reason over_llm_budget', prep({}, Object.assign({ llm_budget_usd: 0.001 }, approved)).llm_guard_reason, 'over_llm_budget');

// ---------------------------------------------------------------------------------------------------------
A.section('WF05 — executable approval/budget gate before Apify (unapproved => zero external calls)');
const disc0 = H.runCodeNode(H.makeRun(), WF05, 'Set Discovery Request', [])[0].json;
let blocked = false;
try { H.runCodeNode(H.makeRun(), WF05, 'Build Apify Search Request', [{ json: disc0 }]); } catch (e) { blocked = /approval token|BLOCKED/.test(e.message); }
A.ok('unapproved WF05 run THROWS before the Apify request (zero calls)', blocked);
A.ok('the gate never logs the token value', (function () { try { H.runCodeNode(H.makeRun(), WF05, 'Build Apify Search Request', [{ json: disc0 }]); } catch (e) { return e.message.indexOf('WF05_LIVE_APPROVED') < 0; } return false; })());
let approvedOk = true;
try { H.runCodeNode(H.makeRun(), WF05, 'Build Apify Search Request', [{ json: Object.assign({}, disc0, { approval_token: 'WF05_LIVE_APPROVED' }) }]); } catch (e) { approvedOk = false; }
A.ok('approved run builds the request (no throw)', approvedOk);
// ledger: items_relevant = direct competitors only; approval_token_used truthful.
function wf05ledger(cfgOverride) {
  const run = H.makeRun();
  H.inject(run, 'Set Discovery Request', [Object.assign({}, disc0, cfgOverride || {})]);
  H.inject(run, 'Build Discovery Request Summary', [{ discovery_request_id: 'disc_T', status: 'needs_review', candidate_count: 8, direct_competitor_count: 4, unique_candidate_count: 8, duplicate_count: 0 }]);
  return H.runCodeNode(run, WF05, 'Build live_source_runs Row', [])[0].json;
}
A.eq('items_relevant counts direct competitors (4), not all 8 candidates', wf05ledger({ approval_token: 'WF05_LIVE_APPROVED' }).items_relevant, 4);
A.eq('approval_token_used=yes when token validated', wf05ledger({ approval_token: 'WF05_LIVE_APPROVED' }).approval_token_used, 'yes');
A.eq('approval_token_used=not_required when approval not required', wf05ledger({ require_approval_token: false }).approval_token_used, 'not_required');

// ---------------------------------------------------------------------------------------------------------
A.section('WF06 — root homepage detection is sandbox-safe (true for the live root URLs)');
const spaCode = WF06.nodes.find(n => n.name === 'Select, Prioritize & Annotate').parameters.jsCode;
const fnMatch = spaCode.match(/function isRootUrl\(u\)\{[\s\S]*?\n\}/);
A.ok('isRootUrl function present in the shipped node', !!fnMatch);
const isRootUrl = new Function(fnMatch[0] + '\nreturn isRootUrl;')();
A.eq('https://cashmotor.ru/ is root', isRootUrl('https://cashmotor.ru/'), true);
A.eq('https://carcapital.ru/ is root', isRootUrl('https://carcapital.ru/'), true);
A.eq('no-trailing-slash root is root', isRootUrl('https://cashmotor.ru'), true);
A.eq('a deep service page is NOT root', isRootUrl('https://cashmotor.ru/uslugi/pts'), false);
A.ok('isRootUrl does not CALL the URL global (sandbox-safe)', fnMatch[0].indexOf('new URL(') < 0);

// ---------------------------------------------------------------------------------------------------------
A.section('WF09 — search cards are not confirmed offers and never recommend WF08');
function wf09searchcardrun() {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, WF09, 'Set Avito Connector Config', [])[0].json;
  cfg.fixture_mode = false; cfg.data_mode = 'live';
  H.inject(run, 'Set Avito Connector Config', [cfg]);
  H.inject(run, 'LIVE Apify Safety Gate', [{ approval_token_used: 'yes' }]);
  const cards = [1, 2, 3].map(i => ({ record_type_hint: 'source_candidate', touchpoint_type: 'search_card', is_detail: false, detail_fetch_required: true, dedup_status: 'unique', predicted_route: 'review_queue', quality_status: 'degraded', report_eligible: false, source_url: 'https://www.avito.ru/moskva/predlozheniya_uslug?q=x' + i }));
  H.inject(run, 'Deduplicate Listings', cards);
  const lsr = H.runCodeNode(run, WF09, 'Build live_source_runs Row', [])[0].json;
  const fs = H.runCodeNode(run, WF09, 'Final Summary Output', [])[0].json;
  return { lsr, fs };
}
const sc = wf09searchcardrun();
A.eq('items_relevant = 0 (search cards are not confirmed offers)', sc.lsr.items_relevant, 0);
A.eq('Final Summary confirmed_detail_offer_items = 0', sc.fs.confirmed_detail_offer_items, 0);
A.ok('search-card-only run says: Detail enrichment required; do not run WF08', /Detail enrichment required; do not run WF08/.test(sc.fs.next_action));

// ---------------------------------------------------------------------------------------------------------
A.section('WF10 — configured time window (1d vs 30d), agent_request_id isolation, derived source_mix');
const NOW = Date.now();
function isoAgo(days) { return new Date(NOW - days * 86400000 + 10800000).toISOString().replace('Z', '+03:00'); }
function monRow(sid, ageDays, req) {
  return { entity_type: 'competitor', company_name: 'Брокер ' + sid, platform: 'website', service_type: 'pts_loan', region: 'Москва', source_url: 'https://x' + sid + '.ru/', offer_text: 'займ под ПТС', terms: 'от 30 000 ₽', competitor_strength: 70, quality_score: 70, created_at: isoAgo(ageDays), source_run_id: sid, agent_request_id: req, data_mode: 'live', _tab: 'monitor_queue' };
}
const health = [{ source_run_id: 'run_A', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' }, { source_run_id: 'run_B', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' }];
function aggregate(cfgOverride, monitor) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, WF10, 'Set Aggregator Config', [])[0].json;
  H.inject(run, 'Set Aggregator Config', [Object.assign({}, cfg, cfgOverride || {})]);
  H.inject(run, 'Read monitor_queue', monitor);
  H.inject(run, 'Read content_queue', []); H.inject(run, 'Read review_queue', []);
  H.inject(run, 'Read source_confidence_rules', []); H.inject(run, 'Read source_health', health);
  return H.runCodeNode(run, WF10, 'Aggregate Market Intelligence', [])[0].json.stats;
}
const mixWindow = [monRow('run_A', 0, 'req_1'), monRow('run_B', 10, 'req_2')];
A.eq('30-day window includes both rows', aggregate({ time_window_days: 30 }, mixWindow).rows_in_window, 2);
A.eq('1-day window includes only the fresh row (no hardcoded 30)', aggregate({ time_window_days: 1 }, mixWindow).rows_in_window, 1);
const iso = aggregate({ time_window_days: 30, agent_request_id_filter: 'req_1' }, mixWindow);
A.eq('agent_request_id isolation keeps only the matching run', iso.rows_after_filters, 1);
A.ok('source_mix is DERIVED from included rows (not the hardcoded label)', /live:/.test(iso.source_mix) && iso.source_mix.indexOf('historical/manual + web pipeline') < 0);
A.ok('WF10 config exposes explicit historical-comparison opt-in', H.runCodeNode(H.makeRun(), WF10, 'Set Aggregator Config', [])[0].json.enable_historical_comparison === false);
// quarantined/unverified still blocked (fail-closed)
const blockedHealth = aggregate({ time_window_days: 30 }, [monRow('run_Q', 0, 'req_1')]);
A.eq('a run with NO source_health row is blocked (fail-closed)', blockedHealth.rows_after_filters, 0);

// ---------------------------------------------------------------------------------------------------------
A.section('WF12 — Claude summary node enabled + guarded; OFF=0 calls; invalid summary falls back');
A.eq('Claude summary HTTP node is enabled in JSON (no disabled production branch)', WF12.nodes.find(n => /Claude Summary API Request/.test(n.name)).disabled, false);
const rcfg = H.runCodeNode(H.makeRun(), WF12, 'Set Report Config', [])[0].json;
A.eq('default enable_llm_summary=false => summary branch off (zero LLM calls)', rcfg.enable_llm_summary, false);
function gate(cfgOver, rep) {
  const run = H.makeRun();
  H.inject(run, 'Set Report Config', [Object.assign({}, rcfg, cfgOver || {})]);
  return H.runCodeNode(run, WF12, 'Claude Summary Approval Gate', [{ json: rep || {} }]);
}
const eligibleRep = { rows_after_filters: 2, report_eligible: true };
// WF12-LLMGATE-001: the gate is a DECISION (llm_gate_allowed), never a chain-killing throw.
function gdec(cfgOver, rep) { return gate(cfgOver, rep)[0].json; }
A.eq('gate declines when enable_llm_summary!=true (no throw)', gdec({ enable_llm_summary: false }, eligibleRep).llm_gate_allowed, false);
A.eq('declined flag reason: llm_summary_disabled', gdec({ enable_llm_summary: false }, eligibleRep).llm_gate_reason, 'llm_summary_disabled');
A.eq("string 'true' from executeWorkflow arms the gate", gdec({ enable_llm_summary: 'true', llm_approval_token: 'I_APPROVE_CLAUDE_REPORT_SUMMARY' }, eligibleRep).llm_gate_allowed, true);
A.eq('summary ON still requires the approval token', gdec({ enable_llm_summary: true, llm_approval_token: '' }, eligibleRep).llm_gate_reason, 'approval_token_missing');
A.eq('no eligible facts => declined', gdec({ enable_llm_summary: true, llm_approval_token: 'I_APPROVE_CLAUDE_REPORT_SUMMARY' }, { rows_after_filters: 0 }).llm_gate_reason, 'no_eligible_facts');
A.eq('already summarized => declined (idempotency)', gdec({ enable_llm_summary: true, llm_approval_token: 'I_APPROVE_CLAUDE_REPORT_SUMMARY' }, Object.assign({ llm_summary_status: 'summarized' }, eligibleRep)).llm_gate_reason, 'already_summarized_idempotency');
A.eq('fully approved + eligible => allowed', gdec({ enable_llm_summary: true, llm_approval_token: 'I_APPROVE_CLAUDE_REPORT_SUMMARY' }, eligibleRep).llm_gate_allowed, true);
// gate decline routes to the deterministic append (topology), and the API node degrades on HTTP error
const gconn = WF12.connections['Claude Summary Approval Gate'].main[0][0].node;
A.eq('gate output feeds the routing IF', gconn, 'Claude Gate Allowed?');
A.eq('declined gate routes to the deterministic report append', WF12.connections['Claude Gate Allowed?'].main[1][0].node, 'Append market_intelligence_reports');
A.eq('over-budget prompt routes to the deterministic report append', WF12.connections['LLM Budget OK?'].main[1][0].node, 'Append market_intelligence_reports');
const apiNode = WF12.nodes.find(n => n.name === 'Claude Summary API Request');
A.eq('Claude API node degrades on HTTP error (onError=continueRegularOutput)', apiNode.onError, 'continueRegularOutput');
A.eq('Claude API node binds the real httpHeaderAuth credential', apiNode.parameters.nodeCredentialType, 'httpHeaderAuth');
A.ok('no raw x-api-key placeholder header remains', JSON.stringify(apiNode.parameters.headerParameters).indexOf('x-api-key') < 0);
// budget guard SKIPS (llm_budget_blocked) before the HTTP node — deterministic report survives
const gbRun = H.makeRun();
H.inject(gbRun, 'Set Report Config', [Object.assign({}, rcfg, { llm_max_estimated_cost_usd: 0.0000001 })]);
H.inject(gbRun, 'Build Deterministic Report', [{ report_id: 'rep1', rows_after_filters: 2, report_eligible: true, top_competitors: 'a', top_angles: 'b' }]);
const gbOut = H.runCodeNode(gbRun, WF12, 'Build Claude Summary Prompt', [{ json: { report_id: 'rep1', rows_after_filters: 2 } }])[0].json;
A.eq('over-budget marks llm_budget_blocked (no throw, no HTTP body)', gbOut.llm_budget_blocked, true);
A.ok('over-budget item carries no llm_request_body', gbOut.llm_request_body === undefined);
// missing API response (HTTP error passthrough) => deterministic fallback, never a throw
const nores = (function () {
  const run = H.makeRun();
  H.inject(run, 'Set Report Config', [rcfg]);
  const rep = { report_id: 'rep1', rows_after_filters: 2, report_eligible: true, top_competitors: 'CASHMOTOR', notes: 'det' };
  H.inject(run, 'Build Deterministic Report', [rep]);
  H.inject(run, 'Build Claude Summary Prompt', [Object.assign({ llm_facts_string: '{}' }, rep)]);
  return H.runCodeNode(run, WF12, 'Merge Claude Summary Into Report', [{ json: { error: 'http 401' } }])[0].json;
})();
A.eq('no API response => deterministic fallback status', nores.llm_status, 'fallback_deterministic');
A.ok('no API response fallback flags it', /no_api_response/.test(nores.llm_quality_flags));
// invalid (non-JSON) Claude response => deterministic fallback (facts unchanged)
const merged = (function () {
  const run = H.makeRun();
  H.inject(run, 'Set Report Config', [rcfg]);
  const rep = { report_id: 'rep1', rows_after_filters: 2, report_eligible: true, top_competitors: 'CASHMOTOR; CarCapital', notes: 'det' };
  H.inject(run, 'Build Deterministic Report', [rep]);
  H.inject(run, 'Build Claude Summary Prompt', [Object.assign({ llm_facts_string: '{}' }, rep)]);
  return H.runCodeNode(run, WF12, 'Merge Claude Summary Into Report', [{ json: { content: [{ type: 'text', text: 'this is not json at all' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' } }])[0].json;
})();
A.eq('invalid summary => deterministic fallback status', merged.llm_status, 'fallback_deterministic');
A.eq('fallback keeps the deterministic facts (top_competitors unchanged)', merged.top_competitors, 'CASHMOTOR; CarCapital');
A.eq('fallback writes no narrative summary', merged.llm_summary_ru, '');

// ---------------------------------------------------------------------------------------------------------
A.section('WF12 — report data isolation: agent_request_id scope + report_data_mode=live fixture exclusion');
const RCUR = '20260620_120000';
const RLIN = { source_run_ids: 'run_live', data_mode: 'live', report_eligible: true };
function rprofile(name, arid) {
  return Object.assign({ competitor_id: 'c_' + name, competitor_name: name, platforms: 'website', offers: 'займ под ПТС', prices_terms: 'от 30 000 ₽', evidence_count: 3, source_confidence_score: 80, notes: 'wf10 v0.3; run wf10_' + RCUR + '; window 30d', agent_request_id: arid }, RLIN);
}
function buildRep(cfgOver, profiles, snaps) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, WF12, 'Set Report Config', [])[0].json;
  Object.assign(cfg, { niche_id: 'credit_brokerage', region: 'Москва/МО' }, cfgOver || {});
  run.outputs['Set Report Config'] = [{ json: cfg }];
  H.inject(run, 'Read competitor_profiles', profiles);
  H.inject(run, 'Read market_angles', [Object.assign({ angle_id: 'angle_speed_' + RCUR, angle_text: 'скорость', category: 'speed', frequency: 12, recommended_content_response: 'Пост' }, RLIN)]);
  H.inject(run, 'Read audience_activity_signals', []);
  H.inject(run, 'Read content_positioning_plan', [{ plan_id: 'plan_' + RCUR, niche: 'credit_brokerage', region: 'Москва/МО', top_angles: 'скорость (x12)', source_evidence: 'rows=2 (window 30d)' }]);
  H.inject(run, 'Read competitor_site_snapshots', snaps || []);
  H.inject(run, 'Read public_lead_signals', []);
  H.inject(run, 'Read source_health', [{ source_run_id: 'run_live', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' }]);
  return H.runCodeNode(run, WF12, 'Build Deterministic Report', [])[0].json;
}
// agent_request_id isolation: only the profile from the current request survives
const isoRep = buildRep({ agent_request_id: 'req_A' }, [rprofile('AlphaBroker', 'req_A'), rprofile('OtherReqBroker', 'req_B')]);
A.ok('WF12 keeps the current request profile (AlphaBroker present)', /AlphaBroker/.test(isoRep.top_competitors || ''));
A.ok('WF12 drops a profile from a different agent_request_id', !/OtherReqBroker/.test(isoRep.top_competitors || ''));
// report_data_mode=live excludes a fixture-mode snapshot (snapshot eligibility === profile eligibility)
const fixSnap = { domain: 'fixture-co.ru', company_name: 'FixtureCo', offer_summary: 'тест', prices_terms: 'от 1 ₽', change_type: 'baseline', created_at: '2026-06-18', quality_status: 'healthy', report_eligible: true, data_mode: 'fixture', source_run_id: 'run_fixture_x' };
const liveRep = buildRep({ agent_request_id: 'req_A', report_data_mode: 'live' }, [rprofile('AlphaBroker', 'req_A')], [fixSnap]);
A.ok('report_data_mode=live excludes a fixture-mode competitor snapshot', !/FixtureCo/.test(JSON.stringify(liveRep)));

A.report('stage3-gates');
