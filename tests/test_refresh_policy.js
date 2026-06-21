'use strict';
// test_refresh_policy.js — smart refresh: fresh reuse, stale refresh, explicit refresh, user exclusion,
// partial failure, lineage preservation, correct approval plan, unavailable collectors (Sections 7 / 21).
const A = require('./_assert.js');
const P = require('../n8n/lib/refresh_policy.js');

const now = '2026-06-21T10:00:00+03:00';
const cfg = { evidence_max_age_days: 7, source_budget_usd: 0.20, llm_budget_usd: 0.50, freshness_days: { website: 7 } };

const fresh = { ref: 'https://cashmotor.ru/', platform: 'website', last_success_at: '2026-06-20T10:00:00+03:00', last_status: 'unchanged', content_hash: 'c1', source_run_id: 'wf16_0620' };
const stale = { ref: 'https://carcapital.ru/', platform: 'website', last_success_at: '2026-06-01T10:00:00+03:00', last_status: 'unchanged', content_hash: 'c2', source_run_id: 'wf16_0601' };
const missing = { ref: 'https://newsite.ru/', platform: 'website' };
const failed = { ref: 'https://broken.ru/', platform: 'website', last_status: 'error', error_count: 2, source_run_id: '' };
const vk = { ref: 'vk.com/somegroup', platform: 'vk_community', last_success_at: '', source_run_id: '' };

A.section('fresh -> reuse (no call), lineage preserved');
const dFresh = P.decideRefresh(fresh, { now: now, cfg: cfg });
A.eq('decision', dFresh.decision, 'skip_fresh');
A.ok('no call', dFresh.needs_call === false);
A.eq('preserves prior run id', dFresh.preserve_source_run_id, 'wf16_0620');

A.section('stale -> refresh_stale (call)');
const dStale = P.decideRefresh(stale, { now: now, cfg: cfg });
A.eq('decision', dStale.decision, 'refresh_stale');
A.ok('needs call', dStale.needs_call === true);
A.ok('no preserved lineage on refresh', dStale.preserve_source_run_id === '');

A.section('never collected -> refresh_missing');
A.eq('missing decision', P.decideRefresh(missing, { now: now, cfg: cfg }).decision, 'refresh_missing');

A.section('failed -> refresh_failed (retry, not destructive)');
A.eq('failed decision', P.decideRefresh(failed, { now: now, cfg: cfg }).decision, 'refresh_failed');

A.section('explicit refresh request creates a new source run');
const dReq = P.decideRefresh(fresh, { now: now, cfg: cfg, user_instruction: { refresh_only: ['cashmotor.ru'] } });
A.eq('explicit decision', dReq.decision, 'refresh_requested');
A.ok('explicit needs call', dReq.needs_call === true);
// when only some sources are named, the rest are reused
const dRest = P.decideRefresh(stale, { now: now, cfg: cfg, user_instruction: { refresh_only: ['cashmotor.ru'] } });
A.eq('non-named source reused', dRest.decision, 'reuse');

A.section('user exclusion -> never called');
const dExcl = P.decideRefresh(stale, { now: now, cfg: cfg, user_instruction: { exclude: ['carcapital.ru'] } });
A.eq('excluded decision', dExcl.decision, 'skip_excluded');
A.ok('excluded no call', dExcl.needs_call === false);

A.section('unavailable collector -> honest, no call, no fake success');
const dVk = P.decideRefresh(vk, { now: now, cfg: cfg });
A.eq('vk unavailable', dVk.decision, 'unavailable');
A.ok('vk no call', dVk.needs_call === false);
const dVkEnabled = P.decideRefresh(vk, { now: now, cfg: Object.assign({}, cfg, { enable_vk_collector: true }) });
A.ok('vk enabled -> refresh_missing (never collected)', dVkEnabled.decision === 'refresh_missing');

A.section('requested fields missing -> refresh');
const partial = Object.assign({}, fresh, { collected_fields: ['offer'] });
A.eq('missing field triggers refresh', P.decideRefresh(partial, { now: now, cfg: cfg, requested_fields: ['offer', 'price_rate'] }).decision, 'refresh_missing');

A.section('approval plan + zero calls until acted on');
const plan = P.planRefresh([fresh, stale, missing, failed, vk], { now: now, cfg: cfg, user_instruction: { exclude: ['broken.ru'] } });
A.ok('fresh reused', plan.reused.indexOf('https://cashmotor.ru/') >= 0);
A.ok('stale + missing refreshed', plan.refreshed.indexOf('https://carcapital.ru/') >= 0 && plan.refreshed.indexOf('https://newsite.ru/') >= 0);
A.ok('broken excluded', plan.skipped.indexOf('https://broken.ru/') >= 0);
A.ok('vk unavailable listed', plan.unavailable.indexOf('vk.com/somegroup') >= 0);
A.eq('expected calls = 2 (stale + missing)', plan.expected_calls, 2);
A.eq('budgets surfaced', plan.max_source_budget_usd, 0.20);
A.eq('failed refresh never destroys prior report', plan.on_failure, 'keep_previous_report');
A.eq('zero external calls before acting', plan.external_calls_so_far, 0);

A.section('orchestration_decisions persistence rows');
const rows = P.decisionRecords(plan, { agent_request_id: 'req_aaa', conversation_id: 'c1', ts: now });
A.ok('one row per source', rows.length === 5);
A.ok('rows carry decision + reason + flag', rows.every(r => r.decision && r.reason && typeof r.needs_external_call === 'boolean'));
A.ok('reused row preserves lineage', rows.find(r => r.source_ref === 'https://cashmotor.ru/').preserve_source_run_id === 'wf16_0620');

A.report('refresh-policy');
