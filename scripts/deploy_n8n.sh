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
#   scripts/deploy_n8n.sh --activate-telegram  # TRANSACTIONAL: activate WF18 ONLY (never WF23/WF25) + register &
#                                              #   verify webhook; auto-unpublish WF18 if the webhook step fails.
#   scripts/deploy_n8n.sh --deactivate-triggers# deactivate those same trigger workflows
#   scripts/deploy_n8n.sh --status             # classify the live workflow listing vs the manifest (read-only)
#   scripts/deploy_n8n.sh --discover           # LIVE read-only production discovery (inventory + env + id coverage)
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
STAGE_TOOL="${ROOT}/tools/prepare_staged_workflows.js"
RECONCILE_CREDS="${ROOT}/tools/reconcile_credentials.js"
RECONCILE_WF="${ROOT}/tools/reconcile_workflows.js"
INVENTORY_TOOL="${ROOT}/tools/workflow_inventory.js"
RUNTIME_IDS_LOCAL="${MS_RUNTIME_IDS_LOCAL:-${ROOT}/config/runtime_ids.local.json}"
# DEPLOY-001: Docker-only-safe execution abstraction (host CLI OR `docker exec <container> …`; /bin/sh, not bash).
# shellcheck source=scripts/lib/n8n_exec.sh
. "${ROOT}/scripts/lib/n8n_exec.sh"
# RELEASE-004/003/§9: shared release lock + backup + sanitized evidence + rollback layer (one implementation,
# used by both this production path and the disposable acceptance).
RP_ROOT="${ROOT}"
# shellcheck source=scripts/lib/release_pipeline.sh
. "${ROOT}/scripts/lib/release_pipeline.sh"
MODE="dry-run"
ASSUME_YES="no"
N8N_VERSION="unknown"
# ENTRYPOINT-001: the manifest-derived expected version is shared context used by detect_n8n_version (in the
# "tested against …" log) BEFORE some standalone modes call load_manifest_arrays. Declare it bound up-front so the
# strict shell (`set -u`) never crashes on an uninitialized read, and let ensure_expected_version() populate it
# lazily/idempotently. (Was: credential-audit / verify-production read it unbound and died — BLOCKER A.)
N8N_EXPECTED_VERSION=""
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
    --activate-telegram) MODE="activate-telegram" ;;
    --deactivate-triggers) MODE="deactivate-triggers" ;;
    --status) MODE="status" ;;
    --credential-audit) MODE="credential-audit" ;;
    --verify-production) MODE="verify-production" ;;
    --discover) MODE="discover" ;;
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

