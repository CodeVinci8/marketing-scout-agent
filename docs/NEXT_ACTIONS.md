# NEXT_ACTIONS.md — Immediate Next Steps

Updated at the end of each session. This is the first thing to read after `core/hot/recent.md`.

---

## CURRENT PRIORITY (2026-06-10) — Stage 3.3 fixture + handoff PASS, ad-intelligence quality patch (DEC-092) → re-import + retest; live Avito scrape still NOT tested

`Workflow 09 — Avito Classifieds Listing Connector` (`active=false`, DEC-090) + the Workflow 08 deterministic handoff
**passed fixture tests** (Test 1 raw+6/registry+6/agent_requests+1; Test 2 duplicate registry+0; handoff
monitor_queue=5 / skipped_log=1 / technical_errors=0 / Claude=0). **All fixture-mode only — no real Avito scrape**
(`fixture_mode=true`, `live_mode=false`, source cost $0, Apify node did not run). **DEC-092 quality patch applied:**
WF09 `max_items=6` (= total fixture records incl. control), richer `service_hint`/`semantic_keywords`, Apify live node
wired for HTTP Header Auth (no secrets); WF08 deterministic Avito enrichment (offer/title, price/terms, specific
service theme, content_idea_score 35–55, competitor_strength 75–85, competitor-ad reason), gated to WF09-origin rows so
the Stage 3.2 baseline is unchanged.

**Next, in order:**
1. [ ] **Re-import WF09 and WF08** (do NOT activate). Rebind the Google Sheets credential on WF09's 4 sheet nodes +
   real Spreadsheet ID. (Apify not needed for fixture/handoff retests.)
2. [ ] **(A) Workflow 08 handoff RETEST** using the existing `avito_req_20260610_214709` rows: WF08 `Set Analyzer
   Config` → `agent_request_id_filter="avito_req_20260610_214709"`, `platform_filter="avito"`,
   `source_type_filter="classified"`, `max_records=6`, `analysis_mode="deterministic_first"`, all LLM flags `false`.
   Run WF08 → expect **monitor_queue=5 / skipped_log=1 / technical_errors=0 / Claude=0** (unchanged) **and** now:
   `offer_text`=listing title, `terms`=price+conditions, `content_idea_score` 35–55, `service_type` preserves the
   theme, `reason` mentions offer/price/semantic. **Clear the 3 filters after.** Fill `docs/STAGE_3_3_TEST_RESULTS.md`.
3. [ ] **(B, optional) WF09 fixture duplicate retest:** Execute WF09 again on the populated registry → all 6
   `duplicate_in_registry`, registry +0, raw +6 audit, `requested_limit=6`.
4. [ ] **(C, optional, future) live Apify smoke test (`max_items=3–5`):** only after choosing + approving an Apify
   Avito actor. Set `fixture_mode=false`, `live_mode=true`, `apify_actor_id`; bind the Apify HTTP Header credential
   (`Authorization: Bearer <APIFY_TOKEN>`) in n8n. Record the Apify source cost. 0 Firecrawl/Claude. No direct Avito
   scraping. **Until this runs, real Avito scrape remains untested.**

**Next stage after Stage 3.3 validates:** Stage 3.4 — **Social Source Parsing Strategy** (Telegram/VK/Instagram/Dzen/
review-maps; strategy doc, no build); Stage 3.5 — Competitor Semantic & Ad Intelligence aggregation (later).

> Still NOT built/approved: Telegram/Instagram/VK/Dzen parsers, competitor-audience scraping, Telegram Control Bot,
> outreach/autocall, scheduled scraping, auto-handoff WF09→WF08. Live Avito scraping gated behind a chosen actor +
> explicit operator approval.

---

## PRIOR PRIORITY (2026-06-10) — Stage 3.2 CLOSED (Test C4 PASS, DEC-089) → commit → Stage 3.3 Avito/Classifieds Listing Connector

**Stage 3.2 is CLOSED (DEC-089).** Test C4 (the 4-fixture LLM-enrichment retest against the v7 specialized-schema
patch) **passed**: exactly 4 records processed, `technical_errors=0`, **`primary_json=3/4`** (target ≥3/4),
`repaired_json=0/4`, **`deterministic_fallback_after_llm_fail=1/4`** (≤1 acceptable), `repair_used=false` for the 3
`primary_json` rows and `true` only for the fallback row, MSK `+03:00` OK, routes preserved. **The Telegram
`source_candidate` (7) is fixed** (now `primary_json` → `content_queue`/`content_idea`/`create_content`). Routes: 1
Avito → `monitor_queue`/competitor/monitor/`primary_json`; 7 Telegram → `content_queue`/content_idea/create_content/
`primary_json`; 11 Banki → `review_queue`/lead_signal/investigate/`deterministic_fallback_after_llm_fail` (safe — stayed
`review_queue`, no unsafe «обратиться напрямую»); 12 Zoon → `content_queue`/content_idea/create_content/`primary_json`.

**Verdict:** deterministic_first baseline **APPROVED**; **compact LLM enrichment APPROVED WITH WATCH ITEM** for optional
/ test use. **Default stays `deterministic_first` (all LLM flags `false`) unless the operator explicitly enables
`llm_enrichment`.** **Watch item:** the Banki/forum lead-pattern still falls back (safe); improve in a future enrichment
iteration. **C4 cost delta: TODO_OPERATOR_FILL** (target ≤ $0.04 / 4 records).

**Next, in order:**
1. [ ] **Commit the Stage 3.2 finalization** (docs only — see exact commands in the session report / below). No workflow
   JSON changed this pass.
2. [ ] *(Optional, operator)* fill the **C4 cost delta** (Claude balance before/after the C4 run) in
   `docs/STAGE_3_2_TEST_RESULTS.md` and `docs/COSTS_AND_LIMITS.md` (replace `TODO_OPERATOR_FILL`).
3. [ ] **Stage 3.3 — Avito/Classifieds Listing Connector** feasibility/build (DEC-084) — **now unblocked**, proceed
   after commit. Plan: `docs/STAGE_3_3_SOURCE_DECISION_PLAN.md`. Connectors never call Claude; human approval is the
   spend gate. **Build only after explicit operator approval + feasibility/compliance check.**

