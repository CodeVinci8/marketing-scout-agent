// test_prepare_staged.js — DEPLOY-002/008/§8: the staging tool produces deploy-ready workflow JSON with resolved
// installation-local ids, resolved bindings, reconciled credentials, active=false, and zero placeholders — so the
// release path imports STAGED files, never the raw committed source. Aborts fail-closed on ambiguous credentials
// and unresolved ids. Pure + offline, $0, no secrets.
'use strict';
const A = require('./_assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../tools/manifest_lib.js');
const RID = require('../tools/runtime_ids.js');
const PS = require('../tools/prepare_staged_workflows.js');

const identity = L.runtimeIdentity();
const KEYS = Object.keys(identity);
// a fully-resolved local map (fresh-install generation gives every key a stable msloc id)
function resolvedMap() { return RID.resolveAll(identity, RID.emptyMap(), { byName: {}, byId: {} }).nextMap; }
// A fully-provisioned production has one credential of EACH type the runtime workflows require: googleApi (Sheets),
// httpHeaderAuth (Claude/Firecrawl) and httpQueryAuth (VK). The deferred path (a type with no prod credential yet)
// is exercised separately below.
const COMPAT = [
  { id: 'prodGOOGLE', name: 'Google Sheets - SA', type: 'googleApi' },
  { id: 'prodHTTP', name: 'Claude', type: 'httpHeaderAuth' },
  { id: 'prodVK', name: 'VK Access Token', type: 'httpQueryAuth' }
];

A.section('§8 — staged files carry resolved ids + resolved bindings + reconciled creds + active=false');
{
  const r = PS.prepareStaged({ localMap: resolvedMap(), credExport: COMPAT });
  A.ok('staging ok with compatible credentials', r.ok);
  A.eq('all 19 runtime workflows staged', r.summary.staged_count, 19);
  A.eq('all 18 binding edges resolved', r.summary.bindings_resolved, 18);
  A.eq('0 bindings left unresolved', r.summary.bindings_unresolved, 0);
  A.eq('all credential references reconciled', r.summary.credentials_deferred, 0);
  A.ok('every staged workflow inactive', r.summary.all_inactive);
  A.ok('no ambiguous credential types', r.summary.credential_types_ambiguous.length === 0);
}

A.section('§8 — staged output (on disk) has zero placeholders and a resolved id per workflow');
{
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-stage-'));
  const r = PS.prepareStaged({ localMap: resolvedMap(), credExport: COMPAT, outDir: out });
  A.ok('write ok', r.ok);
  let placeholders = 0, inactive = 0, withId = 0, n = 0;
  for (const f of fs.readdirSync(out)) {
    const wf = JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')); n++;
    if (/PASTE_WORKFLOW_ID|PASTE_CREDENTIAL_ID_HERE/.test(JSON.stringify(wf))) placeholders++;
    if (wf.active === false) inactive++;
    if (wf.id) withId++;
  }
  A.eq('19 files written', n, 19);
  A.eq('zero placeholders remain (bindings + creds resolved)', placeholders, 0);
  A.eq('all inactive', inactive, 19);
  A.eq('every staged workflow has a resolved id', withId, 19);
  // staged != raw source: the raw committed file has no id and carries placeholders
  const rawWf08 = JSON.parse(fs.readFileSync(path.join(L.WF_DIR, '08_touchpoint_analyzer.json'), 'utf8'));
  A.ok('raw committed source carries the credential placeholder (proves staged is different)', /PASTE_CREDENTIAL_ID_HERE/.test(JSON.stringify(rawWf08)) && !rawWf08.id);
  fs.rmSync(out, { recursive: true, force: true });
}

A.section('DEPLOY-008 — ambiguous credential type ABORTS (never auto-selects)');
{
  const ambiguous = [{ id: 'g1', name: 'a', type: 'googleApi' }, { id: 'g2', name: 'b', type: 'googleApi' }, { id: 'prodHTTP', name: 'c', type: 'httpHeaderAuth' }];
  const r = PS.prepareStaged({ localMap: resolvedMap(), credExport: ambiguous });
  A.ok('ambiguous googleApi aborts staging', r.ok === false);
  A.ok('ambiguous type reported', r.summary.credential_types_ambiguous.indexOf('googleApi') >= 0);
  A.ok('error explains refusal to auto-select', r.errors.some(e => /ambiguous/.test(e) && /refusing/.test(e)));
}

