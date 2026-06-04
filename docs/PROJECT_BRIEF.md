# PROJECT_BRIEF.md — Marketing Scout

## Business Goal

Build an AI-powered marketing intelligence system that automatically monitors
public web sources, identifies competitor activity and lead signals,
and delivers actionable insights without manual browsing.

**Core value:** Replace hours of manual research with an automated pipeline
that runs on demand and delivers scored, filtered, structured results.

---

## Problem Statement

Small business owners and solo entrepreneurs spend significant time:
- Monitoring competitor offers and pricing
- Finding potential clients posting needs on classifieds and social media
- Identifying content ideas from what competitors are publishing

This work is repetitive, time-consuming, and easy to automate with the right stack.

---

## MVP Definition — Marketing Scout v0.1

**Trigger:** Manual (operator runs the pipeline when needed)

**Input sources (initial):**
- Competitor websites (via Apify or Firecrawl)
- Avito listings (keyword-based search)
- Social media comments or posts (public, keyword-based)

**Processing:**
- Normalize raw scraped text into a standard structure
- Send to Claude API for analysis: classify entity type, extract signals, score quality
- Filter: only pass items with `quality_score >= threshold` (default: 6/10)

**Output:**
- Append passing rows to Google Sheets (schema in `docs/TABLE_SCHEMA.md`)
- Send Telegram summary with count of items found, top lead signals

**Success criteria for v0.1:**
- Pipeline runs end-to-end manually without errors
- At least 3 real items processed and scored
- Results visible in Google Sheets within 5 minutes of trigger

---

## Out of Scope for v0.1

- Scheduled (cron) runs
- Multi-source parallel scraping
- CRM integration
- Automated outreach
- Dashboard or frontend UI
