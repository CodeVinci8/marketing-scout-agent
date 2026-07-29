// test_sheets_retry_policy.js — SHEETS-RATELIMIT-001 regression (HONEST about the n8n engine cap).
// The Google Sheets API default quota is 60 read/write requests per minute per user (RATE_LIMIT_EXCEEDED /
// RESOURCE_EXHAUSTED). n8n 2.23.3 HARD-CAPS a node's waitBetweenTries at 5000ms, so a native node retry can
// NEVER cross the 60s per-minute window — it only rides out an ISOLATED transient 429, and the real defense
// is the per-execution read budget + serialization. This proves: (1) backoffMs is bounded/capped/jittered
// exponential (for code-driven loops); (2) nativeSheetsRetry is honest — its wait never exceeds the engine
// cap and tries are small; (3) the 429 classifier; (4) EVERY googleSheets node in the generated workflows
// carries a bounded, engine-cap-respecting retry (none promises an impossible window-crossing wait). $0.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const path = require('path');
const P = require('../n8n/lib/sheets_retry_policy.js');

A.section('backoffMs — bounded truncated exponential backoff with jitter (code-driven loops only)');
const zero = function () { return 0; };
const half = function () { return 0.5; };
A.eq('attempt 1 floor = base (2^0)', P.backoffMs(1, { base_ms: 1000, max_ms: 64000 }, zero), 1000);
A.eq('attempt 2 floor = 2*base', P.backoffMs(2, { base_ms: 1000, max_ms: 64000 }, zero), 2000);
A.eq('attempt 3 floor = 4*base', P.backoffMs(3, { base_ms: 1000, max_ms: 64000 }, zero), 4000);
A.eq('attempt 4 floor = 8*base', P.backoffMs(4, { base_ms: 1000, max_ms: 64000 }, zero), 8000);
A.ok('exponential is monotonically non-decreasing', (function () {
  let prev = -1; for (let a = 1; a <= 8; a++) { const v = P.backoffMs(a, { base_ms: 1000, max_ms: 64000 }, zero); if (v < prev) return false; prev = v; } return true;
})());
A.ok('TRUNCATED at the cap (never exceeds max_ms)', P.backoffMs(20, { base_ms: 1000, max_ms: 64000 }, half) <= 64000);
A.ok('jitter raises the delay above the exponential floor', P.backoffMs(2, { base_ms: 1000, max_ms: 64000 }, half) > P.backoffMs(2, { base_ms: 1000, max_ms: 64000 }, zero));
A.ok('jitter bounded by base (mid-jitter attempt 1 = base + 0.5*base)', P.backoffMs(1, { base_ms: 1000, max_ms: 64000 }, half) === 1500);

A.section('nativeSheetsRetry — HONEST about the 5000ms n8n engine cap (no impossible window-crossing claim)');
const def = P.nativeSheetsRetry();
A.ok('retryOnFail enabled', def.retryOnFail === true);
A.eq('engine cap constant is the measured 5000ms', P.ENGINE_WAIT_CAP_MS, 5000);
A.ok('wait NEVER exceeds the n8n engine cap (a larger value would be silently clamped)', def.waitBetweenTries <= P.ENGINE_WAIT_CAP_MS, 'wait=' + def.waitBetweenTries);
A.ok('a request for a window-crossing 65s wait is honestly clamped to the engine cap', P.nativeSheetsRetry({ wait_ms: 65000 }).waitBetweenTries <= P.ENGINE_WAIT_CAP_MS);
A.ok('maxTries is SMALL/bounded (2..3) so a sustained-quota miss is not turned into a long storm', def.maxTries >= 2 && def.maxTries <= 3, 'maxTries=' + def.maxTries);
A.ok('maxTries clamped to 3 ceiling', P.nativeSheetsRetry({ max_tries: 99 }).maxTries === 3);
A.ok('maxTries clamped to 2 floor', P.nativeSheetsRetry({ max_tries: 1 }).maxTries === 2);
A.ok('READ_BUDGET documents the per-minute-per-user read quota (60) as the architectural defense', P.READ_BUDGET === 60);

A.section('isRateLimited — recognises the real Sheets per-minute 429, ignores permanent failures');
A.ok('classifies the real RESOURCE_EXHAUSTED/RATE_LIMIT_EXCEEDED payload', P.isRateLimited('{"status":"RESOURCE_EXHAUSTED","details":[{"reason":"RATE_LIMIT_EXCEEDED"}]}'));
A.ok('classifies HTTP 429', P.isRateLimited('request failed, 429 too many requests'));
A.ok('classifies the human message', P.isRateLimited('The service is receiving too many requests from you'));
A.ok('does NOT treat a permanent 404 as rate-limited', !P.isRateLimited('404 not found'));
A.ok('does NOT treat a 403 permission error as rate-limited', !P.isRateLimited('403 PERMISSION_DENIED'));
A.ok('does NOT misfire on an id containing 429 digits', !P.isRateLimited('row id 1429001 updated'));

