// reconcile_credentials.js — automated, non-decrypted credential reconciliation (DEPLOY-008, SECURITY-005).
//
// Compares the credential references inside the runtime workflows (node.credentials -> {type: {id, name}}) to a
// credential metadata export (the NON-decrypted `n8n export:credentials --all` shape: [{id, name, type}, ...]).
// It verifies every referenced credential id exists AND its type matches, aborting on a missing reference, a
// type mismatch, or an ambiguous selection. It NEVER decrypts, and NEVER prints a credential id, name, or secret
// — only type names, fingerprints (fp_<sha10>) and counts. Pure + offline; the export is provided by the caller.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const L = require('./manifest_lib.js');

function fp(s) { return s == null || s === '' ? 'fp_none' : 'fp_' + crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 10); }
// A credential id that still looks like an unfilled template (the committed source ships PASTE_CREDENTIAL_ID_HERE;
// real ids are attached in the n8n UI). Reconciliation must refuse to deploy with an unattached placeholder.
const PLACEHOLDER_RE = /paste|changeme|change_me|your[-_]|placeholder|todo|<[^>]+>|replace[-_]?me/i;
function looksPlaceholder(s) { return PLACEHOLDER_RE.test(String(s || '')); }

// Collect {type, id} references from a set of workflow JSONs (read from disk by file list).
function collectReferences(files, wfDir) {
  const refs = [];
  for (const f of files) {
    const wf = JSON.parse(fs.readFileSync((wfDir || L.WF_DIR) + '/' + f, 'utf8'));
    for (const n of (wf.nodes || [])) {
      const creds = n.credentials || {};
      for (const type of Object.keys(creds)) {
        const c = creds[type] || {};
        if (c.id != null && c.id !== '') refs.push({ file: f, node: n.name, type: type, id: String(c.id) });
      }
    }
  }
  return refs;
}

// reconcile(refs, exportList) -> { ok, audit, summary } . exportList: [{id,name,type}].
function reconcile(refs, exportList) {
  const byId = {}; const idCount = {};
  for (const c of (exportList || [])) { byId[String(c.id)] = c; idCount[String(c.id)] = (idCount[String(c.id)] || 0) + 1; }

  const audit = [];
  let failures = 0;
  // fingerprint-grouped usage (so logs show "fp_x used by N nodes" without revealing the id)
  const usage = {};
  for (const r of refs) {
    const cred = byId[r.id];
    let status, reason = '';
    if (looksPlaceholder(r.id)) { status = 'placeholder'; reason = 'credential not attached (unfilled placeholder id)'; failures++; }
    else if (!cred) { status = 'missing'; reason = 'credential id not present in export'; failures++; }
    else if (idCount[r.id] > 1) { status = 'ambiguous'; reason = 'credential id resolves to multiple entries'; failures++; }
    else if (String(cred.type) !== String(r.type)) { status = 'type_mismatch'; reason = 'node expects ' + r.type + ' but credential is ' + cred.type; failures++; }
    else status = 'ok';
    const f = fp(r.id);
    usage[f] = (usage[f] || 0) + 1;
    audit.push({ wf_file: r.file, node: r.node, type: r.type, id_fingerprint: f, status: status, reason: reason });
  }

  const uniqueCreds = Object.keys(usage).length;
  return {
    ok: failures === 0,
    summary: {
      references: refs.length, unique_credentials: uniqueCreds, failures: failures,
      usage_by_fingerprint: Object.keys(usage).map(f => ({ id_fingerprint: f, node_count: usage[f] }))
    },
    audit: audit
  };
}

module.exports = { collectReferences, reconcile, fp };

if (require.main === module) {
  const args = process.argv.slice(2);
  const expIdx = args.indexOf('--export');
  if (expIdx < 0) { console.error('usage: node tools/reconcile_credentials.js --export <credentials_metadata.json>  (NON-decrypted)'); process.exit(2); }
  const exportList = JSON.parse(fs.readFileSync(args[expIdx + 1], 'utf8'));
  const files = L.runtimeClosure();
  const refs = collectReferences(files);
  const r = reconcile(refs, exportList);
  // print ONLY safe summary (no ids/names)
  console.log(JSON.stringify(r.summary, null, 2));
  for (const a of r.audit) if (a.status !== 'ok') console.log('  [' + a.status + '] ' + a.wf_file + ' :: ' + a.node + ' (' + a.type + ', ' + a.id_fingerprint + ') ' + a.reason);
  console.log('CREDENTIAL_AUDIT=' + (r.ok ? 'PASS' : 'FAIL') + ' references=' + r.summary.references + ' unique=' + r.summary.unique_credentials + ' failures=' + r.summary.failures);
  process.exit(r.ok ? 0 : 1);
}
