'use strict';
// source_access.js — BLOCK-HONESTY-001. Decide whether we actually REACHED a source, BEFORE anyone asks whether the
// business is relevant.
//
// The bug this exists to kill (live: carmoney.ru, WF04 exec 894): Firecrawl returned a 772-char access-restriction
// page. It was longer than the 80-char "meaningful content" floor, so it flowed into business classification, which
// — correctly, given the text it saw — said `entity_type=irrelevant / business_skip`. The user was then told
// «carmoney.ru — проверен, новых релевантных фактов не найдено» and advised to widen filters. Every part of that is
// false: we never saw the site, the company may be highly relevant, and no filter change can fix an IP block.
//
// "We could not read the page" and "we read the page and it is not a competitor" are DIFFERENT facts with different
// user messages, different next actions, and different data consequences. Access is decided first, from the
// transport + the page's own text; relevance is only asked once access is `accessible_content`.
//
// A non-accessible outcome may NEVER become a competitor snapshot, overwrite a good snapshot, or feed Claude.
//
// Embeddable: unique sa*-prefixed names, no cross-lib require.

function saStr(v) { return v == null ? '' : String(v); }
function saNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

var SA_OUTCOMES = {
  ACCESSIBLE: 'accessible_content',
  BLOCKED_WAF: 'blocked_by_waf',
  ACCESS_DENIED: 'robots_or_access_denied',
  PROVIDER_FAILURE: 'provider_failure',
  TIMEOUT: 'timeout',
  EMPTY: 'empty_response',
  UNSUPPORTED: 'unsupported_content',
  IRRELEVANT: 'valid_but_irrelevant'   // set DOWNSTREAM, only after ACCESSIBLE — never inferred here
};
// Only these mean "we hold real page content".
function saIsAccessible(o) { return o === SA_OUTCOMES.ACCESSIBLE; }
// These are transport/access problems: the business is unjudged, so the user must never be told it is irrelevant.
function saIsAccessFailure(o) {
  return [SA_OUTCOMES.BLOCKED_WAF, SA_OUTCOMES.ACCESS_DENIED, SA_OUTCOMES.PROVIDER_FAILURE,
    SA_OUTCOMES.TIMEOUT, SA_OUTCOMES.EMPTY, SA_OUTCOMES.UNSUPPORTED].indexOf(o) >= 0;
}
// Worth another attempt later (a block/timeout may lift); an unsupported content type will not fix itself.
function saIsRetryable(o) {
  return [SA_OUTCOMES.BLOCKED_WAF, SA_OUTCOMES.PROVIDER_FAILURE, SA_OUTCOMES.TIMEOUT, SA_OUTCOMES.EMPTY].indexOf(o) >= 0;
}

// STRONG signatures: unambiguous challenge/block boilerplate. A real commercial page does not say these about itself.
var SA_STRONG_WAF = [
  'just a moment...', 'checking your browser before accessing', 'attention required! | cloudflare',
  'cloudflare ray id', 'enable javascript and cookies to continue', 'verify you are human',
  'ddos protection by cloudflare', 'performance & security by cloudflare', 'error 1020', 'error code 1020',
  'ray id:', 'sorry, you have been blocked', 'why have i been blocked', 'incapsula incident id',
  'request unsuccessful. incapsula', 'access to this page has been denied', 'pardon our interruption',
  'are you a robot', 'подтвердите, что вы не робот', 'проверка браузера', 'доступ ограничен'
];
var SA_STRONG_DENIED = [
  '403 forbidden', 'http error 403', 'access denied', 'you don\'t have permission to access',
  'you do not have permission to access', 'authorization required', '401 unauthorized',
  'доступ запрещён', 'доступ запрещен', 'нет доступа к этой странице'
];
// The live carmoney.ru family: an IP/geo restriction notice. Two independent phrases must co-occur, so a page that
// merely mentions "VPN" as a product never trips it.
var SA_GEOBLOCK_PAIRS = [
  ['is not available', 'restricted access from your current network'],
  ['is not available', 'block access from specific countries'],
  ['restricted access from your current network', 'enabled a vpn'],
  ['website owner has restricted access', 'ip addresses'],
  ['недоступен', 'ограничил доступ']
];
// WEAK signals: only meaningful on a SHORT page with no commercial content of its own.
var SA_WEAK = ['captcha', 'recaptcha', 'hcaptcha', 'challenge-platform', 'cf-browser-verification',
  'security check', 'bot detection', 'unusual traffic', 'rate limited', 'too many requests'];

// A page that talks about lending/pricing/contacts is a real page, whatever boilerplate it also contains.
var SA_BUSINESS_TERMS = ['кредит', 'займ', 'залог', 'птс', 'ставка', 'рефинанс', 'ипотек', 'одобрен', 'заявк',
  'тариф', 'услуг', 'оформить', 'руб', 'процент', 'офис', 'loan', 'credit', 'rate', 'apply'];

function saHasBusiness(low) {
  var n = 0;
  for (var i = 0; i < SA_BUSINESS_TERMS.length; i++) if (low.indexOf(SA_BUSINESS_TERMS[i]) >= 0) n++;
  return n;
}
function saAnyHit(low, list) {
  for (var i = 0; i < list.length; i++) if (low.indexOf(list[i]) >= 0) return list[i];
  return '';
}
function saPairHit(low, pairs) {
  for (var i = 0; i < pairs.length; i++) {
    if (low.indexOf(pairs[i][0]) >= 0 && low.indexOf(pairs[i][1]) >= 0) return pairs[i].join(' + ');
  }
  return '';
}

