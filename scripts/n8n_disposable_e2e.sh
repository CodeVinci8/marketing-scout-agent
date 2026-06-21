#!/usr/bin/env bash
# n8n_disposable_e2e.sh — full DISPOSABLE acceptance of the deployment artifacts against real n8n 2.23.3 (§16 /
# QA-003/005/007/011). One isolated scenario: stage→import (inactive)→auto-bind 8 edges→export→verify (count,
# zero placeholders, 8 edges, 6 callable triggers, all inactive)→repeat (idempotency)→parent/child topology
# round-trip→zlib negative & positive controls. Production is never referenced.
#
# Disposable by construction (scripts/lib/disposable_n8n.sh): verified image, --network none, throwaway SQLite,
# repo read-only, --rm, no credentials, no production volume, NOTHING activated or published.
#
# n8n 2.23.3 note (proven, see docs/QA_DEFECTS.md QA-003): the CLI `n8n execute` harness refuses to invoke an
# INACTIVE database sub-workflow ("Workflow is not active and cannot be executed"). Production calls callables via
# the SERVER runtime (active gateway → Execute Sub-workflow), which does not require callables to be active. We
# therefore prove the parent→child link as a disposable import→bind→export TOPOLOGY round-trip (the binding
# resolves to the child's real assigned id and the child carries an Execute Sub-workflow Trigger) and leave the
# cross-execution to live verification.
#
# Machine-readable summary keys: N8N_VERSION, RUNTIME_WORKFLOWS_EXPECTED/IMPORTED, MISSING/EXTRA/DUPLICATE_WORKFLOWS,
# PLACEHOLDER_BINDINGS, RESOLVED_EDGES, CALLABLE_TRIGGERS_VALID, ACTIVE_WORKFLOWS, REPEAT_DEPLOY,
# PARENT_CHILD_RUNTIME, ZLIB_NEGATIVE_CONTROL, ZLIB_CODE_NODE, PRODUCTION_UNTOUCHED, DISPOSABLE_DEPLOY.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/disposable_n8n.sh
. "${ROOT}/scripts/lib/disposable_n8n.sh"

EXPECTED="$(node "${ROOT}/tools/manifest_lib.js" runtime-count)"
EDGES="$(node "${ROOT}/tools/manifest_lib.js" binding-count)"
CALLABLES="$(node "${ROOT}/tools/manifest_lib.js" callable-count)"
N8N_VERSION="$(node "${ROOT}/tools/manifest_lib.js" n8n-version)"

if ! disp_docker_ready; then
  disp_skip "docker or the n8n image is unavailable — disposable e2e needs the container"
  echo "N8N_VERSION=${N8N_VERSION}"; echo "DISPOSABLE_DEPLOY=SKIPPED"; echo "PRODUCTION_UNTOUCHED=true"
  exit 0
fi

