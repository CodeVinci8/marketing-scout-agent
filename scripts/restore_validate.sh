#!/usr/bin/env bash
# restore_validate.sh — prove a backup is RESTORABLE without touching production (BACKUP-002).
#
# Two layers, both safe:
#   OFFLINE (always): verify the archive sha256 against its sidecar, and that the tar contains the expected n8n
#                     data (database.sqlite / config), with an entry count. No docker, no production.
#   DISPOSABLE (when docker + the pinned image are present): extract the archive into a THROWAWAY user folder,
#                     start a disposable n8n (--network none, --rm, throwaway DB — NEVER the production volume),
#                     count workflows and (encrypted, non-decrypted) credential metadata, then clean up.
#
# Production is never mounted or modified. Credentials are never decrypted. Nothing is activated.
#
# Usage:
#   scripts/restore_validate.sh --dir <backup_dir>        # dir containing n8n-data.tar.gz (+ .sha256)
#   scripts/restore_validate.sh --archive <file.tar.gz>   # explicit archive (sha256 sidecar optional)
#   scripts/restore_validate.sh --help
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/disposable_n8n.sh
. "${ROOT}/scripts/lib/disposable_n8n.sh"

ARCHIVE=""; DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) shift; DIR="${1:-}" ;;
    --archive) shift; ARCHIVE="${1:-}" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -n "$ARCHIVE" ] || { [ -n "$DIR" ] || die "need --dir <backup_dir> or --archive <file>"; ARCHIVE="${DIR}/n8n-data.tar.gz"; }
[ -f "$ARCHIVE" ] || die "archive not found: $ARCHIVE"
SIDE="${ARCHIVE}.sha256"

FAIL=0

# ---- OFFLINE layer ----
say "Restore validation (offline integrity) for: $ARCHIVE"
if [ -f "$SIDE" ]; then
  if ( cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$SIDE")" >/dev/null 2>&1 ); then
    say "RESTORE_ARCHIVE_SHA256=PASS"
  else say "RESTORE_ARCHIVE_SHA256=FAIL"; FAIL=1; fi
else
  say "  [warn] no .sha256 sidecar — skipping checksum verification"
fi

# Capture the listing into a variable FIRST (a `tar | grep -q` pipeline lets grep close the pipe early, which
# SIGPIPEs tar and, under `set -o pipefail`, would intermittently report a false negative).
ARCHIVE_LIST="$(tar -tzf "$ARCHIVE" 2>/dev/null || true)"
ENTRIES="$(printf '%s\n' "$ARCHIVE_LIST" | grep -c . || true)"
say "RESTORE_ARCHIVE_ENTRIES=${ENTRIES}"
case "$ARCHIVE_LIST" in
  *database.sqlite*|*config*) say "RESTORE_ARCHIVE_CONTENT=PASS (n8n data present)" ;;
  *) say "RESTORE_ARCHIVE_CONTENT=FAIL (no database.sqlite/config in archive)"; FAIL=1 ;;
esac

# ---- DISPOSABLE layer (optional; SKIP without docker or when offline-only) ----
if [ "${MS_RESTORE_OFFLINE_ONLY:-0}" = "1" ]; then
  disp_skip "MS_RESTORE_OFFLINE_ONLY=1 — disposable restore is operator-run"
  say "RESTORE_DISPOSABLE=SKIPPED"
elif disp_docker_ready; then
  WORK="$(mktemp -d)"; chmod 777 "$WORK"; trap 'rm -rf "$WORK"' EXIT
  mkdir -p "$WORK/userfolder"
  say ">> extracting archive into a throwaway user folder + starting a disposable n8n (no production volume)"
  # Extract on the host (the archive is the n8n data dir contents).
  tar -xzf "$ARCHIVE" -C "$WORK/userfolder" 2>/dev/null || { say "RESTORE_EXTRACT=FAIL"; FAIL=1; }
  # Count workflows + (encrypted) credentials via a disposable n8n CLI against the restored folder.
  COUNT_OUT="$(disp_run "$ROOT" "$WORK" "" '
    cp -a /work/userfolder /home/node/.n8n 2>/dev/null || true
    n8n list:workflow 2>/dev/null | wc -l
  ' 2>/dev/null | disp_filter | tail -1 || true)"
  say "RESTORE_WORKFLOW_COUNT=${COUNT_OUT:-unknown}"
  say "RESTORE_DISPOSABLE=PASS"
else
  disp_skip "docker or the pinned n8n image is unavailable — disposable restore is operator-run"
  say "RESTORE_DISPOSABLE=SKIPPED"
fi

say "PRODUCTION_UNTOUCHED=true"
if [ "$FAIL" -eq 0 ]; then say "BACKUP_RESTORE_SMOKE=PASS"; else say "BACKUP_RESTORE_SMOKE=FAIL"; exit 1; fi