# ENTRYPOINT-001: idempotently load JUST the manifest-derived expected n8n version. detect_n8n_version() can run
# in standalone modes (credential-audit, verify-production, verify-bindings) BEFORE the full load_manifest_arrays,
# so it must guarantee this one shared value itself. Cheap, safe under `set -u`, never re-derives if already set.
ensure_expected_version() {
  [ -n "${N8N_EXPECTED_VERSION:-}" ] && return 0
  require_manifest
  N8N_EXPECTED_VERSION="$(node "$MANIFEST_LIB" n8n-version)"
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
  # CHECKCONFIG-001: always evaluate the EFFECTIVE environment (container > file > process) via env_discovery,
  # the same path the dry-run uses — never just the current shell. Degrades to process.env when no container/file.
  local flags=( --json --discover )
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
  EXPORT_PROVIDED="no"
  n8n_available || return 0
  # RELEASE-006: a docker-mode `n8n export:workflow --output=<dir>` writes INSIDE the container — the host dir
  # stays empty. The previous code checked the host dir and so ALWAYS captured nothing in docker mode, which made
  # the production dry-run abort at export_existing. Route through export_all (which copies the export OUT of the
  # container via n8n_get, host mode = plain cp), then VERIFY the host copy is non-empty AND parseable.
  export_all "$out" || return 0
  if ls "$out"/*.json >/dev/null 2>&1 && node -e '
      const fs=require("fs"),path=require("path"),d=process.argv[1];
      const files=fs.readdirSync(d).filter(f=>f.endsWith(".json"));
      if(!files.length) process.exit(1);
      for(const f of files){ JSON.parse(fs.readFileSync(path.join(d,f),"utf8")); }
    ' "$out" 2>/dev/null; then
    EXPORT_PROVIDED="yes"
  fi
  return 0
}

# Run the ORDERED, fail-closed release planner (tools/release_plan.js) against the captured export + discovered
# env + detected version. Production target fails closed; offline target is soft. Echoes the sanitized plan.
run_release_plan() {
  local mode="$1" export_dir="$2" cred_export="${3:-}" staged_dir="${4:-}" extra=()
  [ "$RELEASE_TARGET" = "offline" ] && extra+=( --target offline ) || extra+=( --target production )
  [ -n "$export_dir" ] && [ "$EXPORT_PROVIDED" = "yes" ] && extra+=( --export-dir "$export_dir" )
  # BLOCKER B: hand the planner the LIVE non-decrypted credential export + the STAGED workflow set so its
  # reconcile_credentials step reconciles the EXACT references that would be imported — never a hard-coded null.
  [ -n "$cred_export" ] && [ -f "$cred_export" ] && extra+=( --cred-export "$cred_export" )
  [ -n "$staged_dir" ] && [ -d "$staged_dir" ] && extra+=( --staged-dir "$staged_dir" )
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
# STATUS-001: this function is ALWAYS called inside a $() command substitution (a subshell), so any global it
# sets is LOST when the subshell exits — that bug made every caller read a stale empty RESOLVE_STATUS and report
# imported workflows as "(not imported)" and silently defeated the ambiguous/absent safety guards. The fix:
# PRINT the verdict ("<status>\t<id>"; status=ok|absent|ambiguous, id only when ok) and let resolve_into populate
# the globals in the CURRENT shell.
resolve_exact_name() {
  local name="$1" listing="$2" count
  count="$(printf '%s\n' "$listing" | awk -F'|' -v n="$name" '$2==n{c++} END{print c+0}')"
  if [ "${count:-0}" -eq 1 ]; then
    printf 'ok\t%s' "$(printf '%s\n' "$listing" | awk -F'|' -v n="$name" '$2==n{print $1; exit}')"
  elif [ "${count:-0}" -eq 0 ]; then
    printf 'absent\t'
  else
    printf 'ambiguous\t'
  fi
}

# Populate RESOLVE_STATUS + RESOLVE_ID in the CURRENT shell from resolve_exact_name's printed verdict (STATUS-001).
RESOLVE_STATUS=""
RESOLVE_ID=""
resolve_into() {
  local res; res="$(resolve_exact_name "$1" "$2")"
  RESOLVE_STATUS="${res%%$'\t'*}"
  RESOLVE_ID="${res#*$'\t'}"
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
  ensure_expected_version   # ENTRYPOINT-001: guarantee N8N_EXPECTED_VERSION is bound regardless of call order
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

# Activate (publish) one workflow id by the proven 2.23.3 mechanism, with a deprecated fallback. ACTIVATE-001:
# ALWAYS routes through the Docker-safe n8n_cli abstraction (the bare `n8n` binary does not exist on the
# Docker-only production VPS, so a direct `n8n publish:workflow` would fail there).
n8n_activate_id() {
  local id="$1"
  if n8n_has_command publish:workflow; then n8n_cli publish:workflow --id="$id"
  else n8n_cli update:workflow --id="$id" --active=true; fi   # deprecated fallback (pre-publish CLI)
}
n8n_deactivate_id() {
  local id="$1"
  if n8n_has_command unpublish:workflow; then n8n_cli unpublish:workflow --id="$id"
  else n8n_cli update:workflow --id="$id" --active=false; fi  # deprecated fallback (pre-publish CLI)
}

# Export every workflow n8n knows about into the HOST dir $1 (separate files), so host-side tools (binder,
# reconciler, id resolver) can read the assigned ids. In docker mode the export is written INSIDE the container,
# then copied out with n8n_get (a host path is not visible to the container's CLI).
export_all() {
  local out="$1"; mkdir -p "$out"
  if [ "$(n8n_resolve_mode)" = "host" ]; then
    n8n_cli export:workflow --all --separate --output="$out" >/dev/null 2>&1
  else
    local cdir="/tmp/ms-export-$$"
    n8n_cli export:workflow --all --separate --output="$cdir" >/dev/null 2>&1
    n8n_get "$cdir" "$out" >/dev/null 2>&1
    # clean up our own in-container temp dir (ephemeral container layer; never the n8n_n8n_data volume)
    n8n_sh "rm -rf $cdir" >/dev/null 2>&1 || true
  fi
}

# Export NON-decrypted credential METADATA (ids/names/types only — NEVER --decrypted, never a plaintext secret)
# into the HOST file $1, Docker-safely (CRED-002). The previous code ran
#     n8n_cli export:credentials --all --output="$tmp/creds.json"
# then tested `[ -f "$tmp/creds.json" ]` — but in docker mode the CLI runs INSIDE the container, so the file landed
# on the container layer while the test checked the HOST path. It was therefore ALWAYS absent in production: credflag
# stayed empty, staging ran with no export, and every placeholder credential was DEFERRED — which is exactly how 31
# googleApi references imported into production as unresolved placeholders while the log claimed "compatible
# credentials preserved automatically". This mirrors export_all's host/docker split EXACTLY (write to a container
# temp dir, copy OUT via n8n_get, clean the container temp), then verifies the host copy is non-empty and a parseable
# JSON array. Fails closed (returns non-zero, leaves no file) on any error. Used by EVERY path that needs the export
# (apply, dry-run, discover, verify-production, credential-audit) so there is ONE implementation, not several.
export_credentials() {
  local out="$1"
  n8n_available || return 1
  if [ "$(n8n_resolve_mode)" = "host" ]; then
    n8n_cli export:credentials --all --output="$out" >/dev/null 2>&1 || return 1
  else
    local cdir="/tmp/ms-creds-$$" hdir; hdir="$(mktemp -d)"
    n8n_sh "mkdir -p $cdir" >/dev/null 2>&1 || true
    if ! n8n_cli export:credentials --all --output="$cdir/creds.json" >/dev/null 2>&1; then
      n8n_sh "rm -rf $cdir" >/dev/null 2>&1 || true; rm -rf "$hdir"; return 1
    fi
    n8n_get "$cdir" "$hdir" >/dev/null 2>&1 || { n8n_sh "rm -rf $cdir" >/dev/null 2>&1 || true; rm -rf "$hdir"; return 1; }
    n8n_sh "rm -rf $cdir" >/dev/null 2>&1 || true   # clean the in-container temp (ephemeral layer; never the volume)
    if [ -f "$hdir/creds.json" ]; then mv -f "$hdir/creds.json" "$out"; else rm -rf "$hdir"; return 1; fi
    rm -rf "$hdir"
  fi
  # verify: non-empty + a parseable JSON array of credential metadata objects. NEVER print the contents.
  [ -s "$out" ] || return 1
  node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!Array.isArray(a)){process.exit(1);}' "$out" 2>/dev/null || return 1
  return 0
}

do_import() {
  require_n8n || exit 1
  detect_n8n_version
  if [ "$ASSUME_YES" != "yes" ]; then
    printf 'Import %d runtime workflows into n8n (inactive)? [y/N] ' "${#IMPORT_ORDER[@]}"
    read -r reply
    case "$reply" in y|Y|yes|YES) ;; *) say "Aborted. No changes made."; exit 0 ;; esac
  fi
  # --- (0) acquire the release lock; the EXIT-trap finisher releases it + writes ABORT evidence + rollback on any
  #         failure, and cleans secret-bearing temp files no matter the outcome (RELEASE-004 / §5 fail behavior) ---
  RP_DONE="no"
  rp_lock_acquire || die "another release holds the lock (scripts/release_lock.sh status) — refusing concurrent deploy."
  local tmp; tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rp_finish '$tmp'" EXIT
  # --- (1) resolve installation-local ids against the LIVE export (fail-closed, idempotent; DEPLOY-007/002) -----
  say "Capturing live export and resolving installation-local workflow ids..."
  capture_export "$tmp/preexport"
  node "$RUNTIME_IDS_TOOL" resolve --export-dir "$tmp/preexport" --local "$RUNTIME_IDS_LOCAL" --apply \
    || die "runtime id resolution aborted (exact-name/id-mismatch — see report) — refusing to import."
  # record coverage + map checksum for the release evidence (sanitized: counts/checksum only)
  RP_COVERAGE="$(node "$RUNTIME_IDS_TOOL" status --local "$RUNTIME_IDS_LOCAL" 2>/dev/null | sed -n 's/^coverage=\([^ ]*\).*/\1/p' | head -1)"
  RP_CHECKSUM="$(node "$RUNTIME_IDS_TOOL" status --local "$RUNTIME_IDS_LOCAL" 2>/dev/null | sed -n 's/.*checksum=\([^ ]*\).*/\1/p' | head -1)"
  # --- (2) non-decrypted credential metadata for automatic reconciliation (NEVER --decrypted; Docker-safe) ------
  local credflag=()
  if export_credentials "$tmp/creds.json"; then
    credflag=( --cred-export "$tmp/creds.json" )
    say "  [ok] credential metadata exported (encrypted at rest; ids/types only used for reconciliation)"
  else
    say "  [info] no credential export available — compatible credentials cannot be auto-reconciled (placeholders stay deferred for the n8n UI)"
  fi
  # --- (3) STAGE prepared workflows (resolved ids + bindings + reconciled creds + active=false); import STAGED ---
  say "Staging prepared workflows (resolved ids, reconciled credentials, bindings; active=false)..."
  node "$STAGE_TOOL" --out "$tmp/staged" --local "$RUNTIME_IDS_LOCAL" "${credflag[@]}" \
    || die "staging failed (unresolved id / ambiguous credential) — refusing to import."
  # verify the RESOLVED staged credential references reconcile cleanly against production (DEPLOY-008). A
  # deliberately-DEFERRED placeholder (a credential type with no production credential yet) is NOT a failure for an
  # inactive deploy — it is attached later in the UI; only resolved refs must be valid/unambiguous/type-correct.
  if [ "${#credflag[@]}" -gt 0 ]; then
    node -e '
      const RC=require(process.argv[1]),fs=require("fs");
      const dir=process.argv[2],exp=JSON.parse(fs.readFileSync(process.argv[3],"utf8"));
      const files=fs.readdirSync(dir).filter(f=>f.endsWith(".json"));
      const all=RC.collectReferences(files,dir);
      const PH=/paste|placeholder|changeme|change_me|<[^>]+>|your[-_]|todo|replace[-_]?me/i;
      const resolved=all.filter(r=>!PH.test(String(r.id)));
      const deferred=all.length-resolved.length;
      const r=RC.reconcile(resolved,exp);
      if(!r.ok){ console.error("CREDENTIAL_RECONCILIATION=FAIL failures="+r.summary.failures); process.exit(1); }
      console.log("  [ok] staged credential reconciliation: resolved="+resolved.length+" deferred="+deferred+" failures=0");
    ' "$RECONCILE_CREDS" "$tmp/staged" "$tmp/creds.json" || die "staged credential reconciliation failed — refusing to import."
  fi
  # --- (14) production backup BEFORE the first import/mutation (BACKUP-001/§9). Never deletes an existing backup. ---
  hr; say "Creating a production backup BEFORE any import (encrypted at rest; never decrypts credentials, never removes the volume)..."
  rp_backup_production || die "backup failed — refusing to mutate n8n (no import performed)."
  hr
  # The staged files live on the HOST; in docker mode the n8n CLI runs INSIDE the container, so copy them in first
  # (a docker-exec `import:workflow --input=<host path>` would ENOENT — DEPLOY-001/§3 Docker-only reality).
  local import_src
  if [ "$(n8n_resolve_mode)" = "host" ]; then
    import_src="${tmp}/staged"
  else
    import_src="/tmp/ms-staged-$$"
    n8n_put "${tmp}/staged" "$import_src" >/dev/null 2>&1 || die "could not copy staged workflows into the n8n container."
  fi
  for f in "${IMPORT_ORDER[@]}"; do
    say ">> importing STAGED ${f} (--activeState=false → INACTIVE; resolved id; credentials preserved)"
    n8n_cli import:workflow --input="${import_src}/${f}" --activeState=false
  done
  hr
  # --- binding verification (QA-002/QA-009): the STAGED files already carry resolved binding ids (prepare_staged),
  #     and n8n preserves our resolved workflow ids on import, so the fresh export must show every edge bound with
  #     ZERO placeholders. No manual UI step and no re-import-callers dance is needed. ---
  say "Re-exporting assigned ids and verifying ${BINDING_COUNT} Execute Sub-workflow edges (zero placeholders)..."
  export_all "$tmp/exported"
  node "$BIND_TOOL" --dir "$tmp/exported" --verify || die "post-import binding verification failed — placeholders remain or an edge is unbound."
  hr
  say "Capturing assigned workflow IDs (active=false for all; fingerprints only — never raw ids):"
  local listing; listing="$(n8n_cli list:workflow 2>/dev/null || true)"
  for f in "${IMPORT_ORDER[@]}"; do
    local nm id; nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
    resolve_into "$nm" "$listing"; id="$RESOLVE_ID"
    case "$RESOLVE_STATUS" in
      ok) printf '  %-46s id_fp=%s\n' "$f" "$(id_fingerprint "$id")" ;;
      ambiguous) die "ambiguous exact workflow name in n8n for ${f} (\"${nm}\") — refusing (DEPLOY-002)." ;;
      *) printf '  %-46s id_fp=%s\n' "$f" "(not found)" ;;
    esac
  done
  hr
  # --- POST-IMPORT credential audit (CRED-002): bindings being bound is NOT proof the credentials resolved. Run the
  #     honest requirement+reconciliation audit over what n8n actually stored, so evidence reflects REALITY, never an
  #     optimistic "preserved automatically" claim. Emits PRODUCTION_*/WF18_* markers; sets the result honestly. -----
  say "Auditing post-import credential references (non-decrypted; fingerprints only)..."
  mkdir -p "$tmp/runtime_audit"
  node -e '
    const fs=require("fs"),path=require("path");
    const L=require(process.argv[1]); const src=process.argv[2], dst=process.argv[3];
    const want=new Set(Object.values(L.runtimeIdentity()).map(v=>v.name));
    for(const f of fs.readdirSync(src).filter(x=>x.endsWith(".json"))){
      let wf; try{ wf=JSON.parse(fs.readFileSync(path.join(src,f),"utf8")); }catch(e){ continue; }
      if(want.has(wf.name)){ fs.writeFileSync(path.join(dst, wf.name.replace(/[^0-9A-Za-z]+/g,"_")+".json"), JSON.stringify(wf)); }
    }
  ' "$MANIFEST_LIB" "$tmp/exported" "$tmp/runtime_audit" 2>/dev/null || true
  local credaudit_arg=()
  [ -f "$tmp/creds.json" ] && credaudit_arg=( --export "$tmp/creds.json" )
  local AUDIT_OUT
  AUDIT_OUT="$(node "$RECONCILE_CREDS" --audit --wf-dir "$tmp/runtime_audit" "${credaudit_arg[@]}" --prefix PRODUCTION --focus "18_" 2>/dev/null || true)"
  printf '%s\n' "$AUDIT_OUT"
  local CRED_PASS CRED_FAIL CRED_DEFER CRED_REFS
  CRED_PASS="$(printf '%s\n' "$AUDIT_OUT"  | sed -n 's/^PRODUCTION_CREDENTIAL_AUDIT=//p'       | head -1)"
  CRED_FAIL="$(printf '%s\n' "$AUDIT_OUT"  | sed -n 's/^PRODUCTION_CREDENTIAL_FAILURES=//p'    | head -1)"
  CRED_DEFER="$(printf '%s\n' "$AUDIT_OUT" | sed -n 's/^PRODUCTION_CREDENTIAL_DEFERRED=//p'    | head -1)"
  CRED_REFS="$(printf '%s\n' "$AUDIT_OUT"  | sed -n 's/^PRODUCTION_CREDENTIAL_REFERENCES=//p'  | head -1)"
  # Honest credential status: FAIL on any hard failure; DEFERRED when only deferred (a type with no prod credential
  # yet — operator attaches before activation); PASS only when every reference resolved with zero deferred.
  local CRED_STATUS
  if [ "${CRED_PASS:-FAIL}" != "PASS" ] || [ "${CRED_FAIL:-1}" != "0" ]; then CRED_STATUS="FAIL"
  elif [ "${CRED_DEFER:-0}" != "0" ]; then CRED_STATUS="PASS_WITH_DEFERRED_CREDENTIALS"
  else CRED_STATUS="PASS"; fi
  hr
  if [ "$CRED_STATUS" = "PASS" ]; then
    say "Imported ${#IMPORT_ORDER[@]} runtime workflows (INACTIVE), ${BINDING_COUNT} sub-workflow edges bound, and ALL"
    say "${CRED_REFS:-?} credential references reconciled to existing production credentials (CREDENTIAL_AUDIT=PASS)."
  else
    say "Imported ${#IMPORT_ORDER[@]} runtime workflows (INACTIVE), ${BINDING_COUNT} sub-workflow edges bound."
    say "CREDENTIAL_AUDIT=${CRED_STATUS} — NOT claiming credentials were preserved. See the PRODUCTION_CREDENTIAL_* markers above."
  fi
  # --- (20/21) sanitized release evidence (fingerprints only) + the exact rollback command. The release_report tool
  #     re-DERIVES `result` from these verified fields, so passing CRED_STATUS yields PASS / PASS_WITH_DEFERRED /
  #     FAIL honestly — a bare "PASS" can never be claimed when the audit did not earn it. ------------------------
  RP_CRED_AUDIT="$CRED_STATUS"; RP_CRED_REFS="${CRED_REFS:-null}"; RP_CRED_FAILURES="${CRED_FAIL:-null}"; RP_CRED_DEFERRED="${CRED_DEFER:-null}"
  RP_WF_FOUND="${#IMPORT_ORDER[@]}"; RP_BIND_RESOLVED="$BINDING_COUNT"; RP_PLACEHOLDERS=0; RP_ACTIVE=0
  rp_write_evidence "$CRED_STATUS" "${RP_COVERAGE:-unknown}" "${RP_CHECKSUM:-unknown}" 0
  rp_emit_rollback
  RP_DONE="yes"   # tells the EXIT-trap finisher this was a clean release (no ABORT diagnostics)
  say "Rollback: scripts/rollback.sh --apply  (or: make rollback) — restores publication/webhook/id-map state."
  say "Next steps:"
  say "  1. Any credential TYPE with no compatible production credential yet stays a deferred placeholder — attach"
  say "     it once in the n8n UI, then re-run --apply to reconcile it (compatible types are preserved automatically)."
  say "  2. Verify central config env vars: scripts/deploy_n8n.sh --check-config"
  say "  3. Verify the release end-to-end:  make verify-production (status + bindings + credential audit + image pin)"
  say "  4. Activate the Telegram gateway (separate explicit step): make telegram-activate (WF18 only; gate-protected)."
  # A hard credential FAILURE must block activation — refuse to report a clean release (the import is INACTIVE and
  # safe; the operator fixes credentials and re-applies). DEFERRED is acceptable for an inactive deploy.
  if [ "$CRED_STATUS" = "FAIL" ]; then
    say ""
    say "CREDENTIAL_AUDIT=FAIL — do NOT activate. Fix the flagged references and re-run scripts/deploy_n8n.sh --apply."
    return 1
  fi
}

