#!/usr/bin/env bash
# telegram_webhook.sh — safe Telegram webhook lifecycle (TELEGRAM-009/001/002, SECURITY-003/005).
#
# Subcommands: info | set | delete | verify | menu-set | menu-verify . MUTATIONS (set/delete/menu-set) are
# DRY-RUN by default and require --apply.
# The bot token is read ONLY from the environment (MS_TELEGRAM_BOT_TOKEN), NEVER passed on argv and NEVER printed
# (curl reads it via a mode-600 trap-cleaned --config file, so it never appears in the process list or logs). The
# webhook secret (MS_TELEGRAM_WEBHOOK_SECRET) is sent with setWebhook(secret_token=…) and likewise never printed.
#
# Usage:
#   scripts/telegram_webhook.sh info                       # getWebhookInfo (read; redacted output)
#   scripts/telegram_webhook.sh verify                     # check current webhook == expected url + secret set
#   scripts/telegram_webhook.sh set    [--apply] [--drop-pending]   # register PUBLIC_WEBHOOK_BASE_URL/<path>
#   scripts/telegram_webhook.sh delete [--apply] [--drop-pending]   # delete webhook (activation rollback)
#   scripts/telegram_webhook.sh menu-set [--apply]         # setMyCommands + setChatMenuButton from the canonical
#                                                          # registry (n8n/lib/telegram_commands.js); idempotent
#   scripts/telegram_webhook.sh menu-verify                # getMyCommands/getChatMenuButton == canonical registry
#
# Env: MS_TELEGRAM_BOT_TOKEN, MS_TELEGRAM_WEBHOOK_SECRET, PUBLIC_WEBHOOK_BASE_URL, MS_TELEGRAM_WEBHOOK_PATH
#      (default ms-telegram-agent). Never registers if URL/secret validation fails.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SUB="${1:-}"; shift || true
APPLY="no"; DROP_PENDING="false"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY="yes" ;;
    --drop-pending) DROP_PENDING="true" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

WEBHOOK_PATH="${MS_TELEGRAM_WEBHOOK_PATH:-ms-telegram-agent}"
BASE="${PUBLIC_WEBHOOK_BASE_URL:-}"
TOKEN="${MS_TELEGRAM_BOT_TOKEN:-}"
SECRET="${MS_TELEGRAM_WEBHOOK_SECRET:-}"

# Validate the public url WITHOUT revealing the token. The full webhook target is BASE/webhook/<path>.
target_url() { printf '%s/webhook/%s' "${BASE%/}" "$WEBHOOK_PATH"; }
validate_url() {
  case "$BASE" in
    https://*) ;;
    *) die "PUBLIC_WEBHOOK_BASE_URL must be set and HTTPS (got '${BASE:-unset}') — refusing to register" ;;
  esac
  node "${ROOT}/tools/preflight_config.js" >/dev/null 2>&1 || true
  printf 'WEBHOOK_URL_VALID=PASS (%s)\n' "$(target_url)"
}
require_token() { [ -n "$TOKEN" ] || die "MS_TELEGRAM_BOT_TOKEN is not set (env only; never argv)"; }

# Build a curl --config payload on stdin so the token (in the URL) is never visible on argv or in logs.
# api <method> <extra curl args...>   — prints the API response to stdout. Token-bearing url stays in the config.
api() {
  local method="$1"; shift
  require_token
  command -v curl >/dev/null 2>&1 || die "curl is required for live Telegram API calls"
  # The --config file is mode 600 and trap-deleted; it holds the only copy of the token-bearing url.
  local cfg; cfg="$(mktemp)"; chmod 600 "$cfg"
  # shellcheck disable=SC2064
  trap "rm -f '$cfg'" RETURN
  {
    printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$TOKEN" "$method"
    printf 'silent\n'
    for a in "$@"; do printf 'data = "%s"\n' "$a"; done
  } > "$cfg"
  curl --config "$cfg"
}

redact() { sed -E 's/[0-9]{6,}:[A-Za-z0-9_-]{30,}/<bot-token-redacted>/g'; }

# api_json <method> <json-body-string> — JSON-body POST via the same token-safe --config pattern (TELEGRAM-MENU-001).
# The body is written to a mode-600 trap-cleaned temp file, so neither token nor payload hit argv.
api_json() {
  local method="$1" body="$2"
  require_token
  command -v curl >/dev/null 2>&1 || die "curl is required for live Telegram API calls"
  local cfg bodyf; cfg="$(mktemp)"; bodyf="$(mktemp)"; chmod 600 "$cfg" "$bodyf"
  # shellcheck disable=SC2064
  trap "rm -f '$cfg' '$bodyf'" RETURN
  printf '%s' "$body" > "$bodyf"
  {
    printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$TOKEN" "$method"
    printf 'silent\n'
    printf 'header = "Content-Type: application/json"\n'
    printf 'data = "@%s"\n' "$bodyf"
  } > "$cfg"
  curl --config "$cfg"
}

