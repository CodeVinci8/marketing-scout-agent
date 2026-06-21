// test_deploy_preflight.js — QA-006: fail-closed runtime configuration preflight. Proves required values are
// enforced, zlib gates XLSX-capable activation, malformed optionals warn (not fatal in soft mode), placeholders
// are rejected, and secret-ish values are never echoed. Offline, $0.
'use strict';
const A = require('./_assert');
const { evaluate } = require('../tools/preflight_config.js');

const GOOD = {
  MS_SPREADSHEET_ID: '1AbCdEf_realSheetId_0123456789',
  MS_TELEGRAM_ALLOWED_USER_IDS: '12345678,98765432',
  NODE_FUNCTION_ALLOW_BUILTIN: 'zlib,crypto'
};

A.section('QA-006 — required values are enforced (fail closed)');
let r = evaluate({}, {});
A.eq('empty env is not ok', r.ok, false);
A.ok('MS_SPREADSHEET_ID required', r.errors.some(e => /MS_SPREADSHEET_ID is required/.test(e)));
A.ok('MS_TELEGRAM_ALLOWED_USER_IDS required', r.errors.some(e => /MS_TELEGRAM_ALLOWED_USER_IDS is required/.test(e)));

A.section('QA-006 — a complete config passes');
r = evaluate(GOOD, {});
A.eq('valid config is ok', r.ok, true);
A.eq('valid config has zero errors', r.error_count, 0);

A.section('QA-006 — zlib gates XLSX-capable activation');
r = evaluate({ MS_SPREADSHEET_ID: GOOD.MS_SPREADSHEET_ID, MS_TELEGRAM_ALLOWED_USER_IDS: '123' }, { requireZlib: true });
A.eq('missing zlib + requireZlib is not ok', r.ok, false);
A.ok('zlib error explains XLSX', r.errors.some(e => /zlib/.test(e) && /XLSX/i.test(e)));
r = evaluate({ MS_SPREADSHEET_ID: GOOD.MS_SPREADSHEET_ID, MS_TELEGRAM_ALLOWED_USER_IDS: '123' }, { requireZlib: false });
A.eq('missing zlib WITHOUT requireZlib is only a warning', r.ok, true);
A.ok('zlib warning present', r.warnings.some(w => /zlib/.test(w)));
r = evaluate(Object.assign({}, GOOD, { NODE_FUNCTION_ALLOW_BUILTIN: '*' }), { requireZlib: true });
A.eq('wildcard NODE_FUNCTION_ALLOW_BUILTIN satisfies zlib', r.zlib_allowed, true);

A.section('QA-006 — invalid Telegram ids and negative budgets are rejected');
r = evaluate(Object.assign({}, GOOD, { MS_TELEGRAM_ALLOWED_USER_IDS: 'alice,bob' }), {});
A.eq('non-numeric telegram ids -> not ok', r.ok, false);
r = evaluate(Object.assign({}, GOOD, { MS_SOURCE_BUDGET_USD: '-1' }), {});
A.eq('negative budget -> not ok', r.ok, false);
A.ok('negative budget error', r.errors.some(e => /MS_SOURCE_BUDGET_USD must be non-negative/.test(e)));

A.section('QA-006 — malformed optionals warn but do not fail (soft/dry-run can continue)');
r = evaluate(Object.assign({}, GOOD, { MS_MONITORING_ENABLED: 'maybe', MS_SOURCE_ALLOWLIST: 'website,nonsense' }), {});
A.eq('bad boolean + unknown source are warnings, still ok', r.ok, true);
A.ok('non-boolean flag warns', r.warnings.some(w => /MS_MONITORING_ENABLED is not a boolean/.test(w)));
A.ok('unknown allowlist source warns', r.warnings.some(w => /unknown source/.test(w)));

A.section('QA-006 — soft mode downgrades missing-required to warnings');
r = evaluate({}, { soft: true });
A.eq('soft mode with empty env stays ok', r.ok, true);
A.ok('soft mode reports the missing values as warnings', r.warning_count >= 2);

A.section('QA-006 — placeholders are rejected and secret-ish values are never echoed');
r = evaluate(Object.assign({}, GOOD, { MS_SPREADSHEET_ID: 'paste-your-sheet-id' }), {});
A.eq('placeholder spreadsheet id -> not ok', r.ok, false);
const dump = JSON.stringify(evaluate(GOOD, {}));
A.ok('the raw spreadsheet id value is never present in output', dump.indexOf(GOOD.MS_SPREADSHEET_ID) < 0);
A.ok('the spreadsheet check is masked (set(len=...))', dump.indexOf('set(len=') >= 0);

A.report('deploy-preflight');
