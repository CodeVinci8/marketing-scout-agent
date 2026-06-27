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

function nonEmpty(v) { return !!(v && String(v).trim()); }

// clearance(blocker) -> { cleared, reason }. Only TWO statuses clear the gate, and each demands proof:
//   resolved — fully fixed in code; requires non-empty evidence (real code + a named regression test).
//   accepted — a residual risk EXPLICITLY accepted by the operator; requires evidence + residual_risk + accepted_by.
// IDEMP-001 honesty (the read-then-write race): 'mitigated' is NOT 'resolved' — concurrent exactly-once is not
// proven, so a 'mitigated' item keeps the gate CLOSED until it is genuinely resolved or risk-accepted.
function clearance(b) {
  switch (b.status) {
    case 'resolved':
      return nonEmpty(b.evidence) ? { cleared: true, reason: 'resolved_with_evidence' } : { cleared: false, reason: 'resolved_without_evidence' };
    case 'accepted':
      return (nonEmpty(b.evidence) && nonEmpty(b.residual_risk) && nonEmpty(b.accepted_by))
        ? { cleared: true, reason: 'risk_accepted_by_operator' }
        : { cleared: false, reason: 'accepted_without_full_signoff' };
    default:
      return { cleared: false, reason: 'status_' + (b.status || 'unknown') };
  }
}

// gate(registry) -> { allow, blocking_open, open_ids, open_reasons, total, marker }
function gate(reg) {
  reg = reg || load();
  const blocking = new Set(reg.gate_severities_blocking || ['P0', 'P1']);
  const considered = (reg.blockers || []).filter(b => blocking.has(b.severity));
  const open = considered.map(b => ({ b, c: clearance(b) })).filter(x => !x.c.cleared);
  const allow = open.length === 0;
  return {
    allow: allow,
    blocking_open: open.length,
    open_ids: open.map(x => x.b.id),
    open_reasons: open.map(x => ({ id: x.b.id, status: x.b.status, reason: x.c.reason })),
    total: (reg.blockers || []).length,
    marker: allow ? 'WF18_REARCHITECTURE=READY' : 'WF18_REARCHITECTURE=PENDING'
  };
}

module.exports = { load, gate, clearance, REGISTRY };

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--registry');
  const g = gate(load(fileIdx >= 0 ? args[fileIdx + 1] : REGISTRY));
  console.log(g.marker);
  if (!g.allow) {
    console.log('WF18 activation BLOCKED — ' + g.blocking_open + ' open P0/P1 blocker(s):');
    g.open_reasons.forEach(r => console.log('  - ' + r.id + ' (status=' + r.status + ', ' + r.reason + ')'));
    console.log('Clear each (status=resolved with evidence, or status=accepted with residual_risk+accepted_by) before activating WF18.');
    process.exit(1);
  }
  console.log('WF18 activation gate is OPEN (all P0/P1 blockers resolved with evidence).');
  process.exit(0);
}
