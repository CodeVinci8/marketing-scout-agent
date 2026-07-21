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
  // WIP3-E: a single-source market superlative gets an EXPLICIT scope caveat in the user-facing text (not only a
  // hidden audit) — «без сравнения с другими источниками нельзя подтвердить максимум/лидерство на рынке».
  const ltv = CV.cvValidateItem({ kind: 'fact', text_ru: 'Максимальный LTV среди автоломбардов — до 90% от стоимости', dimension: 'positioning', evidence_ids: ['ev_1'] }, ctx);
  A.eq('LTV superlative demoted', ltv.item.kind, 'inference');
  A.ok('LTV carries the scope caveat', /без сравнения с другими источниками/i.test(ltv.item.text_ru));
  A.ok('LTV keeps the observed value (до 90%)', /90%/.test(ltv.item.text_ru));
  A.ok('market_claim_scoped reason recorded', ltv.reasons.indexOf('market_claim_scoped') >= 0);
  // idempotent: re-validating the scoped text does not append the caveat twice
  const twice = CV.cvValidateItem({ kind: 'inference', text_ru: ltv.item.text_ru, dimension: 'positioning', evidence_ids: ['ev_1'] }, ctx);
  A.eq('scope caveat not duplicated', (twice.item.text_ru.match(/без сравнения с другими источниками/gi) || []).length, 1);
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

