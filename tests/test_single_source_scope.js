// test_single_source_scope.js — B1/B6: an explicit single-website request must scope the report (counts, "Сайты
// конкурентов" block, source-mix, offers/prices) to THAT site only. Historical website snapshots already in the base
// (mkbkfin.ru / finardi.ru / lioncredit.ru) may appear ONLY in a clearly-labeled "Исторический контекст" block and
// must NEVER inflate the current-run counts. Runs the REAL WF12 "Build Deterministic Report" node ($0, no network).
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('12_market_intelligence_report_builder.json');
const NICHE = 'credit_brokerage', REGION = 'Москва/МО';
const CUR = '20260714_120000';
const LIN = { source_run_ids: 'firecrawl_' + CUR, data_mode: 'live', report_eligible: true, quality_status: 'healthy' };

// One competitor profile derived from the requested site this run (carries the site URL + this run's lineage).
const profile = Object.assign({
  competitor_id: 'comp_autolombard', competitor_name: 'Автоломбард №1', platforms: 'website',
  offers: '', prices_terms: '', evidence_count: 1, source_confidence_score: 45,
  source_urls: 'https://autolombardn1.ru', last_seen_at: '2026-07-14',
  notes: 'wf10 v0.3; run wf10_' + CUR + '; window 30d'
}, LIN);

// The requested site's fresh snapshot (this run) + THREE historical snapshots from earlier, unrelated runs.
const curSnap  = { domain: 'autolombardn1.ru', company_name: 'Автоломбард №1', offer_summary: 'Займы под залог авто и ПТС', prices_terms: 'от 5% в месяц', cta_text: 'Оставить заявку', change_type: 'baseline', created_at: '2026-07-14', source_run_id: 'firecrawl_' + CUR, data_mode: 'live', quality_status: 'healthy', report_eligible: true };
const histA = { domain: 'mkbkfin.ru',  company_name: 'МКБК',      offer_summary: 'Кредитный брокер',  change_type: 'baseline', created_at: '2026-07-01', source_run_id: 'firecrawl_20260701_090000', data_mode: 'live', quality_status: 'healthy', report_eligible: true };
const histB = { domain: 'finardi.ru',  company_name: 'Финарди',   offer_summary: 'Займы',              change_type: 'baseline', created_at: '2026-07-02', source_run_id: 'firecrawl_20260702_090000', data_mode: 'live', quality_status: 'healthy', report_eligible: true };
const histC = { domain: 'lioncredit.ru', company_name: 'LionCredit', offer_summary: 'Кредит наличными', change_type: 'baseline', created_at: '2026-07-03', source_run_id: 'firecrawl_20260703_090000', data_mode: 'live', quality_status: 'healthy', report_eligible: true };

