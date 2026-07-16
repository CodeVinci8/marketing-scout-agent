# Stage F — Runbook (operating & extending the Claude analyst)

## Endpoint & credential
- URL `https://aiprimetech.io/v1/messages` · header `Authorization: Bearer <token>` + `anthropic-version: 2023-06-01`.
- n8n credential: **`Claude API - Marketing Scout`** (httpHeaderAuth, id `OEen8Vl1tdWtv7v4`). Never printed/exported to a
  committed file. To characterize offline-of-n8n, `n8n export:credentials --id=OEen8Vl1tdWtv7v4 --decrypted` writes a
  container-only `/tmp/cred.json` — **shred it** (`rm -f`) right after; never `cat`/log it.
- Model in use: **`claude-sonnet-4-6`** (accepted + echoed by the gateway). Do NOT hardcode other model names
  unverified — probe first.

## What the gateway really does (see STAGE_F_API_CAPABILITY_MATRIX.md)
- It is a Claude-Code/claude.ai-wrapped proxy: **extended thinking always on**, responses carry `thinking`/`text`
  blocks before `tool_use`. Keep server-side "conversation too long" risk in mind → keep evidence packages tight.
- **Structured output = tool_choice:auto + one `submit_*` tool** (forced tool choice is unreliable; native
  `response_format`/`output_config` are ignored). Extract `content.find(b=>b.type==='tool_use').input`.
- `max_tokens` is ignored; caching ineffective (cache tokens 0); latency 16–28 s/call → **timeouts ≥ 75 s**, minimize
  calls, use async/progress UX. `count_tokens` works for input estimation.

## Library layer (all pure, embeddable, unit-tested)
```
claude_adapter.js    transport: build request, parse tool_use, classify errors, callClaude(retry transient only)
claude_contracts.js  versioned schemas + tools + validateStructured + validateEvidenceIds
evidence_package.js  bounded/deduped/PII-scrubbed package (current vs historical), package_hash
llm_cost.js          cost from actual usage + conservative estimate
claude_analysis.js   analyzeSource: build → call → validate → ONE repair → deterministic fallback
```
Golden rule: **deterministic collectors are the source of facts; Claude only interprets the bounded package; every
claim cites an evidence_id; write/paid actions stay behind existing plan/budget/approval gates.**

## Wiring into n8n (recommended topology)
A dedicated **WF28 — Claude Analyst** callable workflow (cleaner than overloading WF20/WF22):
```
[Trigger: When Called by Agent]
  -> [Build Evidence Package]  (Code, embeds evidence_package.js from stored current-run facts)
  -> [Build Analysis Request]  (Code, embeds claude_adapter+claude_analysis buildSourceAnalysisCall)
  -> [Claude HTTP]             (HTTP Request node, cred OEen8Vl1tdWtv7v4, anthropic-version header,
                                timeout 90000, retryOnFail=true maxTries=2 for transient)
  -> [Parse + Validate]        (Code, parseClaudeResponse + validateAnalysisResult)
  -> IF invalid AND not yet repaired:
       -> [Build Repair] -> [Claude HTTP #2] -> [Parse + Validate #2]
  -> [Merge or Fallback]       (Code, deterministicAnalysisFallback on failure)
  -> [Persist telemetry]       (Sheets append: llm_analysis_telemetry)
  -> return typed analysis
```
Fixed **2-call maximum** (no loop). WF28 has NO public trigger (safe to publish as callable). Feature-flag the caller
in WF20 on `cfg.enable_llm_analysis && cfg.claude_key_present` (default OFF).

## Deploy (same surgical pattern as the rest of the project)
```
docker exec n8n-n8n-1 sh -c "n8n export:workflow --id=<id> --output=/tmp/p.json"
docker cp n8n-n8n-1:/tmp/p.json scratchpad/p.json      # sync jsCode from repo, preserve prod ids/creds
docker cp scratchpad/n.json n8n-n8n-1:/tmp/n.json
docker exec n8n-n8n-1 sh -c "n8n import:workflow --input=/tmp/n.json"
docker exec n8n-n8n-1 sh -c "n8n update:workflow --id=<id> --active=true"
# WF18 changes only: docker restart n8n-n8n-1  (re-registers the ms-telegram-agent webhook), then healthz + webhook probe
```

## Fail-closed guarantees (must never regress)
- LLM disabled / no key / error / invalid-after-repair → deterministic report + XLSX still ship; user sees a concise
  Russian "AI-анализ временно недоступен" note; no raw provider error; run not falsely marked LLM-success.
- Never auto-execute a paid/mutating action from Claude output — return a proposal through the approval gate.
- Never surface thinking blocks, JSON, English enums, tool names, or policy IDs to Telegram.

## Cost / budget
- Per single-source analysis ≈ $0.01–0.06 (gateway inflates input tokens). Persist ACTUAL usage; gate the call on the
  per-request LLM budget using `llm_cost.estimateCost`. Reuse a persisted analysis when `package_hash` is unchanged.

## Rollback
Every deploy backs up the prior workflow export to `scratchpad/backup_*`; re-import that JSON + reactivate to roll back.
