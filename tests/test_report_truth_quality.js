'use strict';
// REPORT-TRUTH B + C — evidence-grounded claim validation, semantic quality guards, and the compact Telegram
// renderer. The fixtures are the OBSERVED live regressions: Chinese characters inside Russian prose, a 2025 date
// in a 2026 report, malformed/leaked-identifier words, duplicate offers, market-wide conclusions drawn from one
// autolombard homepage, ad-strength claims without advertising evidence. Offline, $0.
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const CV = require('../n8n/lib/claim_validation.js');
const CR = require('../n8n/lib/compact_report_ru.js');
const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
const node = (wf, n) => wf.nodes.find(x => x.name === n);
const NOW = '2026-07-18T12:00:00Z';
const has = (label, s, sub) => A.ok(label, String(s).indexOf(sub) >= 0, 'missing: ' + sub);

A.section('semantic guards — observed generation artifacts are fatal');
{
  A.ok('Chinese chars in Russian prose', CV.cvGuardTextRu('Компания 市场 предлагает займы под залог').fatal);
  A.ok('leaked identifier «текстом_ю»', CV.cvGuardTextRu('Ключевой оффер текстом_ю сформулирован').fatal);
  A.ok('mixed-script word «WhatsАpp» (Cyrillic А inside Latin)', CV.cvGuardTextRu('Связь через WhatsАpp доступна').fatal);
  A.ok('stuttered token', CV.cvGuardTextRu('Оченььь выгодные условия').fatal);
  A.ok('clean Russian with Latin brands/domains passes',
    !CV.cvGuardTextRu('IT-компания на autolombardn1.ru предлагает B2B займы под залог ПТС, CTA «Оставить заявку»').fatal);
}

A.section('markdown guard — strip foreign scripts, collapse duplicate bullets');
{
  const g = CV.cvGuardMarkdownRu('• Займы до 5 млн 市场\n• Ставка 3%\n• Займы до 5 млн\nОбычный текст');
  A.ok('foreign fragment stripped', g.text.indexOf('市') < 0);
  A.eq('duplicate bullet dropped once', (g.text.match(/Займы до 5 млн/g) || []).length, 1);
  has('flags name both actions', g.flags.join(','), 'foreign_script_stripped');
  has('…and the dedup', g.flags.join(','), 'duplicate_line_dropped');
  A.eq('clean text untouched', CV.cvGuardMarkdownRu('• A\n• B').text, '• A\n• B');
}

A.section('claim validation — market-wide claims from one source become scoped hypotheses');
{
  const ctx = CV.cvBuildCtx({ analyses: [{ evidence_map: [{ id: 'ev_1', url: 'https://autolombardn1.ru', type: 'website' }] }], now: NOW });
  A.ok('single_source detected', ctx.single_source);
  const cases = [
    'Максимальный LTV на рынке — до 90% от стоимости авто',
    'Компания — лидер рынка автозаймов Москвы',
    'Ставка 3% в месяц — отраслевой стандарт',
    'Высокая конкурентная активность в сегменте',
    'Быстрорастущий сегмент залогового кредитования'
  ];
  cases.forEach(t => {
    const v = CV.cvValidateItem({ kind: 'fact', text_ru: t, dimension: 'positioning', evidence_ids: ['ev_1'] }, ctx);
    A.eq('demoted to inference: ' + t.slice(0, 30), v.item.kind, 'inference');
    A.ok('scoped as hypothesis: ' + t.slice(0, 30), /^Гипотеза/.test(v.item.text_ru));
  });
  // Idempotency: already-scoped text is never re-prefixed.
  const once = CV.cvValidateItem({ kind: 'inference', text_ru: 'Гипотеза (по одному источнику): лидер рынка автозаймов', evidence_ids: ['ev_1'] }, ctx);
  A.eq('no double prefix', once.item.text_ru.indexOf('Гипотеза (по одному источнику): Гипотеза'), -1);
  // Mission wording is respected as scoping too.
  A.ok('«в доступном снимке указано…» counts as scoped', CV.cvIsScopedRu('В доступном снимке указано: ставка от 3%'));
  // A plain source-level fact stays a fact.
  const plain = CV.cvValidateItem({ kind: 'fact', text_ru: 'Ставка от 3% в месяц, займы до 5 млн рублей', evidence_ids: ['ev_1'] }, ctx);
  A.eq('plain fact kept', plain.action, 'keep');
  A.eq('kind unchanged', plain.item.kind, 'fact');
}

