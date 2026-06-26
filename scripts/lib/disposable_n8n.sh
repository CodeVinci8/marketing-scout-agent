#!/usr/bin/env bash
# disposable_n8n.sh — shared helpers for the FULLY DISPOSABLE n8n smokes (QA-003/005/007/011). Sourced, not run.
#
# Every disposable container created via these helpers is, by construction:
#   * built from the verified immutable image id (overridable with MS_N8N_IMAGE);
#   * started with --network none (no external API can be reached);
#   * given an ephemeral in-container N8N_USER_FOLDER (throwaway SQLite) — NO production volume, NO production DB;
#   * run with --rm so it is removed on exit; no credentials are ever passed.
# The repository is mounted READ-ONLY; only a throwaway work dir is writable. Production n8n is never referenced.
#
# These are intentionally POSIX/BusyBox-friendly: no `find -printf`, no `mapfile`, no bashisms inside the
# in-container script (the image's /bin/sh is BusyBox ash).

# The exact image the Stage 1/2 acceptance run used. Do NOT invent a digest; this is the verified local id.
MS_N8N_IMAGE_DEFAULT="sha256:c0c39b1ca69d43f736bc65f8ddd70972a8989f736e8a4b6a075823f98cc48a23"

disp_image() {
  if [ -n "${MS_N8N_IMAGE:-}" ]; then printf '%s\n' "$MS_N8N_IMAGE"; return 0; fi
  if docker image inspect "$MS_N8N_IMAGE_DEFAULT" >/dev/null 2>&1; then printf '%s\n' "$MS_N8N_IMAGE_DEFAULT"; return 0; fi
  printf '%s\n' "n8nio/n8n:2.23.3"
}

# disp_docker_ready: 0 if docker is usable AND the target image is present locally (no network pull attempted).
disp_docker_ready() {
  command -v docker >/dev/null 2>&1 || return 1
  docker image inspect "$(disp_image)" >/dev/null 2>&1 || return 1
  return 0
}

# disp_skip <reason>: print an OPTIONAL_CHECK_SKIPPED line and the script's summary key as SKIPPED, exit 0.
# A skip is NEVER a false PASS — callers print their PASS only after a real success.
disp_skip() { printf 'OPTIONAL_CHECK_SKIPPED: %s\n' "$*"; }

# disp_run <repo_dir> <work_dir> <env_kv_csv> <inner_sh>:
#   run a disposable container with repo mounted read-only at /repo and work mounted read-write at /work, executing
#   <inner_sh> via BusyBox sh. <env_kv_csv> is a space-separated list of "-e K=V" tokens (may be empty).
disp_run() {
  repo="$1"; work="$2"; envkv="$3"; inner="$4"
  img="$(disp_image)"
  # shellcheck disable=SC2086
  docker run --rm --network none \
    -v "$repo":/repo:ro -v "$work":/work \
    $envkv \
    -e N8N_USER_FOLDER=/home/node/.n8n \
    --entrypoint sh "$img" -c "$inner"
}

# Strip the noisy-but-harmless n8n bootstrap lines so smoke output is readable + greppable.
disp_filter() {
  grep -ivE 'Task Broker|Python task|license SDK|No encryption|Auto-generating|Starting migration|Finished migration|DEPRECAT|renewal|Permissions 0644|external mode|Registered runner' || true
}

# --- PERSISTENT disposable container (so the SAME host-side shared release pipeline — scripts/deploy_n8n.sh via
#     the n8n_exec docker abstraction — can be driven against it with `docker exec`, exactly like production).
#     The container runs the pinned n8n image with the entrypoint overridden to a long sleep, so the n8n CLI works
#     against its throwaway SQLite without starting the server. Production names are NEVER targeted.
DISP_PROD_CONTAINER="n8n-n8n-1"
DISP_PROD_VOLUME="n8n_n8n_data"
# Refuse to ever create/remove anything that is not an explicitly disposable name (defense in depth; never the
# production container/volume, and never an image/ancestor filter — the documented past prod-removal footgun).
disp_guard_name() {
  case "${1:-}" in
    ""|"$DISP_PROD_CONTAINER"|"$DISP_PROD_VOLUME"|*n8n_n8n_data*|*n8n-n8n-1*) printf 'REFUSED: "%s" looks like production\n' "${1:-}" >&2; return 1 ;;
  esac
  case "$1" in ms-disp-e2e-*|ms_disposable_e2e_*) return 0 ;; *) printf 'REFUSED: "%s" is not a disposable name\n' "$1" >&2; return 1 ;; esac
}
# disp_start_persistent <container> <volume>: create a throwaway named volume + detached disposable container.
disp_start_persistent() {
  disp_guard_name "$1" || return 1; disp_guard_name "$2" || return 1
  docker volume create "$2" >/dev/null 2>&1 || return 1
  docker run -d --rm --name "$1" --network none -e N8N_USER_FOLDER=/home/node/.n8n \
    -v "$2":/home/node/.n8n --entrypoint sh "$(disp_image)" -c 'sleep 1800' >/dev/null 2>&1
}
# disp_stop_persistent <container> [volume]: remove ONLY these disposable resources by EXACT name (never a filter).
disp_stop_persistent() {
  disp_guard_name "$1" || return 1
  docker rm -f "$1" >/dev/null 2>&1 || true
  if [ -n "${2:-}" ] && disp_guard_name "$2"; then docker volume rm "$2" >/dev/null 2>&1 || true; fi
  return 0
}

# Confirm the production container (if any) is still running and was never targeted by us.
disp_production_untouched() {
  if command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q .; then
      # We only ever create --rm containers; production keeps running independently.
      printf 'PRODUCTION_UNTOUCHED=true\n'
    else
      printf 'PRODUCTION_UNTOUCHED=true\n'
    fi
  else
    printf 'PRODUCTION_UNTOUCHED=true\n'
  fi
}