**Optional enrichment use (operator opt-in only):** `analysis_mode='llm_enriched'` + `llm_enrichment=true` for a run; or
the bounded 4-record test via `llm_enrichment_test_mode=true` (`llm_test_batch_indexes=[1,7,11,12]`). **Restore
`llm_enrichment_test_mode=false` after any test.** Default production mode stays `deterministic_first` / $0.

> Still NOT built/approved: Avito/Dzen/VK/Telegram/Instagram parsers, competitor-audience scraping, Telegram
> Control Bot, outreach/autocall, scheduled scraping.

---

## PRIOR PRIORITY (2026-06-08) — Stage 3.1 Manual Touchpoint Intake BUILT → import, bind, run, verify

`Workflow 07 — Manual Touchpoint Intake` is **built** (`n8n/workflows/07_manual_touchpoint_intake.json`,
`active=false`, JSON valid; DEC-079). It normalizes 12 manually-provided mixed-source examples into
`raw_market_records` (40), dedups via `market_record_registry` (15), and logs one `agent_requests` (21) row.
**No LLM, no scraping, no external API; `agent_memory` not written.**

**Next, in order:**
1. [ ] **Confirm headers** in the 4 created tabs match exactly: `agent_requests` (21), `raw_market_records` (40),
   `market_record_registry` (15), `agent_memory` (13). See `docs/N8N_WORKFLOW_07_MANUAL_TOUCHPOINT_INTAKE_RU.md`.
2. [ ] **Import Workflow 07** into n8n (do NOT activate).
3. [ ] **Bind the Google Sheets credential** (`Google Sheets - Marketing Scout Service Account`) on the 4 sheet
   nodes and **replace `PASTE_SPREADSHEET_ID_HERE`** with the real Spreadsheet ID.
4. [ ] **Run manual intake once** (Execute Workflow).
5. [ ] **Verify** `raw_market_records` (+12), `market_record_registry` (+12 unique on first run), `agent_requests`
   (+1, `status=needs_review`); check `Final Summary Output` (`irrelevant_count=2`, record-11 = hot control).
6. [ ] **(Optional) re-run** to confirm idempotent dedup (all `duplicate_in_registry`, registry +0, raw +12 audit).
7. [ ] **Then design/build the Touchpoint Analyzer (Stage 3.2)** over these records — source-agnostic, reusing
   the Stage 2 resilient analyzer. **Do NOT build any source parser yet.**

> Still NOT built/approved: Avito/Dzen/VK/Telegram/Instagram parsers, competitor-audience scraping, Telegram
> Control Bot, outreach/autocall, scheduled scraping. `agent_memory` not written by Workflow 07.

---

## PRIOR PRIORITY (2026-06-08) — PRODUCT REFRAMED to Business Scout Agent → choose Stage 3.1 path

Stakeholder interview (`STAKEHOLDER_INTERVIEW_2026_06_08.md`) reframed the product (DEC-078): it is the
**Business Scout Agent** (an AI "employee" with internal tools + memory + analysis), with marketing/lead/
competitor intelligence as its **first domain**. Stage 3 is now **Social/Classified Touchpoint Discovery** (leads
are a subset). New design docs: `BUSINESS_SCOUT_AGENT_VISION.md`, `MARKETING_AGENT_PRODUCT_VISION.md`,
`AGENT_TOOL_ARCHITECTURE.md`, `AGENT_MEMORY_PLAN.md`. Schema generalized: **`agent_requests`** (supersedes
`lead_discovery_requests`), expanded `raw_market_records`, plus proposed **`agent_memory`** (all PROPOSED, not created).

**Next operator decision — choose the Stage 3.1 path:**
- **Option A** — approve the proposed agent/touchpoint sheets and **build Manual Records Intake**.
- **Option B** — perform deeper **feasibility evaluation** of Avito/Dzen/VK/Telegram source connectors.
- **Option C** — **wait for the uncle's full list of desired agents** and map them to internal tools.

**Recommended: A + C** —
1. [ ] Document the **agent/tool map** now (done: `AGENT_TOOL_ARCHITECTURE.md`) and review it.
2. [ ] **Wait for the uncle's full desired-agent list**; map each to an internal tool/`request_type`.
3. [ ] **Build Manual Records Intake first**, using manually collected examples from Avito/Dzen/VK/Telegram/comments.
4. [ ] **Do NOT build any source parser yet.** No Telegram bot, no Avito/VK/Instagram/Dzen parser, no outreach/autocall.

> Touchpoint classes: hot_lead, warm_touchpoint, cold_audience_candidate, client_pain, question_objection,
> competitor_audience, competitor_activity, semantic_signal, ad_channel_signal, content_idea, market_signal,
> irrelevant. Source lens (touchpoints): Avito = direct intent + competitor ads; Dzen/VK/comments = pains/
> audience/warm; Instagram = competitor content; competitor audiences = public data only.

---

## PRIOR PRIORITY (2026-06-07) — Stage 2 APPROVED (minor limitations) → commit → Stage 3.0

Stage 2 web pipeline **05 → 06 → 04** is **APPROVED with minor limitations** (DEC-074). Real results:
`docs/STAGE_2_FINAL_TEST_RESULTS.md`. Auto-handoff (06→04) was evaluated and **deferred** to Stage 2.4
(`docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`); **manual handoff remains the approved path**. No workflow logic was
changed this pass — docs/finalization only.

**Next, in order:**
1. [ ] **Commit the Stage 2 web pipeline finalization** (docs only this pass — see exact commands in the
   session report / below). Workflows are unchanged and already valid.
2. [ ] **(Optional) clear the two watch items** from `STAGE_2_FINAL_TEST_RESULTS.md` with live re-tests:
   - **W1 — runner modes with fresh inputs:** run WF05 on a *new* query to get fresh, unprocessed same-domain
     candidates (≥2 on one domain); approve them; run WF06 in `first_pass_domain_diversity` (expect 1 selected
     for that domain, rest → `duplicate_domain_in_run`) and `deep_domain_analysis` (expect up to 3 selected,
     4th+ → `domain_deep_limit`, deep-mode `warning` on selected).
   - **W2 — valid contact preservation:** process a competitor page with a clearly published phone/Telegram/
     WhatsApp; confirm `contact_public` is populated (not blanked).
3. [ ] **Stage 3.0 — Lead Source Evaluation** (design/eval doc; **no build**): compare **Avito vs Telegram vs
   VK** on data availability, cost, risk, lead quality, implementation complexity. See
   `docs/LEAD_DISCOVERY_ARCHITECTURE.md` + `docs/LEAD_SOURCE_CONNECTORS_PLAN.md`. (DEC-076: Stage 3 starts here,
   **not** the Telegram bot.)
