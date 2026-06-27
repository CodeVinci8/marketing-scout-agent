// test_release_scripts.js — Stage 8 operator scripts behaviour (BACKUP-001/002, TELEGRAM-009, RELEASE-003/004,
// SECURITY-003/005). Exercises the OFFLINE-runnable paths: backup dry-run (entrypoint override + dest/space
// guards), restore offline archive integrity, webhook dry-run (token never printed), release lock, sanitized
// release evidence. No docker, no live Telegram, no secrets printed.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const RR = require('../tools/release_report.js');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-rel-'));
function sh(script, env) {
  const e = Object.assign({}, process.env, env || {});
  try { return { ok: true, out: execFileSync('bash', ['-c', script], { env: e, encoding: 'utf8' }) }; }
  catch (err) { return { ok: false, out: (err.stdout || '') + (err.stderr || ''), code: err.status }; }
}

A.section('BACKUP-001 — backup dry-run prints the entrypoint-overriding plan, writes nothing');
{
  const r = sh('MS_N8N_EXEC_DRY=1 scripts/backup.sh --dry-run --dest ' + TMP + '/bk', { });
  A.ok('dry-run reports PASS', /BACKUP_DRY_RUN=PASS/.test(r.out));
  A.ok('dest safety checked', /BACKUP_DEST_SAFE=PASS/.test(r.out));
  A.ok('plan mentions --entrypoint /bin/sh', /--entrypoint \/bin\/sh|entrypoint overridden/.test(r.out));
  A.ok('no archive created in dry-run', !fs.existsSync(path.join(TMP, 'bk', 'n8n-data.tar.gz')));
}

A.section('BACKUP — refuses unsafe destinations (never the volume / root)');
{
  const bad1 = sh('scripts/backup.sh --apply --dest /', {});
  A.ok('refuses root dest', !bad1.ok && /unsafe backup destination/.test(bad1.out));
  const bad2 = sh('scripts/backup.sh --apply --dest /home/node/.n8n', {});
  A.ok('refuses data path dest', !bad2.ok && /unsafe backup destination/.test(bad2.out));
  const bad3 = sh('scripts/backup.sh --apply --dest relative/path', {});
  A.ok('refuses relative dest', !bad3.ok && /absolute path/.test(bad3.out));
}

A.section('BACKUP-002 — restore validator verifies a real archive offline (sha256 + content)');
{
  // craft a tiny fake n8n data dir + archive + sidecar, exactly like backup.sh would produce
  const dataDir = path.join(TMP, 'fakedata'); fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'database.sqlite'), 'SQLite format 3\0fake');
  fs.mkdirSync(path.join(dataDir, 'config'), { recursive: true });
  const bdir = path.join(TMP, 'backup1'); fs.mkdirSync(bdir, { recursive: true });
  execFileSync('tar', ['-czf', path.join(bdir, 'n8n-data.tar.gz'), '-C', dataDir, '.']);
  execFileSync('bash', ['-c', 'cd "' + bdir + '" && sha256sum n8n-data.tar.gz > n8n-data.tar.gz.sha256']);
  const r = sh('scripts/restore_validate.sh --dir ' + bdir, { MS_RESTORE_OFFLINE_ONLY: '1' });
  A.ok('archive sha256 verified', /RESTORE_ARCHIVE_SHA256=PASS/.test(r.out));
  A.ok('archive content present', /RESTORE_ARCHIVE_CONTENT=PASS/.test(r.out));
  A.ok('production untouched', /PRODUCTION_UNTOUCHED=true/.test(r.out));
  // corrupt the archive -> checksum must FAIL
  fs.appendFileSync(path.join(bdir, 'n8n-data.tar.gz'), 'corruption');
  const bad = sh('scripts/restore_validate.sh --dir ' + bdir, { MS_RESTORE_OFFLINE_ONLY: '1' });
  A.ok('corrupted archive fails checksum', !bad.ok && /RESTORE_ARCHIVE_SHA256=FAIL/.test(bad.out));
}

