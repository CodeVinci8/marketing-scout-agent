'use strict';
// sheets_retry_policy.js — bounded, storm-free retry policy for Google Sheets API calls.
//
// SHEETS-RATELIMIT-001 root cause: the Google Sheets API default quota is 60 read_requests AND
// 60 write_requests "per minute per user per project" (quota_unit "1/min/{project}/{user}",
// status RESOURCE_EXHAUSTED, reason RATE_LIMIT_EXCEEDED, message "The service is receiving too many
// requests from you"). It is a NORMAL rolling-minute quota — a 429 clears once the minute window
// refills. It is NOT a misconfiguration and needs no Google Cloud change.
//
// The native n8n googleSheets node only exposes a FIXED waitBetweenTries (no exponential, no jitter).
// The ONLY storm-free native retry is therefore one whose wait CROSSES the per-minute window: a
// shorter wait just burns more of the same throttled minute's quota and is guaranteed to fail again
// (a retry storm). nativeSheetsRetry() refuses any in-window wait for exactly this reason.
//
// backoffMs() implements bounded truncated exponential backoff WITH jitter for any code-driven Sheets
// retry loop (and is the documented/tested policy), aligned with the existing backoff helpers in
// provider_adapter.js and delivery_outbox.js.

var WINDOW_MS = 60000; // Google Sheets per-minute quota window

function num(v, d) { v = Number(v); return Number.isFinite(v) ? v : d; }

// Bounded truncated exponential backoff with additive jitter. attempt is 1-based.
// rng() in [0,1) makes the jitter deterministic in tests; defaults to 0.5 (mid jitter).
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

// Native googleSheets node retry config guaranteed storm-free against the per-minute quota:
// waitBetweenTries crosses a full window so a retry lands in a FRESH minute, and the try count is
// bounded. An in-window wait is rejected (clamped up) because it would storm the throttled minute.
function nativeSheetsRetry(cfg) {
  cfg = cfg || {};
  var wait = num(cfg.wait_ms, WINDOW_MS + 5000); // 65s default = one full window + margin
  if (wait < WINDOW_MS) wait = WINDOW_MS + 5000; // refuse a storming, in-window wait
  var tries = Math.min(5, Math.max(2, num(cfg.max_tries, 3)));
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

module.exports = { WINDOW_MS: WINDOW_MS, backoffMs: backoffMs, nativeSheetsRetry: nativeSheetsRetry, isRateLimited: isRateLimited };