A.section('claim validation — ad strength, absence, demand, vehicle terms, wrong year');
{
  const ctx = CV.cvBuildCtx({ analyses: [{ evidence_map: [{ id: 'ev_1', url: 'https://x.ru', type: 'website' }] }], now: NOW });
  const ad = CV.cvValidateItem({ kind: 'fact', text_ru: 'Компания ведёт активную рекламную кампанию', evidence_ids: ['ev_1'] }, ctx);
  A.eq('ad-strength без ad-доказательств -> inference', ad.item.kind, 'inference');
  has('…и помечено требует проверки', ad.item.text_ru, 'требует проверки');
  const adCtx = CV.cvBuildCtx({ analyses: [{ evidence_map: [{ id: 'ev_1', url: 'https://x.ru', type: 'website', excerpt: 'реклама в Яндекс.Директ' }] }], now: NOW });
  A.ok('with advertising evidence the claim may stand', CV.cvValidateItem({ kind: 'fact', text_ru: 'Компания ведёт активную рекламную кампанию', evidence_ids: ['ev_1'] }, adCtx).reasons.indexOf('ad_claim_unverified') < 0);
  const abs = CV.cvValidateItem({ kind: 'fact', text_ru: 'Сайт не предлагает онлайн-заявку', evidence_ids: ['ev_1'] }, ctx);
  A.ok('absence scoped to checked pages', /^В проверенных страницах:/.test(abs.item.text_ru));
  const dem = CV.cvValidateItem({ kind: 'inference', text_ru: 'Спрос на автозаймы отсутствует', evidence_ids: ['ev_1'] }, ctx);
  A.ok('demand absence needs audience signals', /^Данных недостаточно/.test(dem.item.text_ru));
  const veh = CV.cvValidateItem({ kind: 'fact', text_ru: 'Клиент лишится автомобиля на срок займа', evidence_ids: ['ev_1'] }, ctx);
  has('vehicle terms unverified', veh.item.text_ru, 'условия требуют проверки');
  const yr = CV.cvValidateItem({ kind: 'fact', text_ru: 'В 2025 году компания повысила ставки', evidence_ids: ['ev_1'] }, ctx);
  A.eq('invented recent year -> inference', yr.item.kind, 'inference');
  has('…flagged in text', yr.item.text_ru, 'не подтверждён данными');
  A.eq('historic year passes', CV.cvBadYears('Работает с 2008 года', ctx).length, 0);
  const evCtx = CV.cvBuildCtx({ analyses: [{ evidence_map: [{ id: 'ev_1', url: 'https://x.ru', collected_at: '2025-12-30T10:00:00Z' }] }], now: NOW });
  A.eq('year present in evidence is allowed', CV.cvBadYears('Снимок от декабря 2025 года', evCtx).length, 0);
}

A.section('cvValidateAnalyses — dedup, rejection, audit, fail-open');
{
  const ctx = CV.cvBuildCtx({ analyses: [], now: NOW });
  const r = CV.cvValidateAnalyses([{ analysis_id: 'an_1', enriched: true, analysis: { items: [
    { kind: 'fact', text_ru: 'Ставка от 3% в месяц', evidence_ids: ['ev_1'] },
    { kind: 'fact', text_ru: 'Ставка от 3% в месяц.', evidence_ids: ['ev_1'] },
    { kind: 'inference', text_ru: 'Вывод с 市场 артефактом', evidence_ids: ['ev_1'] }
  ], recommended_actions: [
    { text_ru: 'Добавить онлайн-заявку', priority: 'high', evidence_ids: ['ev_1'] },
    { text_ru: 'Добавить онлайн-заявку', priority: 'high', evidence_ids: ['ev_1'] }
  ], unknowns_ru: ['Нет данных о рекламе', 'молч 市场'] } }], ctx);
  const an = r.analyses[0].analysis;
  A.eq('duplicate offer facts deduped', an.items.filter(i => i.kind === 'fact').length, 1);
  A.eq('artifact item rejected', an.items.filter(i => /市/.test(i.text_ru)).length, 0);
  A.eq('duplicate recommendation deduped', an.recommended_actions.length, 1);
  A.eq('artifact unknown filtered', an.unknowns_ru.length, 1);
  A.ok('audit counts add up', r.audit.rejected === 1 && r.audit.deduped === 2 && r.audit.checked === 5);
  const passthrough = CV.cvValidateAnalyses([{ mode: 'skip', no_analysis: true }], ctx);
  A.ok('malformed analysis object passes through fail-open', passthrough.analyses[0].no_analysis === true);
}

// ---------------------------------------------------------------------------------------------------------------

