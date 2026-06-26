#!/usr/bin/env bash
# deploy_n8n.sh — controlled, inactive-by-default deployment of the Marketing Scout runtime workflows into a
# self-hosted n8n instance. The runtime SET, import ORDER, binding EDGES and activation POLICY all come from the
# single source of truth — config/workflow_manifest.json — read through tools/manifest_lib.js. No script hard-codes
# its own workflow list any more (QA-001/QA-009).
#
# Safe by design:
#   * DRY-RUN is the DEFAULT. It validates JSON, runs the runtime-config preflight (soft) and prints the exact
#     runtime closure + import order + binding plan + activation plan. ZERO mutations, never calls n8n.
#   * --apply imports the complete runtime closure INACTIVE, then automatically binds the eight Execute
#     Sub-workflow ids (no manual UI step) and verifies zero placeholders. It NEVER activates anything.
#   * Activation is a separate, explicit, operator-only step (--activate-triggers) gated on a fail-closed config
#     preflight (incl. zlib for XLSX-capable workflows). It NEVER activates a callable sub-workflow.
#
# Modes:
#   scripts/deploy_n8n.sh                      # dry-run (default): validate + preflight + print full plan
#   scripts/deploy_n8n.sh --dry-run            # same as above (explicit)
#   scripts/deploy_n8n.sh --check-config       # fail-closed runtime-config preflight only
#   scripts/deploy_n8n.sh --apply [--yes]      # import (inactive) + auto-bind + verify bindings; never activates
#   scripts/deploy_n8n.sh --verify-bindings    # export + check all 8 edges bound, zero placeholders
#   scripts/deploy_n8n.sh --plan-triggers      # print which trigger workflows WOULD activate (no changes)
#   scripts/deploy_n8n.sh --activate-triggers  # activate ONLY trigger workflows (WF18 always; WF23 if monitoring;
#                                              #   WF25 if weekly digest). Fail-closed config preflight first.
#   scripts/deploy_n8n.sh --deactivate-triggers# deactivate those same trigger workflows
#   scripts/deploy_n8n.sh --status             # show imported runtime workflows and their active state
#
# This script NEVER: overwrites credentials, pushes, calls any paid API, or activates a callable sub-workflow.
# Importing leaves every workflow inactive (active=false from the JSON is preserved). Only --activate-triggers
# flips the active flag, and only for the public/scheduled trigger workflows below.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF_DIR="${ROOT}/n8n/workflows"
MANIFEST_LIB="${ROOT}/tools/manifest_lib.js"
BIND_TOOL="${ROOT}/tools/bind_n8n_workflow_ids.js"
PREFLIGHT="${ROOT}/tools/preflight_config.js"
# DEPLOY-001: Docker-only-safe execution abstraction (host CLI OR `docker exec <container> …`; /bin/sh, not bash).
# shellcheck source=scripts/lib/n8n_exec.sh
. "${ROOT}/scripts/lib/n8n_exec.sh"
MODE="dry-run"
ASSUME_YES="no"
N8N_VERSION="unknown"

for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --check-config) MODE="check-config" ;;
    --apply) MODE="apply" ;;
    --verify-bindings) MODE="verify-bindings" ;;
    --plan-triggers) MODE="plan-triggers" ;;
    --activate-triggers) MODE="activate-triggers" ;;
    --deactivate-triggers) MODE="deactivate-triggers" ;;
    --status) MODE="status" ;;
    --yes|-y) ASSUME_YES="yes" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg (try --help)"; exit 2 ;;
  esac
done

# Only these TRIGGER workflows may ever be activated, and only on explicit --activate-triggers. Callable
# sub-workflows are never exposed via public triggers. WF23 only when monitoring is enabled; WF25 only when the
# weekly digest is enabled. These literal arrays are the bash-side activation set; they are cross-checked against
# the manifest activation policy below so the two can never silently diverge.
TRIGGER_WORKFLOWS_ALWAYS=( "18_telegram_agent_gateway.json" )
TRIGGER_WORKFLOWS_MONITORING=( "23_scheduled_source_monitor.json" )
TRIGGER_WORKFLOWS_WEEKLY_DIGEST=( "25_weekly_digest.json" )

say() { printf '%s\n' "$*"; }
hr() { printf -- '----------------------------------------------------------------------\n'; }
die() { say "ERROR: $*"; exit 1; }

