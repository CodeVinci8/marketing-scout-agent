// test_sheets_retry_policy.js — SHEETS-RATELIMIT-001 regression.
// The Google Sheets API default quota is 60 read/write requests per minute per user (RATE_LIMIT_EXCEEDED /
// RESOURCE_EXHAUSTED). This proves: (1) bounded truncated exponential backoff WITH jitter is monotonic, capped
// and jittered; (2) the native googleSheets retry config is STORM-FREE — its waitBetweenTries always crosses a
// full per-minute window so a retry lands in a fresh minute (never restorms the throttled one); (3) the 429
// classifier recognises the real Sheets rate-limit error and ignores permanent failures; (4) EVERY googleSheets
// node in the generated workflows actually carries that storm-free retry config. Fully offline; $0.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const path = require('path');
const P = require('../n8n/lib/sheets_retry_policy.js');

A.section('backoffMs — bounded truncated exponential backoff with jitter');
const zero = function () { return 0; };   // min jitter -> pure exponential floor
const half = function () { return 0.5; }; // mid jitter
A.eq('attempt 1 floor = base (2^0)', P.backoffMs(1, { base_ms: 1000, max_ms: 64000 }, zero), 1000);
A.eq('attempt 2 floor = 2*base', P.backoffMs(2, { base_ms: 1000, max_ms: 64000 }, zero), 2000);
A.eq('attempt 3 floor = 4*base', P.backoffMs(3, { base_ms: 1000, max_ms: 64000 }, zero), 4000);
A.eq('attempt 4 floor = 8*base', P.backoffMs(4, { base_ms: 1000, max_ms: 64000 }, zero), 8000);
A.ok('exponential is monotonically non-decreasing across attempts', (function () {
  let prev = -1; for (let a = 1; a <= 8; a++) { const v = P.backoffMs(a, { base_ms: 1000, max_ms: 64000 }, zero); if (v < prev) return false; prev = v; } return true;
})());
A.ok('TRUNCATED at the cap (never exceeds max_ms even at high attempts)', P.backoffMs(20, { base_ms: 1000, max_ms: 64000 }, half) <= 64000);
A.ok('jitter raises the delay above the pure exponential floor', P.backoffMs(2, { base_ms: 1000, max_ms: 64000 }, half) > P.backoffMs(2, { base_ms: 1000, max_ms: 64000 }, zero));
A.ok('jitter is bounded by base (mid-jitter at attempt 1 = base + 0.5*base)', P.backoffMs(1, { base_ms: 1000, max_ms: 64000 }, half) === 1500);

A.section('nativeSheetsRetry — STORM-FREE: wait always crosses the per-minute quota window');
const def = P.nativeSheetsRetry();
A.ok('retryOnFail enabled', def.retryOnFail === true);
A.ok('default wait CROSSES the full per-minute window (>= 60000ms)', def.waitBetweenTries >= P.WINDOW_MS, 'wait=' + def.waitBetweenTries);
A.ok('maxTries is bounded (2..5)', def.maxTries >= 2 && def.maxTries <= 5, 'maxTries=' + def.maxTries);
const storm = P.nativeSheetsRetry({ wait_ms: 5000 });  // an in-window (storming) wait is REFUSED
A.ok('an in-window wait (5s) is rejected and clamped to cross the window', storm.waitBetweenTries >= P.WINDOW_MS, 'wait=' + storm.waitBetweenTries);
A.ok('maxTries clamped to 5 ceiling', P.nativeSheetsRetry({ max_tries: 99 }).maxTries === 5);
A.ok('maxTries clamped to 2 floor', P.nativeSheetsRetry({ max_tries: 1 }).maxTries === 2);

A.section('isRateLimited — recognises the real Sheets per-minute 429, ignores permanent failures');
A.ok('classifies the real RESOURCE_EXHAUSTED/RATE_LIMIT_EXCEEDED payload', P.isRateLimited('{"status":"RESOURCE_EXHAUSTED","details":[{"reason":"RATE_LIMIT_EXCEEDED"}]}'));
A.ok('classifies HTTP 429', P.isRateLimited('request failed, 429 too many requests'));
A.ok('classifies the human message', P.isRateLimited('The service is receiving too many requests from you'));
A.ok('does NOT treat a permanent 404 as rate-limited', !P.isRateLimited('404 not found'));
A.ok('does NOT treat a 403 permission error as rate-limited', !P.isRateLimited('403 PERMISSION_DENIED'));
A.ok('does NOT misfire on an id containing 429 digits', !P.isRateLimited('row id 1429001 updated'));

A.section('GENERATED WORKFLOWS — every googleSheets node carries the storm-free retry config');
const WF = path.join(__dirname, '..', 'n8n', 'workflows');
let sheetsNodes = 0, withRetry = 0, inWindow = 0;
for (const f of fs.readdirSync(WF).filter(n => /\.json$/.test(n))) {
  const w = JSON.parse(fs.readFileSync(path.join(WF, f), 'utf8'));
  for (const n of (w.nodes || [])) {
    if (n.type !== 'n8n-nodes-base.googleSheets') continue;
    sheetsNodes++;
    if (n.retryOnFail === true && Number(n.maxTries) >= 2 && Number(n.waitBetweenTries) >= P.WINDOW_MS) withRetry++;
    if (n.retryOnFail === true && Number(n.waitBetweenTries) < P.WINDOW_MS) inWindow++;
  }
}
A.ok('there ARE googleSheets nodes to protect', sheetsNodes > 0, 'sheets nodes=' + sheetsNodes);
A.eq('EVERY googleSheets node has storm-free window-crossing retry', withRetry, sheetsNodes);
A.eq('NO googleSheets node has a storming in-window retry wait', inWindow, 0);

A.report('sheets-retry-policy');
