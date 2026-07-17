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

## Session 55 — WF20→WF28 wired + deployed; honest AI cost LIVE-PROVEN; WF04-ROUTE-001 fixed

| Item | Evidence |
|---|---|
| **WF20 → WF28 wiring** | DEPLOYED. WF20 `QBNFpiZE_IHKUKkf`, 65 nodes: Run WF12 Report → Build Analysis Inputs → Analyze Sources? → Shape Analysis Targets → Run WF28 → Merge Analyses → Build Execution Summary. Both IF branches converge, so the deterministic report always ships. Structural merge preserved 60 prod node ids + 8 creds + 9 execWf bindings; 0 dropped, 0 placeholders. |
| **§4 honest AI cost — LIVE** | WF19 exec **840**. Real approval message: `💰 Оценка стоимости: $0.08–0.12` / `• сбор данных: ~$0.01` / `• AI-анализ: ~$0.07–0.11` / `• максимальный лимит запуска: $8.00`. The measured range brackets the real $0.063–$0.084. |
| **CAP-CLAUDE-001 — LIVE** | Same exec: `claude_capability={"available":true,"mode":"proven_credential","proof_at":"2026-07-16T06:50:14.969Z"}` — availability derived from the system's OWN llm_analysis_telemetry row (written by WF28 exec 834), with **no secret read**. Production has no MS_CLAUDE_API_KEY; auth is the n8n credential. |
| **Feature flags persisted** | `/opt/n8n/n8n.env` appended only (first 93 lines byte-identical): `MS_ENABLE_LLM_ANALYSIS=true`, `MS_ENABLE_WF08_LLM=false`. Rollback: `cp /opt/n8n/n8n.env.bak-stagef-20260716-141617 /opt/n8n/n8n.env && cd /opt/n8n && docker compose up -d`. |
| **WF08-LLM-GATE-001** | WF20 armed WF08's legacy per-record Claude from `enable_llm_analysis` (=true in prod) while cost_model no longer quoted it → ~12 unquoted 16-28s calls/run. Now gated on `enable_wf08_llm` (default OFF). |
| **WF04-ROUTE-001 — fixed + LIVE-PROVEN** | WF02/03/04/08 appended each record to a DYNAMIC route tab on the CRITICAL path; 6 routes emitted, 3 declared → a missing tab killed the run (exec 861/870/873: "Sheet with name technical_errors not found"). All 4 appends now fail-open; `technical_errors` + `skipped_log` declared canonically (46 tabs) and created live. PROOF: WF04 exec **871** ran the full chain `urls_received=1 urls_scraped=1 primary_calls=1`; execs 879/881 succeed. |
| **Fail-open path — LIVE** | WF20 exec **878**: `do_analyze=false reason=no_sources` → deterministic report still built + delivered, `actual_ai_usd=0`. A disabled/empty analyst never blocks delivery. |

### NOT proven yet (honest)

| Item | Why |
|---|---|
| **WF28 reached from WF20 with real data** | Every approved run ended `reason=no_sources`. **`url_registry` dedup is PERMANENT — no time window** (`Evaluate Dedup`: `const hit = !force && rows.some(...)`), so every previously-scraped site yields an empty WF12 bundle. WF04 already accepts `force_reprocess` (FORCE-REPROCESS-001); it is NOT wired planner→plan→WF20. That wiring is the next task and is also required by spec §3/§5. |
| **Concise Telegram report** | Measured "before": WF20 exec 878 no-data = **2082 chars**. Targets 900–1600 / 250–700 not yet implemented. |
| **Three distinct source outcomes** | data / no-new-data / technical failure are still conflated in one message. |
| TG + VK single-source, synthesis, WF27 enrichment, lead interpretation, CodeVinci AI Pilot, repair-rate ≥5 | Not started. |

**Live Claude spend this session: $0** (WF28 never fired — no evidence was ever collected).

## Session 61 (2026-07-17) — reuse/collect/refresh EXECUTED, WF28 transport proven, complete chunked delivery

