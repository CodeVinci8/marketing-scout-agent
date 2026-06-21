#!/usr/bin/env bash
# check_n8n_runtime.sh — report (and fail-closed on) the n8n image the operator actually runs vs. the version the
# repository was tested against (QA-010). Read-only: it inspects the compose file and the running container but
# NEVER modifies /opt/n8n/docker-compose.yml or any container.
#
# Reports: configured image reference, running n8n version, running image id, the tested repo version + image id,
# a floating-tag warning, and a version mismatch. A floating tag (":latest" or no tag) is treated as UNSAFE and
# fails non-zero unless MS_ALLOW_FLOATING_N8N_IMAGE=true. Optional checks that need docker/a running container are
# reported as OPTIONAL_CHECK_SKIPPED (never a false PASS) when the environment is unavailable.
#
# Usage:
#   scripts/check_n8n_runtime.sh [--compose <file>] [--container <name>]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="/opt/n8n/docker-compose.yml"
CONTAINER=""
# The exact image the Stage 1/2 acceptance run used (do NOT invent a digest; this is the verified local id).
TESTED_VERSION="$(node "${ROOT}/tools/manifest_lib.js" n8n-version 2>/dev/null || echo '2.23.3')"
TESTED_IMAGE_ID="sha256:c0c39b1ca69d43f736bc65f8ddd70972a8989f736e8a4b6a075823f98cc48a23"
ALLOW_FLOATING="${MS_ALLOW_FLOATING_N8N_IMAGE:-false}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --compose) COMPOSE="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1"; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
hr() { printf -- '----------------------------------------------------------------------\n'; }

FAIL=0
WARN=0

say "n8n runtime version check (read-only)"
hr
say "TESTED_REPO_VERSION=${TESTED_VERSION}"
say "TESTED_IMAGE_ID=${TESTED_IMAGE_ID}"

# --- configured image reference (from compose, read-only) -------------------------------------------------------
CONFIGURED_IMAGE=""
if [ -f "$COMPOSE" ]; then
  # first `image:` line under the n8n service; POSIX grep/sed (no GNU-only flags)
  CONFIGURED_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*' "$COMPOSE" | head -1 | sed 's/.*image:[[:space:]]*//; s/[[:space:]]*$//' | tr -d '"'"'"'')"
  say "COMPOSE_FILE=${COMPOSE}"
  say "CONFIGURED_IMAGE=${CONFIGURED_IMAGE:-<none found>}"
else
  say "COMPOSE_FILE=${COMPOSE} (not found) — OPTIONAL_CHECK_SKIPPED: configured image"
fi

# --- floating-tag safety (mandatory) ---------------------------------------------------------------------------
if [ -n "$CONFIGURED_IMAGE" ]; then
  TAG="${CONFIGURED_IMAGE##*:}"
  # "repo" with no ":" → $TAG == whole string → treat as floating (no explicit tag)
  case "$CONFIGURED_IMAGE" in
    *:*) : ;;
    *) TAG="latest (implicit)" ;;
  esac
  if [ "$TAG" = "latest" ] || [ "$TAG" = "latest (implicit)" ]; then
    if [ "$ALLOW_FLOATING" = "true" ]; then
      say "FLOATING_TAG_WARNING=true (overridden by MS_ALLOW_FLOATING_N8N_IMAGE=true)"; WARN=$((WARN+1))
    else
      say "FLOATING_TAG_UNSAFE=true — '${CONFIGURED_IMAGE}' is a floating tag; pin n8nio/n8n:${TESTED_VERSION}."
      say "  (override only if you accept the risk: MS_ALLOW_FLOATING_N8N_IMAGE=true)"; FAIL=$((FAIL+1))
    fi
  else
    say "CONFIGURED_TAG=${TAG}"
    if [ "$TAG" != "$TESTED_VERSION" ]; then say "VERSION_MISMATCH_WARNING=true (configured ${TAG} != tested ${TESTED_VERSION})"; WARN=$((WARN+1)); fi
  fi
fi

# --- running container introspection (optional; needs docker) --------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  if [ -z "$CONTAINER" ]; then
    CONTAINER="$(docker ps --filter ancestor=n8nio/n8n --format '{{.Names}}' 2>/dev/null | head -1 || true)"
    [ -z "$CONTAINER" ] && CONTAINER="$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk '/n8n/{print $1; exit}' || true)"
  fi
  if [ -n "$CONTAINER" ]; then
    RUNNING_VERSION="$(docker exec "$CONTAINER" n8n --version 2>/dev/null | head -1 || true)"
    RUNNING_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
    say "RUNNING_CONTAINER=${CONTAINER}"
    say "RUNNING_N8N_VERSION=${RUNNING_VERSION:-unknown}"
    say "RUNNING_IMAGE_ID=${RUNNING_IMAGE_ID:-unknown}"
    if [ -n "$RUNNING_VERSION" ] && [ "$RUNNING_VERSION" != "$TESTED_VERSION" ]; then
      say "RUNNING_VERSION_MISMATCH=true (running ${RUNNING_VERSION} != tested ${TESTED_VERSION})"; WARN=$((WARN+1))
    fi
    if [ -n "$RUNNING_IMAGE_ID" ] && [ "$RUNNING_IMAGE_ID" != "$TESTED_IMAGE_ID" ]; then
      say "RUNNING_IMAGE_ID_MISMATCH=true (running image id differs from the tested one)"; WARN=$((WARN+1))
    fi
  else
    say "OPTIONAL_CHECK_SKIPPED: no running n8n container found"
  fi
else
  say "OPTIONAL_CHECK_SKIPPED: docker not available — cannot inspect running container"
fi

hr
say "WARNINGS=${WARN}"
say "FAILURES=${FAIL}"
if [ "$FAIL" -ne 0 ]; then say "N8N_RUNTIME_CHECK=FAIL"; exit 1; fi
say "N8N_RUNTIME_CHECK=PASS"
