#!/usr/bin/env bash
# configure_telegram_commands.sh — set the EXACT public Telegram command menu for Vinci AI Pilot.
#
# Safe by default: runs as a DRY-RUN (zero network requests) unless --live is passed. The bot token is read
# ONLY from the environment variable MS_TELEGRAM_BOT_TOKEN — never accepted as a CLI argument, never printed,
# and never placed on a command line (curl reads the URL from a stdin config so the token cannot leak into the
# process list). Live mode calls the official Telegram setMyCommands then getMyCommands and verifies the exact
# command order + exact Russian descriptions, failing closed on ok=false, malformed JSON, a missing token, or
# any mismatch. It is idempotent (re-running yields the same menu), calls NO non-Telegram API, does NOT register
# the webhook, and does NOT activate any workflow.
#
# Usage:
#   MS_TELEGRAM_BOT_TOKEN=... scripts/configure_telegram_commands.sh            # dry-run (default, no network)
#   MS_TELEGRAM_BOT_TOKEN=... scripts/configure_telegram_commands.sh --live     # apply + verify via Telegram
#   scripts/configure_telegram_commands.sh --print-commands                     # print canonical menu only
# Flags: --live  --dry-run  --no-language  --print-commands  --help
set -euo pipefail

API_BASE="https://api.telegram.org"
LANGUAGE_CODE="ru"
MODE="dry-run"
USE_LANGUAGE=1
PRINT_ONLY=0

# Canonical PUBLIC command menu (exact order + exact Russian descriptions). No internal/destructive commands.
CMD_NAMES=("start" "help" "new" "status" "cancel")
CMD_DESCS=(
  "Запустить агента и показать примеры задач"
  "Возможности агента и примеры запросов"
  "Начать новую задачу"
  "Статус текущей задачи"
  "Отменить текущую задачу"
)

usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --live) MODE="live" ;;
    --dry-run) MODE="dry-run" ;;
    --no-language) USE_LANGUAGE=0 ;;
    --print-commands) PRINT_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    bot*|*:*) echo "FAIL: refusing a token-shaped CLI argument — set MS_TELEGRAM_BOT_TOKEN in the environment instead." >&2; exit 2 ;;
    *) echo "FAIL: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# Build the setMyCommands JSON body via python3 (no jq dependency); language_code optional.
build_payload() {
  USE_LANGUAGE="$USE_LANGUAGE" LANGUAGE_CODE="$LANGUAGE_CODE" \
  NAMES="${CMD_NAMES[*]}" DESCS_0="${CMD_DESCS[0]}" DESCS_1="${CMD_DESCS[1]}" DESCS_2="${CMD_DESCS[2]}" \
  DESCS_3="${CMD_DESCS[3]}" DESCS_4="${CMD_DESCS[4]}" python3 - <<'PY'
import json, os
names = os.environ["NAMES"].split()
descs = [os.environ["DESCS_%d" % i] for i in range(5)]
body = {"commands": [{"command": n, "description": d} for n, d in zip(names, descs)]}
if os.environ.get("USE_LANGUAGE") == "1":
    body["language_code"] = os.environ["LANGUAGE_CODE"]
print(json.dumps(body, ensure_ascii=False))
PY
}

print_human_menu() {
  local i
  for i in "${!CMD_NAMES[@]}"; do
    printf '%s - %s\n' "${CMD_NAMES[$i]}" "${CMD_DESCS[$i]}"
  done
}

if [ "$PRINT_ONLY" -eq 1 ]; then
  print_human_menu
  exit 0
fi

# Token presence (masked — the value is NEVER printed).
TOKEN="${MS_TELEGRAM_BOT_TOKEN:-}"
if [ -n "$TOKEN" ]; then echo "MS_TELEGRAM_BOT_TOKEN: present (masked)"; else echo "MS_TELEGRAM_BOT_TOKEN: MISSING"; fi

PAYLOAD="$(build_payload)"
echo "Canonical command menu (exact order + Russian descriptions):"
print_human_menu
echo "setMyCommands payload:"
echo "$PAYLOAD"

if [ "$MODE" = "dry-run" ]; then
  echo "DRY-RUN: 0 network requests made. Re-run with --live to apply via Telegram."
  echo "PASS: dry-run rendered the canonical menu (no token printed, no network)."
  exit 0
fi

# ---- live mode -----------------------------------------------------------------------------------------------
if [ -z "$TOKEN" ]; then echo "FAIL: MS_TELEGRAM_BOT_TOKEN is not set; cannot call Telegram." >&2; exit 1; fi
command -v curl >/dev/null 2>&1 || { echo "FAIL: curl is required for --live." >&2; exit 1; }

# curl reads the URL + POST body from a stdin config so the token never appears in argv / the process list.
tg_post() { # $1=method  $2=json-body
  local method="$1" body="$2"
  printf 'url = "%s/bot%s/%s"\ndata = "%s"\nheader = "Content-Type: application/json"\n' \
    "$API_BASE" "$TOKEN" "$method" "${body//\"/\\\"}" \
    | curl -sS --config - 2>/dev/null
}
tg_get() { # $1=method
  printf 'url = "%s/bot%s/%s"\n' "$API_BASE" "$TOKEN" "$1" | curl -sS --config - 2>/dev/null
}

echo "LIVE: calling setMyCommands ..."
SET_RESP="$(tg_post "setMyCommands" "$PAYLOAD")"
echo "$SET_RESP" | python3 -c 'import json,sys
try: r=json.load(sys.stdin)
except Exception as e: print("FAIL: malformed setMyCommands response"); sys.exit(1)
sys.exit(0 if r.get("ok") is True else (print("FAIL: setMyCommands ok=false") or 1))' || exit 1

echo "LIVE: verifying via getMyCommands ..."
GET_METHOD="getMyCommands"
GET_RESP="$(tg_get "$GET_METHOD")"
EXPECTED="$PAYLOAD" python3 -c '
import json, os, sys
try: r = json.load(sys.stdin)
except Exception: print("FAIL: malformed getMyCommands response"); sys.exit(1)
if r.get("ok") is not True: print("FAIL: getMyCommands ok=false"); sys.exit(1)
got = r.get("result", [])
exp = json.loads(os.environ["EXPECTED"])["commands"]
if len(got) != len(exp): print("FAIL: command count mismatch (got %d, expected %d)" % (len(got), len(exp))); sys.exit(1)
for i, (g, e) in enumerate(zip(got, exp)):
    if g.get("command") != e["command"] or g.get("description") != e["description"]:
        print("FAIL: command %d mismatch" % i); sys.exit(1)
print("PASS: Telegram command menu matches the canonical Russian menu exactly (%d commands)." % len(exp))
' <<<"$GET_RESP" || exit 1

echo "PASS: setMyCommands applied and verified. Idempotent; no webhook registered; no workflow activated."
exit 0