A.section('SOCIAL-DELIVERY-001 — a source_analysis with 0 deterministic records but a usable analysis is delivered');
{
  // A public Telegram/VK channel yields citable EVIDENCE, not a competitor profile with offers/prices, so a
  // successful source_analysis routinely has records_reported=0 and the caller passes state='no_data'. The
  // usable, evidence-bound analysis IS the deliverable and must NOT be suppressed. (live: rusmicrofinance
  // an_3f6ccdb3 was wrongly delivered as "Подходящих данных не собрано".)
  const SOCIAL_BUNDLE = {
    analysis_mode: 'source_analysis', competitors: [], offers: [],
    evidence: [
      { excerpt: 'Рынок ломбардов: прогноз +35% выдач в 2026', url: 'https://t.me/rusmicrofinance/6181', collected_at: '2026-07-20T08:00:00Z' },
      { excerpt: 'Банк России составил ренкинг МФО по числу жалоб', url: 'https://t.me/rusmicrofinance/6179', collected_at: '2026-07-20T08:00:00Z' }
    ]
  };
  const SOCIAL_SUMMARY = {
    final_state: 'no_data', records_reported: 0, analysis_mode: 'source_analysis',
    actual_cost_usd: 0.1045, actual_summary_ai_usd: 0, actual_deep_analysis_usd: 0.1045,
    reused_sources: [], failed_sources: [], source_outcomes: [{ outcome: 'ok', has_data: true }]
  };
  const SOCIAL_COST = '💰 Фактическая стоимость: AI-анализ $0.1045 = $0.1045.';
  function mkSocial(over) {
    return Object.assign({
      analysis_id: 'an_soc', enriched: true, mode: 'call', quality_status: 'ok',
      evidence_map: [{ id: 'ev_1', url: 'https://t.me/rusmicrofinance/6181' }, { id: 'ev_2', url: 'https://t.me/rusmicrofinance/6179' }],
      analysis: {
        executive_summary_ru: 'Канал t.me/rusmicrofinance освещает рынок МФО и ломбардов; прямых офферов и цен в постах нет, уверенность в выводах низкая.',
        items: [
          { kind: 'fact', text_ru: 'Канал публикует отраслевую аналитику рынка МФО и ломбардов', dimension: 'positioning', evidence_ids: ['ev_1', 'ev_2'] },
          { kind: 'fact', text_ru: 'Прямой рекламы продуктов в проанализированных постах нет', dimension: 'advertising_angles', evidence_ids: ['ev_1'] },
          { kind: 'inference', text_ru: 'Целевая аудитория — профессиональные участники рынка, а не конечные заёмщики', dimension: 'target_audience', evidence_ids: ['ev_2'] }
        ],
        recommended_actions: [{ text_ru: 'Отслеживать регуляторные сигналы Банка России по этому каналу', priority: 'medium', evidence_ids: ['ev_2'] }],
        unknowns_ru: ['Нет данных об офферах и ценах'], overall_confidence: 0.18, used_evidence_ids: ['ev_1', 'ev_2']
      }
    }, over || {});
  }

  // A + D: usable analysis renders even at records=0/state=no_data — and carries the full grounded shape.
  const soc = CR.crCompactReportRu({ bundle: SOCIAL_BUNDLE, analyses: [mkSocial()], summary: SOCIAL_SUMMARY, cost_line: SOCIAL_COST, next_action: NEXT, xlsx_expected: true, state: 'no_data' });
  A.eq('A: usable analysis is NOT the issue profile', soc.profile, 'success');
  A.ok('A: no false "Подходящих данных не собрано"', soc.text.indexOf('Подходящих данных не собрано') < 0);
  A.ok('A: no false "конкурентных профилей" wording', soc.text.indexOf('конкурентных профилей') < 0);
  has('D: source header', soc.text, '📊');
  has('D: facts section', soc.text, '📌 Ключевые факты');
  has('D: conclusions marked interpretation', soc.text, 'интерпретация, не факты');
  has('D: recommendations marked suggestions', soc.text, 'предложения к проверке');
  has('D: limitations / needs-verification visible', soc.text, 'требует проверки');
  has('D: actual cost truthful', soc.text, '$0.1045');
  has('D: XLSX delivery line', soc.text, 'Excel-файле');
  A.ok('D: no internal enums/ids leak', !/ev_\d|an_[0-9a-f]{3,}|source_analysis/.test(soc.text));

  // B: a GENUINE no-data run (no usable analysis) still gets the honest issue profile.
  const genuineNoData = CR.crCompactReportRu({ bundle: {}, analyses: [], summary: { final_state: 'no_data', records_reported: 0, source_outcomes: [{ outcome: 'empty_response', has_data: false }] }, cost_line: '', next_action: NEXT, xlsx_expected: false, state: 'no_data' });
  A.eq('B: no usable analysis -> issue profile', genuineNoData.profile, 'issue');
  has('B: honest no-data message', genuineNoData.text, 'Подходящих данных не собрано');

  // C: a deterministic fallback must NOT masquerade as a successful AI analysis — it is not "usable".
  const fb = mkSocial({ enriched: true, fallback_used: true, quality_status: 'deterministic_fallback' });
  const fbRender = CR.crCompactReportRu({ bundle: { analysis_mode: 'source_analysis', competitors: [], offers: [], evidence: [] }, analyses: [fb], summary: { final_state: 'no_data', records_reported: 0, source_outcomes: [{ outcome: 'ok', has_data: true }] }, cost_line: '', next_action: NEXT, xlsx_expected: false, state: 'no_data' });
  A.eq('C: deterministic fallback is not treated as usable -> issue profile', fbRender.profile, 'issue');
  A.ok('C: fallback does not fabricate an AI conclusions section', fbRender.text.indexOf('интерпретация, не факты') < 0);
}

