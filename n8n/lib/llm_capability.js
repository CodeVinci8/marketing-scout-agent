'use strict';
// llm_capability.js — CAN the deployed Claude credential actually be used? Answered WITHOUT ever reading its value.
//
// Why this exists (CAP-CLAUDE-001): production auth lives in an n8n *credential* bound to the HTTP node, not in
// MS_CLAUDE_API_KEY. So `claude_key_present` (env-derived) says nothing about the real path — it is false in
// production while the credential works perfectly (live-proven: WF28 exec 834). A cost model gated on it either
// silently drops the AI component from an estimate for work that WILL run, or (if inverted) promises AI work that
// CANNOT run. Both are dishonest to the user approving a spend.
//
// The strongest available signal is the system's OWN persisted telemetry: an llm_analysis_telemetry row whose call
// REACHED the provider (a provider_request_id or real token usage came back) PROVES the bound credential worked;
// the newest row with error_category='auth_error' and nothing newer PROVES it does not. A declaration/env key is a
// weaker fallback for a fresh install with no telemetry yet. Proof ages out — a 6-month-old success proves nothing
// about a credential that may since have been rotated.
//
// This reads ONLY the provider outcome columns (error_category / provider_request_id / token counts / created_at).
// It never reads, logs, returns or persists a secret, and never reads another owner's analysis content — the
// credential is a system-level property, not per-owner data.
//
// Embeddable: unique lk*-prefixed names, no cross-lib require.

function lkStr(v) { return v == null ? '' : String(v); }
function lkNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

var LK_PROOF_TTL_DAYS = 30;

// What does one telemetry row prove about the credential?
//   'auth_error'       -> the provider rejected our auth: the credential is bad/missing.
//   'reached_provider' -> the provider answered (request id or real tokens): the credential is good. This holds
//                         even for a schema/validation failure — that is a MODEL problem, not an auth problem.
//   'unknown'          -> the call never left the box (disabled / no_evidence / local gate) — proves nothing.
function lkRowOutcome(r) {
  if (!r) return 'unknown';
  var cat = lkStr(r.error_category);
  if (cat === 'auth_error') return 'auth_error';
  // A locally-gated row never touched the provider.
  if (cat === 'disabled' || cat === 'no_evidence') return 'unknown';
  var reqId = lkStr(r.provider_request_id);
  var tok = lkNum(r.input_tokens, 0) + lkNum(r.output_tokens, 0);
  if (reqId || tok > 0) return 'reached_provider';
  return 'unknown';
}

// claudeCapability(cfg, telemetryRows, opts) -> { available, mode, reason_ru, proof_at }
//   mode: 'proven_credential' | 'auth_failing' | 'env_key' | 'declared_credential' | 'none'
// Precedence: real observed outcomes (newest wins) > env key > operator declaration > nothing.
function claudeCapability(cfg, telemetryRows, opts) {
  cfg = cfg || {}; opts = opts || {};
  var now = opts.now ? Date.parse(lkStr(opts.now)) : Date.now();
  if (!isFinite(now)) now = Date.now();
  var ttlMs = lkNum(opts.proof_ttl_days, LK_PROOF_TTL_DAYS) * 86400000;

  var newest = null;
  (Array.isArray(telemetryRows) ? telemetryRows : []).forEach(function (r) {
    var oc = lkRowOutcome(r);
    if (oc === 'unknown') return;
    var t = Date.parse(lkStr(r && r.created_at));
    if (!isFinite(t)) return;
    if (now - t > ttlMs) return;            // a stale proof is no proof (the credential may have been rotated)
    if (!newest || t > newest.t) newest = { t: t, outcome: oc, at: lkStr(r.created_at) };
  });

  if (newest && newest.outcome === 'auth_error') {
    return { available: false, mode: 'auth_failing', reason_ru: 'последний вызов AI отклонён по авторизации', proof_at: newest.at };
  }
  if (newest && newest.outcome === 'reached_provider') {
    return { available: true, mode: 'proven_credential', reason_ru: 'AI-доступ подтверждён недавним успешным вызовом', proof_at: newest.at };
  }
  if (cfg.claude_key_present === true) {
    return { available: true, mode: 'env_key', reason_ru: 'AI-ключ настроен', proof_at: '' };
  }
  if (cfg.claude_credential_declared === true) {
    return { available: true, mode: 'declared_credential', reason_ru: 'AI-доступ объявлен оператором (ещё не подтверждён вызовом)', proof_at: '' };
  }
  return { available: false, mode: 'none', reason_ru: 'AI-доступ не настроен', proof_at: '' };
}

// Fold the capability into a config for cost_model/gating. Never mutates the input.
// `claude_available` is what cost_model consults; the mode/proof stay for diagnostics + honest UX wording.
function withClaudeCapability(cfg, telemetryRows, opts) {
  cfg = cfg || {};
  var cap = claudeCapability(cfg, telemetryRows, opts);
  var out = {};
  for (var k in cfg) { if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k]; }
  out.claude_available = cap.available;
  out.claude_auth_mode = cap.mode;
  out.claude_proof_at = cap.proof_at;
  return out;
}

module.exports = { LK_PROOF_TTL_DAYS, claudeCapability, withClaudeCapability, lkRowOutcome };
