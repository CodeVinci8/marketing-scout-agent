// test_preflight_strict.js — Stage 8 strict preflight (CONFIG-002/003/005, PREFLIGHT-001/002/005, LIVE-001,
// TELEGRAM-001/002, FUTURE-015). Proves activation-critical values fail closed, cross-field invariants reject
// contradictions, secrets are never echoed, and the explicit zero-paid profile is asserted byte-for-byte.
'use strict';
const A = require('./_assert');
const P = require('../tools/preflight_config.js');
const { evaluate } = P;

const BASE = { MS_SPREADSHEET_ID: '1AbCdEf_realSheetId_0123456789', MS_TELEGRAM_ALLOWED_USER_IDS: '123,456', NODE_FUNCTION_ALLOW_BUILTIN: 'zlib' };
function withBase(o) { return Object.assign({}, BASE, o); }

A.section('backward compat: a minimal-good config still passes with zero errors');
A.eq('GOOD ok', evaluate(BASE, {}).ok, true);
A.eq('GOOD has 0 errors', evaluate(BASE, {}).error_count, 0);

A.section('PREFLIGHT-005 / CONFIG-005 — IANA timezone is validated');
A.ok('valid IANA Europe/Moscow ok', P.isValidTimeZone('Europe/Moscow'));
A.ok('garbage zone rejected', !P.isValidTimeZone('Mars/Phobos'));
A.eq('invalid MS_TIMEZONE fails', evaluate(withBase({ MS_TIMEZONE: 'Not/AZone' }), {}).ok, false);
A.eq('valid MS_TIMEZONE ok', evaluate(withBase({ MS_TIMEZONE: 'Europe/Moscow' }), {}).ok, true);

A.section('CONFIG-002/005 — report data mode enum');
A.eq('bogus report mode fails', evaluate(withBase({ MS_REPORT_DATA_MODE: 'wishful' }), {}).ok, false);
A.eq('live report mode ok', evaluate(withBase({ MS_REPORT_DATA_MODE: 'live' }), {}).ok, true);

