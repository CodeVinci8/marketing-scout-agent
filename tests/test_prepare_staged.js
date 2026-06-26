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
const COMPAT = [{ id: 'prodGOOGLE', name: 'Google Sheets - SA', type: 'googleApi' }, { id: 'prodHTTP', name: 'Claude', type: 'httpHeaderAuth' }];

A.section('§8 — staged files carry resolved ids + resolved bindings + reconciled creds + active=false');
{
  const r = PS.prepareStaged({ localMap: resolvedMap(), credExport: COMPAT });
  A.ok('staging ok with compatible credentials', r.ok);
  A.eq('all 15 runtime workflows staged', r.summary.staged_count, 15);
  A.eq('all 13 binding edges resolved', r.summary.bindings_resolved, 13);
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
  A.eq('15 files written', n, 15);
  A.eq('zero placeholders remain (bindings + creds resolved)', placeholders, 0);
  A.eq('all inactive', inactive, 15);
  A.eq('every staged workflow has a resolved id', withId, 15);
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