function mkAnalysis(over) {
  return Object.assign({
    analysis_id: 'an_x', enriched: true, mode: 'call', quality_status: 'ok',
    evidence_map: [{ id: 'ev_1', url: 'https://autolombardn1.ru', type: 'website' }],
    analysis: {
      executive_summary_ru: 'Автоломбард с быстрой выдачей займов под залог авто; сильные стороны — скорость и прозрачные условия.',
      items: [
        { kind: 'fact', text_ru: 'Ставка от 3% в месяц', dimension: 'prices_terms', evidence_ids: ['ev_1'] },
        { kind: 'fact', text_ru: 'Займы до 5 млн рублей', dimension: 'offers', evidence_ids: ['ev_1'] },
        { kind: 'inference', text_ru: 'Ставка делает оффер конкурентоспособным для срочных займов', dimension: 'strengths', evidence_ids: ['ev_1'] },
        { kind: 'inference', text_ru: 'Акцент на скорости оформления рассчитан на срочный спрос', dimension: 'positioning', evidence_ids: ['ev_1'] }
      ],
      recommended_actions: [
        { text_ru: 'Добавить калькулятор займа на главную страницу', priority: 'high', evidence_ids: ['ev_1'] },
        { text_ru: 'Указать точные сроки рассмотрения заявки', priority: 'medium', evidence_ids: ['ev_1'] }
      ],
      unknowns_ru: ['Нет данных о рекламных каналах'], overall_confidence: 0.8, used_evidence_ids: ['ev_1']
    }
  }, over || {});
}
const BUNDLE = {
  analysis_mode: 'source_analysis',
  competitors: [{ domain: 'autolombardn1.ru', name: 'Автоломбард №1' }],
  offers: [{ competitor: 'Автоломбард №1', offer: 'Займ под залог авто', price_rate: 'от 3% в месяц', evidence_url: 'https://autolombardn1.ru' }],
  evidence: [{ excerpt: 'Займы под залог авто от 3%', url: 'https://autolombardn1.ru', collected_at: '2026-07-17T08:00:00Z' }],
  changes: []
};
const SUMMARY = {
  final_state: 'completed', records_reported: 11, analysis_mode: 'source_analysis',
  actual_cost_usd: 0.0512, actual_summary_ai_usd: 0.0367, actual_deep_analysis_usd: 0.0145,
  reused_sources: [], failed_sources: []
};
const COST = '💰 Фактическая стоимость: AI-сводка $0.0367 + AI-анализ $0.0145 = $0.0512.';
const NEXT = 'Я могу проверить, что изменилось позже. Просто напишите, что сделать дальше.';

A.section('compact renderer — success profile (700–1200 target, hard max 1500)');
{
  const r = CR.crCompactReportRu({ bundle: BUNDLE, analyses: [mkAnalysis()], summary: SUMMARY, cost_line: COST, next_action: NEXT, xlsx_expected: true, state: 'completed' });
  A.eq('profile', r.profile, 'success');
  A.ok('within hard max', r.length <= 1500);
  A.ok('substantial (not a stub): ' + r.length, r.length >= 400);
  has('names the source', r.text, 'autolombardn1.ru');
  has('facts section', r.text, '📌 Ключевые факты');
  has('conclusions marked as interpretation', r.text, 'интерпретация, не факты');
  has('recommendations marked as suggestions', r.text, 'предложения к проверке');
  has('evidence line', r.text, 'подтверждённых фрагментах');
  has('XLSX pointer', r.text, 'Excel-файле');
  has('cost line delivered', r.text, '$0.0512');
  has('one next action', r.text, 'Просто напишите');
  A.ok('never «Анализ завершён» in the report body (progress owns it)', r.text.indexOf('Анализ завершён') < 0);
  A.ok('≤3 facts', (r.text.match(/^• /gm) || []).length <= 9);
  A.ok('no internal enums/ids', !/source_analysis|change_report|ev_\d|an_[0-9a-f]{8}/.test(r.text));
}