// Each run (current + the 3 historical) wrote its own source_health row — so all snapshots pass the report gate,
// exactly as in production. The scoping (not the gate) is what keeps historical sites out of the current count.
const health = ['firecrawl_' + CUR, 'firecrawl_20260701_090000', 'firecrawl_20260702_090000', 'firecrawl_20260703_090000']
  .map(function (id) { return { source_run_id: id, data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' }; });

function buildReport(supplied) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf, 'Set Report Config', [])[0].json;
  Object.assign(cfg, { niche_id: NICHE, region: REGION, agent_request_id: 'req_singlesite',
    supplied_sources: JSON.stringify(supplied) });
  run.outputs['Set Report Config'] = [{ json: cfg }];
  H.inject(run, 'Read competitor_profiles', [profile]);
  H.inject(run, 'Read market_angles', []);
  H.inject(run, 'Read audience_activity_signals', []);
  H.inject(run, 'Read content_positioning_plan', [{ plan_id: 'plan_' + CUR, niche: NICHE, region: REGION, source_evidence: 'rows=1 (window 30d)' }]);
  H.inject(run, 'Read competitor_site_snapshots', [curSnap, histA, histB, histC]);
  H.inject(run, 'Read public_lead_signals', []);
  H.inject(run, 'Read source_health', health);
  return H.runCodeNode(run, wf, 'Build Deterministic Report', [])[0].json;
}

const supplied = { websites: ['https://autolombardn1.ru'], telegram: [], vk: [], explicit: true };
const rep = buildReport(supplied);
const md = String(rep.report_markdown);

A.section('B1 — explicit single-website report is scoped to the requested site only');
A.ok('count line shows "сайты конкурентов: 1" (not 4)', /сайты конкурентов:\s*1\b/.test(md), (md.match(/Профили конкурентов[^\n]*/) || ['?'])[0]);
A.ok('requested site autolombardn1.ru is present', md.indexOf('autolombardn1.ru') >= 0);

A.section('B1 — historical domains are NOT presented as current results');
const siteBlock = (md.split('## Сайты конкурентов')[1] || '').split('##')[0];
['mkbkfin.ru', 'finardi.ru', 'lioncredit.ru'].forEach(function (d) {
  A.ok('historical ' + d + ' NOT in "Сайты конкурентов" block', siteBlock.indexOf(d) < 0, 'leaked into current site block');
});
A.ok('has a labeled "## Исторический контекст" block', md.indexOf('## Исторический контекст') >= 0, md);
const histBlock = (md.split('## Исторический контекст')[1] || '').split('##')[0];
A.ok('historical block states 3 other saved sites', /есть\s*3\s*других/.test(histBlock), histBlock);
A.ok('historical block says they were NOT used this run', histBlock.indexOf('не использовались как результаты текущего сбора') >= 0, histBlock);

A.section('B6 — honest source-mix + offers/prices flow from the snapshot');
A.ok('current source-mix names веб-сайты (not a blanket "исторические")', /текущий сбор:\s*веб-сайты/.test(md), md.match(/текущий сбор:[^\n.]*/) || '?');
A.ok('offers/prices from the site snapshot appear (not "не извлечены")', md.indexOf('Займы под залог авто и ПТС') >= 0 || md.indexOf('от 5% в месяц') >= 0, 'site offer/price not surfaced');

A.section('B5 — no internal tokens / raw enums / policy ids in the user-facing report');
A.ok('no raw "conf N" token', !/\bconf\s+\d/.test(md), md.match(/conf\s+\d[^\n]*/) || '');
A.ok('no raw "evidence N" token', !/\bevidence\s+\d/.test(md), md.match(/evidence\s+\d[^\n]*/) || '');
A.ok('no CONTACT_AND_OUTREACH_POLICY id', md.indexOf('CONTACT_AND_OUTREACH_POLICY') < 0);
A.ok('confidence rendered in Russian /100', /уверенность\s*\d+\/100/.test(md), 'russian confidence missing');

A.section('B1 — the machine bundle stays correctly scoped (competitors_found = 1)');
const bundle = JSON.parse(String(rep.report_bundle || '{}'));
A.eq('bundle competitors_found = 1', bundle.summary && bundle.summary.competitors_found, 1);
A.eq('bundle competitors list length = 1', (bundle.competitors || []).length, 1);
A.ok('bundle source_mix reflects current web (not hardcoded historical)', String(bundle.source_mix).indexOf('current: веб-сайты') >= 0, 'source_mix=' + bundle.source_mix);

A.section('Regression — no scope signal keeps prior behaviour (snapshot still shown)');
const repNoSig = (function () {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf, 'Set Report Config', [])[0].json;
  Object.assign(cfg, { niche_id: NICHE, region: REGION });
  run.outputs['Set Report Config'] = [{ json: cfg }];
  H.inject(run, 'Read competitor_profiles', [Object.assign({ competitor_id: 'c1', competitor_name: 'Тест', platforms: 'telegram', offers: 'Кредит', evidence_count: 2, source_confidence_score: 70, notes: 'run wf10_' + CUR }, LIN)]);
  H.inject(run, 'Read market_angles', []);
  H.inject(run, 'Read audience_activity_signals', []);
  H.inject(run, 'Read content_positioning_plan', [{ plan_id: 'plan_' + CUR, niche: NICHE, region: REGION, source_evidence: 'rows=1 (window 30d)' }]);
  H.inject(run, 'Read competitor_site_snapshots', [{ domain: 'somesite.ru', company_name: 'X', offer_summary: 'offer', change_type: 'baseline', created_at: '2026-07-10', quality_status: 'healthy', report_eligible: true }]);
  H.inject(run, 'Read public_lead_signals', []);
  H.inject(run, 'Read source_health', health);
  return H.runCodeNode(run, wf, 'Build Deterministic Report', [])[0].json;
})();
A.ok('no-signal report still counts the saved snapshot', /сайты конкурентов:\s*1\b/.test(String(repNoSig.report_markdown)), 'regressed a legitimate report');

A.report('single-source-scope');
