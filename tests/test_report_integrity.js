'use strict';
// test_report_integrity.js — REPORT-TRUTH-E: row-integrity + report-truth regressions for the delivered XLSX.
// An independent inspection of three delivered workbooks found: recommendation/pain rows duplicated (the second
// half identical to the first), «свежий сбор» claimed for a reuse+collect run, external calls under-counted, no
// requested-vs-actual/downgrade fields, user dates 3h behind MSK, «Проверено источников»=1 for a 3-source synthesis,
// evidence rows keyed «Конкурент=multi», raw English aspect keys, an empty «Следующий шаг» column, and AI claims
// contradicting deterministic quality / broadcasting a partial property to all sources / stating market-gap
// hypotheses as facts. This suite locks in the general (not per-report) fixes. Offline, $0.
const A = require('./_assert.js');
const AR = require('../n8n/lib/analysis_report_ru.js');
const RP = require('../n8n/lib/report_package.js');
const CR = require('../n8n/lib/compact_report_ru.js');
const ES = require('../n8n/lib/execution_summary.js');

// A synthesis analysis over THREE real sources (2 evidence each). It carries 4 opportunities + 5 experiments
// (=> 9 recommendations) and 4 recurring pains — the exact shape the delivered workbook doubled to 18 / 8.
const H1 = 'autolombard-moskva.ru', H2 = 'zalog24h.ru', H3 = 'autolombardn1.ru';
function synthAnalysis() {
  return {
    analysis_id: 'an_int', enriched: true, mode: 'call', quality_status: 'ok', fallback_used: false,
    analysis_mode: 'synthesis', source: { source_id: 'multi', kind: 'multi', source_count: 3 },
    evidence_map: [
      { id: 'ev_1', url: 'https://' + H1, source_id: H1, type: 'website', excerpt: 'от 2%', quality_status: 'accepted' },
      { id: 'ev_2', url: 'https://' + H1, source_id: H1, type: 'website', excerpt: 'до 90%', quality_status: 'accepted' },
      { id: 'ev_3', url: 'https://' + H2, source_id: H2, type: 'website', excerpt: 'от 2,4%', quality_status: 'accepted' },
      { id: 'ev_4', url: 'https://' + H2, source_id: H2, type: 'website', excerpt: 'акция до 01.08', quality_status: 'accepted' },
      { id: 'ev_5', url: 'https://' + H3, source_id: H3, type: 'website', excerpt: 'индивидуально', quality_status: 'accepted' },
      { id: 'ev_6', url: 'https://' + H3, source_id: H3, type: 'website', excerpt: 'до 90%', quality_status: 'accepted' }
    ],
    analysis: {
      overview_ru: 'Три московских автоломбарда [ev_1, ev_3, ev_5].',
      comparisons: [
        { aspect: 'positioning', text_ru: 'Ценовой якорь [ev_1, ev_3, ev_5].', evidence_ids: ['ev_1', 'ev_3', 'ev_5'] },
        { aspect: 'offers', text_ru: 'Разные офферы [ev_2, ev_4].', evidence_ids: ['ev_2', 'ev_4'] },
        { aspect: 'prices', text_ru: 'Ставки различаются [ev_1, ev_3].', evidence_ids: ['ev_1', 'ev_3'] },
        { aspect: 'cta', text_ru: 'CTA [ev_4].', evidence_ids: ['ev_4'] },
        { aspect: 'strengths', text_ru: 'Сильные стороны [ev_1].', evidence_ids: ['ev_1'] },
        { aspect: 'weaknesses', text_ru: 'Слабые стороны [ev_6].', evidence_ids: ['ev_6'] },
        // defect 9: a property only ev_2 (one source) supports, broadcast to «все три».
        { aspect: 'audience', text_ru: 'Все три источника нацелены на клиентов с любой кредитной историей [ev_2].', evidence_ids: ['ev_2'] }
      ],
      opportunities: [
        { text_ru: 'Рефинансирование — незанятая ниша [ev_4].', evidence_ids: ['ev_4'] },
        { text_ru: 'Прозрачный калькулятор [ev_1].', evidence_ids: ['ev_1'] },
        { text_ru: 'Сегмент нестандартного транспорта [ev_5].', evidence_ids: ['ev_5'] },
        { text_ru: 'Онлайн-заявка [ev_3].', evidence_ids: ['ev_3'] }
      ],
      recommended_experiments: [
        { text_ru: 'A/B лендинга', priority: 'medium', evidence_ids: ['ev_1'] },
        { text_ru: 'Тест ставки', priority: 'high', evidence_ids: ['ev_3'] },
        { text_ru: 'Тест CTA', priority: 'low', evidence_ids: ['ev_4'] },
        { text_ru: 'Тест формы', priority: 'medium', evidence_ids: ['ev_2'] },
        { text_ru: 'Тест оффера', priority: 'medium', evidence_ids: ['ev_5'] }
      ],
      recurring_pains_ru: ['Непрозрачные ставки', 'Скрытые комиссии', 'Долгое одобрение', 'Нет онлайн-оформления'],
      used_evidence_ids: ['ev_1', 'ev_2', 'ev_3', 'ev_4', 'ev_5', 'ev_6'],
      // defect 8: an AI limitation contradicting the deterministic accepted/healthy quality.
      limitations_ru: ['Источники были в карантине, данные не собраны', 'Выборка из трёх источников — не весь рынок']
    }
  };
}
// The exact bundle-assembly the generated WF20 node performs (analysisXlsxData validated + raw, merged).
function assembleAnalysis(analyses) {
  const rend = AR.renderAnalysisSectionsRu(analyses, {}, {});
  const x = AR.analysisXlsxData(analyses, rend);
  const xc = AR.analysisXlsxData(analyses);
  if ((xc.comparisons || []).length) {
    x.comparisons = xc.comparisons; x.overview = xc.overview;
    x.recommendations = AR.arMergeXlsxRows(x.recommendations, xc.recommendations);
    x.pains = AR.arMergeXlsxRows(x.pains, xc.pains);
    if ((xc.evidence || []).length && !(x.evidence || []).length) x.evidence = xc.evidence;
  }
  return x;
}
function bundle(analyses, over) {
  const x = assembleAnalysis(analyses);
  return Object.assign({
    report_id: 'report_int', agent_request_id: 'req_int', owner_user_id: '1188830082',
    created_at: '2026-07-24T18:18:59.951+03:00', niche: 'credit_brokerage', region: 'Москва/МО',
    analysis_mode: 'synthesis', competitors: [], offers: [], evidence: [], source_quality: [],
    analysis: x,
    // Deterministic WF04→WF20 accounting the real Build Execution Summary / Shape Report Bundle now propagate:
    // 3 contributing sources, 1 freshly collected (H1), 2 reused snapshots (H2, H3), 0 rejected. external_calls (5) is
    // DELIBERATELY ≠ fresh count (1) — the one fresh source cost several pages; the two must never be conflated.
    summary: { competitors_found: 3, sources_checked: 3, contributing_sources: 3, sources_contributing: 3,
      fresh_collections: 1, sources_fresh: 1, fresh_sources: [H1],
      sources_reused: 2, reused_source_keys: [H2, H3],
      reused_sources: [{ source: H2, original_run_id: 'r_h2', original_collected_at: '2026-07-20T09:00:00Z' },
        { source: H3, original_run_id: 'r_h3', original_collected_at: '2026-07-21T10:30:00Z' }],
      sources_rejected: 0, rejected_sources: [],
      external_calls: 5, external_calls_actual: 5, quality_status: 'healthy', analysis_mode: 'synthesis',
      analysis_mode_requested: 'synthesis', analysis_mode_downgraded: false, analysis_mode_reason_ru: '' }
  }, over || {});
}
function scopeOf(b) { return { owner_user_id: b.owner_user_id, agent_request_id: b.agent_request_id, report_id: b.report_id }; }