A.section('CRED-003 — multiple credentials of one type are disambiguated by NAME (Claude/Firecrawl/Apify httpHeaderAuth)');
{
  // Production legitimately holds THREE httpHeaderAuth credentials. Type-only reconciliation would abort as
  // ambiguous; (type,name) resolution attaches each reference to the credential whose NAME it declares. The
  // committed Claude nodes (WF04/08/19) declare "Claude API - Marketing Scout"; Firecrawl declares its own name.
  const multiHeader = [
    { id: 'prodGOOGLE', name: 'Google Sheets - Marketing Scout Service Account', type: 'googleApi' },
    { id: 'prodCLAUDE', name: 'Claude API - Marketing Scout', type: 'httpHeaderAuth' },
    { id: 'prodFIRE', name: 'Firecrawl API - Marketing Scout', type: 'httpHeaderAuth' },
    { id: 'prodAPIFY', name: 'Apify API - Marketing Scout', type: 'httpHeaderAuth' },
    { id: 'prodVK', name: 'HTTP Query Auth - VK Access Token', type: 'httpQueryAuth' }
  ];
  const r = PS.prepareStaged({ localMap: resolvedMap(), credExport: multiHeader });
  A.ok('staging ok despite 3 httpHeaderAuth credentials (name disambiguates)', r.ok);
  A.ok('no ambiguous types reported', r.summary.credential_types_ambiguous.length === 0);
  A.eq('every reference reconciled, none deferred', r.summary.credentials_deferred, 0);
  // direct resolver semantics
  const idx = PS.indexCredentials(multiHeader);
  A.eq('Claude name resolves to the Claude credential', PS.resolveCredentialRef('httpHeaderAuth', 'Claude API - Marketing Scout', idx).id, 'prodCLAUDE');
  A.eq('Firecrawl name resolves to the Firecrawl credential', PS.resolveCredentialRef('httpHeaderAuth', 'Firecrawl API - Marketing Scout', idx).id, 'prodFIRE');
  A.eq('googleApi resolves by type-uniqueness even when the name differs', PS.resolveCredentialRef('googleApi', 'some other name', idx).action, 'resolve');
  A.eq('an httpHeaderAuth name matching none, with >1 of the type, is ABORTED (never auto-picked)', PS.resolveCredentialRef('httpHeaderAuth', 'no such name', idx).action, 'abort');
  A.eq('a type with no production credential is DEFERRED', PS.resolveCredentialRef('telegramApi', 'x', idx).action, 'defer');
}

A.section('§8 — a credential TYPE with no production match stays a DEFERRED placeholder (not a hard abort)');
{
  // only googleApi exists in production; httpHeaderAuth has no match -> deferred placeholders, still ok
  const r = PS.prepareStaged({ localMap: resolvedMap(), credExport: [{ id: 'prodGOOGLE', name: 'g', type: 'googleApi' }] });
  A.ok('staging still ok with a deferred type', r.ok);
  A.ok('some credentials deferred', r.summary.credentials_deferred > 0);
}

A.section('§8 — unresolved id fails closed (resolve ids before staging)');
{
  const partial = resolvedMap(); partial.workflows.WF18.id = null;
  const r = PS.prepareStaged({ localMap: partial, credExport: COMPAT });
  A.ok('missing id for a workflow fails closed', r.ok === false);
  A.ok('error names the unresolved workflow', r.errors.some(e => /WF18/.test(e) && /unresolved id/.test(e)));
}

A.section('SECURITY — staging report is sanitized (fingerprints only, no raw id/name)');
{
  const map = resolvedMap();
  const r = PS.prepareStaged({ localMap: map, credExport: COMPAT });
  const blob = JSON.stringify(r.staged) + JSON.stringify(r.summary);
  A.ok('no raw workflow id in the staged report', blob.indexOf(map.workflows.WF18.id) < 0);
  A.ok('no raw credential id in the report', blob.indexOf('prodGOOGLE') < 0 && blob.indexOf('prodHTTP') < 0);
  A.ok('report uses fingerprints', /fp_[0-9a-f]{10}/.test(blob));
}

A.report('prepare-staged');
