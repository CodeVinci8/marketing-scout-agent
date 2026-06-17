# ROADMAP.md — Marketing Scout Stages

## STAGE MODEL — LOCKED (DEC-138, 2026-06-17, session 10)

**This block is authoritative. It overrides any older "next active stage" wording further down this file.**
The forward sequence is now A → B → C → D:

| Phase | Name | Meaning |
|-------|------|---------|
| **A** | **Cleanup Lock** | Documentation/stage-model consistency lock (this patch). No new build. |
| **B** | **Stage 3.5 — Lead Scout Foundation + paid/live readiness** | **NEXT ACTIVE BUILD.** Public lead-signal layer on the current architecture; prepare paid/live readiness. |
| **C** | **Acceptance Pack** | Controlled acceptance: Stage 2 paid/live website acceptance + Stage 3.5 lead acceptance, run as one deliberate pass after the builds — **not** micro-tested per node. |
| **D** | **Stage 4 — Claude Intelligence Layer** | Claude enrichment + executive report (4.1/4.2/4.3). Starts **only after** Stage 3.5 **and** the Acceptance Pack. |

**Locked stage status:**

| Stage | Status |
|-------|--------|
| **Stage 1** | **CLOSED** |
| **Stage 2** | **CODE-COMPLETE / READY FOR CONTROLLED PAID-LIVE ACCEPTANCE** (acceptance happens in Phase C, not now) |
| **Stage 3** | **MVP CLOSED / PASS** (DEC-136) |
| **Stage 3.5** | **BUILT — deterministic, fixture-validated, $0 (DEC-139)**; live VK lead path gated/inert (runtime = PENDING_STAGE_C); next = Stage C acceptance |
| **Stage 4** | After Stage 3.5 **and** the Acceptance Pack (Phase D) |
| **Stage 5** | After the Stage 4 contract (4.3) is defined |

> **Phase B progress (2026-06-17, DEC-139):** Stage 3.5 Lead Scout Foundation **built** — WF14 v0.3 Lead Scout
> scoring engine + WF13 VK public lead source (gated live `wall.get`/`wall.getComments`) + WF12 lead block +
> `public_lead_signals` v0.3 (47 cols) + fixtures. Public signals only, manual review, `outreach_allowed=false`.
> Live VK capture + end-to-end acceptance = **Stage C** (`STAGE_C_ACCEPTANCE_PACK.md`). Stage 4 still not started.

**Locked rules (DEC-138):**
- Stage 3.5 Lead Scout Foundation is the next active build. Do **not** point to Stage 4 as the next active build.
- Stage 2 paid/live acceptance is **postponed to the Stage C Acceptance Pack** — it is not run now.
- Stage 4 (Claude Intelligence Layer) starts **only after** Stage 3.5 + the Acceptance Pack.
- Testing happens **after full builds** (acceptance pack), not as micro-tests after every node.

