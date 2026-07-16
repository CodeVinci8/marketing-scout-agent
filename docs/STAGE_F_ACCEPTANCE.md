# Stage F — Acceptance Tracker (evidence-bound Claude analyst)

Honest status as of 2026-07-16. **Stage F is IN PROGRESS — not complete.** The hardest, most uncertain parts (real
API characterization + the adapter/analysis engine) are DONE and LIVE-PROVEN; workflow/Telegram integration and the
conversational agent are BUILT-OUT partially / NOT YET wired. This tracker is the single source of truth for what is
proven vs pending, so the next session can continue without re-deriving anything.

## DONE + PROVEN

| Item | Evidence |
|---|---|
| Disk blocker resolved | root was 100% (0 free); brute-force SSH log flood (btmp/auth/syslog) truncated + journal capped → **782 MB free**; n8n + prod containers healthy, healthz ok |
| Real API characterized | 21 bounded live probes → `docs/STAGE_F_API_CAPABILITY_MATRIX.md`. Gateway = Claude-Code-wrapped proxy; thinking always on; **tool_choice:auto is the only reliable structured transport**; native structured output & max_tokens ignored; count_tokens works; 401/400/timeout mapped |
| Canonical adapter | `n8n/lib/claude_adapter.js` — buildToolRequest / parseClaudeResponse (tool_use extraction, text-JSON fallback) / classifyClaudeError / callClaude (bounded transient-only retry) |
| Contracts + validators | `n8n/lib/claude_contracts.js` — versioned analysis/candidate/synthesis schemas + tools; validateStructured + validateEvidenceIds (no-invention gate) |
| Evidence package | `n8n/lib/evidence_package.js` — bounded, deduped, PII-scrubbed, current-vs-historical, hashed |
| Cost | `n8n/lib/llm_cost.js` — actual-usage cost + conservative estimate |
| Analysis orchestration | `n8n/lib/claude_analysis.js` — build → call → validate → ONE repair → deterministic fallback (fail-closed) |
| Offline tests | `tests/test_stage_f_core.js` — 77 checks; full `make test` ALL SUITES PASS ($0) |
| **LIVE single-source analysis** | real endpoint, real autolombardn1.ru evidence, request_id `448ee09a`: tool_use, **a real model error (`text_ю` Cyrillic key) caught by local validation → ONE bounded repair → success, no fallback**, 10307 in / 2139 out tokens, **$0.063**, 90 s, Russian output, 15 evidence-grounded items with fact/inference/recommendation separated, confidence 90 |
| Pre-F test hardening | 3 pre-existing time-bomb fixtures (fixed 2026-06-15 dates aged past WF10's 30-day window / WF14 recency band) re-anchored relative to now: wf10-source-health, lineage-e2e, lead_scout WF14 triage |

## WF28 — Claude Analyst (DONE + LIVE-PROVEN in production, session 54)

| Item | Evidence |
|---|---|
| Sheets contracts | `llm_analysis_results` + `llm_analysis_telemetry` in config/sheets_contracts.json (44 tabs); both tabs **created live** in the production Google Sheet |
| WF28 built + deployed | 16-node callable workflow (id `mswf28claudeanalyst`), feature-gated (`enable_claude && enable_llm_analysis`, default OFF), credentials bound (Google Sheets U7zcRXq79mhonIPF + Claude OEen8Vl1tdWtv7v4), active |
| **Live single-source analysis THROUGH n8n** | exec **834**: all 16 nodes ran → Claude Primary+Repair via the n8n credential → parse/validate → **1 repair (repair_success=true, no fallback)** → persisted → typed return. `enriched=true, mode=call, quality=repaired, conf=65, schema_mode=tool_use, 7285 in / 4120 out tokens, $0.084, provider_request_id 741925a6`, 8 evidence-grounded Russian items. |
| **Persistence with lineage** | llm_analysis_results row `an_b3d48d5f` in the live sheet (owner 1188830082, arid req_wf28_proof, model claude-sonnet-4-6, hash c74b6e3, 3150-char validated JSON) + a telemetry row (tokens/cost/repair) |
| **Reuse-by-hash** | exec **836** (identical evidence): `mode=reuse, cost=$0`, Claude Primary + Persist did NOT run — read the persisted result for free |
| Feature-gating | proven: WF28 only calls Claude when run with `MS_ENABLE_LLM_ANALYSIS=true` (controlled `docker exec -e`); OFF by default |

Live repair stats so far (WF28 + session-52 harness): 2 analyses, **0 JSON-syntax repairs**, 2 schema repairs (both a Cyrillic/look-alike key), **2/2 repair success**, **0 fallbacks**. The ASCII-key prompt hardening is deployed; more samples needed to measure the steady-state rate.

## NOT DONE (remaining Stage F work — for the next session)

| Item | Notes |
|---|---|
| ~~Workflow integration~~ | **DONE** — WF28 built + deployed + live-proven (above). |
| **WF20 → WF28 wiring + Report/XLSX integration** | WF28 exists and works standalone; still to do: call WF28 from WF20's approved-run path (per source), merge Claude insights into the WF12 report + XLSX under «Подтверждённые факты / Аналитические выводы / Рекомендации / Доказательства и ограничения», and deliver the enriched report to Telegram. Deterministic report/XLSX must still ship if the LLM fails. Enable via `MS_ENABLE_LLM_ANALYSIS=true` (env/container-recreate — operator/infra). |
| **Multi-source synthesis** | Schema+tool exist (`ccSynthesisTool`); orchestration + wiring not built. |
| **Candidate enrichment** | Schema+tool exist (`ccCandidateTool`); top-3–5 gating + wiring not built. |
| **Public lead interpretation** | Not built. |
| **Conversational analyst agent** | `analyst_agent` / `analyst_tools` libs not built. CodeVinci AI Pilot identity + read-only tool selection + approval-gated mutations + bounded loop. |
| **llm_telemetry + Sheets tab** | Persist schema/prompt version, model, package hash, tokens, cache, repair, cost per call. Sheets contract tab not added. |
| **Feature-flag rollout** | MS_ENABLE_LLM_ANALYSIS / _SUMMARY / DISCOVERY_LLM_ENRICHMENT / ANALYST_AGENT gates (default OFF) not wired to the new path. |
| **Live scenario matrix (§14)** | Only #1 (website analysis) proven. TG/VK/synthesis/enrichment/no-data/max-token/refusal/conversational/reuse pending. |
| ~~Pre-F debt B4 / B6 / B7~~ | **DONE (session 53)** — B4 plan-fingerprint dedup (live-proven, efe0daf), B6 requested-source terminal status (00bc4bf), B7 Russian XLSX + hidden technical sheet (e67ece1). All deployed; `make test` ALL SUITES PASS. |
| **Prompt hardening (repair↓)** | The one live repair was a Cyrillic `text_ю` key — add an explicit "use the ASCII English keys exactly; no visually-similar Cyrillic in keys" instruction to CA_SYSTEM_PROMPT before rollout. |
| **Runbook** | `docs/STAGE_F_RUNBOOK.md`. |

## Measured repair/cost stats (live so far)

- Live analysis calls: **1 scenario, 2 API calls** (1 primary + 1 repair).
- JSON-syntax repairs: **0** (tool_use returns a JSON object — structural, never a syntax repair).
- Schema/evidence repairs: **1** (the `text_ю` key), repair success **1/1**.
- Fallbacks: **0** live (fallback path proven in unit tests).
- Cost: $0.063 for the one live analysis; ~$0.01–0.03 expected per single-source call once evidence packages are tighter.

**Stage F.5 must NOT start** — Stage F is not complete.
