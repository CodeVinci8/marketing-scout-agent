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

## Session 63 (2026-07-18) — REPORT-TRUTH-A CLOSED (commit 27eb736, deployed, live-proven)

| Item | Evidence |
|---|---|
| **Analysis modes are an explicit persisted contract** | `deterministicPlan` infers `analysis_mode` (source_analysis / change_report / comparison / synthesis + 4 reserved) from the Russian request; `PLAN_CHANGE_RE` uses past-form stems («что изменить в моём оффере» stays source_analysis). Mode joins **planHash AND planFingerprint** (stored-row/in-memory parity, legacy rows normalize to default), persists on `execution_plans.analysis_mode` (live header migrated append-only, idempotent — execs 993/994), renders «Тип отчёта: …» in the approval only when non-default, travels WF20 → WF28 `analysis_type` → llm rows → summary → bundle → hidden XLSX tech sheet. Legacy cache alias: `single_source` ≡ `source_analysis` in `findReusableAnalysis`; cross-mode reuse impossible. |
| **LIVE PROOF 1 — change_report (`req_1784370207600`, execs 995–1004)** | Plan `plan_req_1784370207600_h3f90e66e` mode=change_report (≠ h6ef5737d for the same URL as source_analysis); approval msg renders «Тип отчёта: отчёт об изменениях с прошлой проверки», no enum leak. WF20 998 read the mode back **from the Google Sheets row** (round-trip). WF28 1004: `ctx.analysis_type=change_report`, **same evidence hash 753b287e as the cached single_source rows → cache MISS → fresh_call** (`an_4a0d54db`, $0.0145, claude-sonnet-4-6, quality ok, no repair) — the mode is provably part of the cache key. Summary: mode=change_report, `0.0512 = summary-AI 0.0367 + deep-AI 0.0145`; bundle carries mode+model+cache decisions; Telegram msgs 404–408 incl. cost line «AI-сводка $0.0367 + AI-анализ $0.0145 = $0.0512», XLSX `marketing_scout_report_20260718_132603_report.xlsx`; plan → completed. |
| **LIVE PROOF 2 — alias (`req_1784370884282`, execs 1005–1014)** | Re-ask «Проанализируй сайт autolombardn1.ru»: WF28 1014 `ctx.analysis_type=source_analysis` → **reuse of legacy `an_5f3ef630` (a 'single_source' row), $0, no Claude HTTP**; the change_report `an_4a0d54db` (same hash) correctly NOT matched. WF04 1009: source reuse, no Firecrawl. Summary: mode=source_analysis, `0.0373 = summary-AI only`, `llm_analyses_reused=1`, lineage `an_fbfbc830 ← an_5f3ef630`. |
| Tests / deploy | New `tests/test_analysis_modes.js` (32) in run_all; bootstrap/ops-QA workflows regenerated from the contract (4 drift suites green); `make test` ALL SUITES PASS ($0). Deployed via extended deploy_sync (now also syncs executeWorkflow `workflowInputs` — never `workflowId`) to 9 prod workflows (18,19,20,21,22,24,25,26,28; backups `scratchpad/backup/*_prod_20260718_131800.json`); 17 active, health ok. Disk cleanup for the paid-call floor: journal vacuum + 6 superseded n8n backup tarballs removed (newest 20260711-071439 kept) → 582 MB free. |

## Session 64 (2026-07-19) — REPORT-TRUTH B + C + D CLOSED (commits 442fff1 / 15e2383 / b2e39ba, deployed, live-proven)