> Older "Stage 4 is the next active stage / closure pending" lines below (session-6/7/8 blocks, incl. "next active
> stage = Stage 4 after external audit") are **historical and no longer current** — the next active build is
> **Stage 3.5**, superseded by this LOCKED model and DEC-136/DEC-138.

---

**Near-term sequence (updated 2026-06-08, DEC-048/049/050):**
1.5 Resilient Output Layer ✅ done → 2 First Real Source Test (Firecrawl single competitor URL) ✅ done → **2.1 Firecrawl URL List mini-batch (3–5 URLs, manual) ✅ built — operator test next** → 2.5 Telegram Control Bot / URL Discovery (future) → 3 Competitor Monitor Agent → 4 Content Agent → 5 Telegram Control Bot. Stages 6–8 (Inbound Lead Bot, CRM, Analytics) follow. Stage numbers are canonical labels; the Telegram bot (Stage 5) block appears before the Content Agent block in this file for historical reasons.

---

## Stage 3 / 4 / 5 — Market Intelligence MVP (canonical definitions, 2026-06-12, DEC-123)

**Session-8 update (2026-06-17, DEC-136) — STAGE 3 MVP CLOSED / PASS; next active stage = Stage 4 after external audit:**
- **Stage 3 MVP source/intelligence foundation: CLOSED / PASS** on the clean two-channel WF11 v0.4.2 acceptance
  run. Telegram tracked-channel public preview CLOSED; WF08 handoff/accounting, WF10 aggregation, WF12
  deterministic report all PASS. VK live + Telegram groups/MTProto/member extraction = expansion/future (not MVP
  blockers); perfect semantic classification = Stage 4.1 task; dirty diagnostic runs kept, never closure evidence.
- **Stage 4 = 3 sub-stages:** 4.1 Claude Enrichment Core · 4.2 Intelligence Synthesis & Executive Report · 4.3
  Agent-Ready Report & Control Contract — started **after** the external audit (`PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF.md`).
- **Lead Scout layer** is now concrete (`LEAD_SCOUT_LAYER_PLAN.md`): public lead signals only, manual review, no
  auto-outreach. **Stage 2** web debt scoped with a runbook (`STAGE_2_WEB_COMPETITOR_PIPELINE_REVIEW.md` §5).
- This session: WF12 operator-facing wording de-jargoned ("tracked channels", no "allowlist"/"enable HTTP node");
  full Markdown report kept; Sheets long-row formatting documented. **No Stage 4 build, no external calls.**

**[HISTORICAL — NO LONGER CURRENT] Session-7 update (2026-06-17, DEC-135) — WF11 v0.4.2 FINAL Stage 3 quality gate; closure pending one acceptance run:**
> Superseded by DEC-136 (Stage 3 MVP CLOSED/PASS) and the LOCKED stage model (DEC-138) at the top of this file.
> The "closure PENDING one acceptance run" / "next active stage = Stage 4" wording in this block is historical.
- WF11 v0.4.2 closes the last relevance gap: **post-text-only** relevance with **5 classes**
  (`competitor_activity` · `market_signal` · `adjacent_real_estate_signal` skip · `irrelevant_live_false_positive`
  skip · `hard_negative` skip). Real-estate object/lot promos and agent recruitment no longer pollute
  competitor/market; holiday/personal posts are skipped. Channel title/username/tracked-channel list/description
  never create relevance.
- Transport is now **gate-based** (nodes enabled but unreachable unless the approval gate passes) — same pattern as
  other live workflows; safety = gate + tracked-channel validation + caps, not manual node disabling.
- Local sim 16/16 correct; fixture regression unchanged. **WF08 untouched.**
- **Stage 3 source pipeline: OPERATIONAL.** **Telegram public-channel source: closure PENDING one short acceptance
  run** (≤5 operator tests). **VK live → Stage 3 expansion** (not MVP blocker). **Telegram groups/MTProto/member
  extraction → future high-risk extension.** **Stage 2 web snapshot / WF06 manual config → backlog.**
- **Next active stage after acceptance = Stage 4 (Claude enrichment + executive report).** Operator-facing wording =
  "tracked Telegram channels / список отслеживаемых каналов".

**Session-6 update (2026-06-16) — first WF11 live smoke = contaminated diagnostics; relevance + accounting patched (Stage 3 still OPEN):**
- The first gated WF11 Telegram live smoke proved transport/parser/dedup, but **live relevance was too loose**
  (channel-level relevance wrote holiday/personal posts as business-relevant; market news inflated to competitor).
- Patched: **WF11 v0.4.1** post-level relevance (DEC-133) + **WF08 v0.10** loop-summary accounting (DEC-134).
- Live runs `wf11_req_…054733/055318/055705`, `touchpoint_…060227`, `wf10_…061138` are **contaminated
  diagnostics — NOT Stage 3 closure evidence.** Re-run WF11 live + WF08 handoff on **clean** data first.
- **Stage 3 remains NOT closed.** Live VK + Claude summary still gated; Stage 5 bot not started.

**Session-5 update (2026-06-16) — retests PASS · WF11 v0.4 gated Telegram live preview (Stage 3/4 NOT closed):**
- **WF14 quota patch v0.2 (DEC-130/131) retests PASS:** TEST B first run (`public_lead_signals +4`,
  `signals_written=4`, `duplicates_skipped=2`, no quota error), TEST C repeat (`+0`, `duplicates_skipped=6`),
  TEST E full-history quota (no quota error). WF14 no longer blocks the deterministic chain.
- **WF12 deterministic report PASS after public_lead_signals integration (TEST D):** `market_intelligence_reports
  +1`, `live_source_runs +1`, `llm_status=disabled`, `llm_cost_usd=0`, report includes `public_lead_signals:
  4 (new: 4)`. Deterministic Stage 4 report is **passing**.
- **Consistency pass (same date):** WF10 labels synced v0.2 → **v0.3** (labels only); WF12 lead-signal wording
  made fully conditional. No logic change.
- **WF11 v0.4 (DEC-132):** real but **gated** Telegram public-channel live preview — Firecrawl-preferred /
  HTTP-fallback transport, both nodes DISABLED by default; URL-aware allowlist gate rejecting private/invite/
  group/`t.me/c`; `max_channels≤2`, `max_posts≤10`; cost recorded (`cost_not_recovered` when unknown).
  **Live Telegram is built but NOT armed/done** — first live smoke is the next operator step.
- **Stage 3 — source/intelligence foundation: deterministic/fixture/tested chain is OPERATIONAL (PASS) after
  the WF14 retest.** Live Telegram (WF11) and live VK (WF13) remain **gated / not done**. Stage 3 not closed.
- **Stage 4 — deterministic WF12 report PASSES** (with public_lead_signals). The **Claude live summary remains
  gated / not live-tested** (branch disabled).
- **Stage 5 — Telegram Business Agent: planned, not started.**
- **Do not mark Stage 3 or Stage 4 closed; do not mark live Telegram/VK or Claude summary done.**

**Session-4 update (2026-06-12, DEC-124–130):**
- **Stage 2 web pipeline is part of the intelligence system, not forgotten** — reintegrated via
  `competitor_site_snapshots` + WF12 website block (DEC-129; WF04 snapshot-append = Phase B, own approval).
- **Stage 3** now includes: Avito live (approved) · Telegram **live-ready** (WF11 gated) · VK **live-ready**
  (WF13 gated, official API path, phone `#ERROR!` fixed, comments=`public_comment`) · **public lead signal
  layer** (WF14 → `public_lead_signals`) · website source reintegration · run ledger `live_source_runs`
  (WF11/12/13 auto + WF15 manual logger) · WF10 v0.3 objection counting.
- **Stage 4** now includes: deterministic stakeholder report v0.3 (executive digest, clean names, website +
  lead-signal blocks, action blocks; 25-col schema) · **controlled Claude summary test path** (approval token
  + budget guard before HTTP + JSON sections + quality flags + cost recording).
- **Stage 5** remains the Telegram Business Agent: commands → agent_requests → workflow selection → report
  delivery (see STAGE_5 doc; new `/triage`, `/runs` candidates).

The MVP is **not Avito-only output** (DEC-113). Canonical pipeline:
**source connectors → raw_market_records → WF08 analyzer → WF10 aggregator → WF12 report/Claude layer → Stage 5 Telegram Business Agent.**

- **Stage 3 — Source & Intelligence Foundation** (`docs/STAGE_3_SOURCE_AND_INTELLIGENCE_FOUNDATION.md`):
  connectors WF09 (Avito ✅ live), WF11 (Telegram ✅ fixture + guarded inert live path, DEC-120),
  WF13 (VK public discussions 🔧 built, DEC-121); WF08 with `llm_enabled=false` cost-control (DEC-119);
  WF10 deterministic fact core. NOT an infinite parser collection.
- **Stage 4 — Report & Claude Layer** (`docs/STAGE_4_REPORT_AND_CLAUDE_LAYER.md`): WF12 v0.2
  (full deterministic report sections, DEC-122) → `market_intelligence_reports`; optional gated Claude
  summary (claude-sonnet-4-6, cost-tracked, disabled by default); report quality checks.
- **Stage 5 — Telegram Business Agent** (`docs/STAGE_5_TELEGRAM_BUSINESS_AGENT_PLAN.md`): commands →
  agent_requests → approval gates → workflow selection → report delivery + Sheets links; future niche
  selection; **no parser logic inside Telegram** (DEC-067).

---

## Stage 1 — Marketing Scout v0.1 (Current)

**Status:** In progress
**Module directory:** `modules/marketing-scout-v0/`

**Goal:** Manual end-to-end pipeline. Prove the concept works.

**Deliverables:**
- n8n workflow: trigger → scrape → split → normalize → analyze → score → aggregate → store → notify
- System prompt for Claude API analysis node (v2 written, baseline d350069 stable for hot leads)
- Google Sheets schema with all required columns
- Telegram summary template
- 3+ test records processed successfully

**Stack:** n8n + Apify/Firecrawl + Claude API + Google Sheets + Telegram Bot

**Completed milestones:**
- Workflow 00 (healthcheck), 01 (Sheets), 02 (Claude API single record) all working
- Prompt v2 written and tested — hot leads (Tests 1, 8) confirmed
- Extended tests 8–12 run — output-contract failures identified on non-obvious records

---

## Stage 1.5 — Resilient Output Layer ✓ COMPLETED 2026-06-06

**Status:** ✅ Complete. Tests A–E passed; production workflow built (DEC-037).
**Design spec:** `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`
**Decisions:** DEC-033 (design), DEC-035 (dynamic-sheet routing), DEC-036 (routing priority + normalization), DEC-037 (production strip + cleanup)

**Goal (met):** Fixed output-contract instability without changing the primary prompt.

**Delivered:**
- JSON Repair Formatter node (second Claude call, schema-only prompt, no re-analysis, no invented facts)
- Dynamic-sheet routing — one Google Sheets node, `Sheet Name = {{ $json.route }}` (replaced Switch by Route)
- 6 tabs: `results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`
- 8 production technical fields; route validation; service_type + company_name normalization; recommended_action normalization
- Tests A–E all pass; production workflow `02_claude_api_single_record_v2_resilient_router_production.json` created (test fields stripped)

**Remaining before scraper:** import production workflow, set credential + Spreadsheet ID, create 6 tabs, run one manual smoke test.

---

## Stage 2 — First Real Source Test: Firecrawl Single Competitor URL ✅ COMPLETED 2026-06-08

**Status:** ✅ Complete. Two real single-URL competitor tests passed after DEC-043/044 hardening (DEC-045).
**Goal (met):** Prove the full chain on one real source: Firecrawl scrape of one public competitor secured-lending page → resilient router → `monitor_queue`.

**Passing tests (2026-06-08):**
- `https://mosinvestfinans.ru/` → `monitor_queue`, competitor, `МосИнвестФинанс`, `generic_lending`, strength/quality 78, `monitor`, `parsed_success`, `primary_json`, `repair_used=false`.
- `https://www.lioncredit.ru/uslugi/kredit-pod-zalog-nedvizhimosti` → `monitor_queue`, competitor, `LionCredit`, `generic_lending`, strength/quality 75, `monitor`, `parsed_success`, `primary_json`, `repair_used=false`.

**Delivered:**
- [x] `03_firecrawl_single_url_resilient.json` (17 nodes; Firecrawl failure → `technical_errors` without Claude, DEC-041; `text_context`≤6000, DEC-042; post-repair consistency hardening, DEC-043/044). active=false.
- [x] `docs/N8N_WORKFLOW_03_FIRECRAWL_SINGLE_URL_RU.md` + `docs/FIRECRAWL_SETUP.md`.
- [x] Manual runs with real competitor URLs; cost deltas recorded in `COSTS_AND_LIMITS.md`.
- [x] Operational requirement recorded: manual credential rebinding after import (DEC-046).

**Approved (DEC-045):** Firecrawl single-URL competitor website ingestion + competitor → `monitor_queue`, for manual controlled use.

---

## Stage 2.1 — Firecrawl URL List Mini-Batch ✅ COMPLETED / APPROVED (manual ≤5 URLs, 2026-06-08)

**Status:** ✅ BUILD COMPLETED, dedup VALIDATED on **3-URL and 5-URL** runs, **APPROVED for manual ≤5 URL runs** (DEC-048/049/051/052/053/054) — `n8n/workflows/04_firecrawl_url_list_resilient.json`, active=false.
**Goal:** Process a manually provided list of **3–5 competitor URLs in one manual run**, reusing the Workflow 03 chain with a per-URL loop and `url_registry` dedup.

**Built:** 25 nodes — Set URL List → Loop Over Items → Normalize URL for Dedup → Registry Lookup → Evaluate Dedup → IF Duplicate? → (dup → skipped_log / new → Firecrawl → resilient analyzer → Append → Build Registry Row → Append url_registry) → loop. 35-field business schema + 10-field `url_registry`.
**Validated:** 3-URL run (DEC-053) — Run 1 process / Run 2 all `skipped_log`, 0 cost. **5-URL run (DEC-054, `firecrawl_20260607_100715`)** — 2 duplicates skipped, 1 placeholder skipped, 2 competitors → `monitor_queue`; Claude Δ $0.0429. Output hardened: placeholder pre-filter before Claude, stronger PTS service-type override, Russian output-language guard. `url_registry` is the dedup source of truth (old rows re-process once until backfilled — optional).

**Hard limits:** max 5 URLs, manual trigger only, no crawl/batch/search, no schedule, `text_context`≤3500, continue-on-failure per URL (failed URL → `technical_errors`).

**Next:** Stage 2.2 — URL Discovery Layer planning (do not build yet).

**Later sources (in order):** Avito/Apify → Telegram → Instagram.

---

## Stage 2.2 — Apify Search Candidate Discovery (Workflow 05 BUILT/under test, DEC-055/056/057/058/059/060)

**Status:** 🔧 BUILT, UNDER TEST — `05_apify_search_candidate_discovery.json` (active=false). Awaiting Apify token + credential + first manual test.
**Selected architecture:** **Level 2 — Apify Search Candidate Discovery** (Workflow 05). Manual entry is an optional fallback mode; Telegram is a later interface; Firecrawl `/v2/search` parked (DEC-059).
**Goal:** A URL **supplier** that turns an operator query (e.g. «займ под залог ПТС Москва») into vetted candidate URLs for Workflow 04 (the URL **consumer**, unchanged), via an Apify Google Search actor. Separate layer, **`url_candidates` (25 cols)** + **`discovery_requests` (18 cols)**, human approval before any spend, reuses `url_registry` dedup.
**Plans:** `docs/URL_DISCOVERY_STRATEGY.md` (Level 2 Apify, risks, gates G1–G5), `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md` (node plan + schemas + Apify credential).
**Default volumes:** collect up to **10** candidates/request; Workflow 04 processes **≤5/run** → 10 approved run as **two batches of 5**. **0 Firecrawl/Claude in Workflow 05** (Apify search cost only).

### Stage 2.2 build — `05 - Apify Search Candidate Discovery` 🔧 BUILT, candidate-quality patch, under test

**Status:** 🔧 BUILT + candidate-quality patch (2026-06-08, DEC-060/061) — `n8n/workflows/05_apify_search_candidate_discovery.json` (13 nodes, active=false). First real Apify test passed **technically**; quality patch applied (`candidate_type`, fixed `domain`, competitor-first scoring); **retest required** (add `candidate_type` column, re-import, rerun query).
**Goal:** Query → Apify Google Search actor → normalize → check `url_registry` → classify `candidate_type` → competitor-first score → write `url_candidates` (26 cols, `new`/`duplicate`) + `discovery_requests` (`status=needs_review`). **0 Firecrawl/Claude**, no auto-processing, human approval before Workflow 04.

### Stage 2.2c — Approved Candidates Runner (hand-off) — 🔧 registry-recheck + runner modes, E2E PASSED, FINAL RETEST pending

**Status:** 🔧 BUILT (DEC-064) + registry-recheck (DEC-065) + domain-diversity (DEC-066) + **runner modes (2026-06-07, DEC-072)** — `n8n/workflows/06_approved_candidates_runner.json` (active=false). **Full web-pipeline E2E passed** (WF05→WF06→WF04). A **Set Runner Config** node now sets `runner_mode`: **`first_pass_domain_diversity`** (DEFAULT) = max 1 URL/domain/run (second+ → `duplicate_domain_in_run`); **`deep_domain_analysis`** (EXPLICIT) = up to 3 URLs/domain/run (extras → `domain_deep_limit`, selected items carry a deep-mode warning). `max_per_run=5`, registry recheck, root-first priority, manual handoff preserved; `url_registry` semantics unchanged (full normalized URL, never domain). **Final Stage 2 retest pending** (`docs/STAGE_2_WEB_PIPELINE_REVIEW.md` T2/T3/T4).
**Goal:** Pick `approval_status=approved` candidates from `url_candidates` (non-empty URL, and **re-normalized URL not in `url_registry`** — the registry, not the editable `dedup_status`/`registry_status`, is the dedup gate), prioritize `direct_competitor` → higher `confidence_score` → lower `rank`, **hard cap 5/run**, and feed Workflow 04. No new analysis logic — it only orchestrates the existing consumer.
**v0.1 implementation:** **manual hand-off** — Workflow 06 emits a WF04-shaped ≤5-URL batch + Execution Summary + ready-to-paste `Set URL List` block; it does **not** call Workflow 04 as a subworkflow (WF04 keeps its Manual Trigger; subworkflow conversion is a risky trigger refactor, deferred). A `Mark Candidates Processed` update node (→ `approval_status=processed`, preserving `approved_by`/`approved_at`) ships **disabled**; operator enables it after confirming `monitor_queue`. No Apify/Firecrawl/Claude/Telegram. Guide: `docs/N8N_WORKFLOW_06_APPROVED_CANDIDATES_RUNNER_RU.md`.

### Stage 2.2 fallbacks (later, parked)

Google Custom Search JSON API (low-cost) and SerpAPI (paid, stable) are evaluated only if Apify proves
insufficient. Firecrawl `/v2/search` parked. All reuse the same `url_candidates`/approval spine.

---

## Stage 2 — Web competitor pipeline — ✅ APPROVED WITH MINOR LIMITATIONS (2026-06-07)

The web competitor discovery pipeline **05 (discovery) → 06 (approval runner) → 04 (analyzer)** has passed
real tests and is **APPROVED with minor limitations** (DEC-074). It stays **modular — not merged into a
monolith** (DEC-071/074). Final results: **`docs/STAGE_2_FINAL_TEST_RESULTS.md`**; technical review +
T1–T11 matrix: **`docs/STAGE_2_WEB_PIPELINE_REVIEW.md`** §10.
**Approved:** WF05 discovery, WF06 runner + runtime registry recheck (DEC-073), WF06 `first_pass_domain_diversity`
+ `deep_domain_analysis` modes (DEC-072; runner modes implemented + simulation-validated, live re-test
recommended — watch item W1), WF04 analyzer + resilient parse/repair + placeholder prefilter + PTS override +
contact sanitation, `url_registry` dedup.
**Manual limitations (accepted):** human approval required; **manual** 06→04 handoff; candidates marked
`processed` manually after WF04 confirmation; Telegram bot / lead connectors / universal `market_profile` not
built.

### Stage 2.4 — Auto-Handoff 06 → 04 (DEFERRED future improvement, DEC-075)

**Status:** 🟥 DEFERRED — evaluated this pass, **not implemented**. A safe design (Workflow 04 callable
Execute Workflow Trigger feeding the existing analyzer; Workflow 06 Execute Workflow node + confirm-then-mark
status update; default stays `manual_handoff_to_workflow_04`) is documented in
**`docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`**. Blockers: no `source_candidate_id` threading through WF04's
25-node, 35-field-locked, branching/looped analyzer; the confirm-then-mark safety property cannot be
live-tested in this environment. **Comes before** the Telegram Control Bot (Stage 4); manual handoff remains
the approved path until Stage 2.4 is built and live-validated.

---

## Stage 3 — Social/Classified Touchpoint Discovery (reframed, DEC-078)

> First capability domain of the **Business Scout Agent**. **Lead discovery is a subset of touchpoint
> discovery.** Records span 12 classes; requests tracked in `agent_requests`. Nothing below is built; all gated
> behind stakeholder approval. Docs: `BUSINESS_SCOUT_AGENT_VISION.md`, `AGENT_TOOL_ARCHITECTURE.md`,
> `AGENT_MEMORY_PLAN.md`, `STAGE_3_LEAD_SOURCE_EVALUATION.md`, `LEAD_DISCOVERY_ARCHITECTURE.md`,
> `SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`.

- **3.0 — Stakeholder product reframe + source evaluation** ✅ **DONE 2026-06-08 (eval/design only)**: reframed
  to Business Scout Agent + touchpoint discovery; source matrix re-scored under the touchpoint/agent lens
  (Avito, Yandex Dzen, VK, Telegram parser, Instagram, competitor pages/commenters, Yandex/Search, Manual).
- **3.1 — Agent/touchpoint data model** ✅ **DONE 2026-06-08**: operator created all 4 tabs (`agent_requests` 21,
  `raw_market_records` 40, `market_record_registry` 15, `agent_memory` 13; see `TABLE_SCHEMA.md`). `agent_requests`
  generalizes `lead_discovery_requests`. Implemented together with 3.2 below (Workflow 07 — Manual Touchpoint
  Intake), which the task labels **Stage 3.1**.
- **3.2 — Manual records/touchpoint intake** 🔧 **BUILT, UNDER TEST (2026-06-08, DEC-079)**: `Workflow 07 —
  Manual Touchpoint Intake` (`active=false`) normalizes 12 manually collected mixed-source examples (Avito/Dzen/
  VK/Telegram/competitor/forum/reviews + irrelevant + hot-lead control) → `raw_market_records` (40) +
  `market_record_registry` (15) + `agent_requests` (21). Zero source cost/risk, no LLM, no scraping; `agent_memory`
  not written. Next: import/bind/run/verify, then build the Touchpoint Analyzer.
- **3.2 — Touchpoint Analyzer** ✅ **STAGE 3.2 CLOSED (2026-06-10, DEC-089) — DETERMINISTIC-FIRST BASELINE APPROVED + compact LLM enrichment APPROVED WITH WATCH ITEM (DEC-080/081/082/083/085/086/087/088/089)**:
  `Workflow 08 — Touchpoint Analyzer` (`active=false`) reads approved/unique `raw_market_records`, classifies
  **deterministically from intake hints**, and routes to the 6 business tabs (existing **35-column** schema) via
  dynamic sheet. **TEST 3 PASS** (Claude calls=0 / $0, `repair_used=false`, routes 6/3/1/2, `technical_errors=0`) →
  **baseline approved**. **LLM enrichment**: full-row run (Test C) failed → **v4 (DEC-085) = compact enrichment-only
  JSON merged into the deterministic row** (`thinking` disabled; route/action/entity/contact stay deterministic).
  **C2 attempt #1 wrote only record 1** (loop-stall) → **v5 (DEC-086) moves C2 filtering pre-loop**. **Test C2
  attempt #2 = PARTIAL PASS / NOT APPROVED** (4 fixtures processed, `technical_errors=0`, routes preserved, but
  `primary_json=2/4`; Telegram fell back, Zoon over-classified as competitor, Banki reason had a no-contact outreach
  phrase) → **v6 (DEC-087)**: shorter compact source/review prompt + deterministic HINTS, named-only competitor for
  review directories, no-contact + no-trend reason sanitizers. **Test C3 = PARTIAL PASS / NOT APPROVED** (4 fixtures,
  `technical_errors=0`, routes preserved, Avito/Banki/Zoon now good, but `primary_json=2/4` because **Telegram
  `source_candidate` still fell back**) → **v7 (DEC-088)**: source_candidate / `source_type=social_channel` / Telegram
  use a **specialized ultra-short 7-key enrichment schema** (`profile_name, service_type, offer_text, detected_need,
  reason, content_idea_score, quality_score`) + minimal payload; repair uses the same 7-key schema; a post-merge safety
  assertion keeps route/entity/action/contact/lead/competitor deterministic; specialized `max_tokens` 500/400 (no cost
  rise). **Test C4 = PASS (2026-06-10, DEC-089):** 4 fixtures, `technical_errors=0`, **`primary_json=3/4`**,
  `repaired_json=0/4`, **`deterministic_fallback_after_llm_fail=1/4`** (the Banki/forum lead-pattern, safe — stayed
  `review_queue`), `repair_used=false` for the 3 `primary_json` rows, MSK OK, routes preserved, **Telegram fixed**
  (`primary_json` → `content_queue`). **Verdict:** deterministic_first baseline approved + **compact LLM enrichment
  APPROVED WITH WATCH ITEM** for optional / test use; **default stays `deterministic_first` unless the operator
  explicitly enables `llm_enrichment`**; watch item = Banki/forum lead-pattern still falls back (safe). C4 cost delta:
  TODO_OPERATOR_FILL. **Timestamps Moscow `+03:00`** (DEC-083). Test log: `docs/STAGE_3_2_TEST_RESULTS.md`.
