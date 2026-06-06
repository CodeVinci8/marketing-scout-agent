# FIRECRAWL_SETUP.md — Firecrawl Integration Setup and Safety

**Date:** 2026-06-07
**Scope:** First-phase Firecrawl integration for Marketing Scout (single-URL scrape only).
**Related:** `docs/N8N_WORKFLOW_03_FIRECRAWL_SINGLE_URL_RU.md`, DEC-039–DEC-042.

---

## 1. Why HTTP Request in n8n (not MCP/CLI yet)

The first Firecrawl integration uses a plain **n8n HTTP Request node** calling
`POST https://api.firecrawl.dev/v2/scrape` with Header Auth. Reasons:

- It is the simplest, most transparent integration — one request, one response, visible in the n8n execution log.
- It reuses the existing pattern (the Claude calls are also HTTP Request nodes), so the operator setup is consistent.
- No extra runtime, daemon, or local process is needed on the VPS.
- It keeps the credential model identical to every other service (n8n credential by name).

### MCP / CLI is deferred

The Firecrawl **MCP server** and **CLI** are deferred to a later phase, for **local agent / browser
automation** scenarios (when an interactive agent needs to drive scraping itself). They add a local
process and a different auth/runtime surface that is not needed for a single n8n-orchestrated scrape.
Until that need is concrete, the HTTP Request node is the only Firecrawl integration in this project.

---

## 1a. Status — single URL validated (2026-06-08, DEC-045)

**Firecrawl single-URL scraping is validated and approved** (manual, controlled). Two real competitor
pages passed end-to-end via Workflow 03:
- `https://mosinvestfinans.ru/` (multi-product homepage) → `monitor_queue`, `generic_lending`.
- `https://www.lioncredit.ru/uslugi/kredit-pod-zalog-nedvizhimosti` (specific service page) → `monitor_queue`, `generic_lending`.

**Page selection guidance:**
- **Prefer service-specific pages** (one product/offer) → clearer `service_type`, lower cost, less likely to trigger the paid repair pass.
- **Homepages are acceptable** for competitor discovery, but multi-product homepages will usually classify as `service_type=generic_lending` (DEC-044) — fine for `monitor_queue`, just less specific.
- **Avoid pages with login / captcha / heavy JS** until a later phase — they tend to return empty/unusable markdown (→ `technical_errors`).

The next step up is the **3–5 URL mini-batch** (Workflow 04, DEC-047) — still manual, no crawl, no schedule, no batch.

## 2. First phase scope — single URL only

| Allowed now | Deferred / not allowed yet |
|-------------|----------------------------|
| `POST /v2/scrape` for **one URL** | `/v2/crawl` (whole-site crawl) |
| `formats: ["markdown"]`, `onlyMainContent: true` | `/v2/batch/scrape` (batch) |
| Manual trigger, one run | `/v2/search` |
| | `actions` / browser steps |
| | Scheduled scraping (cron) |
| | MCP server / CLI |

Request body used by Workflow 03:

```json
{
  "url": "<target_url>",
  "formats": ["markdown"],
  "onlyMainContent": true,
  "onlyCleanContent": false,
  "removeBase64Images": true,
  "blockAds": true,
  "timeout": 60000,
  "storeInCache": true
}
```

---

## 3. Credential (Header Auth)

- n8n credential type: **Header Auth**
- Name: `Firecrawl API - Marketing Scout`
- Header Name: `Authorization`
- Header Value: `Bearer <FIRECRAWL_API_KEY>`
- Allowed domain (if supported): `api.firecrawl.dev`
- The real key lives only in n8n. Never commit it to any project file.

---

## 4. Cost / rate-limit safety checklist

Before running Workflow 03:

- [ ] Record the Firecrawl credit/balance (if visible in the dashboard) **before** the run.
- [ ] Record the Claude balance **before** the run.
- [ ] Confirm only **one** URL is set in `Set Firecrawl URL → target_url`.
- [ ] Confirm `active = false` — manual run only.
- [ ] Run **once**. Do not re-trigger immediately on failure (avoids 429 and double cost).
- [ ] Record Firecrawl + Claude balance **after**; log the delta in `docs/COSTS_AND_LIMITS.md`.

Safety rules carried from the project:

- `text_context` is capped at **6000 characters** before Claude (token-cost control).
- A Firecrawl failure routes straight to `technical_errors` **without** calling Claude (no wasted AI spend).
- The repair Claude call only fires on a primary parse failure.
- No crawl, no batch, no schedule until the per-URL cost profile is known and approved.

### Prefer specific service pages over homepages

First real test (`mosinvestfinans.ru/` homepage, 2026-06-08): Firecrawl used **1 credit**, but the page was large and multi-product, the **primary Claude parse failed**, and the **repair call fired** (≈$0.0229 Claude delta — ~2× the short-record baseline). Large homepages cost more **and** are more likely to trigger the paid repair pass and produce a multi-product `service_type`. **Prefer a single specific offer/service page** (e.g. `…/kredit/pod-zalog-avto/`) for lower cost and a cleaner single-product analysis. The post-repair consistency hardening (DEC-043/044) fixes the routing/scoring/language for homepages, but specific pages remain cheaper and clearer.

---

## 5. Do NOT (this phase)

- Do **not** crawl whole sites.
- Do **not** use batch scrape.
- Do **not** enable a schedule trigger.
- Do **not** use `actions`, browser steps, MCP, or CLI.
- Do **not** activate the workflow.
- Do **not** add a real Spreadsheet ID or API key to the JSON file.
