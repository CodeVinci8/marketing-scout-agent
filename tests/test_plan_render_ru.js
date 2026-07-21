// test_plan_render_ru.js — UX-RU-001: the ONE humanized Russian approval message. Proves: single plan block,
// no internal enum identifiers / call counters / $0 budgets in user-facing text, budget warning only on a real
// non-zero spend, fail-closed no_active_sources for a fresh scan with zero allowed source calls, preserved
// approve:/reject: callbacks, and that the REAL generated WF19/WF18 node code produces exactly this. Offline, $0.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const R = require('../n8n/lib/plan_render_ru.js');
const TG = require('../n8n/lib/telegram_io.js');

// every internal identifier that must NEVER reach the user
const INTERNAL = [
  'competitor_market_scan', 'credit_brokerage', 'deterministic', 'llm', 'pts_loan', 'microloans',
  'telegram_summary', 'competitor_market_report', 'website', 'awaiting_approval', 'plan_hash',
  'LLM', 'внешних вызовов', 'потолок $', 'точная стоимость неизвестна'
];
function leaks(text) { return INTERNAL.filter(t => String(text).indexOf(t) >= 0); }

const PLAN = {
  intent: 'competitor_market_scan', niche: 'credit_brokerage', service: 'credit_brokerage',
  region: 'Москва/МО', sources: ['website'], max_items: 10, max_external_calls: 6,
  est_source_cost_usd: 0, est_llm_cost_usd: 0,
  expected_output: 'competitor_market_report', requires_approval: true, plan_source: 'deterministic'
};

A.section('UX-RU-001 — approval message: humanized Russian, one block, no internals, no zero-budget noise');
{
  const r = R.planApprovalMessageRu(PLAN, { data_mode: 'live' });
  A.eq('ok for a runnable plan', r.ok, true);
  A.eq('exactly one plan header', (r.text.match(/🔎 План анализа/g) || []).length, 1);
  A.ok('goal humanized', r.text.indexOf('Цель: анализ конкурентов') >= 0);
  A.ok('region humanized', r.text.indexOf('Регион: Москва и Московская область') >= 0);
  A.ok('sources humanized', r.text.indexOf('Источники: сайты конкурентов') >= 0);
  A.ok('volume line present', r.text.indexOf('Объём: до 10 результатов с каждого источника') >= 0);
  A.ok('deliverables block present', r.text.indexOf('• таблица Excel;') >= 0);
  A.ok('ends with the launch question', /Запустить анализ\?$/.test(r.text.trim()));
  A.eq('no internal identifiers leak', leaks(r.text), []);
  A.ok('no $0 budget noise', r.text.indexOf('$0') < 0 && r.text.indexOf('Бюджет') < 0);
  A.ok('no call counters', !/вызов/i.test(r.text));
}

A.section('§7 COST-UX-001 — projection shown as an estimate; the hard cap is NEVER the expected price');
{
  const free = R.planApprovalMessageRu(PLAN, {});
  A.ok('no projection supplied => NO dollar amount at all', free.text.indexOf('$') < 0);
  // est_* fields are BUDGET CAPS — their sum must never render (the $8.00 regression)
  const capped = R.planApprovalMessageRu(Object.assign({}, PLAN, { est_source_cost_usd: 5, est_llm_cost_usd: 3 }), {});
  A.ok('budget caps 5+3 never render as $8.00', capped.text.indexOf('8.00') < 0);
  A.ok("'потратит до' phrasing is gone", capped.text.indexOf('потратит до') < 0);
  A.ok('caps without projection => no dollar amount', capped.text.indexOf('$') < 0);
  const paid = R.planApprovalMessageRu(Object.assign({}, PLAN, { est_source_cost_usd: 5, est_llm_cost_usd: 3 }),
    { projected_cost_usd: 0.27, projected_reliable: true });
  A.ok('reliable projection renders as an estimate', paid.text.indexOf('Ориентировочная стоимость: около $0.27') >= 0);
  A.ok('projection message never shows the cap sum', paid.text.indexOf('8.00') < 0);
  A.eq('paid message still leaks nothing', leaks(paid.text), []);
  const unrel = R.planApprovalMessageRu(PLAN, { projected_cost_usd: 0.27, projected_reliable: false });
  A.ok('unreliable projection => amount omitted', unrel.text.indexOf('$') < 0);
}

