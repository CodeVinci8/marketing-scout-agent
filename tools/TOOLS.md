# TOOLS.md — Stack Inventory

All tools available or planned for the Marketing Scout ecosystem.

---

## Infrastructure

### VPS — Ubuntu 24.04
- **Status:** Active
- **Role:** Hosts all self-hosted services (n8n, Docker containers)
- **Notes:** Primary compute environment. All services run here.

### Docker Engine
- **Status:** Active — version 29.1.3
- **Role:** Container runtime for all self-hosted services
- **Current state (as of 2026-06-04):** 3 containers running, 39 images present
- **Storage driver:** overlayfs
- **Warning:** Do not run `docker system prune` or any destructive Docker cleanup without explicit operator approval — existing containers are in use.

### Docker Compose
- **Status:** Active — version v5.1.2
- **Installation method:** Manual binary install (not apt package)
  - Binary path: `/usr/local/lib/docker/cli-plugins/docker-compose`
  - `apt install docker-compose-plugin` failed (package not found on this system)
- **Usage:** `docker compose` (plugin syntax, not `docker-compose` standalone)
- **Migration note:** On server rebuild or migration, Docker Compose must be reinstalled manually from the official Docker GitHub releases. It will NOT be present after a standard `apt install docker.io` or equivalent.

---

## Orchestration

### n8n (self-hosted)
- **Status:** Active — deployed 2026-06-04
- **Role:** Workflow orchestrator — connects all pipeline steps
- **Runs on:** VPS via Docker — container `n8n-n8n-1`
- **Port binding:** `127.0.0.1:5678->5678/tcp` (localhost only — not public)
- **Access:** SSH tunnel → `http://localhost:5678` (see `docs/N8N_DEPLOYMENT.md`)
- **Do not expose port 5678 publicly** for v0.1 — see DEC-010, DEC-011
- **Execution pruning:** enabled (7 days / 1000 executions max) — see DEC-014
- **Key use:** Manual trigger → scrape → analyze → store → notify

---

## Scraping

### Apify
- **Status:** Planned for v0.1
- **Role:** Scrape competitor websites, Avito listings, social profiles
- **Integration:** n8n HTTP node or Apify actor trigger
- **Notes:** Has free tier. Requires API key (store in n8n credentials, not in project files).

### Firecrawl
- **Status:** Planned for v0.1
- **Role:** Clean web page extraction — strips boilerplate, returns structured Markdown
- **Integration:** n8n HTTP node
- **Notes:** Useful for article and landing page content extraction.

---

## AI Analysis

### Claude API
- **Status:** Active — gateway compatibility confirmed 2026-06-05
- **Role:** Analyzes scraped content — classifies intent, scores lead signals and content ideas,
  extracts structured fields
- **Gateway base URL:** `https://aiprimetech.io`
- **Endpoint:** `/v1/messages`
- **Auth format:** `Authorization: Bearer <token>` — HTTP Header Auth in n8n
- **Working model ID:** `claude-sonnet-4-6` (hyphen notation — `claude-sonnet-4.6` with a dot returns "No available accounts")
- **n8n credential name:** `Claude API - Marketing Scout`
- **Integration:** n8n HTTP Request node with JSON body
- **Response parsing:** select content item where `type == "text"` — do not use `content[0].text`; thinking blocks may appear before the text block
- **Prompt requirement:** system prompt must explicitly forbid markdown and code fences; otherwise output may be wrapped in backticks, breaking JSON.parse
- **System prompt:** `modules/marketing-scout-v0/SYSTEM_PROMPT.md`
- **See:** DEC-018

---

## Storage

### Google Sheets
- **Status:** Planned for v0.1
- **Role:** Stores all scored pipeline output rows
- **Integration:** n8n Google Sheets node
- **Schema:** See `docs/TABLE_SCHEMA.md`
- **Notes:** One sheet per module/stage. Requires OAuth credentials in n8n.

---

## Notifications

### Telegram Bot
- **Status:** Planned for v0.1
- **Role:** Delivers session summary after each pipeline run
- **Integration:** n8n Telegram node
- **Notes:** Bot token stored in n8n credentials. Message template in workflow.

---

## Version Control (Planned)

### GitHub
- **Status:** Planned (later stage)
- **Role:** Version control for project files, workflow exports, prompt versions
- **Notes:** Not active in v0.1. Will be introduced after the first working pipeline run.

---

## Tool Availability Matrix

| Tool           | v0.1 | v0.2+ | Notes                        |
|----------------|------|-------|------------------------------|
| VPS Ubuntu     | Yes  | Yes   | Already running              |
| Docker         | Yes  | Yes   | Required for n8n             |
| n8n            | Yes  | Yes   | Core orchestrator            |
| Apify          | Yes  | Yes   | Primary scraper              |
| Firecrawl      | Yes  | Yes   | Clean extraction             |
| Claude API     | Yes  | Yes   | Analysis engine              |
| Google Sheets  | Yes  | Yes   | Output storage               |
| Telegram Bot   | Yes  | Yes   | Notifications                |
| GitHub         | No   | Yes   | Deferred to later stage      |