// ============================================================================================================
A.section('REPORT-TRUTH-E · row integrity — the doubled recommendation/pain rows stay single');
{
  const x = assembleAnalysis([synthAnalysis()]);
  A.eq('nine unique recommendation rows remain nine (were doubled to 18)', x.recommendations.length, 9);
  A.eq('four unique pain rows remain four (were doubled to 8)', x.pains.length, 4);
  // rerendering is idempotent: merging the raw set in again introduces nothing.
  const raw = AR.analysisXlsxData([synthAnalysis()]);
  A.eq('re-merge is idempotent (recommendations)', AR.arMergeXlsxRows(x.recommendations, raw.recommendations).length, 9);
  A.eq('re-merge is idempotent (pains)', AR.arMergeXlsxRows(x.pains, raw.pains).length, 4);
  // the OLD blind concat WOULD double — proves this suite actually catches the defect.
  A.eq('a blind concat is what produced the 18-row defect', x.recommendations.concat(raw.recommendations).length, 18);
}

A.section('REPORT-TRUTH-E · no duplicate row through source_analysis + synthesis merge');
{
  // a single-source analysis that recommends the SAME action the synthesis experiment does — must not appear twice.
  const single = { analysis_id: 'an_s', enriched: true, mode: 'call', quality_status: 'ok', source: { source_id: H2, kind: 'website' },
    evidence_map: [{ id: 'ev_1', url: 'https://' + H2, source_id: H2, type: 'website', excerpt: 'от 2,4%', quality_status: 'accepted' }],
    analysis: { executive_summary_ru: 'x', used_evidence_ids: ['ev_1'],
      items: [{ dimension: 'positioning', kind: 'fact', text_ru: 'Ставка от 2,4%', evidence_ids: ['ev_1'] }],
      recommended_actions: [{ text_ru: 'Тест ставки', priority: 'high', evidence_ids: ['ev_1'] }] } };
  const x = assembleAnalysis([single, synthAnalysis()]);
  const texts = x.recommendations.map(r => r.text + '|' + r.source);
  A.eq('no duplicate normalized recommendation row', new Set(texts).size, texts.length);
}

