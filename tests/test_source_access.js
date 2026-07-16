'use strict';
// BLOCK-HONESTY-001 — "we could not read the page" is NOT "we read the page and it is not a competitor".
// Live regression (carmoney.ru, WF04 exec 894): a 772-char access-restriction page cleared the 80-char content
// floor, reached Claude, came back entity_type=irrelevant, and the user was told the site was checked and found
// irrelevant. It was never read. Access is now decided BEFORE business relevance. Offline, $0.
const A = require('./_assert.js');
const S = require('../n8n/lib/source_access.js');
const H = require('./wf_harness.js');
const fs = require('fs'); const path = require('path');

// The ACTUAL page Firecrawl returned for carmoney.ru, verbatim from execution 894.
const REAL_BLOCK = [
  '# carmoney.ru is not available', '',
  'It looks like the website owner has restricted access from your current network', '',
  'To protect their website from malicious activity, the owner or administrator may block access from specific',
  'countries, networks, or IP addresses. If you believe there was a mistake, you can:', '',
  '- **Check to see if you have enabled a VPN** or any kind of proxy. Such services mask your real IP with their',
  '  own, which might be restricted on this website;',
  '- **Change your connection settings**, e.g., switch from Wi-Fi to mobile data, or try using a different device;',
  '- **Contact carmoney.ru support** and tell them about the issue.'
].join('\n');
// A real Moscow lender page — deliberately mentions "captcha"/"vpn" in its own copy.
const REAL_PAGE = [
  '# Автоломбард №1', 'Займы под ПТС за 30 минут. Ставка от 3% в месяц, сумма до 5 млн руб.',
  'Оставить заявку на кредит. Одобрение 95%. Наш офис в Москве.',
  'Форма заявки защищена captcha. Услуги: залог авто, рефинансирование, ипотека.'
].join('\n');

A.section('the LIVE regression: the real carmoney.ru page is a BLOCK, not an irrelevant business');
{
  const r = S.classifySourceAccess({ status: 200, body_text: REAL_BLOCK });
  A.eq('outcome', r.outcome, S.SA_OUTCOMES.BLOCKED_WAF);
  A.eq('reason names the real cause', r.reason, 'network_or_geo_restriction');
  A.eq('it is an ACCESS failure, not a business verdict', r.access_failure, true);
  A.eq('a block may lift => retryable', r.retryable, true);
  A.eq('the page carries no business content', r.business_terms, 0);
  A.ok('it cleared the old 80-char floor (which is exactly why the bug happened)', r.meaningful_chars > 80);
  A.ok('the user sentence never claims the site was checked', !/проверен/.test(S.saUserMessageRu(r.outcome)));
  A.ok('the user sentence never says irrelevant', !/нерелевант|не подходит/.test(S.saUserMessageRu(r.outcome)));
}

