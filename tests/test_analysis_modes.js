'use strict';
// REPORT-TRUTH-A — explicit analysis/report modes. A direct source question and a "what changed" question are
// different deliverables: the mode is inferred deterministically from the Russian request, becomes part of the
// plan identity the user approves, persists on the execution_plans row, and travels WF20 → WF28 (analysis_type)
// → execution summary → report bundle → hidden XLSX tech sheet. Legacy cached analyses stay reusable through the
// 'single_source' → 'source_analysis' alias. Offline, $0.
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const RP = require('../n8n/lib/request_planner.js');
const LT = require('../n8n/lib/llm_telemetry.js');
const PR = require('../n8n/lib/plan_render_ru.js');
const RPKG = require('../n8n/lib/report_package.js');
const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
const node = (wf, n) => wf.nodes.find(x => x.name === n);
const cfg = { source_allowlist: ['website', 'telegram', 'vk'], max_sources_per_request: 3 };
const mode = (text) => RP.deterministicPlan(text, cfg).analysis_mode;

A.section('mode inference — Russian request routing');
{
  // Direct source questions -> source_analysis (latest accepted state, NEVER "no new facts in the window").
  A.eq('«Проанализируй сайт X»', mode('Проанализируй сайт autolombardn1.ru'), 'source_analysis');
  A.eq('«Расскажи про конкурента X»', mode('Расскажи про конкурента carmoney.ru'), 'source_analysis');
  A.eq('generic market scan defaults to source_analysis', mode('Найди конкурентов кредитных брокеров в Москве'), 'source_analysis');
  // Change questions -> change_report.
  A.eq('«Что изменилось у X?»', mode('Что изменилось у autolombardn1.ru?'), 'change_report');
  A.eq('«Какие изменения на сайте X»', mode('Какие изменения на сайте carmoney.ru за последнее время'), 'change_report');
  A.eq('«Сравни с прошлым отчётом»', mode('Сравни autolombardn1.ru с прошлым отчётом'), 'change_report');
  A.eq('«что нового у конкурента»', mode('Посмотри, что нового у carmoney.ru'), 'change_report');
  A.eq('«Изменилось ли предложение…»', mode('Изменилось ли предложение carmoney.ru по ставкам?'), 'change_report');
  // Source counts -> comparison / synthesis.
  A.eq('two explicit sources -> comparison', mode('Сравни autolombardn1.ru и carmoney.ru'), 'comparison');
  A.eq('three explicit sources -> synthesis', mode('Проанализируй a1.ru b2.ru c3.ru вместе'), 'synthesis');
  // Refresh phrasing is EXECUTION, not analysis mode — a refresh of one source is still source_analysis.
  const rp = RP.deterministicPlan('Обнови данные по autolombardn1.ru', cfg);
  A.eq('refresh stays source_analysis', rp.analysis_mode, 'source_analysis');
  A.eq('…and still requests refresh', rp.source_execution_mode, 'refresh');
  // «что изменилось» must not read as a refresh (change_report answers from stored snapshots).
  const cp = RP.deterministicPlan('Что изменилось у autolombardn1.ru?', cfg);
  A.eq('change question does not force a paid re-collection', cp.force_reprocess, false);
}

A.section('mode is plan identity + persisted');
{
  const p1 = RP.deterministicPlan('Проанализируй сайт autolombardn1.ru', cfg);
  const p2 = RP.deterministicPlan('Что изменилось у autolombardn1.ru?', cfg);
  A.ok('different modes hash differently (approval cannot cross over)', RP.planHash(p1) !== RP.planHash(p2));
  A.ok('different modes fingerprint differently (no pending-plan cross-reuse)',
    RP.planFingerprint(p1, { owner_user_id: 'u1', chat_id: 'c1' }) !== RP.planFingerprint(p2, { owner_user_id: 'u1', chat_id: 'c1' }));
  const row = RP.buildPlanRow(p2, RP.planIdentity(p2, 'req_x', 1), { agent_request_id: 'req_x', owner_user_id: 'u1', chat_id: 'c1', ts: 'now' });
  A.eq('plan row persists the mode', row.analysis_mode, 'change_report');
  // a stored row and its in-memory plan fingerprint identically (legacy rows normalize to the default).
  A.eq('row/plan fingerprint parity', RP.planFingerprint(row, {}), RP.planFingerprint(p2, { owner_user_id: 'u1', chat_id: 'c1' }));
  const legacy = Object.assign({}, row); delete legacy.analysis_mode;
  const pDefault = RP.deterministicPlan('Проанализируй сайт autolombardn1.ru', cfg);
  A.eq('legacy row without the column reads as the default mode',
    RP.planFingerprint(Object.assign({}, RP.buildPlanRow(pDefault, RP.planIdentity(pDefault, 'req_y', 1), { agent_request_id: 'req_y', owner_user_id: 'u1', chat_id: 'c1', ts: 'now' }), { analysis_mode: '' }), {}),
    RP.planFingerprint(pDefault, { owner_user_id: 'u1', chat_id: 'c1' }));
  A.eq('normalizePlan rejects unknown modes to the default', RP.normalizePlan({ analysis_mode: 'hack_mode' }, cfg).analysis_mode, 'source_analysis');
}

