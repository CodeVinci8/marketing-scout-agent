'use strict';
// PHASE-2 — approval/progress UX: no public hard cap, execution-aware (reuse) estimates, callback idempotency,
// neutral completion wording. Behavioral, offline, $0.
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const CM = require('../n8n/lib/cost_model.js');
const RP = require('../n8n/lib/plan_render_ru.js');
const PLAN = require('../n8n/lib/request_planner.js');
const SX = require('../n8n/lib/source_execution_policy.js');
const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
const wf18 = JSON.parse(fs.readFileSync(path.join(WFD, '18_telegram_agent_gateway.json'), 'utf8'));
const wf19 = JSON.parse(fs.readFileSync(path.join(WFD, '19_request_planner.json'), 'utf8'));
const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
const node = (wf, n) => wf.nodes.find(x => x.name === n);
const has = (label, s, sub) => A.ok(label, String(s).indexOf(sub) >= 0, 'missing: ' + sub);
const hasnt = (label, s, sub) => A.ok(label, String(s).indexOf(sub) < 0, 'must NOT contain: ' + sub);

const cfg = { source_allowlist: ['website'], cost_firecrawl_page_usd: 0.01, cost_claude_analysis_usd: 0.07,
  cost_claude_summary_usd: 0.015, enable_llm_analysis: true, claude_available: true, source_budget_usd: 5, llm_budget_usd: 3 };
const plan = { sources: ['website'], urls: ['https://lioncredit.ru'], max_items: 10, max_external_calls: 1, intent: 'competitor_analysis' };
const NOW = '2026-07-19T12:00:00Z';
const freshSnap = [{ source_url: 'lioncredit.ru', normalized_source_url: 'lioncredit.ru', last_seen_at: '2026-07-18T20:00:00Z',
  processing_status: 'monitored', last_route: 'monitor_queue', owner_user_id: 'u1' }];

A.section('§5 — the internal hard cap is NEVER shown in the normal approval message');
{
  const forbidden = ['$8.00', '$8', 'hard_cap_usd', 'максимальный лимит запуска', 'source_budget', 'llm_budget'];
  // fresh + reuse + AI-off variants
  const projFresh = CM.projectRequestCost(plan, cfg, { preflight: CM.sourceReusePreflight(plan, cfg, [], SX.decideSourceExecution, { owner_user_id: 'u1', now: NOW }) });
  const projReuse = CM.projectRequestCost(plan, cfg, { preflight: CM.sourceReusePreflight(plan, cfg, freshSnap, SX.decideSourceExecution, { owner_user_id: 'u1', now: NOW }) });
  const projOff = CM.projectRequestCost(plan, Object.assign({}, cfg, { enable_llm_analysis: false }));
  [['fresh', projFresh], ['reuse', projReuse], ['ai-off', projOff]].forEach(([tag, p]) => {
    const t = RP.planApprovalMessageRu(plan, { data_mode: p.data_mode, cost: p }).text;
    forbidden.forEach(f => hasnt('[' + tag + '] no ' + f, t, f));
  });
  // …but the cap is still COMPUTED for the gate/telemetry.
  A.eq('hard cap still returned for internal enforcement', projFresh.hard_cap_usd, 8);
}