A.section('TELEGRAM-009 — webhook script: mutations dry-run by default, token NEVER printed');
{
  const secretTok = '123456789:AABBCC_TOKEN_VALUE_kkkkkkkkkkkkkkkk';
  const env = { MS_TELEGRAM_BOT_TOKEN: secretTok, MS_TELEGRAM_WEBHOOK_SECRET: 'webhook_secret_value_32_chars_aa', PUBLIC_WEBHOOK_BASE_URL: 'https://bot.example.com' };
  const set = sh('scripts/telegram_webhook.sh set', env);
  A.ok('set is dry-run by default', /TELEGRAM_WEBHOOK_SET=DRYRUN/.test(set.out));
  A.ok('url validated', /WEBHOOK_URL_VALID=PASS/.test(set.out));
  A.ok('bot token never printed', set.out.indexOf(secretTok) < 0 && set.out.indexOf('AABBCC_TOKEN_VALUE') < 0);
  const del = sh('scripts/telegram_webhook.sh delete', env);
  A.ok('delete is dry-run by default', /TELEGRAM_WEBHOOK_DELETE=DRYRUN/.test(del.out));
  // refuses to register without https
  const bad = sh('scripts/telegram_webhook.sh set --apply', Object.assign({}, env, { PUBLIC_WEBHOOK_BASE_URL: 'http://x' }));
  A.ok('refuses non-https on apply', !bad.ok && /must be set and HTTPS/.test(bad.out));
  // refuses without secret
  const noSecret = sh('scripts/telegram_webhook.sh set --apply', Object.assign({}, env, { MS_TELEGRAM_WEBHOOK_SECRET: '' }));
  A.ok('refuses unsecured webhook', !noSecret.ok && /WEBHOOK_SECRET is not set/.test(noSecret.out));
}

A.section('RELEASE-004 — release lock: acquire / contention / stale steal / release');
{
  const lock = path.join(TMP, 'rl.lock');
  const env = { MS_RELEASE_LOCK: lock };
  const a1 = sh('scripts/release_lock.sh acquire --owner alice', env);
  A.ok('first acquire succeeds', a1.ok && /RELEASE_LOCK=ACQUIRED/.test(a1.out));
  const a2 = sh('scripts/release_lock.sh acquire --owner bob', env);
  A.ok('second acquire is contended (non-zero)', !a2.ok && /RELEASE_LOCK=CONTENDED/.test(a2.out));
  const st = sh('scripts/release_lock.sh status', env);
  A.ok('status shows held', /RELEASE_LOCK=HELD/.test(st.out));
  // make it stale: write a GUARANTEED-dead pid (above Linux pid_max, never recyclable) + backdate the lock so
  // its age exceeds the TTL. (Using a real-but-dead pid is flaky under heavy churn: the OS can recycle it to a
  // live process, and the lock then conservatively REFUSES to steal — safe, but not what this case asserts.)
  fs.writeFileSync(path.join(lock, 'pid'), '2147483647');
  execFileSync('touch', ['-d', '2020-01-01T00:00:00', lock]);
  const steal = sh('scripts/release_lock.sh acquire --owner bob', Object.assign({}, env, { MS_RELEASE_LOCK_TTL_SEC: '60' }));
  A.ok('stale lock is stolen', steal.ok && /stole stale lock/.test(steal.out));
  // NEGATIVE: a dead-owner lock that is YOUNGER than the TTL is NOT stolen (grace window)
  const young = sh('scripts/release_lock.sh acquire --owner carol', Object.assign({}, env, { MS_RELEASE_LOCK_TTL_SEC: '3600' }));
  A.ok('young dead-owner lock is not stolen (contended)', !young.ok && /RELEASE_LOCK=CONTENDED/.test(young.out));
  const rel = sh('scripts/release_lock.sh release --owner bob', env);
  A.ok('release frees the lock', rel.ok && /RELEASE_LOCK=RELEASED/.test(rel.out));
  const st2 = sh('scripts/release_lock.sh status', env);
  A.ok('status free after release', /RELEASE_LOCK=FREE/.test(st2.out));
}

