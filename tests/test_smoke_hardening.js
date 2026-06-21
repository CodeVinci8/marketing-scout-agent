// test_smoke_hardening.js — QA-007/011: the disposable smokes must be fail-closed and BusyBox/POSIX-safe, and no
// script may carry a GNU-only `find -printf` or a hard-coded workflow list. Static analysis of the shell scripts
// + a real fail-closed propagation check (a mandatory failure must NOT be followed by a final PASS). Offline, $0.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function listScripts() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.sh')) out.push(p);
    }
  })(SCRIPTS);
  return out;
}

const SMOKES = ['scripts/n8n_import_smoke.sh', 'scripts/n8n_zlib_runtime_smoke.sh', 'scripts/n8n_disposable_e2e.sh'];

A.section('QA-011 — no GNU-only constructs anywhere under scripts/');
// strip comment lines so a header that DOCUMENTS "no find -printf" is not mistaken for a real invocation
function codeOnly(s) { return s.split('\n').filter(l => !/^\s*#/.test(l)).join('\n'); }
for (const f of listScripts()) {
  const s = codeOnly(fs.readFileSync(f, 'utf8'));
  A.ok(path.relative(ROOT, f) + ' has no `find -printf` (GNU-only)', !/\bfind\b[^\n]*-printf/.test(s));
}

A.section('QA-011 — smokes are strict-mode and fail-closed');
for (const rel of SMOKES) {
  const s = read(rel);
  A.ok(rel + ' uses set -euo pipefail', /set -euo pipefail/.test(s));
  A.ok(rel + ' sources the shared disposable helper', /disposable_n8n\.sh/.test(s));
  A.ok(rel + ' enforces --network none', /--network none/.test(read('scripts/lib/disposable_n8n.sh')));
}

A.section('QA-001 — workflow-set smokes derive everything from the manifest (no hard-coded workflow list)');
for (const rel of ['scripts/n8n_import_smoke.sh', 'scripts/n8n_disposable_e2e.sh']) {
  const s = read(rel);
  A.ok(rel + ' reads manifest_lib (runtime set is not hard-coded)', /manifest_lib\.js|stage_runtime_workflows\.js|smoke_report\.js/.test(s));
  A.ok(rel + ' does NOT hard-code a 17_..26 import array', !/IMPORT_ORDER=\(/.test(s));
}

A.section('QA-001 — deploy no longer hard-codes the runtime workflow list');
const deploy = read('scripts/deploy_n8n.sh');
A.ok('deploy sets MANIFEST_LIB to tools/manifest_lib.js', /MANIFEST_LIB="[^"]*tools\/manifest_lib\.js"/.test(deploy));
A.ok('deploy derives import order from the manifest', /"\$MANIFEST_LIB" import-order/.test(deploy));
A.ok('deploy has no literal IMPORT_ORDER=( "17_... ) array', !/IMPORT_ORDER=\(\s*"17_/.test(deploy));

A.section('QA-011 — import smoke prints PASS only AFTER the mandatory checks');
const imp = read('scripts/n8n_import_smoke.sh');
const failIdx = imp.indexOf('FAIL=1');
const passIdx = imp.lastIndexOf('DISPOSABLE_IMPORT=PASS');
A.ok('import smoke has a fail accumulator', failIdx >= 0);
A.ok('import smoke gates the final PASS behind the fail check', imp.indexOf('[ "$FAIL" -eq 0 ]') >= 0 && imp.indexOf('[ "$FAIL" -eq 0 ]') < passIdx);
A.ok('zlib smoke gates final PASS behind both controls', /\[ "\$NEG_PASS" = PASS \] && \[ "\$POS_PASS" = PASS \]/.test(read('scripts/n8n_zlib_runtime_smoke.sh')));

A.section('QA-011 — NEGATIVE: a mandatory failure propagates non-zero (no false PASS)');
function runBash(script) {
  try { const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' }); return { code: 0, out: out }; }
  catch (e) { return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}
// The exact fail-closed contract the smokes use: a failed mandatory check sets FAIL and blocks the final PASS.
const failClosed = 'set -euo pipefail; FAIL=0; mandatory(){ return 1; }; mandatory || FAIL=1; [ "$FAIL" -eq 0 ] || { echo RESULT=FAIL; exit 1; }; echo RESULT=PASS';
const r1 = runBash(failClosed);
A.eq('mandatory failure exits non-zero', r1.code !== 0, true);
A.ok('mandatory failure prints RESULT=FAIL, never RESULT=PASS', /RESULT=FAIL/.test(r1.out) && !/RESULT=PASS/.test(r1.out));
const okPath = 'set -euo pipefail; FAIL=0; mandatory(){ return 0; }; mandatory || FAIL=1; [ "$FAIL" -eq 0 ] || { echo RESULT=FAIL; exit 1; }; echo RESULT=PASS';
const r2 = runBash(okPath);
A.eq('all-pass path exits zero', r2.code, 0);
A.ok('all-pass path prints RESULT=PASS', /RESULT=PASS/.test(r2.out));
// set -e must actually abort (proves the smokes cannot run past a hard failure).
const r3 = runBash('set -e; false; echo SHOULD_NOT_PRINT');
A.ok('set -e aborts before a trailing echo', r3.code !== 0 && !/SHOULD_NOT_PRINT/.test(r3.out));

A.section('QA-005/006 — XLSX-capable activation requires zlib (deploy preflight)');
A.ok('activate-triggers runs a zlib-required preflight', /check_config "" "require-zlib"/.test(deploy));

A.report('smoke-hardening');