# --- single source of truth: derive the runtime closure / import order / counts from the manifest ----------------
require_manifest() {
  command -v node >/dev/null 2>&1 || die "node is required to read the workflow manifest."
  [ -f "$MANIFEST_LIB" ] || die "missing ${MANIFEST_LIB}"
  node "$MANIFEST_LIB" runtime-count >/dev/null 2>&1 || die "workflow manifest is invalid — run: node tools/gen_workflow_manifest.js"
}

load_manifest_arrays() {
  require_manifest
  mapfile -t IMPORT_ORDER < <(node "$MANIFEST_LIB" import-order)
  mapfile -t CALLABLE_TARGETS < <(node "$MANIFEST_LIB" callable-targets)
  RUNTIME_COUNT="$(node "$MANIFEST_LIB" runtime-count)"
  BINDING_COUNT="$(node "$MANIFEST_LIB" binding-count)"
  N8N_EXPECTED_VERSION="$(node "$MANIFEST_LIB" n8n-version)"
  # Fail on any missing dependency in the closure.
  local missing=0
  for f in "${IMPORT_ORDER[@]}"; do [ -f "${WF_DIR}/${f}" ] || { say "  [ERROR] runtime workflow missing on disk: ${f}"; missing=1; }; done
  [ "$missing" -eq 0 ] || die "runtime closure is incomplete — aborting."
  [ "${#IMPORT_ORDER[@]}" -eq "$RUNTIME_COUNT" ] || die "import order (${#IMPORT_ORDER[@]}) != manifest runtime count (${RUNTIME_COUNT})."
}

# Cross-check the literal bash activation arrays against the manifest activation policy (no silent divergence).
assert_activation_consistency() {
  local mon="$1" wd="$2" expected actual flags=()
  [ "$mon" = "true" ] && flags+=( --monitoring )
  [ "$wd" = "true" ] && flags+=( --weekly-digest )
  expected="$(node "$MANIFEST_LIB" activation "${flags[@]}" | sort | tr '\n' ',')"
  local set=( "${TRIGGER_WORKFLOWS_ALWAYS[@]}" )
  [ "$mon" = "true" ] && set+=( "${TRIGGER_WORKFLOWS_MONITORING[@]}" )
  [ "$wd" = "true" ] && set+=( "${TRIGGER_WORKFLOWS_WEEKLY_DIGEST[@]}" )
  actual="$(printf '%s\n' "${set[@]}" | sort | tr '\n' ',')"
  [ "$expected" = "$actual" ] || die "activation set drift: manifest=[${expected}] script=[${actual}]"
}

# --- runtime config preflight (QA-006) --------------------------------------------------------------------------
check_config() {
  local soft="${1:-}" require_zlib="${2:-}"
  local flags=( --json )
  [ "$soft" = "soft" ] && flags+=( --soft )
  [ "$require_zlib" = "require-zlib" ] && flags+=( --require-zlib )
  command -v node >/dev/null 2>&1 || die "node is required for the config preflight."
  node "$PREFLIGHT" "${flags[@]}"
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
    [ -f "$path" ] || die "missing ${f}"
    node -e 'const w=require(process.argv[1]); if(w.active!==false){console.error("active!=false in "+process.argv[1]);process.exit(1)}' "$path"
    say "  [ok] ${f} active=false"
  done
}

print_plan() {
  hr; say "Runtime closure: ${RUNTIME_COUNT} workflows (single source of truth: config/workflow_manifest.json)"
  say "Import plan (deterministic order — config first, callable dependencies before orchestration, triggers last):"
  local i=1
  for f in "${IMPORT_ORDER[@]}"; do
    local path="${WF_DIR}/${f}"
    local name id nodes
    name="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "$path")"
    id="$(node -e 'process.stdout.write(String(require(process.argv[1]).id||"(assigned on import)"))' "$path")"
    nodes="$(node -e 'process.stdout.write(String((require(process.argv[1]).nodes||[]).length))' "$path")"
    printf '  %d. %-46s name="%s"  id=%s  nodes=%s  active=false\n' "$i" "$f" "$name" "$id" "$nodes"
    i=$((i+1))
  done
  hr
  say "Binding plan: ${BINDING_COUNT} Execute Sub-workflow edges are auto-bound after import (no manual UI step):"
  node "$MANIFEST_LIB" binding-edges | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      JSON.parse(d).forEach(e=>console.log("  "+e.caller_wf+" :: "+e.caller_node+"  ->  "+e.target_wf));
    });'
  hr
  say "Machine-readable plan:"
  say "RUNTIME_WORKFLOWS_EXPECTED=${RUNTIME_COUNT}"
  say "BINDING_EDGES_EXPECTED=${BINDING_COUNT}"
  say "CALLABLE_TARGETS_EXPECTED=$(node "$MANIFEST_LIB" callable-count)"
  say "N8N_VERSION=${N8N_EXPECTED_VERSION}"
  hr
}