A.section('every access outcome is detected');
{
  const cases = [
    ['cloudflare interstitial', { status: 200, body_text: 'Just a moment...\nChecking your browser before accessing example.ru' }, 'blocked_by_waf'],
    ['cloudflare ray id', { status: 200, body_text: 'Attention Required! | Cloudflare\nCloudflare Ray ID: 8abc' }, 'blocked_by_waf'],
    ['cloudflare 1020', { status: 200, body_text: 'Error 1020\nAccess denied by the owner' }, 'blocked_by_waf'],
    ['js/cookie challenge', { status: 200, body_text: 'Enable JavaScript and cookies to continue' }, 'blocked_by_waf'],
    ['human check', { status: 200, body_text: 'Verify you are human by completing the action below' }, 'blocked_by_waf'],
    ['incapsula', { status: 200, body_text: 'Request unsuccessful. Incapsula incident ID: 123' }, 'blocked_by_waf'],
    ['russian challenge', { status: 200, body_text: 'Проверка браузера, подождите' }, 'blocked_by_waf'],
    ['rate limited', { status: 429, body_text: 'Too Many Requests' }, 'blocked_by_waf'],
    ['403', { status: 403, body_text: '<html>Forbidden</html>' }, 'robots_or_access_denied'],
    ['401', { status: 401, body_text: 'Unauthorized' }, 'robots_or_access_denied'],
    ['403 page body @200', { status: 200, body_text: "403 Forbidden\nYou don't have permission to access this resource" }, 'robots_or_access_denied'],
    ['russian denial', { status: 200, body_text: 'Доступ запрещён для вашего региона' }, 'robots_or_access_denied'],
    ['5xx', { status: 502, body_text: 'Bad Gateway' }, 'provider_failure'],
    ['404', { status: 404, body_text: 'Not found' }, 'provider_failure'],
    ['provider error', { status: 0, error: 'firecrawl exploded' }, 'provider_failure'],
    ['timeout by category', { status: 0, error_category: 'timeout' }, 'timeout'],
    ['timeout by message', { status: 0, error: 'ETIMEDOUT after 30s' }, 'timeout'],
    ['empty body', { status: 200, body_text: '' }, 'empty_response'],
    ['whitespace only', { status: 200, body_text: '   \n\n  ' }, 'empty_response'],
    ['too short', { status: 200, body_text: 'Hello' }, 'empty_response'],
    ['pdf', { status: 200, body_text: 'x'.repeat(500), content_type: 'application/pdf' }, 'unsupported_content'],
    ['image', { status: 200, body_text: 'x'.repeat(500), content_type: 'image/png' }, 'unsupported_content'],
    ['real page', { status: 200, body_text: REAL_PAGE }, 'accessible_content']
  ];
  cases.forEach(([name, input, want]) => A.eq(name + ' => ' + want, S.classifySourceAccess(input).outcome, want));
  A.ok('html is supported', S.classifySourceAccess({ status: 200, body_text: REAL_PAGE, content_type: 'text/html; charset=utf-8' }).outcome === 'accessible_content');
}

A.section('a REAL page is never mistaken for a block (the false-positive that would hide real competitors)');
{
  const r = S.classifySourceAccess({ status: 200, body_text: REAL_PAGE });
  A.eq('a lender page that mentions captcha is still accessible', r.outcome, 'accessible_content');
  A.ok('its business content is recognised', r.business_terms >= 3);
  // weak signals must not fire on a long commercial page
  A.eq('long page + "unusual traffic" in copy is still accessible',
    S.classifySourceAccess({ status: 200, body_text: REAL_PAGE + ' '.repeat(10) + 'Мы фиксируем unusual traffic на сайте. ' + 'заявка кредит ставка '.repeat(40) }).outcome, 'accessible_content');
  // ...but a SHORT page with no business content and a weak signal is a block
  A.eq('short + no business content + captcha => blocked',
    S.classifySourceAccess({ status: 200, body_text: 'Security check in progress. Please wait while we verify your request. recaptcha' }).outcome, 'blocked_by_waf');
  A.eq('accessible is the only "we have content" outcome', S.saIsAccessible('accessible_content'), true);
  ['blocked_by_waf', 'robots_or_access_denied', 'provider_failure', 'timeout', 'empty_response', 'unsupported_content']
    .forEach(o => A.eq(o + ' is an access failure', S.saIsAccessFailure(o), true));
  A.eq('valid_but_irrelevant is NOT an access failure (it is a business verdict)', S.saIsAccessFailure('valid_but_irrelevant'), false);
  A.eq('accessible is NOT an access failure', S.saIsAccessFailure('accessible_content'), false);
  A.eq('unsupported content will not fix itself => not retryable', S.saIsRetryable('unsupported_content'), false);
  A.eq('a block may lift => retryable', S.saIsRetryable('blocked_by_waf'), true);
}

