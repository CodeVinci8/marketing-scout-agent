#!/usr/bin/env bash
# n8n_import_smoke.sh — FAIL-CLOSED disposable import smoke (QA-007/011). Stages the runtime closure with stable
# ids, imports it INACTIVE into a throwaway n8n 2.23.3, auto-binds the 8 Execute Sub-workflow edges, exports and
# verifies (exact count, zero placeholders, 8 edges, all inactive), then repeats the deploy to prove idempotency.
# Everything is derived from config/workflow_manifest.json — no hard-coded workflow list.
#
# Disposable by construction (scripts/lib/disposable_n8n.sh): verified image, --network none, throwaway SQLite,
# repo read-only, --rm, no credentials, no production volume, nothing activated.
#
# Fail-closed: EVERY mandatory verification failure propagates a non-zero exit. A failed mandatory step is NEVER
# followed by a final PASS. POSIX/BusyBox-safe (no `find -printf`, no bashisms in the in-container script).
#
# Machine-readable output:
#   RUNTIME_WORKFLOWS_EXPECTED=15  RUNTIME_WORKFLOWS_IMPORTED=15  MISSING_WORKFLOWS=0  EXTRA_WORKFLOWS=0
#   DUPLICATE_WORKFLOWS=0  PLACEHOLDER_BINDINGS=0  RESOLVED_EDGES=8  ACTIVE_WORKFLOWS=0  REPEAT_DEPLOY=PASS
#   PRODUCTION_UNTOUCHED=true  DISPOSABLE_IMPORT=PASS
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/disposable_n8n.sh
. "${ROOT}/scripts/lib/disposable_n8n.sh"

EXPECTED="$(node "${ROOT}/tools/manifest_lib.js" runtime-count)"
EDGES="$(node "${ROOT}/tools/manifest_lib.js" binding-count)"

if ! disp_docker_ready; then
  disp_skip "docker or the n8n image is unavailable — disposable import smoke needs the container"
  echo "RUNTIME_WORKFLOWS_EXPECTED=${EXPECTED}"; echo "DISPOSABLE_IMPORT=SKIPPED"; echo "PRODUCTION_UNTOUCHED=true"
  exit 0
fi

WORK="$(mktemp -d)"; chmod 777 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# The whole import → bind → verify → repeat cycle runs INSIDE one disposable container (node + n8n both present).
INNER='
set -e
node /repo/tools/stage_runtime_workflows.js /work/staged >/dev/null 2>&1
echo ">> importing staged runtime workflows (inactive)"
n8n import:workflow --separate --input=/work/staged --activeState=false >/dev/null 2>&1
mkdir -p /work/exp; n8n export:workflow --all --separate --output=/work/exp >/dev/null 2>&1
echo ">> auto-binding sub-workflow ids"
node /repo/tools/bind_n8n_workflow_ids.js --dir /work/exp --report /work/bind.json >/dev/null 2>&1 || true
mkdir -p /work/callers
for f in /work/exp/*.json; do
  if grep -q "n8n-nodes-base.executeWorkflow\"" "$f"; then cp "$f" /work/callers/; fi
done
n8n import:workflow --separate --input=/work/callers --activeState=false >/dev/null 2>&1
mkdir -p /work/ver; n8n export:workflow --all --separate --output=/work/ver >/dev/null 2>&1
echo "=== FIRST_DEPLOY ==="
node /repo/tools/smoke_report.js /work/ver /work/bind.json
echo "LIST_COUNT_1=$(n8n list:workflow 2>/dev/null | grep -c "|")"
echo "ACTIVE_COUNT_1=$(n8n list:workflow --active=true 2>/dev/null | grep -c "|")"
echo ">> repeat deploy (idempotency)"
n8n import:workflow --separate --input=/work/staged --activeState=false >/dev/null 2>&1
n8n import:workflow --separate --input=/work/callers --activeState=false >/dev/null 2>&1
mkdir -p /work/rep; n8n export:workflow --all --separate --output=/work/rep >/dev/null 2>&1
echo "=== REPEAT_DEPLOY ==="
node /repo/tools/smoke_report.js /work/rep /work/bind.json
echo "LIST_COUNT_2=$(n8n list:workflow 2>/dev/null | grep -c "|")"
'

echo "n8n disposable import smoke (image=$(disp_image))"
echo "----------------------------------------------------------------------"
OUT="$(disp_run "$ROOT" "$WORK" "" "$INNER" 2>&1 | disp_filter || true)"
printf '%s\n' "$OUT"
echo "----------------------------------------------------------------------"

field() { printf '%s\n' "$OUT" | grep "^$1=" | head -1 | cut -d= -f2 || true; }

IMPORTED="$(field RUNTIME_WORKFLOWS_IMPORTED)"
MISSING="$(field MISSING_WORKFLOWS)"
EXTRA="$(field EXTRA_WORKFLOWS)"
DUP="$(field DUPLICATE_WORKFLOWS)"
PLACEH="$(field PLACEHOLDER_BINDINGS)"
RESOLVED="$(field RESOLVED_EDGES)"
ACTIVE="$(field ACTIVE_WORKFLOWS)"
LC1="$(field LIST_COUNT_1)"
LC2="$(field LIST_COUNT_2)"
ACT1="$(field ACTIVE_COUNT_1)"

REPEAT=PASS
{ [ "${LC1:-0}" = "${LC2:-x}" ] && [ "${LC2:-0}" = "$EXPECTED" ]; } || REPEAT=FAIL

echo "RUNTIME_WORKFLOWS_EXPECTED=${EXPECTED}"
echo "RUNTIME_WORKFLOWS_IMPORTED=${IMPORTED:-0}"
echo "MISSING_WORKFLOWS=${MISSING:-1}"
echo "EXTRA_WORKFLOWS=${EXTRA:-1}"
echo "DUPLICATE_WORKFLOWS=${DUP:-1}"
echo "PLACEHOLDER_BINDINGS=${PLACEH:-1}"
echo "RESOLVED_EDGES=${RESOLVED:-0}"
echo "ACTIVE_WORKFLOWS=${ACTIVE:-1}"
echo "REPEAT_DEPLOY=${REPEAT}"
disp_production_untouched

FAIL=0
[ "${IMPORTED:-0}" = "$EXPECTED" ] || { echo "  [FAIL] imported ${IMPORTED:-0} != ${EXPECTED}"; FAIL=1; }
[ "${MISSING:-1}" = "0" ] || { echo "  [FAIL] missing workflows"; FAIL=1; }
[ "${EXTRA:-1}" = "0" ] || { echo "  [FAIL] extra workflows"; FAIL=1; }
[ "${DUP:-1}" = "0" ] || { echo "  [FAIL] duplicate workflows"; FAIL=1; }
[ "${PLACEH:-1}" = "0" ] || { echo "  [FAIL] placeholder bindings remain"; FAIL=1; }
[ "${RESOLVED:-0}" = "$EDGES" ] || { echo "  [FAIL] resolved edges ${RESOLVED:-0} != ${EDGES}"; FAIL=1; }
[ "${ACTIVE:-1}" = "0" ] || { echo "  [FAIL] active workflows after import"; FAIL=1; }
[ "${ACT1:-1}" = "0" ] || { echo "  [FAIL] list --active reports active workflows"; FAIL=1; }
[ "$REPEAT" = "PASS" ] || { echo "  [FAIL] repeat deploy not idempotent (${LC1:-?} -> ${LC2:-?})"; FAIL=1; }

[ "$FAIL" -eq 0 ] || { echo "DISPOSABLE_IMPORT=FAIL"; exit 1; }
echo "DISPOSABLE_IMPORT=PASS"