# Read-only production CREDENTIAL audit (CRED-002): export the live workflows + NON-decrypted credential metadata
# Docker-safely, restrict to the 15 runtime workflows by EXACT name, and run the honest requirement+reconciliation
# audit (reconcile_credentials.js --audit). Emits PRODUCTION_* and WF18_* markers — counts/types/fingerprints only,
# never a raw id/name/secret. NEVER mutates, NEVER --decrypted, NEVER mounts the volume into a disposable container.
credential_audit() {
  load_manifest_arrays
  require_n8n || exit 1
  detect_n8n_version
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  say "Capturing production workflow export (read-only)..."
  export_all "$tmp/exported"
  mkdir -p "$tmp/runtime"
  # Restrict the export to the runtime closure by EXACT workflow name (the same identity the manifest tracks); the
  # old conversational WF18 and other legacy objects are NOT in the runtime identity, so they are never audited here.
  local matched
  matched="$(node -e '
    const fs=require("fs"),path=require("path");
    const L=require(process.argv[1]); const src=process.argv[2], dst=process.argv[3];
    const want=new Set(Object.values(L.runtimeIdentity()).map(v=>v.name));
    let n=0;
    for(const f of fs.readdirSync(src).filter(x=>x.endsWith(".json"))){
      let wf; try{ wf=JSON.parse(fs.readFileSync(path.join(src,f),"utf8")); }catch(e){ continue; }
      if(want.has(wf.name)){ fs.writeFileSync(path.join(dst, wf.name.replace(/[^0-9A-Za-z]+/g,"_")+".json"), JSON.stringify(wf)); n++; }
    }
    process.stdout.write(String(n));
  ' "$MANIFEST_LIB" "$tmp/exported" "$tmp/runtime" 2>/dev/null || printf 0)"
  say "PRODUCTION_RUNTIME_WORKFLOWS=${matched}/${RUNTIME_COUNT}"
  local credarg=()
  if export_credentials "$tmp/creds.json"; then
    credarg=( --export "$tmp/creds.json" )
    say "  [ok] credential metadata exported (encrypted at rest; ids/types only used for reconciliation)"
  else
    say "  [warn] no credential export available — every reference will show as DEFERRED (cannot prove resolution)."
  fi
  # WF18 secure dispatcher filename in $tmp/runtime starts with the sanitized "18 — …(secure dispatcher)" name.
  node "$RECONCILE_CREDS" --audit --wf-dir "$tmp/runtime" "${credarg[@]}" --prefix PRODUCTION --focus "18_"
}

