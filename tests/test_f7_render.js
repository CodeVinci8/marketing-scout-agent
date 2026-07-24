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
  // The multi-source package's evidence map travels back on the analysis (WF28 typedReturn.evidence_map) — this is
  // what lets the ev_N refs resolve to real URLs in the «Доказательства» sheet.
  evidence_map: [
    { id: 'ev_1', url: 'https://zalog24h.ru', type: 'website', excerpt: 'Ставка от 2,4%', fact_type: 'positioning', collected_at: '2026-07-23T03:44:14+03:00', quality_status: 'accepted' },
    { id: 'ev_2', url: 'https://zalog24h.ru', type: 'website', excerpt: 'от 2,9% ПТС', fact_type: 'offer', collected_at: '2026-07-23T03:44:14+03:00', quality_status: 'accepted' },
    { id: 'ev_3', url: 'https://autolombardn1.ru', type: 'website', excerpt: 'до 90% стоимости', fact_type: 'positioning', collected_at: '2026-07-23T03:44:20+03:00', quality_status: 'accepted' },
    { id: 'ev_4', url: 'https://autolombardn1.ru', type: 'website', excerpt: 'индивидуальная ставка', fact_type: 'offer', collected_at: '2026-07-23T03:44:20+03:00', quality_status: 'accepted' }
  ],
  analysis: {
    overview_ru: 'В пакете 2 источника (zalog24h.ru, autolombardn1.ru) — оба московских автоломбарда. Достаточно для сравнения двух игроков, не всего рынка.',
    comparisons: [
      // The model embeds ev_N inline in the prose (as it does live) — the renderer must remap/strip these.
      { aspect: 'positioning', text_ru: 'Оба используют ценовой якорь [ev_1, ev_3]; zalog24h — на скорость (5 мин), autolombardn1 — на сумму (до 90%).', evidence_ids: ['ev_1', 'ev_3'] },
      { aspect: 'prices', text_ru: 'zalog24h декларирует ставки (от 2,4%) [ev_2]; autolombardn1 не публикует ставку [ev_4].', evidence_ids: ['ev_2', 'ev_4'] }
    ],
    recurring_pains_ru: ['высокая ставка', 'непрозрачные условия'],
    opportunities: [{ text_ru: 'Прозрачный калькулятор ставки [ev_1]', evidence_ids: ['ev_1'] }],
    recommended_experiments: [{ text_ru: 'A/B тест лендинга с калькулятором', priority: 'medium', evidence_ids: ['ev_1'] }],
    used_evidence_ids: ['ev_1', 'ev_2', 'ev_3', 'ev_4']
  }
};

// No raw internal ev_N id may survive into any user-facing string.
function noEvLeak(s) { return !/\bev_\d+\b/.test(String(s == null ? '' : s)); }

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
  // The internal ev_N ids the model embedded inline must NOT reach Telegram, and stripping them must not leave
  // dangling brackets/punctuation.
  A.ok('no raw ev_N id leaks to Telegram', noEvLeak(t));
  A.ok('no empty citation brackets left behind', t.indexOf('[]') < 0 && t.indexOf('[,') < 0);
}

A.section('XLSX — the comparison becomes rows with RESOLVABLE cross-source evidence refs');
{
  const x = AR.analysisXlsxData([COMPARISON]);
  A.eq('two comparison rows', x.comparisons.length, 2);
  A.eq('aspect kept', x.comparisons[0].aspect, 'positioning');
  // ev_N is remapped to the visible [n] the «Доказательства» sheet uses — the raw id must not survive.
  A.ok('evidence column uses visible [n], not raw ev_N', /\[\d+\]/.test(x.comparisons[0].evidence) && noEvLeak(x.comparisons[0].evidence));
  A.ok('comparison row cites both source markers', /\[1\]/.test(x.comparisons[0].evidence) && /\[2\]/.test(x.comparisons[0].evidence));
  A.ok('no raw ev_N id leaks into comparison text', x.comparisons.every((c) => noEvLeak(c.text)));
  A.ok('overview surfaced', (x.overview || '').indexOf('2 источника') >= 0);
  A.ok('opportunities folded into recommendations', x.recommendations.some((r) => /калькулятор/.test(r.text) && noEvLeak(r.text)));
  A.ok('experiments folded into recommendations', x.recommendations.some((r) => /A\/B/.test(r.text)));
  A.ok('recurring pains folded into pains', x.pains.some((p) => /высокая ставка/.test(p.text)));
  // The evidence sheet must now populate from the multi-source evidence_map so the [n] refs resolve to real URLs.
  // arBuildEvidenceIndex dedupes by URL (one visible [n] per unique source, ev ids backfilling the same row), so the
  // 4 ev items across 2 domains collapse to 2 «Доказательства» rows — [1]=zalog24h.ru, [2]=autolombardn1.ru.
  A.eq('evidence rows populated (one per unique source URL)', x.evidence.length, 2);
  A.ok('evidence row [1] resolves to a real URL', x.evidence.some((e) => e.ref === '[1]' && /zalog24h\.ru/.test(e.url)));
  A.ok('evidence row [2] resolves to the OTHER source', x.evidence.some((e) => e.ref === '[2]' && /autolombardn1\.ru/.test(e.url)));
  A.ok('every comparison [n] ref resolves to an evidence row', (function () {
    const refs = new Set(); x.comparisons.forEach((c) => (String(c.evidence).match(/\[(\d+)\]/g) || []).forEach((m) => refs.add(m)));
    const have = new Set(x.evidence.map((e) => e.ref));
    return [...refs].every((r) => have.has(r));
  })());
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
