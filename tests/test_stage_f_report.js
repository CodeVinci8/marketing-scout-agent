'use strict';
// Stage F §5/§6 — the report and XLSX surface evidence-bound analysis WITHOUT ever letting it displace or block
// the deterministic result. Covers the seven required report states (enriched / reused / disabled / no evidence /
// provider failure / failed repair / partial), the "no claim without an allowed evidence id" rule, the RU-only
// user-facing contract, and the populated-only Stage-F sheets. Offline, $0.
const A = require('./_assert.js');
const AR = require('../n8n/lib/analysis_report_ru.js');
const RP = require('../n8n/lib/report_package.js');
const XR = require('../n8n/lib/xlsx_writer.js');

const NOW = new Date().toISOString();
const SCOPE = { owner_user_id: 'o1', agent_request_id: 'req_1', report_id: 'rep_1' };
const BUNDLE = {
  report_id: 'rep_1', agent_request_id: 'req_1', owner_user_id: 'o1', created_at: NOW, niche: 'pts_loan', region: 'Москва/МО',
  summary: { competitors_found: 1, sources_checked: 1, quality_status: 'healthy' },
  competitors: [{ competitor: 'Автоломбард №1', positioning: 'Займы под ПТС', source_url: 'https://autolombardn1.ru/' }],
  offers: [{ competitor: 'Автоломбард №1', offer: 'Займ под ПТС', price_rate: 'от 3% в месяц', cta: 'Оставить заявку', collected_at: NOW, evidence_url: 'https://autolombardn1.ru/pts' }],
  evidence: [], recommendations: [], source_quality: [{ source: 'autolombardn1.ru', platform: 'website', status: 'healthy' }],
  changes: [], run_metadata: {}
};
function analysis(over) {
  return Object.assign({
    analysis_id: 'an_x', enriched: true, mode: 'call', quality_status: 'ok', fallback_used: false,
    source: { source_id: 'autolombardn1.ru', kind: 'website' },
    evidence_map: [{ id: 'ev_1', url: 'https://autolombardn1.ru/', type: 'website' }, { id: 'ev_2', url: 'https://autolombardn1.ru/pts', type: 'website' }],
    analysis: {
      executive_summary_ru: 'Сводка', overall_confidence: 80, unknowns_ru: ['Нет данных о сроках рассмотрения'], used_evidence_ids: ['ev_1', 'ev_2'],
      items: [
        { dimension: 'positioning', kind: 'fact', text_ru: 'Заявлен срок выдачи 30 минут', evidence_ids: ['ev_1'] },
        { dimension: 'prices_terms', kind: 'inference', text_ru: 'Ставка выше среднего по рынку', evidence_ids: ['ev_2'] },
        { dimension: 'pains', kind: 'inference', text_ru: 'Клиенты боятся потерять автомобиль', evidence_ids: ['ev_1'] },
        { dimension: 'objections', kind: 'fact', text_ru: 'Возражение о скрытых комиссиях', evidence_ids: ['ev_2'] }
      ],
      recommended_actions: [{ text_ru: 'Протестировать оффер без скрытых комиссий', priority: 'high', evidence_ids: ['ev_2'] }]
    }
  }, over || {});
}

A.section('§5 — facts / inferences / recommendations are separated and never conflated');
{
  const r = AR.renderAnalysisSectionsRu([analysis()], BUNDLE, {});
  A.ok('has the facts section', r.text.indexOf('Подтверждённые факты') >= 0);
  A.ok('has the inference section', r.text.indexOf('Аналитические выводы') >= 0);
  A.ok('has the recommendation section', r.text.indexOf('Рекомендации') >= 0);
  A.ok('has the evidence/limits section', r.text.indexOf('Доказательства и ограничения') >= 0);
  // deterministic facts are authoritative and appear in the facts section
  A.ok('deterministic offer is a fact', /Автоломбард №1: Займ под ПТС — от 3% в месяц/.test(r.text));
  A.ok('an inference is NOT in the facts section', r.text.split('Аналитические выводы')[0].indexOf('Ставка выше среднего') < 0);
  A.ok('inferences are explicitly labelled interpretation', /интерпретация собранных данных, а не факты/.test(r.text));
  A.ok('recommendations are explicitly labelled non-fact', /предложения к проверке, а не подтверждённые факты/.test(r.text));
  A.ok('a recommendation carries its priority in Russian', /приоритет: высокий/.test(r.text));
  A.eq('sections: 1 claude fact', r.sections.facts.length, 2);
  A.eq('sections: 2 inferences', r.sections.inferences.length, 2);
  A.eq('sections: 1 recommendation', r.sections.recommendations.length, 1);
}