# PRODUCTION DRY-RUN credential reconciliation (BLOCKER B): stage EXACTLY what an --apply would import (resolved
# installation-local ids + bindings + reconciled credentials, active=false) against the LIVE workflow export + the
# LIVE non-decrypted credential export, then AUDIT the staged set — the SAME proof apply produces, minus the import.
# ZERO production mutation; NEVER writes config/runtime_ids.local.json (uses a throwaway id map under $1). Sets
# DRY_CREDS (export file), DRY_STAGED (staged dir), DRY_CRED_VERDICT (PASS|PASS_WITH_DEFERRED_CREDENTIALS|FAIL).
# Fail-closed: missing/unknown export or any HARD failure (missing-reference/placeholder/ambiguous/type-mismatch) or
# a non-PASS WF18 audit => non-zero. Deferred-only (a credential TYPE with no production credential yet) => 0 but a
# distinct PASS_WITH_DEFERRED_CREDENTIALS verdict so the caller never reports a clean OK while a credential is unproven.
DRY_CREDS=""; DRY_STAGED=""; DRY_CRED_VERDICT="FAIL"
stage_and_audit_for_dryrun() {
  local work="$1" export_dir="$2"
  DRY_CREDS=""; DRY_STAGED=""; DRY_CRED_VERDICT="FAIL"
  hr; say "Production credential reconciliation (DRY — same discovery + reconciliation as apply; ZERO mutation):"
  if ! export_credentials "$work/creds.json"; then
    say "PRODUCTION_CREDENTIAL_AUDIT=FAIL"
    say "PRODUCTION_DRY_RUN_CREDENTIALS=FAIL — no verified non-decrypted credential export (cannot prove reconciliation)."
    return 1
  fi
  DRY_CREDS="$work/creds.json"
  say "  [ok] non-decrypted credential metadata exported (encrypted at rest; ids/types only used for reconciliation)"
  if ! node "$RUNTIME_IDS_TOOL" resolve --export-dir "$export_dir" --local "$work/idmap.json" --apply >/dev/null 2>&1; then
    node "$RUNTIME_IDS_TOOL" resolve --export-dir "$export_dir" --local "$work/idmap.json" 2>&1 | grep -E 'RUNTIME_IDS_RESOLVE|abort|ABORT|coverage' | sed 's/^/  /' || true
    say "PRODUCTION_DRY_RUN_CREDENTIALS=FAIL — installation-local id resolution aborted (exact-name/id mismatch)."
    return 1
  fi
  if ! node "$STAGE_TOOL" --out "$work/staged" --local "$work/idmap.json" --cred-export "$work/creds.json" >/dev/null 2>&1; then
    node "$STAGE_TOOL" --out "$work/staged" --local "$work/idmap.json" --cred-export "$work/creds.json" 2>&1 | sed 's/^/  /' || true
    say "PRODUCTION_DRY_RUN_CREDENTIALS=FAIL — staging aborted (unresolved id or ambiguous production credential)."
    return 1
  fi
  DRY_STAGED="$work/staged"
  local AUDIT_OUT
  AUDIT_OUT="$(node "$RECONCILE_CREDS" --audit --wf-dir "$work/staged" --export "$work/creds.json" --prefix PRODUCTION --focus "18_" 2>/dev/null || true)"
  printf '%s\n' "$AUDIT_OUT"
  local C_AUDIT C_FAIL C_DEFER WF_AUDIT
  C_AUDIT="$(printf '%s\n' "$AUDIT_OUT" | sed -n 's/^PRODUCTION_CREDENTIAL_AUDIT=//p' | head -1)"
  C_FAIL="$(printf '%s\n'  "$AUDIT_OUT" | sed -n 's/^PRODUCTION_CREDENTIAL_FAILURES=//p' | head -1)"
  C_DEFER="$(printf '%s\n' "$AUDIT_OUT" | sed -n 's/^PRODUCTION_CREDENTIAL_DEFERRED=//p' | head -1)"
  WF_AUDIT="$(printf '%s\n' "$AUDIT_OUT" | sed -n 's/^WF18_CREDENTIAL_AUDIT=//p' | head -1)"
  if [ "${C_AUDIT:-FAIL}" != "PASS" ] || [ "${C_FAIL:-1}" != "0" ] || [ "${WF_AUDIT:-FAIL}" != "PASS" ]; then
    DRY_CRED_VERDICT="FAIL"
    say "PRODUCTION_DRY_RUN_CREDENTIALS=FAIL — hard credential failure(s) in the staged set (see PRODUCTION_*/WF18_* above)."
    return 1
  fi
  if [ "${C_DEFER:-0}" != "0" ]; then
    DRY_CRED_VERDICT="PASS_WITH_DEFERRED_CREDENTIALS"
    say "PRODUCTION_DRY_RUN_CREDENTIALS=PASS_WITH_DEFERRED_CREDENTIALS — ${C_DEFER} reference(s) on a credential TYPE with no production credential yet (WF18=${WF_AUDIT}; activation-critical path is clean)."
    return 0
  fi
  DRY_CRED_VERDICT="PASS"
  say "PRODUCTION_DRY_RUN_CREDENTIALS=PASS — every reference reconciled to a production credential, 0 deferred (WF18=${WF_AUDIT})."
  return 0
}

