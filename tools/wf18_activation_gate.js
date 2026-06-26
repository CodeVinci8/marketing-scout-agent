// wf18_activation_gate.js — HARD pre-live gate for publishing WF18 (the Telegram gateway).
//
// The user-facing requirement: WF18 must NOT be published/activated while the known Telegram/WF18 P0/P1
// blockers (config/wf18_blockers.json) remain unresolved. deploy_n8n.sh consults this gate before activating
// the WF18 trigger; a single open blocking item refuses activation and emits WF18_REARCHITECTURE=PENDING.
//
// Resolving a blocker = real code + a named regression test, then flip its status to 'resolved' with the test
// name in `evidence`. The gate opens only when EVERY P0/P1 item is resolved. Pure + offline.
'use strict';
const fs = require('fs');
const path = require('path');

const REGISTRY = path.join(__dirname, '..', 'config', 'wf18_blockers.json');

function load(file) { return JSON.parse(fs.readFileSync(file || REGISTRY, 'utf8')); }

// gate(registry) -> { allow, blocking_open, open_ids, total, marker }
function gate(reg) {
  reg = reg || load();
  const blocking = new Set(reg.gate_severities_blocking || ['P0', 'P1']);
  const open = (reg.blockers || []).filter(b => blocking.has(b.severity) && b.status !== 'resolved');
  // A resolved item MUST cite proving evidence, else it does not count as resolved (no silent "resolved").
  const falselyResolved = (reg.blockers || []).filter(b => b.status === 'resolved' && !(b.evidence && String(b.evidence).trim()));
  const allOpen = open.concat(falselyResolved.map(b => Object.assign({}, b, { reason: 'resolved_without_evidence' })));
  const allow = allOpen.length === 0;
  return {
    allow: allow,
    blocking_open: allOpen.length,
    open_ids: allOpen.map(b => b.id),
    total: (reg.blockers || []).length,
    marker: allow ? 'WF18_REARCHITECTURE=READY' : 'WF18_REARCHITECTURE=PENDING'
  };
}

module.exports = { load, gate, REGISTRY };

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--registry');
  const g = gate(load(fileIdx >= 0 ? args[fileIdx + 1] : REGISTRY));
  console.log(g.marker);
  if (!g.allow) {
    console.log('WF18 activation BLOCKED — ' + g.blocking_open + ' open P0/P1 blocker(s):');
    g.open_ids.forEach(id => console.log('  - ' + id));
    console.log('Resolve them (code + regression test, set status=resolved with evidence) before activating WF18.');
    process.exit(1);
  }
  console.log('WF18 activation gate is OPEN (all P0/P1 blockers resolved with evidence).');
  process.exit(0);
}
