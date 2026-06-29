// telegram_webhook_proxy.js — a minimal, loopback-only path-filter reverse proxy that exposes EXACTLY ONE route
// to the public ngrok ingress: `POST <MS_PROXY_WEBHOOK_PATH>` (the secure WF18 Telegram webhook). Every other
// path and method — the n8n editor (/), sign-in, /rest/*, /api/*, /webhook-test/*, GET/PUT/... on the webhook
// path — is answered 404 by THIS process and is NEVER forwarded to n8n. ngrok points here, never directly at n8n,
// so the n8n editor/API are structurally unreachable from the internet even if the tunnel forwards everything.
//
// Zero dependencies (Node http only). Binds 127.0.0.1 ONLY (never 0.0.0.0). Preserves the request body and the
// headers Telegram + a reverse proxy need (Content-Type, X-Telegram-Bot-Api-Secret-Token, X-Forwarded-*). Enforces
// a body-size cap and an upstream timeout. NEVER logs request bodies, the secret-token header, or any auth header.
'use strict';
const http = require('http');

function cfg(env) {
  env = env || process.env;
  return {
    host: '127.0.0.1',                                              // loopback ONLY — never 0.0.0.0
    port: Number(env.MS_PROXY_LISTEN_PORT || 8769),
    upstream: env.MS_PROXY_UPSTREAM || 'http://127.0.0.1:5678',
    webhookPath: env.MS_PROXY_WEBHOOK_PATH || '/webhook/ms-telegram-agent',
    maxBody: Number(env.MS_PROXY_MAX_BODY || 1048576),             // 1 MiB cap
    timeoutMs: Number(env.MS_PROXY_TIMEOUT_MS || 15000)
  };
}

// Headers we deliberately forward (lower-cased). Nothing else is passed on — no cookies, no n8n auth, nothing that
// could turn this into an open relay to the editor/API.
const FORWARD_HEADERS = ['content-type', 'content-length', 'x-telegram-bot-api-secret-token',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'user-agent'];
// header names that must NEVER be logged.
const SECRET_HEADERS = ['x-telegram-bot-api-secret-token', 'authorization', 'cookie'];

function pathOf(url) { const i = url.indexOf('?'); return i >= 0 ? url.slice(0, i) : url; }

function createServer(c, logLine) {
  c = c || cfg();
  const log = logLine || ((s) => process.stdout.write(s + '\n'));
  const up = new URL(c.upstream);

  return http.createServer((req, res) => {
    const reqPath = pathOf(req.url || '');
    const accept = req.method === 'POST' && reqPath === c.webhookPath;       // the ONE allowed route
    // sanitized access log: method + path + decision only. NEVER the body or a secret header value.
    const deny = (code, msg) => { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(msg + '\n');
      log('proxy ' + req.method + ' ' + reqPath + ' -> ' + code); };

    if (!accept) return deny(404, 'Not Found');                              // editor/api/test/other-method/other-path

    // read the body with a hard cap (reject oversize without buffering the whole thing)
    let size = 0; const chunks = [];
    let aborted = false;
    req.on('data', (ch) => {
      if (aborted) return;
      size += ch.length;
      if (size > c.maxBody) { aborted = true; deny(413, 'Payload Too Large'); req.destroy(); return; }
      chunks.push(ch);
    });
    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks);
      const headers = {};
      for (const h of FORWARD_HEADERS) { if (req.headers[h] != null) headers[h] = req.headers[h]; }
      headers['content-length'] = String(body.length);
      const opts = { protocol: up.protocol, hostname: up.hostname, port: up.port || 80,
        method: 'POST', path: c.webhookPath, headers: headers, timeout: c.timeoutMs };
      const upReq = http.request(opts, (upRes) => {
        // pass the upstream status + a safe subset of headers straight back to Telegram
        const outH = {};
        if (upRes.headers['content-type']) outH['content-type'] = upRes.headers['content-type'];
        res.writeHead(upRes.statusCode || 502, outH);
        upRes.pipe(res);
        log('proxy POST ' + reqPath + ' -> ' + (upRes.statusCode || 502) + ' (upstream)');
      });
      upReq.on('timeout', () => { upReq.destroy(); if (!res.headersSent) { res.writeHead(504); res.end('Gateway Timeout\n'); } log('proxy POST ' + reqPath + ' -> 504 (upstream timeout)'); });
      upReq.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('Bad Gateway\n'); } log('proxy POST ' + reqPath + ' -> 502 (upstream error)'); });
      upReq.end(body);
    });
    req.on('error', () => { if (!res.headersSent) deny(400, 'Bad Request'); });
  });
}

module.exports = { cfg, createServer, FORWARD_HEADERS, SECRET_HEADERS, pathOf };

if (require.main === module) {
  const c = cfg();
  const server = createServer(c);
  server.listen(c.port, c.host, () => {
    // never print the webhook path's secret token or any body — only the bind + route facts.
    process.stdout.write('telegram_webhook_proxy listening on ' + c.host + ':' + c.port +
      ' — only POST ' + c.webhookPath + ' -> ' + c.upstream + ' (all else 404)\n');
  });
}
