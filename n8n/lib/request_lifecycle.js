'use strict';
// request_lifecycle.js — THE ONE canonical active-request selector shared by /status and /cancel (WF18 command
// lane + WF22 control plane). Prevents the two commands from drifting to different definitions of "the active
// request". Owner+chat scoped, newest valid active request, TTL-expires stale awaiting_approval, ignores terminal /
// QA / foreign-owner rows, and never surfaces internal ids. Self-contained (embeds verbatim; no cross-require).

function rlStr(v) { return v == null ? '' : String(v).trim(); }
function rlLow(v) { return rlStr(v).toLowerCase(); }
function rlTime(v) { var t = Date.parse(rlStr(v)); return isNaN(t) ? 0 : t; }

// Non-terminal lifecycle states a user can /status or /cancel. Everything else (completed/failed/cancelled/
// rejected/expired/…) is terminal and MUST be ignored by both commands.
var RL_ACTIVE = ['awaiting_approval', 'approved', 'collecting', 'planning', 'analyzing', 'reporting', 'running'];
var RL_TERMINAL = ['completed', 'done', 'failed', 'error', 'cancelled', 'canceled', 'rejected', 'expired', 'no_data'];
function rlIsActive(s) { return RL_ACTIVE.indexOf(rlLow(s)) >= 0; }
function rlIsTerminal(s) { return RL_TERMINAL.indexOf(rlLow(s)) >= 0; }

// QA / test / driver rows (blank owner, or an explicit non-user marker like 'stage_d_owner') are never user-owned
// active requests and must be excluded from /status and /cancel. Real owners are the sender's chat/user id; owner
// isolation (below) already scopes to the requester, so this is a narrow extra guard for stray QA rows only — it
// must NOT reject legitimate owner ids (which may be non-numeric in tests).
var RL_QA_OWNERS = ['stage_d_owner', 'qa', 'qa_owner', 'test', 'test_owner', 'driver', 'system', 'none'];
function rlIsQaOwner(o) { o = rlLow(o); return o === '' || RL_QA_OWNERS.indexOf(o) >= 0; }

// Default stale-awaiting_approval TTL (minutes): an approval prompt older than this is abandoned, not "active".
var RL_DEFAULT_TTL_MIN = 120;

// selectActiveRequest(plans, opts) -> { found, request, active_count, others, stale_ignored }
//   opts: { owner_user_id, chat_id, now_iso, ttl_minutes }
function selectActiveRequest(plans, opts) {
  opts = opts || {};
  var owner = rlStr(opts.owner_user_id);
  var chat = rlStr(opts.chat_id);
  var nowMs = opts.now_iso ? (Date.parse(opts.now_iso) || Date.now()) : Date.now();
  var ttlMin = (opts.ttl_minutes === 0 || opts.ttl_minutes) ? Number(opts.ttl_minutes) : RL_DEFAULT_TTL_MIN;
  if (isNaN(ttlMin)) ttlMin = RL_DEFAULT_TTL_MIN;
  var ttlMs = ttlMin * 60000;
  var rows = (plans || []).filter(Boolean);
  var staleIgnored = 0;
  var mine = rows.filter(function (r) {
    if (rlIsQaOwner(r.owner_user_id)) return false;                       // ignore QA / non-user rows
    if (owner && rlStr(r.owner_user_id) !== owner) return false;          // owner isolation
    if (chat && rlStr(r.chat_id) !== '' && rlStr(r.chat_id) !== chat) return false; // chat scope (tolerate blank)
    if (!rlIsActive(r.status)) return false;                              // ignore terminal + unknown states
    if (rlLow(r.status) === 'awaiting_approval') {                        // TTL-expire abandoned approvals
      var created = rlTime(r.created_at);
      if (created > 0 && (nowMs - created) > ttlMs) { staleIgnored++; return false; }
    }
    return true;
  });
  mine.sort(function (a, b) {                                             // newest first (created_at, plan_id tiebreak)
    var d = rlTime(b.created_at) - rlTime(a.created_at);
    return d !== 0 ? d : rlStr(b.plan_id).localeCompare(rlStr(a.plan_id));
  });
  // STATUS-DEDUP-001: one request can leave several active plan rows (a stale awaiting_approval row + a newer
  // collecting row, or append-history) — collapse to the NEWEST row per agent_request_id (mine is newest-first)
  // so /status never counts or lists the same request twice in "Ещё в работе".
  var seenReq = {}, deduped = [];
  for (var i = 0; i < mine.length; i++) {
    var rk = rlStr(mine[i].agent_request_id) || rlStr(mine[i].plan_id) || ('#' + i);
    if (seenReq[rk]) continue;
    seenReq[rk] = 1; deduped.push(mine[i]);
  }
  mine = deduped;
  var chosen = mine.length ? mine[0] : null;
  return { found: !!chosen, request: chosen, active_count: mine.length, others: mine.slice(1), stale_ignored: staleIgnored };
}

module.exports = { selectActiveRequest, rlIsActive, rlIsTerminal, rlIsQaOwner, RL_ACTIVE, RL_TERMINAL, RL_DEFAULT_TTL_MIN };