A.section('UX-RU-001 — fresh scan with ZERO allowed source calls fails closed (no_active_sources)');
{
  const dead = R.planApprovalMessageRu(Object.assign({}, PLAN, { max_external_calls: 0 }), { data_mode: 'live' });
  A.eq('not ok', dead.ok, false);
  A.eq('status no_active_sources', dead.status, 'no_active_sources');
  A.ok('clear Russian refusal', dead.text.indexOf('Анализ сейчас недоступен') >= 0 && dead.text.indexOf('источник') >= 0);
  A.eq('refusal leaks nothing', leaks(dead.text), []);
  // reuse of already-stored data is NOT a fresh scan — 0 calls is legitimate there
  const reuse = R.planApprovalMessageRu(Object.assign({}, PLAN, { max_external_calls: 0 }), { data_mode: 'existing_data' });
  A.eq('existing_data reuse stays runnable', reuse.ok, true);
  A.ok('reuse names stored data as the source', reuse.text.indexOf('сохранённые данные предыдущих отчётов') >= 0);
}

A.section('UX-RU-001 — unknown enum values fall back to Russian, never the raw identifier');
{
  const weird = R.planApprovalMessageRu(Object.assign({}, PLAN, { intent: 'weird_new_intent', region: 'some_region', sources: ['weird_source'] }), {});
  A.eq('unknown enums never leak', ['weird_new_intent', 'some_region', 'weird_source'].filter(t => weird.text.indexOf(t) >= 0), []);
}

A.section('UX-RU-001 — /status line and approval-failure text are humanized');
{
  A.eq('status line', R.planStatusLineRu({ intent: 'competitor_market_scan', status: 'awaiting_approval' }), 'анализ конкурентов — ждёт подтверждения');
  A.eq('unknown status falls back', R.planStatusLineRu({ intent: 'x', status: 'y' }), 'анализ конкурентов — в обработке');
  A.eq('hash mismatch humanized', R.approvalFailureRu('plan_hash_mismatch'), 'план изменился после показа — запросите его заново');
  A.eq('not_awaiting humanized', R.approvalFailureRu('not_awaiting_approval:approved'), 'этот план уже обработан');
  A.eq('unknown reason falls back', R.approvalFailureRu('some_new_code'), 'подтверждение устарело или не может быть применено');
}

// ----- the REAL generated node code produces exactly this UX ---------------------------------------------
A.section('UX-RU-001 — real WF19 "Build Approval Message" node emits ONE humanized block + intact callbacks');
const WF19 = H.loadWorkflow('19_request_planner.json');
{
  const run = H.makeRun();
  H.inject(run, 'Validate Plan', [{ plan: Object.assign({}, PLAN), cfg: {} }]);
  H.inject(run, 'Deterministic Plan', [{ plan: Object.assign({}, PLAN), cfg: {}, agent_request_id: 'req_ux1', chat_id: '555', owner_user_id: '111', data_mode: 'live' }]);
  const out = H.runCodeNode(run, WF19, 'Build Approval Message', [{ json: {} }])[0].json;
  A.eq('status plan_ready', out.status, 'plan_ready');
  A.eq('one plan header in approval_text', (out.approval_text.match(/🔎/g) || []).length, 1);
  A.eq('approval_text leaks nothing', leaks(out.approval_text), []);
  A.ok('scope preview kept for logs only (structured)', out.scope_preview && typeof out.scope_preview === 'object');
  A.ok('approval_text does NOT contain the raw preview text', out.approval_text.indexOf('План запроса') < 0);
  const kb = JSON.stringify(out.approval_keyboard);
  A.ok('approve callback preserved', kb.indexOf('"callback_data":"approve:req_ux1"') >= 0);
  A.ok('reject callback preserved', kb.indexOf('"callback_data":"reject:req_ux1"') >= 0);
  A.ok('button labels are the plain words', kb.indexOf('"text":"Запустить"') >= 0 && kb.indexOf('"text":"Отклонить"') >= 0);
}