4. [ ] **Do NOT build any lead connector** until the Stage 3.0 evaluation is written **and approved**.
   Preliminary (non-binding) choice: Avito/Classifieds first, Telegram second (the Telegram **parser** ≠ the
   Telegram **Control Bot** and needs a separate access/client design); VK/Instagram/Yandex later. Wire Manual
   Records Intake first to validate the lead schema + analyzer with zero source risk.
5. [ ] **(Future, before Telegram bot) Stage 2.4 — auto-handoff 06→04** per `WORKFLOW_06_AUTO_HANDOFF_PLAN.md`,
   only when it can be built safely **and live-validated** (confirm-then-mark). Default stays manual handoff.

> Still NOT approved / not built: Avito scraping, Telegram parser, VK/Instagram/Yandex connectors, Telegram
> Control Bot, auto-handoff 06→04, universal `market_profile`. Lead sheets (`lead_discovery_requests`,
> `raw_market_records`, `market_record_registry`) are **proposed only** (see `TABLE_SCHEMA.md`).

---

## Current Priority: v0.1 Pipeline Setup

### Step 1 — Review project structure ✓
- [x] Operator reviews all created files
- [x] Documentation review fixes applied (2026-06-04)
- [x] Confirm roadmap stages and stack are correct

### Step 2 — Prepare docker-compose.yml for n8n ✓

- [x] `scripts/docker-compose.n8n.example` created — localhost-only, n8n_data volume, env_file
- [x] `scripts/n8n.env.example` created — all required env vars with MVP-safe defaults
- [x] `docs/N8N_DEPLOYMENT.md` created — full deployment guide including SSH tunnel, HTTPS deferral, what not to commit

**To deploy** (operator runs — see `docs/N8N_DEPLOYMENT.md` for full steps):
```bash
mkdir -p /opt/n8n
cp scripts/docker-compose.n8n.example /opt/n8n/docker-compose.yml
cp scripts/n8n.env.example /opt/n8n/n8n.env
# Edit n8n.env: set N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
```

**Access method for v0.1:** n8n will be accessed via SSH tunnel only — no public domain,
no reverse proxy, no HTTPS required for MVP.

SSH tunnel command (run on your local machine):
```
ssh -L 5678:localhost:5678 user@your-vps-ip
```
Then open `http://localhost:5678` in a local browser.

Public HTTPS/domain access is deferred until webhooks or OAuth integrations require inbound access.

### Step 3 — Start n8n on VPS ✓

- [x] Docker Engine confirmed: v29.1.3, 3 containers running, 39 images present
- [x] Docker Compose confirmed: v5.1.2 (manual install at `/usr/local/lib/docker/cli-plugins/docker-compose`)
- [x] `docker-compose.yml` deployed to `/opt/n8n/` on VPS
- [x] `docker compose up -d` executed — container `n8n-n8n-1` running
- [x] n8n UI confirmed accessible via SSH tunnel at `http://localhost:5678`
- [x] Execution pruning configured in `n8n.env` (PRUNE=true, MAX_AGE=168h, MAX_COUNT=1000)

**Access:** SSH tunnel only — `ssh -L 5678:127.0.0.1:5678 root@SERVER_IP` → `http://localhost:5678`
**Do not open port 5678 publicly** — n8n is bound to `127.0.0.1` for v0.1. See DEC-010.

> **Disk warning:** VPS at ~86% used, ~1.4G free after n8n launch. Acceptable for MVP.
> Plan to upgrade VPS disk before running high-volume scrape jobs. See DEC-013.

> **Note:** Docker Compose was installed manually — not via apt. See `docs/DECISIONS.md` DEC-009 and `tools/TOOLS.md` for migration/troubleshooting details. Do not run `docker system prune` without explicit approval.

### Step 4 — API Credentials Setup in n8n

- [ ] Create Apify account and get API key → add to n8n Credentials UI (Header Auth)
- [ ] Create Firecrawl account and get API key → add to n8n Credentials UI (Header Auth)
- [ ] Get Claude API key → add to n8n Credentials UI (Header Auth, key name: `x-api-key`)
- [ ] Set up Google Sheets OAuth2 in n8n Credentials UI
- [ ] Create Telegram bot via BotFather → store token in n8n Telegram credential

### Step 5 — Google Sheets Setup

- [ ] Create output spreadsheet with columns from `docs/TABLE_SCHEMA.md`
- [ ] Share with n8n Google Sheets service account or authenticated OAuth account
- [ ] Note the Spreadsheet ID and Sheet name for n8n node configuration

### Step 6 — Build n8n Workflows (incremental)

Workflows are built incrementally — no external APIs until the platform is verified.

#### Workflow 00 — Healthcheck Manual Test ✓ COMPLETED 2026-06-04

**Guide:** `docs/N8N_WORKFLOW_00_HEALTHCHECK_RU.md`
**JSON:** `n8n/workflows/00_healthcheck_manual_test.json`

- [x] JSON generated and validated (Claude Code → JSON file)
- [x] Imported into n8n from JSON (via GitHub / file copy)
- [x] Executed successfully — output: `status=analyzed`, `quality_score=75`, no red nodes

**Do not modify this workflow** — it is the healthcheck baseline for the project.

> Confirmed working method: Claude Code generates n8n JSON → committed to repo →
> operator imports into n8n. This is the standard workflow delivery method going forward.

#### Workflow 01 — Google Sheets Append Row Test ✓ COMPLETED 2026-06-04

**Guide:** `docs/N8N_WORKFLOW_01_GOOGLE_SHEETS_RU.md`
**JSON:** `n8n/workflows/01_google_sheets_append_row_test.json`

- [x] Google Sheets spreadsheet "Marketing Scout Results" created; sheet named `results`
- [x] Service account created in n8n as `Google Sheets - Marketing Scout Service Account`
- [x] Spreadsheet shared with service account (Editor)
- [x] Workflow imported and configured (credential + Spreadsheet ID)
- [x] Executed successfully — test row appended: `status=analyzed`, `quality_score=75`, `source_type=manual_test`

**Note:** table initially had vertical header rows in column A (rows 2–25); fixed by deleting rows 2–25, keeping only row 1 as the single horizontal header row.