require_n8n() {
  # DEPLOY-001: accept either a host CLI OR a reachable docker container (the production VPS is Docker-only).
  if ! n8n_available; then
    say "ERROR: no reachable n8n (no host CLI and no running container '$(n8n_resolve_container)')."
    say "Set MS_N8N_MODE=docker MS_N8N_CONTAINER=<name> for the Docker-only VPS, or run a disposable smoke:"
    say "    scripts/n8n_import_smoke.sh"
    return 1
  fi
  say "n8n execution mode: $(n8n_resolve_mode) (container=$(n8n_resolve_container) when docker)"
  return 0
}

detect_n8n_version() {
  local v; v="$(n8n_version_string)"
  N8N_VERSION="${v:-unknown}"
  say "n8n CLI detected: version ${N8N_VERSION} (repository is tested against ${N8N_EXPECTED_VERSION})"
  if [ "$N8N_VERSION" != "unknown" ] && [ "$N8N_VERSION" != "$N8N_EXPECTED_VERSION" ]; then
    say "  [warn] running n8n ${N8N_VERSION} differs from the tested ${N8N_EXPECTED_VERSION} (see docs/N8N_VERSION_PINNING.md)"
  fi
  # Proven 2.23.3 semantics (docs/n8n_2.23.3_cli_semantics.md / QA-012): publish:workflow & unpublish:workflow
  # exist; update:workflow is DEPRECATED but still accepts --active. We prefer the modern commands and fall back
  # to the deprecated flag only on an older CLI that lacks them.
}

# True if the running n8n CLI exposes a given subcommand (e.g. publish:workflow). Used to prefer modern commands.
n8n_has_command() { n8n_cli "$1" --help >/dev/null 2>&1; }

# Activate (publish) one workflow id by the proven 2.23.3 mechanism, with a deprecated fallback.
n8n_activate_id() {
  local id="$1"
  if n8n_has_command publish:workflow; then n8n publish:workflow --id="$id"
  else n8n_cli update:workflow --id="$id" --active=true; fi   # deprecated fallback (pre-publish CLI)
}
n8n_deactivate_id() {
  local id="$1"
  if n8n_has_command unpublish:workflow; then n8n unpublish:workflow --id="$id"
  else n8n_cli update:workflow --id="$id" --active=false; fi  # deprecated fallback (pre-publish CLI)
}

# Map a workflow JSON file -> the assigned workflow id after import, by EXACT name match in `n8n list:workflow`.
id_for_workflow_name() {
  local name="$1" listing="$2"
  # list:workflow prints lines like "<id>|<name>"; match the name column exactly (no substring).
  printf '%s\n' "$listing" | awk -F'|' -v n="$name" '$2==n {print $1; exit}'
}

# Export every workflow n8n knows about into $1 (separate files), so the binder can read assigned ids.
export_all() { local out="$1"; mkdir -p "$out"; n8n_cli export:workflow --all --separate --output="$out" >/dev/null 2>&1; }

