#!/usr/bin/env bash
# deploy_n8n.sh — controlled, inactive-by-default import of the Marketing Scout workflows into a
# self-hosted n8n instance. Safe by design:
#   * DRY-RUN is the DEFAULT. It validates the JSON, checks required runtime config and prints the
#     exact import order + workflow names/ids. It performs ZERO mutations and never calls n8n.
#   * Real import only runs with --apply, uses `n8n import:workflow` (which preserves "active": false
#     from each JSON, so nothing is activated) and NEVER touches credentials.
#
# Usage:
#   scripts/deploy_n8n.sh                 # dry-run (default): validate + print plan, no changes
#   scripts/deploy_n8n.sh --dry-run       # same as above (explicit)
#   scripts/deploy_n8n.sh --check-config  # only verify required env vars are present
#   scripts/deploy_n8n.sh --apply         # actually import (still inactive); asks for confirmation
#   scripts/deploy_n8n.sh --apply --yes   # import without the interactive confirmation
#
# This script does NOT: activate workflows, overwrite credentials, push, or call any paid API.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF_DIR="${ROOT}/n8n/workflows"
MODE="dry-run"
ASSUME_YES="no"

for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --check-config) MODE="check-config" ;;
    --apply) MODE="apply" ;;
    --yes|-y) ASSUME_YES="yes" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg (try --help)"; exit 2 ;;
  esac
done

# Deterministic import order. WF17 (config) first so the rest can resolve central config; gateway and
# planner next; orchestrator last (it calls the Stage 1-3 collection/analysis/report workflows).
IMPORT_ORDER=(
  "17_agent_settings_config.json"
  "18_telegram_agent_gateway.json"
  "19_request_planner.json"
  "20_agent_orchestrator.json"
  "22_conversation_control.json"
)

# Required NON-secret runtime config (credentials stay in the n8n credential store, not here).
REQUIRED_ENV=(
  "MS_SPREADSHEET_ID"
  "MS_TELEGRAM_ALLOWED_USER_IDS"
)
OPTIONAL_ENV=(
  "MS_SOURCE_ALLOWLIST" "MS_MAX_ITEMS_PER_SOURCE" "MS_MAX_EXTERNAL_CALLS"
  "MS_SOURCE_BUDGET_USD" "MS_LLM_BUDGET_USD" "MS_REQUIRE_APPROVAL"
  "MS_ENABLE_LLM_PLANNER" "MS_ENABLE_LLM_SUMMARY" "MS_DEFAULT_REGION" "MS_DEFAULT_NICHE"
)

say() { printf '%s\n' "$*"; }
hr() { printf -- '----------------------------------------------------------------------\n'; }

check_config() {
  local missing=0
  say "Required runtime config (non-secret; from environment or n8n env):"
  for v in "${REQUIRED_ENV[@]}"; do
    if [ -n "${!v:-}" ]; then say "  [ok]      ${v} is set"; else say "  [MISSING] ${v}"; missing=1; fi
  done
  say "Optional config (falls back to fail-closed defaults in n8n/lib/agent_config.js):"
  for v in "${OPTIONAL_ENV[@]}"; do
    if [ -n "${!v:-}" ]; then say "  [set]     ${v}=${!v}"; else say "  [default] ${v}"; fi
  done
  if [ "$missing" -ne 0 ]; then
    hr; say "Config incomplete: set the [MISSING] vars before --apply. (Dry-run still allowed.)"
    return 1
  fi
  return 0
}

validate_json() {
  say "Validating workflow JSON (offline; no secrets, active=false enforced)..."
  if command -v python3 >/dev/null 2>&1; then
    python3 "${ROOT}/scripts/validate_workflows.py" >/dev/null
    say "  [ok] validate_workflows.py passed"
  else
    say "  [warn] python3 not found — skipping schema validator"
  fi
  # Independent guard: every workflow we import MUST be inactive.
  for f in "${IMPORT_ORDER[@]}"; do
    local path="${WF_DIR}/${f}"
    [ -f "$path" ] || { say "  [ERROR] missing ${f}"; return 1; }
    node -e 'const w=require(process.argv[1]); if(w.active!==false){console.error("active!=false in "+process.argv[1]);process.exit(1)}' "$path"
    say "  [ok] ${f} active=false"
  done
}

print_plan() {
  hr; say "Import plan (order matters — config first, orchestrator last):"
  local i=1
  for f in "${IMPORT_ORDER[@]}"; do
    local path="${WF_DIR}/${f}"
    local name id nodes
    name="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "$path")"
    id="$(node -e 'process.stdout.write(String(require(process.argv[1]).id||"(assigned on import)"))' "$path")"
    nodes="$(node -e 'process.stdout.write(String((require(process.argv[1]).nodes||[]).length))' "$path")"
    printf '  %d. %-34s name="%s"  id=%s  nodes=%s  active=false\n' "$i" "$f" "$name" "$id" "$nodes"
    i=$((i+1))
  done
  hr
}

do_import() {
  if ! command -v n8n >/dev/null 2>&1; then
    say "ERROR: n8n CLI not found on PATH. Install/enter the n8n environment, then re-run with --apply."
    exit 1
  fi
  if [ "$ASSUME_YES" != "yes" ]; then
    printf 'Import %d workflows into n8n (inactive)? [y/N] ' "${#IMPORT_ORDER[@]}"
    read -r reply
    case "$reply" in y|Y|yes|YES) ;; *) say "Aborted. No changes made."; exit 0 ;; esac
  fi
  for f in "${IMPORT_ORDER[@]}"; do
    say ">> importing ${f} (active stays false; credentials untouched)"
    n8n import:workflow --input="${WF_DIR}/${f}"
  done
  hr
  say "Imported ${#IMPORT_ORDER[@]} workflows. They are INACTIVE. Next steps:"
  say "  1. In the n8n UI, attach credentials (Google Sheets / Telegram / Claude / Apify)."
  say "  2. Verify central config env vars (see --check-config)."
  say "  3. Activate ONLY 18_telegram_agent_gateway when you are ready to accept live requests."
}

say "Marketing Scout — n8n deploy (mode: ${MODE})"
hr
case "$MODE" in
  check-config) check_config ;;
  dry-run)
    check_config || say "(dry-run continues despite incomplete config)"
    validate_json
    print_plan
    say "DRY-RUN complete. No changes made. Re-run with --apply to import (workflows stay inactive)."
    ;;
  apply)
    check_config
    validate_json
    print_plan
    do_import
    ;;
esac
