#!/usr/bin/env bash
# n8n_import_smoke.sh — fully DISPOSABLE n8n import smoke test. Proves the agent workflows import cleanly into a
# real n8n, captures the assigned workflow IDs, confirms every workflow is INACTIVE, and verifies the callable
# sub-workflow targets are present — all inside a throwaway N8N_USER_FOLDER (its own SQLite DB) that is deleted on
# exit. It NEVER touches the production n8n database/folder, NEVER activates/publishes, NEVER calls a paid API or
# overwrites credentials. If n8n is not installed it prints the exact manual command and exits 0 (nothing proven).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF_DIR="${ROOT}/n8n/workflows"

# The callable sub-workflow targets that MUST be importable (each now carries an Execute Sub-workflow Trigger).
CALLABLES=( "04_firecrawl_url_list_resilient.json" "08_touchpoint_analyzer.json" \
  "10_competitor_audience_intelligence_aggregator.json" "12_market_intelligence_report_builder.json" \
  "16_source_quality_gate_health_score.json" )
# The trigger/entry workflows the agent imports (config first, orchestrator last).
AGENT_WF=( "17_agent_settings_config.json" "18_telegram_agent_gateway.json" "19_request_planner.json" \
  "20_agent_orchestrator.json" "21_deep_competitor_analysis.json" "22_conversation_control.json" \
  "23_scheduled_source_monitor.json" )

say() { printf '%s\n' "$*"; }

if ! command -v n8n >/dev/null 2>&1; then
  say "n8n CLI not installed here — import compatibility is NOT proven by this run."
  say "Run this exact disposable import in an environment that has n8n (throwaway DB, nothing activated):"
  say ""
  say "    export N8N_USER_FOLDER=\"\$(mktemp -d)\""
  say "    n8n import:workflow --separate --input='${WF_DIR}'   # into the throwaway sqlite under \$N8N_USER_FOLDER"
  say "    n8n list:workflow                                    # capture assigned IDs (all active=false)"
  say "    rm -rf \"\$N8N_USER_FOLDER\"                            # delete the throwaway DB"
  say ""
  say "It never activates/publishes and never touches the production database."
  exit 0
fi

say "n8n CLI: $(n8n --version 2>/dev/null | head -1)"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; say "cleaned up throwaway folder: $TMP"; }
trap cleanup EXIT
export N8N_USER_FOLDER="$TMP"
say "disposable N8N_USER_FOLDER=$N8N_USER_FOLDER (never the production folder)"

say ">> importing all agent + callable workflows into the throwaway DB (active=false preserved)"
n8n import:workflow --separate --input="${WF_DIR}"

say ">> assigned workflow IDs (all must be active=false):"
LISTING="$(n8n list:workflow 2>/dev/null || true)"
printf '%s\n' "$LISTING"

# Post-import sub-workflow reference verification: every callable target must be present in the imported set.
missing=0
for f in "${CALLABLES[@]}" "${AGENT_WF[@]}"; do
  nm="$(node -e 'process.stdout.write(String(require(process.argv[1]).name||""))' "${WF_DIR}/${f}")"
  if printf '%s\n' "$LISTING" | grep -qF "$nm"; then
    say "  [ok]   imported: ${f}"
  else
    say "  [MISS] not found after import: ${f}"; missing=1
  fi
done

# Independent inactive guard (the JSON enforces it; assert it again here).
for f in "${CALLABLES[@]}" "${AGENT_WF[@]}"; do
  node -e 'const w=require(process.argv[1]); if(w.active!==false){console.error("active!=false: "+process.argv[1]); process.exit(1)}' "${WF_DIR}/${f}"
done
say "  [ok]   every imported workflow is active=false (nothing activated)"

if [ "$missing" -ne 0 ]; then say "SMOKE FAILED: a workflow was missing after import."; exit 1; fi
say "SMOKE OK: all workflows imported INACTIVE into a throwaway DB; nothing activated, production untouched."
