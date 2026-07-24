'use strict';
// test_f8b_telegram_regression.js — F-8b: a scoped REGRESSION check that this session's F-2 (delivery lifecycle)
// and F-7 (comparison routing + rendering) changes did NOT break the Telegram-channel social path.
//
// The Telegram/VK social path is the SOCIAL-BRIDGE-001 case: a channel/community deliberately never becomes a
// competitor profile, yet its quality-gated posts must still produce ONE analysis target and render honestly.
// This session touched the shared render libs (compact_report_ru, analysis_report_ru) for the comparison case
// and the router wiring (WF20 Build Analysis Inputs) — so the regression surface is exactly:
//   1. a single Telegram channel still yields ONE evidence-only target (SOCIAL-BRIDGE-001), and
//   2. that ONE social source, even requested as a comparison, is NEVER faked into one (F-7 routing), and
//   3. its single-source analysis still renders through the MODIFIED render libs with no ev_N leak, grounded
//      claims intact, and the social limitations preserved.
// Offline, $0, no network. Complements test_social_evidence.js (target creation) by proving the render+route
// SURVIVE the diff.
const A = require('./_assert.js');
const H = require('./wf_harness.js');
const SE = require('../n8n/lib/social_evidence.js');
const AB = require('../n8n/lib/analysis_bridge.js');
const RT = require('../n8n/lib/analysis_router.js');
const CR = require('../n8n/lib/compact_report_ru.js');
const AR = require('../n8n/lib/analysis_report_ru.js');

const WF20 = H.loadWorkflow('20_agent_orchestrator.json');
const REQ = 'req_f8b';
const RUN = 'req_f8b::telegram::a1::telegram';
const CTX = { agent_request_id: REQ, included_source_runs: [RUN] };
function tgRow(over) {
  return Object.assign({
    record_id: 'wf11_rec_' + RUN + '_1', agent_request_id: REQ, source_run_id: RUN, data_mode: 'live',
    created_at: '2026-07-24T07:11:06.633+03:00', source_type: 'social_channel', platform: 'telegram',
    source_url: 'https://t.me/s/mfo_market', post_url: 'https://t.me/mfo_market/224',
    profile_url: 'https://t.me/mfo_market', profile_name: 'Кредитный брокер Москва',
    author_handle: '@mfo_market', published_at: '2026-05-04T15:56:40+00:00',
    text_context: 'Займ под ПТС до 3 млн, ставка от 3,5% в месяц, срок до 5 лет. Оставьте заявку&#33;',
    comment_text: '', dedup_key: 'telegram::social_channel::https://t.me/mfo_market/224'
  }, over || {});
}
const noEvLeak = s => !/\bev_\d+\b/.test(String(s == null ? '' : s));

// Run the REAL WF20 `Build Analysis Inputs` node on a bundle (same driving pattern as the F-7/F-8 tests).
function buildInputs(bundle, planMode) {
  const run = H.makeRun();
  H.inject(run, 'Approval & Budget Gate', [{
    cfg: { enable_claude: true, enable_llm_analysis: true, llm_max_analyses_per_run: 5 },
    plan: { niche: 'pts_loan', region: 'Москва/МО', analysis_mode: planMode, sources: ['telegram'] },
    request: { agent_request_id: REQ, owner_user_id: '219246148', chat_id: '219246148', data_mode: 'live' },
    idempotency_key: REQ + '::telegram'
  }]);
  H.inject(run, 'Run WF12 Report', [{ report_id: 'report_f8b', report_bundle: JSON.stringify(bundle) }]);
  H.inject(run, 'Resolve Collection Set', [{}]);
  return H.runCodeNode(run, WF20, 'Build Analysis Inputs', [])[0].json;
}

// ============================================================================================================
A.section('F-8b · a Telegram channel STILL yields exactly one evidence-only target (SOCIAL-BRIDGE-001 intact)');
const built = SE.buildSocialEvidence([tgRow()], CTX, {});
const socialBundle = { competitors: [], offers: [], evidence: built.evidence, niche: 'pts_loan', region: 'Москва/МО', report_id: 'report_f8b' };
{
  A.eq('one social evidence row', built.evidence.length, 1);
  const res = AB.buildAnalysisTargets(socialBundle, { agent_request_id: REQ });
  A.eq('exactly one analysis target (the production defect was 0)', res.targets.length, 1);
  const t = res.targets[0];
  A.eq('target kind is telegram', t.source_kind, 'telegram');
  A.eq('target key is the channel, not a fabricated competitor', t.source_key, 't.me/mfo_market');
  A.eq('no invented positioning', t.evidence_input.current_run_facts.positioning, '');
  A.eq('no invented offers', t.evidence_input.current_run_facts.offer_summary, '');
  const lim = t.evidence_input.limitations.join(' | ');
  A.ok('limitation: no competitor profile exists', /карточки конкурента с офферами и ценами нет/.test(lim));
  A.ok('limitation: no market-wide conclusion from one channel', /не переносятся на рынок в целом/.test(lim));
  A.ok('limitation: silence is not absence of interest', /отсутствие комментариев/.test(lim));
}

