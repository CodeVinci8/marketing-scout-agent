#!/usr/bin/env bash
# release_pipeline.sh — the ONE shared release lock / backup / evidence / rollback layer used by BOTH the
# production deploy (scripts/deploy_n8n.sh) and the disposable acceptance (scripts/n8n_disposable_e2e.sh), so the
# operator path and the test path exercise the SAME release implementation (§5 / RELEASE-005). Sourced, not run.
#
# Ordered apply spine (the sourcing script wires its import/bind between rp_backup_production and rp_finalize):
#   rp_lock_acquire -> [resolve ids / stage / reconcile] -> rp_backup_production -> [import inactive / bind / verify]
#   -> rp_write_evidence(PASS) -> rp_emit_rollback -> (EXIT trap) rp_finish: clean secret temp + release lock.
# On ANY failure the EXIT trap writes sanitized ABORT evidence + a rollback instruction, cleans secret-bearing
# temp files, and releases the lock — never leaving a half-finished release silently locked (§5 failure behavior).
#
# Requires: RP_ROOT (repo root) + a sourced scripts/lib/n8n_exec.sh. POSIX-friendly bash; never destructive
# (it shells backup.sh/release_lock.sh, which themselves refuse volume removal / --decrypted).

: "${RP_ROOT:?release_pipeline.sh requires RP_ROOT to be set by the sourcing script}"
RP_LOCK_SH="${RP_ROOT}/scripts/release_lock.sh"
RP_BACKUP_SH="${RP_ROOT}/scripts/backup.sh"
RP_REPORT_JS="${RP_ROOT}/tools/release_report.js"
RP_EVIDENCE_DIR="${MS_RELEASE_EVIDENCE_DIR:-${RP_ROOT}/release-evidence}"
RP_OWNER="${MS_RELEASE_OWNER:-${USER:-operator}@$(hostname 2>/dev/null || echo host)}"
RP_ROLLBACK_CMD="${MS_ROLLBACK_CMD:-scripts/rollback.sh --apply}"

rp_say() { printf '%s\n' "$*"; }

# --- release lock (RELEASE-004): non-zero on contention; never silently steals a live lock --------------------
RP_LOCK_HELD="no"
rp_lock_acquire() {
  if "$RP_LOCK_SH" acquire --owner "$RP_OWNER"; then RP_LOCK_HELD="yes"; return 0; fi
  return 1
}
rp_lock_release() {
  [ "$RP_LOCK_HELD" = "yes" ] || return 0
  "$RP_LOCK_SH" release --owner "$RP_OWNER" >/dev/null 2>&1 || true
  RP_LOCK_HELD="no"
}

# --- production backup BEFORE any mutation (BACKUP-001/§9) ----------------------------------------------------
# Honors MS_BACKUP_ROOT (disposable points this at a throwaway dir) + MS_N8N_VOLUME. In MS_N8N_EXEC_DRY mode it
# only plans. Sets RP_BACKUP_PATH / RP_BACKUP_SHA. NEVER deletes the existing operator backup.
RP_BACKUP_PATH=""; RP_BACKUP_SHA=""
rp_backup_production() {
  local dest="${MS_BACKUP_ROOT:-/root/backups}/n8n-prerelease-$(date -u +%Y%m%d-%H%M%S)"
  if [ "${MS_N8N_EXEC_DRY:-0}" = "1" ] || [ "${RP_BACKUP_MODE:-apply}" = "dry-run" ]; then
    "$RP_BACKUP_SH" --dry-run --dest "$dest" || return 1
    RP_BACKUP_PATH="$dest"; return 0
  fi
  local out
  out="$("$RP_BACKUP_SH" --apply --dest "$dest")" || return 1
  printf '%s\n' "$out"
  RP_BACKUP_PATH="$(printf '%s\n' "$out" | sed -n 's/^BACKUP_ARCHIVE=//p' | head -1)"
  RP_BACKUP_SHA="$(printf '%s\n' "$out" | sed -n 's/^BACKUP_SHA256=//p' | head -1)"
  [ -n "$RP_BACKUP_PATH" ] || return 1
}

# --- sanitized release evidence (RELEASE-003): fingerprints only, always carries the rollback command ----------
# rp_write_evidence <result> <coverage> <id_map_checksum> <active_count>
rp_write_evidence() {
  local result="$1" coverage="${2:-unknown}" checksum="${3:-unknown}" active="${4:-null}"
  mkdir -p "$RP_EVIDENCE_DIR" 2>/dev/null || true
  local out="${RP_EVIDENCE_DIR}/release-$(date -u +%Y%m%d-%H%M%S)-$$.json"
  printf '{"result":"%s","runtime_id_coverage":"%s","runtime_id_map_checksum":"%s","active_workflows":%s,"backup_path":"%s","backup_sha256":"%s","n8n_version_expected":"%s","rollback_command":"%s"}' \
    "$result" "$coverage" "$checksum" "${active:-null}" "$RP_BACKUP_PATH" "$RP_BACKUP_SHA" "${N8N_EXPECTED_VERSION:-2.23.3}" "$RP_ROLLBACK_CMD" \
    | node "$RP_REPORT_JS" --out "$out" >/dev/null 2>&1 || true
  rp_say "RELEASE_EVIDENCE=$out result=$result"
  RP_EVIDENCE_FILE="$out"
}

rp_emit_rollback() {
  rp_say "ROLLBACK_COMMAND=${RP_ROLLBACK_CMD}"
  rp_say "  (deletes the Telegram webhook, unpublishes the trigger workflow(s), restores the previous workflow"
  rp_say "   export / runtime-id map, points at the pre-release backup ${RP_BACKUP_PATH:-<backup>}, then verifies)"
}

# Remove secret-bearing temp files (cred export metadata, staged dir) no matter the outcome.
rp_clean_temp() { [ -n "${1:-}" ] && rm -rf "$1" 2>/dev/null || true; }

# EXIT-trap finisher (robust even when `set -e`/die exits mid-pipeline): write ABORT evidence + rollback if the
# pipeline did not reach RP_DONE=yes, then always clean secret temp + release the lock.
RP_DONE="no"
rp_finish() {
  local tmp="${1:-}"
  if [ "$RP_DONE" != "yes" ]; then
    rp_say ""
    rp_say "RELEASE_ABORTED — preserving sanitized diagnostics and a rollback instruction (no further import)."
    rp_write_evidence ABORTED "${RP_COVERAGE:-unknown}" "${RP_CHECKSUM:-unknown}" ""
    rp_emit_rollback
  fi
  rp_clean_temp "$tmp"
  rp_lock_release
}