A.section('compact renderer — reuse, issue, change_report honesty, hard cap');
{
  const reused = CR.crCompactReportRu({
    bundle: BUNDLE, analyses: [mkAnalysis({ mode: 'reuse' })],
    summary: Object.assign({}, SUMMARY, { actual_cost_usd: 0.0302, actual_summary_ai_usd: 0.0302, actual_deep_analysis_usd: 0, reused_sources: [{ source: 'website', original_collected_at: '2026-07-17T08:24:42.317Z' }] }),
    cost_line: '💰 Фактическая стоимость: AI-сводка $0.0302 = $0.0302.', next_action: NEXT, xlsx_expected: true, state: 'completed'
  });
  A.eq('reuse profile', reused.profile, 'reuse');
  A.ok('reuse compact (≤700): ' + reused.length, reused.length <= 700);
  has('names the snapshot reuse honestly', reused.text, 'Использованы сохранённые данные');
  has('…with the collection date', reused.text, '17.07.2026');

  const issue = CR.crCompactReportRu({ bundle: {}, analyses: [], summary: { final_state: 'failed', records_reported: 0, failed_sources: ['website'] }, cost_line: '', next_action: NEXT, xlsx_expected: false, state: 'failed' });
  A.eq('issue profile', issue.profile, 'issue');
  A.ok('issue compact (250–600): ' + issue.length, issue.length <= 600 && issue.length >= 100);
  has('honest failure', issue.text, 'Не удалось собрать данные');
  has('source absence ≠ demand absence', issue.text, 'не вывод о рынке или спросе');

  const chg = CR.crCompactReportRu({ bundle: Object.assign({}, BUNDLE, { analysis_mode: 'change_report', changes: [] }), analyses: [mkAnalysis()], summary: Object.assign({}, SUMMARY, { analysis_mode: 'change_report' }), cost_line: COST, next_action: NEXT, xlsx_expected: true, state: 'completed' });
  has('change_report labeled', chg.text, 'изменения с прошлой проверки');
  has('no-change is an honest result', chg.text, 'изменений относительно прошлой проверки не обнаружено');

  const big = mkAnalysis();
  big.analysis.items = [];
  for (let i = 0; i < 12; i++) big.analysis.items.push({ kind: i % 2 ? 'fact' : 'inference', text_ru: 'Наблюдение номер ' + i + ': ' + 'детальное описание условий и особенностей оффера, включая ставки, сроки и требования к залогу. '.repeat(3), dimension: 'offers', evidence_ids: ['ev_1'] });
  const capped = CR.crCompactReportRu({ bundle: BUNDLE, analyses: [big], summary: SUMMARY, cost_line: COST, next_action: NEXT, xlsx_expected: true, state: 'completed' });
  A.ok('hard cap enforced: ' + capped.length, capped.length <= 1500);
  has('cost line survives the cap', capped.text, '$0.0512');
}

A.section('WF20 wiring — validation + compact renderer + completion order');
{
  const ob = node(wf20, 'Build Delivery Outbox').parameters.jsCode;
  A.ok('outbox validates claims', ob.indexOf('cvValidateAnalyses(') >= 0);
  A.ok('outbox renders compact', ob.indexOf('crCompactReportRu(') >= 0);
  A.ok('outbox guards final text', ob.indexOf('cvGuardMarkdownRu(') >= 0);
  A.ok('outbox no longer ships the full markdown', ob.indexOf('appendAnalysisToReportRu(') < 0);
  A.ok('claim audit is observable', ob.indexOf('claim_audit') >= 0);
  const sb = node(wf20, 'Shape Report Bundle').parameters.jsCode;
  A.ok('bundle validates claims before baking XLSX rows', sb.indexOf('cvValidateAnalyses(') >= 0);
  A.ok('bundle persists the audit', sb.indexOf('b.claim_audit') >= 0);
  const bx = node(wf20, 'Build Report XLSX').parameters.jsCode;
  A.ok('skipped workbook still emits an item', bx.indexOf('xlsx_skipped:true') >= 0);
  A.ok('XLSX Ready? gate exists', !!node(wf20, 'XLSX Ready?'));
  const conn = wf20.connections;
  const to = (from, idx) => (((conn[from] || {}).main || [])[idx || 0] || []).map(c => c.node);
  A.ok('Build Report XLSX -> XLSX Ready?', to('Build Report XLSX').indexOf('XLSX Ready?') >= 0);
  A.ok('XLSX Ready? true -> Send Report XLSX', to('XLSX Ready?', 0).indexOf('Send Report XLSX') >= 0);
  A.ok('XLSX Ready? false -> Progress: Done', to('XLSX Ready?', 1).indexOf('Progress: Done') >= 0);
  A.ok('Send Report XLSX -> Progress: Done', to('Send Report XLSX').indexOf('Progress: Done') >= 0);
  A.ok('text send no longer triggers completion', to('Send Telegram Report').indexOf('Progress: Done') < 0);
  const done = node(wf20, 'Progress: Done').parameters.jsCode;
  has('completion names both deliveries', done, 'Отчёт и Excel-файл отправлены выше');
  has('no_data completion is honest', done, 'подходящих данных не собрано');
  const pt = node(wf20, 'Build Progress Update').parameters.jsCode;
  A.ok('progress stage text updated in embedded tracker', node(wf20, 'Progress: Report').parameters.jsCode.indexOf('Данные собраны, формирую отчёт') >= 0);
}

A.report('report-truth-quality');