A.section('F-8b · one Telegram channel requested as a comparison is DOWNGRADED, never faked (F-7 routing)');
{
  // Through the REAL WF20 routing node — the same node the F-7/F-8 changes rewired.
  const o = buildInputs(socialBundle, 'comparison');
  A.ok('analysis still runs for the single social source', o.do_analyze);
  A.eq('downgraded to single-source (no faked comparison)', o.analysis_mode, 'source_analysis');
  A.ok('downgrade flagged for audit', o.analysis_mode_downgraded);
  A.eq('requested mode kept', o.analysis_mode_requested, 'comparison');
  A.ok('a Russian downgrade reason is available', String(o.analysis_mode_reason_ru || '').length > 0);
  A.eq('one contributing source', o.contributing_sources, 1);
  A.eq('exactly one target', o.targets.length, 1);
  A.ok('the target is NOT a multi-source package', o.targets[0].source_kind !== 'multi');
  A.eq('target kind stays telegram', o.targets[0].source_kind, 'telegram');
  A.eq('target follows the resolved single-source mode', o.targets[0].analysis_type, 'source_analysis');

  // and the same at the library level (belt-and-braces: the router itself never fakes a one-source comparison)
  const tgt = AB.buildAnalysisTargets(socialBundle, { agent_request_id: REQ }).targets;
  const route = RT.resolveAnalysisMode({ requested_mode: 'comparison', targets: tgt });
  A.eq('router resolves source_analysis for one social source', route.mode, 'source_analysis');
  A.ok('router does not mark it multi-source', !route.multi_source);
  A.eq('router counts one contributing source', route.contributing, 1);
}

A.section('F-8b · the single Telegram-channel analysis still renders through the MODIFIED render libs');
{
  // A single-source social analysis (source_analysis, `items` — NOT `comparisons`). It must survive the render
  // libs that F-7 extended for the multi-source comparison case.
  const social = {
    analysis_id: 'an_tg', enriched: true, mode: 'call', quality_status: 'ok', fallback_used: false,
    source: { source_id: 't.me/mfo_market', kind: 'telegram' },
    evidence_map: [{ id: 'ev_1', url: 'https://t.me/mfo_market/224', type: 'telegram' }],
    analysis: {
      executive_summary_ru: 'Канал публикует офферы по займам под ПТС.', overall_confidence: 70,
      unknowns_ru: ['Нет данных о доле одобрений'], used_evidence_ids: ['ev_1'],
      items: [
        { dimension: 'positioning', kind: 'fact', text_ru: 'Заявлен займ под ПТС до 3 млн', evidence_ids: ['ev_1'] },
        { dimension: 'prices_terms', kind: 'inference', text_ru: 'Ставка вероятно выше банковской', evidence_ids: ['ev_1'] }
      ],
      recommended_actions: [{ text_ru: 'Проверить реальную ставку через заявку', priority: 'medium', evidence_ids: ['ev_1'] }],
      // the analyst is told this is one channel, not the market — the bound must reach the reader
      limitations_ru: ['выводы описывают только этот источник и не переносятся на рынок в целом']
    }
  };
  const BUNDLE_TG = { report_id: 'report_f8b', niche: 'pts_loan', region: 'Москва/МО',
    summary: { competitors_found: 0, sources_checked: 1, quality_status: 'healthy' },
    competitors: [], offers: [], evidence: [], recommendations: [], source_quality: [{ source: 't.me/mfo_market', platform: 'telegram', status: 'healthy' }] };

  // 1) full report section renderer (analysis_report_ru)
  const r = AR.renderAnalysisSectionsRu([social], BUNDLE_TG, {});
  A.ok('the grounded fact survives', r.text.indexOf('Заявлен займ под ПТС до 3 млн') >= 0);
  A.ok('the grounded inference survives', r.text.indexOf('Ставка вероятно выше банковской') >= 0);
  A.ok('internal ev_N ids NEVER reach the user', noEvLeak(r.text));
  A.ok('the evidence marker resolves to the real Telegram post URL', /\[1\] https:\/\/t\.me\/mfo_market\/224/.test(r.text));
  A.ok('the unknown is surfaced honestly', r.text.indexOf('Нет данных о доле одобрений') >= 0);

  // 2) compact Telegram renderer (compact_report_ru) — single source, must NOT be tagged multi
  const tg = CR.crCompactReportRu({ bundle: { analysis_mode: 'source_analysis' }, analyses: [social],
    summary: { records_reported: 1, final_state: 'completed' }, cost_line: '💰 $0.03', xlsx_expected: true });
  A.ok('the compact profile is NOT multi for a single social source', tg.profile !== 'multi');
  A.ok('no raw ev_N id leaks into the compact Telegram text', noEvLeak(tg.text));
  A.ok('no comparison section is fabricated for one source', tg.text.indexOf('⚖️ Сравнение источников') < 0);

  // 3) XLSX data (analysis_report_ru.analysisXlsxData) — single-source items become rows, no comparison rows
  const x = AR.analysisXlsxData([social], r);
  A.ok('the inference reaches the workbook', x.inferences.some(i => /Ставка вероятно выше банковской/.test(i.text)));
  A.eq('no comparison rows for a single source', (x.comparisons || []).length, 0);
  A.ok('no raw ev_N id leaks into the workbook rows', (x.inferences || []).every(i => noEvLeak(i.text)) && (x.facts || []).every(f => noEvLeak(f.text)));
  A.ok('evidence resolves to the Telegram post URL', (x.evidence || []).some(e => /t\.me\/mfo_market\/224/.test(e.url)));
}

A.report('f8b-telegram-regression');