**Do not modify this workflow** — it is the Google Sheets baseline for the project.
**Do not commit** real Spreadsheet ID or service account email to Git.

#### Workflow 02 — Claude API Single Record Analysis ✓ COMPLETED 2026-06-05

**Guide:** `docs/N8N_WORKFLOW_02_CLAUDE_API_RU.md`
**JSON:** `n8n/workflows/02_claude_api_single_record_analysis.json`
**Prompt:** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md`

- [x] MARKETING_AGENT_PROMPT_V1.md created — secured lending domain, 1–100 scoring
- [x] Workflow JSON generated and validated (9 nodes, active=false)
- [x] Russian guide created
- [x] Imported and configured in n8n (credential + Spreadsheet ID)
- [x] Executed successfully — Claude returned analyzed JSON, row appended to Google Sheets
- [x] Measured API cost: $0.0115 per short scoring ≈ 0.84 RUB

**Results:** service_type=pts_loan, quality_score=72, lead_signal_score=75, content_idea_score=80, status=analyzed

**Do not modify this workflow** — it is the Claude API + Google Sheets baseline for the project.
**Prompt duplication note:** prompt is embedded in Build Claude Request node AND stored in MARKETING_AGENT_PROMPT_V1.md — update both on any change (see DEC-020).

#### Step A — Ask Uncle: Business Requirements ✓ COMPLETED 2026-06-05

**Goal:** Before any paid scraping, confirm what the operator's uncle actually needs.

- [x] Ask uncle: primary use case — **lead signals first, competitors second, content third**
- [x] Ask uncle: which platforms/sources matter most? — **Telegram, Instagram, Avito, Yandex / competitor websites**
- [x] Ask uncle: target region? — **Moscow + Moscow Oblast**
- [x] Ask uncle: which loan products? — **PTS, auto collateral, real estate, refinancing, mortgage, business loans**
- [x] Ask uncle: what does a useful result look like? — row in Sheets; contact strong leads, monitor competitors
- [x] Recorded in `docs/BUSINESS_REQUIREMENTS.md` — full BRD with product scope, ICP, source priorities, table fields, open questions
- [x] Updated `MARKETING_AGENT_PROMPT_V2_PLAN.md` — ICP confirmed; priority order locked

**Output:** `docs/BUSINESS_REQUIREMENTS.md` created. See also implications sections for Prompt v2 and scraping config.

> See DEC-021. Paid scraping is still gated on Prompt v2 approval (Step C/D).

#### Step B — Fix Documentation Consistency _(zero cost)_ ✓ IN PROGRESS 2026-06-05

- [x] `WORKFLOW_DESIGN.md` — gateway URL, auth, prompt reference, threshold scale, parse pattern
- [x] `TABLE_SCHEMA.md` — scoring scale 1–100, entity/status/service_type values, competitor_strength type
- [x] `docs/PROMPTS.md` — active prompt reference, version history, v2 plan
- [x] `docs/AGENT_CAPABILITIES.md` — created: v1 can/cannot, v2 plan, scoring, schema, risks, client explanation
- [ ] `README.md` — update current stage from "in design" to "infrastructure validated"
- [ ] `tools/TOOLS.md` — fix Google Sheets auth note; update GitHub status
- [ ] `core/warm/decisions.md` — add DEC-018, DEC-019, DEC-020, DEC-021

#### Step C — Write Marketing Agent Prompt v2 ✓ COMPLETED 2026-06-05

**Goal:** Write a prompt that reasons like a marketing analyst, not a data extractor.

- [x] `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` — written (~12 KB)
- [x] Priority order encoded: lead signals first → competitors second → content ideas third
- [x] Confirmed ICP from `docs/BUSINESS_REQUIREMENTS.md` — Moscow car owner, bad credit, urgency
- [x] Region rules: MO leads eligible 60–100; out-of-region capped at 40
- [x] Product hierarchy: PTS/auto > real estate > refinancing > other
- [x] Competitor threat framework: regional overlap + USP + activity level
- [x] Lead urgency model: fit × urgency × readiness with calibration anchors
- [x] Content intelligence: offer_text for content_idea = proposed article title
- [x] Structured 3-sentence reason field with evidence citation requirement
- [x] Anti-hallucination additions, expanded skip rules
- [x] `modules/marketing-scout-v0/TEST_RECORDS_V2.md` — 7 synthetic test records with expected scores
- [x] `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` — step-by-step manual test guide (Russian)

> Schema unchanged — same 25 output fields as v1. New fields planned for v2.1+.

#### Step D0 — Project Cleanup ✓ PHASE 1 COMPLETE 2026-06-06

**Audit:** `docs/PROJECT_CLEANUP_AUDIT.md`

- [x] Phase 1 — Audit created (`docs/PROJECT_CLEANUP_AUDIT.md`)
- [x] Phase 2 — Operator approved deletion of 2 workflow JSON files
- [x] Phase 3 — Untracked files previously added to git; ghost files already absent at execution time
- [x] Phase 4 — Executed: `git rm` on 2 approved files; staged for commit
  - Deleted: `02_claude_api_single_record_v2_test_harness.json` (v2.5 MICRO, gateway 502)
  - Deleted: `02_claude_api_single_record_v2_baseline_short_test5.json` (Test 5 short variant)
  - All keep files confirmed present

**Deferred to phase 2** (after Resilient Output Layer is built and tested):
- `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md`
- `modules/marketing-scout-v0/SYSTEM_PROMPT.md`
- `modules/marketing-scout-v0/TEST_DATA.md`
- `docs/MILESTONE_REVIEW_02.md`

**Remaining workflow JSON files (5 active):**
- `00_healthcheck_manual_test.json` — baseline
- `01_google_sheets_append_row_test.json` — baseline
- `02_claude_api_single_record_analysis.json` — production v1
- `02_claude_api_single_record_v2_baseline_raw_json.json` — d350069 reference (working)
- `02_claude_api_single_record_v2_extended_tests.json` — test evidence

> Full detail: `docs/PROJECT_CLEANUP_AUDIT.md`

---

#### Step D — Implement Resilient Output Layer in TEST HARNESS _(immediate next step)_

**Context:** Extended tests 8–12 ran. Tests 1 and 8 (hot PTS leads) passed strongly. Tests 9–12 and 5 failed with output-contract errors — Markdown blocks, no-text responses, invalid JSON. The model reasoned correctly; serialization failed. See `docs/WORKFLOW_02_V2_TEST_RESULTS.md` and DEC-033.

**Decision:** Stop prompt format experiments. Fix architecture with a two-pass Repair + multi-tab Router.
**Design spec:** `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`

**Phase 1 — Google Sheets setup (operator, no code):**
- [ ] Create 5 new tabs in "Marketing Scout Results": `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`
- [ ] Add header row to each tab — 25 existing columns + 6 new technical columns: `processing_status`, `parse_method`, `parse_error`, `raw_response_preview`, `route`, `needs_manual_review`
- [ ] Update existing `results` tab header row to include the same 6 new columns

**Phase 2 — Build Resilient Output Layer in TEST HARNESS (Claude Code generates JSON) ✓ COMPLETE 2026-06-06:**
- [x] 21-node workflow JSON created: `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json`
- [x] JSON Repair Formatter node added (Claude Repair API Request, same gateway, max_tokens=900, temp=0.0)
- [x] Parse Repaired JSON Code node added (forces technical_error for mock_unrepairable)
- [x] Switch by Route node (6 branches: results/review_queue/monitor_queue/content_queue/skipped_log/technical_errors)
- [x] 6 Append nodes (one per tab), credential placeholders only
- [x] Normalize + Route Code node: full routing logic with clamp, entity validation, test assertion fields
- [x] Mock modes: mock_markdown (Test D) and mock_unrepairable (Test E) — no real API for mocks
- [x] Russian test guide created: `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`
- [x] Validated with `python3 -m json.tool` — VALID
- [x] DEC-034 added to `docs/DECISIONS.md`
- [x] **FIXED copy created:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_fixed.json`
  — Switch by Route rebuilt as typeVersion 1 (simple string-match, not rules-mode); positions adjusted; validated VALID
