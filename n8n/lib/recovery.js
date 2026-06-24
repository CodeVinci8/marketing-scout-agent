'use strict';
// recovery.js — stalled-request detection + idempotent recovery planning (Section 32 / 6.6).
//
// A request that stops making progress mid-pipeline must be detected without false positives: a request that is
// legitimately WAITING for user approval is NOT stalled, and a CANCELLED/terminal request is NOT stalled. Each
// pipeline stage has its own timeout. A recovery action is keyed deterministically so re-running detection never
// schedules a duplicate recovery job. Pure + deterministic + self-contained, $0.

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

// Per-stage soft timeout (minutes) before a request is considered stalled. awaiting_approval is intentionally
// absent (no timeout) — the user may take any amount of time to approve.
var STAGE_TIMEOUT_MIN = {
  accepted: 5, clarifying: 0, planned: 0, approved: 10, collecting: 30, normalizing: 15,
  analyzing: 20, verifying_evidence: 15, building_report: 15, delivering: 10
};
var TERMINAL = ['delivered', 'cancelled', 'failed', 'dead_letter', 'rejected'];
var NO_TIMEOUT = ['awaiting_approval', 'clarifying', 'planned']; // waiting on the user

function minutesBetween(a, b) { var ta = Date.parse(str(a)), tb = Date.parse(str(b)); if (!isFinite(ta) || !isFinite(tb)) return null; return (tb - ta) / 60000; }

// Detect stalled requests. `requests` rows carry { agent_request_id, owner_user_id, state, last_progress_at }.
function detectStalled(requests, now, cfg) {
  cfg = cfg || {};
  var out = [];
  (requests || []).forEach(function (r) {
    var state = low(r.state);
    if (TERMINAL.indexOf(state) >= 0) return;          // terminal => never stalled
    if (NO_TIMEOUT.indexOf(state) >= 0) return;        // waiting on the user => never stalled (no false positive)
    var timeout = num(cfg['timeout_' + state], STAGE_TIMEOUT_MIN[state] != null ? STAGE_TIMEOUT_MIN[state] : 30);
    if (timeout <= 0) return;
    var idle = minutesBetween(r.last_progress_at, now);
    if (idle == null) return;
    if (idle > timeout) {
      out.push({
        agent_request_id: str(r.agent_request_id), owner_user_id: str(r.owner_user_id), state: state,
        idle_minutes: Math.round(idle), timeout_minutes: timeout,
        recovery_key: str(r.agent_request_id) + '::stalled::' + state,   // deterministic => no duplicate job
        action: idle > timeout * 3 ? 'alert_operator' : 'retry_stage'
      });
    }
  });
  return out;
}

// Filter out recovery actions already taken (idempotent): an existing recovery row with the same recovery_key
// means the job was already scheduled.
function planRecovery(stalled, existingRecoveries) {
  var seen = {}; (existingRecoveries || []).forEach(function (e) { seen[str(e.recovery_key)] = 1; });
  return (stalled || []).filter(function (s) { return !seen[s.recovery_key]; });
}

module.exports = { STAGE_TIMEOUT_MIN, TERMINAL, NO_TIMEOUT, detectStalled, planRecovery, minutesBetween };