A.section('live-1024/1018 regressions — string tool input, offer enum leak, competitor header');
{
  const CA = require('../n8n/lib/claude_adapter.js');
  // Gateway returned tool_use.input as a serialized JSON STRING (exec 1024) — a valid analysis must survive.
  const r = CA.parseClaudeResponse({ status: 200, latency_ms: 5, body: { model: 'claude-sonnet-4-6', stop_reason: 'tool_use',
    content: [{ type: 'thinking' }, { type: 'tool_use', name: 'submit_analysis', input: '{"executive_summary_ru":"тест","items":[]}' }] } }, {});
  A.ok('string tool input parsed', r.ok === true);
  A.eq('…tagged with its own schema_mode', r.schema_mode, 'tool_use_string');
  const bad = CA.parseClaudeResponse({ status: 200, body: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_analysis', input: '{broken' }] } }, {});
  A.eq('unparseable string input still fails closed', bad.error_category, 'no_structured_output');
  const obj = CA.parseClaudeResponse({ status: 200, body: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_analysis', input: { a: 1 } }] } }, {});
  A.eq('object input keeps the canonical mode', obj.schema_mode, 'tool_use');

  // Offer machine-text leak (exec 1018): boilerplate prefix + ascii enum + duplicated rate.
  const facts = CR.crOfferFacts({ offers: [{ competitor: 'LionCredit',
    offer: 'Предложение конкурента (LionCredit), услуга: generic_lending. Условия: от 4,99% годовых; сумма до 100 млн рублей.',
    price_rate: 'от 4,99% годовых; сумма до 100 млн рублей' }] }, 3);
  A.eq('one clean fact', facts.length, 1);
  A.ok('no internal enum in user text', facts[0].indexOf('generic_lending') < 0);
  A.ok('no boilerplate prefix', facts[0].indexOf('Предложение конкурента') < 0);
  A.eq('rate not duplicated', (facts[0].match(/4,99%/g) || []).length, 1);
  has('competitor named', facts[0], 'LionCredit');

  // Header names the competitor even when the bundle row has no domain (WF12 rows use `competitor`).
  const hdr = CR.crHeader({ competitors: [{ competitor: 'LionCredit', domain: '' }] }, [], { records_reported: 2 });
  has('header names the competitor', hdr, 'LionCredit');

  // Live exec 1034: the model echoed our internal service enum into Russian prose — reject.
  A.ok('AI prose with internal enum is fatal', CV.cvGuardTextRu('Компания предлагает услугу в категории generic_lending (общее кредитование)').fatal);
  A.ok('Telegram handle with underscore is fine', !CV.cvGuardTextRu('Канал @dom_click публикует офферы').fatal);
  A.ok('URL path with underscore is fine', !CV.cvGuardTextRu('Страница https://x.ru/loan_terms описывает условия').fatal);

  // Live exec 1034: «LionCredit — LionCredit — кредитный брокер…» — assessment must not repeat the subject.
  const h2 = CR.crHeader({ competitors: [{ competitor: 'LionCredit' }] },
    [{ enriched: true, analysis: { executive_summary_ru: 'LionCredit — кредитный брокер с ценовым якорем.' } }], {});
  A.eq('no duplicated subject', (h2.match(/LionCredit/g) || []).length, 1);

  // Cap-trimming must not leave an orphaned section header (live: empty «💡 Рекомендации» survived).
  const orphan = CR.crFinish(['📊 X — тест', '', '💡 Рекомендации — предложения к проверке', '', '💰 Итог $1.'], 'success', 1500);
  A.ok('orphaned section header dropped', orphan.text.indexOf('Рекомендации') < 0 && orphan.text.indexOf('💰 Итог') >= 0);
  const keep = CR.crFinish(['📊 X — тест', '', '💡 Рекомендации — предложения к проверке', '• Сделать А', '', '💰 Итог $1.'], 'success', 1500);
  A.ok('populated section kept', keep.text.indexOf('Рекомендации') >= 0 && keep.text.indexOf('• Сделать А') >= 0);
}

A.section('WF20 wiring — validation + compact renderer + completion order');
{
  const ob = node(wf20, 'Build Delivery Outbox').parameters.jsCode;
  A.ok('outbox validates claims', ob.indexOf('cvValidateAnalyses(') >= 0);
  A.ok('outbox renders compact', ob.indexOf('crCompactReportRu(') >= 0);
  // SOCIAL-DELIVERY-001 (E): the outbox must be analysis-aware — a usable analysis suppresses the no_data state
  // (so the keyboard/next-action aren't the "nothing found" set) and forces xlsx_expected even at records=0.
  A.ok('E: outbox computes a usable-analysis flag', ob.indexOf('__hasUsableAnalysis') >= 0);
  A.ok('E: no_data is suppressed when a usable analysis exists', /noData=[^;]*&&!__hasUsableAnalysis/.test(ob));
  A.ok('E: xlsx_expected fires for analysis/evidence even at records=0', /xlsx_expected:\([^;]*__hasUsableAnalysis[^;]*evidence/.test(ob));
  A.ok('outbox guards final text', ob.indexOf('cvGuardMarkdownRu(') >= 0);
  A.ok('outbox no longer ships the full markdown', ob.indexOf('appendAnalysisToReportRu(') < 0);
  A.ok('claim audit is observable', ob.indexOf('claim_audit') >= 0);
  const sb = node(wf20, 'Shape Report Bundle').parameters.jsCode;
  A.ok('bundle validates claims before baking XLSX rows', sb.indexOf('cvValidateAnalyses(') >= 0);
  A.ok('bundle persists the audit', sb.indexOf('b.claim_audit') >= 0);
  const bx = node(wf20, 'Build Report XLSX').parameters.jsCode;
  A.ok('skipped workbook still emits an item', bx.indexOf('xlsx_skipped:true') >= 0);
  A.ok('XLSX Ready? gate exists', !!node(wf20, 'XLSX Ready?'));
  // SOCIAL-DELIVERY-001 (terminal arbiter): the "Progress: Done" edit must be analysis-aware. A social
  // source_analysis has records_reported=0 yet a usable enriched/reused WF28 analysis — the terminal progress
  // edit must NOT say «Данные для анализа не получены» over a real analysis (live: the contradictory transcript).
  const pd = node(wf20, 'Progress: Done').parameters.jsCode;
  A.ok('Progress: Done reads llm_analyses + reused for the terminal state', /llm_analyses/.test(pd) && /llm_analyses_reused/.test(pd));
  A.ok('Progress: Done computes a usable-analysis flag', pd.indexOf('var hasAnalysis=(an+ar)>0') >= 0);
  A.ok('Progress: Done no-data wording is guarded by !hasAnalysis', /!hasAnalysis&&\(fs===.no_data.\|\|rec===0\)/.test(pd));
  A.ok('Progress: Done still has an honest no-data branch', pd.indexOf('Данные для анализа не получены') >= 0);
  const conn = wf20.connections;
  const to = (from, idx) => (((conn[from] || {}).main || [])[idx || 0] || []).map(c => c.node);
  A.ok('Build Report XLSX -> XLSX Ready?', to('Build Report XLSX').indexOf('XLSX Ready?') >= 0);
  A.ok('XLSX Ready? true -> Send Report XLSX', to('XLSX Ready?', 0).indexOf('Send Report XLSX') >= 0);
  A.ok('XLSX Ready? false -> Progress: Done', to('XLSX Ready?', 1).indexOf('Progress: Done') >= 0);
  A.ok('Send Report XLSX -> Progress: Done', to('Send Report XLSX').indexOf('Progress: Done') >= 0);
  A.ok('text send no longer triggers completion', to('Send Telegram Report').indexOf('Progress: Done') < 0);
  const done = node(wf20, 'Progress: Done').parameters.jsCode;
  has('completion names both deliveries (neutral, non-directional)', done, 'Готово. Отчёт и Excel-файл отправлены.');
  has('no_data completion is honest', done, 'Данные для анализа не получены');
  const pt = node(wf20, 'Build Progress Update').parameters.jsCode;
  A.ok('progress stage text updated in embedded tracker', node(wf20, 'Progress: Report').parameters.jsCode.indexOf('Данные собраны, формирую отчёт') >= 0);
}

A.section('REPORT-TRUTH-D — the workbook tells the truth about THIS request');
{
  const RPKG = require('../n8n/lib/report_package.js');
  // Fixture mirrors live exec 1038: machine offer text with enum, duplicate offer, empty domain, empty
  // placeholder recommendations, component costs on summary, tokens/latency + claim audit on the bundle.
  const B = {
    report_id: 'rep_d', agent_request_id: 'req_d', owner_user_id: 'u1', created_at: '2026-07-18T12:00:00Z',
    niche: 'кредитный брокеридж', region: 'Москва/МО', analysis_mode: 'source_analysis',
    summary: { competitors_found: 1, sources_checked: 1, quality_status: 'healthy',
      key_findings: ['LionCredit'], key_recommendations: [],
      actual_cost_usd: 0.1301, actual_collection_usd: 0, actual_summary_ai_usd: 0.0435,
      actual_deep_analysis_usd: 0.0866, actual_repair_usd: 0, external_calls_actual: 0,
      reused_sources: [{ source: 'website', original_collected_at: '2026-07-18T11:24:00Z' }], final_state: 'completed' },
    competitors: [{ competitor: 'LionCredit', domain: '', region: 'Москва/МО', score: 80, quality: '', source_url: 'https://lioncredit.ru' }],
    offers: [
      { competitor: 'LionCredit', offer: 'Предложение конкурента (LionCredit), услуга: generic_lending. Условия: от 4,99% годовых.', price_rate: 'от 4,99% годовых' },
      { competitor: 'LionCredit', offer: 'Предложение конкурента (LionCredit), услуга: generic_lending. Условия: от 4,99% годовых.', price_rate: 'от 4,99% годовых' }
    ],
    evidence: [], recommendations: [
      { recommendation: '', priority: 'medium', rationale: '', linked_finding_ids: [], next_action: '' },
      { recommendation: 'Добавить калькулятор', priority: 'high', rationale: '', linked_finding_ids: [], next_action: '' }
    ],
    source_quality: [{ source: 'lioncredit.ru', platform: 'website', status: 'healthy', source_run_id: 'run_now' }],
    changes: [], claim_audit: { checked: 20, demoted: 2, rejected: 1 },
    analysis: { inferences: [{ source: 'lioncredit.ru', dimension: 'позиционирование', text: 'вывод', evidence: '1' }],
      recommendations: [{ text: 'Проверить реальные ставки', priority: 'high', source: 'lioncredit.ru', evidence: '1' }],
      pains: [], evidence: [{ ref: '[1]', source: 'lioncredit.ru', url: 'https://lioncredit.ru', type: 'website' }],
      unknowns: ['Реальный диапазон итоговых ставок'], analysis_ids: ['an_x'], count_enriched: 1, count_reused: 0,
      count_fallback: 0, analysis_cost_usd: 0.0866, repair_cost_usd: 0, reuse_lineage: [], cache_decisions: [],
      model: 'claude-sonnet-4-6', tokens_in: 2392, tokens_out: 1500, latency_ms: 61000 }
  };
  const sheets = RPKG.buildSheets(B);
  const sh = n => sheets.find(s => s.name === n);
  const sumRow = sh('Сводка').rows[0];
  has('Summary states the report mode in Russian', sumRow.mode, 'анализ текущего состояния');
  has('Summary states the data mode honestly', sumRow.data_mode, 'сохранённые данные');
  A.eq('Summary source count is request-scoped', sumRow.sources, 1);
  A.eq('Summary component costs are real dollars', sumRow.cost_total, '$0.1301');
  A.eq('…including the deep-AI component', sumRow.cost_deep_ai, '$0.0866');
  has('Summary carries limitations', sumRow.limitations, 'Реальный диапазон');
  A.ok('no status enums in cost columns', String(sumRow.cost_collection).indexOf('unknown') < 0);
  const comp = sh('Конкуренты');
  A.eq('domain derived from source_url', comp.rows[0].domain, 'lioncredit.ru');
  A.eq('source type derived', comp.rows[0].source_type, 'website');
  A.ok('region column is explicitly the REQUEST region', comp.columns.some(c => c.header === 'Регион запроса'));
  const off = sh('Офферы и цены');
  A.eq('duplicate offers deduped', off.rows.length, 1);
  A.ok('offer text carries no internal enum', off.rows[0].offer.indexOf('generic_lending') < 0);
  A.ok('offer text carries no boilerplate', off.rows[0].offer.indexOf('Предложение конкурента') < 0);
  const recs = sh('Рекомендации');
  A.eq('empty placeholder recommendation dropped', recs.rows.filter(r => !String(r.recommendation).trim()).length, 0);
  A.ok('evidence-less recommendation marked as hypothesis',
    recs.rows.filter(r => !String(r.linked_finding_ids).trim()).every(r => String(r.rationale).indexOf('гипотеза') >= 0));
  const ev = sh('Доказательства');
  has('AI evidence row names its observation kind', ev.rows[0].finding, 'наблюдение из источника');
  has('a quote we did not capture is an EXPLICIT limitation', ev.rows[0].excerpt, 'цитата не сохранена');
  const tech = sh('Технические данные').rows[0];
  A.eq('tech: component total', tech.cost_total, '$0.1301');
  A.eq('tech: tokens in', tech.ai_tokens_in, 2392);
  A.eq('tech: latency', tech.ai_latency_ms, 61000);
  A.eq('tech: final state', tech.final_state, 'completed');
  has('tech: claim audit persisted', tech.claim_audit, '"rejected":1');
  A.ok('tech sheet stays hidden', sh('Технические данные').hidden === true);

  // Wiring: the bundle node scopes source_quality + drops placeholder recs + injects component costs.
  const sb = node(wf20, 'Shape Report Bundle').parameters.jsCode;
  has('bundle scopes source_quality to this run', sb, '__runIds.indexOf(String((r||{}).source_run_id');
  has('bundle drops empty key_recommendations', sb, 'key_recommendations.filter');
  has('bundle injects actual component costs', sb, "'actual_summary_ai_usd'");
  const fin = node(JSON.parse(fs.readFileSync(path.join(WFD, '28_claude_analyst.json'), 'utf8')), 'Finalize Analysis').parameters.jsCode;
  has('WF28 typed return carries tokens/latency', fin, 'tokens_in:((result.usage||{}).input_tokens)');

  // --- D2: the gaps the LIVE exec-1058 workbook still showed -----------------------------------------------------
  A.section('REPORT-TRUTH-D2 — live exec 1058: consistency, canonical states, claim scope in XLSX');
  // Summary «Ключевые рекомендации» falls back to the SAME canonical rows the Рекомендации sheet renders.
  const sumRow2 = sh('Сводка').rows[0];
  has('Summary recommendations use the canonical rec rows', sumRow2.recs, 'Добавить калькулятор');
  // Конкуренты quality: populated from the run's source-quality verdict when the row lacks its own.
  A.eq('competitor quality resolved from source_quality', comp.rows[0].quality, 'healthy');
  A.ok('quality column present when quality is known', comp.columns.some(c => c.key === 'quality'));
  // Tech sheet canonical states: measured costs are never 'unknown'; data mode matches the user-facing label.
  A.eq('tech: collection cost measured at zero => measured_zero', tech.source_cost, 'measured_zero');
  A.eq('tech: LLM cost measured nonzero => measured', tech.llm_cost, 'measured');
  A.eq('tech: data mode canonical and consistent with «Режим данных»', tech.data_mode, 'reuse');

  // When quality is genuinely unknown for EVERY competitor, the column disappears instead of standing empty.
  const B2 = JSON.parse(JSON.stringify(B));
  B2.source_quality = []; B2.summary.reused_sources = [];
  const sheets2 = RPKG.buildSheets(B2);
  const comp2 = sheets2.find(s => s.name === 'Конкуренты');
  A.ok('unknown quality => column dropped', !comp2.columns.some(c => c.key === 'quality'));
  A.eq('no reuse => data mode collect', sheets2.find(s => s.name === 'Технические данные').rows[0].data_mode, 'collect');
  has('…and the user label agrees', sheets2.find(s => s.name === 'Сводка').rows[0].data_mode, 'свежий сбор');

  // Evidence contract travels: enriched evidence_map -> visible quote/quality/collected_at; markers stay bracketed.
  const AR = require('../n8n/lib/analysis_report_ru.js');
  const analyses = [{
    analysis_id: 'an_1', enriched: true, quality_status: 'llm_primary', source: { source_id: 'lioncredit.ru' },
    evidence_map: [{ id: 'ev_1', url: 'https://lioncredit.ru', type: 'website', excerpt: 'от 4,99% годовых',
      fact_type: 'offer', collected_at: '2026-07-18T11:24:00Z', quality_status: 'accepted' }],
    analysis: { items: [
      { kind: 'inference', dimension: 'advertising_angles', text_ru: 'Ценовой якорь — основной рекламный ход', evidence_ids: ['ev_1'] }
    ], recommended_actions: [], unknowns_ru: [] }
  }];
  const rend = AR.renderAnalysisSectionsRu(analyses, {}, {});
  const xd = AR.analysisXlsxData(analyses, rend);
  A.eq('evidence row keeps the bounded quote', xd.evidence[0].excerpt, 'от 4,99% годовых');
  A.eq('evidence row keeps collection time', xd.evidence[0].collected_at, '2026-07-18T11:24:00Z');
  A.eq('evidence row keeps source quality', xd.evidence[0].quality, 'accepted');
  A.eq('evidence row keeps the observation kind', xd.evidence[0].fact_type, 'offer');
  A.eq('markers stay bracketed references, not bare counts', xd.inferences[0].evidence, '[1]');
  // The workbook renders the captured quote (not the limitation marker) when it exists.
  const B3 = JSON.parse(JSON.stringify(B));
  B3.analysis.evidence = xd.evidence;
  const ev3 = RPKG.buildSheets(B3).find(s => s.name === 'Доказательства');
  A.eq('captured quote reaches the sheet', ev3.rows[0].excerpt, 'от 4,99% годовых');
  has('observation kind is named in Russian', ev3.rows[0].finding, 'зафиксированное предложение');
  A.eq('quality reaches the sheet', ev3.rows[0].source_quality, 'accepted');

  // Claim validator now rejects the exact ungrounded patterns the 1058 workbook still carried.
  const ctxD = CV.cvBuildCtx({ analyses: [{ evidence_map: [{ id: 'ev_1', url: 'https://lioncredit.ru', type: 'website' }] }], now: NOW });
  const liveClaims = [
    ['score => market effectiveness', 'Высокая оценка силы объявления (75/100) свидетельствует об эффективности данного подхода на рынке.', 'не подтверждается'],
    ['score proof, reversed order', 'Конкурентная сила подтверждается агрессивным ценовым якорем и высоким рейтингом объявления.', 'не подтверждается'],
    ['rate => CTR/lead flow', 'Низкая ставка обеспечивает высокую кликабельность и поток входящих обращений.', 'не измерялись'],
    ['unfair competition', 'Публикация заниженной ставки формирует нечестную конкуренцию для брокеров.', 'Гипотеза'],
    ['one offer => audience pain', 'Основная боль целевой аудитории — высокая стоимость заимствований.', 'аудиторные сигналы не собирались'],
    ['«одна из наиболее … в сегменте»', 'Ставка 4,99% — одна из наиболее привлекательных в сегменте кредитного брокериджа Москвы и МО.', 'Гипотеза']
  ];
  liveClaims.forEach(([label, text, marker]) => {
    const v = CV.cvValidateItem({ kind: 'inference', text_ru: text, dimension: 'strengths', evidence_ids: ['ev_1'] }, ctxD);
    A.eq('demoted: ' + label, v.action, 'demote');
    has('bounded: ' + label, v.item.text_ru, marker);
    const again = CV.cvValidateItem({ kind: 'inference', text_ru: v.item.text_ru, dimension: 'strengths', evidence_ids: ['ev_1'] }, ctxD);
    A.eq('idempotent: ' + label, again.item.text_ru, v.item.text_ru);
  });

  // Wiring: WF28 ships the full evidence contract; the bundle records terminal state + real budget ceilings.
  has('WF28 evidence map carries the bounded excerpt', fin, "excerpt:String(e.excerpt||'').slice(0,300)");
  has('bundle final state is terminal after delivery', sb, "b.summary.final_state=(__fs==='no_data')?'no_data'");
  has('bundle records enforced budget ceilings', sb, 'b.budgets.source_budget_usd==null');
}

A.report('report-truth-quality');
