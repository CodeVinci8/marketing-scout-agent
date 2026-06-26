// test_release_shell.js — Stage 8 release shell-safety gate (DEPLOY-001, BACKUP-001, OPERATOR-001/002).
// Static + behavioural checks on every committed shell script: syntax (sh -n / bash -n), forbidden destructive
// patterns, no broken indirect expansion, and the n8n execution abstraction's docker/host/dry/guard behaviour.
// Pure + offline ($0): the abstraction is exercised ONLY in MS_N8N_EXEC_DRY=1 mode, so NO docker is ever run.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT_DIRS = [path.join(ROOT, 'scripts'), path.join(ROOT, 'scripts', 'lib')];

function listScripts() {
  const out = [];
  for (const d of SCRIPT_DIRS) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/\.sh$/.test(f) || /\.example$/.test(f)) continue;
      out.push(path.join(d, f));
    }
  }
  return out;
}
function shebang(file) { return (fs.readFileSync(file, 'utf8').split('\n')[0] || ''); }
function syntaxCheck(file) {
  const interp = /bash/.test(shebang(file)) ? 'bash' : 'sh';
  try { execFileSync(interp, ['-n', file], { stdio: 'pipe' }); return { ok: true }; }
  catch (e) { return { ok: false, err: (e.stderr || e.stdout || '').toString() }; }
}

const scripts = listScripts();

A.section('every committed shell script parses (sh -n / bash -n)');
A.ok('found shell scripts', scripts.length >= 4);
for (const s of scripts) {
  const r = syntaxCheck(s);
  A.ok('syntax ok: ' + path.basename(s) + (r.ok ? '' : ' :: ' + r.err.slice(0, 120)), r.ok);
}

A.section('no forbidden destructive / secret-leaking patterns in committed scripts');
// Patterns that must NEVER appear literally in a committed script (production-data destruction, decrypted creds,
// or the OPERATOR-001 broken indirect-length expansion `${#!v}`).
const FORBIDDEN = [
  ['docker compose down -v', /docker\s+compose\s+down\s+-v/],
  ['docker-compose down -v', /docker-compose\s+down\s+-v/],
  ['volume rm n8n_n8n_data', /volume\s+rm[^\n]*n8n_n8n_data/],
  ['docker volume prune', /docker\s+volume\s+prune/],
  ['docker system prune', /docker\s+system\s+prune/],
  ['credentials --decrypted export', /export:credentials[^\n]*--decrypted/],
  ['broken indirect length ${#!', /\$\{#!/]
];
// n8n_exec.sh is the guard-DEFINITION file: it deliberately names these patterns in order to REFUSE them, so it
// is excluded from the literal-occurrence scan and covered positively below instead.
const GUARD_DEF = 'n8n_exec.sh';
for (const s of scripts) {
  if (path.basename(s) === GUARD_DEF) continue;
  const txt = fs.readFileSync(s, 'utf8');
  for (const [label, re] of FORBIDDEN) A.ok('absent in ' + path.basename(s) + ': ' + label, !re.test(txt));
}

A.section('n8n_exec.sh defines a destructive-operation guard covering the forbidden patterns');
{
  const guard = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'n8n_exec.sh'), 'utf8');
  A.ok('defines n8n_guard_destructive()', /n8n_guard_destructive\(\)/.test(guard));
  for (const pat of ['down -v', 'volume rm', 'volume prune', 'system prune', '--decrypted', 'n8n_n8n_data'])
    A.ok('guard names forbidden pattern: ' + pat, guard.indexOf(pat) >= 0);
}

A.section('OPERATOR-001 — correct indirect expansion idiom is used where indirection appears');
// If a script reads a variable indirectly it must use the safe two-step form, never ${#!v}.
for (const s of scripts) {
  const txt = fs.readFileSync(s, 'utf8');
  if (/\$\{!/.test(txt)) A.ok(path.basename(s) + ' uses ${!v...} not ${#!v}', !/\$\{#!/.test(txt));
}

// ---- behavioural: n8n_exec abstraction in DRY mode (no docker ever invoked) ----
function dryEval(envExtra, body) {
  const script = '. "' + path.join(ROOT, 'scripts', 'lib', 'n8n_exec.sh') + '"\n' + body;
  const env = Object.assign({}, process.env, { MS_N8N_EXEC_DRY: '1' }, envExtra);
  try { return { ok: true, out: execFileSync('bash', ['-c', script], { env, encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || ''), code: e.status }; }
}

A.section('n8n_exec — docker mode routes through `docker exec <container>` and /bin/sh');
{
  const r = dryEval({ MS_N8N_MODE: 'docker', MS_N8N_CONTAINER: 'n8n-n8n-1' },
    'n8n_cli list:workflow; n8n_sh "ls $MS_N8N_DATA_PATH"');
  A.ok('docker exec cli call', /DRYEXEC: docker exec n8n-n8n-1 n8n list:workflow/.test(r.out));
  A.ok('docker exec sh call uses /bin/sh', /DRYEXEC: docker exec n8n-n8n-1 \/bin\/sh -c/.test(r.out));
}

A.section('n8n_exec — host mode routes through the host CLI / local /bin/sh');
{
  const r = dryEval({ MS_N8N_MODE: 'host' }, 'n8n_cli list:workflow; n8n_sh "echo hi"');
  A.ok('host cli call', /DRYEXEC: n8n list:workflow/.test(r.out));
  A.ok('host sh call', /DRYEXEC: \/bin\/sh -c echo hi/.test(r.out));
}

A.section('BACKUP-001 — disposable/backup path overrides the n8n entrypoint with /bin/sh');
{
  const r = dryEval({ MS_N8N_MODE: 'docker' }, 'n8n_run_image_sh "tar -czf /work/x.tgz ." -v /b:/work');
  A.ok('docker run overrides entrypoint to /bin/sh', /DRYEXEC: docker run --rm --entrypoint \/bin\/sh/.test(r.out));
  A.ok('pinned image, never :latest', /n8nio\/n8n:2\.23\.3/.test(r.out) && !/n8nio\/n8n:latest/.test(r.out));
}

A.section('n8n_exec — destructive guard refuses forbidden operations (defense in depth)');
{
  const bad = dryEval({}, 'if n8n_guard_destructive "docker compose down -v"; then echo ALLOW; else echo REFUSE; fi');
  A.ok('down -v refused', /REFUSE/.test(bad.out) && !/ALLOW/.test(bad.out));
  const decrypted = dryEval({}, 'if n8n_guard_destructive "n8n export:credentials --decrypted"; then echo ALLOW; else echo REFUSE; fi');
  A.ok('--decrypted refused', /REFUSE/.test(decrypted.out));
  const ok = dryEval({}, 'if n8n_guard_destructive "n8n list:workflow"; then echo ALLOW; else echo REFUSE; fi');
  A.ok('benign command allowed', /ALLOW/.test(ok.out));
}

A.section('n8n_exec — dry mode never executes (n8n_available returns true without touching docker)');
{
  const r = dryEval({ MS_N8N_MODE: 'docker' }, 'if n8n_available; then echo AVAIL; else echo NO; fi');
  A.ok('available in dry mode', /AVAIL/.test(r.out));
}

A.report('release-shell');