A.section('§7 — user message + next actions match the CAUSE, never "расширьте фильтры"');
{
  ['blocked_by_waf', 'robots_or_access_denied', 'provider_failure', 'timeout', 'empty_response', 'unsupported_content'].forEach(o => {
    const m = S.saUserMessageRu(o);
    A.ok(o + ': has a Russian sentence', /[а-яё]/i.test(m));
    A.ok(o + ': never claims the source was checked', !/проверен/.test(m), m);
    A.ok(o + ': never calls the business irrelevant', !/нерелевант/.test(m), m);
    A.ok(o + ': leaks no internal token', !/[a-z_]{6,}/.test(m.replace(/[А-Яа-яЁё\s.,—:;()-]/g, '')), m);
    const next = S.saNextActionsRu(o, { has_snapshot: true });
    A.ok(o + ': offers 1-3 actions', next.length >= 1 && next.length <= 3);
    A.ok(o + ': never recommends widening filters', !next.some(x => /фильтр/.test(x)), JSON.stringify(next));
  });
  A.ok('blocked offers a retry', S.saNextActionsRu('blocked_by_waf', { has_snapshot: false }).some(x => /повторить/.test(x)));
  A.ok('blocked offers the saved snapshot WHEN one exists', S.saNextActionsRu('blocked_by_waf', { has_snapshot: true }).some(x => /сохранённ/.test(x)));
  A.ok('...and never offers it when none exists', !S.saNextActionsRu('blocked_by_waf', { has_snapshot: false }).some(x => /сохранённ/.test(x)));
  A.ok('an unknown outcome still yields a safe sentence', /[а-яё]/i.test(S.saUserMessageRu('something_new')));
}

A.section('WF04 — the classifier runs BEFORE business relevance, on the real node');
{
  const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '04_firecrawl_url_list_resilient.json'), 'utf8'));
  const node = wf.nodes.find(n => n.name === 'Normalize Firecrawl Output');
  const code = node.parameters.jsCode;
  // embedded, drift-free
  let core = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', 'source_access.js'), 'utf8')
    .replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '').trim();
  const m = code.match(/\/\/ embedded n8n\/lib\/source_access\.js[^\n]*\n([\s\S]*?)\n\/\/ --- end embedded source_access ---/);
  A.ok('WF04 embeds the access classifier', !!m);
  A.eq('embedded copy matches the canonical lib (no drift)', m && m[1], core);
  A.ok('access is decided before the Claude request is built', code.indexOf('classifySourceAccess') < code.length);

  function run(md) {
    const r = H.makeRun();
    H.inject(r, 'Evaluate Dedup', [{ source_url: 'https://carmoney.ru/', target_url: 'https://carmoney.ru/', run_id: 'r1', batch_index: 0, parsed_at: '2026-07-16T12:00:00+03:00' }]);
    return H.runCodeNode(r, wf, 'Normalize Firecrawl Output', [{ json: { success: true, data: { markdown: md, metadata: { title: 't' } } } }])[0].json;
  }
  const b = run(REAL_BLOCK);
  A.eq('THE REGRESSION: a blocked page is NOT entity_type=irrelevant', b.entity_type, 'unknown');
  A.ok('it never becomes a competitor', b.entity_type !== 'competitor');
  A.eq('it routes to the technical audit tab', b.route, 'technical_errors');
  A.eq('it carries the access outcome', b.access_outcome, 'blocked_by_waf');
  A.eq('it records retryability', b.access_retryable, true);
  A.eq('parse_method names the access cause', b.parse_method, 'source_blocked_by_waf');
  A.eq('processing_status stays the known technical_error enum (downstream-safe)', b.processing_status, 'technical_error');
  A.ok('the stored reason is the honest Russian sentence', /защитную страницу/.test(b.reason), b.reason);
  A.ok('the stored reason never says "проверен"', !/проверен/.test(b.reason));
  A.ok('no business fields are invented', !b.company_name && !b.offer_text);
  A.ok('the preview is bounded', String(b.raw_response_preview).length <= 520);
  A.ok('it needs manual review', b.needs_manual_review === true);

  // an accessible page must still flow through untouched
  const g = run(REAL_PAGE);
  A.ok('a real page carries no access_outcome (it is accessible)', !g.access_outcome);
  A.ok('a real page keeps its text for analysis', String(g.text_context || '').length > 0);
  A.ok('a real page is not routed to technical_errors', g.route !== 'technical_errors');

  // every access failure shape reaching the node is handled the same honest way
  [['Just a moment...\nChecking your browser before accessing carmoney.ru', 'blocked_by_waf'],
   ["403 Forbidden\nYou don't have permission to access this resource on this server", 'robots_or_access_denied']]
    .forEach(([md, want]) => {
      const r = run(md);
      A.eq('node: ' + want + ' => entity_type unknown', r.entity_type, 'unknown');
      A.eq('node: ' + want + ' => access_outcome', r.access_outcome, want);
    });
}

A.report('source-access');
