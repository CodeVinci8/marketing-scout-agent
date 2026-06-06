# NEXT_ACTIONS.md — Immediate Next Steps

Updated at the end of each session. This is the first thing to read after `core/hot/recent.md`.

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

#### Step E — Firecrawl Single URL Test ← ACTIVE STAGE (2026-06-07)

**Context:** Production smoke test passed (competitor → `monitor_queue`, `parsed_success`, `primary_json`, dynamic routing confirmed). Workflow 03 built (DEC-039–042): `n8n/workflows/03_firecrawl_single_url_resilient.json` (17 nodes; Firecrawl single-URL scrape → copied resilient analyzer; Firecrawl failures → `technical_errors` without Claude; `text_context`≤6000; active=false; JSON valid).

**Guide:** `docs/N8N_WORKFLOW_03_FIRECRAWL_SINGLE_URL_RU.md` · **Setup/safety:** `docs/FIRECRAWL_SETUP.md`

**First real test done (2026-06-08, `mosinvestfinans.ru/`):** Firecrawl OK (1 credit, Claude delta ≈$0.0229); primary parse failed → repair OK → row landed in `review_queue` with contradictory scores + Chinese `reason`. **Patched** (DEC-043/044): post-repair consistency hardening in `Normalize + Route` (competitor floors, rich-competitor → `monitor_queue`, language guard, multi-product → `generic_lending`, compact preview). JSON valid; simulation + regression pass.

**Operator retest tasks (in order):**
1. [ ] **Re-import** the patched `03_firecrawl_single_url_resilient.json` (active stays false).
2. [ ] **Bind credentials if needed** (import often drops them): `Firecrawl Scrape API`→`Firecrawl API - Marketing Scout`; both Claude nodes→`Claude API - Marketing Scout`; `Append to Dynamic Route Sheet`→`Google Sheets - Marketing Scout Service Account` + real Spreadsheet ID. Confirm 6 tabs / 33-col header.
3. [ ] **Retest the same URL** `https://mosinvestfinans.ru/` (record Firecrawl + Claude balance). **Expected: `route=monitor_queue`**, `entity_type=competitor`, `recommended_action=monitor`, `competitor_strength≈70–90`, `quality_score≈70–90`, `service_type=generic_lending`/`secured_real_estate_loan`, Russian `reason`.
4. [ ] **Then test a specific service page** for lower cost / clearer single-product analysis — preferably `https://mosinvestfinans.ru/kredit/pod-zalog-avto/` (or another one-page competitor offer).
5. [ ] Record both cost deltas in `docs/COSTS_AND_LIMITS.md`.
6. [ ] Only after these pass, consider a real competitor URL **list** (then Avito/Apify → Telegram → Instagram).

> Not approved this phase (DEC-039/040): multi-page crawl, batch scrape, search, scheduled scraping, Firecrawl MCP/CLI, automated outreach. **Firecrawl batch remains blocked.**

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
7. **Step E — Firecrawl Single URL Test** ← ACTIVE. Workflow 03 built (DEC-039–042); operator creates Firecrawl credential, sets one URL, runs once, verifies `monitor_queue`/`technical_errors`, records cost.
