'use strict';
// sheets_retry_policy.js — honest retry/backoff policy for Google Sheets API calls under n8n 2.23.3.
//
// SHEETS-RATELIMIT-001 root cause: the Google Sheets API default quota is 60 read_requests AND
// 60 write_requests "per minute per user per project" (quota_unit "1/min/{project}/{user}",
// status RESOURCE_EXHAUSTED, reason RATE_LIMIT_EXCEEDED, message "The service is receiving too many
// requests from you"). It is a NORMAL rolling-minute quota and needs no Google Cloud change.
//
// HARD ENGINE CONSTRAINT (measured on n8n 2.23.3): the execution engine CAPS a node's waitBetweenTries
// at 5000 ms — `waitBetweenTries = Math.min(5000, Math.max(0, node.waitBetweenTries ?? 1000))` in both
// n8n-core/.../workflow-execute.js and get-input-connection-data.js. A native node retry therefore can
// NEVER cross the 60 s per-minute quota window: any retry lands inside the SAME throttled minute. So a
// native retry is ONLY useful to ride out a brief ISOLATED 429; it is NOT — and cannot be — a remedy for
// sustained per-minute exhaustion, and a long retry chain actively AMPLIFIES a storm (every retry re-issues
// the request inside the throttled minute). nativeSheetsRetry() reflects that reality: a SMALL, bounded
// retry (engine-capped wait, few tries).
//
// THE ARCHITECTURAL DEFENSE (not the retry) is to keep each execution UNDER the 60-req/min/user budget and
// to SERIALIZE executions (N8N_CONCURRENCY_PRODUCTION_LIMIT=1), so the per-minute quota is never exceeded
// in the first place. READ_BUDGET documents that budget for callers/tests.
//
// backoffMs() implements bounded truncated exponential backoff WITH jitter for any CODE-driven retry loop
// (a Code node CAN sleep longer than 5 s); it is the documented ideal policy and is aligned with the backoff
// helpers in provider_adapter.js and delivery_outbox.js. Native googleSheets nodes cannot use it (5 s cap).

var WINDOW_MS = 60000;            // Google Sheets per-minute quota window
var ENGINE_WAIT_CAP_MS = 5000;    // n8n 2.23.3 hard cap on node waitBetweenTries (measured in the engine)
var READ_BUDGET = 60;             // read_requests per minute per user — keep one execution well under this

function num(v, d) { v = Number(v); return Number.isFinite(v) ? v : d; }

// Bounded truncated exponential backoff with additive jitter, for CODE-driven Sheets retry loops only.
// attempt is 1-based. rng() in [0,1) makes the jitter deterministic in tests (defaults to 0.5).
function backoffMs(attempt, cfg, rng) {
  cfg = cfg || {};
  var base = num(cfg.base_ms, 1000);
  var cap = num(cfg.max_ms, 64000);
  var a = Math.max(1, num(attempt, 1));
  var raw = base * Math.pow(2, a - 1);          // exponential
  var truncated = Math.min(cap, raw);            // truncated at the cap
  var jitter = (rng ? rng() : 0.5) * base;       // additive jitter, bounded by base
  return Math.min(cap, Math.round(truncated + jitter));
}

// Native googleSheets node retry config — HONEST about the engine cap. The wait is the engine maximum
// (anything larger is silently clamped, so promising more would be a lie); the try count is small so an
// isolated transient 429 is ridden out without turning a sustained-quota miss into a long storm.
// This is transient-isolation insurance ONLY; correctness comes from the read budget + serialization.
function nativeSheetsRetry(cfg) {
  cfg = cfg || {};
  var wait = num(cfg.wait_ms, ENGINE_WAIT_CAP_MS);
  if (wait > ENGINE_WAIT_CAP_MS) wait = ENGINE_WAIT_CAP_MS;  // the engine would clamp it anyway — be honest
  if (wait < 0) wait = 0;
  var tries = Math.min(3, Math.max(2, num(cfg.max_tries, 3)));
  return { retryOnFail: true, maxTries: tries, waitBetweenTries: wait };
}