| Item | Evidence |
|---|---|
| **B — evidence-grounded claim validation** | `claim_validation.js`: market-wide superlatives / leader / benchmark / trend / competition from bounded snapshots demote to explicitly-scoped hypotheses; ad-strength requires ad evidence; absence scoped to inspected pages; demand-absence & audience-pain require audience signals; invented-recent-year, foreign-script, mixed-script, leaked-enum, stutter all rejected. Runs before Telegram, XLSX and the stored bundle (`cvValidateAnalyses` in WF20 Build Delivery Outbox + Shape Report Bundle). |
| **C — concise Telegram renderer** | `compact_report_ru.js` builds ONE compact message from structured data (validated analyses + bundle + summary), never the full markdown; success 700–1200 / reuse 300–700 / failure 250–600, hard max 1500; markdown guard nets foreign-script + duplicate bullets. Full report stays in the XLSX + stored bundle. |
| **D — the workbook describes THIS request** | `report_package.js`: Summary carries Тип отчёта / Режим данных / request-scoped source count / limitations / five real component-cost columns; Конкуренты domain+source_type, «Качество» dropped when unknown, «Регион запроса» never conflated with source region; Офферы deduped + enum/boilerplate stripped; Рекомендации + Summary «Ключевые рекомендации» from ONE canonical `recRows` (no empty placeholders, evidence-less rows labelled hypothesis); Доказательства carries the captured contract (bounded quote, observation kind, collected_at, quality) or an explicit «цитата не сохранена» limitation; hidden tech sheet has canonical states (`rpDataMode` reuse/mixed/collect = «Режим данных» derivation, `rpCostStatus` measured/measured_zero, real budget ceilings, terminal `final_state`). Claim validator additionally bounds score-as-market-proof, unmeasured CTR/lead-flow, unfair-competition, audience-pain and «одна из наиболее … в сегменте» superlatives. WF28 evidence_map now carries excerpt/fact_type/collected_at/quality; Shape Report Bundle sets terminal final_state after delivery + records enforced budget ceilings. `tests/test_report_truth_quality.js` 165 checks; `make test` ALL SUITES PASS ($0). |
| **D LIVE PROOF — reuse run `req_1784397139206`** | Execs planner **1070** / approve **1071** / WF20 **1072** / WF04 1073 / WF16 1074 / WF08 1075 / WF10 1076 / WF12 1077 / WF28 1078. Report `report_20260718_205438`, workbook `marketing_scout_report_20260718_205438_report.xlsx` **sha256 608cbc34…** — 8 sheets `[Сводка, Конкуренты, Офферы и цены, Аналитические выводы, Рекомендации, Боли и сигналы, Доказательства, Технические данные(hidden)]`, rows 1/1/1/8/6/2/1/1, **3 valid external hyperlinks**, OOXML valid. Telegram report msg **454** + XLSX msg **455**; plan **completed**, final_state **delivered**. Source reused + deep-analysis reused (`an_eb7de5f2`, 0 tokens/0 latency) + **fresh summary-AI $0.012** → Summary AND tech sheet agree: сбор $0 / AI-сводка **$0.012** / AI-анализ $0 / восстановление $0 / итого **$0.012**, source cost `measured_zero`, LLM cost `measured`, data mode `reuse` = «сохранённые данные (без нового сбора)», source count **1** (not global 65). Claim audit checked=20 kept=13 demoted=6 rejected=1; workbook claims are scoped hypotheses (score-as-proof, unfair-competition, audience-pain all bounded), bracketed `[1]` refs, evidence row carries the captured quote + accepted quality + collected_at. **This is the live proof of nonzero component-cost rendering (previously only unit-fixture proven). REPORT-TRUTH D = COMPLETE.** |
| Deploy | Surgical backup-first re-sync (`deploy_sync.js`) to WF20/24/25/28 (backups `scratchpad/backup/*_prod_20260718_15*.json.gz`), reactivated WF20/24/28, n8n restart, **17 active**, health ok, webhook registered (0 pending, no last_error). |

### Still open for the Stage F gate (in order)

1. Approval/progress UX: remove public «максимальный лимит запуска: $8.00» (cap stays internal); reuse-aware approval estimate; callback idempotency (no «план не найден» after «Запускаю анализ»); neutral completion wording (no «выше/ниже»).
2. §8 typed source outcomes for TG/VK connectors (website done).
3. §9 live roles: TG-channel, VK-community, 3-source synthesis, WF27 enrichment, public-lead interpretation, failure matrix (blocked carmoney.ru, timeout, repair-fail→fallback, context-too-long, owner-isolation negative), terminal-plan idempotency, callback idempotency.
4. §10 ≥5 fresh analyses → repair/latency/cost metrics.

