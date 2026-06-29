// test_docker_copy_perms.js — DOCKER-COPY-PERM-001 static guard ($0, no docker, runs in `make test`).
//
// Root cause: `docker cp` preserves the HOST file owner (root) and the HOST umask mode. Under a restrictive caller
// `umask 077` the staged/fixture JSON is mode 0600 root-owned, so after copy-IN the container's n8n CLI (which runs
// as the runtime user `node`, uid 1000) cannot read it -> `EACCES: permission denied, open '/tmp/f1.json'`, and every
// import fails. The fix is a copy-IN helper that, as ROOT inside the container, sets node ownership + LEAST-PRIVILEGE
// modes (dirs 0700, files 0600 — NOT world-readable) and verifies the runtime user can read every file (fail closed).
//
// This suite proves the SHAPE of that fix without docker: the helpers exist, set least-privilege node-owned modes,
// verify readability as the runtime user, fail closed, never globally weaken permissions, and that every copy-IN
// call site the n8n CLI must read goes through the helper. The ACTUAL umask-077 import is proven by the shell
// entrypoint scripts/n8n_umask_permission_smoke.sh (UMASK_0077_* markers).
'use strict';
const A = require('./_assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exec = read('scripts/lib/n8n_exec.sh');
const deploy = read('scripts/deploy_n8n.sh');
const rta = read('scripts/n8n_runtime_acceptance.sh');
const e2e = read('scripts/n8n_disposable_e2e.sh');
const smoke = read('scripts/n8n_umask_permission_smoke.sh');

A.section('n8n_exec.sh — the runtime-readable copy-IN helpers exist');
{
  A.ok('n8n_runtime_user() exists (overridable runtime user)', /n8n_runtime_user\(\)/.test(exec));
  A.ok('runtime user defaults to node, overridable via MS_N8N_RUNTIME_USER', /MS_N8N_RUNTIME_USER:-node/.test(exec));
  A.ok('n8n_make_runtime_readable() exists', /n8n_make_runtime_readable\(\)/.test(exec));
  A.ok('n8n_put_for_runtime() exists', /n8n_put_for_runtime\(\)/.test(exec));
}

A.section('helper sets LEAST-PRIVILEGE node-owned modes (never world-readable)');
{
  A.ok('chowns the tree to the runtime user', /chown -R "\$u":"\$u"/.test(exec));
  A.ok('directories -> 0700', /find "\$p" -type d -exec chmod 0700/.test(exec));
  A.ok('files -> 0600', /find "\$p" -type f -exec chmod 0600/.test(exec));
  // the explicit security correction: do NOT globally weaken permissions on copy-IN
  A.ok('NEVER chmod -R a+r', !/chmod -R a\+r/.test(exec));
  A.ok('NEVER chmod 0644 / a+r / o+r / 0777 on the staged tree', !/chmod\s+(0?644|a\+r|o\+r|0?777)\b/.test(exec));
  A.ok('uses root only to fix ownership/modes (docker exec -u 0)', /docker exec -u 0 "\$c"/.test(exec));
}

A.section('helper verifies readability AS the runtime user and FAILS CLOSED (does not assume the user exists)');
{
  A.ok('verifies the runtime user exists before chown (id $u)', /docker exec -u 0 "\$c" id "\$u"/.test(exec));
  A.ok('reads back AS the runtime user (docker exec -u $u)', /docker exec -u "\$u" "\$c"/.test(exec));
  A.ok('flags an unreadable file (RUNTIME_USER_CANNOT_READ)', /RUNTIME_USER_CANNOT_READ/.test(exec));
  A.ok('fail-closed removes the path on any failure', /FAIL-CLOSED[\s\S]*rm -rf "\$p"/.test(exec));
  A.ok('returns nonzero on failure (return 1)', /return 1/.test(exec));
  A.ok('host source is never modified into world-readable (host branch keeps a private cp -a)', /cp -a \\"\$src\/\.\\"/.test(exec));
}

A.section('every copy-IN the n8n CLI must read goes through the runtime-readable path');
{
  // production staged import
  A.ok('deploy stages via n8n_put_for_runtime (not raw n8n_put)', /n8n_put_for_runtime "\$\{tmp\}\/staged"/.test(deploy));
  A.ok('deploy no longer uses raw n8n_put for the staged import', !/n8n_put "\$\{tmp\}\/staged"/.test(deploy));
  A.ok('deploy cleans the in-container staging temp after import', /rm -rf \\"\$import_src\\"/.test(deploy));
  // runtime acceptance fixtures
  A.ok('runtime-acceptance sources n8n_exec.sh', /lib\/n8n_exec\.sh/.test(rta));
  A.ok('runtime-acceptance fixes fixture perms after docker cp', /n8n_make_runtime_readable "\$DISP_C" \/tmp\/fx/.test(rta));
  A.ok('runtime-acceptance fails closed if fixtures are unreadable', /RUNTIME_ACCEPTANCE=FAIL \(fixtures not readable/.test(rta));
  // disposable e2e fixtures
  A.ok('disposable-e2e sources n8n_exec.sh', /lib\/n8n_exec\.sh/.test(e2e));
  A.ok('disposable-e2e fixes child/parent perms after docker cp', /n8n_make_runtime_readable "\$DISP_C" \/tmp\/child\.json/.test(e2e) && /n8n_make_runtime_readable "\$DISP_C" \/tmp\/parent\.json/.test(e2e));
  A.ok('disposable-e2e fixes zlib fixture perms after docker cp', /n8n_make_runtime_readable "\$DISP_C" \/tmp\/zlib\.json/.test(e2e));
}

A.section('copy-OUT behavior is unchanged (only copy-IN needed the fix)');
{
  A.ok('n8n_get still exists (copy-out untouched)', /n8n_get\(\)/.test(exec));
  // n8n_get must NOT have gained a runtime-readable fixup (it copies OUT to the host)
  const getBody = exec.slice(exec.indexOf('n8n_get()'));
  A.ok('n8n_get does not call the runtime-readable fixup', !/n8n_get\(\)[\s\S]{0,400}n8n_make_runtime_readable/.test(getBody));
}

A.section('umask-077 shell entrypoint exists and is honest');
{
  A.ok('smoke sets a restrictive umask 077 (entrypoint coverage, not a grep-only assertion)', /^umask 077/m.test(smoke));
  A.ok('smoke SKIPs without docker/image (never a fake PASS)', /disp_docker_ready/.test(smoke) && /DOCKER_COPY_PERMISSIONS=SKIPPED/.test(smoke));
  for (const m of ['UMASK_0077_DISPOSABLE_IMPORT', 'UMASK_0077_RUNTIME_ACCEPTANCE', 'UMASK_0077_PRODUCTION_STAGING_COPY',
    'CONTAINER_NODE_CAN_READ_STAGED_JSON', 'HOST_STAGED_FILES_REMAIN_PRIVATE', 'CONTAINER_STAGED_FILES_NOT_WORLD_READABLE',
    'CONTAINER_TEMP_CLEANUP', 'OWNERSHIP_FAILURE_RETURNS_NONZERO']) {
    A.ok('smoke emits ' + m, new RegExp(m).test(smoke));
  }
  A.ok('smoke uses the disposable name guard (never production)', /disp_guard_name/.test(smoke));
  A.ok('smoke uses --network none (no external calls)', /--network none/.test(smoke));
  A.ok('smoke proves a 0600 host file imports (calls the REAL helper)', /n8n_put_for_runtime/.test(smoke));
  A.ok('smoke proves fail-closed via a non-existent runtime user', /MS_N8N_RUNTIME_USER=/.test(smoke));
}

A.report('docker-copy-perms');