- [x] **DYNAMIC SHEET copy created:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`
  — Switch by Route + 6 Append nodes removed; replaced with one Google Sheets node (Sheet Name = `={{ $json.route }}`); route-validation safety added to Normalize + Route; validated VALID (DEC-035)
  — **Use THIS file for import — cleanest architecture (15 nodes, 1 sheet node)**

**Phase 3 — Run Tests A–E (operator, next action):**
- [ ] **Delete** any old `RESILIENT ROUTER TEST` / `... FIXED` workflow from n8n if already imported
- [ ] Import `02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json` into n8n
- [ ] Set credentials + Spreadsheet ID (see `docs/N8N_WORKFLOW_02_RESILIENT_ROUTER_TEST_RU.md`)
- [ ] Create 6 Sheets tabs with header rows (see guide, Step 4)
- [x] Run Test A (test_id=A): hot lead → `results`. PASS (`parse_method=primary_json`, lead=97, quality=98)
- [x] Run Test B (test_id=B): weak lead → `review_queue`. **Exposed routing-priority bug** — went to `content_queue`. Fixed in `Normalize + Route` (DEC-036). **Retest required to confirm live.**
- [x] Run Test C (test_id=C): competitor → `monitor_queue`. PASS. `company_name` was empty → descriptive fallback added (DEC-036).
- [x] Run Test D (test_id=D): mock_markdown → repair → `results`. PASS. Validates Repair Formatter. `service_type` free text → normalized to `pts_loan` (DEC-036).
- [x] Run Test E (test_id=E): mock_unrepairable → `technical_errors`. PASS. Validates technical_errors path.
- [x] **Retest Test B** (live) after DEC-036 patch → confirmed `route=review_queue` (`primary_json`, lead≈38).
- [x] All A–E pass live → full project review done.

> Patch applied 2026-06-06 (DEC-036): routing priority fixed (weak lead before content_queue), service_type enum normalization, company_name competitor fallback. JSON re-validated VALID. API cost for A–E run: $0.0750 (see `docs/COSTS_AND_LIMITS.md`).

#### Step D5 — Full Project Review (review-first gate) ✓ DONE 2026-06-06

**Read this before any implementation:** `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md`

Review verdict: **GO for first scraper, conditional on hardening.** Architecture approved; productionization required first.

**Blockers before first scraper (from the review):**
- [x] Build a **production** resilient workflow with no test-harness columns → `02_claude_api_single_record_v2_resilient_router_production.json` (DEC-037). 33 output columns (25 core + 8 technical). ✓
- [x] Reconcile `TABLE_SCHEMA.md` — production 33-column header + six tab names documented. ✓
- [ ] Operator pre-creates all six tabs (dynamic node does not create missing tabs).
- [ ] Record Firecrawl credential + free-tier limits in `COSTS_AND_LIMITS.md`.

**Important fixes:** [x] `raw_response_preview` capped at 500 (code + docs aligned). [x] `recommended_action` normalized to route. [ ] dedup — `source_url` documented as v0.1 first key (full dedup later). [ ] append-node error handling (nice-to-have).

#### Step D6 — Production hardening + cleanup ✓ DONE 2026-06-06 (DEC-037)

- [x] Production workflow created (test/mock fields stripped); JSON validated VALID; routing logic-simulated for A/B/C/D/E + skip.
- [x] Obsolete Switch-based workflows removed via `git rm` (`..._test.json`, `..._test_fixed.json`).
- [x] Docs updated: TABLE_SCHEMA, RESILIENT_OUTPUT_LAYER, TEST_RESULTS, CLEANUP_AUDIT, CAPABILITIES, COSTS, ROADMAP, DECISIONS (DEC-037).

#### Step D7 — Production smoke test ⚠️ FIRST ATTEMPT FAILED (2026-06-06)

First manual smoke test failed: primary parse failed → **Repair API 502 Bad Gateway** → row went to `technical_errors` with primary diagnostics lost. Workflow patched (DEC-038): primary raw preserved, compact repair payload (max_tokens 700, smaller schema), dual Primary+Repair error diagnostics, primary prompt reminder, smoke `text_context` preset to the competitor example. **Retest required.**

#### Step D8 — Clean Sheets headers, re-import patched workflow, rerun smoke ← NEXT

1. [ ] **Clean the 6 Sheets tabs to exactly the 33-column header** (`docs/TABLE_SCHEMA.md`) — no test columns, internal English names only. Tabs: `results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors`.
2. [ ] Re-import the **patched** `02_claude_api_single_record_v2_resilient_router_production.json` (active stays false).
3. [ ] Set Google Sheets credential + real **Spreadsheet ID** on `Append to Dynamic Route Sheet`; set Claude credential on both HTTP nodes.
4. [ ] `Set Source Record` already carries the competitor smoke record (`text_context` preset). Adjust only if needed.
5. [ ] Record Claude balance before, run once manually, record balance after (`docs/COSTS_AND_LIMITS.md`).
6. [ ] Verify expected: `route=monitor_queue`, `entity_type=competitor`, `recommended_action=monitor`, `processing_status=parsed_success`, `parse_method=primary_json` (or `repaired_json`). If it still lands in `technical_errors`, confirm `parse_error` now shows **both** `Primary:` and `Repair:` and `raw_response_preview` shows the primary raw response — then diagnose the 502 (gateway retry/backoff).
7. [ ] **Firecrawl remains BLOCKED until this smoke test passes** (DEC-038). Only then build `03_firecrawl_single_url_resilient.json`.

**First scraper recommendation:** Firecrawl on one public competitor website (lowest risk; `monitor_queue` path validated by Test C). Then Avito/Apify → Telegram → Instagram later.

**Next implementation prompt + smoke tests:** see `docs/PROJECT_REVIEW_03_RESILIENT_ROUTER.md` §10–11.

**Phase 4 — Migrate to production Workflow 02:**
- [ ] After operator approval: apply Resilient Output Layer to `02_claude_api_single_record_analysis.json`
- [ ] Re-run Tests 9, 10, 11, 12 on production workflow. Confirm routing (not just "pass/fail")

**Cleanup Phase 2 — after dynamic-sheet workflow passes Tests A–E:**
- [ ] **Do NOT delete** the Switch-based resilient workflows (`_fixed.json`, `_test.json`) until the dynamic-sheet workflow passes Tests A–E. They remain the only proven-importable copies and `_fixed.json` is the documented six-IF-node fallback source.
- [ ] **After A–E pass:** perform cleanup phase 2 — `git rm` the two superseded Switch-based iterations. See `docs/PROJECT_CLEANUP_AUDIT.md` → "Cleanup Phase 2 — after dynamic router tests".
  - Delete after pass: `02_claude_api_single_record_v2_resilient_router_test_fixed.json`
  - Delete after pass: `02_claude_api_single_record_v2_resilient_router_test.json`
  - Keep active candidate: `02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`
  - Keep reference: `02_claude_api_single_record_v2_baseline_raw_json.json`
  - Keep historical evidence: `02_claude_api_single_record_v2_extended_tests.json`

> Design spec: `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`. Results: `docs/WORKFLOW_02_V2_TEST_RESULTS.md`. Cleanup plan: `docs/PROJECT_CLEANUP_AUDIT.md`.

#### Step E — Firecrawl Single URL Test ✅ PASSED (2026-06-08)

**Result:** Two real single-URL competitor tests passed after DEC-043/044 hardening (DEC-045). Firecrawl single-URL competitor ingestion is **APPROVED** for manual controlled use.
- `https://mosinvestfinans.ru/` → `monitor_queue`, competitor, `МосИнвестФинанс`, `generic_lending`, strength/quality **78**, `monitor`, `parsed_success`, `primary_json`, `repair_used=false`.
- `https://www.lioncredit.ru/uslugi/kredit-pod-zalog-nedvizhimosti` → `monitor_queue`, competitor, `LionCredit`, `generic_lending`, strength/quality **75**, `monitor`, `parsed_success`, `primary_json`, `repair_used=false`.

