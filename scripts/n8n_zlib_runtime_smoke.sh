#!/usr/bin/env bash
# n8n_zlib_runtime_smoke.sh — prove, in a FULLY DISPOSABLE n8n 2.23.3 container, that the XLSX writer's use of
# Node's built-in zlib in a Code node (a) FAILS in a controlled way without NODE_FUNCTION_ALLOW_BUILTIN=zlib
# (negative control) and (b) SUCCEEDS with it set, round-tripping a known string (positive control). QA-005.
#
# Disposable by construction (see scripts/lib/disposable_n8n.sh): verified image id, --network none, throwaway
# in-container SQLite, repo mounted read-only, --rm, no credentials, no production volume, nothing activated.
#
# Machine-readable output:
#   ZLIB_NEGATIVE_CONTROL=PASS|FAIL
#   ZLIB_CODE_NODE=PASS|FAIL
#   PRODUCTION_UNTOUCHED=true
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/disposable_n8n.sh
. "${ROOT}/scripts/lib/disposable_n8n.sh"

if ! disp_docker_ready; then
  disp_skip "docker or the n8n image is unavailable — zlib runtime smoke needs the disposable container"
  echo "ZLIB_NEGATIVE_CONTROL=SKIPPED"; echo "ZLIB_CODE_NODE=SKIPPED"; echo "PRODUCTION_UNTOUCHED=true"
  exit 0
fi

WORK="$(mktemp -d)"; chmod 777 "$WORK"
trap 'rm -rf "$WORK"' EXIT

FIX="/repo/tests/fixtures/n8n/zlib_roundtrip.json"
NEG_INNER='
  n8n import:workflow --input='"$FIX"' --activeState=false >/dev/null 2>&1
  timeout 180 n8n execute --id=fixturezlibroundtrip --rawOutput >/work/neg.json 2>/work/neg.err
  rc=$?
  if [ "$rc" -ne 0 ] && grep -qi "disallowed" /work/neg.json /work/neg.err 2>/dev/null; then
    echo "NEG_RESULT=denied"
  else
    echo "NEG_RESULT=unexpected(rc=$rc)"
  fi
'
POS_INNER='
  n8n import:workflow --input='"$FIX"' --activeState=false >/dev/null 2>&1
  # The fixture throws if the round trip is wrong (and require(zlib) throws if disallowed), so a zero exit code is a
  # reliable PASS signal — no fragile parsing of the noise-prefixed --rawOutput stream.
  if timeout 180 n8n execute --id=fixturezlibroundtrip --rawOutput >/dev/null 2>&1; then echo "POS_RESULT=ok"; else echo "POS_RESULT=fail(rc=$?)"; fi
'

echo "n8n zlib Code-node runtime smoke (image=$(disp_image))"
echo "----------------------------------------------------------------------"
echo ">> negative control (no NODE_FUNCTION_ALLOW_BUILTIN) — expect controlled denial"
NEG_OUT="$(disp_run "$ROOT" "$WORK" "" "$NEG_INNER" 2>&1 | disp_filter || true)"
printf '%s\n' "$NEG_OUT" | grep -E 'NEG_RESULT' || true
echo ">> positive control (NODE_FUNCTION_ALLOW_BUILTIN=zlib) — expect round trip ok"
POS_OUT="$(disp_run "$ROOT" "$WORK" "-e NODE_FUNCTION_ALLOW_BUILTIN=zlib" "$POS_INNER" 2>&1 | disp_filter || true)"
printf '%s\n' "$POS_OUT" | grep -E 'POS_RESULT' || true
echo "----------------------------------------------------------------------"

NEG_PASS=FAIL; POS_PASS=FAIL
printf '%s\n' "$NEG_OUT" | grep -q 'NEG_RESULT=denied' && NEG_PASS=PASS
printf '%s\n' "$POS_OUT" | grep -q 'POS_RESULT=ok' && POS_PASS=PASS

echo "ZLIB_NEGATIVE_CONTROL=${NEG_PASS}"
echo "ZLIB_CODE_NODE=${POS_PASS}"
disp_production_untouched

# Mandatory: both controls must pass, else exit non-zero (no false PASS).
[ "$NEG_PASS" = PASS ] && [ "$POS_PASS" = PASS ] || { echo "ZLIB_RUNTIME_SMOKE=FAIL"; exit 1; }
echo "ZLIB_RUNTIME_SMOKE=PASS"