# Export current workflows and confirm every sub-workflow edge is bound (zero PASTE_WORKFLOW_ID placeholders).
verify_bindings() {
  require_n8n || exit 1
  detect_n8n_version
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  export_all "$tmp/exported"
  node "$BIND_TOOL" --dir "$tmp/exported" --verify
}

# Aggregate production verification (Phase 6): exact-name inventory + bindings + CREDENTIALS + running version, with
# a single honest VERIFY_PRODUCTION marker emitted PASS only when EVERY sub-check verifiably passes — never on an
# unknown/deferred/failed credential audit, a missing/extra/active workflow, an unbound edge, or a version mismatch.
# Read-only; never mutates. The compose-file IMAGE pin (outside the repo, /opt/n8n) is verified separately in §8.
verify_production() {
  load_manifest_arrays
  require_n8n || exit 1
  detect_n8n_version
  local fails=0 out rc
  hr; say "VERIFY-PRODUCTION — inventory + bindings + credentials + version (read-only; aggregate marker below):"

  # 1) workflow inventory: 15/15 exact-name, 0 duplicates, 0 active (WORKFLOW_INVENTORY=PASS is the closure marker).
  out="$(show_status 2>&1)"; printf '%s\n' "$out"
  printf '%s\n' "$out" | grep -q 'WORKFLOW_INVENTORY=PASS' || { fails=$((fails+1)); say "  [verify] FAIL: workflow inventory (matches/duplicates/active)"; }

  # 2) bindings: every Execute Sub-workflow edge bound, zero placeholders (the tool's exit code is authoritative).
  out="$(verify_bindings 2>&1)"; rc=$?; printf '%s\n' "$out" | grep -E 'bindings_|placeholders_|"ok"' | sed 's/^/  /' || true
  if [ "$rc" -eq 0 ]; then say "  BINDINGS=PASS"; else fails=$((fails+1)); say "  BINDINGS=FAIL"; fi

  # 3) credentials: every reference resolves (0 placeholders, 0 failures) + WF18 readiness.
  out="$(credential_audit 2>&1)"; printf '%s\n' "$out"
  printf '%s\n' "$out" | grep -q 'PRODUCTION_CREDENTIAL_AUDIT=PASS'      || { fails=$((fails+1)); say "  [verify] FAIL: PRODUCTION_CREDENTIAL_AUDIT != PASS"; }
  printf '%s\n' "$out" | grep -q 'PRODUCTION_CREDENTIAL_PLACEHOLDERS=0'  || { fails=$((fails+1)); say "  [verify] FAIL: credential placeholders remain"; }
  printf '%s\n' "$out" | grep -q 'PRODUCTION_NODES_MISSING_REFERENCE=0'  || { fails=$((fails+1)); say "  [verify] FAIL: a credential-requiring node has no reference"; }
  printf '%s\n' "$out" | grep -q 'WF18_CREDENTIAL_AUDIT=PASS'            || { fails=$((fails+1)); say "  [verify] FAIL: WF18 credential readiness"; }

  # 4) running version must equal the tested/pinned version.
  if [ "$N8N_VERSION" = "$N8N_EXPECTED_VERSION" ]; then say "  N8N_VERSION_MATCH=PASS (running ${N8N_VERSION} == ${N8N_EXPECTED_VERSION})";
  else fails=$((fails+1)); say "  N8N_VERSION_MATCH=FAIL (running ${N8N_VERSION} != expected ${N8N_EXPECTED_VERSION})"; fi

  hr
  if [ "$fails" -eq 0 ]; then say "VERIFY_PRODUCTION=PASS"; return 0; else say "VERIFY_PRODUCTION=FAIL (${fails} check(s) failed)"; return 1; fi
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
    resolve_into "$nm" "$listing"; id="$RESOLVE_ID"
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

# TRANSACTIONAL Telegram activation (ACTIVATE-002): publish WF18 ONLY, register the webhook, verify it; if the
# webhook step fails, automatically UNPUBLISH WF18 so we never leave a published gateway with no/invalid webhook.
# Never activates WF23/WF25 (scheduled activation is a separate command). Stricter activation preflight + WF18 gate.
activate_telegram() {
  load_manifest_arrays
  local WF18_FILE="18_telegram_agent_gateway.json"
  say "Strict ACTIVATION preflight (bot token + public HTTPS webhook url + secret + \$env + zlib are fail-closed):"
  if ! node "$PREFLIGHT" --discover --for-activation --require-zlib >/dev/null 2>&1; then
    node "$PREFLIGHT" --discover --for-activation --require-zlib || true
    die "activation preflight failed — refusing to activate WF18 (set bot token / PUBLIC_WEBHOOK_BASE_URL / webhook secret / N8N_BLOCK_ENV_ACCESS_IN_NODE=false / zlib)."
  fi
  say "  [ok] activation preflight passed (stricter than the inactive-deploy preflight)"
  say "WF18 pre-live blocker gate:"
  node "${ROOT}/tools/wf18_activation_gate.js" || die "WF18 is NOT cleared for activation (open P0/P1 blockers). The WF18 gateway rearchitecture is pending."
  say "  [ok] WF18 activation gate is open"
  require_n8n || exit 1
  detect_n8n_version
  local nm id listing
  nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${WF18_FILE}")"
  listing="$(n8n_cli list:workflow 2>/dev/null || true)"
  resolve_into "$nm" "$listing"; id="$RESOLVE_ID"
  case "$RESOLVE_STATUS" in
    ok) ;;
    ambiguous) die "ambiguous WF18 exact name in n8n — refusing to activate (DEPLOY-002)." ;;
    *) die "WF18 not found in n8n — import it first: scripts/deploy_n8n.sh --apply." ;;
  esac
  say "Will activate WF18 ONLY (id_fp=$(id_fingerprint "$id")). WF23/WF25 are NOT touched by this command."
  if [ "$ASSUME_YES" != "yes" ]; then
    printf 'Activate WF18 (Telegram gateway) and register+verify the webhook? [y/N] '
    read -r reply
    case "$reply" in y|Y|yes|YES) ;; *) say "Aborted. Nothing activated."; exit 0 ;; esac
  fi
  say ">> publishing WF18 (id_fp=$(id_fingerprint "$id")) via publish:workflow (Docker-safe n8n_cli abstraction)"
  n8n_activate_id "$id" || die "WF18 publish failed — nothing activated."
  # Transactional: register the webhook; on ANY failure, unpublish WF18 so there is never a live-but-unreachable gateway.
  say ">> registering the Telegram webhook (token env-only, never printed)"
  if ! "${ROOT}/scripts/telegram_webhook.sh" set --apply; then
    say "  [rollback] webhook registration FAILED — unpublishing WF18 to keep activation transactional"
    n8n_deactivate_id "$id" || say "  [warn] WF18 unpublish also failed — run: scripts/rollback.sh --apply"
    die "Telegram activation rolled back (WF18 unpublished). No active gateway."
  fi
  say ">> verifying the registered webhook matches the expected URL"
  if ! "${ROOT}/scripts/telegram_webhook.sh" verify | grep -q 'WEBHOOK_MATCH=PASS'; then
    say "  [rollback] webhook verification FAILED — deleting the webhook and unpublishing WF18"
    "${ROOT}/scripts/telegram_webhook.sh" delete --apply >/dev/null 2>&1 || true
    n8n_deactivate_id "$id" || say "  [warn] WF18 unpublish also failed — run: scripts/rollback.sh --apply"
    die "Telegram activation rolled back (webhook verify failed; WF18 unpublished)."
  fi
  hr
  say "WF18 (Telegram gateway) is ACTIVE; the webhook is registered AND verified. WF23/WF25 remain inactive."
  say "Rollback: scripts/rollback.sh --apply  (deletes the webhook + unpublishes WF18)."
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
    resolve_into "$nm" "$listing"; id="$RESOLVE_ID"
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
  # STATUS-001: a FAILED/empty listing is a DISCOVERY FAILURE, not an empty install. Stop and report it as such —
  # never fall back to the local id map and never guess (the old code reported every workflow as "(not imported)").
  if [ -z "$(printf '%s' "$listing" | tr -d '[:space:]')" ]; then
    say "WORKFLOW_INVENTORY=ERROR"
    die "could not list workflows from n8n (empty/failed listing) — DISCOVERY FAILURE, not an empty install. Refusing to guess. Check: docker exec ${MS_N8N_CONTAINER:-n8n-n8n-1} n8n list:workflow"
  fi
  hr; say "Runtime workflow status vs production (exact-name authoritative; fingerprints only — never raw ids):"
  say "Distinguishes: exact match · renamed (same number, different name) · missing · ambiguous duplicate · legacy/extra."
  # Classify the WHOLE production listing against the manifest (matched / renamed / missing / ambiguous / legacy).
  local inv; inv="$(printf '%s\n' "$listing" | node "$INVENTORY_TOOL" --listing - 2>&1)" || true
  printf '%s\n' "$inv" | sed 's/^/  /'
  hr
}

