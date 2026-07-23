'use strict';
// test_f7_render.js — F-7 comparison RENDERING into Telegram + XLSX.
//
// The comparison analysis (overview_ru / comparisons / recurring_pains_ru / opportunities /
// recommended_experiments) carries NO `items`, so the single-source renderers dropped it entirely: a paid
// comparison reached the user as deterministic per-source offer facts only (live: exec 1315, msg 585).
const A = require('./_assert.js');
const CR = require('../n8n/lib/compact_report_ru.js');
const AR = require('../n8n/lib/analysis_report_ru.js');
const RP = require('../n8n/lib/report_package.js');

const COMPARISON = {
  enriched: true, quality_status: 'ok', mode: 'call', source: { source_id: 'multi' },
  analysis: {
    overview_ru: 'В пакете 2 источника (zalog24h.ru, autolombardn1.ru) — оба московских автоломбарда. Достаточно для сравнения двух игроков, не всего рынка.',
    comparisons: [
      { aspect: 'positioning', text_ru: 'Оба используют ценовой якорь; zalog24h — на скорость (5 мин), autolombardn1 — на сумму (до 90%).', evidence_ids: ['ev_1', 'ev_3'] },
      { aspect: 'prices', text_ru: 'zalog24h декларирует ставки (от 2,4%); autolombardn1 не публикует ставку.', evidence_ids: ['ev_2', 'ev_4'] }
    ],
    recurring_pains_ru: ['высокая ставка', 'непрозрачные условия'],
    opportunities: [{ text_ru: 'Прозрачный калькулятор ставки', evidence_ids: ['ev_1'] }],
    recommended_experiments: [{ text_ru: 'A/B тест лендинга с калькулятором', priority: 'medium', evidence_ids: ['ev_1'] }],
    used_evidence_ids: ['ev_1', 'ev_2', 'ev_3', 'ev_4']
  }
};

A.section('Telegram — a comparison renders its cross-source structure, not per-source item facts');
{
  const out = CR.crCompactReportRu({ bundle: { analysis_mode: 'comparison' }, analyses: [COMPARISON], summary: { records_reported: 4, final_state: 'completed' }, cost_line: '💰 $0.06', xlsx_expected: true });
  const t = out.text;
  A.eq('profile is multi', out.profile, 'multi');
  A.ok('mode line present', t.indexOf('сравнение источников') >= 0);
  A.ok('overview rendered', t.indexOf('оба московских автоломбарда') >= 0);
  A.ok('comparison section present', t.indexOf('⚖️ Сравнение источников') >= 0);
  A.ok('a real comparison bullet is shown', t.indexOf('ценовой якорь') >= 0);
  A.ok('shared pains shown', t.indexOf('🎯 Общие боли') >= 0);
  A.ok('opportunities shown', t.indexOf('калькулятор') >= 0);
  A.ok('within hard max', t.length <= 1500);
}

A.section('XLSX — the comparison becomes rows with cross-source evidence refs');
{
  const x = AR.analysisXlsxData([COMPARISON]);
  A.eq('two comparison rows', x.comparisons.length, 2);
  A.eq('aspect kept', x.comparisons[0].aspect, 'positioning');
  A.ok('evidence cites BOTH sources', /\[ev_1\]/.test(x.comparisons[0].evidence) && /\[ev_3\]/.test(x.comparisons[0].evidence));
  A.ok('overview surfaced', (x.overview || '').indexOf('2 источника') >= 0);
  A.ok('opportunities folded into recommendations', x.recommendations.some((r) => /калькулятор/.test(r.text)));
  A.ok('experiments folded into recommendations', x.recommendations.some((r) => /A\/B/.test(r.text)));
  A.ok('recurring pains folded into pains', x.pains.some((p) => /высокая ставка/.test(p.text)));
}

A.section('report_package emits a «Сравнение источников» sheet only when comparisons exist');
{
  A.ok('sheet name is canonical', RP.SHEET_NAMES.indexOf('Сравнение источников') >= 0);
  A.ok('it is a Stage-F omit-empty sheet', RP.STAGE_F_SHEETS.indexOf('Сравнение источников') >= 0);

  const withCmp = RP.buildSheets({ analysis: { comparisons: [{ aspect: 'prices', text: 'A дешевле B', evidence: '[ev_1] [ev_3]' }] }, competitors: [], offers: [] });
  const cmpSheet = withCmp.filter((s) => s.name === 'Сравнение источников')[0];
  A.ok('sheet present with rows', !!cmpSheet && cmpSheet.rows.length === 1);
  A.eq('row carries the comparison text', cmpSheet.rows[0].text, 'A дешевле B');

  // A single-source report (no comparisons) drops the sheet under omit_empty.
  const pkg = RP.buildReportPackage({ analysis: { inferences: [], comparisons: [] }, competitors: [], offers: [] }, {}, { omit_empty: true });
  A.ok('no comparison sheet in a single-source workbook', pkg.sheet_names.indexOf('Сравнение источников') < 0);
  const single = RP.buildSheets({ analysis: { comparisons: [] }, competitors: [], offers: [] }).filter((s) => s.name === 'Сравнение источников')[0];
  A.eq('empty comparison sheet has no rows (dropped by omit_empty)', (single && single.rows.length) || 0, 0);
}

A.report('f7-render');
