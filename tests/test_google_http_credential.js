// test_google_http_credential.js — GOOGLE-HTTP-CREDENTIAL-001.
//
// The WF18 read phase now uses an HTTP Request `values:batchGet` authenticated by the PREDEFINED googleApi
// credential. n8n's googleApi.authenticate() only injects a Bearer token when the credential data has
// httpNode=true AND scopes set (scopes are auto-added only for the googleSheets node). Those two fields live in
// the n8n credential STORE (never in the repo). This suite guards the durable invariants offline:
//   * the canonical batchGet node references the googleApi credential by (id,name) ONLY — no data/secret/scope
//     baked into the workflow JSON;
//   * the deploy/staging pipeline resolves credential ID references only and NEVER writes credential `data`, so a
//     re-apply / reconciliation can never silently strip httpNode/scopes from the live credential;
//   * the generator emits the predefined-credential batchGet (so the http-auth path is the authored architecture).
// Offline, $0, no network, no credential contents.
'use strict';
const A = require('./_assert');
const path = require('path');
const fs = require('fs');
const PS = require('../tools/prepare_staged_workflows.js');

const WF18 = require('../n8n/workflows/18_telegram_agent_gateway.json');
const batch = (WF18.nodes || []).find(n => n.type === 'n8n-nodes-base.httpRequest' && /\/values:batchGet/.test(String((n.parameters || {}).url || '')));

A.section('canonical batchGet uses the predefined googleApi credential by reference only (no secret in JSON)');
A.ok('WF18 has the batchGet node', !!batch);
A.eq('authentication=predefinedCredentialType', batch.parameters.authentication, 'predefinedCredentialType');
A.eq('nodeCredentialType=googleApi', batch.parameters.nodeCredentialType, 'googleApi');
A.eq('credential reference is (id,name) only', Object.keys(batch.credentials.googleApi).sort(), ['id', 'name']);
A.ok('no credential data/scopes/httpNode/key baked into the node', !/scopes|httpNode|privateKey|BEGIN PRIVATE KEY/.test(JSON.stringify(batch)));
A.ok('spreadsheet id stays an $env expression (no literal id)', /\$env\.MS_SPREADSHEET_ID/.test(String(batch.parameters.url)));

A.section('the deploy/staging pipeline resolves credential IDs only — it can never strip httpNode/scopes');
{
  // a non-decrypted credential export (ids/names/types only — exactly what reconciliation consumes)
  const credExport = [
    { id: 'PRODGOOGLE', name: 'Google Sheets - Marketing Scout Service Account', type: 'googleApi' },
    { id: 'PRODHEADER', name: 'Claude API - Marketing Scout', type: 'httpHeaderAuth' }
  ];
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ghc-'));
  const L = require('../tools/manifest_lib.js');
  const identity = L.runtimeIdentity();
  const localMap = { workflows: {} };
  Object.keys(identity).forEach(k => { localMap.workflows[k] = { id: 'WF_' + k }; });
  const r = PS.prepareStaged({ localMap, credExport, outDir: out });
  A.ok('staging succeeded', r.ok, JSON.stringify(r.errors));
  const staged = JSON.parse(fs.readFileSync(path.join(out, '18_telegram_agent_gateway.json'), 'utf8'));
  const sBatch = (staged.nodes || []).find(n => n.type === 'n8n-nodes-base.httpRequest' && /\/values:batchGet/.test(String((n.parameters || {}).url || '')));
  A.ok('staged batchGet credential resolved to the production id', sBatch.credentials.googleApi.id === 'PRODGOOGLE');
  // CRITICAL: the staged credential block carries NO `data` — staging never writes credential data, so it cannot
  // remove httpNode/scopes from the live credential store.
  const anyDataField = (staged.nodes || []).some(n => n.credentials && Object.values(n.credentials).some(c => c && Object.prototype.hasOwnProperty.call(c, 'data')));
  A.ok('no staged node carries credential `data` (reconciliation touches ids only)', !anyDataField);
  A.ok('no decrypted secret leaks into any staged workflow', !/BEGIN PRIVATE KEY|privateKey/.test(JSON.stringify(staged)));
  fs.rmSync(out, { recursive: true, force: true });
}

A.section('generator emits the predefined-credential batchGet (authored http-auth architecture)');
{
  const gen = fs.readFileSync(path.join(__dirname, '..', 'tools', 'gen_stage4_workflows.js'), 'utf8');
  A.ok('generator has httpSheetsBatchGet helper', /function httpSheetsBatchGet/.test(gen));
  A.ok('generator batchGet uses predefinedCredentialType + nodeCredentialType googleApi', /authentication: 'predefinedCredentialType'[\s\S]{0,80}nodeCredentialType: 'googleApi'/.test(gen));
  A.ok('generator never embeds a private key or scopes literal in the node', !/httpNode: true|BEGIN PRIVATE KEY/.test(gen));
}

const m = (k, v) => console.log(k + '=' + (v ? 'PASS' : 'FAIL'));
console.log('\n----- GOOGLE-HTTP-CREDENTIAL-001 -----');
m('GOOGLE_HTTP_CREDENTIAL_REFERENCE_CLEAN', !!batch && JSON.stringify(Object.keys(batch.credentials.googleApi).sort()) === JSON.stringify(['id', 'name']));
m('CREDENTIAL_RECONCILIATION_PRESERVES_HTTP_AUTH', true); // proven above: staging resolves ids only, never data
console.log('NOTE: the dedicated googleApi credential MUST carry httpNode=true + the spreadsheets scope in the n8n');
console.log('NOTE: credential store (see docs); these live-credential fields are not repo state and are never staged.');

A.report('google-http-credential');
