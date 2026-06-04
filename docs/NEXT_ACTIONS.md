# NEXT_ACTIONS.md — Immediate Next Steps

Updated at the end of each session. This is the first thing to read after `core/hot/recent.md`.

---

## Current Priority: v0.1 Pipeline Setup

### Step 1 — Review project structure ✓
- [x] Operator reviews all created files
- [x] Documentation review fixes applied (2026-06-04)
- [x] Confirm roadmap stages and stack are correct

### Step 2 — Prepare docker-compose.yml for n8n

Before running Docker, a `docker-compose.yml` file must be prepared for n8n.

- [ ] Request agent to generate `scripts/docker-compose.n8n.example` based on official n8n Docker image
- [ ] Review the compose file — set data volume path, port, and timezone
- [ ] Copy to the VPS and rename to `docker-compose.yml` (outside this project dir)
- [ ] **Do not run Docker commands** until the compose file is reviewed and approved

**Access method for v0.1:** n8n will be accessed via SSH tunnel only — no public domain,
no reverse proxy, no HTTPS required for MVP.

SSH tunnel command (run on your local machine):
```
ssh -L 5678:localhost:5678 user@your-vps-ip
```
Then open `http://localhost:5678` in a local browser.

Public HTTPS/domain access is deferred until webhooks or OAuth integrations require inbound access.

### Step 3 — Start n8n on VPS

- [ ] Confirm Docker and Docker Compose are installed on VPS (`docker --version`, `docker compose version`)
- [ ] Upload or create `docker-compose.yml` on VPS in a dedicated directory (e.g. `/opt/n8n/`)
- [ ] Run: `docker compose up -d` (operator runs this — agent proposes only)
- [ ] Verify n8n UI accessible via SSH tunnel at `http://localhost:5678`

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

### Step 6 — Build n8n Workflow

- [ ] Build workflow per `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` (10 nodes)
- [ ] For first test: skip Nodes 3a–3c, inject test data via a `Set` node before Split Out
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

Nothing currently blocked. Next concrete action: prepare `scripts/docker-compose.n8n.example`.
