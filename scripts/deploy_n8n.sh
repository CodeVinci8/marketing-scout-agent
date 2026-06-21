#!/usr/bin/env bash
# deploy_n8n.sh — controlled, inactive-by-default import of the Marketing Scout workflows into a
# self-hosted n8n instance. Safe by design:
#   * DRY-RUN is the DEFAULT. It validates the JSON, checks required runtime config and prints the
#     exact import order + workflow names/ids. It performs ZERO mutations and never calls n8n.
#   * Real import only runs with --apply, uses `n8n import:workflow` (which preserves "active": false
#     from each JSON, so nothing is activated) and NEVER touches credentials.
#
# Usage:
#   scripts/deploy_n8n.sh                      # dry-run (default): validate + print plan, no changes
#   scripts/deploy_n8n.sh --dry-run            # same as above (explicit)
#   scripts/deploy_n8n.sh --check-config       # only verify required env vars are present
#   scripts/deploy_n8n.sh --apply              # actually import (still inactive); asks for confirmation
#   scripts/deploy_n8n.sh --apply --yes        # import without the interactive confirmation
#   scripts/deploy_n8n.sh --activate-triggers  # activate ONLY trigger workflows (WF18 always; WF23 when
#                                              #   MS_MONITORING_ENABLED=true). Asks for confirmation; --yes skips it.
#
# This script NEVER: overwrites credentials, pushes, calls any paid API, or activates a callable sub-workflow.
# Importing leaves every workflow inactive (active=false from the JSON is preserved). Only --activate-triggers
# flips the active flag, and only for the public/scheduled trigger workflows below.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF_DIR="${ROOT}/n8n/workflows"
MODE="dry-run"
ASSUME_YES="no"
N8N_VERSION="unknown"

for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --check-config) MODE="check-config" ;;
    --apply) MODE="apply" ;;
    --activate-triggers) MODE="activate-triggers" ;;
    --yes|-y) ASSUME_YES="yes" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg (try --help)"; exit 2 ;;
  esac
done

# Only these TRIGGER workflows may ever be activated, and only on explicit --activate-triggers. Callable
# sub-workflows are never exposed via public triggers. WF23 is activated only when monitoring is enabled.
TRIGGER_WORKFLOWS_ALWAYS=( "18_telegram_agent_gateway.json" )
TRIGGER_WORKFLOWS_MONITORING=( "23_scheduled_source_monitor.json" )

# Deterministic import order. WF17 (config) first so the rest can resolve central config; gateway and
# planner next; orchestrator last (it calls the Stage 1-3 collection/analysis/report workflows).
IMPORT_ORDER=(
  "17_agent_settings_config.json"
  "18_telegram_agent_gateway.json"
  "19_request_planner.json"
  "20_agent_orchestrator.json"
  "21_deep_competitor_analysis.json"
  "22_conversation_control.json"
  "23_scheduled_source_monitor.json"
  "24_report_export_delivery.json"
  "25_weekly_digest.json"
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

require_n8n() {
  if ! command -v n8n >/dev/null 2>&1; then
    say "ERROR: n8n CLI not found on PATH. This step needs a real n8n environment."
    say "Run a fully disposable smoke import instead (throwaway DB, nothing activated):"
    say "    scripts/n8n_import_smoke.sh"
    return 1
  fi
  return 0
}

detect_n8n_version() {
  local v; v="$(n8n --version 2>/dev/null | head -1)"
  say "n8n CLI detected: version ${v:-unknown}"
  # The OSS n8n CLI exposes a single activate flag (active=true) via `update:workflow`; there is no separate
  # "publish" step. If a future/edition build distinguishes the two, activation is still the public-exposure
  # switch we want; this script only ever sets active=true for the trigger workflows below and prints what it did.
  N8N_VERSION="${v:-unknown}"
}

# Map a workflow JSON file -> the assigned workflow id after import, by matching its name in `n8n list:workflow`.
id_for_workflow_name() {
  local name="$1" listing="$2"
  # list:workflow prints lines like "<id>|<name>"
  printf '%s\n' "$listing" | awk -F'|' -v n="$name" '$0 ~ n {print $1; exit}'
}

do_import() {
  require_n8n || exit 1
  detect_n8n_version
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
  say "Capturing assigned workflow IDs (active=false for all):"
  local listing; listing="$(n8n list:workflow 2>/dev/null || true)"
  for f in "${IMPORT_ORDER[@]}"; do
    local nm id; nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
    id="$(id_for_workflow_name "$nm" "$listing")"
    printf '  %-34s id=%s\n' "$f" "${id:-(not found)}"
  done
  hr
  say "Post-import note: each Execute Sub-workflow node carries workflowId.value=PASTE_WORKFLOW_ID. Bind each one to"
  say "the assigned callable id above (WF04/08/10/12/16) in the n8n UI, then re-export. Callables stay INACTIVE and"
  say "are reachable only via Execute Sub-workflow (they now carry an Execute Sub-workflow Trigger), never publicly."
  say "Imported ${#IMPORT_ORDER[@]} workflows. They are INACTIVE. Next steps:"
  say "  1. In the n8n UI, attach credentials (Google Sheets / Telegram / Claude / Apify)."
  say "  2. Verify central config env vars (see --check-config)."
  say "  3. Run 'scripts/deploy_n8n.sh --activate-triggers' to activate ONLY WF18 (and WF23 if monitoring)."
}

# Activate ONLY public/scheduled trigger workflows. Never activates a callable sub-workflow. WF18 is always a
# candidate; WF23 only when MS_MONITORING_ENABLED=true. Requires explicit confirmation (or --yes). Never run
# automatically — operator-invoked only.
activate_triggers() {
  require_n8n || exit 1
  detect_n8n_version
  local to_activate=( "${TRIGGER_WORKFLOWS_ALWAYS[@]}" )
  if [ "${MS_MONITORING_ENABLED:-false}" = "true" ]; then
    to_activate+=( "${TRIGGER_WORKFLOWS_MONITORING[@]}" )
    say "MS_MONITORING_ENABLED=true -> WF23 scheduled monitor is included."
  else
    say "MS_MONITORING_ENABLED is not 'true' -> WF23 scheduled monitor will NOT be activated."
  fi
  say "Workflows to activate (publicly/scheduled-exposed only):"
  for f in "${to_activate[@]}"; do say "  - ${f}"; done
  say "Callable sub-workflows (WF04/08/10/12/16, WF19/20/21/22) are NEVER activated by this command."
  if [ "$ASSUME_YES" != "yes" ]; then
    printf 'Activate %d trigger workflow(s)? [y/N] ' "${#to_activate[@]}"
    read -r reply
    case "$reply" in y|Y|yes|YES) ;; *) say "Aborted. Nothing activated."; exit 0 ;; esac
  fi
  local listing; listing="$(n8n list:workflow 2>/dev/null || true)"
  for f in "${to_activate[@]}"; do
    local nm id; nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
    id="$(id_for_workflow_name "$nm" "$listing")"
    if [ -z "$id" ]; then say "  [skip] ${f}: not found in n8n (import it first with --apply)"; continue; fi
    say ">> activating ${f} (id=${id}) via 'n8n update:workflow --active=true'"
    n8n update:workflow --id="$id" --active=true
  done
  hr
  say "Done. Only the trigger workflow(s) above are active; every callable/internal workflow remains inactive."
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
  activate-triggers)
    validate_json
    activate_triggers
    ;;
esac
