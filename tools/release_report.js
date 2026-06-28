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

// Expected runtime/binding counts come from the single source of truth (the manifest), never a stale hardcode.
// The previous default of binding_edges_expected=8 was stale (the WF18 rearchitecture made it 13), so evidence
// understated the bindings it claimed to verify (OPERATOR-REPORT-001).
let MANIFEST_RUNTIME = 15, MANIFEST_BINDINGS = 13;
try { const L = require('./manifest_lib.js'); MANIFEST_RUNTIME = L.runtimeClosure().length; MANIFEST_BINDINGS = L.bindingEdges().length; } catch (e) { void e; }

// Derive the AUTHORITATIVE release result from the VERIFIED fields — never trust a caller's optimistic claim.
// result=PASS only when workflow verification, binding verification, active-state verification AND the credential
// audit ALL verifiably pass. Otherwise a precise honest state. Fail-closed: ANY unknown field => BLOCKED, never
// PASS. This is the fix for the release that wrote result=PASS with credential_audit=unknown after 36 deferred
// credentials (RELEASE-003 / Phase 5).
function deriveResult(r, claimed) {
  const c = String(claimed == null ? '' : claimed).toUpperCase();
  if (c === 'ABORTED' || c === 'ROLLED_BACK' || c === 'FAIL' || c === 'BLOCKED') return c; // terminal states preserved
  const num = (v) => (v == null || v === '' || v === 'null' ? null : Number(v));
  const wfFound = num(r.runtime_workflows_found), wfExp = num(r.runtime_workflows_expected);
  const bindRes = num(r.bindings_resolved), bindExp = num(r.binding_edges_expected), ph = num(r.placeholders_remaining);
  const active = num(r.active_workflows);
  const expActive = num(r.expected_active_workflows) == null ? 0 : num(r.expected_active_workflows);
  const cred = String(r.credential_audit == null ? 'unknown' : r.credential_audit).toUpperCase();

  const wfKnown = wfFound != null && wfExp != null;
  const bindKnown = bindRes != null && bindExp != null && ph != null;
  const activeKnown = active != null;
  const credKnown = cred !== 'UNKNOWN' && cred !== 'NULL' && cred !== '';
  if (!wfKnown || !bindKnown || !activeKnown || !credKnown) return 'BLOCKED';

  if (wfFound !== wfExp || bindRes !== bindExp || ph !== 0 || active !== expActive) return 'FAIL';
  if (cred === 'PASS') return 'PASS';
  if (cred === 'PASS_WITH_DEFERRED_CREDENTIALS' || cred === 'PASS_WITH_DEFERRED' || cred === 'DEFERRED') return 'PASS_WITH_DEFERRED_CREDENTIALS';
  return 'FAIL';
}

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
    runtime_workflows_expected: attempt.runtime_workflows_expected != null ? attempt.runtime_workflows_expected : MANIFEST_RUNTIME,
    runtime_workflows_found: attempt.runtime_workflows_found != null ? attempt.runtime_workflows_found : null,
    binding_edges_expected: attempt.binding_edges_expected != null ? attempt.binding_edges_expected : MANIFEST_BINDINGS,
    bindings_resolved: attempt.bindings_resolved != null ? attempt.bindings_resolved : null,
    placeholders_remaining: attempt.placeholders_remaining != null ? attempt.placeholders_remaining : null,
    credential_audit: attempt.credential_audit || 'unknown',
    credential_references: attempt.credential_references != null ? attempt.credential_references : null,
    credential_failures: attempt.credential_failures != null ? attempt.credential_failures : null,
    credential_deferred: attempt.credential_deferred != null ? attempt.credential_deferred : null,
    active_workflows: attempt.active_workflows != null ? attempt.active_workflows : null,
    expected_active_workflows: attempt.expected_active_workflows != null ? attempt.expected_active_workflows : 0,
    runtime_id_coverage: attempt.runtime_id_coverage || null,
    runtime_id_map_checksum: attempt.runtime_id_map_checksum || null,
    backup_path: attempt.backup_path || null,
    backup_sha256: attempt.backup_sha256 || null,
    result_claimed: attempt.result || 'unknown',
    rollback_command: attempt.rollback_command || 'scripts/deploy_n8n.sh --deactivate-triggers && scripts/telegram_webhook.sh delete --apply'
  };
  // The result is DERIVED from the verified fields — a caller can never make evidence claim PASS it did not earn.
  base.result = deriveResult(base, attempt.result);
  // Merge any extra sanitized detail the caller supplied.
  if (attempt.detail) base.detail = sanitize(attempt.detail);
  // Final defensive pass: sanitize the whole record so a stray secret-keyed field can never leak.
  return sanitize(base);
}

module.exports = { buildRecord, sanitize, fingerprint, deriveResult, SECRET_KEYS, MANIFEST_RUNTIME, MANIFEST_BINDINGS };

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