- **3.3 — First real source connector: Avito/Classifieds Listing Connector** ✅ **CLOSED / APPROVED (2026-06-11, DEC-102)**: live run #3 (`avito_req_20260611_184324`) passed the full gate — 10/10 structurally valid, **7 false positives hard-skipped before raw/registry**, 3 relevant credit-broker rows (2 unique + 1 duplicate), registry +2 exact, WF08 live handoff **monitor_queue +2 / technical_errors=0 / Claude calls=0** with full ad-intelligence fields (terms, competitor_strength 79, content_idea 45). All closure criteria pass (fixture first/duplicate/handoff, live transport, live relevance filter, raw/registry consistency, $0 deterministic). Post-closure polish: **WF09 v006 (DEC-103)** — URL canonicalization rewritten sandbox-safe (the n8n Code sandbox lacks the `URL` global; v005 silently kept `?context=`); watch item: verify canonical URLs next routine live run. Avito = the **first stable live source** (DEC-099 WF10 gate satisfied). History (2026-06-10/11, DEC-090/092/093/094/095): WF09 fixture tests + the WF08 deterministic handoff passed (monitor 5 / skipped 1 / technical_errors 0 / Claude 0); **fixture-mode only — no real Avito scrape** (`fixture_mode=true`, `live_mode=false`, source cost $0). **DEC-092 quality patch:** WF09 `max_items=6` (= total fixture records), richer `service_hint`/`semantic_keywords`, Apify live node wired for HTTP Header Auth (no secrets); WF08 deterministically enriches Avito competitor rows (offer/title, price/terms, specific service theme, content_idea_score 35–55, competitor_strength 75–85) — gated to WF09-origin rows, Stage 3.2 baseline unchanged. Live Apify smoke (actor id + bound credential, `max_items=3–5`) still pending.
  `Workflow 09 — Avito Classifieds Listing Connector` (`active=false`, **fixture mode default, $0, no Apify call, no
  LLM**) transforms Avito/classified listings into `raw_market_records` for the Touchpoint Analyzer (Workflow 08).
  First real source after manual intake; directly supports **Competitor Ad Intelligence / Semantic Intelligence**
  (offers, prices/terms, ad wording, positioning, semantic keywords, ad channels). Deterministic normalize +
  `market_record_registry` dedup (by listing id / URL hash) + one `agent_requests` row; writes **only**
  `agent_requests`/`raw_market_records`/`market_record_registry` (unique only) — **never** business tabs, **no
  auto-handoff** to Workflow 08. Live Apify mode documented + disabled by default (gated behind a chosen actor +
  explicit approval; no direct Avito scraping). Build-sim: fixture run → 6 raw / 6 unique registry / 1 agent_requests,
  predicted `monitor_queue=5`/`skipped_log=1`; duplicate run → all `duplicate_in_registry`, registry +0. MSK `+03:00`;
  40/15/21-column outputs match WF07. Plan: `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md`; guide:
  `docs/N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md`; test log: `docs/STAGE_3_3_TEST_RESULTS.md`; source
  decision: `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`.
