'use strict';
// test_weekly_digest.js — one digest per owner per ISO week, built only from stored data: owner isolation,
// same-week dedupe, empty suppression, existing-changes-only, degraded sources, manual request, schedule
// disabled by default + confirmation to toggle, NO external collection (Sections 11 / 21).
const A = require('./_assert.js');
const W = require('../n8n/lib/weekly_digest.js');
const F = require('./fixtures/report_fixtures.js');

const OWNER = F.OWNER;
const current = F.currentReport();   // report_20260621 (ISO 2026-W25)
const prior = F.priorReport();       // report_20260614 (ISO 2026-W24) -> baseline
const other = F.unrelatedReport();   // different owner 999999

A.section('ISO week + deterministic ids');
A.eq('current in W25', W.isoWeek(current.created_at).key, '2026-W25');
A.eq('prior in W24', W.isoWeek(prior.created_at).key, '2026-W24');
A.eq('digest id deterministic', W.digestId(OWNER, '2026-W25'), 'digest_' + OWNER + '_2026-W25');
A.eq('idempotency == (owner, week)', W.idempotencyKey(OWNER, '2026-W25'), W.digestId(OWNER, '2026-W25'));

A.section('build from stored reports only (no recollection)');
const changeEvents = [
  { change_id: 'cashmotor.ru::h1', owner_user_id: OWNER, platform: 'website', ref: 'cashmotor.ru', summary: 'Cashmotor снизил ставку до 4,5%', ts: '2026-06-19T08:00:00+03:00' },
  { change_id: 'other::h9', owner_user_id: '999999', platform: 'website', ref: 'x.ru', summary: 'не мой источник', ts: '2026-06-19T08:00:00+03:00' }
];
const tracked = [
  { source_id: 's1', owner_user_id: OWNER, platform: 'website', ref: 'cashmotor.ru', label: 'Cashmotor', status: 'active' },
  { source_id: 's2', owner_user_id: OWNER, platform: 'website', ref: 'carcapital.ru', label: 'CarCapital', status: 'degraded' },
  { source_id: 's3', owner_user_id: OWNER, platform: 'vk', ref: 'vk.com/x', label: 'VK X', status: 'setup_required' },
  { source_id: 's9', owner_user_id: '999999', platform: 'website', ref: 'foreign.ru', label: 'Foreign', status: 'active' }
];
const res = W.buildWeeklyDigest({
  owner_user_id: OWNER, now: '2026-06-21T12:00:00+03:00',
  reports: [current, prior, other], change_events: changeEvents, tracked_sources: tracked, cfg: {}
});
A.ok('digest emitted (not suppressed)', res.ok === true && res.suppressed === false);
const d = res.digest;
A.eq('zero external calls', d.external_calls, 0);
A.eq('current report linked', d.current_report_id, 'report_20260621_101500');
A.eq('baseline is prior week report', d.baseline_report_id, 'report_20260614_101500');

A.section('owner isolation — no foreign rows leak in');
A.ok('foreign change excluded', d.sections.major_changes.indexOf('не мой источник') < 0);
A.ok('cashmotor change included', d.sections.major_changes.some(m => /Cashmotor/.test(m)));
A.ok('foreign source not counted', d.sections.monitoring_status.tracked === 3);

A.section('changes derived from stored report diff');
A.ok('rate change Cashmotor 5,5->4,5', d.sections.rate_changes.some(r => r.competitor === 'Cashmotor' && r.before === '5,5%' && r.after === '4,5%' && r.direction === 'down'));
A.ok('new competitor AvtoDengi', d.sections.new_competitors.some(c => c.competitor === 'AvtoDengi'));
A.ok('new offer AvtoDengi', d.sections.new_offers.some(o => o.competitor === 'AvtoDengi'));
A.ok('degraded sources listed (CarCapital + VK setup)', d.sections.degraded_sources.some(s => /carcapital/.test(s.ref)) );
A.ok('unavailable VK listed', d.sections.unavailable_sources.some(s => s.platform === 'vk' && s.status === 'setup_required'));

A.section('high-priority recommendations from stored report');
A.ok('high priority only', d.sections.high_priority_recommendations.length === 1 && /ставку ниже рынка/.test(d.sections.high_priority_recommendations[0].recommendation));

A.section('call summary from stored run_metadata; cost honesty');
A.eq('external calls from report', d.sections.call_summary.external_calls, 6);
A.eq('llm cost status honest', d.sections.call_summary.llm_cost_status, 'unknown');

A.section('text + report links');
A.ok('text mentions week', /2026-W25/.test(d.text));
A.ok('report link present', d.sections.report_links.some(r => r.report_id === 'report_20260621_101500'));

A.section('empty week is suppressed unless explicitly enabled');
const emptyRes = W.buildWeeklyDigest({ owner_user_id: OWNER, now: '2026-07-05T12:00:00+03:00', reports: [current, prior], change_events: [], tracked_sources: [{ source_id: 's1', owner_user_id: OWNER, platform: 'website', ref: 'cashmotor.ru', status: 'active' }], cfg: {} });
A.ok('empty week detected', emptyRes.empty === true);
A.ok('empty week suppressed by default', emptyRes.suppressed === true && emptyRes.ok === false);
const emptyForced = W.buildWeeklyDigest({ owner_user_id: OWNER, now: '2026-07-05T12:00:00+03:00', reports: [current, prior], change_events: [], tracked_sources: [], cfg: { allow_empty_digest: true } });
A.ok('empty week emitted when allowed', emptyForced.empty === true && emptyForced.suppressed === false);
A.ok('empty text states no changes', /значимых изменений не зафиксировано/.test(emptyForced.digest.text));

A.section('one digest per owner per ISO week (dedupe)');
const existing = [{ digest_id: d.digest_id, owner_user_id: OWNER, iso_week: '2026-W25', idempotency_key: d.idempotency_key }];
A.ok('same week not re-emitted', W.dedupeDigest(existing, d).emit === false);
const nextWeek = W.buildWeeklyDigest({ owner_user_id: OWNER, now: '2026-06-28T12:00:00+03:00', reports: [current, prior], change_events: changeEvents.slice(0, 1), tracked_sources: tracked }).digest;
A.ok('different week is allowed', W.dedupeDigest(existing, nextWeek).emit === true);

A.section('schedule disabled by default; enable/disable requires confirmation');
const enAsk = W.scheduleDecision({}, 'enable', false);
A.ok('enable without confirm asks', enAsk.needs_confirmation === true && enAsk.changed === false);
const enDo = W.scheduleDecision({}, 'enable', true);
A.ok('enable confirmed changes', enDo.changed === true && enDo.enabled === true);
const disAsk = W.scheduleDecision({ enable_weekly_digest: true }, 'disable', false);
A.ok('disable without confirm asks', disAsk.needs_confirmation === true);
const disDo = W.scheduleDecision({ enable_weekly_digest: true }, 'disable', true);
A.ok('disable confirmed changes', disDo.changed === true && disDo.enabled === false);

A.report('weekly-digest');