A.section('§6 — the estimate is execution-aware (reuse ≠ fresh), never a mechanical fixed band');
{
  const pfReuse = CM.sourceReusePreflight(plan, cfg, freshSnap, SX.decideSourceExecution, { owner_user_id: 'u1', now: NOW });
  A.eq('fresh snapshot => reuse predicted', pfReuse.data_mode, 'reuse');
  A.ok('…source collection reused', pfReuse.expect_source_reuse);
  // COST-REUSE-002 (residual-risk #1): source reuse only makes a deep-analysis cache hit POSSIBLE — the analysis
  // key (owner+analysis_type+evidence_hash+schema+prompt+model) may still MISS. Without confirmation the estimate
  // must NOT promise a $0 analysis.
  A.ok('…deep analysis reuse is POSSIBLE, not promised (no confirmation supplied)', pfReuse.analysis_reuse_possible === true && pfReuse.expect_analysis_reuse === false);
  const projReuse = CM.projectRequestCost(plan, cfg, { preflight: pfReuse });
  A.eq('reuse => $0 collection', projReuse.breakdown.collection_usd, 0);
  A.ok('reuse WITHOUT a confirmed cache hit still QUOTES the deep analysis (never a promised $0)', projReuse.breakdown.claude_analysis_usd > 0);
  A.ok('reuse => a nonzero summary component remains (never exact $0)', projReuse.breakdown.summary_ai_usd > 0 && projReuse.projected_cost_usd > 0);
  const rMsg = RP.planApprovalMessageRu(plan, { data_mode: projReuse.data_mode, cost: projReuse }).text;
  has('reuse msg states saved data', rMsg, 'используются сохранённые данные');
  has('reuse msg shows $0 collection with snapshot date', rMsg, 'сбор данных: $0 (сохранённый снимок от 2026-07-18)');
  hasnt('reuse msg must NOT promise a guaranteed $0 AI-analysis', rMsg, 'AI-анализ: $0');
  has('reuse msg quotes AI-analysis honestly with the spend condition', rMsg, 'спишется, если готового анализа под этот отчёт ещё нет');
  has('reuse msg still shows a summary-AI cost', rMsg, 'AI-сводка: ~$');

  // …but when the caller CONFIRMS a matching cached analysis exists, the $0 reuse prediction is honest and returns.
  const pfConfirmed = CM.sourceReusePreflight(plan, cfg, freshSnap, SX.decideSourceExecution, { owner_user_id: 'u1', now: NOW, analysis_reuse_confirmed: true });
  A.ok('confirmed cache hit => deep analysis reuse predicted', pfConfirmed.expect_analysis_reuse === true);
  const projConfirmed = CM.projectRequestCost(plan, cfg, { preflight: pfConfirmed });
  A.eq('confirmed reuse => $0 deep analysis', projConfirmed.breakdown.claude_analysis_usd, 0);
  const cMsg = RP.planApprovalMessageRu(plan, { data_mode: projConfirmed.data_mode, cost: projConfirmed }).text;
  has('confirmed reuse msg shows $0 deep analysis', cMsg, 'AI-анализ: $0 (будет переиспользован сохранённый анализ)');

  // no snapshot => fresh collection estimate, DIFFERENT from reuse
  const pfFresh = CM.sourceReusePreflight(plan, cfg, [], SX.decideSourceExecution, { owner_user_id: 'u1', now: NOW });
  A.eq('no snapshot => collect', pfFresh.data_mode, 'collect');
  const projFresh = CM.projectRequestCost(plan, cfg, { preflight: pfFresh });
  A.ok('fresh charges real collection', projFresh.breakdown.collection_usd > 0);
  A.ok('fresh charges real deep analysis', projFresh.breakdown.claude_analysis_usd > 0);
  A.ok('fresh total > reuse total (not mechanical)', projFresh.projected_cost_usd > projReuse.projected_cost_usd);
  const fMsg = RP.planApprovalMessageRu(plan, { data_mode: projFresh.data_mode, cost: projFresh }).text;
  hasnt('fresh msg does NOT claim saved data', fMsg, 'используются сохранённые данные');
  has('fresh msg shows collection cost', fMsg, 'сбор данных: ~$');

  // stale snapshot (older than freshness window) => collect, not reuse
  const staleSnap = [Object.assign({}, freshSnap[0], { last_seen_at: '2026-06-01T00:00:00Z' })];
  const pfStale = CM.sourceReusePreflight(plan, cfg, staleSnap, SX.decideSourceExecution, { owner_user_id: 'u1', now: NOW });
  A.eq('stale snapshot => collect', pfStale.data_mode, 'collect');

  // explicit refresh => never predicts reuse
  const pfRefresh = CM.sourceReusePreflight(Object.assign({}, plan, { force_reprocess: true }), cfg, freshSnap, SX.decideSourceExecution, { owner_user_id: 'u1', now: NOW });
  A.eq('refresh => data_mode refresh', pfRefresh.data_mode, 'refresh');
  A.ok('refresh never predicts reuse', !pfRefresh.expect_source_reuse);

  // owner isolation: another owner's snapshot is not reused
  const otherSnap = [Object.assign({}, freshSnap[0], { owner_user_id: 'u2' })];
  const pfOther = CM.sourceReusePreflight(plan, cfg, otherSnap, SX.decideSourceExecution, { owner_user_id: 'u1', now: NOW });
  A.ok('another owner snapshot is NOT reused', !pfOther.expect_source_reuse);

  // the plain (no-preflight) projection is byte-identical to before — no summary component, no reuse fields
  const bare = CM.projectRequestCost(plan, cfg);
  A.eq('no preflight => no summary component', bare.breakdown.summary_ai_usd, 0);
  A.eq('no preflight => data_mode empty', bare.data_mode, '');
}

