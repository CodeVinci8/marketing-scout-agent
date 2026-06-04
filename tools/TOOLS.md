# TOOLS.md — Stack Inventory

All tools available or planned for the Marketing Scout ecosystem.

---

## Infrastructure

### VPS — Ubuntu 24.04
- **Status:** Active
- **Role:** Hosts all self-hosted services (n8n, Docker containers)
- **Notes:** Primary compute environment. All services run here.

---

## Orchestration

### n8n (self-hosted)
- **Status:** Available (install pending for v0.1)
- **Role:** Workflow orchestrator — connects all pipeline steps
- **Runs on:** VPS via Docker
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
- **Status:** Available
- **Role:** Analyzes scraped content — classifies intent, scores lead signals and content ideas,
  extracts structured fields
- **Model:** claude-sonnet (default for pipeline; claude-haiku for high-volume cheap runs)
- **Integration:** n8n HTTP node with JSON body
- **Notes:** System prompt defined in `modules/marketing-scout-v0/SYSTEM_PROMPT.md`.

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
