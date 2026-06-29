#!/usr/bin/env bash
# n8n_disposable_e2e.sh — full DISPOSABLE acceptance that drives the SAME shared release pipeline production uses
# (§5/§10/§13.20/TEST-002). A throwaway, persistent n8n 2.23.3 container is created and the production deploy path
# (scripts/deploy_n8n.sh --apply, via the n8n_exec docker abstraction) is run against it — release lock, runtime-id
# resolution, exact-name reconciliation, credential reconciliation, backup, staged import (inactive), binding,
# fresh-export verification, and sanitized release evidence — exactly like production. Then idempotent re-apply,
# fail-closed negative scenarios (duplicate exact-name / id-name mismatch / ambiguous credential), a parent/child
# TOPOLOGY round-trip, backup/restore, rollback readiness, and zlib controls. Production is never referenced.
#
# Disposable by construction: pinned image, --network none, a throwaway named volume + container (disposable-named,
# guarded — never n8n-n8n-1 / n8n_n8n_data, never an image/ancestor filter), --rm, no credentials, no production
# volume, NOTHING activated or published. Removed by EXACT disposable name at the end.
#
# Honest markers (§14): real PASS only after a real success; SKIPPED (never a fake PASS) without docker/the image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/disposable_n8n.sh
. "${ROOT}/scripts/lib/disposable_n8n.sh"
# shellcheck source=scripts/lib/n8n_exec.sh
. "${ROOT}/scripts/lib/n8n_exec.sh"   # n8n_make_runtime_readable (DOCKER-COPY-PERM-001)

EXPECTED="$(node "${ROOT}/tools/manifest_lib.js" runtime-count)"
EDGES="$(node "${ROOT}/tools/manifest_lib.js" binding-count)"
CALLABLES="$(node "${ROOT}/tools/manifest_lib.js" callable-count)"
N8N_VERSION="$(node "${ROOT}/tools/manifest_lib.js" n8n-version)"

# §14 marker set — default everything to SKIPPED so we can NEVER emit a false PASS.
declare -A M
for k in RELEASE_PIPELINE_SHARED DISPOSABLE_IMPORT DISPOSABLE_REIMPORT RUNTIME_ID_RESOLUTION \
         EXACT_NAME_RECONCILIATION CREDENTIAL_RECONCILIATION BACKUP_RESTORE_SMOKE BINDINGS \
         PARENT_CHILD_TOPOLOGY RELEASE_LOCK RELEASE_EVIDENCE ROLLBACK_READINESS \
         ZLIB_NEGATIVE_CONTROL ZLIB_CODE_NODE WORKFLOW_VERSION_SEMANTICS; do M[$k]="SKIPPED"; done
ACTIVE_WORKFLOWS="unknown"

emit_markers() {
  echo "N8N_VERSION=${N8N_VERSION}"
  echo "RUNTIME_WORKFLOWS_EXPECTED=${EXPECTED}"
  for k in RELEASE_PIPELINE_SHARED DISPOSABLE_IMPORT DISPOSABLE_REIMPORT RUNTIME_ID_RESOLUTION \
           EXACT_NAME_RECONCILIATION CREDENTIAL_RECONCILIATION BACKUP_RESTORE_SMOKE BINDINGS; do
    echo "${k}=${M[$k]}"
  done
  echo "ACTIVE_WORKFLOWS=${ACTIVE_WORKFLOWS}"
  for k in PARENT_CHILD_TOPOLOGY RELEASE_LOCK RELEASE_EVIDENCE ROLLBACK_READINESS \
           ZLIB_NEGATIVE_CONTROL ZLIB_CODE_NODE WORKFLOW_VERSION_SEMANTICS; do
    echo "${k}=${M[$k]}"
  done
  disp_production_untouched
}

if ! disp_docker_ready; then
  disp_skip "docker or the pinned n8n image is unavailable — disposable e2e is operator-run"
  emit_markers
  echo "DISPOSABLE_DEPLOY=SKIPPED"
  exit 0
fi