A.section('approval message names the mode in Russian (no enum leak)');
{
  const p = RP.deterministicPlan('Что изменилось у autolombardn1.ru?', cfg);
  const msg = PR.planApprovalMessageRu(p, { cost: { projected_cost_usd: 0.05, reliable: true, cost_low_usd: 0.05, cost_high_usd: 0.08, breakdown: {} } });
  A.ok('change_report renders its Russian label', msg.text.indexOf('отчёт об изменениях') >= 0);
  A.ok('the enum itself never appears', msg.text.indexOf('change_report') < 0);
  const pd = RP.deterministicPlan('Проанализируй сайт autolombardn1.ru', cfg);
  const md = PR.planApprovalMessageRu(pd, { cost: { projected_cost_usd: 0.05, reliable: true, cost_low_usd: 0.05, cost_high_usd: 0.08, breakdown: {} } });
  A.ok('default mode adds no extra line (message unchanged for the common case)', md.text.indexOf('Тип отчёта') < 0);
}

A.section('WF20 propagation — plan → WF28 type → summary → bundle');
{
  const rap = node(wf20, 'Resolve Approved Plan').parameters.jsCode;
  A.ok('Resolve Approved Plan reads the persisted mode', /analysis_mode:String\(row\.analysis_mode\|\|'source_analysis'\)/.test(rap));
  const w28 = node(wf20, 'Run WF28 (Claude Analyst)');
  const at = JSON.stringify(w28.parameters);
  A.ok('WF28 receives the plan mode as analysis_type', at.indexOf("analysis_mode || 'source_analysis'") >= 0 && at.indexOf("'single_source'") < 0);
  const sum = node(wf20, 'Build Execution Summary').parameters.jsCode;
  A.ok('summary persists analysis_mode', /analysis_mode:String\(\(g\.plan&&g\.plan\.analysis_mode\)\|\|'source_analysis'\)/.test(sum));
  const bun = node(wf20, 'Shape Report Bundle').parameters.jsCode;
  A.ok('bundle carries analysis_mode', /b\.analysis_mode=String\(\(s\.summary&&s\.summary\.analysis_mode\)/.test(bun));
}

A.section('cache alias — legacy single_source rows stay reusable as source_analysis');
{
  const row = { analysis_id: 'an_old', owner_user_id: 'u1', analysis_type: 'single_source',
    evidence_package_hash: 'h1', schema_version: 'v1', prompt_version: 'p1', model: 'm1',
    structured_result_json: '{"overall_confidence":0.8}', quality_status: 'ok', created_at: '2026-07-17T08:00:00Z' };
  const ctx = { owner_user_id: 'u1', analysis_type: 'source_analysis', evidence_package_hash: 'h1',
    schema_version: 'v1', prompt_version: 'p1', model: 'm1' };
  A.ok('source_analysis ctx matches a legacy single_source row', !!LT.findReusableAnalysis([row], ctx));
  A.eq('change_report ctx does NOT match a source_analysis row',
    LT.findReusableAnalysis([row], Object.assign({}, ctx, { analysis_type: 'change_report' })), null);
  A.eq('synthesis never matches single-source rows',
    LT.findReusableAnalysis([row], Object.assign({}, ctx, { analysis_type: 'synthesis' })), null);
}

A.section('XLSX tech sheet records the mode (hidden only)');
{
  const sheets = RPKG.buildSheets({ report_id: 'r', agent_request_id: 'q', analysis_mode: 'change_report',
    competitors: [], offers: [], recommendations: [], evidence: [], source_quality: [], changes: [], summary: {} });
  const tech = sheets.find(s => s.name === 'Технические данные');
  A.eq('tech sheet carries analysis_mode', tech.rows[0].analysis_mode, 'change_report');
  A.ok('tech sheet stays hidden', tech.hidden === true);
  A.eq('missing mode reads as the default', RPKG.buildSheets({ report_id: 'r', agent_request_id: 'q', summary: {} })
    .find(s => s.name === 'Технические данные').rows[0].analysis_mode, 'source_analysis');
}

A.report('analysis-modes');
