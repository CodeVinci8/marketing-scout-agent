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
#   scripts/deploy_n8n.sh                      # dry-run (default): PRODUCTION discovery + id resolution + reconcile
#                                              #   plan + fail-closed preflight + full import/bind plan (no changes)
#   scripts/deploy_n8n.sh --dry-run            # same as above (explicit, production target — fail-closed)
#   scripts/deploy_n8n.sh --offline-plan       # OFFLINE planning only (soft; never claims production readiness)
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
# Release-core integration (RELEASE-005 / DEPLOY-002/003/004/007): the deploy path now consumes the previously
# disconnected release-core tools — installation-local id resolver, env discovery, and the ordered fail-closed
# release planner — instead of importing raw JSON with "(assigned on import)" ids and first-match name selection.
RUNTIME_IDS_TOOL="${ROOT}/tools/runtime_ids.js"
ENV_DISCOVERY="${ROOT}/tools/env_discovery.js"
RELEASE_PLAN="${ROOT}/tools/release_plan.js"
RUNTIME_IDS_LOCAL="${MS_RUNTIME_IDS_LOCAL:-${ROOT}/config/runtime_ids.local.json}"
# DEPLOY-001: Docker-only-safe execution abstraction (host CLI OR `docker exec <container> …`; /bin/sh, not bash).
# shellcheck source=scripts/lib/n8n_exec.sh
. "${ROOT}/scripts/lib/n8n_exec.sh"
MODE="dry-run"
ASSUME_YES="no"
N8N_VERSION="unknown"
# Release target for the planner: production (fail-closed; default for dry-run/apply) vs offline (explicit,
# soft planning only — DEPLOY-004: an offline plan must never claim production readiness).
RELEASE_TARGET="production"

for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --offline-plan) MODE="dry-run"; RELEASE_TARGET="offline" ;;
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

