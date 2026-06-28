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
        // CRED-003: capture the credential NAME too. Production legitimately holds MULTIPLE credentials of one type
        // (e.g. three httpHeaderAuth: Claude, Firecrawl, Apify), so (type,name) is what disambiguates which one a
        // node means — type alone cannot. The name is never printed (fingerprints only); it is used to reconcile.
        if (c.id != null && c.id !== '') refs.push({ file: f, node: n.name, type: type, id: String(c.id), name: String(c.name == null ? '' : c.name) });
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

// --- node-level credential REQUIREMENT model (CRED-001) -------------------------------------------------------
// collectReferences() only sees nodes that ALREADY carry a credentials block, so a googleSheets node with NO block
// is invisible to the reconciler — which is exactly why a workflow of such nodes (the secure WF18, 14 Sheets nodes)
// falsely audited PASS with zero references. A node requires a credential because of its OWN configuration, never
// to make a count green. requiredCredentialType() returns the required TYPE (string) or null.
function requiredCredentialType(node) {
  const t = (node && node.type) || '';
  const p = (node && node.parameters) || {};
  if (t === 'n8n-nodes-base.googleSheets') return 'googleApi';
  if (t === 'n8n-nodes-base.httpRequest') {
    if (p.authentication === 'genericCredentialType') return p.genericAuthType || null;
    if (p.authentication === 'predefinedCredentialType') return p.nodeCredentialType || null;
  }
  return null; // unset/'none' auth (e.g. Telegram sends inject $env directly) => no n8n credential required
}
// A Google Sheets node is satisfied by either the service-account (googleApi) or the OAuth2 credential.
const GOOGLE_TYPES = ['googleApi', 'googleSheetsOAuth2Api'];
function nodeHasCredential(node, type) {
  const c = (node && node.credentials) || {};
  const ok = (k) => c[k] && c[k].id != null && String(c[k].id) !== '';
  if (type === 'googleApi') return GOOGLE_TYPES.some(ok);
  return ok(type);
}
// Every credential-REQUIRING node + whether it carries a reference (the missing-reference detector).
function collectRequirements(files, wfDir) {
  const out = [];
  for (const f of (files || [])) {
    const wf = JSON.parse(fs.readFileSync((wfDir || L.WF_DIR) + '/' + f, 'utf8'));
    for (const n of (wf.nodes || [])) {
      const req = requiredCredentialType(n);
      if (!req) continue;
      out.push({ file: f, wf_name: wf.name, node: n.name, requiredType: req, hasRef: nodeHasCredential(n, req) });
    }
  }
  return out;
}

// Full honest credential audit: the requirement model (missing references) + reference reconciliation against a
// NON-decrypted credential export ([{id,name,type}]; may be []). Statuses, fingerprints and counts only — never a
// raw id/name/secret. A leaked placeholder (a credential of that TYPE exists, yet the reference is still a template)
// is a hard FAILURE; a placeholder for a type with NO production credential yet is DEFERRED (operator attaches once,
// not a failure for an INACTIVE deploy). A credential-requiring node with no reference at all is a hard FAILURE.
function audit(files, exportList, wfDir) {
  const reqs = collectRequirements(files, wfDir);
  const refs = collectReferences(files, wfDir);
  const typesInExport = {}; const byId = {}; const idCount = {}; const byTypeName = {};
  for (const c of (exportList || [])) {
    typesInExport[String(c.type)] = (typesInExport[String(c.type)] || 0) + 1;
    byId[String(c.id)] = c; idCount[String(c.id)] = (idCount[String(c.id)] || 0) + 1;
    byTypeName[String(c.type) + '||' + String(c.name == null ? '' : c.name)] = (byTypeName[String(c.type) + '||' + String(c.name == null ? '' : c.name)] || 0) + 1;
  }
  let resolved = 0, placeholderLeak = 0, deferred = 0, missingInExport = 0, ambiguous = 0, typeMismatch = 0;
  const detail = [];
  for (const r of refs) {
    let status;
    if (looksPlaceholder(r.id)) {
      // CRED-003: a placeholder is a hard LEAK only when production can UNAMBIGUOUSLY supply the credential — i.e.
      // exactly one credential of the same (type,name), or (no name match but) exactly one of the type. Otherwise
      // it is legitimately DEFERRED: no credential of that type yet, OR several of that type with no name match
      // (the operator must attach the right one in the UI — never auto-pick). This mirrors prepareStaged exactly.
      const sameTypeName = byTypeName[String(r.type) + '||' + String(r.name == null ? '' : r.name)] || 0;
      const sameType = typesInExport[r.type] || 0;
      if (sameTypeName === 1 || (sameTypeName === 0 && sameType === 1)) { status = 'placeholder'; placeholderLeak++; }
      else { status = 'deferred'; deferred++; }
    } else if (!byId[r.id]) { status = 'missing'; missingInExport++; }
    else if (idCount[r.id] > 1) { status = 'ambiguous'; ambiguous++; }
    else if (String(byId[r.id].type) !== String(r.type)) { status = 'type_mismatch'; typeMismatch++; }
    else { status = 'ok'; resolved++; }
    detail.push({ file: r.file, node: r.node, type: r.type, id_fingerprint: fp(r.id), status: status });
  }
  const missingRef = reqs.filter(r => !r.hasRef);
  const failures = missingRef.length + placeholderLeak + missingInExport + ambiguous + typeMismatch;
  const uniqueRefd = new Set(refs.filter(r => !looksPlaceholder(r.id)).map(r => String(r.id))).size;
  return {
    ok: failures === 0,
    summary: {
      references: refs.length,
      nodes_requiring_credentials: reqs.length,
      nodes_missing_reference: missingRef.length,
      resolved: resolved, placeholder_leaked: placeholderLeak, deferred: deferred,
      missing_in_export: missingInExport, ambiguous: ambiguous, type_mismatch: typeMismatch,
      unique_credentials_referenced: uniqueRefd,
      unique_credentials_in_export: Object.keys(byId).length,
      failures: failures
    },
    missing_reference: missingRef.map(m => ({ file: m.file, node: m.node, type: m.requiredType })),
    detail: detail
  };
}