**Operational note (DEC-046):** after every import, n8n requires manual credential rebinding (`Firecrawl Scrape API`→`Firecrawl API - Marketing Scout`; both Claude nodes→`Claude API - Marketing Scout`; `Append to Dynamic Route Sheet`→`Google Sheets - Marketing Scout Service Account` + real Spreadsheet ID). Expected — credential IDs are local.

> Still blocked (DEC-039/040): multi-page crawl, batch scrape, search, scheduled scraping, Firecrawl MCP/CLI, automated outreach.

#### Step F — Workflow 04: Firecrawl URL List Mini-Batch ✅ VALIDATED & APPROVED (manual ≤5 URLs, 2026-06-08)

**Workflow:** `n8n/workflows/04_firecrawl_url_list_resilient.json` (25 nodes; JSON valid; active=false; 35-field business schema + 10-field `url_registry`). **Plan/guide:** `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`, `docs/N8N_WORKFLOW_04_FIRECRAWL_URL_LIST_RU.md`.

**Validation:** 3-URL run (DEC-053) — Run 1 process / Run 2 all `skipped_log`, 0 cost. **5-URL run (DEC-054, `firecrawl_20260607_100715`)** — 2 duplicates skipped, 1 placeholder skipped, 2 competitors → `monitor_queue`; Claude Δ $0.0429, ~3 Firecrawl credits. **Mini-batch (≤5 URLs, manual) APPROVED.** Minor hardening (DEC-054): placeholder pre-filter before Claude + stronger PTS service-type override + readable node layout.

**Hard limits:** max 5 URLs · manual only · no crawl/batch/search/schedule · `text_context`≤3500 · continue-on-failure per URL. Duplicate → `skipped_log`/`dedup_source_url`, **0** Firecrawl/Claude cost.

**Next steps (in order):**
1. [ ] **Optional retest after this patch** with a representative 3-URL list: one **duplicate root URL** (already in `url_registry`), one **placeholder URL** (parked/Wix), one **PTS competitor URL** (e.g. a `/pledge-pts` page). Expect: duplicate → `skipped_log`/`dedup_source_url`; placeholder → `skipped_log`/`firecrawl_placeholder_prefilter`; PTS page → `monitor_queue`/`pts_loan`. Record before/after Firecrawl credits + Claude balance.
2. [ ] After import, confirm `Append url_registry` is set to **Sheet=`url_registry` (name, not dynamic), Mapping=Automatically, real Document ID, Google Sheets credential**.
3. [ ] Then move to **URL Discovery layer planning** (Stage 2.2) — **do not build discovery yet**; it needs its own plan + approval.
4. [ ] Later: **plan** the Telegram Control Bot layer (Stage 2.3).

> **Backfill note:** `url_registry` is the dedup source of truth. Rows analyzed before the registry existed re-process once until backfilled (optional maintenance) — see `TABLE_SCHEMA.md`.
> Still blocked: >5 URLs, scheduled runs, crawler, batch/search endpoints, URL-discovery agent, Telegram bot, Avito/Telegram/Instagram (DEC-050).

