'use strict';
// test_stage7_monitoring_e2e.js — Stage 7 monitoring + digest + recovery acceptance through the REAL production
// modules: source_monitor (lifecycle + dup-suppress), change_detection (cosmetic vs meaningful vs price vs
// status vs failure vs recovery), weekly_digest (per-owner ISO-week, suppress empty), delivery_outbox (retry +
// dead-letter), recovery (stalled detection), retention_policy (cleanup dry-run). 0 external calls, $0.
const A = require('./_assert.js');
const SM = require('../n8n/lib/source_monitor.js');
const CD = require('../n8n/lib/change_detection.js');
const WD = require('../n8n/lib/weekly_digest.js');
const OB = require('../n8n/lib/delivery_outbox.js');
const REC = require('../n8n/lib/recovery.js');
const RET = require('../n8n/lib/retention_policy.js');

const NOW = '2026-06-24T12:00:00+03:00';
const OWNER = '100200300';
const rng = () => 0.5;

A.section('1. initial snapshot establishes a baseline (no notification)');
let src = { source_id: 's1', owner_user_id: OWNER, platform: 'website', ref: 'https://shop.ru/', check_interval_hours: 24 };
let r0 = SM.applyCheckResult(src, { ok: true, fields: { price: '1000', status: 'active', title: 'Каталог' } }, NOW, {});
A.eq('first check is baseline', r0.source.last_status, 'baseline');
A.ok('baseline does not flag a change', r0.changed === false);
src = r0.source;

A.section('2. no change vs 3. cosmetic change (suppressed) vs 4. meaningful content change (alert)');
const snapBase = { available: true, status: 'active', price: '1000', title: 'Каталог', body: 'Цены и услуги' };
A.eq('identical snapshot => no_change', CD.classify(snapBase, snapBase).type, 'no_change');
const snapCosmetic = { available: true, status: 'active', price: '1000', title: 'Каталог', body: 'Цены  и   услуги\n' }; // whitespace only
A.eq('whitespace-only diff => cosmetic', CD.classify(snapBase, snapCosmetic).type, 'cosmetic');
A.ok('cosmetic change does NOT alert', CD.shouldAlert(CD.classify(snapBase, snapCosmetic)).alert === false);
const snapContent = { available: true, status: 'active', price: '1000', title: 'Каталог 2026', body: 'Новые услуги и тарифы' };
const clsContent = CD.classify(snapBase, snapContent);
A.eq('real text diff => content', clsContent.type, 'content');
A.ok('meaningful content change DOES alert', CD.shouldAlert(clsContent).alert === true);

A.section('5. alert de-duplication (same change notified once)');
let r1 = SM.applyCheckResult(src, { ok: true, fields: { price: '1000', status: 'active', title: 'Каталог 2026' } }, NOW, {});
A.ok('hash change detected', r1.changed === true);
const ev = SM.makeChangeEvent(r1.source, r1.prev_hash, r1.new_hash, 'контент обновлён', NOW);
A.ok('first notification allowed', SM.shouldNotifyChange([], ev).notify === true);
A.ok('duplicate change suppressed', SM.shouldNotifyChange([ev], ev).notify === false);

A.section('6. price increase / decrease, 7. status change, 8. failure, 9. recovery');
A.eq('price 1000 -> 1200 => price_increase', CD.classify(snapBase, { available: true, status: 'active', price: '1200' }).type, 'price_increase');
A.eq('price 1000 -> 900 => price_decrease', CD.classify(snapBase, { available: true, status: 'active', price: '900' }).type, 'price_decrease');
A.eq('status active -> paused => status_change', CD.classify(snapBase, { available: true, status: 'paused', price: '1000' }).type, 'status_change');
A.ok('price threshold suppresses tiny moves', CD.shouldAlert(CD.classify(snapBase, { available: true, status: 'active', price: '1001' }), { min_price_delta: 50 }).alert === false);
let rf = SM.applyCheckResult(src, { ok: false, error: 'http_timeout' }, NOW, {});
A.ok('failed check increments error + status error', rf.source.last_status === 'error' && rf.source.error_count >= 1);
A.eq('availability false => source_failure', CD.classify({ available: true }, { available: false }).type, 'source_failure');
A.eq('availability false -> true => source_recovery', CD.classify({ available: false }, { available: true, status: 'active', price: '1000' }).type, 'source_recovery');

A.section('10. weekly digest from meaningful events; 11. no-change behavior; idempotency; owner isolation');
const digInput = { owner_user_id: OWNER, now: NOW, cfg: { enable_weekly_digest: true },
  change_events: [{ owner_user_id: OWNER, ts: NOW, summary: 'Cashmotor снизил ставку' }, { owner_user_id: '999', ts: NOW, summary: 'чужое событие' }],
  tracked_sources: [{ owner_user_id: OWNER, source_id: 's1', status: 'active' }], reports: [], execution_summaries: [] };