module.exports = { collectReferences, reconcile, fp, requiredCredentialType, collectRequirements, nodeHasCredential, audit };

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const exp = val('--export');
  const exportList = exp ? JSON.parse(fs.readFileSync(exp, 'utf8')) : [];

  // --audit: full honest audit (requirement model + reconciliation) over a workflow DIR (a production/backup export
  // or, by default, the committed runtime closure). Emits <PREFIX>_CREDENTIAL_* markers; never prints ids/names.
  if (args.indexOf('--audit') >= 0) {
    const wfDir = val('--wf-dir', L.WF_DIR);
    const prefix = val('--prefix', 'SOURCE').toUpperCase();
    const focus = val('--focus'); // e.g. "18_" to also emit a WF18-only subset
    const files = (wfDir === L.WF_DIR) ? L.runtimeClosure()
      : fs.readdirSync(wfDir).filter(f => f.endsWith('.json'));
    const emit = (pfx, fileset) => {
      const r = audit(fileset, exportList, wfDir);
      const s = r.summary;
      console.log(pfx + '_CREDENTIAL_REFERENCES=' + s.references);
      console.log(pfx + '_NODES_REQUIRING_CREDENTIALS=' + s.nodes_requiring_credentials);
      console.log(pfx + '_NODES_MISSING_REFERENCE=' + s.nodes_missing_reference);
      console.log(pfx + '_CREDENTIAL_RESOLVED=' + s.resolved);
      console.log(pfx + '_CREDENTIAL_PLACEHOLDERS=' + s.placeholder_leaked);
      console.log(pfx + '_CREDENTIAL_DEFERRED=' + s.deferred);
      console.log(pfx + '_CREDENTIAL_AMBIGUOUS=' + s.ambiguous);
      console.log(pfx + '_CREDENTIAL_TYPE_MISMATCH=' + s.type_mismatch);
      // OBS-001: <PREFIX>_UNIQUE_CREDENTIALS is WORKFLOW-SCOPED — the count of distinct credentials actually
      // referenced by THIS workflow set (e.g. the secure WF18's 14 Sheets nodes all share one googleApi → 1).
      // It is DERIVED from the resolved references, never hard-coded and never the size of the global export.
      // The global figure is reported separately and truthfully as <PREFIX>_UNIQUE_CREDENTIALS_IN_EXPORT.
      console.log(pfx + '_UNIQUE_CREDENTIALS=' + s.unique_credentials_referenced);
      console.log(pfx + '_UNIQUE_CREDENTIALS_IN_EXPORT=' + s.unique_credentials_in_export);
      console.log(pfx + '_CREDENTIAL_FAILURES=' + s.failures);
      console.log(pfx + '_CREDENTIAL_AUDIT=' + (r.ok ? 'PASS' : 'FAIL'));
      for (const m of r.missing_reference) console.log('  [missing_reference] ' + m.file + ' :: ' + m.node + ' (' + m.type + ')');
      return r.ok;
    };
    let ok = emit(prefix, files);
    if (focus) {
      const fset = files.filter(f => f.indexOf(focus) >= 0);
      if (fset.length) { const wpfx = (focus.replace(/[^0-9A-Za-z]/g, '') || 'FOCUS').toUpperCase(); ok = emit('WF' + wpfx.replace(/^WF/i, ''), fset) && ok; }
    }
    process.exit(ok ? 0 : 1);
  }

  // legacy default: reference-only reconciliation over the committed runtime closure.
  if (!exp) { console.error('usage: node tools/reconcile_credentials.js --export <metadata.json> | --audit [--wf-dir <dir>] [--export <metadata.json>] [--prefix P] [--focus 18_]'); process.exit(2); }
  const files = L.runtimeClosure();
  const refs = collectReferences(files);
  const r = reconcile(refs, exportList);
  console.log(JSON.stringify(r.summary, null, 2));
  for (const a of r.audit) if (a.status !== 'ok') console.log('  [' + a.status + '] ' + a.wf_file + ' :: ' + a.node + ' (' + a.type + ', ' + a.id_fingerprint + ') ' + a.reason);
  console.log('CREDENTIAL_AUDIT=' + (r.ok ? 'PASS' : 'FAIL') + ' references=' + r.summary.references + ' unique=' + r.summary.unique_credentials + ' failures=' + r.summary.failures);
  process.exit(r.ok ? 0 : 1);
}