A.section('§5 — NO claim without an allowed evidence id (the no-invention gate at render time)');
{
  const ghost = analysis();
  ghost.analysis.items.push({ dimension: 'offers', kind: 'inference', text_ru: 'ВЫДУМКА без доказательства', evidence_ids: ['ev_99'] });
  ghost.analysis.items.push({ dimension: 'risks', kind: 'fact', text_ru: 'ФАКТ без единой ссылки', evidence_ids: [] });
  ghost.analysis.recommended_actions.push({ text_ru: 'РЕКОМЕНДАЦИЯ без доказательства', priority: 'low', evidence_ids: [] });
  const r = AR.renderAnalysisSectionsRu([ghost], BUNDLE, {});
  A.ok('an item citing an UNKNOWN evidence id is dropped', r.text.indexOf('ВЫДУМКА') < 0, r.text);
  A.ok('an item citing NO evidence is dropped', r.text.indexOf('ФАКТ без единой ссылки') < 0);
  A.ok('a recommendation with no evidence is dropped', r.text.indexOf('РЕКОМЕНДАЦИЯ без доказательства') < 0);
  A.ok('the grounded claims survive', r.text.indexOf('Ставка выше среднего') >= 0);
  A.eq('dropped claims never reach the XLSX either', AR.analysisXlsxData([ghost], r).inferences.filter(i => /ВЫДУМКА/.test(i.text)).length, 0);
}