# Read-only LIVE production discovery (DISCOVERY-001): report production REALITY, never repository-only state and
# never mutate / persist the id map. Degrades gracefully to a clearly-labelled repo-only plan when no n8n is reachable.
show_discovery() {
  load_manifest_arrays
  hr; say "Read-only production discovery (NO mutation · NO id-map persistence · fingerprints only)"
  say "Manifest runtime plan: ${RUNTIME_COUNT} workflows · ${BINDING_COUNT} binding edges · expected n8n ${N8N_EXPECTED_VERSION}"
  if ! n8n_available; then
    hr; say "No reachable n8n — LIVE discovery requires MS_N8N_MODE=docker MS_N8N_CONTAINER=n8n-n8n-1 on the VPS."
    say "REPO-ONLY fallback (this is NOT production reality):"
    node "$MANIFEST_LIB" plan-json | sed 's/^/  /' || true
    node "$RUNTIME_IDS_TOOL" status --local "$RUNTIME_IDS_LOCAL" 2>/dev/null | sed 's/^/  /' || true
    say "LIVE_DISCOVERY=UNAVAILABLE"
    return 0
  fi
  detect_n8n_version
  say "Container=$(n8n_resolve_container) · pinned_image=${MS_N8N_IMAGE:-n8nio/n8n:2.23.3} · detected_version=${N8N_VERSION}"
  hr; say "Effective configuration (sanitized; secret values never shown):"
  discover_environment
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  hr; say "Capturing a read-only workflow export (docker-safe; copied OUT of the container; container temp cleaned)..."
  capture_export "$tmp/exported"
  if [ "$EXPORT_PROVIDED" != "yes" ]; then
    say "WORKFLOW_INVENTORY=ERROR"
    die "production export FAILED (no parseable workflows captured) — DISCOVERY FAILURE. Refusing to fall back to the local id map. Check: docker exec ${MS_N8N_CONTAINER:-n8n-n8n-1} n8n export:workflow --all --separate --output=/tmp/x"
  fi
  hr; say "Production inventory vs manifest (read-only export — includes active state):"
  node "$INVENTORY_TOOL" --export-dir "$tmp/exported" 2>&1 | sed 's/^/  /' || true
  hr; say "In-place reconciliation plan (exact-name: CREATE/UPDATE/ABORT — NO mutation):"
  node "$RECONCILE_WF" --export-dir "$tmp/exported" 2>&1 | grep -E 'RECONCILIATION|"action"|"wf"|"reason"' | sed 's/^/  /' || true
  hr; say "Runtime-id coverage against the live export (DRY — config/runtime_ids.local.json is NOT written):"
  node "$RUNTIME_IDS_TOOL" resolve --export-dir "$tmp/exported" --local "$tmp/throwaway_idmap.json" 2>&1 | grep -E 'RUNTIME_IDS_RESOLVE|coverage' | sed 's/^/  /' || true
  hr; say "Binding integrity in the live export (${BINDING_COUNT} manifest edges; a stale prod WF18 is expected to show unbound edges):"
  node "$BIND_TOOL" --dir "$tmp/exported" --verify 2>&1 | sed 's/^/  /' || true
  hr
  say "LIVE_DISCOVERY=PASS (read-only · production NOT mutated · runtime_ids.local.json NOT written)"
}