A.section('RELEASE-003 / SECURITY-005 — release evidence is sanitized (no raw ids/secrets)');
{
  const attempt = {
    runtime_workflows_found: 15, bindings_resolved: RR.MANIFEST_BINDINGS, placeholders_remaining: 0,
    credential_audit: 'PASS', active_workflows: 0, result: 'PASS',
    runtime_id_coverage: '15/15', runtime_id_map_checksum: 'abc123',
    backup_sha256: 'deadbeef',
    detail: {
      bot_token: '123456789:SUPER_SECRET_TOKEN_kkkkkkkkkkkkkkkk',
      spreadsheet_id: '1RealSheetIdShouldNeverLeak',
      telegram_user_ids: ['111', '222'],
      workflow_id: 'Iz1RealWorkflowId',
      note: 'safe text'
    }
  };
  const rec = RR.buildRecord(attempt);
  const blob = JSON.stringify(rec);
  A.ok('result preserved', rec.result === 'PASS');
  A.ok('rollback command present', /deactivate-triggers/.test(rec.rollback_command));
  A.ok('raw bot token absent', blob.indexOf('SUPER_SECRET_TOKEN') < 0);
  A.ok('raw spreadsheet id absent', blob.indexOf('1RealSheetIdShouldNeverLeak') < 0);
  A.ok('raw workflow id absent', blob.indexOf('Iz1RealWorkflowId') < 0);
  A.ok('secret-keyed fields became fingerprints/counts', /_fp"|_count"/.test(blob));
  A.ok('non-secret note preserved', blob.indexOf('safe text') >= 0);
  A.ok('manifest hash + git commit present', !!rec.manifest_hash && !!rec.git_commit);
}

A.section('RELEASE-003 / Phase 5 — release result is DERIVED, fail-closed (never PASS on unknown/deferred creds)');
{
  const B = RR.MANIFEST_BINDINGS; // 13 — from the manifest, not a stale hardcode
  const ok = { runtime_workflows_found: 15, bindings_resolved: B, placeholders_remaining: 0, active_workflows: 0 };
  // The exact lie this fixes: caller claims PASS but the credential audit is unknown -> BLOCKED, never PASS.
  A.eq('claimed PASS + credential_audit unknown -> BLOCKED',
    RR.buildRecord(Object.assign({}, ok, { credential_audit: 'unknown', result: 'PASS' })).result, 'BLOCKED');
  A.eq('all verified + credential PASS -> PASS',
    RR.buildRecord(Object.assign({}, ok, { credential_audit: 'PASS', result: 'PASS' })).result, 'PASS');
  A.eq('all verified + credentials deferred -> PASS_WITH_DEFERRED_CREDENTIALS',
    RR.buildRecord(Object.assign({}, ok, { credential_audit: 'DEFERRED', result: 'PASS' })).result, 'PASS_WITH_DEFERRED_CREDENTIALS');
  A.eq('credential audit FAIL -> FAIL even if caller claims PASS',
    RR.buildRecord(Object.assign({}, ok, { credential_audit: 'FAIL', result: 'PASS' })).result, 'FAIL');
  A.eq('binding count mismatch -> FAIL',
    RR.buildRecord(Object.assign({}, ok, { bindings_resolved: B - 1, credential_audit: 'PASS', result: 'PASS' })).result, 'FAIL');
  A.eq('a leftover placeholder -> FAIL',
    RR.buildRecord(Object.assign({}, ok, { placeholders_remaining: 1, credential_audit: 'PASS', result: 'PASS' })).result, 'FAIL');
  A.eq('active workflow on an inactive deploy -> FAIL',
    RR.buildRecord(Object.assign({}, ok, { active_workflows: 1, credential_audit: 'PASS', result: 'PASS' })).result, 'FAIL');
  A.eq('missing workflow -> FAIL',
    RR.buildRecord(Object.assign({}, ok, { runtime_workflows_found: 14, credential_audit: 'PASS', result: 'PASS' })).result, 'FAIL');
  A.eq('ABORTED claim is preserved verbatim',
    RR.buildRecord(Object.assign({}, ok, { credential_audit: 'PASS', result: 'ABORTED' })).result, 'ABORTED');
  A.eq('the caller claim is recorded transparently (result_claimed)',
    RR.buildRecord(Object.assign({}, ok, { credential_audit: 'unknown', result: 'PASS' })).result_claimed, 'PASS');
  A.eq('binding_edges_expected derives from the manifest (13, not stale 8)',
    RR.buildRecord({}).binding_edges_expected, B);
}

A.section('release_report CLI writes a mode-600 evidence file');
{
  const out = path.join(TMP, 'evidence', 'r.json');
  const r = sh('echo \'{"result":"PASS"}\' | node tools/release_report.js --out ' + out, {});
  A.ok('CLI reports evidence path', /RELEASE_EVIDENCE=/.test(r.out));
  A.ok('evidence file exists', fs.existsSync(out));
  const mode = fs.statSync(out).mode;
  A.ok('evidence file has no group/other access (owner-only)', (mode & 0o077) === 0 && (mode & 0o600) === 0o600);
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { void e; }
A.report('release-scripts');
