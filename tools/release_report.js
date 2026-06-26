// release_report.js — sanitized release evidence writer (RELEASE-003, SECURITY-005).
//
// Emits ONE machine-readable release record per deploy attempt with everything an audit needs and NOTHING that
// leaks a secret: no bot token, no spreadsheet id, no Telegram user id, no raw n8n workflow/credential id. Real
// ids appear only as fingerprints (fp_<sha10>) or as coverage counts + a checksum. The record always carries the
// exact rollback command so a failed/aborted release is recoverable.
//
// Inputs are passed as a JSON blob (argv --in <file> or stdin) describing the attempt; this tool normalizes and
// sanitizes it. It NEVER reads credentials or the operator-local id map's raw ids.
//
// Usage:
//   node tools/release_report.js --in attempt.json [--out release-evidence/<ts>.json]
//   echo '{...}' | node tools/release_report.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function sha10(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 10); }
function fingerprint(id) { return id == null || id === '' ? 'fp_none' : 'fp_' + sha10(id); }

function gitCommit() {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { void e; return 'unknown'; }
}
function manifestHash() {
  try {
    const t = fs.readFileSync(path.join(ROOT, 'config', 'workflow_manifest.json'), 'utf8');
    return sha10(t);
  } catch (e) { void e; return 'unknown'; }
}

// Keys whose VALUES must never be copied into the record verbatim (only counts/fingerprints).
const SECRET_KEYS = /token|secret|spreadsheet|user_id|user_ids|credential_id|workflow_id|raw_id|password|key/i;

// Deep-strip any secret-ish leaf value, replacing with a fingerprint/count marker.
function sanitize(node, keyHint) {
  if (Array.isArray(node)) return node.map(v => sanitize(v, keyHint));
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) {
      if (SECRET_KEYS.test(k)) {
        const v = node[k];
        if (Array.isArray(v)) out[k + '_count'] = v.length;
        else if (v == null || v === '') out[k + '_fp'] = 'fp_none';
        else out[k + '_fp'] = fingerprint(v);
      } else out[k] = sanitize(node[k], k);
    }
    return out;
  }
  return node;
}

function buildRecord(attempt) {
  attempt = attempt || {};
  const base = {
    schema: 'marketing-scout/release-evidence/v1',
    timestamp: new Date().toISOString(),
    git_commit: gitCommit(),
    n8n_image: attempt.n8n_image || process.env.MS_N8N_IMAGE || 'n8nio/n8n:2.23.3',
    n8n_version_expected: attempt.n8n_version_expected || '2.23.3',
    manifest_hash: manifestHash(),
    runtime_workflows_expected: attempt.runtime_workflows_expected != null ? attempt.runtime_workflows_expected : 15,
    runtime_workflows_found: attempt.runtime_workflows_found != null ? attempt.runtime_workflows_found : null,
    binding_edges_expected: attempt.binding_edges_expected != null ? attempt.binding_edges_expected : 8,
    bindings_resolved: attempt.bindings_resolved != null ? attempt.bindings_resolved : null,
    placeholders_remaining: attempt.placeholders_remaining != null ? attempt.placeholders_remaining : null,
    credential_audit: attempt.credential_audit || 'unknown',
    active_workflows: attempt.active_workflows != null ? attempt.active_workflows : null,
    runtime_id_coverage: attempt.runtime_id_coverage || null,
    runtime_id_map_checksum: attempt.runtime_id_map_checksum || null,
    backup_path: attempt.backup_path || null,
    backup_sha256: attempt.backup_sha256 || null,
    result: attempt.result || 'unknown',
    rollback_command: attempt.rollback_command || 'scripts/deploy_n8n.sh --deactivate-triggers && scripts/telegram_webhook.sh delete --apply'
  };
  // Merge any extra sanitized detail the caller supplied.
  if (attempt.detail) base.detail = sanitize(attempt.detail);
  // Final defensive pass: sanitize the whole record so a stray secret-keyed field can never leak.
  return sanitize(base);
}

module.exports = { buildRecord, sanitize, fingerprint, SECRET_KEYS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf('--in');
  const outIdx = args.indexOf('--out');
  let raw = '{}';
  if (inIdx >= 0 && args[inIdx + 1]) raw = fs.readFileSync(args[inIdx + 1], 'utf8');
  else if (!process.stdin.isTTY) { try { raw = fs.readFileSync(0, 'utf8') || '{}'; } catch (e) { void e; raw = '{}'; } }
  let attempt = {};
  try { attempt = JSON.parse(raw || '{}'); } catch (e) { console.error('invalid attempt JSON: ' + e.message); process.exit(2); }
  const rec = buildRecord(attempt);
  const text = JSON.stringify(rec, null, 2) + '\n';
  if (outIdx >= 0 && args[outIdx + 1]) {
    const out = args[outIdx + 1];
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text, { mode: 0o600 });
    console.log('RELEASE_EVIDENCE=' + out + ' result=' + rec.result);
  } else {
    process.stdout.write(text);
  }
}
