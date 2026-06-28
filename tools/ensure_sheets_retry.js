// ensure_sheets_retry.js — SHEETS-RATELIMIT-001 enforcement for the hand-maintained workflow set.
// The Stage 4 workflows (WF17-26) get their storm-free, window-crossing googleSheets retry from
// gen_stage4_workflows.js. The legacy pipeline workflows (WF01-16) are hand-maintained JSON, so this
// idempotent pass guarantees EVERY googleSheets node in n8n/workflows/*.json carries the SAME policy
// from the single source of truth (n8n/lib/sheets_retry_policy.js). It only ADDS the three retry fields
// when a node lacks a window-crossing wait — it never edits node parameters/logic — so re-running is a
// no-op (and a no-op on the generated set, which already complies). Run: node tools/ensure_sheets_retry.js
'use strict';
const fs = require('fs');
const path = require('path');
const RETRY = require('../n8n/lib/sheets_retry_policy.js');
const WINDOW = RETRY.WINDOW_MS;
const cfg = RETRY.nativeSheetsRetry();
const WF = path.join(__dirname, '..', 'n8n', 'workflows');

let filesChanged = 0, nodesPatched = 0, nodesTotal = 0;
for (const f of fs.readdirSync(WF).filter(n => /\.json$/.test(n)).sort()) {
  const p = path.join(WF, f);
  const w = JSON.parse(fs.readFileSync(p, 'utf8'));
  let changed = false;
  for (const n of (w.nodes || [])) {
    if (n.type !== 'n8n-nodes-base.googleSheets') continue;
    nodesTotal++;
    const compliant = n.retryOnFail === true && Number(n.maxTries) >= 2 && Number(n.waitBetweenTries) >= WINDOW;
    if (compliant) continue;
    n.retryOnFail = cfg.retryOnFail;
    n.maxTries = cfg.maxTries;
    n.waitBetweenTries = cfg.waitBetweenTries;
    nodesPatched++; changed = true;
  }
  if (changed) { fs.writeFileSync(p, JSON.stringify(w, null, 2) + '\n'); filesChanged++; console.log('patched', f); }
}
console.log('ensure_sheets_retry: files_changed=' + filesChanged + ' nodes_patched=' + nodesPatched + ' googleSheets_total=' + nodesTotal);
