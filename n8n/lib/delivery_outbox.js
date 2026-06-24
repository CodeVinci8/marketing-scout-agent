'use strict';
// delivery_outbox.js — the Telegram delivery RETRY + DEAD-LETTER state machine (Section 18 / 31 / 6.5).
//
// telegram_io.makeDelivery/shouldSend give a deterministic delivery_id + first-send dedupe. This module adds
// the durable retry lifecycle: a delivery row carries its own attempt_count / next_retry_at / status, so state
// survives a process restart (the row IS the state — no in-memory queue) and a re-process is idempotent. A
// transient failure or 429 (honouring retry_after) schedules a backoff retry; a permanent 4xx or exhausted
// retries transition to dead_letter; a 2xx transitions to delivered exactly once. Owner-isolated. Pure, $0.
//
// Status lifecycle: pending -> sending -> (delivered | retry -> sending | dead_letter).

function str(v) { return v == null ? '' : String(v); }
function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

var DEFAULTS = { max_attempts: 5, base_backoff_ms: 1000, max_backoff_ms: 300000 };

function backoffMs(attempt, cfg, rng) {
  cfg = cfg || {}; var base = num(cfg.base_backoff_ms, DEFAULTS.base_backoff_ms);
  var raw = base * Math.pow(2, Math.max(0, attempt - 1));
  var jitter = (rng ? rng() : 0.5) * base;
  return Math.min(num(cfg.max_backoff_ms, DEFAULTS.max_backoff_ms), Math.round(raw + jitter));
}

// Classify a Telegram send outcome into the retry policy.
//   resp: { ok:true } | { ok:false, status, retry_after } | throws -> pass {network:true}
function classifyOutcome(resp) {
  resp = resp || {};
  if (resp.ok === true) return { result: 'delivered', retryable: false };
  var s = num(resp.status, 0);
  if (resp.network === true || resp.timeout === true) return { result: 'transient', retryable: true, category: 'NETWORK' };
  if (s === 429) return { result: 'rate_limited', retryable: true, category: 'RATE_LIMIT', retry_after_ms: num(resp.retry_after, 0) * 1000 };
  if (s >= 500) return { result: 'transient', retryable: true, category: 'PROVIDER_5XX' };
  if (s >= 400) return { result: 'permanent', retryable: false, category: 'PROVIDER_4XX' };
  return { result: 'transient', retryable: true, category: 'UNKNOWN' };
}

// Initialise a fresh outbox row from a telegram_io delivery (delivery_id already deterministic + owner-scoped).
function initRow(delivery, now) {
  return Object.assign({}, delivery, {
    status: 'pending', attempt_count: 0, next_retry_at: str(now), last_error: '',
    created_at: str(delivery.created_at) || str(now), updated_at: str(now), dead_letter: false
  });
}

// Record one send attempt outcome and return the updated row (idempotent: a row already delivered/dead_letter
// is never re-sent). `now` is the attempt time; `rng` makes jitter deterministic in tests.
function recordAttempt(row, outcome, now, cfg, rng) {
  row = Object.assign({}, row); cfg = cfg || {};
  if (row.status === 'delivered' || row.status === 'dead_letter') return row; // terminal -> idempotent no-op
  var maxAttempts = num(cfg.max_attempts, DEFAULTS.max_attempts);
  var c = classifyOutcome(outcome);
  row.attempt_count = num(row.attempt_count, 0) + 1;
  row.updated_at = str(now);
  if (c.result === 'delivered') { row.status = 'delivered'; row.delivered_at = str(now); row.last_error = ''; return row; }
  row.last_error = c.category || c.result;
  if (!c.retryable) { row.status = 'dead_letter'; row.dead_letter = true; row.dead_letter_reason = 'permanent_' + (c.category || 'error'); return row; }
  if (row.attempt_count >= maxAttempts) { row.status = 'dead_letter'; row.dead_letter = true; row.dead_letter_reason = 'retry_exhausted'; return row; }
  var wait = c.retry_after_ms != null && c.retry_after_ms > 0 ? c.retry_after_ms : backoffMs(row.attempt_count, cfg, rng);
  row.status = 'retry';
  row.next_retry_at = new Date((Date.parse(str(now)) || 0) + wait).toISOString();
  row.retry_wait_ms = wait;
  return row;
}

// Which rows are DUE to (re)send now? (pending or retry whose next_retry_at <= now). Owner-isolated filter.
function dueRows(rows, now, ownerId) {
  var t = Date.parse(str(now)) || 0;
  return (rows || []).filter(function (r) {
    if (ownerId != null && str(r.owner_user_id || r.chat_id) !== str(ownerId)) return false;
    if (r.status === 'delivered' || r.status === 'dead_letter') return false;
    return (Date.parse(str(r.next_retry_at)) || 0) <= t;
  });
}
function deadLetters(rows) { return (rows || []).filter(function (r) { return r.status === 'dead_letter'; }); }

module.exports = { DEFAULTS, backoffMs, classifyOutcome, initRow, recordAttempt, dueRows, deadLetters };