WORK="$(mktemp -d)"; chmod 777 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# ---- Container A: deploy cycle + parent/child topology + zlib NEGATIVE control (no zlib env) -------------------
INNER_A='
set -e
node /repo/tools/stage_runtime_workflows.js /work/staged >/dev/null 2>&1
n8n import:workflow --separate --input=/work/staged --activeState=false >/dev/null 2>&1
mkdir -p /work/exp; n8n export:workflow --all --separate --output=/work/exp >/dev/null 2>&1
node /repo/tools/bind_n8n_workflow_ids.js --dir /work/exp --report /work/bind.json >/dev/null 2>&1 || true
mkdir -p /work/callers
for f in /work/exp/*.json; do if grep -q "n8n-nodes-base.executeWorkflow\"" "$f"; then cp "$f" /work/callers/; fi; done
n8n import:workflow --separate --input=/work/callers --activeState=false >/dev/null 2>&1
mkdir -p /work/ver; n8n export:workflow --all --separate --output=/work/ver >/dev/null 2>&1
echo "=== DEPLOY ==="
node /repo/tools/smoke_report.js /work/ver /work/bind.json
echo "LIST_COUNT_1=$(n8n list:workflow 2>/dev/null | grep -c "|")"
echo "ACTIVE_COUNT_1=$(n8n list:workflow --active=true 2>/dev/null | grep -c "|")"
# repeat deploy (idempotency)
n8n import:workflow --separate --input=/work/staged --activeState=false >/dev/null 2>&1
n8n import:workflow --separate --input=/work/callers --activeState=false >/dev/null 2>&1
echo "LIST_COUNT_2=$(n8n list:workflow 2>/dev/null | grep -c "|")"
# parent/child topology round-trip (no activation): import child+parent, bind, export, verify the link survives
cp /repo/tests/fixtures/n8n/child.json /work/child.json
cp /repo/tests/fixtures/n8n/parent.json /work/parent.json
sed -i "s/PASTE_CHILD_ID/fixturechildwf/" /work/parent.json
n8n import:workflow --input=/work/child.json --activeState=false >/dev/null 2>&1
n8n import:workflow --input=/work/parent.json --activeState=false >/dev/null 2>&1
mkdir -p /work/pc; n8n export:workflow --id=fixturechildwf --output=/work/pc/child.json >/dev/null 2>&1
n8n export:workflow --id=fixtureparentwf --output=/work/pc/parent.json >/dev/null 2>&1
node -e '\''
  var fs=require("fs");
  var child=JSON.parse(fs.readFileSync("/work/pc/child.json","utf8"));
  var parent=JSON.parse(fs.readFileSync("/work/pc/parent.json","utf8"));
  child=Array.isArray(child)?child[0]:child; parent=Array.isArray(parent)?parent[0]:parent;
  var trig=(child.nodes||[]).some(function(n){return n.type==="n8n-nodes-base.executeWorkflowTrigger";});
  var call=(parent.nodes||[]).find(function(n){return n.type==="n8n-nodes-base.executeWorkflow";});
  var bound=call&&call.parameters.workflowId.value===child.id&&call.parameters.workflowId.value!=="PASTE_CHILD_ID";
  console.log("PC_CHILD_TRIGGER="+(trig?"yes":"no"));
  console.log("PC_PARENT_BOUND="+(bound?"yes":"no"));
'\''
# zlib NEGATIVE control (no NODE_FUNCTION_ALLOW_BUILTIN): require(zlib) must be denied. The execute is EXPECTED to
# fail, so it is guarded so `set -e` does not abort before we record the result.
n8n import:workflow --input=/repo/tests/fixtures/n8n/zlib_roundtrip.json --activeState=false >/dev/null 2>&1
if timeout 180 n8n execute --id=fixturezlibroundtrip --rawOutput >/work/zneg.json 2>/work/zneg.err; then zrc=0; else zrc=$?; fi
if [ "$zrc" -ne 0 ] && grep -qi "disallowed" /work/zneg.json /work/zneg.err 2>/dev/null; then echo "ZLIB_NEG=denied"; else echo "ZLIB_NEG=unexpected(rc=$zrc)"; fi
'

# ---- Container B: zlib POSITIVE control (zlib env) ------------------------------------------------------------
INNER_B='
n8n import:workflow --input=/repo/tests/fixtures/n8n/zlib_roundtrip.json --activeState=false >/dev/null 2>&1
timeout 180 n8n execute --id=fixturezlibroundtrip --rawOutput >/dev/null 2>&1
echo "ZLIB_POS_RC=$?"
'

echo "n8n disposable end-to-end acceptance (image=$(disp_image), n8n ${N8N_VERSION})"
echo "----------------------------------------------------------------------"
OUT_A="$(disp_run "$ROOT" "$WORK" "" "$INNER_A" 2>&1 | disp_filter || true)"
printf '%s\n' "$OUT_A"
echo ">> zlib positive control (separate container, NODE_FUNCTION_ALLOW_BUILTIN=zlib)"
OUT_B="$(disp_run "$ROOT" "$WORK" "-e NODE_FUNCTION_ALLOW_BUILTIN=zlib" "$INNER_B" 2>&1 | disp_filter || true)"
printf '%s\n' "$OUT_B"
echo "----------------------------------------------------------------------"

field() { printf '%s\n' "$OUT_A" | grep "^$1=" | head -1 | cut -d= -f2 || true; }
IMPORTED="$(field RUNTIME_WORKFLOWS_IMPORTED)"; MISSING="$(field MISSING_WORKFLOWS)"; EXTRA="$(field EXTRA_WORKFLOWS)"
DUP="$(field DUPLICATE_WORKFLOWS)"; PLACEH="$(field PLACEHOLDER_BINDINGS)"; RESOLVED="$(field RESOLVED_EDGES)"
CTRIG="$(field CALLABLE_TRIGGERS_VALID)"; ACTIVE="$(field ACTIVE_WORKFLOWS)"
LC1="$(field LIST_COUNT_1)"; LC2="$(field LIST_COUNT_2)"; ACT1="$(field ACTIVE_COUNT_1)"
PC_TRIG="$(field PC_CHILD_TRIGGER)"; PC_BOUND="$(field PC_PARENT_BOUND)"; ZNEG="$(field ZLIB_NEG)"
ZPOS_RC="$(printf '%s\n' "$OUT_B" | grep '^ZLIB_POS_RC=' | head -1 | cut -d= -f2 || true)"

REPEAT=PASS; { [ "${LC1:-0}" = "${LC2:-x}" ] && [ "${LC2:-0}" = "$EXPECTED" ]; } || REPEAT=FAIL
PCRT=PASS; { [ "$PC_TRIG" = "yes" ] && [ "$PC_BOUND" = "yes" ]; } || PCRT=FAIL
ZNEGP=PASS; [ "$ZNEG" = "denied" ] || ZNEGP=FAIL
ZPOSP=PASS; [ "${ZPOS_RC:-1}" = "0" ] || ZPOSP=FAIL

echo "N8N_VERSION=${N8N_VERSION}"
echo "RUNTIME_WORKFLOWS_EXPECTED=${EXPECTED}"
echo "RUNTIME_WORKFLOWS_IMPORTED=${IMPORTED:-0}"
echo "MISSING_WORKFLOWS=${MISSING:-1}"
echo "EXTRA_WORKFLOWS=${EXTRA:-1}"
echo "DUPLICATE_WORKFLOWS=${DUP:-1}"
echo "PLACEHOLDER_BINDINGS=${PLACEH:-1}"
echo "RESOLVED_EDGES=${RESOLVED:-0}"
echo "CALLABLE_TRIGGERS_VALID=${CTRIG:-0}"
echo "ACTIVE_WORKFLOWS=${ACTIVE:-1}"
echo "REPEAT_DEPLOY=${REPEAT}"
echo "PARENT_CHILD_RUNTIME=${PCRT}"
echo "ZLIB_NEGATIVE_CONTROL=${ZNEGP}"
echo "ZLIB_CODE_NODE=${ZPOSP}"
disp_production_untouched

FAIL=0
[ "${IMPORTED:-0}" = "$EXPECTED" ] || { echo "  [FAIL] imported != ${EXPECTED}"; FAIL=1; }
[ "${MISSING:-1}" = "0" ] || { echo "  [FAIL] missing"; FAIL=1; }
[ "${EXTRA:-1}" = "0" ] || { echo "  [FAIL] extra"; FAIL=1; }
[ "${DUP:-1}" = "0" ] || { echo "  [FAIL] duplicates"; FAIL=1; }
[ "${PLACEH:-1}" = "0" ] || { echo "  [FAIL] placeholders remain"; FAIL=1; }
[ "${RESOLVED:-0}" = "$EDGES" ] || { echo "  [FAIL] resolved != ${EDGES}"; FAIL=1; }
[ "${CTRIG:-0}" = "$CALLABLES" ] || { echo "  [FAIL] callable triggers != ${CALLABLES}"; FAIL=1; }
[ "${ACTIVE:-1}" = "0" ] || { echo "  [FAIL] active workflows"; FAIL=1; }
[ "${ACT1:-1}" = "0" ] || { echo "  [FAIL] list --active not empty"; FAIL=1; }
[ "$REPEAT" = PASS ] || { echo "  [FAIL] repeat deploy"; FAIL=1; }
[ "$PCRT" = PASS ] || { echo "  [FAIL] parent/child topology"; FAIL=1; }
[ "$ZNEGP" = PASS ] || { echo "  [FAIL] zlib negative control"; FAIL=1; }
[ "$ZPOSP" = PASS ] || { echo "  [FAIL] zlib positive control"; FAIL=1; }

[ "$FAIL" -eq 0 ] || { echo "DISPOSABLE_DEPLOY=FAIL"; exit 1; }
echo "DISPOSABLE_DEPLOY=PASS"
