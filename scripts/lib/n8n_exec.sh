#!/usr/bin/env sh
# n8n_exec.sh — Docker-only-safe n8n execution abstraction (DEPLOY-001 / BACKUP-001). Sourced, not run.
#
# Resolves HOW to invoke the n8n CLI and HOW to run /bin/sh in the n8n environment, supporting the real
# Docker-only production VPS (the host has NO `n8n` binary; the container's image entrypoint is `n8n`, it has
# /bin/sh but NOT bash):
#   * host CLI mode    — a real `n8n` binary on PATH (dev / CI box).
#   * docker exec mode — production/operator path: `docker exec <container> n8n …` and `… /bin/sh -c …`.
#   * docker run mode  — disposable/backup path: `docker run --rm --entrypoint /bin/sh <image> -c …`
#                        (the entrypoint MUST be overridden to /bin/sh — invoking `sh` without overriding the
#                        `n8n` entrypoint is the BACKUP-001 defect).
#   * explicit override — MS_N8N_MODE=host|docker.
#   * dry/echo mode    — MS_N8N_EXEC_DRY=1 prints the command (prefixed DRYEXEC:) and runs NOTHING. Safe for
#                        rehearsal on a host without docker and for offline tests.
#
# Knobs (all optional; safe defaults):
#   MS_N8N_MODE=auto|host|docker          (default auto)
#   MS_N8N_CONTAINER=n8n-n8n-1            (production container name)
#   MS_N8N_COMPOSE_PROJECT / MS_N8N_SERVICE   (resolve the container via `docker compose ps -q` if both set)
#   MS_N8N_IMAGE=n8nio/n8n:2.23.3         (pinned image for docker-run paths; never `latest`)
#   MS_N8N_DATA_PATH=/home/node/.n8n      (n8n data dir inside the container)
#   MS_N8N_EXEC_DRY=1                      (print, do not execute)
#
# POSIX sh only (no bashisms) so it is sourceable by both the bash deploy script and the /bin/sh backup script.
# It NEVER performs a destructive docker operation; n8n_guard_destructive refuses the forbidden patterns.

MS_N8N_MODE="${MS_N8N_MODE:-auto}"
MS_N8N_CONTAINER="${MS_N8N_CONTAINER:-n8n-n8n-1}"
MS_N8N_IMAGE="${MS_N8N_IMAGE:-n8nio/n8n:2.23.3}"
MS_N8N_DATA_PATH="${MS_N8N_DATA_PATH:-/home/node/.n8n}"

n8n_exec_log() { printf '%s\n' "$*" >&2; }

# Refuse the forbidden destructive operations no matter who builds the string (defense in depth).
# Returns 1 (and logs) if the command text contains a banned pattern.
n8n_guard_destructive() {
  case "$*" in
    *"down -v"*|*"down --volumes"*|*"volume rm"*|*"volume prune"*|*"system prune"*|*"--decrypted"*|*" rm -f "*"n8n_n8n_data"*)
      n8n_exec_log "REFUSED destructive/forbidden operation: $*"; return 1 ;;
  esac
  return 0
}

# Echo the resolved execution mode: host | docker.
n8n_resolve_mode() {
  case "$MS_N8N_MODE" in
    host) printf 'host\n'; return 0 ;;
    docker) printf 'docker\n'; return 0 ;;
  esac
  if command -v n8n >/dev/null 2>&1; then printf 'host\n'; else printf 'docker\n'; fi
}

# Echo the resolved container name (compose lookup when MS_N8N_COMPOSE_PROJECT + MS_N8N_SERVICE are both set).
n8n_resolve_container() {
  if [ -n "${MS_N8N_COMPOSE_PROJECT:-}" ] && [ -n "${MS_N8N_SERVICE:-}" ] && command -v docker >/dev/null 2>&1; then
    cid=$(docker compose -p "$MS_N8N_COMPOSE_PROJECT" ps -q "$MS_N8N_SERVICE" 2>/dev/null | head -1)
    [ -n "$cid" ] && { printf '%s\n' "$cid"; return 0; }
  fi
  printf '%s\n' "$MS_N8N_CONTAINER"
}

# Internal: either print the command (dry) or execute the argv (real). Never uses eval.
_n8n_emit_or_run() {
  n8n_guard_destructive "$@" || return 2
  if [ "${MS_N8N_EXEC_DRY:-0}" = "1" ]; then
    printf 'DRYEXEC: %s\n' "$*"
    return 0
  fi
  "$@"
}