# --- release-core integration: live discovery + ordered fail-closed planning ------------------------------------
# Capture the current production/disposable n8n export into $1 so the id resolver + reconciler can run against
# REALITY (exact-name matching, installation-local id discovery). Empty/absent export => $1 stays empty.
EXPORT_PROVIDED="no"
capture_export() {
  local out="$1"; mkdir -p "$out"
  if n8n_available; then
    if n8n_cli export:workflow --all --separate --output="$out" >/dev/null 2>&1 && ls "$out"/*.json >/dev/null 2>&1; then
      EXPORT_PROVIDED="yes"; return 0
    fi
  fi
  EXPORT_PROVIDED="no"; return 0
}

# Run the ORDERED, fail-closed release planner (tools/release_plan.js) against the captured export + discovered
# env + detected version. Production target fails closed; offline target is soft. Echoes the sanitized plan.
run_release_plan() {
  local mode="$1" export_dir="$2" extra=()
  [ "$RELEASE_TARGET" = "offline" ] && extra+=( --target offline ) || extra+=( --target production )
  [ -n "$export_dir" ] && [ "$EXPORT_PROVIDED" = "yes" ] && extra+=( --export-dir "$export_dir" )
  command -v node >/dev/null 2>&1 || die "node is required for the release planner."
  node "$RELEASE_PLAN" --mode "$mode" --n8n-version "$N8N_VERSION" --image "${MS_N8N_IMAGE:-n8nio/n8n:2.23.3}" \
    --local "$RUNTIME_IDS_LOCAL" "${extra[@]}"
}

# Sanitized environment discovery (NEVER prints secret values; SET/MISSING + fingerprints only).
discover_environment() {
  command -v node >/dev/null 2>&1 || return 0
  say "Configuration discovery (effective env; secret values never shown):"
  node "$ENV_DISCOVERY" --source "${MS_ENV_SOURCE:-auto}" 2>/dev/null | sed 's/^/  /' || true
}

# Load installation-local workflow-id FINGERPRINTS (fp_<sha10>) keyed by workflow FILE, so the plan prints a
# stable fingerprint instead of the forbidden "(assigned on import)" placeholder and never a raw id (DEPLOY-003).
declare -A ID_FP
load_runtime_id_fingerprints() {
  local line file fp
  while IFS=$'\t' read -r file fp; do [ -n "$file" ] && ID_FP["$file"]="$fp"; done < <(
    node -e '
      const L=require(process.argv[1]); const RID=require(process.argv[2]);
      const id=L.runtimeIdentity(); let map={workflows:{}};
      try{ map=RID.loadLocalMap(process.argv[3]); }catch(e){ void e; }
      for(const k of Object.keys(id)){ const e=(map.workflows||{})[k]; process.stdout.write(id[k].file+"\t"+(e&&e.id?RID.fingerprint(e.id):"unresolved")+"\n"); }
    ' "$MANIFEST_LIB" "$RUNTIME_IDS_TOOL" "$RUNTIME_IDS_LOCAL" 2>/dev/null || true
  )
}

# Fingerprint a raw id for SAFE logging (DEPLOY-003): logs show fp_<sha10>, never the raw installation id.
id_fingerprint() { node -e 'process.stdout.write(require(process.argv[1]).fingerprint(process.argv[2]))' "$RUNTIME_IDS_TOOL" "$1" 2>/dev/null || printf 'fp_err'; }

# Strict exact-name workflow-id resolution (DEPLOY-002): NEVER select the first of several matches.
#   RESOLVE_STATUS=ok|absent|ambiguous ; on ok, echoes the unique id.
RESOLVE_STATUS=""
resolve_exact_name() {
  local name="$1" listing="$2" count
  count="$(printf '%s\n' "$listing" | awk -F'|' -v n="$name" '$2==n{c++} END{print c+0}')"
  if [ "${count:-0}" -eq 1 ]; then
    RESOLVE_STATUS="ok"; printf '%s' "$(printf '%s\n' "$listing" | awk -F'|' -v n="$name" '$2==n{print $1; exit}')"
  elif [ "${count:-0}" -eq 0 ]; then
    RESOLVE_STATUS="absent"; printf ''
  else
    RESOLVE_STATUS="ambiguous"; printf ''
  fi
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
  load_runtime_id_fingerprints
  hr; say "Runtime closure: ${RUNTIME_COUNT} workflows (single source of truth: config/workflow_manifest.json)"
  say "Import plan (deterministic order — config first, callable dependencies before orchestration, triggers last):"
  say "  (ids are installation-local; logs show a FINGERPRINT only — raw ids live in config/runtime_ids.local.json)"
  local i=1
  for f in "${IMPORT_ORDER[@]}"; do
    local path="${WF_DIR}/${f}"
    local name idfp nodes
    name="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "$path")"
    idfp="${ID_FP[$f]:-unresolved}"
    nodes="$(node -e 'process.stdout.write(String((require(process.argv[1]).nodes||[]).length))' "$path")"
    printf '  %d. %-46s name="%s"  id_fp=%s  nodes=%s  active=false\n' "$i" "$f" "$name" "$idfp" "$nodes"
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
  say "Capturing assigned workflow IDs (active=false for all; fingerprints only — never raw ids):"
  local listing; listing="$(n8n_cli list:workflow 2>/dev/null || true)"
  for f in "${IMPORT_ORDER[@]}"; do
    local nm id; nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
    id="$(resolve_exact_name "$nm" "$listing")"
    case "$RESOLVE_STATUS" in
      ok) printf '  %-46s id_fp=%s\n' "$f" "$(id_fingerprint "$id")" ;;
      ambiguous) die "ambiguous exact workflow name in n8n for ${f} (\"${nm}\") — refusing (DEPLOY-002)." ;;
      *) printf '  %-46s id_fp=%s\n' "$f" "(not found)" ;;
    esac
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
    id="$(resolve_exact_name "$nm" "$listing")"
    case "$RESOLVE_STATUS" in
      ambiguous) die "ambiguous exact workflow name for ${f} (\"${nm}\") in n8n — refusing to activate (DEPLOY-002)." ;;
      absent) say "  [skip] ${f}: not found in n8n (import it first with --apply)"; continue ;;
    esac
    say ">> activating ${f} (id_fp=$(id_fingerprint "$id")) via publish:workflow (proven 2.23.3; deprecated update:workflow fallback)"
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
    id="$(resolve_exact_name "$nm" "$listing")"
    case "$RESOLVE_STATUS" in
      ambiguous) die "ambiguous exact workflow name for ${f} (\"${nm}\") in n8n — refusing to deactivate (DEPLOY-002)." ;;
      absent) say "  [skip] ${f}: not found"; continue ;;
    esac
    say ">> deactivating ${f} (id_fp=$(id_fingerprint "$id")) via unpublish:workflow (proven 2.23.3; deprecated update:workflow fallback)"
    n8n_deactivate_id "$id"
  done
  hr; say "Done. All listed trigger workflows are now inactive."
}

show_status() {
  load_manifest_arrays
  require_n8n || exit 1
  detect_n8n_version
  local listing; listing="$(n8n_cli list:workflow 2>/dev/null || true)"
  hr; say "Runtime workflow status (active flag from n8n; fingerprints only — never raw ids):"
  for f in "${IMPORT_ORDER[@]}"; do
    local nm id; nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
    id="$(resolve_exact_name "$nm" "$listing")"
    case "$RESOLVE_STATUS" in
      ok) printf '  %-46s id_fp=%s  exact_name_count=1\n' "$f" "$(id_fingerprint "$id")" ;;
      ambiguous) printf '  %-46s id_fp=%s  exact_name_count>1 (AMBIGUOUS — fix before deploy)\n' "$f" "(ambiguous)" ;;
      *) printf '  %-46s id_fp=%s\n' "$f" "(not imported)" ;;
    esac
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
    validate_json
    discover_environment
    # Capture a live export (production target) so id resolution + reconciliation run against reality.
    PLAN_EXPORT=""
    if [ "$RELEASE_TARGET" = "production" ]; then
      if n8n_available; then detect_n8n_version; PLAN_EXPORT="$(mktemp -d)"; trap 'rm -rf "$PLAN_EXPORT"' EXIT; capture_export "$PLAN_EXPORT"; fi
    fi
    print_plan
    hr; say "Ordered fail-closed release plan (target=${RELEASE_TARGET}):"
    if run_release_plan dry-run "$PLAN_EXPORT"; then
      if [ "$RELEASE_TARGET" = "offline" ]; then
        say "OFFLINE-PLAN complete (SOFT). This is a planning rehearsal only and does NOT assert production readiness."
        say "Run a real production dry-run on the VPS: MS_N8N_MODE=docker MS_N8N_CONTAINER=n8n-n8n-1 scripts/deploy_n8n.sh --dry-run"
      else
        say "DRY-RUN complete (PRODUCTION target, fail-closed). No changes made. Re-run with --apply to stage+import+bind (inactive)."
      fi
    else
      # DEPLOY-004: a production-target dry-run MUST fail closed when ids/env/export are unresolved.
      if [ "$RELEASE_TARGET" = "production" ]; then
        die "production-target dry-run FAILED CLOSED (see ABORT_REASON above). For an offline rehearsal use: scripts/deploy_n8n.sh --offline-plan"
      else
        die "offline plan reported an abort (see above)."
      fi
    fi
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
