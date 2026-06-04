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

#### Workflow 01 — Google Sheets Append Row Test _(next)_

**Guide:** `docs/N8N_WORKFLOW_01_GOOGLE_SHEETS_RU.md`
**JSON:** `n8n/workflows/01_google_sheets_append_row_test.json` — ready to import

**Pre-import (operator does once):**
- [ ] Create Google Sheets spreadsheet with headers from `docs/TABLE_SCHEMA.md` in row 1, sheet named `results`
- [ ] Share the spreadsheet with the service account email (Editor permission)
- [ ] Create credential in n8n: **Settings → Credentials → Google API (Service Account)**; name it `Google Sheets - Marketing Scout Service Account`

**Import and configure:**
- [ ] Import JSON: **Workflows → ⋮ → Import from File** → `01_google_sheets_append_row_test.json`
- [ ] Open node **Append Row to Google Sheets** → select credential `Google Sheets - Marketing Scout Service Account`
- [ ] Replace `PASTE_SPREADSHEET_ID_HERE` with the real Spreadsheet ID from the sheet URL
- [ ] Confirm sheet name field shows `results`

**Run:**
- [ ] Click **Test workflow** — verify new row appears in the Google Sheet
- [ ] Confirm `status=analyzed`, `quality_score=75` in the appended row

Print JSON for clipboard import:
```bash
cat n8n/workflows/01_google_sheets_append_row_test.json
```

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

Nothing currently blocked. Next concrete action: **Workflow 01 — Google Sheets Append Row Test** — create the spreadsheet, set up service account credential in n8n, import `01_google_sheets_append_row_test.json`, configure credential + Spreadsheet ID in the node, run.