# Run the n8n CLI with the given args (host: n8n …; docker: docker exec <c> n8n …).
n8n_cli() {
  if [ "$(n8n_resolve_mode)" = "host" ]; then
    _n8n_emit_or_run n8n "$@"
  else
    _n8n_emit_or_run docker exec "$(n8n_resolve_container)" n8n "$@"
  fi
}

# Copy a host DIRECTORY's contents INTO the n8n environment so the CLI can read them. In docker mode the n8n CLI
# runs INSIDE the container via `docker exec`, so a host path is invisible to it — staged workflows / import
# inputs MUST be copied in first (this is why a docker-mode `import:workflow --input=<host path>` fails with
# ENOENT). Host mode is a plain cp. n8n_put <host_src_dir> <env_dest_dir>.
n8n_put() {
  src="$1"; dest="$2"
  if [ "$(n8n_resolve_mode)" = "host" ]; then
    _n8n_emit_or_run /bin/sh -c "mkdir -p \"$dest\" && cp -a \"$src/.\" \"$dest/\""
  else
    c="$(n8n_resolve_container)"
    _n8n_emit_or_run docker exec "$c" mkdir -p "$dest"
    _n8n_emit_or_run docker cp "$src/." "$c:$dest"
  fi
}

# The OS user the n8n runtime (and thus the n8n CLI inside the container) executes as. `docker cp` preserves the
# HOST file owner (root) and the HOST umask mode (0600 under `umask 077`), so a non-root container user cannot read
# the copied file — the DOCKER-COPY-PERM-001 EACCES. Verified on the production image: `id node` -> uid=1000(node).
# Overridable for other images via MS_N8N_RUNTIME_USER, but the existence of the user is VERIFIED before use.
n8n_runtime_user() { printf '%s\n' "${MS_N8N_RUNTIME_USER:-node}"; }

# DOCKER-COPY-PERM-001: make an ALREADY-copied-in container path readable by the n8n runtime user WITHOUT making it
# world-readable. As ROOT inside the container: verify the runtime user exists (never assume), chown the whole tree
# to it, set LEAST-PRIVILEGE modes (directories 0700, files 0600 — never a+r / 0644 / 0777), then VERIFY the runtime
# user can actually read every regular file and FAIL CLOSED (removing the path) if not. No file contents are printed.
#   n8n_make_runtime_readable <container> <container_path>
n8n_make_runtime_readable() {
  c="$1"; p="$2"; u="$(n8n_runtime_user)"
  [ -n "$c" ] && [ -n "$p" ] || { n8n_exec_log "n8n_make_runtime_readable: container and path are required"; return 2; }
  if [ "${MS_N8N_EXEC_DRY:-0}" = "1" ]; then printf 'DRYEXEC: make-runtime-readable %s %s as %s\n' "$c" "$p" "$u"; return 0; fi
  # the runtime user MUST exist in the container — do not assume the username (DOCKER-COPY-PERM-001 requirement)
  docker exec -u 0 "$c" id "$u" >/dev/null 2>&1 || { n8n_exec_log "n8n_make_runtime_readable: runtime user '$u' not present in container"; return 1; }
  docker exec -u 0 "$c" chown -R "$u":"$u" "$p" \
    && docker exec -u 0 "$c" find "$p" -type d -exec chmod 0700 {} + \
    && docker exec -u 0 "$c" find "$p" -type f -exec chmod 0600 {} + \
    && docker exec -u "$u" "$c" /bin/sh -c 'p="$1"; find "$p" -type f | while IFS= read -r f; do [ -r "$f" ] || { echo "RUNTIME_USER_CANNOT_READ" >&2; exit 1; }; done' sh "$p"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    n8n_exec_log "n8n_make_runtime_readable: FAIL-CLOSED (rc=$rc) — removing $p"
    docker exec -u 0 "$c" rm -rf "$p" >/dev/null 2>&1 || true
    return 1
  fi
  return 0
}