- **3.4 — Social Source Parsing Strategy** ✅ **STEP 2 FOUNDATION FIXTURE PASS (2026-06-12, DEC-114/116/117)** —
  WF11 operator fixture tests all passed: Test 1 (`wf11_req_20260612_033442`): 6 posts → 5 business-relevant /
  1 hard-skip / 4 unique / 1 duplicate → raw +5 / registry +4 / agent_requests +1; Test 2 repeat
  (`wf11_req_20260612_033756`): unique=0 / duplicates=5 / registry +0; Test 3: live guard stops correctly;
  $0, no external/Claude calls. Post-test patch **v0.1.1 (DEC-114)**: Telegram handle contacts now write
  `contact_channel=telegram` (channel category — `handle` is a format and is banned from the column) with
  `contact_format=handle` / `contact_source_url` / `contact_use_policy=manual_review` in notes; fixture counts
  unchanged (24-check sim PASS). **WF08 handoff rule (DEC-117):** use the FIRST-run request id — duplicate-run
  ids correctly yield 0 records under default `analyze_statuses=['approved','new']` (diagnostics in the WF08/
  WF11 RU guides + a WF08 sticky note). **Live Telegram public preview = pending v0.2 plan (DEC-116, strategy
  §5.7), requires explicit operator approval**: allowlist-only public channels, `t.me/s/` preview pages only,
  no groups/MTProto/member data/hidden contacts, ≤10 posts/channel; WF11 carries inert live_* placeholder
  config (guard fires regardless). History: 🔧 STRATEGY WRITTEN (DEC-096) + STEP 2 FOUNDATION BUILT
  (2026-06-12, DEC-109/110) — first non-Avito source selected: **Telegram public-channel preview**
  (`t.me/s/<channel>`; highest competitor-ad value per unit of risk; comparison vs VK/reviews-maps/Dzen in
  `STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md` §5.2). `Workflow 11 — Social Source Connector Foundation`
  built **fixture-only** (`active=false`, `fixture_mode=true`, `live_mode=false`, **no HTTP node** — live
  branch is an error guard; writes only `agent_requests`/`raw_market_records`/`market_record_registry`;
  WF09 dedup/relevance pattern; contact policy enforced; build-sim 31 checks PASS). Live preview fetch =
  separate future approval (transport + credential + DOM-parser patch). Guide:
  `docs/N8N_WORKFLOW_11_SOCIAL_SOURCE_CONNECTOR_FOUNDATION_RU.md`. Connector contract (every source):
  connector → agent_requests → raw_market_records → market_record_registry → WF08 → WF10 → report/Telegram
  layer. Original strategy record: ✅ STRATEGY WRITTEN (2026-06-11, DEC-096) — `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`: per-source analysis (Telegram/VK/Instagram/Dzen/reviews-maps/competitor-web) of access methods, risks, costs, quality, lead vs competitor-intel value, contact availability, priorities. **Decision: one-source-at-a-time connector pattern** (source connector → `raw_market_records` → WF08 → aggregator/report); order: Avito stabilize → Telegram public feasibility → VK API → reviews/maps → Dzen → Instagram after a separate risk review. **No parser built.** Companion docs: `CONTACT_AND_OUTREACH_POLICY.md` (DEC-097/098, binding), `WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md` (DEC-099), `NICHE_PACK_SYSTEM_PLAN.md` (DEC-100), `COMPETITOR_AD_INTELLIGENCE_PLAN.md` (DEC-101). Original scope description: Avito is only
  the **first** connector. A wider strategy must compare future social sources — **Telegram** public channels/groups,
  **VK** public posts/groups/comments, **Instagram** public posts/comments/competitors, **Dzen** posts/comments,
  **review platforms / maps** — across: official APIs where practical · Apify/actor approach · Firecrawl/web approach
  for public pages · public-preview parsing · account/client-based scraping risks · legal/platform/rate-limit risks ·
  dedup & data quality · competitor-intelligence value · lead-signal value · cost comparison · **source ranking**. The
  **Telegram Parser ≠ Telegram Control Bot** (DEC-067): needs a separate client/MTProto-style session + compliance
  design; groups/members/comments/DMs are higher-risk. **No social parser is built in this stage** — strategy only;
  build only after explicit approval + per-source feasibility/compliance.