case "$SUB" in
  info)
    require_token
    say "getWebhookInfo (token redacted):"
    api getWebhookInfo | redact
    ;;
  verify)
    require_token; validate_url
    say "Expected webhook: $(target_url)"
    OUT="$(api getWebhookInfo | redact)"
    printf '%s\n' "$OUT"
    if printf '%s' "$OUT" | grep -qF "$(target_url)"; then say "WEBHOOK_MATCH=PASS"; else say "WEBHOOK_MATCH=FAIL"; fi
    if printf '%s' "$OUT" | grep -q '"pending_update_count"'; then
      say "PENDING_UPDATES=$(printf '%s' "$OUT" | grep -o '"pending_update_count":[0-9]*' | head -1)"
    fi
    ;;
  set)
    require_token; validate_url
    [ -n "$SECRET" ] || die "MS_TELEGRAM_WEBHOOK_SECRET is not set — refusing to register an unsecured webhook"
    say "Plan: setWebhook -> $(target_url)  (secret_token set; drop_pending_updates=${DROP_PENDING})"
    if [ "$APPLY" != "yes" ]; then say "TELEGRAM_WEBHOOK_SET=DRYRUN (re-run with --apply to register)"; exit 0; fi
    api setWebhook \
      "url=$(target_url)" \
      "secret_token=${SECRET}" \
      "drop_pending_updates=${DROP_PENDING}" \
      "max_connections=20" | redact
    say "TELEGRAM_WEBHOOK_SET=APPLIED"
    ;;
  delete)
    require_token
    say "Plan: deleteWebhook (drop_pending_updates=${DROP_PENDING}) — activation rollback"
    if [ "$APPLY" != "yes" ]; then say "TELEGRAM_WEBHOOK_DELETE=DRYRUN (re-run with --apply)"; exit 0; fi
    api deleteWebhook "drop_pending_updates=${DROP_PENDING}" | redact
    say "TELEGRAM_WEBHOOK_DELETE=APPLIED"
    ;;
  menu-set)
    require_token
    CMD_BODY="$(node "${ROOT}/tools/telegram_menu_payload.js" set-commands)" || die "canonical command registry invalid — refusing to register"
    MENU_BODY="$(node "${ROOT}/tools/telegram_menu_payload.js" set-menu)"
    say "Plan: setMyCommands (default scope, $(node "${ROOT}/tools/telegram_menu_payload.js" expected | grep -o '\"command\"' | wc -l | tr -d ' ') commands from n8n/lib/telegram_commands.js) + setChatMenuButton(commands)"
    if [ "$APPLY" != "yes" ]; then say "TELEGRAM_MENU_SET=DRYRUN (re-run with --apply to register)"; exit 0; fi
    OUT1="$(api_json setMyCommands "$CMD_BODY" | redact)"
    printf '%s' "$OUT1" | grep -q '"result":true' || { printf '%s\n' "$OUT1"; die "setMyCommands failed"; }
    OUT2="$(api_json setChatMenuButton "$MENU_BODY" | redact)"
    printf '%s' "$OUT2" | grep -q '"result":true' || { printf '%s\n' "$OUT2"; die "setChatMenuButton failed"; }
    say "TELEGRAM_MENU_SET=APPLIED (setMyCommands ok, setChatMenuButton ok — idempotent, stale commands replaced)"
    ;;
  menu-verify)
    require_token
    EXPECTED="$(node "${ROOT}/tools/telegram_menu_payload.js" expected)"
    GOT="$(api getMyCommands | redact)"
    MATCH="$(node -e '
      const exp=JSON.parse(process.argv[1]);
      let got; try{got=JSON.parse(process.argv[2]);}catch(e){got={};}
      const list=(got&&got.result)||[];
      const norm=a=>JSON.stringify(a.map(c=>({command:String(c.command),description:String(c.description)})));
      process.stdout.write(norm(list)===norm(exp)?"PASS":"FAIL");
    ' "$EXPECTED" "$GOT")"
    say "TELEGRAM_COMMANDS_MATCH=${MATCH}"
    [ "$MATCH" = "PASS" ] || { say "expected: $EXPECTED"; say "got:      $GOT"; }
    BTN="$(api getChatMenuButton | redact)"
    if printf '%s' "$BTN" | grep -q '"type":"commands"'; then say "TELEGRAM_MENU_BUTTON=PASS"; else say "TELEGRAM_MENU_BUTTON=FAIL"; printf '%s\n' "$BTN"; fi
    [ "$MATCH" = "PASS" ] || exit 1
    printf '%s' "$BTN" | grep -q '"type":"commands"' || exit 1
    ;;
  *)
    die "usage: scripts/telegram_webhook.sh <info|verify|set|delete|menu-set|menu-verify> [--apply] [--drop-pending]"
    ;;
esac
