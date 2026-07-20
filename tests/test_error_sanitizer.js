'use strict';
// WF04-ROUTE-002 — what a FAILED record may persist to technical_errors / skipped_log.
// These tabs are durable and human-readable, and their content is built from a provider response, so the gate must
// prove: no credential, no cookie, no hidden reasoning, no private PII, no unbounded raw body. Offline, $0.
const A = require('./_assert.js');
const S = require('../n8n/lib/error_sanitizer.js');

A.section('secrets are redacted — a credential must never reach a durable tab');
{
  const cases = [
    ['Authorization header', 'Request failed. Authorization: Bearer sk-ant-api03-AbCdEf0123456789xyzQwErTy', /sk-ant-api03/],
    ['bare bearer token', 'got 401 with bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcd1234', /eyJhbGciOiJIUzI1NiJ9/],
    ['basic auth', 'proxy said basic YWRtaW46c3VwZXJzZWNyZXQxMjM=', /YWRtaW46c3VwZXJzZWNyZXQ/],
    ['anthropic key', 'x-api-key: sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZ', /sk-ant-api03-Z/],
    ['generic sk- key', 'key sk-proj-abcdefghijklmnopqrstuvwxyz012345', /sk-proj-abcdefghij/],
    ['google api key', 'url ...?key=AIzaSyA1234567890abcdefghijklmnopqrstu', /AIzaSyA1234567890/],
    ['github token', 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', /ghp_ABCDEFGHIJ/],
    ['JWT', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiam9obiJ9.SflKxwRJSM', /SflKxwRJSM/],
    ['set-cookie', 'Set-Cookie: session=abc123def456; HttpOnly', /session=abc123def456/],
    ['json api_key', '{"api_key":"supersecretvalue123","model":"x"}', /supersecretvalue123/],
    ['json password', '{"password":"hunter2hunter2"}', /hunter2hunter2/],
    ['access_token pair', 'access_token=ya29.A0ARrdaM9xyzQQQQ', /ya29\.A0ARrdaM9xyz/],
    ['query secret', 'https://api.x/v1?token=abcdef123456&q=1', /token=abcdef123456/]
  ];
  cases.forEach(([name, raw, leak]) => {
    const out = S.sanitizeErrorPreview(raw);
    A.ok('redacts: ' + name, !leak.test(out), name + ' -> ' + out);
    A.ok('flags nothing secret-looking after: ' + name, !S.esLooksSecret(out), out);
  });
  // the detector itself must actually detect (otherwise the assertions above are vacuous)
  A.ok('esLooksSecret detects a raw anthropic key', S.esLooksSecret('sk-ant-api03-AAAAAAAAAAAAAAAAAAAA'));
  A.ok('esLooksSecret detects a raw Authorization header', S.esLooksSecret('Authorization: Bearer abcdef123456'));
  A.ok('esLooksSecret is quiet on clean text', !S.esLooksSecret('firecrawl returned 403 for https://x.ru'));
}

A.section('hidden model reasoning is never persisted');
{
  A.ok('xml thinking block stripped', S.sanitizeErrorPreview('<thinking>secret chain of thought</thinking> parse failed').indexOf('chain of thought') < 0);
  A.ok('json thinking field stripped', S.sanitizeErrorPreview('{"type":"thinking","thinking":"internal musing here"}').indexOf('internal musing') < 0);
  A.ok('thinking key/value stripped', S.sanitizeErrorPreview('thinking: "do not persist me"').indexOf('do not persist me') < 0);
  A.ok('the surviving text is still useful', /parse failed/.test(S.sanitizeErrorPreview('<thinking>x</thinking> parse failed')));
}

A.section('private PII is never persisted (we analyze public positioning, never harvest contacts)');
{
  const out = S.sanitizeErrorPreview('contact ivan.petrov@example.com or +7 (916) 123-45-67 about the loan');
  A.ok('email redacted', out.indexOf('ivan.petrov@example.com') < 0, out);
  A.ok('phone redacted', out.indexOf('916') < 0, out);
  A.ok('placeholders are human-readable', /\[email\]/.test(out) && /\[тел\]/.test(out), out);
}

A.section('the preview is BOUNDED — a raw provider body can never land in a tab');
{
  const huge = 'x'.repeat(50000);
  A.ok('default cap applied', S.sanitizeErrorPreview(huge).length <= S.ES_MAX_PREVIEW);
  A.eq('cap is a sane triage size', S.ES_MAX_PREVIEW, 300);
  A.ok('explicit cap honoured', S.sanitizeErrorPreview(huge, { max_chars: 50 }).length <= 50);
  A.ok('truncation is marked, not silent', /…$/.test(S.sanitizeErrorPreview(huge)));
  A.eq('empty in => empty out', S.sanitizeErrorPreview(''), '');
  A.eq('null in => empty out', S.sanitizeErrorPreview(null), '');
  A.eq('undefined in => empty out', S.sanitizeErrorPreview(undefined), '');
  A.ok('whitespace is collapsed (no giant blank runs)', S.sanitizeErrorPreview('a\n\n\n     b') === 'a b');
}

A.section('sanitizeErrorRecord keeps ONLY the diagnostic fields, by construction');
{
  const rec = S.sanitizeErrorRecord({
    provider: 'firecrawl', source_url: 'https://carmoney.ru/', error_category: 'technical_error',
    parse_error: 'HTTP 403 for Authorization: Bearer sk-ant-api03-LEAKLEAKLEAKLEAKLEAK',
    raw_response_preview: '<thinking>x</thinking> {"error":"blocked","api_key":"topsecret12345"}',
    agent_request_id: 'req_1', source_run_id: 'run_1', run_id: 'wf04_1', created_at: '2026-07-16T00:00:00+03:00',
    // fields that must NOT survive
    authorization: 'Bearer sk-ant-LEAK', cookies: 'a=b', full_body: 'x'.repeat(9000), thinking: 'hidden'
  });
  const keys = Object.keys(rec).sort();
  A.eq('exactly the allowed diagnostic fields', keys.join(','),
    ['agent_request_id', 'created_at', 'error_category', 'parse_error', 'provider', 'raw_response_preview', 'run_id', 'source_run_id', 'source_url'].join(','));
  A.ok('an unlisted field cannot ride along', rec.authorization === undefined && rec.full_body === undefined && rec.thinking === undefined);
  A.ok('lineage kept for triage', rec.agent_request_id === 'req_1' && rec.source_run_id === 'run_1' && rec.run_id === 'wf04_1');
  A.ok('provider kept', rec.provider === 'firecrawl');
  A.ok('source url kept', rec.source_url === 'https://carmoney.ru/');
  A.ok('category kept', rec.error_category === 'technical_error');
  A.ok('parse_error keeps the useful bit', /403/.test(rec.parse_error), rec.parse_error);
  A.ok('parse_error leaks no key', !S.esLooksSecret(rec.parse_error) && rec.parse_error.indexOf('sk-ant') < 0, rec.parse_error);
  A.ok('preview leaks no key', rec.raw_response_preview.indexOf('topsecret12345') < 0, rec.raw_response_preview);
  A.ok('preview leaks no thinking', rec.raw_response_preview.indexOf('hidden') < 0);
  A.ok('preview keeps the failure shape', /blocked/.test(rec.raw_response_preview), rec.raw_response_preview);
  A.ok('every persisted string is bounded', Object.keys(rec).every(k => String(rec[k]).length <= 400));
  A.eq('empty record is safe', Object.keys(S.sanitizeErrorRecord(null)).length, 9);
}

A.section('WF04-ROUTE-001 — the route contract is CLOSED: every emitted route maps to a declared tab');
{
  const fs = require('fs'); const path = require('path');
  const C = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sheets_contracts.json'), 'utf8'));
  const ROUTERS = ['02_claude_api_single_record_v2_resilient_router_production.json',
    '03_firecrawl_single_url_resilient.json', '04_firecrawl_url_list_resilient.json', '08_touchpoint_analyzer.json'];
  const base = C.headers['review_queue'];
  ROUTERS.forEach(f => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', f), 'utf8'));
    const routes = new Set();
    wf.nodes.forEach(n => {
      const c = (n.parameters || {}).jsCode || '';
      let m; const re = /route\s*[:=]\s*'([a-z_]+)'/g;
      while ((m = re.exec(c))) routes.add(m[1]);
    });
    routes.forEach(r => {
      A.ok(f.slice(0, 2) + ' route "' + r + '" is a DECLARED tab', !!C.tabs[r], 'undeclared route tab: ' + r);
      A.eq(f.slice(0, 2) + ' route "' + r + '" shares the 54-col record family', (C.headers[r] || []).length, base.length);
    });
    // the append that consumes the route must be fail-open: an audit destination can never kill collection.
    wf.nodes.filter(n => n.type === 'n8n-nodes-base.googleSheets' &&
      JSON.stringify((n.parameters || {}).sheetName || {}).indexOf('$json.route') >= 0)
      .forEach(n => {
        A.eq(f.slice(0, 2) + ' "' + n.name + '" is fail-open', n.onError, 'continueRegularOutput');
        A.eq(f.slice(0, 2) + ' "' + n.name + '" always emits', n.alwaysOutputData, true);
      });
  });
  // no route may be invented from unvalidated model output — the emitted value is always one of our own literals.
  const wf04 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '04_firecrawl_url_list_resilient.json'), 'utf8'));
  const nr = wf04.nodes.find(n => n.name === 'Normalize + Route').parameters.jsCode;
  A.ok('route is never spread in from the parsed provider payload', !/\.\.\.data\b/.test(nr) && !/Object\.assign\(\{\}\s*,\s*data\s*\)/.test(nr));
  // SOURCE-REUSE-001: reuse_route joins the allowlist. It is NOT model output — it comes from url_registry.last_route
  // (our own written value) and Evaluate Dedup additionally validates it against REUSABLE_ROUTES (the 3 data queues)
  // before the read node ever sees it.
  A.ok('dynamic tab allowlist is exactly the two validated route expressions',
    JSON.stringify(C.dynamic_tab_allowlist) === JSON.stringify(['={{ $json.route }}', '={{ $json.reuse_route }}']));
  const ed = wf04.nodes.find(n => n.name === 'Evaluate Dedup').parameters.jsCode;
  A.ok('reuse_route is allowlist-validated before any read', ed.indexOf("REUSABLE_ROUTES = ['monitor_queue', 'content_queue', 'review_queue']") >= 0 && /REUSABLE_ROUTES\.indexOf\(origRoute\)\s*<\s*0/.test(ed));
}

