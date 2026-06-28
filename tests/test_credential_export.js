// test_credential_export.js — CRED-002: the Docker-safe non-decrypted credential export (export_credentials) must
// fail CLOSED on every error path and only succeed when a non-empty, parseable JSON array landed on the HOST. Pure
// + offline ($0): host mode is exercised with a STUB `n8n` on PATH (no real n8n), docker mode only in DRY mode
// (MS_N8N_EXEC_DRY=1 — no docker ever invoked). The function is sourced from the REAL deploy_n8n.sh via the
// MS_DEPLOY_SOURCE_ONLY testability hook, so this tests the shipped implementation, not a copy.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPLOY = path.join(ROOT, 'scripts', 'deploy_n8n.sh');

// Run `export_credentials <out>` in host mode against a stub `n8n` whose behaviour is selected by STUB. Returns
// { rc, out, exists, content }.
function runHost(stub) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'credexp-'));
  const bin = path.join(work, 'bin');
  fs.mkdirSync(bin);
  // stub n8n: only export:credentials is meaningful; everything else exits 0.
  const stubSh = [
    '#!/usr/bin/env bash',
    'out=""',
    'for a in "$@"; do case "$a" in --output=*) out="${a#--output=}";; esac; done',
    'if [ "$1" = "export:credentials" ]; then',
    '  case "$STUB" in',
    '    ok) printf "%s" \'[{"id":"a","name":"n","type":"googleApi"}]\' > "$out";;',
    '    empty) : > "$out";;',
    '    malformed) printf "%s" "{not json" > "$out";;',
    '    noarray) printf "%s" \'{"foo":1}\' > "$out";;',
    '    fail) exit 1;;',
    '    *) exit 1;;',
    '  esac',
    'fi',
    'exit 0'
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'n8n'), stubSh, { mode: 0o755 });
  const out = path.join(work, 'creds.json');
  const script = '. "' + DEPLOY + '"\n' +
    'if export_credentials "' + out + '"; then echo "RC=0"; else echo "RC=$?"; fi';
  const env = Object.assign({}, process.env, {
    MS_DEPLOY_SOURCE_ONLY: '1', MS_N8N_MODE: 'host', STUB: stub,
    PATH: bin + ':' + process.env.PATH
  });
  let res;
  try { res = execFileSync('bash', ['-c', script], { env, encoding: 'utf8' }); }
  catch (e) { res = ((e.stdout || '') + (e.stderr || '')).toString(); }
  const exists = fs.existsSync(out);
  const content = exists ? fs.readFileSync(out, 'utf8') : '';
  fs.rmSync(work, { recursive: true, force: true });
  return { out: res, rc: /RC=0/.test(res) ? 0 : 1, exists, content };
}

A.section('CRED-002 — export_credentials fails CLOSED on every error path (host stub)');
{
  const ok = runHost('ok');
  A.ok('valid array export -> rc 0', ok.rc === 0);
  A.ok('valid array export -> host file is a parseable array', ok.exists && Array.isArray(JSON.parse(ok.content)));

  A.ok('container/CLI export failure -> rc != 0', runHost('fail').rc !== 0);
  A.ok('empty export file -> rc != 0 (non-empty check)', runHost('empty').rc !== 0);
  A.ok('malformed JSON export -> rc != 0 (parse check)', runHost('malformed').rc !== 0);
  A.ok('valid JSON but not an array -> rc != 0 (shape check)', runHost('noarray').rc !== 0);
}

A.section('CRED-002 — never uses --decrypted, and docker mode cleans the in-container temp');
{
  // Static: the export command in deploy_n8n.sh must NEVER carry --decrypted.
  const src = fs.readFileSync(DEPLOY, 'utf8');
  A.ok('export:credentials never passes --decrypted', !/export:credentials[^\n]*--decrypted/.test(src));
  A.ok('export_credentials verifies a JSON array before use', /Array\.isArray/.test(src.split('export_credentials()')[1].split('\n}')[0]));

  // The function's inner commands are quiet (>/dev/null) in production, so the docker-safe shape is asserted on the
  // source: it must copy OUT via n8n_get (a host path is invisible to the container CLI) and clean the in-container
  // temp via an rm so a failed/empty export never leaves a file behind on the container layer.
  const body = src.split('export_credentials()')[1].split('\ndo_import()')[0];
  A.ok('docker branch copies OUT via n8n_get (not a host --output)', /n8n_get\s+"\$cdir"\s+"\$hdir"/.test(body));
  A.ok('docker branch cleans the in-container temp (n8n_sh rm -rf)', /n8n_sh\s+"rm -rf \$cdir"/.test(body));
  A.ok('export uses n8n_available gate (fails closed when n8n unreachable)', /n8n_available \|\| return 1/.test(body));

  // Behavioural: in DRY docker mode no real file is written, so the function must STILL fail closed (never a false
  // success) — proving the host-side existence/parse check, not the (suppressed) CLI exit code, gates success.
  const script = '. "' + DEPLOY + '"\n' + 'if export_credentials /tmp/ms-creds-test-$$.json; then echo RC=0; else echo RC=1; fi';
  const env = Object.assign({}, process.env, {
    MS_DEPLOY_SOURCE_ONLY: '1', MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'n8n-n8n-1', MS_N8N_EXEC_DRY: '1'
  });
  let out = '';
  try { out = execFileSync('bash', ['-c', script], { env, encoding: 'utf8' }); }
  catch (e) { out = ((e.stdout || '') + (e.stderr || '')).toString(); }
  A.ok('docker dry mode (no real file) -> fails closed, no false success', /RC=1/.test(out));
}

A.report('credential-export');
