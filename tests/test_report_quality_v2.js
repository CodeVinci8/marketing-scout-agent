// test_report_quality_v2.js — RQ-v2 report-quality repair, proven on the REAL WF12 "Build Deterministic Report"
// Code node + the conversation_response follow-up. Covers the defects the live deterministic run surfaced:
//   * AVITO-BLOCK-001 regression: report advertised "Avito: доступен плановый сбор" while blocked
//   * RQ-PLACEHOLDER-001: raw "competitor channel ad copy" placeholder shown as an offer
//   * RQ-ENTITY-001: undecoded HTML entities (&#33;) in competitor names
//   * RQ-EMPTY-001: blank "## План контента" / "## Идеи для контента (нет)" / "## Топ углов рынка (в этом срезе нет)"
//   * RQ-TREND-001: "есть сравнение с прошлым периодом" claimed without concrete deltas
//   * RQ-COUNTS-001: single ambiguous "релевантных записей" count
//   * RQ-BUTTONS-001: follow-up button captions lower-cased / awkward
// $0, no network.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf12 = H.loadWorkflow('12_market_intelligence_report_builder.json');
const NICHE = 'credit_brokerage', REGION = 'Москва/МО', STAMP = '20260711_120000', REQ = 'req_rqv2';
const LIN = { source_run_ids: 'run_ok', data_mode: 'live', report_eligible: true };
const health = [{ source_run_id: 'run_ok', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' }];

// Build a report with: 2 telegram competitor profiles whose only "offer" is the internal placeholder + an
// HTML-entity name; NO market angles (empty section); NO baseline (no trend); one prior plan is optionally added.
function runReport(opts) {
  opts = opts || {};
  const run = H.makeRun();
  if (opts.env) run.env = opts.env;
  const cfg = H.runCodeNode(run, wf12, 'Set Report Config', [])[0].json;
  Object.assign(cfg, { niche_id: NICHE, region: REGION, agent_request_id: REQ });
  run.outputs['Set Report Config'] = [{ json: cfg }];
  H.inject(run, 'Read competitor_profiles', [
    Object.assign({ competitor_id: 'c1', competitor_name: 'Кредитный брокер💲 Банки', platforms: 'telegram', offers: 'competitor channel ad copy', prices_terms: '', evidence_count: 1, source_confidence_score: 45, notes: 'run wf10_' + STAMP }, LIN),
    Object.assign({ competitor_id: 'c2', competitor_name: 'Ипотека и кредит с Алексеем Светловым&#33;', platforms: 'telegram', offers: 'competitor channel ad copy', prices_terms: '', evidence_count: 1, source_confidence_score: 45, notes: 'run wf10_' + STAMP }, LIN)
  ]);
  H.inject(run, 'Read market_angles', opts.angles || []);
  H.inject(run, 'Read audience_activity_signals', [Object.assign({ signal_id: 'sig_tg_' + STAMP, platform: 'telegram', question_count: 0, objection_count: 0, complaint_count: 0, buying_intent_count: 0, top_pains: '' }, LIN)]);
  const rows = opts.noData ? 0 : 2;
  const pid = opts.noData ? ('plan_' + STAMP + '_no_data') : ('plan_' + STAMP);
  const plans = [{ plan_id: pid, niche: NICHE, region: REGION, source_evidence: 'rows=' + rows + ' (window 30d)', top_angles: '' }];
  H.inject(run, 'Read content_positioning_plan', plans);
  H.inject(run, 'Read competitor_site_snapshots', opts.snaps || []);
  H.inject(run, 'Read public_lead_signals', []);
  H.inject(run, 'Read source_health', health);
  return H.runCodeNode(run, wf12, 'Build Deterministic Report', [])[0].json;
}

const rep = runReport();
const md = String(rep.report_markdown || '');

A.section('RQ-AVITO — a blocked Avito is never advertised in the report (MS_AVITO_ENABLED unset/false)');
A.ok('no "Avito: доступен плановый сбор" while blocked', md.indexOf('Avito: доступен') < 0 && md.indexOf('плановый сбор') < 0, 'avito advertised: ' + (md.match(/Avito[^\n]*/) || ['?'])[0]);
A.ok('the word Avito/Авито does not appear at all when unprompted+blocked', !/avito/i.test(md) && md.indexOf('Авито') < 0, 'avito mentioned');
const repAvito = runReport({ env: { MS_AVITO_ENABLED: 'true' } });
A.ok('Avito action IS shown only when explicitly re-enabled', String(repAvito.report_markdown).indexOf('Avito: доступен') >= 0, 'avito line missing when enabled');

A.section('RQ-PLACEHOLDER — internal "competitor channel ad copy" never reaches the user');
A.ok('no raw "competitor channel ad copy" anywhere', md.indexOf('competitor channel ad copy') < 0, 'placeholder leaked');
A.ok('offers section omits placeholder-only rows -> honest fallback', /офферы\/цены не извлечены/.test(md), 'expected empty-offers fallback');

A.section('RQ-ENTITY — HTML entities are decoded');
A.ok('&#33; decoded to "!"', md.indexOf('&#33;') < 0 && md.indexOf('Алексеем Светловым!') >= 0, 'entity not decoded');
A.ok('no visible &#..; / &amp; entities anywhere', !/&#\d+;|&amp;|&quot;|&lt;|&gt;/.test(md), 'raw entity present');

A.section('RQ-EMPTY — blank/near-empty sections are omitted');
A.ok('no "## План контента" section', md.indexOf('## План контента') < 0, 'empty План контента present');
A.ok('no empty "## Идеи для контента" section', !/##\s*Идеи для контента\s*\n\(нет\)/.test(md) && md.indexOf('## Идеи для контента') < 0, 'empty ideas section present');
A.ok('no empty "## Топ углов рынка" section', md.indexOf('## Топ углов рынка') < 0, 'empty angles section present');
A.ok('no "(в этом срезе нет)" placeholder body', md.indexOf('(в этом срезе нет)') < 0, 'empty-section placeholder present');
A.ok('no 3+ consecutive newlines (collapsed spacing)', !/\n{3,}/.test(md), 'stray blank lines');

A.section('RQ-TREND — comparison claim only with concrete deltas');
A.ok('no baseline -> does NOT claim "есть сравнение"', md.indexOf('есть сравнение с прошлым периодом') < 0, 'unsupported trend claim');
A.ok('no baseline -> honest "недостаточно данных для сравнения"', /недостаточно данных для сравнения/.test(md), 'missing honest trend line');

A.section('RQ-COUNTS — distinct, user-clear counts');
A.ok('distinct counts line present', /Профили конкурентов:\s*2/.test(md) && /сайты конкурентов:\s*0/.test(md) && /публичные лид-сигналы:\s*0/.test(md), 'counts line: ' + (md.match(/Профили конкурентов[^\n]*/) || ['?'])[0]);
A.ok('no internal source_confidence_rules token', md.indexOf('source_confidence_rules') < 0, 'internal token leaked');

A.section('RQ-BUTTONS — follow-up captions are proper-cased + concise; sentence stays lowercase');
const CR = require('../n8n/lib/conversation_response.js');
const caps = [
  { id: 'deep_competitor_analysis', name: 'X', available: true },
  { id: 'generate_ideas', name: 'X', available: true },
  { id: 'rerun_request', name: 'X', available: true },
  { id: 'compare_periods', name: 'X', available: true },
  { id: 'add_source', name: 'X', available: true }
];
const kb = CR.proactiveKeyboard('completed', caps);
const btns = kb.inline_keyboard.map(r => r[0].text);
A.ok('every button caption is Capitalized', btns.every(t => /^[А-ЯЁ]/.test(t)), 'lowercase button: ' + btns.join(' | '));
A.ok('button "Подробнее сравнить конкурентов" (no "этих")', btns.indexOf('Подробнее сравнить конкурентов') >= 0, 'labels: ' + btns.join(' | '));
A.ok('button "Предложить идеи для оффера" (no "вашего")', btns.indexOf('Предложить идеи для оффера') >= 0, 'labels: ' + btns.join(' | '));
const sentence = CR.proactiveText('completed', caps);
A.ok('sentence stays natural lowercase after "Я могу"', /Я могу подробнее сравнить конкурентов/.test(sentence), 'sentence: ' + sentence);
A.ok('no Avito in any follow-up button', !btns.some(t => /avito|авито/i.test(t)), 'avito button present');

A.section('RQ-PLACEHOLDER — the XLSX report_bundle offers also omit placeholders + decode entities');
const bundle = JSON.parse(String(rep.report_bundle || '{}'));
A.ok('bundle has no "competitor channel ad copy" offer', JSON.stringify(bundle.offers || []).indexOf('competitor channel ad copy') < 0, 'bundle offer placeholder leaked');
A.ok('bundle offers are placeholder-only -> omitted (0 rows)', (bundle.offers || []).length === 0, 'bundle offers=' + JSON.stringify(bundle.offers));
A.ok('bundle competitor names decode entities', JSON.stringify(bundle.competitors || []).indexOf('&#33;') < 0 && JSON.stringify(bundle.competitors || []).indexOf('Светловым!') >= 0, 'bundle name entity not decoded');

A.section('RQ — real website offers/prices still render (regression guard)');
const rep3 = runReport({ snaps: [{ domain: 'lioncredit.ru', company_name: 'LionCredit', offer_summary: 'Кредит наличными', prices_terms: 'от 4,99%', cta_text: 'Оставить заявку', change_type: 'baseline', created_at: '2026-07-08', quality_status: 'healthy', report_eligible: true }] });
const md3 = String(rep3.report_markdown);
A.ok('website snapshot still shown', md3.indexOf('lioncredit.ru') >= 0, 'website lost');
A.ok('sites count reflects the snapshot', /сайты конкурентов:\s*1/.test(md3), 'site count wrong');

A.section('RQ-NODATA — a no-data report is clean Russian, non-technical, and not self-contradictory');
const nd = runReport({ noData: true, snaps: [{ domain: 'finardi.ru', company_name: 'Финарди', offer_summary: 'кредит под залог', prices_terms: 'от 9,5%', change_type: 'baseline', created_at: '2026-07-08', quality_status: 'healthy', report_eligible: true }] });
const ndmd = String(nd.report_markdown || '');
A.ok('no "NO DATA" english/enum leak', ndmd.indexOf('NO DATA') < 0 && ndmd.indexOf('no_data') < 0, 'leak: ' + (ndmd.match(/no.?data/i) || ['?'])[0]);
A.ok('no "broaden filters or source scope" english', ndmd.toLowerCase().indexOf('broaden') < 0, 'english debug text');
A.ok('clean Russian no-data explanation', ndmd.indexOf('новых релевантных данных не найдено') >= 0, 'missing RU no-data text');
A.ok('has "## Что произошло" + "## Что можно сделать"', ndmd.indexOf('## Что произошло') >= 0 && ndmd.indexOf('## Что можно сделать') >= 0, 'missing no-data UX sections');
A.ok('no-data counts are not self-contradictory (no "Профили конкурентов: 0 · сайты конкурентов: N")', !/Профили конкурентов:\s*0\s*·\s*сайты конкурентов:\s*[1-9]/.test(ndmd), 'contradictory headline');
A.ok('no-data separates saved snapshots as "вне текущего окна"', /сохранённых веб-снапшотов сайтов:\s*1\s*\(вне текущего окна\)/.test(ndmd), 'snapshot labeling missing');
A.ok('no-data report still leaks nothing internal', !/WF\d|rows_after|source_run_id|review_queue|report_2\d/.test(ndmd), 'internal leak in no-data');
A.ok('no-data notes column keeps the internal diagnostic (not user-facing)', String(nd.notes || '').indexOf('no_data_notice') >= 0, 'notes diagnostic lost');

A.report('report-quality-v2');