do_import() {
  require_n8n || exit 1
  detect_n8n_version
  if [ "$ASSUME_YES" != "yes" ]; then
    printf 'Import %d runtime workflows into n8n (inactive)? [y/N] ' "${#IMPORT_ORDER[@]}"
    read -r reply
    case "$reply" in y|Y|yes|YES) ;; *) say "Aborted. No changes made."; exit 0 ;; esac
  fi
  for f in "${IMPORT_ORDER[@]}"; do
    say ">> importing ${f} (--activeState=false → lands INACTIVE regardless of JSON; credentials untouched)"
    n8n_cli import:workflow --input="${WF_DIR}/${f}" --activeState=false
  done
  hr
  # --- automatic binding (QA-002/QA-009): no manual UI step ----------------------------------------------------
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  say "Exporting assigned ids and auto-binding ${BINDING_COUNT} Execute Sub-workflow edges..."
  export_all "$tmp/exported"
  node "$BIND_TOOL" --dir "$tmp/exported" --report "$tmp/bind_report.json" || die "automatic binding failed (see report above)."
  # Re-import the rewritten caller workflows so the bound ids take effect (update by id; no duplicates).
  for f in "$tmp/exported"/*.json; do
    if grep -q '"type": "n8n-nodes-base.executeWorkflow"' "$f"; then
      n8n_cli import:workflow --input="$f" --activeState=false >/dev/null
    fi
  done
  say "Re-exporting to verify bindings..."
  rm -rf "$tmp/verify"; export_all "$tmp/verify"
  node "$BIND_TOOL" --dir "$tmp/verify" --verify || die "post-bind verification failed — placeholders remain."
  hr
  say "Capturing assigned workflow IDs (active=false for all):"
  local listing; listing="$(n8n_cli list:workflow 2>/dev/null || true)"
  for f in "${IMPORT_ORDER[@]}"; do
    local nm id; nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
    id="$(id_for_workflow_name "$nm" "$listing")"
    printf '  %-46s id=%s\n' "$f" "${id:-(not found)}"
  done
  hr
  say "Imported ${#IMPORT_ORDER[@]} runtime workflows. They are INACTIVE and the 8 sub-workflow ids are bound."
  say "Rollback: scripts/deploy_n8n.sh --deactivate-triggers  (then delete in the n8n UI if a full rollback is needed)."
  say "Next steps:"
  say "  1. In the n8n UI, attach credentials (Google Sheets / Telegram / Claude / Apify)."
  say "  2. Verify central config env vars: scripts/deploy_n8n.sh --check-config"
  say "  3. Activate triggers: scripts/deploy_n8n.sh --activate-triggers (WF18 always; WF23/WF25 if enabled)."
}

# Export current workflows and confirm every sub-workflow edge is bound (zero PASTE_WORKFLOW_ID placeholders).
verify_bindings() {
  require_n8n || exit 1
  detect_n8n_version
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  export_all "$tmp/exported"
  node "$BIND_TOOL" --dir "$tmp/exported" --verify
}

# Build the activation set from the literal arrays, gated by the feature flags, cross-checked against the manifest.
activation_set() {
  local mon="${MS_MONITORING_ENABLED:-false}" wd="${MS_WEEKLY_DIGEST_ENABLED:-false}"
  assert_activation_consistency "$mon" "$wd"
  local to_activate=( "${TRIGGER_WORKFLOWS_ALWAYS[@]}" )
  [ "$mon" = "true" ] && to_activate+=( "${TRIGGER_WORKFLOWS_MONITORING[@]}" )
  [ "$wd" = "true" ] && to_activate+=( "${TRIGGER_WORKFLOWS_WEEKLY_DIGEST[@]}" )
  printf '%s\n' "${to_activate[@]}"
}

plan_triggers() {
  load_manifest_arrays
  local mon="${MS_MONITORING_ENABLED:-false}" wd="${MS_WEEKLY_DIGEST_ENABLED:-false}"
  say "Trigger activation plan (MS_MONITORING_ENABLED=${mon}, MS_WEEKLY_DIGEST_ENABLED=${wd}):"
  say "  WF18 telegram gateway        : ALWAYS"
  say "  WF23 scheduled monitor       : $( [ "$mon" = "true" ] && echo "ON (monitoring enabled)" || echo "off (set MS_MONITORING_ENABLED=true)")"
  say "  WF25 weekly digest           : $( [ "$wd" = "true" ] && echo "ON (weekly digest enabled)" || echo "off (set MS_WEEKLY_DIGEST_ENABLED=true)")"
  say "Callable sub-workflows are NEVER activated by this command. Activation set:"
  activation_set | sed 's/^/  - /'
}

# Activate ONLY public/scheduled trigger workflows. Never activates a callable sub-workflow. Requires a fail-closed
# config preflight (incl. zlib for XLSX-capable workflows) and explicit confirmation (or --yes). Operator-only.
activate_triggers() {
  load_manifest_arrays
  say "Fail-closed config preflight before activation (zlib required for XLSX-capable workflows):"
  check_config "" "require-zlib" >/dev/null || die "config preflight failed — refusing to activate. Run: scripts/deploy_n8n.sh --check-config"
  say "  [ok] config preflight passed"
  # HARD WF18 gate: refuse to publish the Telegram gateway while known WF18/Telegram P0/P1 blockers are open.
  if printf '%s\n' "${TRIGGER_WORKFLOWS_ALWAYS[@]}" | grep -q '18_telegram_agent_gateway.json'; then
    say "WF18 pre-live blocker gate:"
    if ! node "${ROOT}/tools/wf18_activation_gate.js"; then
      die "WF18 is NOT cleared for activation (see open blockers above). The WF18 gateway rearchitecture is pending."
    fi
    say "  [ok] WF18 activation gate is open"
  fi
  require_n8n || exit 1
  detect_n8n_version
  local to_activate; mapfile -t to_activate < <(activation_set)
  say "Workflows to activate (publicly/scheduled-exposed only):"
  for f in "${to_activate[@]}"; do say "  - ${f}"; done
  say "Callable sub-workflows (WF04/08/10/12/16/26) are NEVER activated by this command."
  if [ "$ASSUME_YES" != "yes" ]; then
    printf 'Activate %d trigger workflow(s)? [y/N] ' "${#to_activate[@]}"
    read -r reply
    case "$reply" in y|Y|yes|YES) ;; *) say "Aborted. Nothing activated."; exit 0 ;; esac
  fi
  local listing; listing="$(n8n_cli list:workflow 2>/dev/null || true)"
  for f in "${to_activate[@]}"; do
    local nm id; nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
    id="$(id_for_workflow_name "$nm" "$listing")"
    if [ -z "$id" ]; then say "  [skip] ${f}: not found in n8n (import it first with --apply)"; continue; fi
    say ">> activating ${f} (id=${id}) via publish:workflow (proven 2.23.3; deprecated update:workflow fallback)"
    n8n_activate_id "$id"
  done
  hr
  say "Done. Only the trigger workflow(s) above are active; every callable/internal workflow remains inactive."
  say "Rollback: scripts/deploy_n8n.sh --deactivate-triggers"
}

# Deactivate the same trigger workflows (rollback of activation). Never touches callables (already inactive).
deactivate_triggers() {
  load_manifest_arrays
  require_n8n || exit 1
  detect_n8n_version
  local to_deactivate; mapfile -t to_deactivate < <(activation_set)
  say "Workflows to deactivate:"
  for f in "${to_deactivate[@]}"; do say "  - ${f}"; done
  if [ "$ASSUME_YES" != "yes" ]; then
    printf 'Deactivate %d trigger workflow(s)? [y/N] ' "${#to_deactivate[@]}"
    read -r reply
    case "$reply" in y|Y|yes|YES) ;; *) say "Aborted. Nothing changed."; exit 0 ;; esac
  fi
  local listing; listing="$(n8n_cli list:workflow 2>/dev/null || true)"
  for f in "${to_deactivate[@]}"; do
    local nm id; nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
    id="$(id_for_workflow_name "$nm" "$listing")"
    [ -z "$id" ] && { say "  [skip] ${f}: not found"; continue; }
    say ">> deactivating ${f} (id=${id}) via unpublish:workflow (proven 2.23.3; deprecated update:workflow fallback)"
    n8n_deactivate_id "$id"
  done
  hr; say "Done. All listed trigger workflows are now inactive."
}

show_status() {
  load_manifest_arrays
  require_n8n || exit 1
  detect_n8n_version
  local listing; listing="$(n8n_cli list:workflow 2>/dev/null || true)"
  hr; say "Runtime workflow status (active flag from n8n):"
  for f in "${IMPORT_ORDER[@]}"; do
    local nm id; nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
    id="$(id_for_workflow_name "$nm" "$listing")"
    printf '  %-46s id=%s\n' "$f" "${id:-(not imported)}"
  done
  hr
}

say "Marketing Scout — n8n deploy (mode: ${MODE})"
hr
case "$MODE" in
  check-config)
    check_config || die "config preflight failed — fix the [missing]/[invalid] values above."
    ;;
  dry-run)
    load_manifest_arrays
    check_config soft || true
    validate_json
    print_plan
    say "DRY-RUN complete. No changes made. Re-run with --apply to import + auto-bind (workflows stay inactive)."
    ;;
  apply)
    load_manifest_arrays
    check_config || die "config preflight failed — refusing to --apply."
    validate_json
    print_plan
    do_import
    ;;
  verify-bindings)
    load_manifest_arrays
    verify_bindings
    ;;
  plan-triggers)
    plan_triggers
    ;;
  activate-triggers)
    load_manifest_arrays
    validate_json
    activate_triggers
    ;;
  deactivate-triggers)
    deactivate_triggers
    ;;
  status)
    show_status
    ;;
esac