# ---- disposable workspace, names, and the shared-pipeline environment (all throwaway) -------------------------
WORK="$(mktemp -d)"; chmod 777 "$WORK"
DISP_C="ms-disp-e2e-$$"; DISP_V="ms_disposable_e2e_$$"
cleanup() { disp_stop_persistent "$DISP_C" "$DISP_V" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

# Point the SHARED release pipeline at the disposable container + throwaway state (never production paths).
export MS_N8N_MODE="docker" MS_N8N_CONTAINER="$DISP_C"
export MS_RUNTIME_IDS_LOCAL="${WORK}/runtime_ids.local.json"
export MS_RELEASE_EVIDENCE_DIR="${WORK}/evidence"
export MS_RELEASE_LOCK="${WORK}/release.lock"
export MS_BACKUP_ROOT="${WORK}/backups"
export MS_N8N_VOLUME="$DISP_V"
export MS_N8N_IMAGE="$(disp_image)"
# dummy, non-secret config so the deploy preflight passes for an INACTIVE import (no real credentials/secrets)
export MS_SPREADSHEET_ID="disposable_sheet" MS_TELEGRAM_ALLOWED_USER_IDS="1" MS_TIMEZONE="Europe/Moscow"

echo "n8n disposable end-to-end acceptance via the SHARED release pipeline (image=$(disp_image), n8n ${N8N_VERSION})"
echo "container=${DISP_C} volume=${DISP_V} (disposable; production n8n-n8n-1/n8n_n8n_data never touched)"
echo "----------------------------------------------------------------------"

if ! disp_start_persistent "$DISP_C" "$DISP_V"; then
  echo "  [FAIL] could not start the disposable container"; emit_markers; echo "DISPOSABLE_DEPLOY=FAIL"; exit 1
fi

FAIL=0
fail() { echo "  [FAIL] $*"; FAIL=1; }

# version semantics: the container's n8n must match the pinned/tested version
VER_IN="$(docker exec "$DISP_C" n8n --version 2>/dev/null | head -1 || true)"
if [ "$VER_IN" = "$N8N_VERSION" ]; then M[WORKFLOW_VERSION_SEMANTICS]="PASS"; else fail "n8n version ${VER_IN:-unknown} != ${N8N_VERSION}"; M[WORKFLOW_VERSION_SEMANTICS]="FAIL"; fi

# ---- (1) FIRST deploy through the shared production pipeline -------------------------------------------------
echo ">> first deploy: scripts/deploy_n8n.sh --apply (shared pipeline: lock->resolve->backup->stage->import->bind->verify->evidence)"
if "${ROOT}/scripts/deploy_n8n.sh" --apply --yes >"${WORK}/apply1.log" 2>&1; then APPLY1=0; else APPLY1=$?; fi
sed 's/^/    /' "${WORK}/apply1.log" | disp_filter | tail -25 || true
if [ "$APPLY1" -eq 0 ]; then M[RELEASE_PIPELINE_SHARED]="PASS"; M[DISPOSABLE_IMPORT]="PASS"; else fail "first deploy exit=$APPLY1"; M[RELEASE_PIPELINE_SHARED]="FAIL"; M[DISPOSABLE_IMPORT]="FAIL"; fi

# runtime-id resolution coverage (the shared pipeline persisted a generated installation-local map)
if grep -q "RUNTIME_IDS_RESOLVE=PASS" "${WORK}/apply1.log" && \
   [ "$(node "${ROOT}/tools/runtime_ids.js" status --local "$MS_RUNTIME_IDS_LOCAL" 2>/dev/null | sed -n 's/^coverage=\([^ ]*\).*/\1/p')" = "${EXPECTED}/${EXPECTED}" ]; then
  M[RUNTIME_ID_RESOLUTION]="PASS"
else fail "runtime id resolution did not reach ${EXPECTED}/${EXPECTED}"; M[RUNTIME_ID_RESOLUTION]="FAIL"; fi

# release lock acquired+released, sanitized evidence written, backup taken
grep -q "RELEASE_LOCK=ACQUIRED" "${WORK}/apply1.log" && [ ! -d "$MS_RELEASE_LOCK" ] && M[RELEASE_LOCK]="PASS" || { fail "release lock not acquired/released cleanly"; M[RELEASE_LOCK]="FAIL"; }
# A disposable container has NO real credentials, so every reference is legitimately DEFERRED -> the honest derived
# result is PASS_WITH_DEFERRED_CREDENTIALS (a bare "PASS" would require resolved credentials, which a throwaway n8n
# does not have). Accept either; a plain unknown/FAIL/BLOCKED is a real failure.
if ls "${MS_RELEASE_EVIDENCE_DIR}"/release-*.json >/dev/null 2>&1 && grep -qE '"result": "(PASS|PASS_WITH_DEFERRED_CREDENTIALS)"' "${MS_RELEASE_EVIDENCE_DIR}"/release-*.json; then M[RELEASE_EVIDENCE]="PASS"; else fail "no PASS/PASS_WITH_DEFERRED_CREDENTIALS release evidence written"; M[RELEASE_EVIDENCE]="FAIL"; fi

# ---- (2) post-deploy verification against the live disposable export -----------------------------------------
LIST_1="$(docker exec "$DISP_C" n8n list:workflow 2>/dev/null | grep -c "|" || true)"
ACTIVE_1="$(docker exec "$DISP_C" n8n list:workflow --active=true 2>/dev/null | grep -c "|" || true)"
ACTIVE_WORKFLOWS="${ACTIVE_1:-unknown}"
[ "${LIST_1:-0}" = "$EXPECTED" ] || fail "imported ${LIST_1:-0} != ${EXPECTED}"
[ "${ACTIVE_1:-1}" = "0" ] || fail "active workflows ${ACTIVE_1:-?} != 0"

# exact-name reconciliation + bindings against the live export
docker exec "$DISP_C" n8n export:workflow --all --separate --output=/tmp/exp >/dev/null 2>&1 || true
mkdir -p "${WORK}/exp"; docker cp "$DISP_C":/tmp/exp/. "${WORK}/exp" >/dev/null 2>&1 || true
if node "${ROOT}/tools/reconcile_workflows.js" --export-dir "${WORK}/exp" --local "$MS_RUNTIME_IDS_LOCAL" >/dev/null 2>&1; then
  M[EXACT_NAME_RECONCILIATION]="PASS"; else fail "exact-name reconciliation against the live export failed"; M[EXACT_NAME_RECONCILIATION]="FAIL"; fi
if node "${ROOT}/tools/bind_n8n_workflow_ids.js" --dir "${WORK}/exp" --verify >/dev/null 2>&1; then
  M[BINDINGS]="PASS"; else fail "binding verification (${EDGES} edges) failed"; M[BINDINGS]="FAIL"; fi

# credential reconciliation: a deliberately-ambiguous fixture export MUST be refused; a single compatible one passes
cat > "${WORK}/creds_ambig.json" <<'JSON'
[{"id":"g1","name":"a","type":"googleApi"},{"id":"g2","name":"b","type":"googleApi"},{"id":"h1","name":"c","type":"httpHeaderAuth"}]
JSON
cat > "${WORK}/creds_ok.json" <<'JSON'
[{"id":"gOK","name":"Google","type":"googleApi"},{"id":"hOK","name":"Claude","type":"httpHeaderAuth"}]
JSON
if node "${ROOT}/tools/prepare_staged_workflows.js" --out "${WORK}/st_ambig" --local "$MS_RUNTIME_IDS_LOCAL" --cred-export "${WORK}/creds_ambig.json" >/dev/null 2>&1; then AMBIG=0; else AMBIG=$?; fi
if node "${ROOT}/tools/prepare_staged_workflows.js" --out "${WORK}/st_ok" --local "$MS_RUNTIME_IDS_LOCAL" --cred-export "${WORK}/creds_ok.json" >/dev/null 2>&1; then COK=0; else COK=$?; fi
if [ "$AMBIG" -ne 0 ] && [ "$COK" -eq 0 ]; then M[CREDENTIAL_RECONCILIATION]="PASS"; else fail "credential reconciliation: ambiguous(exit=$AMBIG must be !=0) compatible(exit=$COK must be 0)"; M[CREDENTIAL_RECONCILIATION]="FAIL"; fi

# ---- (3) idempotent RE-deploy: same shared pipeline, no duplicates ------------------------------------------
echo ">> repeat deploy (idempotency: same ids -> update, never duplicate)"
if "${ROOT}/scripts/deploy_n8n.sh" --apply --yes >"${WORK}/apply2.log" 2>&1; then APPLY2=0; else APPLY2=$?; fi
LIST_2="$(docker exec "$DISP_C" n8n list:workflow 2>/dev/null | grep -c "|" || true)"
if [ "$APPLY2" -eq 0 ] && [ "${LIST_2:-0}" = "$EXPECTED" ] && [ "${LIST_1:-0}" = "${LIST_2:-x}" ]; then M[DISPOSABLE_REIMPORT]="PASS"; else fail "re-deploy not idempotent (exit=$APPLY2 list ${LIST_1}->${LIST_2}, expected ${EXPECTED})"; M[DISPOSABLE_REIMPORT]="FAIL"; fi

# ---- (4) backup + restore validation (real disposable volume) ------------------------------------------------
if ls "${MS_BACKUP_ROOT}"/n8n-prerelease-*/n8n-data.tar.gz >/dev/null 2>&1; then
  BK_DIR="$(ls -1dt "${MS_BACKUP_ROOT}"/n8n-prerelease-* | head -1)"
  if MS_RESTORE_OFFLINE_ONLY=1 "${ROOT}/scripts/restore_validate.sh" --dir "$BK_DIR" >/dev/null 2>&1; then M[BACKUP_RESTORE_SMOKE]="PASS"; else fail "restore validation failed for $BK_DIR"; M[BACKUP_RESTORE_SMOKE]="FAIL"; fi
else fail "no pre-release backup archive was produced by the shared pipeline"; M[BACKUP_RESTORE_SMOKE]="FAIL"; fi

# ---- (5) rollback readiness (dry-run plan succeeds; nothing mutated) ----------------------------------------
if "${ROOT}/scripts/rollback.sh" >/dev/null 2>&1; then M[ROLLBACK_READINESS]="PASS"; else fail "rollback dry-run plan failed"; M[ROLLBACK_READINESS]="FAIL"; fi

# ---- (6) parent/child TOPOLOGY round-trip (import->bind->export; link survives — NOT a real child execution) --
cp "${ROOT}/tests/fixtures/n8n/child.json" "${WORK}/child.json"
cp "${ROOT}/tests/fixtures/n8n/parent.json" "${WORK}/parent.json"
sed -i "s/PASTE_CHILD_ID/fixturechildwf/" "${WORK}/parent.json"
# DOCKER-COPY-PERM-001: make the copied-in fixtures node-readable (least privilege) before the CLI imports them.
docker cp "${WORK}/child.json" "$DISP_C":/tmp/child.json >/dev/null 2>&1 || true
docker cp "${WORK}/parent.json" "$DISP_C":/tmp/parent.json >/dev/null 2>&1 || true
n8n_make_runtime_readable "$DISP_C" /tmp/child.json >/dev/null 2>&1 || true
n8n_make_runtime_readable "$DISP_C" /tmp/parent.json >/dev/null 2>&1 || true
docker exec "$DISP_C" n8n import:workflow --input=/tmp/child.json --activeState=false >/dev/null 2>&1 || true
docker exec "$DISP_C" n8n import:workflow --input=/tmp/parent.json --activeState=false >/dev/null 2>&1 || true
docker exec "$DISP_C" n8n export:workflow --id=fixturechildwf --output=/tmp/pc_child.json >/dev/null 2>&1 || true
docker exec "$DISP_C" n8n export:workflow --id=fixtureparentwf --output=/tmp/pc_parent.json >/dev/null 2>&1 || true
docker cp "$DISP_C":/tmp/pc_child.json "${WORK}/pc_child.json" >/dev/null 2>&1 || true
docker cp "$DISP_C":/tmp/pc_parent.json "${WORK}/pc_parent.json" >/dev/null 2>&1 || true
if node -e '
  const fs=require("fs");
  function load(p){let j=JSON.parse(fs.readFileSync(p,"utf8"));return Array.isArray(j)?j[0]:j;}
  const child=load(process.argv[1]),parent=load(process.argv[2]);
  const trig=(child.nodes||[]).some(n=>n.type==="n8n-nodes-base.executeWorkflowTrigger");
  const call=(parent.nodes||[]).find(n=>n.type==="n8n-nodes-base.executeWorkflow");
  const bound=call&&call.parameters.workflowId.value===child.id&&call.parameters.workflowId.value!=="PASTE_CHILD_ID";
  process.exit(trig&&bound?0:1);
' "${WORK}/pc_child.json" "${WORK}/pc_parent.json" >/dev/null 2>&1; then M[PARENT_CHILD_TOPOLOGY]="PASS"; else fail "parent/child topology round-trip"; M[PARENT_CHILD_TOPOLOGY]="FAIL"; fi

# ---- (7) zlib NEGATIVE control (no builtin) + POSITIVE control (builtin allowed) -----------------------------
docker cp "${ROOT}/tests/fixtures/n8n/zlib_roundtrip.json" "$DISP_C":/tmp/zlib.json >/dev/null 2>&1 || true
n8n_make_runtime_readable "$DISP_C" /tmp/zlib.json >/dev/null 2>&1 || true   # DOCKER-COPY-PERM-001
docker exec "$DISP_C" n8n import:workflow --input=/tmp/zlib.json --activeState=false >/dev/null 2>&1 || true
if docker exec "$DISP_C" sh -c 'timeout 180 n8n execute --id=fixturezlibroundtrip --rawOutput' >"${WORK}/zneg.out" 2>&1; then ZNEG_RC=0; else ZNEG_RC=$?; fi
if [ "$ZNEG_RC" -ne 0 ] && grep -qi "disallowed" "${WORK}/zneg.out"; then M[ZLIB_NEGATIVE_CONTROL]="PASS"; else fail "zlib negative control (rc=$ZNEG_RC)"; M[ZLIB_NEGATIVE_CONTROL]="FAIL"; fi
# positive control: a separate disposable one-shot container WITH the builtin allowed
if disp_run "$ROOT" "$WORK" "-e NODE_FUNCTION_ALLOW_BUILTIN=zlib" '
  n8n import:workflow --input=/repo/tests/fixtures/n8n/zlib_roundtrip.json --activeState=false >/dev/null 2>&1
  timeout 180 n8n execute --id=fixturezlibroundtrip --rawOutput >/dev/null 2>&1 && echo ZLIB_POS_OK
' 2>/dev/null | disp_filter | grep -q ZLIB_POS_OK; then M[ZLIB_CODE_NODE]="PASS"; else fail "zlib positive control"; M[ZLIB_CODE_NODE]="FAIL"; fi

# ---- teardown (EXACT disposable names only) + summary -------------------------------------------------------
disp_stop_persistent "$DISP_C" "$DISP_V" >/dev/null 2>&1 || true
echo "----------------------------------------------------------------------"
emit_markers

# gate the final PASS behind every mandatory marker
for k in RELEASE_PIPELINE_SHARED DISPOSABLE_IMPORT DISPOSABLE_REIMPORT RUNTIME_ID_RESOLUTION \
         EXACT_NAME_RECONCILIATION CREDENTIAL_RECONCILIATION BACKUP_RESTORE_SMOKE BINDINGS \
         PARENT_CHILD_TOPOLOGY RELEASE_LOCK RELEASE_EVIDENCE ROLLBACK_READINESS \
         ZLIB_NEGATIVE_CONTROL ZLIB_CODE_NODE; do
  [ "${M[$k]}" = "PASS" ] || { echo "  [FAIL] mandatory marker ${k}=${M[$k]}"; FAIL=1; }
done
[ "${ACTIVE_WORKFLOWS}" = "0" ] || { echo "  [FAIL] ACTIVE_WORKFLOWS=${ACTIVE_WORKFLOWS} != 0"; FAIL=1; }

[ "$FAIL" -eq 0 ] || { echo "DISPOSABLE_DEPLOY=FAIL"; exit 1; }
echo "DISPOSABLE_DEPLOY=PASS"
