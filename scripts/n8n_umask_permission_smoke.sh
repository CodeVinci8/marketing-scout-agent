#!/usr/bin/env bash
# n8n_umask_permission_smoke.sh — DOCKER-COPY-PERM-001 end-to-end regression UNDER A RESTRICTIVE umask.
#
# Reproduces the real defect and proves the fix: with `umask 077` the caller's staged/fixture JSON is mode 0600,
# root-owned. `docker cp` preserves that owner+mode, so the container's n8n CLI (runtime user `node`, uid 1000)
# could not read it -> `EACCES: permission denied, open '/tmp/f1.json'` -> every import failed. The fix is the
# n8n_put_for_runtime / n8n_make_runtime_readable copy-IN helpers: as ROOT inside the container they set node
# ownership + LEAST-PRIVILEGE modes (dirs 0700, files 0600 — NOT world-readable) and verify the runtime user can
# read every file (fail closed). This smoke runs the REAL helpers against a disposable n8n 2.23.3 container.
#
# Disposable by construction: pinned image, --network none, --rm, guarded disposable name (never n8n-n8n-1 /
# n8n_n8n_data), no credentials, no production volume. Honest markers (§14): real PASS only after a real success;
# SKIPPED (never a fake PASS) without docker/the image. No secret, credential id/name or raw workflow id is printed.
set -euo pipefail
umask 077   # THE POINT: prove copy-IN works when the caller shell makes every file 0600

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/disposable_n8n.sh
. "${ROOT}/scripts/lib/disposable_n8n.sh"
# shellcheck source=scripts/lib/n8n_exec.sh
. "${ROOT}/scripts/lib/n8n_exec.sh"

N8N_VERSION="$(node "${ROOT}/tools/manifest_lib.js" n8n-version)"

declare -A M
for k in UMASK_0077_DISPOSABLE_IMPORT UMASK_0077_RUNTIME_ACCEPTANCE UMASK_0077_PRODUCTION_STAGING_COPY \
         CONTAINER_NODE_CAN_READ_STAGED_JSON HOST_STAGED_FILES_REMAIN_PRIVATE \
         CONTAINER_STAGED_FILES_NOT_WORLD_READABLE CONTAINER_TEMP_CLEANUP OWNERSHIP_FAILURE_RETURNS_NONZERO; do
  M[$k]="SKIPPED"
done

emit_markers() {
  echo "N8N_VERSION=${N8N_VERSION}"
  echo "CALLER_UMASK=$(umask)"
  for k in UMASK_0077_DISPOSABLE_IMPORT UMASK_0077_RUNTIME_ACCEPTANCE UMASK_0077_PRODUCTION_STAGING_COPY \
           CONTAINER_NODE_CAN_READ_STAGED_JSON HOST_STAGED_FILES_REMAIN_PRIVATE \
           CONTAINER_STAGED_FILES_NOT_WORLD_READABLE CONTAINER_TEMP_CLEANUP OWNERSHIP_FAILURE_RETURNS_NONZERO; do
    echo "${k}=${M[$k]}"
  done
  disp_production_untouched
}

if ! disp_docker_ready; then
  disp_skip "docker or the pinned n8n image is unavailable — umask permission smoke is operator-run"
  emit_markers
  echo "DOCKER_COPY_PERMISSIONS=SKIPPED"
  exit 0
fi

