# ROADMAP.md — Marketing Scout Stages

**Near-term sequence (updated 2026-06-06, DEC-037):**
1.5 Resilient Output Layer ✅ done → **2 First Real Source Test (Firecrawl single competitor URL) — next** → 3 Competitor Monitor Agent → 4 Content Agent → 5 Telegram Control Bot. Stages 6–8 (Inbound Lead Bot, CRM, Analytics) follow. Stage numbers are canonical labels; the Telegram bot (Stage 5) block appears before the Content Agent block in this file for historical reasons.

---

## Stage 1 — Marketing Scout v0.1 (Current)

**Status:** In progress
**Module directory:** `modules/marketing-scout-v0/`

**Goal:** Manual end-to-end pipeline. Prove the concept works.

**Deliverables:**
- n8n workflow: trigger → scrape → split → normalize → analyze → score → aggregate → store → notify
- System prompt for Claude API analysis node (v2 written, baseline d350069 stable for hot leads)
- Google Sheets schema with all required columns
- Telegram summary template
- 3+ test records processed successfully

**Stack:** n8n + Apify/Firecrawl + Claude API + Google Sheets + Telegram Bot

**Completed milestones:**
- Workflow 00 (healthcheck), 01 (Sheets), 02 (Claude API single record) all working
- Prompt v2 written and tested — hot leads (Tests 1, 8) confirmed
- Extended tests 8–12 run — output-contract failures identified on non-obvious records

---

## Stage 1.5 — Resilient Output Layer ✓ COMPLETED 2026-06-06

**Status:** ✅ Complete. Tests A–E passed; production workflow built (DEC-037).
**Design spec:** `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`
**Decisions:** DEC-033 (design), DEC-035 (dynamic-sheet routing), DEC-036 (routing priority + normalization), DEC-037 (production strip + cleanup)

**Goal (met):** Fixed output-contract instability without changing the primary prompt.

**Delivered:**
- JSON Repair Formatter node (second Claude call, schema-only prompt, no re-analysis, no invented facts)
- Dynamic-sheet routing — one Google Sheets node, `Sheet Name = {{ $json.route }}` (replaced Switch by Route)
- 6 tabs: `results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`, `technical_errors`
- 8 production technical fields; route validation; service_type + company_name normalization; recommended_action normalization
- Tests A–E all pass; production workflow `02_claude_api_single_record_v2_resilient_router_production.json` created (test fields stripped)

**Remaining before scraper:** import production workflow, set credential + Spreadsheet ID, create 6 tabs, run one manual smoke test.

---

## Stage 2 — First Real Source Test: Firecrawl Single Competitor URL (Current)

**Status:** Workflow built (2026-06-07, DEC-039–042). Production smoke test passed. Awaiting operator manual Firecrawl test.
**Goal:** Prove the full chain on one real source: Firecrawl scrape of one public competitor secured-lending page → resilient router → `monitor_queue`.

**Why Firecrawl single URL first:** lowest risk, one URL at a time, clean text output, deterministic, low anti-bot exposure; the competitor → `monitor_queue` path is already validated by Test C and the production smoke test (DEC-039).

**Deliverables:**
- [x] `03_firecrawl_single_url_resilient.json` — Firecrawl single-URL scrape fronting the (copied) production resilient analyzer; 17 nodes; Firecrawl failures route to `technical_errors` without Claude (DEC-041); `text_context` capped at 6000 chars (DEC-042). JSON valid; active=false.
- [x] `docs/N8N_WORKFLOW_03_FIRECRAWL_SINGLE_URL_RU.md` + `docs/FIRECRAWL_SETUP.md` written.
- [ ] Firecrawl credential created in n8n + free-tier limits recorded in `COSTS_AND_LIMITS.md`.
- [ ] One manual run with a real competitor URL; cost delta recorded.
- [ ] `source_url` dedup check before append (deferred to next iteration; v0.1 dedup key documented).

**Later sources (in order):** Avito/Apify → Telegram → Instagram.

---

## Stage 3 — Competitor Monitor Agent

**Status:** Planned
**Module directory:** `modules/competitor-intelligence-v0/`

**Goal:** Automated monitoring of a defined list of competitor URLs.

**Additions:**
- Scheduled n8n trigger (cron)
- Competitor URL list management
- Deduplication logic (skip already-seen URLs)
- Delta alerts: notify only on new items since last run

---

## Stage 5 — Operator Telegram Control Bot / Assistant

**Status:** Future roadmap (after stable data collection and first real source tests)
**Module directory:** `modules/telegram-control-bot-v0/` _(planned)_

**Goal:** Let the operator issue commands via Telegram that trigger and control n8n workflows, without needing to open the n8n UI.

**Example interaction:**
```
Operator: "Проанализируй конкурентов из Instagram: @zaym_msk, @pts_fast_moscow"
Bot: "Запрос принят. Источники: 2. Примерная стоимость: $0.03. Запустить?"
Operator: "Да"
Bot: [triggers Workflow 02 for each source]
Bot: "Готово. Найдено 2 конкурента, 0 лидов. Открыть таблицу: [ссылка]"
```

**Bot capabilities:**
1. Parse the operator's Telegram command (source type, URLs or handles)
2. Propose an execution plan and estimate cost
3. Ask for confirmation before spending money
4. Trigger the correct n8n workflow
5. Update Google Sheets with results
6. Send a concise summary and table link back to Telegram

**Prerequisites before implementation:**
- At least one real scraping source (Firecrawl or Apify) tested and stable
- Workflow 02 approved and connected to real data
- Telegram Bot token obtained (free, via BotFather)
- n8n Webhook trigger configured for the bot

**Why this stage matters:**
The operator does not need the n8n UI for routine analysis. A Telegram interface lowers the activation barrier to zero — they can request analysis from their phone at any time. This is the key UX improvement that makes the system feel like a product, not a prototype.

---

## Stage 4 — Content Agent

**Status:** Planned (later)
**Module directory:** `modules/content-agent-v0/`

**Goal:** Generate content ideas from competitor and industry content.

**Additions:**
- Content classification in Claude prompt
- Content idea scoring (`content_idea_score`)
- Output routed to a separate Google Sheets tab
- Optional: draft headline generation

---

## Stage 6 — Inbound Lead Bot

**Status:** Planned
**Module directory:** `modules/inbound-lead-bot-v0/`

**Goal:** Monitor classifieds and social media for inbound lead signals.

**Additions:**
- Avito keyword monitoring (scheduled)
- Social media keyword tracking
- Lead signal scoring refinement (`lead_signal_score`)
- Telegram alert for high-score leads (score >= 8)

---

## Stage 7 — CRM Assistant

**Status:** Planned
**Module directory:** `modules/crm-assistant-v0/`

**Goal:** Light CRM layer on top of Google Sheets output.

**Additions:**
- Status tracking column (`status`: new / contacted / qualified / closed)
- Telegram command interface: mark lead status via bot command
- Weekly digest summary

---

## Stage 8 — Analytics Agent

**Status:** Planned
**Module directory:** `modules/analytics-agent-v0/`

**Goal:** Aggregate insights across all pipeline output.

**Additions:**
- Weekly trend report: top sources, top entity types, average scores
- Competitor activity heatmap
- Content gap analysis
- Delivered via Telegram or Google Sheets dashboard