A.section('REPORT-TRUTH-E · workbook truth fields (mixed mode, requested/actual/downgrade, contributing, sources)');
{
  const b = bundle([synthAnalysis()]);
  const sheets = RP.buildSheets(b);
  const summary = sheets.find(s => s.name === 'Сводка');
  const row = summary.rows[0];
  A.eq('defect 1: reuse+collect run reads as mixed, not «свежий сбор»', row.data_mode, 'смешанный (часть из сохранённых данных)');
  A.eq('defect 3: actual mode', row.mode, 'сводный анализ');
  A.eq('defect 3: requested mode is a separate field', row.mode_requested, 'сводный анализ');
  A.eq('defect 3: no downgrade => empty downgrade cell', row.downgrade, '');
  A.eq('defect 5: «собрано заново» = fresh only', row.sources, 1);
  A.eq('defect 5: «в анализе» = contributing sources', row.contributing, 3);
  A.ok('defect 5: the contributing column header is unambiguous', summary.columns.some(c => c.key === 'contributing' && /в анализе/.test(c.header)));
  A.ok('defect 3: requested + downgrade columns exist', summary.columns.some(c => c.key === 'mode_requested') && summary.columns.some(c => c.key === 'downgrade'));
  // WF04→WF20 independence: fresh (1), contributing (3) and external calls (5) are THREE distinct values — proving the
  // report never derives fresh from external calls, nor contributing from fresh.
  A.eq('external-call count is independent of fresh count', row.calls, 5);
  A.ok('fresh ≠ contributing ≠ external-calls (all distinct)', row.sources === 1 && row.contributing === 3 && row.calls === 5);
}