- **3.5 — WF10 Market Intelligence Aggregator (Competitor Semantic & Ad Intelligence aggregation)** 🔧 **v0.2 PATCHED (2026-06-12, DEC-106/107/108) after v0.1 operator tests** — v0.1 tests: Test 1 (82 rows → 21 profiles / 9 angles / 8 signals / 1 plan / 7 seed rules, $0), repeat (+0 rules), Avito filter — PASS; **no-data test found the generic-plan bug → fixed in v0.2** (no-data guard: marked `no_data` plan only, `result_summary` starts `no_data;`). v0.2 also: entity resolution company_name → profile_url → canonical listing id → profile_name → offer+platform fallback (deflates duplicate `(unnamed)` profiles); mandatory `source_mix=mixed: live + historical/manual + web pipeline` label. **LLM synthesis is permanently OUT of WF10 by default (DEC-112)** — Claude moves to the report/control layer (`REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md`). v0.1 record: **v0.1 BUILT (2026-06-11, DEC-104)** — `n8n/workflows/10_competitor_audience_intelligence_aggregator.json` (`active=false`, 22 nodes, manual trigger, **fully deterministic — no LLM/Apify/Firecrawl/external API, $0**). Gate (DEC-099: one stable live source) satisfied by Stage 3.3 closure. Reads monitor/content/review queues, 30-day window + niche/platform/region/service_type filters, groups competitors (company_name → profile_name → offer+platform → listing id), writes `competitor_profiles` (17) / `market_angles` (9, fixed 9-angle taxonomy) / `audience_activity_signals` (14, aggregate-only per contact policy) / `content_positioning_plan` (12) / `source_confidence_rules` (5, seed-once) + 1 `agent_requests` row. Schemas: `docs/WF10_TABLE_SCHEMAS.md`; guide: `docs/N8N_WORKFLOW_10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_RU.md`; v0.2 = upsert profiles + optional bounded LLM synthesis (operator-approved). Plan: `docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md`. Original scope: aggregate competitor
  offers, prices/terms, ad wording, positioning, semantic keywords, and ad channels across collected
  `raw_market_records` into reusable competitor/semantic intelligence (read-only over existing sheets; no new
  collection). Builds on the Avito connector + Workflow 08 enrichment.
