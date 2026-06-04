# Marketing Scout v0.1 — Module Overview

## What This Module Does

Manual-triggered marketing intelligence pipeline.
Scrapes public web sources, analyzes content with Claude API, scores items,
stores qualified results in Google Sheets, and sends a Telegram summary.

## Module Files

| File                  | Purpose                                              |
|-----------------------|------------------------------------------------------|
| `WORKFLOW_DESIGN.md`  | Node-by-node n8n workflow specification              |
| `SYSTEM_PROMPT.md`    | Claude API system prompt for the analysis node       |
| `TEST_DATA.md`        | 3 sample records for testing and prompt evaluation   |

## Pipeline at a Glance

```
Manual Trigger
→ Set Search Config
→ Apify / Firecrawl (scrape)
→ Normalize Item
→ Claude API Analysis
→ IF quality_score >= 6
→ Google Sheets Append Row
→ Telegram Summary
```

## Status

**In design.** Workflow not yet built in n8n.

See `docs/NEXT_ACTIONS.md` for setup steps.
See `docs/ARCHITECTURE.md` for full system context.