## Session 65 (2026-07-20) — post-migration: COST-REUSE-002 honest deep-analysis reuse estimate (deployed, verified)

Post-VPS-migration production is authoritative (NEW VPS 62.60.248.184, n8n 2.23.3, 17 active / 90 total, health ok,
Telegram webhook + proxy + ngrok active). git `main` @ `05490a2` clean == origin at session start. The three
post-session-64 merged items are re-confirmed COMPLETE here (they were closed on the merged branch, tracker was
stale): **PHASE-2 approval UX** (no public $8 cap, reuse-aware estimate, callback idempotency, neutral wording —
commits 7f07764/9e7bc7a) and **§8 typed source outcomes for Telegram+VK** (commits f97c563/9b49074/48e1133,
live-proven telegram exec 1087).

| Item | Evidence |
|---|---|
| **COST-REUSE-002 — a reused source no longer promises a guaranteed $0 deep analysis** | Root cause: `cost_model.sourceReusePreflight` set `expect_analysis_reuse` from source-snapshot reuse alone (`reused >= total && claudeOn`), and `projectRequestCost` then zeroed the deep-analysis cost, so the approval rendered «AI-анализ: $0 (будет переиспользован сохранённый анализ)». But the analysis cache key (`llm_telemetry.findReusableAnalysis`) is owner+analysis_type+evidence_hash+schema+prompt+model and needs a non-fallback row to EXIST — the same evidence still MISSES under a different report mode/model or a never-analysed snapshot (already live-proven: exec 1004 same-hash `change_report` → fresh paid call). Fix: source reuse now yields `analysis_reuse_possible` only; `expect_analysis_reuse` is set true **only** when the caller passes explicit `opts.analysis_reuse_confirmed` (a confirmed cache hit). At approval time WF19 cannot cheaply confirm the hit (it needs the built evidence package + hash + an `llm_analysis_results` read), so it renders the honest ceiling: «• AI-анализ: ~$0.07–0.11 (спишется, если готового анализа под этот отчёт ещё нет)», never a $0 promise. Collection reuse ($0 collection for a reused snapshot) is unchanged and correct. The confirmed-hit path still renders $0 for a caller that can prove it. |
| Tests | `tests/test_approval_ux.js` updated to the honest contract (asserts no `AI-анализ: $0` on an unconfirmed reuse, quotes the cost + spend-condition, and that a `analysis_reuse_confirmed` caller still gets $0) → **80 checks**. Stage-4 workflows regenerated (embed drift) → `test_stage4_workflows.js` **144**, `test_cost_model.js` **87**. `make test` **ALL SUITES PASS (external calls=0, live cost=$0)**. |
| Deploy | New **canonical** surgical deploy tool `tools/deploy_workflow_jscode.js` (replaces the lost scratchpad `deploy_sync.js`): syncs Code-node `jsCode` + executeWorkflow `workflowInputs` from repo into a live prod export, preserving all installation-local ids/credentials/connections/`workflowId`/active/webhookId; **aborts on any structural node-set or type mismatch** (that structural case is the still-open canonical-deploy item). Deployed **WF19 only** (id `d0ffU5QxNb8zpwKW`) backup-first (backup `scratchpad/backup/wf19_prod_20260720_210727.json`): exactly one node changed (`Build Approval Message`, +1892 B), fresh-export verified to byte-contain the honest hedge + confirmation gate, ids/creds/connections preserved, **17 active / 90 total**, health ok. WF19 is callable → executeWorkflow loads it from the DB at call time, so the change is live for the WF18→WF19 path with no restart. |
| Benign drift (documented, self-healing) | The regenerated embeds in WF18/20/21/22/26 were committed (required for the drift test) but NOT deployed: their changed regions are the whole-file embed of `cost_model`/`plan_render_ru`, and the changed FUNCTIONS are not exercised on those workflows' paths (WF18 'Handle Plan Result' renders the estimate only as a **preflight-less fallback** = byte-identical before/after; WF20 uses `actualRequestCost`, unchanged). They sync automatically on their next functional deploy. NOT a fault. |
| Live confirmation | Deferred to the §9 live-role matrix, where every real scenario surfaces the approval estimate — a standalone exec of this deterministic, byte-verified rendering path was not created (no clean CLI delete exists; a disposable would break the 90-total invariant). No unprompted Telegram message was sent. |