- **3.6 — Analyzer/scoring hardening for touchpoints/leads** 📋 PLANNED (after 3.3/3.4 tests): calibrate scoring
  (`lead_signal_score`/`urgency_score`/`contactability_score`/`region_score`/`collateral_fit_score`) +
  `lead_temperature` + `next_action` on real touchpoint outcomes.
- **3.7 — E2E touchpoint pipeline** 📋 PLANNED: `agent_request` → connector → `raw_market_records` → dedup →
  approval → analyzer → routed output; source vs analysis cost measured separately.

---

## Stage 4 — Control Agent Interface (Later, DEC-067/078)

**Status:** 📋 LATER — **not built; plan written (2026-06-12):** `docs/TELEGRAM_CONTROL_AGENT_PLAN.md` —
Telegram = control/report interface, NOT a parser; creates `agent_requests`, triggers/reads workflows, returns
digests + Sheets links; paid actions always behind approval; Claude usage per DEC-112. A **conversational control agent** (future Telegram/chat), **not just slash
commands**: it provides **conversational control over the tools** — receive task → clarify → show plan + cost →
ask approval → run tool(s) → return summary + next actions. It **chooses** tools and **calls** existing
workflows; it contains **no parser/scraping logic** (Control Agent ≠ source parser). Requests recorded in
`agent_requests`. **Prerequisites:** Stage 3.x touchpoint discovery + approval flow; Telegram bot token + webhook.

