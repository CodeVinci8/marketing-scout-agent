# MEMORY.md — Long-Term Memory Index

Long-term stable facts about the project, operator, and system.
Updated only when something fundamental changes.

---

## Project Identity

- **Project name:** Marketing Scout
- **Purpose:** AI automation for marketing intelligence — lead signals, competitor analysis, content ideas
- **Stage:** v0.1 design and setup (as of 2026-06-04)
- **Home directory:** `/opt/marketing-scout-agent`

## Operator

- Nik — student, entrepreneur, Python/Linux learner
- Practical and direct. Wants real output, not theory.
- Approves all actions via explicit confirmation before execution.
- Full profile: `core/USER.md`

## Stack (Locked for v0.1)

- VPS Ubuntu 24.04 (self-hosted)
- n8n for orchestration
- Apify and Firecrawl for scraping
- Claude API (claude-sonnet) for analysis
- Google Sheets for storage
- Telegram Bot for notifications

## Architecture Pattern

Linear pipeline: Manual Trigger → Scrape → Normalize → Analyze → Score → Store → Notify

## Agent Structure

Five future agents defined in `core/AGENTS.md`. None are active yet.
Current active role: project-engineer (this session).

## Key Decisions (Summary)

- Lightweight architecture: no heavy frameworks, no external agent SDKs
- Markdown-first documentation
- Plan-before-code workflow enforced
- All secrets stay out of project files — `.example` files only

## Memory Files

| File                       | Type | Purpose                              |
|----------------------------|------|--------------------------------------|
| `core/hot/recent.md`       | Hot  | Last 1–3 sessions, immediate context |
| `core/warm/decisions.md`   | Warm | Stable decisions shaping behavior    |
| `core/MEMORY.md`           | Cold | Long-term facts, rarely changes      |
