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

#### Step D — Test Prompt v2.3 via TEST HARNESS _(before any paid scraping)_

**Goal:** Verify v2.3 KEY=VALUE line protocol resolves all previous parse failures.
**v2.3 status:** KEY=VALUE output. No JSON. No tool_use. Connections rebuilt and verified. See DEC-026.
History: v2.0/v2.1 failed JSON.parse; v2.2 gateway returned 502 + broken node connection.

**Cost:** ~$0.08–0.15 for 7 calls (≈ 6–11 RUB). Approved under DEC-021.
**TEST HARNESS JSON:** `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` (v2.3, 32,077 bytes)
**Node names:** `Build Claude Request v2.3` / `Parse Claude Line Response`
**Connection chain:** Manual Start → Set Test Selector → Select Test Record → Build Claude Request v2.3 → Claude API Request → Parse Claude Line Response → Quality Gate → Append Row to Google Sheets

- [ ] Validate JSON: `python3 -m json.tool n8n/workflows/02_claude_api_single_record_v2_test_harness.json > /tmp/v2_test_harness_validated.json`
- [ ] Delete old TEST HARNESS in n8n (if present), then import new version
- [ ] Bind credentials: `Claude API - Marketing Scout` and `Google Sheets - Marketing Scout Service Account`
- [ ] Paste real Spreadsheet ID into `Append Row to Google Sheets` node
- [ ] **Run Test 1 first** — check `parse_method=line_protocol`; if `line_failed`, stop and report
- [ ] **Run Test 5 second** — check `parse_method=line_protocol`
- [ ] **Run Test 6 third** — check `parse_method=line_protocol`, `status=skipped`, Quality Gate = false
- [ ] If Tests 1, 5, 6 pass: run Tests 2, 3, 4, 7
- [ ] Fill in the protocol table in `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`
- [ ] Measure cost: balance before and after all 7 tests → cost per call
- [ ] Check all pass criteria — zero `line_failed`, min 6/7 logical tests (DEC-024, DEC-026)
- [ ] Present results to operator for approval
- [ ] Only after approval: update `02_claude_api_single_record_analysis.json` Build Claude Request + Parse nodes with v2.3 structure

> Full procedure: `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`.

#### Step E — Workflow 03: Firecrawl Website Analysis _(after Steps A–D complete)_

**Goal:** Take a real competitor URL, extract clean text via Firecrawl, pass to Claude v2, verify full chain.

- [ ] Get Firecrawl API key → create n8n credential: HTTP Header Auth, `Authorization: Bearer <token>`, name `Firecrawl - Marketing Scout`
- [ ] Check Firecrawl free tier limits → record in `docs/COSTS_AND_LIMITS.md`
- [ ] Choose one real competitor URL (publicly visible page, secured lending)
- [ ] Guide: `docs/N8N_WORKFLOW_03_FIRECRAWL_RU.md`
- [ ] JSON: `n8n/workflows/03_firecrawl_website_analysis.json`
- [ ] After first run: measure actual cost per Firecrawl + Claude call; update `docs/COSTS_AND_LIMITS.md`

> Do not start this step until v2 prompt is approved (Step D). See DEC-021.

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
3. **Step D — import TEST HARNESS and run 7 tests** (~$0.08–0.15, DEC-021) — follow `N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md`; delete old v2.2 harness in n8n; **run Test 1 first, Test 5 second, Test 6 third** to verify v2.3 KEY=VALUE protocol; check `parse_method=line_protocol`
4. Get operator approval on test results → update Workflow 02 with v2.3 Build + Parse nodes (DEC-026)
5. Step B — remaining minor doc fixes (`README.md`, `tools/TOOLS.md`, `core/warm/decisions.md`)
6. Step E — Workflow 03 Firecrawl (competitor website)