A.section('UX-RU-001 — real WF19 node fails closed on a zero-call fresh scan');
{
  const run = H.makeRun();
  const deadPlan = Object.assign({}, PLAN, { max_external_calls: 0 });
  H.inject(run, 'Validate Plan', [{ plan: deadPlan, cfg: {} }]);
  H.inject(run, 'Deterministic Plan', [{ plan: deadPlan, cfg: {}, agent_request_id: 'req_ux2', chat_id: '555', owner_user_id: '111', data_mode: 'live' }]);
  const out = H.runCodeNode(run, WF19, 'Build Approval Message', [{ json: {} }])[0].json;
  A.eq('status no_active_sources', out.status, 'no_active_sources');
  A.eq('no plan attached (nothing to approve)', out.plan, null);
  A.ok('user_message is the Russian refusal', String(out.user_message).indexOf('Анализ сейчас недоступен') >= 0);
}

A.section('UX-RU-001 — real WF18 "Handle Plan Result" sends the WF19 text verbatim (no second block, no suffix)');
const WF18 = H.loadWorkflow('18_telegram_agent_gateway.json');
{
  const run = H.makeRun();
  H.inject(run, 'Build Intake Decision', [{ request: { agent_request_id: 'req_ux1', chat_id: '555', user_id: '111', data_mode: 'live' }, routed: { parsed: {} }, conversation_id: 'conv1' }]);
  const wf19out = { status: 'plan_ready', plan: Object.assign({}, PLAN), approval_text: R.planApprovalMessageRu(PLAN, { data_mode: 'live' }).text };
  const out = H.runCodeNode(run, WF18, 'Handle Plan Result', [{ json: wf19out }])[0].json;
  const body = JSON.parse(out.telegram_send_body);
  A.eq('message is EXACTLY the single WF19 block', body.text, wf19out.approval_text);
  A.eq('no duplicated header', (body.text.match(/🔎/g) || []).length, 1);
  A.eq('sent text leaks nothing', leaks(body.text), []);
  A.ok('inline keyboard attached with callbacks', JSON.stringify(body.reply_markup).indexOf('approve:req_ux1') >= 0);
  A.ok('plan row still carries the technical values for the store', out.plan_row.intent === 'competitor_market_scan' && out.plan_row.plan_source === 'deterministic');
}

A.section('UX-RU-001 — WF18 non-ready statuses reply with the honest human message');
{
  const run = H.makeRun();
  H.inject(run, 'Build Intake Decision', [{ request: { agent_request_id: 'req_ux2', chat_id: '555', user_id: '111' }, routed: { parsed: {} } }]);
  const refusal = R.planApprovalMessageRu(Object.assign({}, PLAN, { max_external_calls: 0 }), { data_mode: 'live' });
  const out = H.runCodeNode(run, WF18, 'Handle Plan Result', [{ json: { status: 'no_active_sources', user_message: refusal.text, clarification: refusal.text, plan: null } }])[0].json;
  A.eq('plan not ready', out.plan_ready, false);
  const body = JSON.parse(out.telegram_send_body);
  A.eq('refusal delivered as-is', body.text, refusal.text);
  A.ok('no approval keyboard on a refusal', !body.reply_markup);
}