## Session 66 (2026-07-21) — canonical STRUCTURAL workflow deploy = COMPLETE (offline-proven, no production mutation)

| Item | Evidence |
|---|---|
| **Canonical structural deploy tool** | `tools/deploy_workflow_structural.js` — grafts the canonical repo topology onto a live production export. Modes: offline rehearsal (`--prod <export.json>`), live read-only dry-run (`--id <prodId>`), `--apply` (backup → graft → import → re-export → parity verify → prints the rollback command), and `--restore <backup.json>`. Preserves every installation-local value: workflow id, `active`, `settings`, per-node prod id, real credentials, `webhookId`, and **Execute Workflow `workflowId` bindings**. Connections are replaced only from the repo topology. Reports added / retained / removed / rewired / parameters-changed. |
| **Safety bug found and fixed in the draft** | The draft adopted repo `parameters` wholesale for existing nodes. The repo ships `PASTE_WORKFLOW_ID` in every Execute Workflow node, so a graft would have **overwritten live sub-workflow bindings with placeholders**. Live read-only dry-run against production WF20 (`QBNFpiZE_IHKUKkf`) confirms the fix: *"preserved Execute Workflow bindings on 9 node(s)"* — nine real orchestrator calls that the draft would have broken. |
| **Credential safety (mandatory)** | Production holds several credentials of the same type, so a type match is **not** identity. A NEW node's credential resolves only by (A) explicit `--cred "<node>=<name\|id>"`, (B) `--inherit "<new node>=<existing node>"`, (C) a repo id that already is a real prod id, or (D) a **unique** type match (exactly one candidate). Two or more candidates ⇒ abort with an actionable message naming both flags. The tool never prints a credential id or value in an error. |
| **Fail-closed gates** | Aborts (importing nothing) on: an unmanaged prod-only node (deletion requires explicit `--remove`), an existing-node type change, an unresolvable/ambiguous credential, **any** placeholder credential id or placeholder Execute Workflow binding reaching the merged result, a connection to an unknown node, and a post-import parity mismatch (exit 3). |
| Tests | `tests/test_deploy_structural.js` — **60 checks, 0 failed**: node addition, connection rewiring, node-id preservation, workflow-id/active/settings preservation, Execute Workflow binding preservation, placeholder rejection, ambiguous-credential rejection (+ actionable, secret-free message), explicit credential inheritance and `--cred` mapping by name and by id, intentional node removal (with dangling-edge cleanup) and its guards, and post-import parity mismatch detection (lost credential, rebound credential, changed node id, missing node, changed connections, lost active state, wrong workflow id, broken binding). Registered in `tests/run_all.js` as `deploy-structural`. Full regression: `make test` → **ALL SUITES PASS (external calls=0, live cost=$0)**. |
| Production impact | **None.** Only read-only `export:workflow` dry-runs were performed (WF12 `3H7SR0tG12sK_JTV` → 26→26 nodes, no drift; WF20 → 68→68 nodes, 2 benign generator-drift params). Nothing was imported. |

### Still open for the Stage F gate (in order)
1. **Telegram/VK social evidence must reach source analysis even when no full competitor profile exists** (the standing Stage-E/G defer: social posts collect fine but 0 become competitor-profile records downstream). The structural deploy tool above is the prerequisite and is now available.
2. §9 live roles: TG-channel, VK-community, 3-source synthesis, WF27 enrichment, public-lead interpretation, failure matrix, terminal-plan idempotency, callback idempotency.
3. §10 ≥5 fresh analyses → repair/latency/cost metrics.
4. Formal Stage F gate.
