'use strict';
// B4 — owner-scoped plan-fingerprint deduplication. An equivalent non-terminal request must reuse the existing
// plan (not create a 2nd awaiting_approval); a materially different one creates a new plan; terminal/stale plans
// never block. Offline, $0. Also asserts the WF18 generator wires the reuse branch (Persist New Plan? gate).
const A = require('./_assert.js');
const P = require('../n8n/lib/request_planner.js');
const fs = require('fs'); const path = require('path');

const ctxA = { owner_user_id: '111', chat_id: '111' };
const planWeb = { intent: 'competitor_search', niche: 'credit', service: '', region: 'Москва/МО', sources: ['website'], urls: ['https://autolombardn1.ru'], telegram_channels: [], vk_communities: [], max_items: 10, expected_output: 'report', data_mode: 'live' };

A.section('planFingerprint — order-independent, owner-scoped, field-sensitive');
{
  const fp = P.planFingerprint(planWeb, ctxA);
  A.ok('fingerprint is a stable string', typeof fp === 'string' && fp.indexOf('fp') === 0);
  // source order must not change the fingerprint
  const reordered = Object.assign({}, planWeb, { sources: ['website'], urls: ['https://autolombardn1.ru'] });
  A.eq('same request, same fp', P.planFingerprint(reordered, ctxA), fp);
  const multi = Object.assign({}, planWeb, { urls: ['https://b.ru', 'https://a.ru'] });
  const multiRev = Object.assign({}, planWeb, { urls: ['https://a.ru', 'https://b.ru'] });
  A.eq('url order-independent', P.planFingerprint(multi, ctxA), P.planFingerprint(multiRev, ctxA));
  // different owner => different fp
  A.ok('owner-scoped', P.planFingerprint(planWeb, { owner_user_id: '222', chat_id: '222' }) !== fp);
  // material change => different fp
  A.ok('different region => new fp', P.planFingerprint(Object.assign({}, planWeb, { region: 'Санкт-Петербург' }), ctxA) !== fp);
  A.ok('different source => new fp', P.planFingerprint(Object.assign({}, planWeb, { urls: ['https://other.ru'] }), ctxA) !== fp);
  A.ok('different window (max_items) => new fp', P.planFingerprint(Object.assign({}, planWeb, { max_items: 25 }), ctxA) !== fp);
  // fingerprint of a STORED row (comma/space-joined strings) equals the in-memory plan's
  const row = P.buildPlanRow(planWeb, P.planIdentity(planWeb, 'req_1', 1), Object.assign({ agent_request_id: 'req_1', ts: '2026-07-16T10:00:00+03:00' }, ctxA));
  A.eq('stored row fp == in-memory plan fp', P.planFingerprint(row, { owner_user_id: '111', chat_id: '111' }), fp);
}

A.section('findReusablePlan — reuse / new / terminal / TTL / owner isolation');
{
  const now = Date.parse('2026-07-16T12:00:00+03:00');
  const existing = P.buildPlanRow(planWeb, P.planIdentity(planWeb, 'req_old', 1), Object.assign({ agent_request_id: 'req_old', ts: '2026-07-16T11:55:00+03:00' }, ctxA));
  // an equivalent new request (fresh agent_request_id) reuses the existing awaiting_approval plan
  const r1 = P.findReusablePlan([existing], planWeb, ctxA, { now_ms: now, ttl_min: 30 });
  A.ok('equivalent request => reused', r1.reused === true);
  A.eq('reuses the canonical (existing) plan_id', r1.plan.plan_id, existing.plan_id);
  A.eq('reuses the existing agent_request_id', r1.plan.agent_request_id, 'req_old');
  // a materially different request creates a new plan (no reuse)
  const r2 = P.findReusablePlan([existing], Object.assign({}, planWeb, { region: 'Санкт-Петербург' }), ctxA, { now_ms: now });
  A.ok('different region => NOT reused', r2.reused === false);
  // a terminal duplicate never blocks a new request
  const done = Object.assign({}, existing, { status: 'completed' });
  A.ok('completed plan does not block', P.findReusablePlan([done], planWeb, ctxA, { now_ms: now }).reused === false);
  const cancelled = Object.assign({}, existing, { status: 'cancelled' });
  A.ok('cancelled plan does not block', P.findReusablePlan([cancelled], planWeb, ctxA, { now_ms: now }).reused === false);
  // a stale awaiting_approval (older than TTL) is abandoned, not reused
  const stale = Object.assign({}, existing, { created_at: '2026-07-16T11:00:00+03:00' }); // 60 min old
  A.ok('stale awaiting_approval abandoned (TTL)', P.findReusablePlan([stale], planWeb, ctxA, { now_ms: now, ttl_min: 30 }).reused === false);
  // an approved (in-flight) plan still blocks a duplicate (already running)
  const approved = Object.assign({}, existing, { status: 'approved' });
  A.ok('in-flight approved plan blocks a duplicate', P.findReusablePlan([approved], planWeb, ctxA, { now_ms: now, ttl_min: 30 }).reused === true);
  // owner isolation: another owner's equivalent plan does not match
  const other = Object.assign({}, existing, { owner_user_id: '222', chat_id: '222' });
  A.ok('other owner does not match', P.findReusablePlan([other], planWeb, ctxA, { now_ms: now }).reused === false);
  // newest wins when several non-terminal equivalents exist
  const older = Object.assign({}, existing, { plan_id: 'plan_older', created_at: '2026-07-16T11:50:00+03:00' });
  const newer = Object.assign({}, existing, { plan_id: 'plan_newer', created_at: '2026-07-16T11:58:00+03:00' });
  A.eq('newest equivalent chosen', P.findReusablePlan([older, newer], planWeb, ctxA, { now_ms: now }).plan.plan_id, 'plan_newer');
}

A.section('WF18 generator wires the reuse branch (no duplicate append on reuse)');
{
  const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '18_telegram_agent_gateway.json'), 'utf8'));
  const names = wf.nodes.map(n => n.name);
  A.ok('has a Persist New Plan? gate', names.indexOf('Persist New Plan?') >= 0);
  const hpr = wf.nodes.find(n => n.name === 'Handle Plan Result');
  A.ok('Handle Plan Result calls findReusablePlan', hpr.parameters.jsCode.indexOf('findReusablePlan') >= 0);
  A.ok('Handle Plan Result emits plan_reused', hpr.parameters.jsCode.indexOf('plan_reused') >= 0);
  // reused branch skips Append and goes straight to Shape Awaiting State
  const conns = wf.connections['Persist New Plan?'].main;
  const flat = JSON.stringify(conns);
  A.ok('true branch -> Append execution_plans', flat.indexOf('Append execution_plans') >= 0);
  A.ok('false(reused) branch -> Shape Awaiting State', flat.indexOf('Shape Awaiting State') >= 0);
}

A.report('plan-dedup');
