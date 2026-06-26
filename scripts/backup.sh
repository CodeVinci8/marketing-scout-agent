#!/usr/bin/env bash
# backup.sh — safe, dry-run-by-default backup of the n8n data volume (BACKUP-001/002, SECURITY-003).
#
# Produces a timestamped, checksummed, ENCRYPTED-AT-REST archive of the n8n data dir (/home/node/.n8n, which
# already holds the encrypted SQLite DB + encrypted credentials). It NEVER decrypts credentials (no --decrypted),
# NEVER removes or recreates the production volume, and NEVER prints secrets.
#
# The archive is created by a DISPOSABLE container that mounts the volume read-only and OVERRIDES the n8n image
# entrypoint with /bin/sh (the BACKUP-001 fix: the entrypoint is `n8n`, so `sh` must be forced via --entrypoint).
#
# Usage:
#   scripts/backup.sh [--dry-run]            # default: validate + print the exact plan, create NOTHING
#   scripts/backup.sh --apply [--dest DIR]   # create the archive + sha256 + manifest (mode 600)
#   scripts/backup.sh --help
#
# Knobs: MS_N8N_VOLUME (default n8n_n8n_data), MS_BACKUP_ROOT (default /root/backups), MS_BACKUP_MIN_FREE_MB
# (default 200). Honors the n8n_exec abstraction (MS_N8N_IMAGE pinned; MS_N8N_EXEC_DRY for rehearsal).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/n8n_exec.sh
. "${ROOT}/scripts/lib/n8n_exec.sh"

MODE="dry-run"
MS_N8N_VOLUME="${MS_N8N_VOLUME:-n8n_n8n_data}"
MS_BACKUP_ROOT="${MS_BACKUP_ROOT:-/root/backups}"
MS_BACKUP_MIN_FREE_MB="${MS_BACKUP_MIN_FREE_MB:-200}"
DEST=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) MODE="dry-run" ;;
    --apply) MODE="apply" ;;
    --dest) shift; DEST="${1:-}" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

STAMP="$(date -u +%Y%m%d-%H%M%S)"
[ -n "$DEST" ] || DEST="${MS_BACKUP_ROOT}/n8n-backup-${STAMP}"

# --- fail-closed destination safety (never the volume mountpoint, never '/', never a data path) ---
validate_dest() {
  case "$DEST" in
    ""|"/"|"/home/node/.n8n"|*"/n8n_n8n_data"|*"$MS_N8N_VOLUME") die "refusing unsafe backup destination: '$DEST'" ;;
  esac
  case "$DEST" in /*) ;; *) die "backup destination must be an absolute path: '$DEST'" ;; esac
  printf 'BACKUP_DEST_SAFE=PASS\n'
}

# --- disk space guard ---
check_space() {
  local parent free_mb
  parent="$(dirname "$DEST")"
  mkdir -p "$parent"
  free_mb="$(df -Pm "$parent" 2>/dev/null | awk 'NR==2{print $4}')"
  [ -n "$free_mb" ] || { say "  [warn] could not determine free space at $parent"; return 0; }
  if [ "$free_mb" -lt "$MS_BACKUP_MIN_FREE_MB" ]; then die "insufficient space at $parent: ${free_mb}MB < ${MS_BACKUP_MIN_FREE_MB}MB required"; fi
  printf 'BACKUP_SPACE_OK=PASS (free=%sMB)\n' "$free_mb"
}

print_plan() {
  say "n8n backup plan (mode: ${MODE})"
  say "  volume      : ${MS_N8N_VOLUME} (mounted read-only)"
  say "  destination : ${DEST}/n8n-data.tar.gz (+ .sha256 + backup_manifest.json)"
  say "  method      : docker run --rm --entrypoint /bin/sh (NEVER --decrypted, NEVER removes the volume)"
  validate_dest
  check_space
}

do_backup() {
  print_plan
  mkdir -p "$DEST"; chmod 700 "$DEST"
  say ">> creating archive (disposable container, volume read-only, entrypoint overridden to /bin/sh)"
  # The inner sh tars the mounted volume to the mounted backup dir; both are bind mounts of the disposable run.
  n8n_run_image_sh 'cd /data && tar -czf /backup/n8n-data.tar.gz .' \
    -v "${MS_N8N_VOLUME}:/data:ro" -v "${DEST}:/backup"
  if [ "${MS_N8N_EXEC_DRY:-0}" = "1" ]; then say "DRY: archive not actually written."; return 0; fi
  [ -f "${DEST}/n8n-data.tar.gz" ] || die "archive was not produced"
  chmod 600 "${DEST}/n8n-data.tar.gz"
  ( cd "$DEST" && sha256sum n8n-data.tar.gz > n8n-data.tar.gz.sha256 ); chmod 600 "${DEST}/n8n-data.tar.gz.sha256"
  local size sha
  size="$(stat -c %s "${DEST}/n8n-data.tar.gz")"
  sha="$(awk '{print $1}' "${DEST}/n8n-data.tar.gz.sha256")"
  printf '{\n  "created_at": "%s",\n  "volume": "%s",\n  "archive": "n8n-data.tar.gz",\n  "bytes": %s,\n  "sha256": "%s",\n  "decrypted": false\n}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MS_N8N_VOLUME" "$size" "$sha" > "${DEST}/backup_manifest.json"
  chmod 600 "${DEST}/backup_manifest.json"
  say "BACKUP_ARCHIVE=${DEST}/n8n-data.tar.gz"
  say "BACKUP_SHA256=${sha}"
  say "BACKUP_RESULT=PASS"
}

case "$MODE" in
  dry-run) print_plan; say "BACKUP_DRY_RUN=PASS (no archive written; re-run with --apply)";;
  apply) do_backup ;;
esac