#### Step G — Stage 2.2: Apify Search Candidate Discovery (Workflow 05) 🔧 BUILT + candidate-quality patch, RETEST (2026-06-08)

**Status:** first real Apify test passed **technically** (10 candidates, 1 registry duplicate). Candidate-quality patch applied (DEC-061): fixed empty `domain`, added `candidate_type`, competitor-first confidence. **Retest required.** `n8n/workflows/05_apify_search_candidate_discovery.json` (13 nodes, active=false). Guide: `docs/N8N_WORKFLOW_05_APIFY_SEARCH_CANDIDATES_RU.md`. **0 Firecrawl/Claude.**

**Retest tasks (in order):**
1. [ ] **Add the `candidate_type` column** to the existing `url_candidates` sheet — insert it **after `domain`** so the header is the **26-column** order in `TABLE_SCHEMA.md` (`…normalized_source_url, domain, candidate_type, title, snippet, rank…`).
2. [ ] **Re-import the patched Workflow 05** (active stays false); rebind credentials (Apify + 3 Google Sheets nodes; real Spreadsheet ID).
3. [ ] **Rerun the same query** «займ под залог ПТС Москва».
4. [ ] **Expected:** `domain` filled for all rows; `candidate_type` classified (autolombards/lenders → `direct_competitor`; 2gis → `directory`; banki/vbr/finuslugi → `aggregator`; kp → `media_article`); direct competitors rank higher than aggregators/directories/media; the previously-seen duplicate preserved (`approval_status=duplicate`); 1 `discovery_requests` row; **0 Firecrawl/Claude**; no business-tab writes.
5. [ ] Manually approve **direct competitors first**; aggregators/directories/media → review manually (note already flags them). Record the Apify run cost.
6. [ ] **Do not process candidates yet** — hand-off to Workflow 04 (≤5) only after this retest is validated.

> **Do not** build the Approved Candidates Runner (Stage 2.2c), use Firecrawl `/v2/search` (parked), build SerpAPI/Google-CSE fallbacks, or build the Telegram bot (Stage 2.3) yet — each is gated (DEC-056/057/059).

#### Step H — Workflow 04 service_type patch (DEC-062) + next: Workflow 06 Approved Candidates Runner (2026-06-08)

**Done this session:** patched `Normalize + Route` so a **root homepage** gets a specific `service_type` when content is overwhelmingly PTS/auto-focused (deterministic signal counts), while multi-product roots stay `generic_lending`. Fixes the E2E finding (`carcapital.ru/` was `generic_lending`, now `pts_loan`). JSON valid; 35/10 field counts and dedup unchanged.

**Operator next steps:**
1. [ ] Re-import the patched **Workflow 04** (active stays false); rebind credentials (Firecrawl, both Claude, 4 Google Sheets nodes + real Spreadsheet ID).
2. [ ] *(Optional)* **Retest `https://carcapital.ru/`** via Workflow 04 (force_reprocess or a fresh registry) → expect `route=monitor_queue`, **`service_type=pts_loan`**, competitor.
3. [ ] *(Done — see Step I)* Build Workflow 06 — Approved Candidates Runner.

#### Step I — Workflow 06 Approved Candidates Runner BUILT + Workflow 04 contact sanitation (DEC-063/064, 2026-06-07)

**Done this session:**
- **Workflow 04 `contact_public` sanitation (DEC-063):** `Normalize + Route` now blanks partial/placeholder contacts (the E2E run had stored `"+7 (495) ... (номер указан на сайте, требуется извлечение)"`). A value is kept only if it matches a reliable pattern (phone `+7`/`8`/`7` with 10–11 digits, email, Telegram, or contact/profile URL); `...`/`…`/`требуется извлечение` → empty. 35/10 field counts and dedup unchanged. JSON valid.
- **Workflow 06 BUILT (DEC-064):** `n8n/workflows/06_approved_candidates_runner.json` (active=false). Reads `url_candidates` → filters `approved AND unique AND not_in_registry AND non-empty URL` (aggregators need `aggregator_approved` note) → prioritizes `direct_competitor` → confidence → rank → **hard cap 5/run** → emits WF04-shaped batch + Execution Summary + ready-to-paste `Set URL List` block. **v0.1 = manual hand-off** (no subworkflow call into WF04); disabled `Mark Candidates Processed` node flips `approval_status=processed`. No Apify/Firecrawl/Claude/Telegram. Guide: `docs/N8N_WORKFLOW_06_APPROVED_CANDIDATES_RUNNER_RU.md`.

**Operator next steps:**
1. [ ] Re-import the patched **Workflow 04** (active stays false); rebind credentials + real Spreadsheet ID. *(Optional)* retest `carcapital.ru/` → expect a clean (empty or exact) `contact_public`.
2. [ ] **Import Workflow 06** (active=false). Rebind the **Google Sheets** credential on both nodes (`Read url_candidates` + the disabled `Mark Candidates Processed`); paste the real Spreadsheet ID. No Apify/Firecrawl/Claude creds needed.
3. [ ] **Approve one candidate:** in `url_candidates` set `approval_status=approved` (+ `approved_by`/`approved_at`) on one `direct_competitor` row (`dedup_status=unique`, `registry_status=not_in_registry`).
4. [ ] **Run Workflow 06** once. In `Build Execution Summary & Handoff`: confirm `selected_count=1`, the URL in `selected_urls`, and the `Set URL List` block.
5. [ ] **Confirm candidate status update + monitor_queue output:** copy the ≤5 URLs into Workflow 04 → run it → expect `monitor_queue`. Then either enable the disabled `Mark Candidates Processed` node and re-run WF06, or set `approval_status=processed` manually. (Auto-call of WF04 from WF06 is deferred — v0.1 is manual hand-off.)

> Still deferred: Telegram bot (Stage 2.3), automated search fallbacks (SerpAPI/Google CSE), Firecrawl `/v2/search` (parked), lead-source connectors.

#### Step J — Workflow 06 registry-recheck patch (DEC-065) → RETEST ← NEXT (2026-06-07)

