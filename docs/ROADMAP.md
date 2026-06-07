# ROADMAP.md — Marketing Scout Stages

**Near-term sequence (updated 2026-06-08, DEC-048/049/050):**
1.5 Resilient Output Layer ✅ done → 2 First Real Source Test (Firecrawl single competitor URL) ✅ done → **2.1 Firecrawl URL List mini-batch (3–5 URLs, manual) ✅ built — operator test next** → 2.5 Telegram Control Bot / URL Discovery (future) → 3 Competitor Monitor Agent → 4 Content Agent → 5 Telegram Control Bot. Stages 6–8 (Inbound Lead Bot, CRM, Analytics) follow. Stage numbers are canonical labels; the Telegram bot (Stage 5) block appears before the Content Agent block in this file for historical reasons.

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

### Stage 2.2c — Approved Candidates Runner (hand-off) — 🔧 BUILT + registry-recheck patch, STILL UNDER TEST

**Status:** 🔧 BUILT (2026-06-07, DEC-064) + **runtime registry-recheck patch (2026-06-07, DEC-065)** — `n8n/workflows/06_approved_candidates_runner.json` (active=false). The first manual test exposed a trust bug: an operator-edited old duplicate (`autolombard-moskva.ru/pledge-pts/`, already in `url_registry`) was selected because WF06 trusted the editable `url_candidates` dedup fields. WF06 now **re-reads `url_registry` at runtime** and re-normalizes `candidate_url` before selecting. **Stage 2.2c still under test** until the registry recheck is validated (retest: old approved duplicate → `registry_recheck_duplicate` skip; new approved `direct_competitor` → selected).
**Goal:** Pick `approval_status=approved` candidates from `url_candidates` (non-empty URL, and **re-normalized URL not in `url_registry`** — the registry, not the editable `dedup_status`/`registry_status`, is the dedup gate), prioritize `direct_competitor` → higher `confidence_score` → lower `rank`, **hard cap 5/run**, and feed Workflow 04. No new analysis logic — it only orchestrates the existing consumer.
**v0.1 implementation:** **manual hand-off** — Workflow 06 emits a WF04-shaped ≤5-URL batch + Execution Summary + ready-to-paste `Set URL List` block; it does **not** call Workflow 04 as a subworkflow (WF04 keeps its Manual Trigger; subworkflow conversion is a risky trigger refactor, deferred). A `Mark Candidates Processed` update node (→ `approval_status=processed`, preserving `approved_by`/`approved_at`) ships **disabled**; operator enables it after confirming `monitor_queue`. No Apify/Firecrawl/Claude/Telegram. Guide: `docs/N8N_WORKFLOW_06_APPROVED_CANDIDATES_RUNNER_RU.md`.

### Stage 2.2 fallbacks (later, parked)

Google Custom Search JSON API (low-cost) and SerpAPI (paid, stable) are evaluated only if Apify proves
insufficient. Firecrawl `/v2/search` parked. All reuse the same `url_candidates`/approval spine.

---

## Stage 2.3 — Telegram Control Bot Planning (Later, DEC-057/059)

**Status:** 📋 LATER — deferred until discovery (Stage 2.2) + approval flow exist (gates G1–G4).
**Goal:** Operator requests analysis in natural language; bot proposes candidates + cost, asks approval, triggers processing, returns a summary. The bot is a **control interface**, not a data-processing engine.
**Flow:** request text → bot creates `discovery_requests` row → Workflow 05 collects candidates → bot shows candidates + estimated cost → operator approves → Approved Candidates Runner / Workflow 04 processes → bot returns summary. The bot **calls** the existing workflows and **duplicates no discovery/processing logic**. `url_registry` dedup prevents repeat processing.
**Prerequisites:** Stage 2.2 discovery + approval flow (and ideally 2.2c runner); Telegram bot token + n8n webhook.

---

## Future — Source Connectors (social / classified, later)

Add **source connectors** (not per-platform agents): *Classifieds Connector* and *Social Connector* (Apify
actors) feed the **same** core analyzers as websites. Analyzers (Market Record / Lead Signal / Content
Insight / Report) classify records **independent of source**; social/classified are stronger for lead
signals and client pain but also show competitor activity. Not approved yet.

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