A.section('§5 — evidence markers resolve to real URLs; internal ids never surface');
{
  const r = AR.renderAnalysisSectionsRu([analysis()], BUNDLE, {});
  A.ok('claims carry a visible [n] marker', /Ставка выше среднего по рынку \[2\]/.test(r.text), r.text);
  A.ok('the evidence list maps [1] to a URL', /\[1\] https:\/\/autolombardn1\.ru\//.test(r.text));
  A.ok('the evidence list maps [2] to a URL', /\[2\] https:\/\/autolombardn1\.ru\/pts/.test(r.text));
  A.ok('internal ev_N ids NEVER reach the user', r.text.indexOf('ev_1') < 0 && r.text.indexOf('ev_2') < 0, r.text);
  A.ok('unknowns are surfaced honestly', r.text.indexOf('Нет данных о сроках рассмотрения') >= 0);
  A.eq('one shared numbering across the run', r.evidence_list.length, 2);
  // two analyses citing the SAME url share one marker number
  const two = [analysis(), analysis({ analysis_id: 'an_y', source: { source_id: 'finardi.ru', kind: 'website' },
    evidence_map: [{ id: 'ev_1', url: 'https://autolombardn1.ru/', type: 'website' }] })];
  A.eq('the same URL is numbered once across analyses', AR.renderAnalysisSectionsRu(two, BUNDLE, {}).evidence_list.length, 2);
}

A.section('§5 — user-facing text leaks nothing internal');
{
  const r = AR.renderAnalysisSectionsRu([analysis()], BUNDLE, {});
  const t = r.text;
  A.ok('no JSON braces', t.indexOf('{') < 0 && t.indexOf('"items"') < 0);
  A.ok('no tool name', t.indexOf('submit_analysis') < 0 && t.indexOf('tool_use') < 0);
  A.ok('no English enum labels', !/\b(positioning|prices_terms|inference|recommendation|fact)\b/.test(t), t);
  A.ok('no analysis_id / policy id', t.indexOf('an_x') < 0);
  A.ok('no provider/thinking leakage', !/aiprimetech|thinking|claude|anthropic|compact/i.test(t), t);
  A.ok('no schema/prompt version', t.indexOf('stageF') < 0);
  A.ok('dimensions render in Russian on the XLSX side', AR.arDimensionRu('prices_terms') === 'цены и условия');
  A.ok('an UNKNOWN dimension falls back to a Russian label, never the raw id', AR.arDimensionRu('some_new_enum') === 'наблюдение');
  A.ok('an UNKNOWN priority falls back to Russian', AR.arPriorityRu('urgent') === 'средний');
}

A.section('§5 — the seven report states: the deterministic report ALWAYS ships');
{
  const det = 'ОТЧЁТ: 1 конкурент.';
  // 1. enriched
  const enr = AR.renderAnalysisSectionsRu([analysis()], BUNDLE, {});
  A.ok('enriched: sections appended to the deterministic report', AR.appendAnalysisToReportRu(det, enr).indexOf(det) === 0);
  A.ok('enriched: analysis follows the deterministic text', AR.appendAnalysisToReportRu(det, enr).indexOf('Аналитические выводы') > 0);
  A.eq('enriched: has content', enr.has_content, true);
  A.eq('enriched: no degradation note', enr.note, '');
  // 2. reused — identical content, $0, indistinguishable to the reader
  const reused = AR.renderAnalysisSectionsRu([analysis({ mode: 'reuse' })], BUNDLE, {});
  A.eq('reused: renders exactly like a fresh analysis', reused.text, enr.text);
  // 3. disabled — no analyses at all
  const dis = AR.renderAnalysisSectionsRu([], BUNDLE, {});
  A.eq('disabled: deterministic report ships UNCHANGED', AR.appendAnalysisToReportRu(det, dis), det);
  A.eq('disabled: no note invented', dis.note, '');
  A.ok('disabled: deterministic facts still available', dis.sections.deterministic_facts.length > 0);
  // 4. no evidence -> WF28 fallback
  const noEv = AR.renderAnalysisSectionsRu([analysis({ enriched: false, fallback_used: true, quality_status: 'deterministic_fallback', error_category: 'no_evidence' })], BUNDLE, {});
  A.eq('no evidence: nothing analytical is rendered', noEv.sections.inferences.length, 0);
  A.ok('no evidence: honest note, no provider detail', /AI-анализ в этот раз не удалось выполнить/.test(noEv.note));
  A.ok('no evidence: note never names the reason code', noEv.note.indexOf('no_evidence') < 0);
  // REPORT-DEDUP-001: the deterministic report already lists the facts — we append the note ONLY, never a
  // duplicate facts section.
  A.eq('no evidence: only the honest note is appended', AR.appendAnalysisToReportRu(det, noEv), det + '\n\n' + noEv.note);
  A.eq('no evidence: facts are not duplicated', noEv.text.indexOf('Подтверждённые факты'), -1);
  // 5. provider failure
  const fail = AR.renderAnalysisSectionsRu([analysis({ enriched: false, fallback_used: true, quality_status: 'deterministic_fallback', error_category: 'server_error' })], BUNDLE, {});
  A.ok('provider failure: user sees an honest note only', /не удалось выполнить/.test(fail.note));
  A.ok('provider failure: never leaks the category', fail.text.indexOf('server_error') < 0);
  A.eq('provider failure: no ungrounded narrative', fail.sections.inferences.length, 0);
  A.eq('provider failure: deterministic report + note only', AR.appendAnalysisToReportRu(det, fail), det + '\n\n' + fail.note);
  // 6. failed repair -> fallback
  const rep = AR.renderAnalysisSectionsRu([analysis({ enriched: false, fallback_used: true, repair_used: true, repair_success: false, quality_status: 'deterministic_fallback' })], BUNDLE, {});
  A.eq('failed repair: contributes no narrative', rep.sections.inferences.length, 0);
  A.ok('failed repair: deterministic report intact', AR.appendAnalysisToReportRu(det, rep).indexOf(det) === 0);
  A.eq('failed repair: no Stage-F sections invented', rep.has_content, false);
  // 7. partial — one source enriched, one degraded
  const part = AR.renderAnalysisSectionsRu([analysis(), analysis({ analysis_id: 'an_z', enriched: false, fallback_used: true, quality_status: 'deterministic_fallback', source: { source_id: 'finardi.ru', kind: 'website' } })], BUNDLE, {});
  A.ok('partial: the good analysis still renders', part.text.indexOf('Ставка выше среднего') >= 0);
  A.ok('partial: honest partial note', /Часть источников осталась без AI-анализа/.test(part.note));
  A.eq('partial: only grounded inferences kept', part.sections.inferences.length, 2);
  A.eq('partial: stats count the degraded source', part.stats.degraded, 1);
}

A.section('§6 — XLSX: Stage-F sheets appear ONLY when populated; deterministic workbook still ships');
{
  const det = RP.buildReportPackage(BUNDLE, SCOPE, { omit_empty: true });
  A.ok('deterministic-only run has NO Stage-F sheets', det.sheet_names.indexOf('Аналитические выводы') < 0 && det.sheet_names.indexOf('Боли и сигналы') < 0);
  A.ok('deterministic-only run keeps Сводка', det.sheet_names.indexOf('Сводка') >= 0);
  A.ok('deterministic-only run keeps the hidden technical sheet', det.sheet_names.indexOf('Технические данные') >= 0);
  A.ok('deterministic XLSX still ships when Claude fails', det.size_bytes > 0);

  const r = AR.renderAnalysisSectionsRu([analysis()], BUNDLE, {});
  const withAn = Object.assign({}, BUNDLE, { analysis: Object.assign({}, AR.analysisXlsxData([analysis()], r), { analysis_ids: ['an_x'], count_enriched: 1, count_reused: 0, count_fallback: 0, analysis_cost_usd: 0.084, model: 'claude-sonnet-4-6' }) });
  const p = RP.buildReportPackage(withAn, SCOPE, { omit_empty: true });
  ['Сводка', 'Конкуренты', 'Офферы и цены', 'Аналитические выводы', 'Рекомендации', 'Боли и сигналы', 'Доказательства', 'Качество данных', 'Технические данные']
    .forEach(s => A.ok('sheet present: ' + s, p.sheet_names.indexOf(s) >= 0));
  A.eq('inferences sheet is populated', p.row_counts['Аналитические выводы'], 2);
  A.eq('recommendations sheet is populated', p.row_counts['Рекомендации'], 1);
  A.eq('pains sheet draws from pain/objection dimensions', p.row_counts['Боли и сигналы'], 2);
  A.eq('evidence sheet is populated (deterministic bundle ships evidence:[])', p.row_counts['Доказательства'], 2);
  A.eq('preserved: Сводка', p.row_counts['Сводка'], 1);
  A.eq('preserved: Конкуренты', p.row_counts['Конкуренты'], 1);
  A.eq('preserved: Офферы и цены', p.row_counts['Офферы и цены'], 1);

  // §6 — counts agree between report, bundle and workbook.
  A.eq('report inference count == workbook inference rows', r.sections.inferences.length, p.row_counts['Аналитические выводы']);
  A.eq('report evidence count == workbook evidence rows', r.evidence_list.length, p.row_counts['Доказательства']);
  A.eq('report recommendation count == workbook recommendation rows', r.sections.recommendations.length, p.row_counts['Рекомендации']);
}

A.section('§6 — real OOXML: Russian headers, hidden technical sheet, clickable evidence, no raw JSON/telemetry');
{
  const r = AR.renderAnalysisSectionsRu([analysis()], BUNDLE, {});
  const withAn = Object.assign({}, BUNDLE, { analysis: Object.assign({}, AR.analysisXlsxData([analysis()], r), { analysis_ids: ['an_x'], count_enriched: 1, count_reused: 0, count_fallback: 0, analysis_cost_usd: 0.084, model: 'claude-sonnet-4-6' }) });
  const p = RP.buildReportPackage(withAn, SCOPE, { omit_empty: true });
  A.ok('workbook is a real zip/OOXML container', p.buffer.slice(0, 2).toString() === 'PK');
  // Inspect the REAL inflated OOXML parts, not the compressed bytes.
  const zipParts = XR.readZip(p.buffer);
  const partNames = Object.keys(zipParts);
  A.ok('has the workbook part', partNames.indexOf('xl/workbook.xml') >= 0, partNames.join(','));
  const wbXml = zipParts['xl/workbook.xml'].toString('utf8');
  A.ok('workbook declares the hidden technical sheet', /state="hidden"/.test(wbXml), wbXml);
  A.ok('every Stage-F sheet is registered in the workbook part', /Аналитические выводы/.test(wbXml) && /Боли и сигналы/.test(wbXml));
  A.ok('clickable evidence: a hyperlink relationship part exists', partNames.some(n => /_rels\/sheet\d+\.xml\.rels/.test(n)), partNames.join(','));
  const relsName = partNames.find(n => /_rels\/sheet\d+\.xml\.rels/.test(n));
  A.ok('the hyperlink targets a real evidence URL', /autolombardn1\.ru/.test(zipParts[relsName].toString('utf8')));
  // This writer emits INLINE strings (no sharedStrings part), so cell text lives in the sheet XML itself.
  const sheetXml = partNames.filter(n => /xl\/worksheets\/sheet\d+\.xml$/.test(n)).map(n => zipParts[n].toString('utf8')).join('');
  A.ok('Russian headers really are in the workbook cells', /Вывод \(интерпретация, не факт\)/.test(sheetXml));
  A.ok('the evidence URL is a real cell value', /autolombardn1\.ru/.test(sheetXml));
  A.ok('no raw JSON leaked into the workbook cells', sheetXml.indexOf('evidence_ids') < 0 && sheetXml.indexOf('structured_result_json') < 0);
  A.ok('no provider/thinking leaked into the workbook cells', !/aiprimetech|thinking/i.test(sheetXml));
  A.ok('no English enum value leaked into a user-facing cell', sheetXml.indexOf('prices_terms') < 0 && sheetXml.indexOf('>inference<') < 0);
  // headers/strings live in sharedStrings (deflated) — assert via the sheet spec instead.
  const sheets = RP.buildSheets(withAn);
  const byName = {}; sheets.forEach(s => byName[s.name] = s);
  A.ok('Аналитические выводы headers are Russian', byName['Аналитические выводы'].columns.every(c => /[А-Яа-яЁё]/.test(c.header)));
  A.ok('Боли и сигналы headers are Russian', byName['Боли и сигналы'].columns.every(c => /[А-Яа-яЁё]/.test(c.header)));
  A.ok('Доказательства headers are Russian', byName['Доказательства'].columns.filter(c => c.key !== 'url').every(c => /[А-Яа-яЁё]/.test(c.header)));
  A.ok('Конкуренты headers are Russian', byName['Конкуренты'].columns.every(c => /[А-Яа-яЁё]/.test(c.header)));
  A.ok('evidence URL column is a clickable url type', byName['Доказательства'].columns.some(c => c.key === 'url' && c.type === 'url'));
  A.ok('every sheet freezes its header row', sheets.every(s => s.freeze_header !== false));
  A.ok('list sheets have filters', byName['Аналитические выводы'].autofilter === true && byName['Боли и сигналы'].autofilter === true);
  A.ok('every column has a sensible width', sheets.every(s => s.columns.every(c => Number(c.width) >= 8)));
  A.ok('the technical sheet is hidden', byName['Технические данные'].hidden === true);
  // §6: analysis_id + telemetry ONLY in the hidden technical sheet.
  const userSheets = sheets.filter(s => !s.hidden);
  const userJson = JSON.stringify(userSheets.map(s => s.rows));
  A.ok('no analysis_id in any user-facing sheet', userJson.indexOf('an_x') < 0);
  A.ok('no AI cost telemetry in any user-facing sheet', userJson.indexOf('0.084') < 0);
  A.ok('no model name in any user-facing sheet', userJson.indexOf('claude-sonnet-4-6') < 0);
  A.ok('no raw JSON blob in any user-facing sheet', userJson.indexOf('structured_result_json') < 0 && userJson.indexOf('evidence_ids') < 0);
  const tech = JSON.stringify(byName['Технические данные'].rows);
  A.ok('the hidden sheet DOES carry the analysis lineage', tech.indexOf('an_x') >= 0);
  A.ok('the hidden sheet DOES carry the AI cost', tech.indexOf('0.084') >= 0);
}

// WIP2b WIRING: the «Роль источника» sheet states role / relationship / direct_competitor / confidence /
// limitations from precomputed b.source_roles — and is omit-empty when the run classified nothing.
A.section('WIP2b wiring — «Роль источника» sheet is rendered from b.source_roles');
{
  const str = v => (v == null ? '' : String(v));
  const withRoles = Object.assign({}, BUNDLE, { source_roles: [
    { source_id: 't.me/probonds', source_url: 'https://t.me/probonds', source_type: 'telegram', source_role: 'news_source', role_confidence: 0.7, role_reason: 'Новостные публикации о рынке.', direct_competitor: false, evidence_ids: ['ev_1'], relationship_to_niche: 'публичный источник по теме ниши', limitations: ['Новостной источник, не прямой конкурент.'] }
  ] });
  const sheets = RP.buildSheets(withRoles);
  const roleSheet = sheets.find(s => s.name === 'Роль источника');
  A.ok('«Роль источника» sheet exists when roles present', !!roleSheet && (roleSheet.rows || []).length === 1);
  const r0 = roleSheet.rows[0];
  A.eq('role label in Russian', r0.role, 'новостной источник');
  A.eq('direct competitor = нет', r0.direct, 'нет');
  A.ok('states relationship to niche', str(r0.relation).length > 0);
  A.ok('carries limitations', str(r0.limitations).length > 0);
  // omit-empty: no source_roles -> sheet dropped from the downloadable package
  const pkg = RP.buildReportPackage(BUNDLE, { owner_user_id: 'o1', agent_request_id: 'req_1', report_id: 'rep_1' }, { omit_empty: true });
  A.ok('«Роль источника» omitted when empty', pkg.sheet_names.indexOf('Роль источника') < 0);
}

// WIP3-D/F WIRING: report_package must APPLY the ownership-safe + damaged-fragment guards, not just carry the lib.
A.section('WIP3-D/F wiring — recommendations are ownership-safe and damaged offers are marked');
{
  const str = v => (v == null ? '' : String(v));
  const b = Object.assign({}, BUNDLE, {
    recommendations: [{ recommendation: 'Разместить в канале t.me/banksta контент о снижении ставок', linked_finding_ids: 'ev_1', priority: 'high' }],
    offers: [{ competitor: 'X', offer: 'Ставка пониженна', price_rate: 'пониженна', collected_at: NOW, evidence_url: 'https://x.ru' }]
  });
  const sheets = RP.buildSheets(b);
  const rec = sheets.find(s => s.name === 'Рекомендации');
  const recText = (rec.rows || []).map(r => str(r.recommendation)).join(' | ');
  A.ok('third-party publish reframed to own channel', /Подготовить для собственного канала/.test(recText));
  A.ok('no «Разместить в канале t.me/banksta»', recText.indexOf('Разместить в канале t.me/banksta') < 0);
  const off = sheets.find(s => s.name === 'Офферы и цены');
  const offText = (off.rows || []).map(r => str(r.offer) + ' ' + str(r.price_rate)).join(' | ');
  A.ok('damaged offer/rate marked, not presented as fact', /повреждены|требует проверки/.test(offText));
  A.ok('the raw «пониженна» fragment is not a confirmed rate', !/^пониженна$/.test(str((off.rows[0] || {}).price_rate)));
}

// WIP3-B: the visible «Доказательства» sheet has ONE canonical row per evidence_id / normalized URL — never the
// same post as both a raw social_post and a numbered analyst row.
A.section('WIP3-B — evidence deduplication (one canonical row per evidence_id/URL)');
{
  const bundleEv = [
    { evidence_id: 'ev_1', competitor: 'rusmicrofinance', url: 'https://t.me/rusmicrofinance/6176', excerpt: 'Полная дословная цитата поста про рынок МФО', published_at: '2026-07-07' },
    { evidence_id: 'ev_2', competitor: 'rusmicrofinance', url: 'https://t.me/rusmicrofinance/6179', excerpt: 'Второй пост', published_at: '2026-07-08' }
  ];
  const analysisEv = [
    { ref: '[1]', fact_type: 'positioning', source: 'rusmicrofinance', excerpt: 'цитата', url: 'https://t.me/rusmicrofinance/6176', quality: 'ok', collected_at: '2026-07-07', evidence_id: 'ev_1' },
    { ref: '[3]', fact_type: 'risks', source: 'rusmicrofinance', excerpt: 'третий', url: 'https://t.me/rusmicrofinance/6181', quality: 'ok', collected_at: '2026-07-09', evidence_id: 'ev_3' }
  ];
  const rows = RP.rpDedupeEvidence(bundleEv, analysisEv);
  const urls = rows.map(r => RP.rpNormUrl(r.url));
  A.eq('no duplicate rows for the same URL', new Set(urls).size, urls.length);
  A.eq('canonical row count = distinct evidence (6176,6179,6181)', rows.length, 3);
  const r6176 = rows.find(r => /6176/.test(r.url));
  A.eq('shared post keeps the analyst ref [1]', r6176.ref, '[1]');
  A.ok('shared post keeps the strongest excerpt', r6176.excerpt.length >= 'цитата'.length);
  A.ok('bundle-only URL (6179) is present', rows.some(r => /6179/.test(r.url)));
  A.ok('analyst-only URL (6181) is present', rows.some(r => /6181/.test(r.url)));
  // trailing-slash / query variants normalize to one key
  const variants = RP.rpDedupeEvidence(
    [{ evidence_id: '', url: 'https://t.me/x/1/', excerpt: 'a' }],
    [{ ref: '[1]', url: 'https://t.me/x/1?utm=1', excerpt: 'aaaa', fact_type: 'x' }]);
  A.eq('url variants (slash/query) dedupe to one row', variants.length, 1);
}

A.report('stage-f-report');