---

## Stage 5 — Reporting / Export / Summary (Later)

**Status:** 🔧 **Report Builder v0.1 SKELETON BUILT (2026-06-12, DEC-118):** WF12
`n8n/workflows/12_market_intelligence_report_builder.json` (`active=false`, deterministic, $0, no HTTP node;
Claude branch = guard, Telegram send not implemented; reads the 4 WF10 tabs, writes one
`market_intelligence_reports` row + one `agent_requests` row; angle trends vs previous WF10 run; 20-check sim
PASS; guide `docs/N8N_WORKFLOW_12_MARKET_INTELLIGENCE_REPORT_BUILDER_RU.md`). Operator must create the
`market_intelligence_reports` tab (20 cols) before the first run. Architecture (2026-06-12, DEC-112/113):
`docs/REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md` + `docs/MARKET_INTELLIGENCE_REPORT_SCHEMA.md`
(`market_intelligence_reports` tab, 20 cols). Flow: WF10 tabs → deterministic Report Builder → **optional**
Claude summary (disabled by default; facts-only; no contacts/outreach) → `market_intelligence_reports` →
Telegram digest → later Business Agent Control Kernel. WF10 stays the deterministic fact core; reports always
carry the `source_mix` label. Read-only over existing sheets; no new collection.

## Stage 6 — Advanced Business Automations (Future)

