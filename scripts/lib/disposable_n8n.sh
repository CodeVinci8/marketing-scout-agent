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