A.section('REPORT-TRUTH-E · a downgraded partial states requested≠actual + a reason');
{
  const b = bundle([synthAnalysis()], { analysis_mode: 'comparison',
    summary: { competitors_found: 2, sources_checked: 1, contributing_sources: 2, fresh_collections: 1, external_calls: 1,
      quality_status: 'healthy', analysis_mode: 'comparison', analysis_mode_requested: 'synthesis',
      analysis_mode_downgraded: true, analysis_mode_reason_ru: 'источников с данными меньше трёх — построено сравнение двух источников' } });
  const row = RP.buildSheets(b).find(s => s.name === 'Сводка').rows[0];
  A.eq('actual mode is comparison', row.mode, 'сравнение источников');
  A.eq('requested mode kept as synthesis', row.mode_requested, 'сводный анализ');
  A.ok('downgrade cell states requested≠actual + reason', /запрошен «сводный анализ», построен «сравнение источников».*меньше трёх/.test(row.downgrade));
}

A.section('REPORT-TRUTH-E · per-evidence source identity (defect 6) + translated aspects (defect 7)');
{
  const b = bundle([synthAnalysis()]);
  const sheets = RP.buildSheets(b);
  const ev = sheets.find(s => s.name === 'Доказательства').rows;
  const comps = ev.map(r => r.competitor);
  A.ok('evidence rows name the real hosts, never «multi»', comps.indexOf('multi') < 0 && comps.indexOf(H1) >= 0 && comps.indexOf(H2) >= 0 && comps.indexOf(H3) >= 0);
  const aspects = sheets.find(s => s.name === 'Сравнение источников').rows.map(r => r.aspect);
  A.ok('positioning → Позиционирование', aspects.indexOf('Позиционирование') >= 0);
  A.ok('no raw English aspect key leaks', aspects.every(a => !/^[a-z_]+$/.test(a)));
  ['Офферы', 'Цены и ставки', 'Призывы к действию', 'Сильные стороны', 'Слабые стороны', 'Аудитория'].forEach(exp =>
    A.ok('aspect translated: ' + exp, aspects.indexOf(exp) >= 0));
}

A.section('REPORT-TRUTH-E · empty «Следующий шаг» column is dropped, populated one is kept (defect 11)');
{
  const cols = RP.buildSheets(bundle([synthAnalysis()])).find(s => s.name === 'Рекомендации').columns.map(c => c.key);
  A.ok('empty next_action column dropped', cols.indexOf('next_action') < 0);
  const withNext = RP.buildSheets({ report_id: 'r', agent_request_id: 'a', owner_user_id: 'o', analysis_mode: 'source_analysis',
    competitors: [], offers: [], recommendations: [{ recommendation: 'X', priority: 'high', next_action: 'сделать Y' }],
    summary: {} }).find(s => s.name === 'Рекомендации');
  A.ok('populated next_action column kept', withNext.columns.some(c => c.key === 'next_action'));
}