**Status:** 📋 FUTURE — **not built.** Includes: **auto-handoff WF06→WF04** (Stage 2.4 plan); **scheduled
monitoring**; reusable **`market_profile`** for other niches; **CRM**; **outreach/autocall only after a
compliance/platform review**; deeper **memory/agent orchestration**. Requires Stage 3.x + Stage 4 stable and
approved first.

> **Numbering note:** Stages 4–6 above are the canonical forward sequence (Control Agent → Reporting → Advanced).
> The historical blocks below (Competitor Monitor Agent, Content Agent, Inbound Lead Bot, CRM, Analytics) use
> older stage labels and are retained for continuity.

---

## Stage 3 — Competitor Monitor Agent

**Status:** Planned
**Module directory:** `modules/competitor-intelligence-v0/`

**Goal:** Automated monitoring of a defined list of competitor URLs.

**Additions:**
- Scheduled n8n trigger (cron)
- Competitor URL list management
- Deduplication logic (skip already-seen URLs)
- Delta alerts: notify only on new items since last run

---

## Stage 5 — Operator Telegram Control Bot / Assistant

**Status:** Future roadmap (after stable data collection and first real source tests)
**Module directory:** `modules/telegram-control-bot-v0/` _(planned)_

**Goal:** Let the operator issue commands via Telegram that trigger and control n8n workflows, without needing to open the n8n UI.

**Example interaction:**
```
Operator: "Проанализируй конкурентов из Instagram: @zaym_msk, @pts_fast_moscow"
Bot: "Запрос принят. Источники: 2. Примерная стоимость: $0.03. Запустить?"
Operator: "Да"
Bot: [triggers Workflow 02 for each source]
Bot: "Готово. Найдено 2 конкурента, 0 лидов. Открыть таблицу: [ссылка]"
```

**Bot capabilities:**
1. Parse the operator's Telegram command (source type, URLs or handles)
2. Propose an execution plan and estimate cost
3. Ask for confirmation before spending money
4. Trigger the correct n8n workflow
5. Update Google Sheets with results
6. Send a concise summary and table link back to Telegram

**Prerequisites before implementation:**
- At least one real scraping source (Firecrawl or Apify) tested and stable
- Workflow 02 approved and connected to real data
- Telegram Bot token obtained (free, via BotFather)
- n8n Webhook trigger configured for the bot

**Why this stage matters:**
The operator does not need the n8n UI for routine analysis. A Telegram interface lowers the activation barrier to zero — they can request analysis from their phone at any time. This is the key UX improvement that makes the system feel like a product, not a prototype.

---

## Stage 4 — Content Agent

**Status:** Planned (later)
**Module directory:** `modules/content-agent-v0/`

**Goal:** Generate content ideas from competitor and industry content.

**Additions:**
- Content classification in Claude prompt
- Content idea scoring (`content_idea_score`)
- Output routed to a separate Google Sheets tab
- Optional: draft headline generation

---

## Stage 6 — Inbound Lead Bot

**Status:** Planned
**Module directory:** `modules/inbound-lead-bot-v0/`

**Goal:** Monitor classifieds and social media for inbound lead signals.

**Additions:**
- Avito keyword monitoring (scheduled)
- Social media keyword tracking
- Lead signal scoring refinement (`lead_signal_score`)
- Telegram alert for high-score leads (score >= 8)

---

## Stage 7 — CRM Assistant

**Status:** Planned
**Module directory:** `modules/crm-assistant-v0/`

**Goal:** Light CRM layer on top of Google Sheets output.

**Additions:**
- Status tracking column (`status`: new / contacted / qualified / closed)
- Telegram command interface: mark lead status via bot command
- Weekly digest summary

---

## Stage 8 — Analytics Agent

**Status:** Planned
**Module directory:** `modules/analytics-agent-v0/`

**Goal:** Aggregate insights across all pipeline output.

**Additions:**
- Weekly trend report: top sources, top entity types, average scores
- Competitor activity heatmap
- Content gap analysis
- Delivered via Telegram or Google Sheets dashboard