// classifySourceAccess(input) -> { outcome, reason, signature, retryable, access_failure, meaningful_chars, business_terms }
// input: { status, body_text, error, error_category, content_type, url }
// Order matters: transport verdicts first (they are authoritative), then the page's own text.
function classifySourceAccess(input) {
  input = input || {};
  var status = saNum(input.status, NaN);
  var text = saStr(input.body_text);
  var low = text.toLowerCase();
  var meaningful = text.replace(/[#>*_|[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  var biz = saHasBusiness(low);
  var out = function (outcome, reason, signature) {
    return {
      outcome: outcome, reason: reason, signature: saStr(signature),
      retryable: saIsRetryable(outcome), access_failure: saIsAccessFailure(outcome),
      meaningful_chars: meaningful.length, business_terms: biz
    };
  };

  // 1. transport-level truth
  var ec = saStr(input.error_category).toLowerCase();
  if (ec === 'timeout' || /timeout|etimedout|timed out/i.test(saStr(input.error))) return out(SA_OUTCOMES.TIMEOUT, 'provider_timeout', ec || 'timeout');
  if (input.error) return out(SA_OUTCOMES.PROVIDER_FAILURE, 'provider_error', saStr(input.error).slice(0, 60));
  if (isFinite(status)) {
    if (status === 401 || status === 403) return out(SA_OUTCOMES.ACCESS_DENIED, 'http_' + status, 'http_' + status);
    if (status === 429) return out(SA_OUTCOMES.BLOCKED_WAF, 'http_429_rate_limited', 'http_429');
    if (status >= 500) return out(SA_OUTCOMES.PROVIDER_FAILURE, 'http_' + status, 'http_' + status);
    if (status >= 400) return out(SA_OUTCOMES.PROVIDER_FAILURE, 'http_' + status, 'http_' + status);
  }
  // 2. content type we cannot analyze
  var ct = saStr(input.content_type).toLowerCase();
  if (ct && !/text\/html|text\/plain|application\/xhtml|markdown|application\/json/.test(ct)) {
    return out(SA_OUTCOMES.UNSUPPORTED, 'unsupported_content_type', ct.slice(0, 40));
  }
  // 3. nothing came back
  if (!meaningful) return out(SA_OUTCOMES.EMPTY, 'empty_body', '');

  // 4. the page's own text says we were blocked. Strong signatures win regardless of length: real commercial pages
  //    do not describe themselves as a browser challenge.
  var s = saAnyHit(low, SA_STRONG_WAF);
  if (s) return out(SA_OUTCOMES.BLOCKED_WAF, 'waf_challenge_page', s);
  var g = saPairHit(low, SA_GEOBLOCK_PAIRS);
  if (g) return out(SA_OUTCOMES.BLOCKED_WAF, 'network_or_geo_restriction', g);
  var d = saAnyHit(low, SA_STRONG_DENIED);
  if (d) return out(SA_OUTCOMES.ACCESS_DENIED, 'access_denied_page', d);

  // 5. weak signals: only on a short page that carries no commercial content of its own — otherwise a lender that
  //    happens to mention "captcha" in its FAQ would be wrongly reported as blocked.
  if (meaningful.length < 1200 && biz === 0) {
    var w = saAnyHit(low, SA_WEAK);
    if (w) return out(SA_OUTCOMES.BLOCKED_WAF, 'short_page_block_signature', w);
  }
  // 6. too little to analyze (mirrors WF04's existing floor)
  if (meaningful.length < 80) return out(SA_OUTCOMES.EMPTY, 'body_too_short', String(meaningful.length) + ' chars');

  return out(SA_OUTCOMES.ACCESSIBLE, 'content_ok', '');
}

// The ONE user-facing Russian sentence per access failure. Never a status code, provider name, or raw page text.
// Every one states explicitly that the business was NOT judged — that is the whole point of BLOCK-HONESTY-001.
var SA_USER_RU = {
  blocked_by_waf: 'сайт вернул защитную страницу и не отдал содержимое — прочитать его не удалось',
  robots_or_access_denied: 'источник закрыл доступ к странице',
  provider_failure: 'сервис сбора данных не смог получить страницу',
  timeout: 'источник не ответил вовремя',
  empty_response: 'страница открылась пустой — содержимого для анализа нет',
  unsupported_content: 'по этому адресу не текстовая страница — анализировать нечего'
};
function saUserMessageRu(outcome) { return SA_USER_RU[saStr(outcome)] || 'источник сейчас недоступен'; }

// Cause-specific next actions (§7). Never "расширьте фильтры" for an access failure — no filter reaches a blocked page.
var SA_NEXT_RU = {
  blocked_by_waf: ['повторить попытку позже', 'использовать последний сохранённый снимок', 'проверить другой источник'],
  robots_or_access_denied: ['проверить другой источник', 'использовать последний сохранённый снимок'],
  provider_failure: ['повторить попытку', 'проверить другой источник'],
  timeout: ['повторить попытку', 'проверить другой источник'],
  empty_response: ['указать конкретную страницу услуги', 'проверить другой источник'],
  unsupported_content: ['указать страницу с текстом (например, раздел услуг)']
};
function saNextActionsRu(outcome, opts) {
  var list = (SA_NEXT_RU[saStr(outcome)] || ['повторить попытку позже']).slice();
  // Only offer the saved snapshot when one actually exists.
  if (!(opts && opts.has_snapshot)) list = list.filter(function (x) { return x.indexOf('сохранённ') < 0; });
  return list.slice(0, 3);
}

module.exports = {
  SA_OUTCOMES, SA_STRONG_WAF, SA_STRONG_DENIED, SA_GEOBLOCK_PAIRS, SA_WEAK, SA_BUSINESS_TERMS,
  classifySourceAccess, saIsAccessible, saIsAccessFailure, saIsRetryable, saUserMessageRu, saNextActionsRu
};
