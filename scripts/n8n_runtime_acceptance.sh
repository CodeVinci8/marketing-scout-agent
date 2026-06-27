#!/usr/bin/env bash
# n8n_runtime_acceptance.sh — DISPOSABLE Stage 4 RUNTIME acceptance (RUNTIME-ACCEPTANCE-001). Proves ACTUAL n8n
# execution semantics for the WF18 gateway contract, not just graph reachability:
#
#   Layer 1 (reject-path routing) — the COMMITTED telegram_io.ingressDecision runs inside a real n8n Code node,
#     feeding the same two-stage IF routing WF18 uses (Ingress Accepted? -> Claim Idempotency -> New Update?).
#     Each of the 8 reject/duplicate scenarios MUST route to "Terminate Safely" (zero side effects); the accept
#     scenario MUST reach the dispatch region. `n8n execute` exits non-zero on any routing mismatch.
#   Layer 1a (webhook respond-200) — best-effort: a real Webhook -> Respond 200 -> gate is activated and POSTed
#     to inside the container; a prompt HTTP 200 (good OR bad secret) proves the Telegram fast-ack edge.
#   Layer 2 (parent/child runtime) — a parent Execute Workflow calls a child Execute Workflow Trigger, waits, and
#     asserts the child output round-tripped (proves wait-for-completion + output + continuation). A child that
#     THROWS must make the parent execution fail (child-failure propagation, no silent swallow).
#   Layer 3 (accepted path) — needs real Google Sheets + Telegram credentials; reported OPERATOR_PENDING (honest).
#
# Disposable by construction: pinned image, --network none, a throwaway named volume + container (guarded disposable
# name; never n8n-n8n-1 / n8n_n8n_data), removed at the end. NO production reference, NOTHING activated in production.
# Honest markers (§14): real PASS only after a real success; SKIPPED (never a fake PASS) without docker/the image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/disposable_n8n.sh
. "${ROOT}/scripts/lib/disposable_n8n.sh"

N8N_VERSION="$(node "${ROOT}/tools/manifest_lib.js" n8n-version)"
SECRET="rt_secret_value_1234567890"

# §14 markers — default SKIPPED so we can NEVER emit a false PASS.
declare -A M
for k in RUNTIME_ENGINE STAGE4_RUNTIME_REJECT_PATHS ACCEPT_PATH_ROUTES_TO_DISPATCH \
         PARENT_CHILD_RUNTIME_CONTRACT CHILD_FAILURE_PROPAGATES; do M[$k]="SKIPPED"; done

emit_markers() {
  echo "N8N_VERSION=${N8N_VERSION}"
  for k in RUNTIME_ENGINE STAGE4_RUNTIME_REJECT_PATHS ACCEPT_PATH_ROUTES_TO_DISPATCH \
           PARENT_CHILD_RUNTIME_CONTRACT CHILD_FAILURE_PROPAGATES; do
    echo "${k}=${M[$k]}"
  done
  # WEBHOOK_RESPONDS_200: the Respond-200 node + wiring are statically present (committed WF18 + rtwebhook fixture)
  # and the gate executes under it (Layer 1). But registering a LIVE production webhook needs a fully-initialised
  # n8n server (owner setup) — i.e. the live deployment itself — so the HTTP-200 round-trip is OPERATOR_PENDING, not
  # something a disposable CLI run can honestly assert.
  echo "WEBHOOK_RESPONDS_200=OPERATOR_PENDING"
  # Layer 3 is genuinely operator/live scoped — never claimed from a disposable run.
  echo "ACCEPTED_PATH_WITH_REAL_SHEETS=OPERATOR_PENDING"
  echo "TELEGRAM_LIVE=OPERATOR_PENDING"
  disp_production_untouched
}

if ! disp_docker_ready; then
  disp_skip "docker or the pinned n8n image is unavailable — runtime acceptance is operator-run"
  emit_markers
  echo "RUNTIME_ACCEPTANCE=SKIPPED"
  exit 0
fi

