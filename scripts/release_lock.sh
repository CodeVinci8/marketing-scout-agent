#!/usr/bin/env bash
# release_lock.sh — host-side release lock to prevent two concurrent deploys (RELEASE-004).
#
# A lock is an atomically-created directory (.release.lock, gitignored) holding owner metadata. A second acquire
# fails non-zero unless the existing lock is STALE (owner pid not alive AND older than the TTL), in which case it
# is reported and re-taken. `release` removes only a lock this owner holds; `--force` unlock is explicit.
#
# Usage:
#   scripts/release_lock.sh acquire [--owner NAME]    # exit 0 if acquired, non-zero on contention
#   scripts/release_lock.sh status
#   scripts/release_lock.sh release [--owner NAME]
#   scripts/release_lock.sh unlock --force            # break any lock (operator override)
# Knobs: MS_RELEASE_LOCK (default <repo>/.release.lock), MS_RELEASE_LOCK_TTL_SEC (default 3600).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="${MS_RELEASE_LOCK:-${ROOT}/.release.lock}"
TTL="${MS_RELEASE_LOCK_TTL_SEC:-3600}"

SUB="${1:-status}"; shift || true
OWNER="${USER:-operator}@$(hostname 2>/dev/null || echo host)"
FORCE="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --owner) shift; OWNER="${1:-$OWNER}" ;;
    --force) FORCE="yes" ;;
    *) echo "Unknown argument: $1"; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
meta() { [ -f "${LOCK}/owner" ] && cat "${LOCK}/owner" 2>/dev/null || true; }
lock_pid() { [ -f "${LOCK}/pid" ] && cat "${LOCK}/pid" 2>/dev/null || echo ""; }
lock_age() {
  [ -d "$LOCK" ] || { echo 0; return; }
  local now mt; now="$(date +%s)"; mt="$(stat -c %Y "$LOCK" 2>/dev/null || echo "$now")"
  echo $(( now - mt ))
}
pid_alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }

# Conservative: a lock is stale ONLY if its owner pid is not alive AND it is older than the TTL. If the OS has
# recycled the pid to an unrelated live process we treat the lock as held (never wrongly steal an active lock);
# the operator override is `unlock --force`.
is_stale() {
  local pid age; pid="$(lock_pid)"; age="$(lock_age)"
  if pid_alive "$pid"; then return 1; fi
  [ "$age" -gt "$TTL" ]
}

case "$SUB" in
  acquire)
    if mkdir "$LOCK" 2>/dev/null; then
      printf '%s\n' "$OWNER" > "${LOCK}/owner"; printf '%s\n' "$$" > "${LOCK}/pid"; date -u +%Y-%m-%dT%H:%M:%SZ > "${LOCK}/since"
      say "RELEASE_LOCK=ACQUIRED owner=${OWNER}"
      exit 0
    fi
    if is_stale; then
      say "  [warn] breaking STALE lock (owner=$(meta) pid=$(lock_pid) age=$(lock_age)s > ${TTL}s)"
      rm -rf "$LOCK"; mkdir "$LOCK"
      printf '%s\n' "$OWNER" > "${LOCK}/owner"; printf '%s\n' "$$" > "${LOCK}/pid"; date -u +%Y-%m-%dT%H:%M:%SZ > "${LOCK}/since"
      say "RELEASE_LOCK=ACQUIRED owner=${OWNER} (stole stale lock)"
      exit 0
    fi
    say "RELEASE_LOCK=CONTENDED held by $(meta) pid=$(lock_pid) age=$(lock_age)s"
    exit 1
    ;;
  status)
    if [ -d "$LOCK" ]; then say "RELEASE_LOCK=HELD owner=$(meta) pid=$(lock_pid) age=$(lock_age)s stale=$(is_stale && echo yes || echo no)";
    else say "RELEASE_LOCK=FREE"; fi
    ;;
  release)
    if [ ! -d "$LOCK" ]; then say "RELEASE_LOCK=FREE (nothing to release)"; exit 0; fi
    if [ "$(meta)" = "$OWNER" ] || [ "$FORCE" = "yes" ]; then rm -rf "$LOCK"; say "RELEASE_LOCK=RELEASED"; exit 0; fi
    say "RELEASE_LOCK=DENIED (held by $(meta), not ${OWNER}; use unlock --force)"; exit 1
    ;;
  unlock)
    [ "$FORCE" = "yes" ] || { say "unlock requires --force"; exit 2; }
    rm -rf "$LOCK"; say "RELEASE_LOCK=UNLOCKED (forced)"
    ;;
  *)
    say "usage: scripts/release_lock.sh <acquire|status|release|unlock> [--owner NAME] [--force]"; exit 2
    ;;
esac