A.section('§7 — callback idempotency classification (never a 2nd dispatch, never a false "no plan")');
{
  const mk = (st, owner) => ([{ agent_request_id: 'req_1', owner_user_id: owner || 'u1', status: st, plan_id: 'p1' }]);
  const claim = { agent_request_id: 'req_1', owner_user_id: 'u1' };
  A.eq('awaiting_approval => apply (start once)', PLAN.classifyApprovalCallback(mk('awaiting_approval'), claim).kind, 'apply');
  A.eq('approved => duplicate_running', PLAN.classifyApprovalCallback(mk('approved'), claim).kind, 'duplicate_running');
  A.eq('collecting => duplicate_running', PLAN.classifyApprovalCallback(mk('collecting'), claim).kind, 'duplicate_running');
  A.eq('completed => duplicate_done', PLAN.classifyApprovalCallback(mk('completed'), claim).kind, 'duplicate_done');
  A.eq('no_data => duplicate_done', PLAN.classifyApprovalCallback(mk('no_data'), claim).kind, 'duplicate_done');
  A.eq('failed => duplicate_closed', PLAN.classifyApprovalCallback(mk('failed'), claim).kind, 'duplicate_closed');
  A.eq('cancelled => duplicate_closed', PLAN.classifyApprovalCallback(mk('cancelled'), claim).kind, 'duplicate_closed');
  A.eq('no row for request => no_plan', PLAN.classifyApprovalCallback([], claim).kind, 'no_plan');
  A.eq('another owner => no_plan (isolation)', PLAN.classifyApprovalCallback(mk('approved', 'u2'), claim).kind, 'no_plan');
  // prefers an awaiting_approval row even if a terminal one for the same request exists
  const mixed = [{ agent_request_id: 'req_1', owner_user_id: 'u1', status: 'superseded', plan_id: 'p0' },
    { agent_request_id: 'req_1', owner_user_id: 'u1', status: 'awaiting_approval', plan_id: 'p1' }];
  A.eq('awaiting_approval wins over a stale terminal row', PLAN.classifyApprovalCallback(mixed, claim).kind, 'apply');
  // messages
  has('running message', RP.approvalDuplicateRu('duplicate_running'), 'уже запущен');
  has('done message', RP.approvalDuplicateRu('duplicate_done'), 'уже завершён');
  has('closed message', RP.approvalDuplicateRu('duplicate_closed'), 'уже закрыт');
  has('running toast', RP.approvalDuplicateToastRu('duplicate_running'), 'Уже выполняется');
}

A.section('§7 — WF18 wiring: no contradictory "план не найден" for a running/finished plan');
{
  const intake = node(wf18, 'Build Intake Decision').parameters.jsCode;
  has('Build Intake classifies the approve callback', intake, 'classifyApprovalCallback');
  has('duplicate => local dispatch (no 2nd WF20)', intake, "'approval_dup:'+cls.kind");
  const cmd = node(wf18, 'Command Lane').parameters.jsCode;
  has('Command Lane is status-aware for approve', cmd, 'classifyApprovalCallback');
  has('…only the first valid tap says «Запускаю анализ»', cmd, "__cls.kind==='apply'");
  has('…a duplicate tap does not promise a launch', cmd, "lane:'approve_ack_dup'");
  const reply = node(wf18, 'Build Conversational Reply').parameters.jsCode;
  has('reply maps the duplicate to an idempotent message', reply, "approval_dup:");
  has('reply uses approvalDuplicateRu', reply, 'approvalDuplicateRu');
}

A.section('§6 — WF19 supplies the execution-aware preflight from stored snapshots');
{
  A.ok('WF19 reads url_registry for the free preflight', !!node(wf19, 'Read url_registry'));
  const ba = node(wf19, 'Build Approval Message').parameters.jsCode;
  has('Build Approval runs the reuse preflight', ba, 'sourceReusePreflight');
  has('…and passes it to the projection', ba, 'projectRequestCost(plan,cfg,pf?{preflight:pf}:{})');
}

A.section('§8 — neutral, state-aware completion wording (no directional «выше/ниже»)');
{
  const done = wf20.nodes.find(n => n.name === 'Progress: Done').parameters.jsCode;
  hasnt('no «отправлен выше» directional wording', done, 'отправлен выше');
  hasnt('no «отправлены ниже» directional wording', done, 'отправлены ниже');
  hasnt('no «отправлен ниже» directional wording', done, 'отправлен ниже');
  hasnt('no «Подробности выше»', done, 'Подробности выше');
  has('success + workbook wording', done, '✅ Готово. Отчёт и Excel-файл отправлены.');
  has('success report-only wording', done, '✅ Готово. Отчёт отправлен.');
  has('no-data wording', done, '✅ Проверка завершена. Данные для анализа не получены.');
  has('partial wording', done, '⚠️ Анализ завершён частично. Доступные результаты отправлены.');
  has('failure wording', done, '⚠️ Анализ не завершён: данные получить не удалось.');
  // the terminal edit is downstream of the LAST delivery branch (send OR explicit skip). F-2: the send branch now
  // passes through the «XLSX Sent?» verification gate (a real document_message_id) before the terminal ✅.
  const conns = wf20.connections;
  const xlsxReady = conns['XLSX Ready?'].main;
  A.ok('skip branch reaches Progress: Done', JSON.stringify(xlsxReady).indexOf('Progress: Done') >= 0);
  A.ok('send branch reaches Progress: Done via the XLSX Sent? gate',
    JSON.stringify(conns['Send Report XLSX'].main).indexOf('XLSX Sent?') >= 0 && JSON.stringify(conns['XLSX Sent?'].main).indexOf('Progress: Done') >= 0);
}

A.report('approval-ux');