// True when a Sheets error is the transient per-minute rate limit (vs a permanent 4xx / config error).
function isRateLimited(e) {
  var s = typeof e === 'string' ? e : JSON.stringify(e || '');
  return /(^|[^0-9])429([^0-9]|$)/.test(s) ||
    /RATE_LIMIT_EXCEEDED/.test(s) ||
    /RESOURCE_EXHAUSTED/.test(s) ||
    /too many requests/i.test(s);
}

// SHEETS-RETRY-CLASS-001: a code-driven retry loop must re-attempt ONLY transient server-side conditions and must
// NEVER retry a permanent failure (a retry cannot fix a bad request/auth and only amplifies load inside the
// throttled minute). These classifiers are the ONE source of truth for that decision.
function errText(e) { return typeof e === 'string' ? e : JSON.stringify(e || ''); }
function httpCodeOf(e) {
  if (e && typeof e === 'object') {
    var c = e.httpCode != null ? e.httpCode : (e.statusCode != null ? e.statusCode : (e.code != null ? e.code : null));
    var n = Number(c); if (Number.isFinite(n) && n >= 100 && n < 600) return n;
  }
  var m = errText(e).match(/(^|[^0-9])([45]\d\d)([^0-9]|$)/);
  return m ? Number(m[2]) : null;
}
// Permanent = the request itself is wrong (validation) or not allowed (auth) or absent (404): retrying is futile.
function isPermanentSheetsError(e) {
  if (isRateLimited(e)) return false; // a rate limit is transient even though its message may mention limits
  var code = httpCodeOf(e);
  if (code === 400 || code === 401 || code === 403 || code === 404) return true;
  return /INVALID_ARGUMENT|PERMISSION_DENIED|UNAUTHENTICATED|NOT_FOUND|FAILED_PRECONDITION|\bunauthor|\bforbidden\b|invalid credential/i.test(errText(e));
}
// Retryable = per-minute rate limit, HTTP 5xx (server), or a transient network fault. Everything else is not.
function isRetryableSheetsError(e) {
  if (isPermanentSheetsError(e)) return false;
  if (isRateLimited(e)) return true;
  var code = httpCodeOf(e);
  if (code === 500 || code === 502 || code === 503 || code === 504) return true;
  return /\bINTERNAL\b|UNAVAILABLE|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|\btimeout\b/i.test(errText(e));
}
// One deterministic decision for a CODE-driven retry loop. attempt is 1-based; maxAttempts bounds the loop; rng
// makes the jittered wait deterministic in tests. Never proposes a retry for a permanent error or past the bound.
function sheetsRetryDecision(e, attempt, maxAttempts, cfg, rng) {
  var max = Math.max(1, num(maxAttempts, 3));
  var a = Math.max(1, num(attempt, 1));
  var permanent = isPermanentSheetsError(e);
  var retryable = isRetryableSheetsError(e);
  var should = retryable && !permanent && a < max;
  return {
    should_retry: should,
    wait_ms: should ? backoffMs(a, cfg, rng) : 0,
    category: permanent ? 'permanent' : (retryable ? (isRateLimited(e) ? 'rate_limit' : 'server_transient') : 'unknown'),
    attempt: a, max_attempts: max
  };
}

module.exports = {
  WINDOW_MS: WINDOW_MS, ENGINE_WAIT_CAP_MS: ENGINE_WAIT_CAP_MS, READ_BUDGET: READ_BUDGET,
  backoffMs: backoffMs, nativeSheetsRetry: nativeSheetsRetry, isRateLimited: isRateLimited,
  isRetryableSheetsError: isRetryableSheetsError, isPermanentSheetsError: isPermanentSheetsError,
  sheetsRetryDecision: sheetsRetryDecision
};