| Item | Evidence |
|---|---|
| **WF28-TIMEOUT-001 + LATENCY-001 — LIVE-PROVEN twice** | Refresh E2E (`req_1784260795988`, execs 955–962): WF28 exec **962** primary success in **68.6 s** (`latency_ms=68758` MEASURED, was always 0), `enriched=true quality=ok schema=tool_use stop=tool_use`, 2652 in / 350 out tokens, est $0.0183 ≥ actual **$0.0132**, provider_request_id `5f759119`, analysis `an_f91a9fd1`, telemetry `tl_3defc7b1`. Reuse E2E exec **972**: primary success in **91.1 s** — above the old 90 s ceiling; the timeout fix saved this exact call. No repair either time. Retry NOT added: 1 transient in 4 live calls does not justify doubled spend (commit 88dedef records the deferral). |
| **Scenario B (refresh) — PASS** | plan `source_execution_mode=refresh, force_reprocess=true`; WF04 exec 957 genuinely re-scraped (Firecrawl 930 ms, repair path success, `run_id req_1784260795988::website::a1`); WF16 88; WF10 iso=2/filters=2/profiles=1; WF12 report; WF28 962 enriched; Telegram msg 376 + XLSX msg 377 (15829 B); plan `completed`. |
| **SOURCE-REUSE-001 — BUILT + DEPLOYED + LIVE-PROVEN (commit 3c1e18d)** | WF04 embeds the canonical `source_execution_policy` (byte-mirror-tested) and executes reuse\|collect\|refresh in ONE place. Reuse E2E (`req_1784276354484`, execs 965–972): WF04 exec **967** — Registry Lookup 6 rows (returnAllMatches), decision `reuse/fresh_snapshot` (orig run `req_1784260795988::website::a1`, age 0.04 d, orig health 88/healthy verified), readback 9 rows → **1 alias row** under CURRENT lineage (`parse_method=reused_snapshot`, original `parsed_at` preserved) + INHERITED source_health row; **no Firecrawl/Claude node executed**; `execution_mode=reuse source_outcome=reused_snapshot external_calls=0 actual_source_cost_usd=0 cost_status=not_applicable`. WF16 exec 968 emitted `skip_write reuse_run_health_inherited_from_original` (no 0-record poisoning row). WF10 exec 970: current run IN eligible_run_ids, iso=1/filters=1/profiles=1. Telegram states «💾 Использованы сохранённые данные … сбор от 17.07.2026 … $0». |
| **ANALYSIS-REUSE-001 — FIXED + LIVE-PROVEN (commit 92aafc3)** | findReusableAnalysis required analysis_id equality (embeds request ids → cross-request reuse could NEVER match; exec 972 paid again for the same snapshot). Now keyed owner+type+evidence_hash (+schema/prompt-version invalidation, newest wins, fallback banned). PROOF exec **982**: `Call Claude?`→0 items, `mode=reuse enriched=true cost=$0`, hash `753b287e` matched — WF28 in 1.5 s instead of 91 s. |
| **DELIVERY-CHUNKS-001/002 — FIXED + LIVE-PROVEN** | exec 956 built 4 chunks (AI sections in chunks 1–3) but sent ONLY chunk 0 (msg 376) — the user never saw the paid analysis. `Expand Telegram Chunks` + batchSize=1: exec 966 sent 4/4 (ids 381,383,382,384 — parallel scramble found live) → exec **976** sent 4/4 **strictly ordered** (389–392), reuse line + «Подтверждённые факты/Аналитические выводы/Рекомендации/Доказательства» delivered, XLSX 393, plan `completed`, collection $0 / analysis $0 (the $0.03 = WF12 summary call, honestly attributed). |
| **ADAPTER-RETURN-001** | WF04's sub-workflow return was the LAST executed node = snapshot row → adapter recorded `status=empty external_calls=0` on a run that scraped (exec 956). Done-side serialized (pure-reuse returns the typed Final Summary deterministically) + WF20 adapter maps a snapshot-shaped return honestly. |
| Regression | `make test` ALL SUITES PASS ($0, 0 calls) after each commit; production redeployed surgically (8 wf then 2 wf), 17 active restored exactly, ids/creds/bindings preserved, backups in scratchpad/backup/. |

### Still open for the Stage F gate (next)