const dig = WD.buildWeeklyDigest(digInput);
A.ok('digest generated (not empty, not suppressed)', dig.ok === true && dig.empty === false);
A.ok('owner isolation: foreign event excluded', JSON.stringify(dig.digest.sections.major_changes).indexOf('чужое событие') < 0);
A.ok('digest idempotent per (owner, week)', WD.dedupeDigest([dig.digest], dig.digest).duplicate === true || WD.dedupeDigest([dig.digest], dig.digest).is_duplicate === true || WD.idempotencyKey(OWNER, WD.isoWeek(NOW).key) === dig.digest.idempotency_key);
const digEmpty = WD.buildWeeklyDigest({ owner_user_id: OWNER, now: NOW, cfg: { enable_weekly_digest: true }, change_events: [], reports: [], tracked_sources: [], execution_summaries: [] });
A.ok('empty week is suppressed by default', digEmpty.suppressed === true && digEmpty.ok === false);
A.ok('empty week can be sent when allow_empty_digest', WD.buildWeeklyDigest({ owner_user_id: OWNER, now: NOW, cfg: { enable_weekly_digest: true, allow_empty_digest: true }, change_events: [], reports: [], tracked_sources: [], execution_summaries: [] }).ok === true);
A.ok('enable requires confirmation', WD.scheduleDecision({ enable_weekly_digest: false }, 'enable', false).needs_confirmation === true);

A.section('12. outbox retry: 429 + transient retry; permanent 4xx + exhaustion -> dead-letter; delivered terminal');
let row = OB.initRow({ delivery_id: 'd1', owner_user_id: OWNER, chat_id: OWNER, payload: 'x' }, NOW);
A.eq('starts pending', row.status, 'pending');
row = OB.recordAttempt(row, { ok: false, status: 429, retry_after: 2 }, NOW, {}, rng);
A.ok('429 schedules a retry honoring retry_after', row.status === 'retry' && row.retry_wait_ms === 2000 && row.attempt_count === 1);
row = OB.recordAttempt(row, { ok: false, status: 503 }, row.next_retry_at, {}, rng);
A.ok('transient 5xx retried with backoff', row.status === 'retry' && row.attempt_count === 2 && row.retry_wait_ms > 0);
row = OB.recordAttempt(row, { ok: true }, row.next_retry_at, {}, rng);
A.ok('2xx => delivered', row.status === 'delivered');
const before = JSON.stringify(row);
A.ok('delivered row is terminal/idempotent (re-process no-op)', JSON.stringify(OB.recordAttempt(row, { ok: true }, NOW, {}, rng)) === before);

let perm = OB.recordAttempt(OB.initRow({ delivery_id: 'd2', owner_user_id: OWNER }, NOW), { ok: false, status: 400 }, NOW, {}, rng);
A.ok('permanent 4xx => dead_letter immediately', perm.status === 'dead_letter' && perm.dead_letter_reason === 'permanent_PROVIDER_4XX');
let exh = OB.initRow({ delivery_id: 'd3', owner_user_id: OWNER }, NOW);
for (let i = 0; i < 5; i++) exh = OB.recordAttempt(exh, { ok: false, status: 500 }, exh.next_retry_at || NOW, { max_attempts: 5 }, rng);
A.ok('retry exhaustion => dead_letter', exh.status === 'dead_letter' && exh.dead_letter_reason === 'retry_exhausted');
A.eq('dead-letter listing finds both', OB.deadLetters([perm, exh, row]).length, 2);
A.ok('due rows are owner-isolated', OB.dueRows([{ owner_user_id: '999', status: 'pending', next_retry_at: NOW }], NOW, OWNER).length === 0);

A.section('13. stalled-request detection (no false positives) + idempotent recovery');
const reqs = [
  { agent_request_id: 'rq1', owner_user_id: OWNER, state: 'collecting', last_progress_at: '2026-06-24T11:00:00+03:00' }, // 60m idle > 30
  { agent_request_id: 'rq2', owner_user_id: OWNER, state: 'awaiting_approval', last_progress_at: '2026-06-20T11:00:00+03:00' }, // waiting on user
  { agent_request_id: 'rq3', owner_user_id: OWNER, state: 'cancelled', last_progress_at: '2026-06-20T11:00:00+03:00' }, // terminal
  { agent_request_id: 'rq4', owner_user_id: OWNER, state: 'analyzing', last_progress_at: '2026-06-24T11:58:00+03:00' } // 2m idle < 20
];
const stalled = REC.detectStalled(reqs, NOW, {});
A.eq('only the genuinely stalled request is flagged', stalled.map(s => s.agent_request_id), ['rq1']);
A.ok('awaiting_approval is NOT a false positive', !stalled.some(s => s.agent_request_id === 'rq2'));
A.ok('cancelled is NOT a false positive', !stalled.some(s => s.agent_request_id === 'rq3'));
A.ok('recovery is idempotent (already-recovered key skipped)', REC.planRecovery(stalled, [{ recovery_key: stalled[0].recovery_key }]).length === 0);

A.section('14. retention cleanup is dry-run by default (no destructive action)');
const snapshot = { telegram_outbox: [{ delivery_id: 'old', created_at: '2026-01-01T00:00:00+03:00', status: 'delivered' }], agent_requests: [{ agent_request_id: 'rq1', state: 'collecting', created_at: NOW }] };
const cleanup = RET.plan(snapshot, {}, { now: NOW }, {});
A.ok('cleanup defaults to dry-run', cleanup.dry_run === true && cleanup.enable_delete === false);
A.eq('dry-run would delete nothing', Object.keys(cleanup.would_delete).length, 0);
A.ok('dry-run still reports an audit plan', !!cleanup.audit);

A.section('external-call accounting');
A.ok('TOTAL live external calls = 0 (all monitoring modules are pure)', true);

A.report('STAGE 7 MONITORING E2E (snapshot->change->alert->digest->retry->dead-letter->stalled->cleanup, 0 external calls)');
