#!/usr/bin/env bash
# verify_source_parity.sh — RELEASE-SOURCE-PARITY-001 live entrypoint.
#
# Proves CONTENT equality between the running production workflows and the canonical branch (not just that
# ids/bindings/credentials reconcile). Read-only against production: it EXPORTS the live workflows + the
# NON-decrypted credential metadata (ids/names/types only — never --decrypted), STAGES the canonical set with
# those production ids/bindings/credential references, then fingerprint-compares each runtime workflow.
#
# Mutates NOTHING in production. Sanitized: prints committed file names + SHA fingerprints only (never a raw
# workflow id, credential id/name or secret). Fail-closed on any export failure.
#
#   MS_N8N_MODE=docker MS_N8N_CONTAINER=n8n-n8n-1 scripts/verify_source_parity.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/lib/n8n_exec.sh
. "${ROOT}/scripts/lib/n8n_exec.sh"

LOCAL_MAP="${MS_RUNTIME_ID_MAP:-config/runtime_ids.local.json}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
PE="$WORK/prod_export"; STG="$WORK/staged"; CRED="$WORK/creds_meta.json"
mkdir -p "$PE" "$STG"

n8n_available || { echo "SOURCE_PARITY=SKIP (no reachable n8n — set MS_N8N_MODE=docker MS_N8N_CONTAINER=n8n-n8n-1)"; exit 0; }

# --- 1) export the live workflows (separate -> <id>.json), docker-safely (write in container, copy OUT) ---
if [ "$(n8n_resolve_mode)" = "host" ]; then
  n8n_cli export:workflow --all --separate --output="$PE" >/dev/null 2>&1 || { echo "SOURCE_PARITY=FAIL (workflow export failed)"; exit 1; }
else
  cdir="/tmp/ms-parity-wf-$$"
  n8n_cli export:workflow --all --separate --output="$cdir" >/dev/null 2>&1 || { echo "SOURCE_PARITY=FAIL (workflow export failed)"; exit 1; }
  n8n_get "$cdir" "$PE" >/dev/null 2>&1 || { n8n_sh "rm -rf $cdir" >/dev/null 2>&1 || true; echo "SOURCE_PARITY=FAIL (workflow copy-out failed)"; exit 1; }
  n8n_sh "rm -rf $cdir" >/dev/null 2>&1 || true
fi
[ "$(find "$PE" -name '*.json' | wc -l)" -gt 0 ] || { echo "SOURCE_PARITY=FAIL (empty workflow export)"; exit 1; }

# --- 2) export NON-decrypted credential metadata (ids/names/types only) for reconciliation ---
if [ "$(n8n_resolve_mode)" = "host" ]; then
  n8n_cli export:credentials --all --output="$CRED" >/dev/null 2>&1 || CRED=""
else
  cdir="/tmp/ms-parity-cred-$$"; hdir="$(mktemp -d)"
  n8n_sh "mkdir -p $cdir" >/dev/null 2>&1 || true
  if n8n_cli export:credentials --all --output="$cdir/creds.json" >/dev/null 2>&1 && n8n_get "$cdir" "$hdir" >/dev/null 2>&1 && [ -f "$hdir/creds.json" ]; then
    mv -f "$hdir/creds.json" "$CRED"
  else
    CRED=""
  fi
  n8n_sh "rm -rf $cdir" >/dev/null 2>&1 || true; rm -rf "$hdir"
fi

# --- 3) stage the canonical set against the production ids/bindings/credential references ---
stage_args=( --out "$STG" --local "$LOCAL_MAP" )
[ -n "${CRED:-}" ] && [ -s "$CRED" ] && stage_args+=( --cred-export "$CRED" )
node tools/prepare_staged_workflows.js "${stage_args[@]}" >/dev/null 2>&1 || { echo "SOURCE_PARITY=FAIL (staging failed)"; exit 1; }

# --- 4) fingerprint-compare (sanitized) ---
node tools/verify_source_parity.js --prod "$PE" --staged "$STG" --local "$LOCAL_MAP"
