// test_ingress_proxy.js — integration test for ops/ingress/telegram_webhook_proxy.js. Stands up a stub "n8n"
// upstream + the real proxy on loopback, then proves the public surface is exactly ONE route: POST the webhook
// path. Everything else (editor /, /rest, /api, /webhook-test, wrong method, oversize body) is 404/413 and NEVER
// reaches the upstream. Zero network beyond loopback; $0.
'use strict';
const A = require('./_assert');
const http = require('http');
const P = require('../ops/ingress/telegram_webhook_proxy.js');

const WEBHOOK = '/webhook/ms-telegram-agent';
let upstreamHits = [];     // records what actually reached the "n8n" upstream

function once(fn) { return new Promise((res) => fn(res)); }
function req(opts, body) {
  return new Promise((resolve) => {
    const r = http.request(opts, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ code: res.statusCode, body: d, headers: res.headers })); });
    r.on('error', () => resolve({ code: -1, body: '' }));
    if (body != null) r.write(body);
    r.end();
  });
}

(async () => {
  // stub upstream that records every request it receives (it must ONLY ever see the allowed webhook POST)
  const upstream = http.createServer((q, s) => {
    let b = ''; q.on('data', c => b += c); q.on('end', () => {
      upstreamHits.push({ method: q.method, path: q.url, secret: q.headers['x-telegram-bot-api-secret-token'] || '', xff: q.headers['x-forwarded-for'] || '', ct: q.headers['content-type'] || '' });
      s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"ok":true}');
    });
  });
  await once(r => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;

  const c = { host: '127.0.0.1', port: 0, upstream: 'http://127.0.0.1:' + upPort, webhookPath: WEBHOOK, maxBody: 1024, timeoutMs: 4000 };
  const logs = [];
  const proxy = P.createServer(c, (l) => logs.push(l));
  await once(r => proxy.listen(0, '127.0.0.1', r));
  const port = proxy.address().port;
  const base = { hostname: '127.0.0.1', port: port };
  const G = (path, method) => req(Object.assign({}, base, { path, method: method || 'GET' }));
  const POST = (path, body, headers) => req(Object.assign({}, base, { path, method: 'POST', headers: headers || { 'content-type': 'application/json' } }), body);

  A.section('PUBLIC SURFACE — only POST <webhook> is allowed; everything else is 404 and never reaches upstream');
  const editor = await G('/');                         A.ok('PUBLIC_ROOT_DENIED (editor / -> 404)', editor.code === 404);
  const signin = await G('/signin');                   A.ok('PUBLIC_EDITOR_DENIED (/signin -> 404)', signin.code === 404);
  const rest = await G('/rest/workflows');             A.ok('PUBLIC_REST_API_DENIED (/rest/* -> 404)', rest.code === 404);
  const api = await G('/api/v1/workflows');            A.ok('PUBLIC_API_DENIED (/api/* -> 404)', api.code === 404);
  const test = await POST('/webhook-test/ms-telegram-agent', '{}'); A.ok('PUBLIC_TEST_WEBHOOK_DENIED (/webhook-test/* -> 404)', test.code === 404);
  const wrongMethod = await G(WEBHOOK, 'GET');         A.ok('PUBLIC_WRONG_METHOD_DENIED (GET on webhook -> 404)', wrongMethod.code === 404);
  const putMethod = await req(Object.assign({}, base, { path: WEBHOOK, method: 'PUT' }), '{}'); A.ok('PUT on webhook -> 404', putMethod.code === 404);
  const otherPath = await POST('/webhook/other', '{}'); A.ok('POST other webhook path -> 404', otherPath.code === 404);

  A.ok('NONE of the denied requests reached the upstream (n8n editor structurally unreachable)', upstreamHits.length === 0,
    'upstream saw ' + upstreamHits.length + ' request(s)');

  A.section('ALLOWED ROUTE — POST <webhook> reaches upstream with body + telegram secret + X-Forwarded-* preserved');
  const ok = await POST(WEBHOOK, JSON.stringify({ update_id: 1 }), {
    'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'SECRET123',
    'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https'
  });
  A.ok('PUBLIC_EXACT_WEBHOOK_REACHABLE (POST webhook -> 200)', ok.code === 200);
  A.ok('upstream received exactly ONE request', upstreamHits.length === 1, 'hits=' + upstreamHits.length);
  if (upstreamHits.length === 1) {
    const h = upstreamHits[0];
    A.ok('upstream got POST on the exact webhook path', h.method === 'POST' && h.path === WEBHOOK);
    A.ok('Telegram secret-token header preserved to upstream', h.secret === 'SECRET123');
    A.ok('X-Forwarded-For preserved to upstream', h.xff === '203.0.113.9');
    A.ok('Content-Type preserved to upstream', /application\/json/.test(h.ct));
  }

  A.section('LIMITS — oversize body rejected (413) and never forwarded; logs never contain the secret token');
  const big = 'x'.repeat(2048);
  const oversize = await POST(WEBHOOK, big, { 'content-type': 'text/plain' });
  A.ok('oversize body -> 413', oversize.code === 413);
  A.ok('oversize body did NOT reach upstream', upstreamHits.length === 1, 'hits=' + upstreamHits.length);
  A.ok('NO secret-token value appears in proxy logs', !logs.join('\n').includes('SECRET123'));
  A.ok('logs are sanitized (method+path+status only)', logs.every(l => /^proxy [A-Z]+ \/[^ ]* -> \d+/.test(l)));

  if (upstreamHits.length === 1 && editor.code === 404 && rest.code === 404) console.log('INGRESS_PATH_FILTER=PASS');

  proxy.close(); upstream.close();
  A.report('ingress-proxy');
})();