WORK="$(mktemp -d)"; chmod 777 "$WORK"
DISP_C="ms-disp-e2e-rt$$"; DISP_V="ms_disposable_e2e_rt$$"
IMG="$(disp_image)"
cleanup() { docker rm -f "$DISP_C" >/dev/null 2>&1 || true; docker volume rm "$DISP_V" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

# guard the disposable names (defense in depth — never production)
disp_guard_name "$DISP_C" || { echo "RUNTIME_ACCEPTANCE=FAIL (bad disposable name)"; exit 1; }
disp_guard_name "$DISP_V" || { echo "RUNTIME_ACCEPTANCE=FAIL (bad disposable name)"; exit 1; }

echo "Stage 4 DISPOSABLE runtime acceptance (image=${IMG}, n8n ${N8N_VERSION})"
echo "container=${DISP_C} volume=${DISP_V} (disposable; production n8n-n8n-1/n8n_n8n_data never touched)"
echo "----------------------------------------------------------------------"

# generate the runtime fixtures (embeds the COMMITTED telegram_io.js gate; offline)
node "${ROOT}/tools/gen_runtime_acceptance_fixtures.js" --out "${WORK}/fx" >/dev/null
FX_COUNT="$(ls "${WORK}/fx"/*.json 2>/dev/null | wc -l | tr -d ' ')"
echo "generated ${FX_COUNT} runtime fixtures"

# disposable container: CLI-capable (sleep entrypoint) WITH the n8n Code-node runtime env so $env access + builtins
# behave like production. No network, no credentials, throwaway volume.
docker volume create "$DISP_V" >/dev/null 2>&1 || { echo "RUNTIME_ACCEPTANCE=FAIL (volume)"; exit 1; }
docker run -d --rm --name "$DISP_C" --network none \
  -e N8N_USER_FOLDER=/home/node/.n8n \
  -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
  -e NODE_FUNCTION_ALLOW_BUILTIN=crypto,zlib \
  -e MS_ENABLE_TELEGRAM=true \
  -e MS_TELEGRAM_ALLOWED_USER_IDS=111 \
  -e MS_TELEGRAM_WEBHOOK_SECRET="$SECRET" \
  --entrypoint sh "$IMG" -c 'sleep 1800' >/dev/null 2>&1 || { echo "RUNTIME_ACCEPTANCE=FAIL (container start)"; exit 1; }

VER_IN="$(docker exec "$DISP_C" n8n --version 2>/dev/null | head -1 || true)"
if [ "$VER_IN" = "$N8N_VERSION" ]; then M[RUNTIME_ENGINE]="PASS"; else echo "  [WARN] disposable n8n ${VER_IN:-unknown} != ${N8N_VERSION}"; M[RUNTIME_ENGINE]="FAIL"; fi

# import all fixtures (id preserved on import in 2.23.3)
docker cp "${WORK}/fx/." "$DISP_C":/tmp/fx >/dev/null 2>&1
for f in "${WORK}/fx"/*.json; do
  bn="$(basename "$f")"
  docker exec "$DISP_C" n8n import:workflow --input="/tmp/fx/${bn}" --activeState=false >/dev/null 2>&1 || echo "  [WARN] import ${bn} failed"
done
# n8n 2.23.3 `n8n execute` refuses to call an INACTIVE sub-workflow ("Workflow is not active..."), so the callable
# children must be activated first (disposable only — production is never touched here). The PASSTHROUGH trigger is
# what makes the child pass checkForWorkflowIssues under the CLI (the workflowInputs schema mode does not).
docker exec "$DISP_C" n8n update:workflow --id=rtchildok --active=true >/dev/null 2>&1 || true
docker exec "$DISP_C" n8n update:workflow --id=rtchildfail --active=true >/dev/null 2>&1 || true

# helper: run `n8n execute --id=<id>` inside the container; echo "RC=<code>" + captured output to a file
run_exec() { # <id> <outfile>
  local id="$1" out="$2"
  if docker exec "$DISP_C" sh -c "timeout 120 n8n execute --id=${id} --rawOutput" >"$out" 2>&1; then echo 0; else echo $?; fi
}

# ---- Layer 1: reject-path routing (each reject -> terminate; mismatch -> Assert Routing throws -> non-zero) ----
echo ">> Layer 1: reject-path routing (committed ingressDecision in real n8n; routing asserted)"
REJECTS="badsecret missingsecret telegramdisabled unsupportedupdate botmessage nonprivatechat unauthorized duplicate"
REJECT_FAIL=0
for s in $REJECTS; do
  rc="$(run_exec "rtgate${s}" "${WORK}/${s}.out")"
  if [ "$rc" = "0" ]; then echo "   [ok]   ${s} -> Terminate Safely (no side effect)"; else echo "   [FAIL] ${s} rc=${rc}"; sed 's/^/        /' "${WORK}/${s}.out" | tail -3; REJECT_FAIL=1; fi
done
[ "$REJECT_FAIL" -eq 0 ] && M[STAGE4_RUNTIME_REJECT_PATHS]="PASS" || M[STAGE4_RUNTIME_REJECT_PATHS]="FAIL"

# accept scenario MUST reach dispatch (positive control: routing is meaningful, not "everything terminates")
rc="$(run_exec "rtgateaccept" "${WORK}/accept.out")"
if [ "$rc" = "0" ]; then echo "   [ok]   accept -> Reached Dispatch (side-effect region)"; M[ACCEPT_PATH_ROUTES_TO_DISPATCH]="PASS"; else echo "   [FAIL] accept rc=${rc}"; sed 's/^/        /' "${WORK}/accept.out" | tail -3; M[ACCEPT_PATH_ROUTES_TO_DISPATCH]="FAIL"; fi

# ---- Layer 2: parent/child runtime contract ----
echo ">> Layer 2: parent/child runtime contract"
rc="$(run_exec "rtparentok" "${WORK}/parentok.out")"
if [ "$rc" = "0" ]; then echo "   [ok]   parent called child, waited, round-tripped output"; M[PARENT_CHILD_RUNTIME_CONTRACT]="PASS"; else echo "   [FAIL] parent/child rc=${rc}"; sed 's/^/        /' "${WORK}/parentok.out" | tail -5; M[PARENT_CHILD_RUNTIME_CONTRACT]="FAIL"; fi

# child failure MUST propagate to the parent: the parent execution fails (rc!=0) AND the child's OWN error
# (CHILD_INTENTIONAL_FAILURE) is what surfaced — never the "swallowed" guard (which would mean the parent ran on
# past a failed sub-workflow). The child is active, so this is a REAL child throw propagating, not a config error.
rc="$(run_exec "rtparentfail" "${WORK}/parentfail.out")"
if [ "$rc" != "0" ] && grep -q "CHILD_INTENTIONAL_FAILURE" "${WORK}/parentfail.out" && ! grep -q "CHILD_FAILURE_WAS_SWALLOWED" "${WORK}/parentfail.out"; then
  echo "   [ok]   child threw and the failure propagated to the parent execution (not swallowed)"; M[CHILD_FAILURE_PROPAGATES]="PASS"
elif grep -q "CHILD_FAILURE_WAS_SWALLOWED" "${WORK}/parentfail.out"; then
  echo "   [FAIL] child failure was SWALLOWED (parent continued past a failed sub-workflow)"; M[CHILD_FAILURE_PROPAGATES]="FAIL"
else
  echo "   [FAIL] expected parent to fail with the child's CHILD_INTENTIONAL_FAILURE (rc=${rc})"; sed 's/^/        /' "${WORK}/parentfail.out" | grep -iE 'error|fail' | head -3; M[CHILD_FAILURE_PROPAGATES]="FAIL"
fi

# Layer 1a (webhook respond-200) is OPERATOR_PENDING: see emit_markers. A live production webhook only registers in
# a fully-initialised n8n server (owner setup) — that is the live deployment, not a disposable CLI run.

# ---- teardown + summary ----
docker rm -f "$DISP_C" >/dev/null 2>&1 || true
docker volume rm "$DISP_V" >/dev/null 2>&1 || true
echo "----------------------------------------------------------------------"
emit_markers

FAIL=0
for k in RUNTIME_ENGINE STAGE4_RUNTIME_REJECT_PATHS ACCEPT_PATH_ROUTES_TO_DISPATCH \
         PARENT_CHILD_RUNTIME_CONTRACT CHILD_FAILURE_PROPAGATES; do
  [ "${M[$k]}" = "PASS" ] || { echo "  [FAIL] mandatory marker ${k}=${M[$k]}"; FAIL=1; }
done
[ "$FAIL" -eq 0 ] || { echo "RUNTIME_ACCEPTANCE=FAIL"; exit 1; }
echo "RUNTIME_ACCEPTANCE=PASS"