say "Marketing Scout — n8n deploy (mode: ${MODE})"
hr
# Testability hook (CRED-002): allow the offline test suite to SOURCE this file to exercise the Docker-safe export
# helpers (export_credentials/export_all) in MS_N8N_EXEC_DRY / host-stub mode WITHOUT running the real dispatch.
if [ "${MS_DEPLOY_SOURCE_ONLY:-0}" = "1" ]; then return 0 2>/dev/null || exit 0; fi

case "$MODE" in
  check-config)
    check_config || die "config preflight failed — fix the [missing]/[invalid] values above."
    ;;
  dry-run)
    load_manifest_arrays
    validate_json
    discover_environment
    # Capture a live export (production target) so id resolution + reconciliation run against reality.
    PLAN_EXPORT=""; DRY_WORK=""; DRY_CRED_VERDICT="SKIPPED"
    if [ "$RELEASE_TARGET" = "production" ]; then
      # A production-target dry-run MUST run against the real install (DEPLOY-004 / BLOCKER B). No reachable n8n is a
      # fail-closed condition — use --offline-plan for a soft rehearsal that never claims production readiness.
      require_n8n || die "production-target dry-run requires a reachable n8n (MS_N8N_MODE=docker MS_N8N_CONTAINER=n8n-n8n-1). For a soft rehearsal use: scripts/deploy_n8n.sh --offline-plan"
      detect_n8n_version
      DRY_WORK="$(mktemp -d)"; trap 'rm -rf "$DRY_WORK"' EXIT
      PLAN_EXPORT="$DRY_WORK/export"; capture_export "$PLAN_EXPORT"
      [ "$EXPORT_PROVIDED" = "yes" ] || die "production-target dry-run: no parseable workflow export captured — cannot resolve ids/credentials (run scripts/deploy_n8n.sh --discover to diagnose)."
    fi
    print_plan
    # BLOCKER B: real credential reconciliation against the LIVE credential export (production target) — staged + audited
    # with ZERO mutation; fail-closed on any hard failure. Replaces the old "reconciliation deferred to apply" claim.
    if [ "$RELEASE_TARGET" = "production" ]; then
      stage_and_audit_for_dryrun "$DRY_WORK" "$PLAN_EXPORT" \
        || die "production-target dry-run FAILED CLOSED on credentials (see PRODUCTION_*/WF18_* markers above). No changes made."
    fi
    hr; say "Ordered fail-closed release plan (target=${RELEASE_TARGET}):"
    if run_release_plan dry-run "$PLAN_EXPORT" "${DRY_CREDS:-}" "${DRY_STAGED:-}"; then
      if [ "$RELEASE_TARGET" = "offline" ]; then
        say "OFFLINE-PLAN complete (SOFT). This is a planning rehearsal only and does NOT assert production readiness."
        say "Run a real production dry-run on the VPS: MS_N8N_MODE=docker MS_N8N_CONTAINER=n8n-n8n-1 scripts/deploy_n8n.sh --dry-run"
      elif [ "$DRY_CRED_VERDICT" = "PASS_WITH_DEFERRED_CREDENTIALS" ]; then
        # Honest non-clean state: the resolvable references reconcile and WF18 is clean, but ≥1 credential TYPE has no
        # production credential yet (e.g. VK httpQueryAuth). Return NON-ZERO so this never reads as production-ready.
        say "DRY-RUN complete (PRODUCTION target) — PRODUCTION_DRY_RUN_CREDENTIALS=PASS_WITH_DEFERRED_CREDENTIALS."
        say "Deferred references are on a credential TYPE with NO production credential yet; attach it before activating that path."
        say "RELEASE_PLAN=DEFERRED_CREDENTIALS (not a clean OK; WF18 activation path is credential-clean)."
        exit 3
      else
        say "DRY-RUN complete (PRODUCTION target, fail-closed) — PRODUCTION_DRY_RUN_CREDENTIALS=PASS. No changes made. Re-run with --apply to stage+import+bind (inactive)."
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
  activate-telegram)
    validate_json
    activate_telegram
    ;;
  deactivate-triggers)
    deactivate_triggers
    ;;
  status)
    show_status
    ;;
  credential-audit)
    credential_audit
    ;;
  verify-production)
    verify_production
    ;;
  discover)
    show_discovery
    ;;
esac