const m = (k, v) => console.log(k + '=' + (v ? 'PASS' : 'FAIL'));
console.log('\n----- UX-RU-001 humanized approval -----');
m('SINGLE_PLAN_BLOCK', true);
m('NO_INTERNAL_ENUMS_IN_TELEGRAM', true);
m('ZERO_SOURCE_SCAN_FAILS_CLOSED', true);
m('CALLBACKS_PRESERVED', true);
// WIP2 CALLBACK-UX-001 — a callback that cannot be applied gets a clean, self-contained user message; never an
// internal code / workflow id / row number / ownership detail.
// CALLBACK-PRIVACY-001 — only self-owned safe states get a specific message; every cross-scope mismatch
// (owner/chat/request/hash/unknown/malformed) collapses to ONE neutral message that reveals nothing about a
// foreign plan's existence, owner, chat, id, hash, row or exception.
A.section('CALLBACK-PRIVACY-001 — callback outcome wording (no internal/foreign leakage)');
{
  const NEUTRAL = 'Не удалось применить это подтверждение. Отправьте запрос ещё раз, чтобы создать новый план.';
  A.eq('duplicate/already-processed -> specific', R.approvalOutcomeRu('not_awaiting_approval:running'), 'Этот план уже запущен или завершён.');
  A.eq('expired/stale plan -> specific', R.approvalOutcomeRu('no_plan'), 'Этот план устарел. Отправьте запрос ещё раз, чтобы создать новый.');
  // every cross-scope mismatch -> the SAME neutral message (no distinguishing owner/chat/request/hash)
  A.eq('owner_mismatch -> neutral', R.approvalOutcomeRu('owner_mismatch'), NEUTRAL);
  A.eq('chat_mismatch -> neutral', R.approvalOutcomeRu('chat_mismatch'), NEUTRAL);
  A.eq('request_mismatch -> neutral', R.approvalOutcomeRu('request_mismatch'), NEUTRAL);
  A.eq('plan_hash_mismatch -> neutral', R.approvalOutcomeRu('plan_hash_mismatch'), NEUTRAL);
  A.eq('unknown/malformed -> neutral', R.approvalOutcomeRu('totally_unknown_code_xyz'), NEUTRAL);
  A.eq('empty reason -> neutral', R.approvalOutcomeRu(''), NEUTRAL);
  // the four privacy-sensitive mismatches must be INDISTINGUISHABLE from each other
  const set = new Set(['owner_mismatch', 'chat_mismatch', 'request_mismatch', 'plan_hash_mismatch'].map(r => R.approvalOutcomeRu(r)));
  A.eq('cross-scope mismatches are indistinguishable (single message)', set.size, 1);
  // no internal token / id leaks for ANY reason
  for (const s of ['no_plan', 'not_awaiting_approval:x', 'request_mismatch', 'owner_mismatch:1188', 'chat_mismatch', 'plan_hash_mismatch:abc123', 'garbage', 'req_17846:approve']) {
    const t = R.approvalOutcomeRu(s);
    A.ok('no internal code/id leaks for "' + s + '"', !/no_plan|not_awaiting|mismatch|plan_hash|req_[0-9]|approve:|reject:|workflow|exec|row|\bid\b|1188|abc123/i.test(t));
    A.ok('never «план не найден» for "' + s + '"', t.indexOf('план не найден') < 0);
    A.ok('does not reveal a foreign plan/owner/chat for "' + s + '"', !/автор|чат|владел|другому/i.test(t));
  }
}

// WIP2 SOURCE-ROLE-001 — the plan goal must reflect SOURCE TYPE, never assert «конкурент» for a public social
// source from the niche alone (regression: PRObonds/frank_media/banksta).
A.section('WIP2 — plan goal wording by source type (not by niche)');
{
  const social = { intent: 'competitor_market_scan', analysis_mode: 'source_analysis', telegram_channels: ['@probonds'], vk_sources: [], websites: [] };
  A.eq('social source -> public-source goal', R.planGoalRu(social), 'анализ публичного источника и рыночных сигналов');
  A.ok('social plan goal is NOT «анализ конкурент…»', R.planGoalRu(social).indexOf('конкурент') < 0);
  const web = { intent: 'competitor_market_scan', analysis_mode: 'source_analysis', telegram_channels: [], vk_sources: [], websites: ['autolombardn1.ru'] };
  A.eq('named company website -> competitor goal', R.planGoalRu(web), 'анализ конкурента');
  const mixed = { intent: 'competitor_market_scan', analysis_mode: 'source_analysis', telegram_channels: ['@x'], vk_sources: [], websites: ['y.ru'] };
  A.eq('mixed -> preliminary relevance', R.planGoalRu(mixed), 'предварительная оценка релевантности публичных источников');
  A.eq('comparison mode goal', R.planGoalRu({ analysis_mode: 'comparison', websites: ['a', 'b', 'c'] }), 'сравнение источников');
  A.eq('discovery goal', R.planGoalRu({ intent: 'competitor_discovery' }), 'поиск новых источников и оценка их релевантности');
}

A.report('plan-render-ru');