A.section('GENERATED WORKFLOWS — every googleSheets node carries a bounded, engine-cap-respecting retry');
const WF = path.join(__dirname, '..', 'n8n', 'workflows');
let sheetsNodes = 0, compliant = 0, overCap = 0;
for (const f of fs.readdirSync(WF).filter(n => /\.json$/.test(n))) {
  const w = JSON.parse(fs.readFileSync(path.join(WF, f), 'utf8'));
  for (const n of (w.nodes || [])) {
    if (n.type !== 'n8n-nodes-base.googleSheets') continue;
    sheetsNodes++;
    if (n.retryOnFail === true && Number(n.maxTries) >= 2 && Number(n.maxTries) <= 3 &&
      Number(n.waitBetweenTries) > 0 && Number(n.waitBetweenTries) <= P.ENGINE_WAIT_CAP_MS) compliant++;
    if (Number(n.waitBetweenTries) > P.ENGINE_WAIT_CAP_MS) overCap++;  // would be a dishonest, clamped value
  }
}
A.ok('there ARE googleSheets nodes to protect', sheetsNodes > 0, 'sheets nodes=' + sheetsNodes);
A.eq('EVERY googleSheets node has a bounded engine-cap-respecting retry', compliant, sheetsNodes);
A.eq('NO googleSheets node promises a wait beyond the engine cap (no dishonest clamped value)', overCap, 0);

// ---- SHEETS-RETRY-CLASS-001: bounded, deterministic classifier + decision (only retryable, never permanent) ----
A.section('classifier — only transient server-side conditions are retryable');
[['429 Too Many Requests', 't'], ['RATE_LIMIT_EXCEEDED', 't'], ['RESOURCE_EXHAUSTED', 't'],
 [{ httpCode: 500 }, 't'], [{ httpCode: 502 }, 't'], [{ httpCode: 503 }, 't'], [{ statusCode: 504 }, 't'],
 ['ETIMEDOUT', 't'], ['UNAVAILABLE', 't'], ['socket hang up', 't']].forEach(function (c) {
  A.ok('retryable: ' + JSON.stringify(c[0]).slice(0, 28), P.isRetryableSheetsError(c[0]) === true && P.isPermanentSheetsError(c[0]) === false);
});
A.section('classifier — validation / auth / not-found are PERMANENT and never retried');
[{ httpCode: 400 }, { httpCode: 401 }, { httpCode: 403 }, { httpCode: 404 }, 'INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED'].forEach(function (e) {
  A.ok('permanent: ' + JSON.stringify(e).slice(0, 28), P.isPermanentSheetsError(e) === true && P.isRetryableSheetsError(e) === false);
});
A.section('decision — bounded attempts, deterministic bounded wait, permanent never retries');
var rng = function () { return 0.5; };
var d1 = P.sheetsRetryDecision({ httpCode: 429 }, 1, 3, { base_ms: 1000, max_ms: 16000 }, rng);
A.ok('429 attempt 1/3 -> retry with a positive bounded wait', d1.should_retry === true && d1.wait_ms > 0 && d1.wait_ms <= 16000 && d1.category === 'rate_limit');
var d2 = P.sheetsRetryDecision({ httpCode: 503 }, 2, 3, {}, rng);
A.ok('503 attempt 2/3 -> retry, category server_transient', d2.should_retry === true && d2.category === 'server_transient');
var dExhaust = P.sheetsRetryDecision({ httpCode: 429 }, 3, 3, {}, rng);
A.ok('429 at the attempt bound -> NO further retry (bounded)', dExhaust.should_retry === false && dExhaust.wait_ms === 0);
var dPerm = P.sheetsRetryDecision({ httpCode: 403 }, 1, 3, {}, rng);
A.ok('403 permanent -> never retries regardless of attempt', dPerm.should_retry === false && dPerm.category === 'permanent');
A.section('backoff — monotonic non-decreasing, truncated at the cap, deterministic under fixed rng');
var seq = [1, 2, 3, 4, 5, 8].map(function (a) { return P.backoffMs(a, { base_ms: 1000, max_ms: 16000 }, rng); });
A.ok('backoff never exceeds the cap', seq.every(function (w) { return w <= 16000; }));
A.ok('backoff is non-decreasing then capped', seq[0] <= seq[1] && seq[1] <= seq[2] && seq[5] === 16000);
A.ok('backoff is deterministic under a fixed rng', P.backoffMs(2, { base_ms: 1000, max_ms: 16000 }, rng) === P.backoffMs(2, { base_ms: 1000, max_ms: 16000 }, rng));

A.report('sheets-retry-policy');