**Done this session:** patched `06_approved_candidates_runner.json` (active=false) so it **re-reads `url_registry` at runtime** and re-normalizes `candidate_url` (same rules as WF04/05) before selecting. Editable `dedup_status`/`registry_status` in `url_candidates` are now **advisory only** — a URL already in `url_registry` is skipped as `registry_recheck_duplicate`, even if the operator manually marked it `unique`/`not_in_registry`. Added `Read url_registry` node; relaxed the aggregator hard-block to a per-item `warning`; renamed `over_max_5_limit` → `over_limit`. JSON valid; no Apify/Firecrawl/Claude node. Guide/DECISIONS/TABLE_SCHEMA/COSTS/CAPABILITIES/ROADMAP updated.

**Operator next steps (in order):**
1. [ ] **Re-import the patched Workflow 06** (active stays false). Rebind the **Google Sheets** credential on all three nodes (`Read url_candidates`, `Read url_registry`, disabled `Mark Candidates Processed`) and paste the real **Spreadsheet ID**. No Apify/Firecrawl/Claude creds.
2. [ ] **Test with the approved old duplicate:** keep `https://www.autolombard-moskva.ru/pledge-pts/` marked `approval_status=approved` (+ `dedup_status=unique`/`registry_status=not_in_registry`). Run WF06 → expect it **skipped** with `reason_category=registry_recheck_duplicate`, **not** selected.
3. [ ] **Run Workflow 05 with a new query** to discover fresh candidates (0 Firecrawl/Claude).
4. [ ] **Approve one new `direct_competitor`** whose normalized URL is **not** in `url_registry` (`approval_status=approved` + `approved_by`/`approved_at`).
5. [ ] **Test Workflow 06 selection:** run WF06 → expect the new competitor in `selected[]`/`selected_urls`; the old duplicate still in `skipped[]` (`registry_recheck_duplicate`).
6. [ ] **Then manually run Workflow 04** with the selected ≤5 URLs → expect `monitor_queue` + a new `url_registry` row. After confirming, set `approval_status=processed` (manual or via the disabled node).

> Stage 2.2c (Workflow 06) **remains under test** until the registry recheck is validated.
> Still deferred: Telegram bot (Stage 2.3), automated search fallbacks (SerpAPI/Google CSE), Firecrawl `/v2/search` (parked), lead-source connectors.

#### Step E (legacy plan) — Workflow 03: Firecrawl Website Analysis _(superseded by the active Step E above)_

**Goal:** Take a real competitor URL, extract clean text via Firecrawl, pass to Claude v2, verify full chain.

- [x] Superseded by `03_firecrawl_single_url_resilient.json` (single-URL resilient build, DEC-039).
- [ ] After first run: measure actual cost per Firecrawl + Claude call; update `docs/COSTS_AND_LIMITS.md`

#### Workflow 03 — Firecrawl Website Analysis _(after uncle consultation)_

**Goal:** Take a real competitor URL, extract clean text via Firecrawl, pass to Claude for analysis, verify full chain with real scraped data.

**Pre-steps:**
- [ ] Get Firecrawl API key → create n8n credential: HTTP Header Auth, `Authorization: Bearer <token>`, name `Firecrawl - Marketing Scout`
- [ ] Check Firecrawl free tier limits and note them in `docs/COSTS_AND_LIMITS.md`
- [ ] Choose one real competitor URL to test (publicly visible page)

**Workflow tasks:**
- [ ] Guide: `docs/N8N_WORKFLOW_03_FIRECRAWL_RU.md`
- [ ] JSON: `n8n/workflows/03_firecrawl_website_analysis.json`
- [ ] Nodes: Manual Trigger → Set URL → Firecrawl HTTP Request → Extract text → Build Claude Request → Claude API → Parse Response → Quality Gate → Google Sheets

**Cost note:** each Firecrawl + Claude call will cost scraping credit + ~$0.01–0.03 AI scoring depending on page length.

#### Workflow 10 — Full Pipeline _(after credentials are set up)_

- [ ] Build workflow per `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` (10 nodes)
- [ ] For first test: skip Nodes 3a–3c, inject test data via a Set node before Split Out
- [ ] Configure Claude API node with system prompt from `modules/marketing-scout-v0/SYSTEM_PROMPT.md`
- [ ] Set quality threshold to 1 for testing (passes all items through)

### Step 7 — Test with Sample Data

- [ ] Inject 3 test items from `modules/marketing-scout-v0/TEST_DATA.md` via Set node
- [ ] Run pipeline end-to-end
- [ ] Verify Google Sheets rows appear with correct column mapping
- [ ] Verify Telegram summary delivered with correct counts
- [ ] Check that skipped/boilerplate items return quality_score: 1

### Step 8 — First Real Run with Apify

- [ ] Re-enable Nodes 3a–3c (real Apify scrape)
- [ ] Choose real target: competitor site or Avito keyword
- [ ] Set quality threshold back to 6
- [ ] Run pipeline end-to-end
- [ ] Review results, adjust scoring thresholds if needed

---

## Blocked On

Not technically blocked. Deliberately paused on paid scraping (DEC-021).

**Next actions (in order):**
1. ~~Step A — consult uncle~~ ✓ Done — `docs/BUSINESS_REQUIREMENTS.md`
2. ~~Step C — write Prompt v2~~ ✓ Done — `MARKETING_AGENT_PROMPT_V2.md`
3. ~~Extended tests 8–12 run~~ ✓ Done — Tests 1 and 8 passed; Tests 9–12 failed with output-contract errors
4. ~~Step D0 — Project cleanup phase 1~~ ✓ Done — 2 experiment workflow JSONs deleted; ghost files absent
5. **Step D — Implement Resilient Output Layer** ← CURRENT (design spec: `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`, DEC-033)
   — Phase 1: operator creates 6 Sheets tabs; Phase 2: TEST HARNESS JSON built ✓; Phase 3: operator runs Tests A–E (NEXT); Phase 4: production migration
6. Step B — remaining minor doc fixes (`README.md`, `tools/TOOLS.md`, `core/warm/decisions.md`)
7. ~~Step E — Firecrawl Single URL Test~~ ✅ PASSED (2026-06-08; DEC-045) — two competitor URLs → `monitor_queue`. Firecrawl single-URL ingestion approved (manual).
8. **Step F — Workflow 04: Firecrawl URL List mini-batch** ✅ BUILT ← ACTIVE. Operator imports `04_firecrawl_url_list_resilient.json`, rebinds creds, runs **3 URLs**, verifies routes + dedup-on-rerun, records cost; then max 5. Dedup by `source_url` implemented (DEC-049); 35-col schema (DEC-048).