A.section('REPORT-TRUTH-E · MSK timezone rendering + label (defect 4)');
{
  const { workbookBuffer } = require('../n8n/lib/xlsx_writer.js');
  const zlib = require('zlib');
  const buf = workbookBuffer([{ name: 'T', columns: [{ header: 'Дата', key: 'd', type: 'datetime', width: 20 }],
    rows: [{ d: '2026-07-24T18:18:59.951+03:00' }] }]);
  A.ok('workbook builds with a datetime column', buf.length > 0);
  // inflate every stored deflate stream and look for the «(МСК)» header label (the zip is compressed, so the raw
  // buffer cannot be grepped directly).
  let found = false;
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method = buf.readUInt16LE(i + 8), nameLen = buf.readUInt16LE(i + 26), extraLen = buf.readUInt16LE(i + 28);
      const start = i + 30 + nameLen + extraLen;
      try {
        const raw = buf.slice(start, start + 4000);
        const txt = (method === 8 ? zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }) : raw).toString('utf8');
        if (txt.indexOf('(МСК)') >= 0) { found = true; break; }
      } catch (e) { /* keep scanning */ }
    }
  }
  A.ok('datetime header is labelled (МСК)', found);
}
{
  // Direct: the serial must represent Moscow wall-clock (UTC+3). 2026-07-24T18:18:59+03:00 => day fraction ~0.7632.
  const iso = '2026-07-24T15:18:59.000Z'; // same instant as 18:18:59 MSK
  const t = Date.parse(iso);
  const mskSerial = (t + 180 * 60000) / 86400000 + 25569;
  const utcSerial = t / 86400000 + 25569;
  const frac = mskSerial - Math.floor(mskSerial);
  const hour = Math.round(frac * 24 * 100) / 100;
  A.ok('MSK serial encodes ~18:19 wall-clock (not 15:18)', hour > 18.2 && hour < 18.4);
  A.ok('the MSK serial is +3h vs the naive UTC serial', Math.abs((mskSerial - utcSerial) - (3 / 24)) < 1e-9);
}
// TIMESTAMP CONTRACT (aligned with the canonical producer ms_time.instantOf): zoned → instant + one MSK offset;
// zone-less digits are Moscow wall-clock rendered literally (no offset); invalid → null. XLSX ≡ Telegram wall-clock.
{
  const { excelSerial } = require('../n8n/lib/xlsx_writer.js');
  const T = require('../n8n/lib/ms_time.js');
  const hhmm = ser => { const f = ser - Math.floor(ser); const m = Math.round(f * 24 * 60); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const z = excelSerial('2026-07-24T09:00:00Z');
  const off = excelSerial('2026-07-24T12:00:00+03:00');
  const naive = excelSerial('2026-07-24T12:00:00');
  A.ok('Z timestamp renders 12:00 MSK', hhmm(z) === '12:00');
  A.eq('the same instant with +03:00 gives an identical serial', off, z);
  A.eq('a timezone-naive value is Moscow wall-clock (no double shift → 12:00, not 15:00)', naive, z);
  A.eq('invalid input → null (never a wrong date)', excelSerial('not-a-date'), null);
  A.eq('empty input → null', excelSerial(''), null);
  // XLSX serial and the Telegram (ms_time) display agree on the user-facing MSK wall-clock for every form.
  ['2026-07-24T09:00:00Z', '2026-07-24T12:00:00+03:00', '2026-07-24T12:00:00'].forEach(v =>
    A.ok('XLSX ≡ Telegram MSK wall-clock for ' + v, T.toDisplay(v, {}).indexOf(hhmm(excelSerial(v))) >= 0));
}

A.section('REPORT-TRUTH-E · AI-claim guards (defects 8/9/10)');
{
  // defect 10: a market-gap opportunity from a 3-source sample is labelled a hypothesis.
  const b = bundle([synthAnalysis()]);
  const recs = RP.buildSheets(b).find(s => s.name === 'Рекомендации').rows.map(r => r.recommendation);
  A.ok('gap claim labelled a hypothesis', recs.some(r => /незанятая ниша/.test(r) && /гипотеза на основе выборки/.test(r)));
  // defect 9 (STRUCTURED fail-closed — NOT regex surgery): a property only ev_2 (source H1) cites, phrased «все три
  // источника …», keeps its ORIGINAL readable clause and gets a neutral appended disclaimer that names the ONE source
  // that actually supports it. We never mutate the Russian clause body, and never invent attribution.
  const comps = RP.buildSheets(b).find(s => s.name === 'Сравнение источников').rows.map(r => r.text);
  const claim = comps.find(t => /кредитной историей/.test(t));
  A.ok('the partial universal claim is present at all', !!claim);
  A.ok('original clause kept intact (no fragile rewriting)', /все три источника нацелены/i.test(claim));
  A.ok('neutral disclaimer appended', /Подтверждено не для всех участвовавших источников/.test(claim));
  A.ok('disclaimer names only the real supporting source (autolombard-moskva.ru), never invents', /autolombard-moskva\.ru/.test(claim) && !/zalog24h\.ru|autolombardn1\.ru/.test(claim.split('Подтверждено')[1] || ''));
  A.ok('no «часть источников» regex-substitution artefact', comps.every(t => !/часть источников/.test(t)));
  // defect 8: an AI limitation contradicting the deterministic accepted quality is dropped; the honest one stays.
  const r = AR.renderAnalysisSectionsRu([synthAnalysis()], { source_quality: [{ status: 'healthy' }] }, {});
  const unk = (r.sections || {}).unknowns || [];
  A.ok('quarantine-contradiction limitation dropped', unk.every(u => !/карантин/i.test(u)));
  A.ok('honest sample-size limitation kept', unk.some(u => /не весь рынок|выборк/i.test(u)));
}

// direct guard unit checks (general, not tied to the fixture)
A.section('REPORT-TRUTH-E · guards are conservative (no false positives)');
{
  A.eq('hypothesis guard leaves a normal claim alone', AR.arHypothesisGuard('Все предлагают займ под ПТС', 3), 'Все предлагают займ под ПТС');
  A.eq('hypothesis guard does not flag a large sample', AR.arHypothesisGuard('незанятая ниша', 10), 'незанятая ниша');
  A.eq('broadcast guard leaves a full-coverage claim alone', AR.arBroadcastGuard('Все три источника предлагают X', 3, 3), 'Все три источника предлагают X');
  A.eq('quality guard keeps limitations when nothing is healthy', AR.arQualityContradictionGuard(['Источники в карантине'], ['quarantined']).length, 1);
  // defect 10 parity: a small-sample market-gap claim is labelled a hypothesis in BOTH renderers.
  A.ok('XLSX labels a market-gap claim a hypothesis', /гипотеза на основе выборки/.test(AR.arHypothesisGuard('Рефинансирование — незанятая ниша', 3)));
  A.ok('Telegram labels a market-gap claim a hypothesis', /гипотеза на основе выборки/.test(CR.crHypothesisGuard('Рефинансирование — незанятая ниша', 3)));
  A.eq('Telegram does not flag a large sample', CR.crHypothesisGuard('незанятая ниша', 10), 'незанятая ниша');
}

// ============================================================================================================
// WF04→WF20 deterministic source accounting (execution_summary.sourceAccounting): reused / fresh / rejected /
// contributing COUNTS + identities derived from each adapter's TYPED execution_mode/outcome/status — NEVER from the
// external-call count. Proves data-mode, contributing, fresh and external-calls are four independent values.
A.section('REPORT-TRUTH-E · WF04→WF20 source accounting is deterministic + call-count-independent');
{
  const reuse = s => ({ source: s, execution_mode: 'reuse', source_outcome: 'reused_snapshot', external_calls: 0 });
  const fresh = (s, calls, items) => ({ source: s, execution_mode: 'collect', source_outcome: 'collected_with_data', outcome_has_data: true, items_written: items || 5, external_calls: calls });
  const rejFail = (s, calls) => ({ source: s, status: 'failed', external_calls: calls || 0 });
  const rejQuar = s => ({ source: s, quarantined: true, status: 'quarantined', external_calls: 0 });

  let a = ES.sourceAccounting([reuse('s1'), reuse('s2'), fresh('s3', 4, 12)]);
  A.eq('2 reused + 1 fresh: reused', a.sources_reused, 2);
  A.eq('2 reused + 1 fresh: fresh', a.sources_fresh, 1);
  A.eq('2 reused + 1 fresh: contributing (reused∪fresh)', a.sources_contributing, 3);
  A.eq('2 reused + 1 fresh: rejected', a.sources_rejected, 0);
  A.eq('2 reused + 1 fresh: fresh identity', a.fresh_sources.join(','), 's3');
  A.eq('2 reused + 1 fresh: reused identities', a.reused_source_keys.join(','), 's1,s2');

  a = ES.sourceAccounting([reuse('s1'), rejFail('s2', 2)]);
  A.eq('1 reused + 1 rejected: reused', a.sources_reused, 1);
  A.eq('1 reused + 1 rejected: rejected', a.sources_rejected, 1);
  A.eq('1 reused + 1 rejected: contributing excludes the rejected source', a.sources_contributing, 1);
  A.eq('1 reused + 1 rejected: a rejected source still counts its external calls', a.external_calls, 2);

  a = ES.sourceAccounting([fresh('s1', 7, 9)]);
  A.eq('one fresh source: fresh count is 1', a.sources_fresh, 1);
  A.eq('one fresh source: its 7 external calls do NOT inflate the fresh count', a.external_calls, 7);
  A.ok('fresh count and external-call count are independent', a.sources_fresh === 1 && a.external_calls === 7);

  a = ES.sourceAccounting([reuse('s1'), reuse('s2')]);
  A.eq('complete reuse: reused', a.sources_reused, 2);
  A.eq('complete reuse: fresh is 0', a.sources_fresh, 0);
  A.eq('complete reuse: zero external calls', a.external_calls, 0);

  a = ES.sourceAccounting([fresh('s1', 2), fresh('s2', 3), fresh('s3', 1)]);
  A.eq('all fresh: fresh', a.sources_fresh, 3);
  A.eq('all fresh: reused is 0', a.sources_reused, 0);
  A.eq('all fresh: external calls summed (2+3+1)', a.external_calls, 6);

  // synthesis→comparison downgrade BASIS: 2 fresh + 1 rejected ⇒ only 2 contributing (< 3) ⇒ the router downgrades.
  a = ES.sourceAccounting([fresh('s1', 2), fresh('s2', 2), rejQuar('s3')]);
  A.eq('downgrade basis: contributing drops to 2 when one source is rejected', a.sources_contributing, 2);
  A.eq('downgrade basis: the rejected source is named', a.rejected_sources.join(','), 's3');
}

// ============================================================================================================
// Source-aware quality-contradiction guard (defect 8) — deterministic per-source, fail-closed, dedup+precedence.
// Identical contract in the XLSX (arQualityContradictionGuard) and Telegram (crQualityContradictionGuard) renderers.
A.section('REPORT-TRUTH-E · quality guard is source-aware + fail-closed (XLSX ≡ Telegram)');
{
  const AGG = 'Источники были в карантине, данные не собраны';
  const NAMED_H = 'Источник zalog24h.ru недоступен, данные не собраны';
  const NAMED_Q = 'Источник autolombardn1.ru в карантине, данные не собраны';
  const HONEST = 'Выборка из трёх источников — не весь рынок';
  [['XLSX', AR.arQualityContradictionGuard], ['Telegram', CR.crQualityContradictionGuard]].forEach(([lbl, g]) => {
    A.eq(lbl + ': healthy+quarantined aggregate → KEEP', g([AGG], [{ id: 'zalog24h.ru', status: 'healthy' }, { id: 'autolombardn1.ru', status: 'quarantined' }]).length, 1);
    A.eq(lbl + ': all-healthy aggregate → DROP', g([AGG], [{ id: 'a.ru', status: 'healthy' }, { id: 'b.ru', status: 'accepted' }]).length, 0);
    A.eq(lbl + ': all-rejected aggregate → KEEP', g([AGG], [{ id: 'a.ru', status: 'quarantined' }, { id: 'b.ru', status: 'failed' }]).length, 1);
    A.eq(lbl + ': unknown state fails closed → KEEP', g([AGG], [{ id: 'a.ru', status: 'healthy' }, { id: 'b.ru', status: 'mystery' }]).length, 1);
    A.eq(lbl + ': conflicting same-source (healthy+quarantined) named → KEEP', g(['Источник a.ru в карантине, данные не собраны'], [{ id: 'a.ru', status: 'healthy' }, { id: 'a.ru', status: 'quarantined' }]).length, 1);
    A.eq(lbl + ': limitation naming one healthy source → DROP', g([NAMED_H], [{ id: 'zalog24h.ru', status: 'healthy' }, { id: 'autolombardn1.ru', status: 'quarantined' }]).length, 0);
    A.eq(lbl + ': limitation naming one quarantined source → KEEP', g([NAMED_Q], [{ id: 'zalog24h.ru', status: 'healthy' }, { id: 'autolombardn1.ru', status: 'quarantined' }]).length, 1);
    A.eq(lbl + ': honest sample-size limitation always kept', g([HONEST], [{ id: 'a.ru', status: 'healthy' }]).length, 1);
    A.eq(lbl + ': no deterministic state → keep everything', g([AGG], []).length, 1);
  });
}

// ============================================================================================================
// Structured fail-closed broadcast guard (defect 9): DETECT a universal quantifier; when cited evidence does not
// cover every contributing source, keep the ORIGINAL clause and APPEND a neutral disclaimer — never regex-rewrite the
// Russian. All mandated quantifier variants, idempotency, non-universal negatives. Identical XLSX/Telegram behaviour.
A.section('REPORT-TRUTH-E · broadcast guard: variants, idempotency, no false positives (XLSX ≡ Telegram)');
{
  const supp = ['autolombard-moskva.ru'];
  const universal = [
    ['все три источника', 'Все три источника нацелены на клиентов с любой кредитной историей.', 3],
    ['все игроки', 'Все игроки предлагают займ под ПТС.', 3],
    ['у всех конкурентов', 'У всех конкурентов есть онлайн-заявка.', 3],
    ['каждый конкурент', 'Каждый конкурент даёт скидку новым клиентам.', 3],
    ['оба источника', 'Оба источника берут комиссию.', 2],
    ['обе компании', 'Обе компании работают круглосуточно.', 2]
  ];
  const negatives = [
    ['non-universal single-source fact', 'Ставка от 2,4% годовых.', 3],
    ['temporal «каждый месяц»', 'Каждый месяц ставка пересматривается.', 3],
    ['bare «все» + verb', 'Все предлагают займ под ПТС.', 3]
  ];
  [['XLSX', AR.arBroadcastGuard], ['Telegram', CR.crBroadcastGuard]].forEach(([lbl, g]) => {
    universal.forEach(([name, text, total]) => {
      const out = g(text, 1, total, supp);
      A.ok(lbl + ': fires on «' + name + '» (clause kept + disclaimer appended)', out !== text && /Подтверждено не для всех участвовавших источников/.test(out) && out.indexOf(text.replace(/\.$/, '')) === 0);
      A.ok(lbl + ': «' + name + '» names the real supporting source only', /autolombard-moskva\.ru/.test(out));
      A.eq(lbl + ': «' + name + '» is idempotent', g(out, 1, total, supp), out);
    });
    negatives.forEach(([name, text, total]) => A.eq(lbl + ': does NOT fire on ' + name, g(text, 1, total, supp), text));
    A.eq(lbl + ': full-coverage claim untouched', g('Все три источника предлагают X.', 3, 3, supp), 'Все три источника предлагают X.');
    A.eq(lbl + ': below 2 sources «all» is meaningless → untouched', g('Все три источника предлагают X.', 1, 1, supp), 'Все три источника предлагают X.');
  });
  // XLSX and Telegram produce the SAME qualified text for the same input.
  const t = universal[0][1];
  A.eq('XLSX and Telegram disclaimer text is byte-identical', AR.arBroadcastGuard(t, 1, 3, supp), CR.crBroadcastGuard(t, 1, 3, supp));
}

A.report('report-integrity');