A.section('LIVE-001 / PREFLIGHT-002 — N8N_BLOCK_ENV_ACCESS_IN_NODE must be false to activate (fail closed)');
{
  const wrong = evaluate(withBase({ N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true' }), { forActivation: true });
  A.eq('blocked $env fails activation', wrong.ok, false);
  A.ok('error explains $env', wrong.errors.some(e => /N8N_BLOCK_ENV_ACCESS_IN_NODE/.test(e)));
  const absent = evaluate(withBase({}), { forActivation: true });
  A.ok('absent $env flag fails activation', absent.errors.some(e => /N8N_BLOCK_ENV_ACCESS_IN_NODE/.test(e)));
  const right = evaluate(withBase({ N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false' }), {});
  A.ok('false is accepted', right.checks.some(c => c.name === 'N8N_BLOCK_ENV_ACCESS_IN_NODE' && c.status === 'ok'));
  // NEGATIVE test (PREFLIGHT-002): a non-activation dry-run only WARNS, does not hard-fail on this alone
  const dry = evaluate(withBase({ N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true' }), {});
  A.eq('dry-run does not hard-fail on $env alone', dry.ok, true);
}

A.section('PREFLIGHT-001 / TELEGRAM — bot token shape validated and NEVER echoed');
{
  const goodTok = '123456789:AAH' + 'k'.repeat(33);
  const okTok = evaluate(withBase({ MS_TELEGRAM_BOT_TOKEN: goodTok }), { forActivation: true });
  A.ok('valid token accepted (shape)', okTok.checks.some(c => c.name === 'MS_TELEGRAM_BOT_TOKEN' && c.status === 'ok'));
  A.ok('raw token never appears in output', JSON.stringify(okTok).indexOf(goodTok) < 0);
  A.ok('token check is masked', JSON.stringify(okTok).indexOf('set(len=') >= 0);
  const badTok = evaluate(withBase({ MS_TELEGRAM_BOT_TOKEN: 'not-a-token' }), {});
  A.eq('malformed token fails even in dry-run', badTok.ok, false);
  const missingTok = evaluate(withBase({}), { forActivation: true });
  A.ok('missing token fails activation', missingTok.errors.some(e => /MS_TELEGRAM_BOT_TOKEN/.test(e)));
}

A.section('TELEGRAM-001 / §14 — public ingress url must be HTTPS (activation-critical)');
{
  A.ok('https url valid', P.isHttpsUrl('https://bot.example.com/webhook'));
  A.ok('http url invalid', !P.isHttpsUrl('http://bot.example.com'));
  const httpFail = evaluate(withBase({ PUBLIC_WEBHOOK_BASE_URL: 'http://x' }), { forActivation: true });
  A.eq('http base url fails activation', httpFail.ok, false);
  const ok = evaluate(withBase({ PUBLIC_WEBHOOK_BASE_URL: 'https://bot.example.com' }), {});
  A.ok('https base url ok', ok.checks.some(c => c.name === 'PUBLIC_WEBHOOK_BASE_URL' && c.status === 'ok'));
}

A.section('TELEGRAM-002 — webhook secret required + strong + never echoed (on activation)');
{
  const weak = evaluate(withBase({ MS_TELEGRAM_WEBHOOK_SECRET: 'short' }), { forActivation: true });
  A.eq('weak secret fails activation', weak.ok, false);
  const strongSecret = 'S3cr3t_random_value_32chars_long__';
  const strong = evaluate(withBase({ MS_TELEGRAM_WEBHOOK_SECRET: strongSecret }), { forActivation: true, requireZlib: true,
    MS_TELEGRAM_BOT_TOKEN: '1:x' });
  A.ok('strong secret never echoed', JSON.stringify(strong).indexOf(strongSecret) < 0);
}

A.section('FUTURE-015 — cross-field paid-config invariants reject contradictions');
A.eq('collector on + external actions off fails', evaluate(withBase({ MS_ENABLE_FIRECRAWL: 'true', MS_ENABLE_EXTERNAL_ACTIONS: 'false' }), {}).ok, false);
A.eq('external actions on + 0 calls fails', evaluate(withBase({ MS_ENABLE_EXTERNAL_ACTIONS: 'true', MS_MAX_EXTERNAL_CALLS: '0' }), {}).ok, false);
A.eq('claude on + 0 budget fails', evaluate(withBase({ MS_ENABLE_CLAUDE: 'true', MS_LLM_BUDGET_USD: '0' }), {}).ok, false);
{
  const consistent = evaluate(withBase({ MS_ENABLE_EXTERNAL_ACTIONS: 'true', MS_ENABLE_FIRECRAWL: 'true', MS_MAX_EXTERNAL_CALLS: '5' }), {});
  A.eq('consistent paid config passes the invariants', consistent.ok, true);
  const monWarn = evaluate(withBase({ MS_MONITORING_ENABLED: 'true' }), {});
  A.ok('monitoring without a collector warns', monWarn.warnings.some(w => /monitoring has nothing to collect/.test(w)));
}

A.section('CONFIG-002 — explicit zero-paid profile is asserted (every key)');
{
  const z = P.checkZeroPaidProfile(P.ZERO_PAID_PROFILE);
  A.ok('canonical zero-paid profile matches itself', z.ok && z.mismatches.length === 0);
  const profileEnv = Object.assign({}, P.ZERO_PAID_PROFILE, BASE, { MS_TELEGRAM_BOT_TOKEN: undefined });
  const ok = evaluate(profileEnv, { profile: 'zero-paid' });
  A.eq('full zero-paid env passes the profile assertion', ok.ok, true);
  const tampered = Object.assign({}, P.ZERO_PAID_PROFILE, { MS_ENABLE_EXTERNAL_ACTIONS: 'true' });
  const fail = evaluate(Object.assign({}, tampered, BASE), { profile: 'zero-paid' });
  A.eq('a single paid flag flip fails the profile assertion', fail.ok, false);
  A.ok('profile error names the offending key', fail.errors.some(e => /MS_ENABLE_EXTERNAL_ACTIONS/.test(e)));
  A.ok('profile has all 22 expected keys (21 from CONFIG-002 + determined MS_REPORT_DATA_MODE)', Object.keys(P.ZERO_PAID_PROFILE).length === 22);
}

A.section('global: no secret-ish raw value ever appears in evaluate output');
{
  const env = withBase({ MS_TELEGRAM_BOT_TOKEN: '999:SECRET_TOKEN_VALUE_kkkkkkkkkkkkkkkk', MS_TELEGRAM_WEBHOOK_SECRET: 'WEBHOOK_SECRET_VALUE_32_chars_aa' });
  const dump = JSON.stringify(evaluate(env, { forActivation: true }));
  A.ok('bot token absent', dump.indexOf('SECRET_TOKEN_VALUE') < 0);
  A.ok('webhook secret absent', dump.indexOf('WEBHOOK_SECRET_VALUE') < 0);
  A.ok('spreadsheet id absent', dump.indexOf(BASE.MS_SPREADSHEET_ID) < 0);
}

A.report('preflight-strict');