| Item | Notes |
|---|---|
| §4 source outcomes on TG/VK connectors + `source_analysis` vs `change_report` modes | website connector now emits typed outcomes; TG/VK do not; analysis modes not persisted. |
| §5 concise Telegram renderer | delivered report is still the full ~13.5k-char 4-chunk document; targets 700–1200 (success) / 300–700 (reuse) / 250–600 (failure), hard max 1500. |
| §6 live roles | TG-channel, VK-community, 3-source synthesis, WF27 enrichment, public-lead interpretation, blocked carmoney.ru, controlled failure matrix, ≥5 fresh analyses (repair-rate M4). |
| Observability nit | WF28's typed return drops `reused_from_analysis_id` (matcher supplies it; Finalize doesn't forward). |

**Stage F.5 must NOT start** — Stage F is not complete.

## Session 62 (2026-07-17) — REUSE-OBS-001 + COST-SPLIT-001 CLOSED (commit 2565702, deployed, live-proven)

| Item | Evidence |
|---|---|
| **REUSE-OBS-001 — a cached answer names its origin** | `findReusableAnalysis` returns origin id/created_at/model + explicit reason; **model joins the cache key** (both-present rule — legacy rows without a model stay reusable; a different configured model invalidates). WF28 Prepare records a canonical cache decision (`reuse` / `fresh_call` / `skip_disabled` / `skip_no_evidence`), Finalize forwards origin+decision+repair-cost in the typed return; collectAnalyses aggregates `reuse_lineage`+`cache_decisions`+`model`; execution summary and report bundle persist them; hidden XLSX tech sheet renders «AI reused from» + «AI cache decisions». No separate provider/policy version key needed: schema_version+prompt_version already version the request/validation contract (audited, decision recorded here). |
| **COST-SPLIT-001 — honest component costs** | `actualRequestCost` splits actuals: collection / summary-AI / deep-analysis-AI / repair (repair = share of analysis spend, clamped, never double-counted) at **4dp** (old 2dp rounding erased sub-cent actuals: $0.0132→$0.01). `deliveryBody` renders one Russian cost line naming each paid component. |
| **LIVE PROOF (`req_1784310302289`, execs 984–992)** | Source reuse (WF04 987, $0, no Firecrawl) + analysis reuse (WF28 **992**, 1.5 s, no HTTP node): typed return = `mode=reuse, cost 0, reused_from_analysis_id=an_5f3ef630 (created 08:24Z, claude-sonnet-4-6), cache_decision=reuse, reason="match: owner+analysis_type+evidence_hash+schema+prompt+model → an_5f3ef630"`; current lineage `an_e6145372` separate. Summary: `actual_cost_usd=0.0302 = summary-AI 0.0302 + collection 0 + deep 0 + repair 0`, `llm_reuse_lineage`/`llm_cache_decisions` persisted; bundle carries the same. Telegram (msgs **397–400**, ordered): «💰 Фактическая стоимость: AI-сводка $0.0302 = $0.0302.» — **a cached-analysis run is no longer presented as $0**; no internal id leaked. XLSX msg **401** `marketing_scout_report_20260717_204749_report.xlsx` (16298 B): OOXML valid, `an_5f3ef630` + cache reason + model present ONLY in sheet8 «Технические данные» `state="hidden"`. Plan `plan_req_1784310302289_h6ef5737d` → completed. |
| Tests / deploy | New `tests/test_reuse_observability.js` (74) in run_all; cost-model pins updated to 4dp truth; `make test` ALL SUITES PASS ($0). Deployed surgically via jsCode re-sync to 9 prod workflows (18,19,20,21,22,23,24,26,28 — backups `scratchpad/backup/*_prod_20260717_203907.json`), 17 active restored, health ok. |

### Still open for the Stage F gate (in order)

1. **REPORT-TRUTH milestone (§3–§7)**: explicit analysis modes (source_analysis / change_report / …) persisted end-to-end; evidence-grounded claim validation (no market-wide claims from one homepage); semantic quality guards; **concise Telegram renderer** (700–1200 / 300–700 / 250–600, hard max 1500 — current live report is ~12.9k chars in 4 chunks); XLSX truth (current-request scope, no global inventory totals, dedup, evidenced regions).
2. §8 typed source outcomes for TG/VK connectors (website done).
3. §9 live roles: TG-channel, VK-community, 3-source synthesis, WF27 enrichment, public-lead interpretation, failure matrix (blocked carmoney.ru, timeout, repair-fail→fallback, context-too-long, owner-isolation negative), terminal-plan idempotency.
4. §10 ≥5 fresh analyses → repair/latency/cost metrics.