A.section('WF04-ROUTE-002 — the sanitizer is EMBEDDED at each persistence choke point (no drift)');
{
  const fs = require('fs'); const path = require('path');
  const LIB = path.join(__dirname, '..', 'n8n', 'lib', 'error_sanitizer.js');
  let core = fs.readFileSync(LIB, 'utf8').replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '').trim();
  const SITES = [
    ['02_claude_api_single_record_v2_resilient_router_production.json', 'Normalize + Route'],
    ['03_firecrawl_single_url_resilient.json', 'Normalize + Route'],
    ['04_firecrawl_url_list_resilient.json', 'Normalize + Route'],
    ['08_touchpoint_analyzer.json', 'Merge LLM Enrichment With Deterministic Row']
  ];
  SITES.forEach(([f, nodeName]) => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', f), 'utf8'));
    const node = wf.nodes.find(n => n.name === nodeName);
    A.ok(f.slice(0, 2) + ' has the choke-point node', !!node);
    const code = node.parameters.jsCode;
    const m = code.match(/\/\/ embedded n8n\/lib\/error_sanitizer\.js[^\n]*\n([\s\S]*?)\n\/\/ --- end embedded error_sanitizer ---/);
    A.ok(f.slice(0, 2) + ' embeds the sanitizer', !!m);
    A.eq(f.slice(0, 2) + ' embedded sanitizer matches the canonical lib (no drift)', m && m[1], core);
    // the persisted fields must go THROUGH it — no raw truncate survives on these two keys
    A.ok(f.slice(0, 2) + ' parse_error is sanitized', !/parse_error\s*:\s*truncate\(/.test(code), f);
    A.ok(f.slice(0, 2) + ' raw_response_preview is sanitized', !/raw_response_preview\s*:\s*truncate\(/.test(code), f);
    A.ok(f.slice(0, 2) + ' calls sanitizeErrorPreview', code.indexOf('sanitizeErrorPreview(') >= 0);
  });
}

A.report('error-sanitizer');