WORK="$(mktemp -d)"   # left 0700 (umask 077) on purpose — host stays private
DISP_C="ms-disp-e2e-umask$$"
cleanup() { docker rm -f "$DISP_C" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
disp_guard_name "$DISP_C" || { echo "DOCKER_COPY_PERMISSIONS=FAIL (bad disposable name)"; exit 1; }

echo "DOCKER-COPY-PERM-001 umask-077 smoke (image=$(disp_image), n8n ${N8N_VERSION}, caller umask=$(umask))"
echo "container=${DISP_C} (disposable; production n8n-n8n-1/n8n_n8n_data never touched)"
echo "----------------------------------------------------------------------"

export MS_N8N_MODE="docker" MS_N8N_CONTAINER="$DISP_C"

docker run -d --rm --name "$DISP_C" --network none \
  -e N8N_USER_FOLDER=/home/node/.n8n \
  --entrypoint sh "$(disp_image)" -c 'sleep 1800' >/dev/null 2>&1 \
  || { echo "DOCKER_COPY_PERMISSIONS=FAIL (container start)"; exit 1; }

# the readability check is only meaningful if the CLI runs as a NON-root runtime user
WHO="$(docker exec "$DISP_C" id -un 2>/dev/null || true)"
[ "$WHO" = "node" ] || echo "  [warn] container default user is '${WHO:-unknown}', expected node"

# ---- (1) build a production-staging-like set of PRIVATE (0600) host files ------------------------------------
STG="${WORK}/staged"; mkdir -p "$STG"
for i in 1 2 3; do
  cat > "${STG}/wf${i}.json" <<JSON
{"id":"umaskstg${i}","name":"UMASK Staging Probe ${i}","active":false,"settings":{},"nodes":[{"parameters":{},"id":"node${i}","name":"NoOp","type":"n8n-nodes-base.noOp","typeVersion":1,"position":[0,0]}],"connections":{}}
JSON
done
HOST_BEFORE="$(stat -c '%a' "${STG}"/wf*.json | sort -u | tr '\n' ' ')"
echo ">> host staged files mode (umask 077): ${HOST_BEFORE}"

# ---- (2) copy-IN via the REAL helper (production staging copy path) ------------------------------------------
if n8n_put_for_runtime "$STG" /tmp/ms-umask-stg >/dev/null 2>&1; then CPRC=0; else CPRC=$?; fi

# host source must remain PRIVATE (the helper must not weaken host permissions)
HOST_AFTER="$(stat -c '%a' "${STG}"/wf*.json | sort -u | tr '\n' ' ')"
if [ "$HOST_AFTER" = "600 " ]; then M[HOST_STAGED_FILES_REMAIN_PRIVATE]="PASS"; else echo "  [FAIL] host files no longer 0600 (got '${HOST_AFTER}')"; fi

# the runtime user must be able to READ every copied file
if [ "$CPRC" -eq 0 ] && docker exec -u node "$DISP_C" sh -c 'for f in /tmp/ms-umask-stg/*.json; do [ -r "$f" ] || exit 1; done' >/dev/null 2>&1; then
  M[CONTAINER_NODE_CAN_READ_STAGED_JSON]="PASS"
else echo "  [FAIL] node cannot read the copied staged files (helper rc=${CPRC})"; fi

# ...but the files must NOT be world-readable (least privilege): files 0600, dir 0700
CMODE="$(docker exec -u 0 "$DISP_C" stat -c '%a' /tmp/ms-umask-stg/wf1.json 2>/dev/null || true)"
DMODE="$(docker exec -u 0 "$DISP_C" stat -c '%a' /tmp/ms-umask-stg 2>/dev/null || true)"
if [ "$CMODE" = "600" ] && [ "$DMODE" = "700" ]; then M[CONTAINER_STAGED_FILES_NOT_WORLD_READABLE]="PASS"; else echo "  [FAIL] container modes not least-privilege (file=${CMODE} dir=${DMODE})"; fi

# the copied staged set must actually IMPORT (this was the EACCES failure before the fix)
STG_IMPORT_OK=1
for i in 1 2 3; do
  docker exec -u node "$DISP_C" n8n import:workflow --input="/tmp/ms-umask-stg/wf${i}.json" --activeState=false >/dev/null 2>&1 || STG_IMPORT_OK=0
done
if [ "$STG_IMPORT_OK" -eq 1 ]; then M[UMASK_0077_PRODUCTION_STAGING_COPY]="PASS"; M[UMASK_0077_DISPOSABLE_IMPORT]="PASS"; else echo "  [FAIL] 0600 staged files failed to import under umask 077"; fi

# ---- (3) the REAL runtime-acceptance fixtures (generated 0600) import via the same helper --------------------
node "${ROOT}/tools/gen_runtime_acceptance_fixtures.js" --out "${WORK}/fx" >/dev/null 2>&1 || true
if [ -d "${WORK}/fx" ] && n8n_put_for_runtime "${WORK}/fx" /tmp/ms-umask-fx >/dev/null 2>&1; then
  ONE="$(docker exec "$DISP_C" sh -c 'ls /tmp/ms-umask-fx/*.json 2>/dev/null | head -1' || true)"
  if [ -n "$ONE" ] && docker exec -u node "$DISP_C" n8n import:workflow --input="$ONE" --activeState=false >/dev/null 2>&1; then
    M[UMASK_0077_RUNTIME_ACCEPTANCE]="PASS"
  else echo "  [FAIL] runtime-acceptance fixture did not import under umask 077"; fi
else echo "  [FAIL] could not stage runtime-acceptance fixtures via the helper"; fi

# ---- (4) fail-closed: an ownership/verification failure MUST return nonzero ----------------------------------
docker exec -u 0 "$DISP_C" sh -c 'mkdir -p /tmp/ms-umask-neg && printf "{}" > /tmp/ms-umask-neg/x.json' >/dev/null 2>&1 || true
if MS_N8N_RUNTIME_USER="ms_nonexistent_user_zz" n8n_make_runtime_readable "$DISP_C" /tmp/ms-umask-neg >/dev/null 2>&1; then NEG=0; else NEG=$?; fi
if [ "$NEG" -ne 0 ]; then M[OWNERSHIP_FAILURE_RETURNS_NONZERO]="PASS"; else echo "  [FAIL] bogus runtime user did not fail closed (rc=${NEG})"; fi

# ---- (5) container temp cleanup ------------------------------------------------------------------------------
docker exec -u 0 "$DISP_C" rm -rf /tmp/ms-umask-stg /tmp/ms-umask-fx /tmp/ms-umask-neg >/dev/null 2>&1 || true
LEFT="$(docker exec "$DISP_C" sh -c 'ls -d /tmp/ms-umask-stg /tmp/ms-umask-fx /tmp/ms-umask-neg 2>/dev/null' || true)"
if [ -z "$LEFT" ]; then M[CONTAINER_TEMP_CLEANUP]="PASS"; else echo "  [FAIL] container temp not cleaned: ${LEFT}"; fi

# ---- teardown + summary --------------------------------------------------------------------------------------
docker rm -f "$DISP_C" >/dev/null 2>&1 || true
echo "----------------------------------------------------------------------"
emit_markers

FAIL=0
for k in UMASK_0077_DISPOSABLE_IMPORT UMASK_0077_RUNTIME_ACCEPTANCE UMASK_0077_PRODUCTION_STAGING_COPY \
         CONTAINER_NODE_CAN_READ_STAGED_JSON HOST_STAGED_FILES_REMAIN_PRIVATE \
         CONTAINER_STAGED_FILES_NOT_WORLD_READABLE CONTAINER_TEMP_CLEANUP OWNERSHIP_FAILURE_RETURNS_NONZERO; do
  [ "${M[$k]}" = "PASS" ] || { echo "  [FAIL] mandatory marker ${k}=${M[$k]}"; FAIL=1; }
done
[ "$FAIL" -eq 0 ] || { echo "DOCKER_COPY_PERMISSIONS=FAIL"; exit 1; }
echo "DOCKER_COPY_PERMISSIONS=PASS"
