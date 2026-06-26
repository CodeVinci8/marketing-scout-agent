#!/usr/bin/env bash
# rollback.sh — REAL release rollback (ROLLBACK-001), not "delete the workflows in the n8n UI". DRY-RUN by
# default; --apply performs it. It is generated from the current release attempt and restores, in order:
#
#   1. Telegram webhook  — deleteWebhook (stop public ingress first)            [telegram_webhook.sh delete]
#   2. publication state — unpublish/deactivate the trigger workflow(s)         [deploy_n8n.sh --deactivate-triggers]
#   3. runtime-id map    — restore config/runtime_ids.local.json from its most recent .bak.<ts> backup
#   4. previous workflows— the documented restore path from the pre-release backup (DB restore is operator-gated,
#                          never auto-performed here because it would replace the encrypted data volume)
#   5. verification      — deploy_n8n.sh --status + telegram_webhook.sh info (read-only)
#
# Safety: uses the Docker-safe n8n_exec abstraction; NEVER removes the volume, NEVER --decrypted, NEVER deletes an
# existing backup, NEVER takes port 443. The bot token stays env-only (telegram_webhook.sh).
#
# Usage:
#   scripts/rollback.sh                       # DRY-RUN: print the exact rollback plan, change nothing
#   scripts/rollback.sh --apply               # perform steps 1-3 + 5; print the step-4 DB-restore instruction
#   scripts/rollback.sh --from-backup DIR     # use DIR (a pre-release backup) as the documented restore source
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/n8n_exec.sh
. "${ROOT}/scripts/lib/n8n_exec.sh"

DEPLOY="${ROOT}/scripts/deploy_n8n.sh"
WEBHOOK="${ROOT}/scripts/telegram_webhook.sh"
RUNTIME_IDS_LOCAL="${MS_RUNTIME_IDS_LOCAL:-${ROOT}/config/runtime_ids.local.json}"
BACKUP_ROOT="${MS_BACKUP_ROOT:-/root/backups}"

APPLY="no"; FROM_BACKUP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY="yes" ;;
    --from-backup) shift; FROM_BACKUP="${1:-}" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
hr() { printf -- '----------------------------------------------------------------------\n'; }

# Most recent pre-release backup (never the protected stage4 baseline unless explicitly chosen via --from-backup).
latest_backup() {
  [ -n "$FROM_BACKUP" ] && { printf '%s\n' "$FROM_BACKUP"; return; }
  ls -1dt "${BACKUP_ROOT}"/n8n-prerelease-* 2>/dev/null | head -1 || true
}
# Most recent runtime-id map backup (.bak.<ts>, written by runtime_ids.js before each change).
latest_id_map_backup() { ls -1t "${RUNTIME_IDS_LOCAL}".bak.* 2>/dev/null | head -1 || true; }

say "Release rollback ($([ "$APPLY" = yes ] && echo APPLY || echo DRY-RUN))"
hr
BK="$(latest_backup)"; IDBK="$(latest_id_map_backup)"
say "Plan:"
say "  1. Telegram webhook   : deleteWebhook (stop ingress)"
say "  2. publication state  : deploy_n8n.sh --deactivate-triggers (unpublish WF18 + any scheduled trigger)"
say "  3. runtime-id map     : restore from ${IDBK:-<no .bak found — map unchanged>}"
say "  4. previous workflows : pre-release backup ${BK:-<none found>} (DB restore is operator-gated; not auto-run)"
say "  5. verification       : deploy_n8n.sh --status + telegram_webhook.sh info"
hr

if [ "$APPLY" != "yes" ]; then
  say "ROLLBACK=DRYRUN (re-run with --apply to perform steps 1-3 + 5)."
  exit 0
fi

FAIL=0
# 1. delete the webhook first (idempotent; token env-only, never printed)
say ">> [1/5] deleting the Telegram webhook"
"$WEBHOOK" delete --apply >/dev/null 2>&1 || { say "  [warn] webhook delete failed or token unset (continuing)"; }

# 2. deactivate (unpublish) the trigger workflows via the Docker-safe deploy path
say ">> [2/5] unpublishing/deactivating the trigger workflow(s)"
"$DEPLOY" --deactivate-triggers --yes || { say "  [warn] deactivate-triggers reported a problem"; FAIL=1; }

# 3. restore the runtime-id map from its most recent backup (so the map matches pre-release reality)
if [ -n "$IDBK" ] && [ -f "$IDBK" ]; then
  say ">> [3/5] restoring runtime-id map from $(basename "$IDBK")"
  cp "$IDBK" "$RUNTIME_IDS_LOCAL" && chmod 600 "$RUNTIME_IDS_LOCAL" || { say "  [warn] id-map restore failed"; FAIL=1; }
else
  say ">> [3/5] no runtime-id map backup found — map left as-is (nothing to restore)"
fi

# 4. previous-workflow restore is the documented, operator-gated DB restore (never auto-replace the volume)
say ">> [4/5] previous-workflow restore (operator-gated; rollback.sh never replaces the data volume):"
if [ -n "$BK" ]; then
  say "     validate : scripts/restore_validate.sh --dir ${BK}"
  say "     restore  : (operator decision) stop n8n, restore ${BK}/n8n-data.tar.gz into the n8n data volume, restart"
else
  say "     [warn] no pre-release backup found under ${BACKUP_ROOT} — rely on the n8n DB / earlier backup"
fi

# 5. read-only verification
say ">> [5/5] verification"
"$DEPLOY" --status || true
"$WEBHOOK" info 2>/dev/null || say "  [info] webhook info needs MS_TELEGRAM_BOT_TOKEN (read-only)"

hr
if [ "$FAIL" -eq 0 ]; then say "ROLLBACK=APPLIED (steps 1-3 + 5 done; step 4 is the operator-gated DB restore above)"; else say "ROLLBACK=PARTIAL (see warnings above)"; exit 1; fi