# DOCKER-COPY-PERM-001-safe copy-IN. Stage a host file/dir tree INTO the n8n container so the CLI (running as the
# runtime user) can read it EVEN when the host source is private (mode 0600 under `umask 077`). The host source is
# never modified and never made world-readable; inside the container the copy is owned by the runtime user with
# least-privilege modes (see n8n_make_runtime_readable). Host mode keeps a private cp -a (the CLI is the caller).
# Prefer this over n8n_put for ANYTHING the n8n CLI must read after copy-in. n8n_put_for_runtime <host_src_dir> <container_dest_dir>
n8n_put_for_runtime() {
  src="$1"; dest="$2"
  if [ "$(n8n_resolve_mode)" = "host" ]; then
    _n8n_emit_or_run /bin/sh -c "mkdir -p \"$dest\" && cp -a \"$src/.\" \"$dest/\""
    return $?
  fi
  c="$(n8n_resolve_container)"
  _n8n_emit_or_run docker exec "$c" mkdir -p "$dest" || return 1
  _n8n_emit_or_run docker cp "$src/." "$c:$dest" || { [ "${MS_N8N_EXEC_DRY:-0}" = "1" ] || docker exec -u 0 "$c" rm -rf "$dest" >/dev/null 2>&1 || true; return 1; }
  n8n_make_runtime_readable "$c" "$dest"
}

# Copy a DIRECTORY's contents OUT of the n8n environment to the host (e.g. an export so a host-side tool can read
# it). Host mode is a plain cp. n8n_get <env_src_dir> <host_dest_dir>.
n8n_get() {
  src="$1"; dest="$2"
  mkdir -p "$dest" 2>/dev/null || true
  if [ "$(n8n_resolve_mode)" = "host" ]; then
    _n8n_emit_or_run /bin/sh -c "cp -a \"$src/.\" \"$dest/\" 2>/dev/null || true"
  else
    c="$(n8n_resolve_container)"
    _n8n_emit_or_run docker cp "$c:$src/." "$dest"
  fi
}

# Run an sh script inside the n8n environment (host: /bin/sh -c …; docker: docker exec <c> /bin/sh -c …).
n8n_sh() {
  script="$1"
  if [ "$(n8n_resolve_mode)" = "host" ]; then
    _n8n_emit_or_run /bin/sh -c "$script"
  else
    _n8n_emit_or_run docker exec "$(n8n_resolve_container)" /bin/sh -c "$script"
  fi
}

# Run an sh script in a DISPOSABLE container built from the pinned image, OVERRIDING the n8n entrypoint with
# /bin/sh (BACKUP-001). Extra `docker run` args (e.g. volume mounts) may precede the script via "$@" after it.
#   n8n_run_image_sh "<inner sh>" [extra docker run args…]
n8n_run_image_sh() {
  script="$1"; shift
  _n8n_emit_or_run docker run --rm --entrypoint /bin/sh "$@" "$MS_N8N_IMAGE" -c "$script"
}

# True (0) if n8n is reachable: host CLI present, or docker present and the resolved container is running.
n8n_available() {
  if [ "${MS_N8N_EXEC_DRY:-0}" = "1" ]; then return 0; fi
  if [ "$(n8n_resolve_mode)" = "host" ]; then command -v n8n >/dev/null 2>&1 && return 0 || return 1; fi
  command -v docker >/dev/null 2>&1 || return 1
  c="$(n8n_resolve_container)"
  docker ps --format '{{.Names}} {{.ID}}' 2>/dev/null | grep -q -e "$c" && return 0
  return 1
}

# Echo the n8n version string (host or container). Empty on failure — and empty must mean EMPTY, not a fatal
# status. CI-HERMETIC-001: this used to run `docker exec … n8n --version` unconditionally, ignoring the DRY
# executor. Under the callers' `set -euo pipefail`, a missing docker binary (127) or an absent container (1)
# turned the command substitution in detect_n8n_version() into a silent script-wide exit, so the deploy
# entrypoint suite only passed on a host where a real n8n container answered — i.e. the production VPS. It
# failed in a clean GitHub runner. Now: DRY mode executes nothing (as documented), and any failure yields the
# empty string, which detect_n8n_version() already handles as version "unknown".
n8n_version_string() {
  if [ "${MS_N8N_EXEC_DRY:-0}" = "1" ]; then return 0; fi
  if [ "$(n8n_resolve_mode)" = "host" ]; then n8n --version 2>/dev/null | head -1 || true; else
    docker exec "$(n8n_resolve_container)" n8n --version 2>/dev/null | head -1 || true; fi
}
