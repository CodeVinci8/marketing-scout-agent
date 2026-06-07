# WORKFLOW_05_URL_DISCOVERY_PLAN.md — 05 - Apify Search Candidate Discovery (Planning)

**Status:** 🔧 BUILT + candidate-quality patch (2026-06-08, DEC-060/061) — first Apify test passed **technically**; quality patch applied, **retest required**. `n8n/workflows/05_apify_search_candidate_discovery.json`, active=false. No Firecrawl, no Claude, no schedule.

> **Manual end-to-end test PASSED (2026-06-08, DEC-062):** the full discovery→approval→consume chain works.
> WF05 discovered `https://carcapital.ru/` (`candidate_type=direct_competitor`, `service_hint=pts_loan`,
> confidence 100) → operator set `approval_status=approved` → Workflow 04 processed it → `monitor_queue`,
> competitor, `CarCapital`, `parsed_success`. This proves WF05 as a usable URL **supplier**.
>
> **Next: Workflow 06 — Approved Candidates Runner (Stage 2.2c, BUILT/under test — DEC-064).** The repetitive
> "pick approved → hand ≤5 to WF04" step is now packaged in `n8n/workflows/06_approved_candidates_runner.json`
> (active=false). It filters `approved AND unique AND not_in_registry AND non-empty URL`, prioritizes
> `direct_competitor` → confidence → rank, hard-caps at 5/run, and emits a WF04-shaped batch + handoff block.
> v0.1 = manual hand-off (no subworkflow call); 0 spend in WF06. Guide:
> `docs/N8N_WORKFLOW_06_APPROVED_CANDIDATES_RUNNER_RU.md`.

> **Candidate-quality patch (DEC-061):** fixed empty `domain` (robust hostname extraction, strip `www.`),
> added **`candidate_type`** (`url_candidates` 25 → **26 cols**), and reworked confidence so
> `direct_competitor` ranks above `aggregator`/`directory`/`media_article`/`marketplace`/`social`. Aggregators/
> directories/media stay `approval_status=new` but get a "not a direct competitor" note. Retest the same query.
**Workflow file:** `n8n/workflows/05_apify_search_candidate_discovery.json` (13 nodes; JSON valid)
**RU guide:** `docs/N8N_WORKFLOW_05_APIFY_SEARCH_CANDIDATES_RU.md`
**Date:** 2026-06-08
**Stage:** 2.2 (Level 2 — automated candidate URL discovery from search queries, DEC-059/060)
**Related:** `docs/URL_DISCOVERY_STRATEGY.md`, `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`, `docs/TABLE_SCHEMA.md`, DEC-055/056/057/058/059/060

> **Build note (DEC-060):** Built as 13 nodes — Manual Start → Set Discovery Request → Build Apify Search
> Request → Apify Search API Request (Header Auth) → Normalize Apify Results → Read url_registry →
> Classify Candidates → (Expand Candidate Rows → Append url_candidates) + (Build Discovery Request Summary
> → Append discovery_requests). Both append branches start from the always-1-item `Classify Candidates`,
> so the `discovery_requests` row is written even when there are 0 candidates / Apify error. JSON validated;
> code-node logic simulated (dedup, batch-dup, error path, 25/18 field counts, confidence discrimination).

---

## 1. Purpose

`05 - Apify Search Candidate Discovery` takes a **search topic/query** (e.g. «займ под залог ПТС Москва»),
calls an **Apify Google Search Results Scraper actor** to collect up to **10 candidate URLs** (+ title,
snippet, rank), normalizes them, checks `url_registry`, marks duplicates, scores each candidate
deterministically, writes rows to **`url_candidates`**, and creates/updates a **`discovery_requests`** row.

This is the URL **supplier** (Level 2, automated). Workflow 04 remains the URL **consumer**. Manual URL
intake is **not** the headline of this workflow — Workflow 04 already accepts a manual URL list; manual
candidate entry survives only as an optional simple input mode (see §3 / Strategy doc).

**Workflow name:** `05 - Apify Search Candidate Discovery`
**Does:** call Apify Search actor (candidate discovery only), normalize, dedup-classify, score, write sheets.
**Does NOT:** call Firecrawl, call Claude (no page analysis), scrape page content, schedule, or auto-process.
**Human approval is required** before any candidate reaches Workflow 04 (paid Firecrawl/Claude).

## 2. Sheets

### 2.1 `url_candidates` (25 columns) — confirmed

The first five columns are **request-level grouping fields** (shared by every candidate of one request)
so `discovery_requests`, summaries, and the future Telegram bot can group/report per request.

| # | Column | Type | Description |
|---|--------|------|-------------|
| 1 | `candidate_id` | string | `cand_YYYYMMDD_HHmmss_<index>` |
| 2 | `discovery_request_id` | string | groups all candidates of one request, `disc_YYYYMMDD_HHmmss` |
| 3 | `created_at` | string | ISO 8601 |
| 4 | `requested_by` | string | `manual` / `operator` / `telegram_operator` / `system` |
| 5 | `requested_limit` | integer | candidate target for the request (default 10) |
| 6 | `query` | string | search query (e.g. «займ под залог ПТС Москва») |
| 7 | `source` | string | `manual` / `apify_search` / `search_api` / `serp_actor` / `telegram_operator` / `unknown` |
| 8 | `candidate_url` | string | raw URL from the search result |
| 9 | `normalized_source_url` | string | normalized key (Workflow 04 rules) — matches `url_registry` |
| 10 | `title` | string | search-result title |
| 11 | `snippet` | string | search-result snippet |
| 12 | `domain` | string | host of the normalized URL |
| 13 | `rank` | integer | position in the search result list |
| 14 | `region_hint` | string | e.g. `Москва` / `MSK` / blank |
| 15 | `service_hint` | string | e.g. `pts_loan` / `secured_auto_loan` / `secured_real_estate_loan` / blank |
| 16 | `confidence_score` | integer | 1–100 deterministic relevance (title/snippet/domain/query match, no LLM) |
| 17 | `dedup_status` | string | `unique` / `duplicate_in_batch` / `duplicate_in_registry` |
| 18 | `registry_status` | string | `not_in_registry` / `in_registry` |
| 19 | `approval_status` | string | `new` / `approved` / `rejected` / `processed` / `duplicate` / `error` |
| 20 | `approved_by` | string | operator id (blank until approved) |
| 21 | `approved_at` | string | ISO 8601 (blank until approved) |
| 22 | `rejection_reason` | string | free text |
| 23 | `estimated_firecrawl_credits` | integer | estimate if processed (0 for duplicates) |
| 24 | `estimated_claude_cost_usd` | number | estimate if processed (0 for duplicates) |
| 25 | `notes` | string | free text |

**`approval_status`:** `new` (default), `approved`, `rejected`, `processed`, `duplicate`, `error`.
**`source`:** `manual`, `apify_search`, `search_api`, `serp_actor`, `telegram_operator`, `unknown`.
**`dedup_status`:** `unique`, `duplicate_in_batch`, `duplicate_in_registry`.
**`registry_status`:** `not_in_registry`, `in_registry`.

### 2.2 `discovery_requests` (18 columns) — one row per request

| # | Column | Type | Description |
|---|--------|------|-------------|
| 1 | `discovery_request_id` | string | `disc_YYYYMMDD_HHmmss` |
| 2 | `created_at` | string | ISO 8601 |
| 3 | `requested_by` | string | `manual` / `operator` / `telegram_operator` / `system` |
| 4 | `request_text` | string | raw operator request (NL text, esp. from future Telegram) |
| 5 | `query` | string | the search query actually sent to Apify |
| 6 | `region` | string | e.g. `Москва` |
| 7 | `service_focus` | string | e.g. `pts_loan` / `secured_auto_loan` / blank |
| 8 | `requested_limit` | integer | candidate target (default 10) |
| 9 | `source_mode` | string | `search` / `manual` (how candidates were gathered) |
| 10 | `source_api` | string | `apify_search` / `google_cse` / `serpapi` / `manual` / `unknown` |
| 11 | `status` | string | request lifecycle (values below) |
| 12 | `candidate_count` | integer | total candidates written |
| 13 | `unique_candidate_count` | integer | `dedup_status=unique` count |
| 14 | `duplicate_count` | integer | duplicate (registry+batch) count |
| 15 | `approved_count` | integer | candidates moved to `approved` (filled at approval time) |
| 16 | `estimated_firecrawl_credits` | integer | sum over unique candidates |
| 17 | `estimated_claude_cost_usd` | number | sum over unique candidates |
| 18 | `notes` | string | free text |

**`status` values:** `new`, `search_done`, `needs_review`, `approved`, `processing`, `processed`, `error`, `cancelled`.

## 3. n8n node plan (build next — no JSON yet)

```
Manual Start
  → Set Discovery Request        (Code: build discovery_request_id=disc_<ts>, query, region,
                                  service_focus, requested_limit=10, requested_by=operator,
                                  source=apify_search, source_mode=search, source_api=apify_search)
  → Build Apify Search Request   (Code: build actor input JSON: queries=[query], resultsPerPage,
                                  maxPagesPerQuery, countryCode=ru, languageCode=ru; cap to requested_limit)
  → Apify Search Actor API Request (HTTP Request: POST run-sync-get-dataset-items; Header Auth cred)
  → Normalize Search Results     (Code: map dataset items → {candidate_url,title,snippet,rank})
  → Normalize Candidate URLs     (Code: Workflow 04 normalizer → normalized_source_url, domain)
  → Check url_registry           (Google Sheets read on url_registry by normalized_source_url, read-only)
  → Build Candidate Rows         (Code: dedup_status, registry_status, confidence_score, service_hint,
                                  region_hint, estimates, approval_status; 25-field rows)
  → Append url_candidates        (Google Sheets append, Mapping=Automatically, Sheet=url_candidates name)
  → Append/Update discovery_requests (Google Sheets: write the 18-field request row; status=search_done
                                  → needs_review)
```

No Firecrawl node, no Claude node, no schedule trigger, no auto-processing.

**Optional manual input mode:** the same workflow may accept `source=manual` (operator pastes URLs in
`Set Discovery Request` instead of querying Apify), skipping the Apify nodes. This is a fallback input
mode, not the primary purpose.

## 4. Apify actor — credential + expected behavior

**Credential (create later in n8n — do NOT add keys to any file):**
- **Name:** `Apify API - Marketing Scout`
- **Type:** Header Auth
- **Header Name:** `Authorization`
- **Header Value:** `Bearer <APIFY_API_TOKEN>` (placeholder; real token entered only in n8n)
- **Allowed domain:** `api.apify.com`

**Primary actor:** Apify **Google Search Results Scraper**.
**Call pattern (planned):** `POST https://api.apify.com/v2/acts/<actor-id>/run-sync-get-dataset-items`
with a JSON body containing the query, region/language, and result caps. Run-sync-get-dataset-items
returns the result items directly so no separate dataset poll is needed for a small request.

**Expected behavior:** for one query, return up to `requested_limit` (10) organic results, each with at
least `url`, `title`, and a snippet/description, plus position/rank. Workflow 05 keeps only organic web
results (drops ads, maps, "people also ask", and obvious non-business result types where identifiable).

**Fallback APIs (later, not now):** Google Custom Search JSON API (low-cost fallback), SerpAPI (paid
stable fallback). **Firecrawl `/v2/search` is parked** — evaluation only, do not use yet.

## 5. Normalization rules (reuse Workflow 04)

Identical to `Normalize URL for Dedup` so `url_candidates.normalized_source_url` matches
`url_registry.normalized_source_url` exactly:
- lowercase **scheme and host only**;
- drop `#fragment`;
- drop tracking params: `utm_source/medium/campaign/term/content`, `fbclid`, `gclid`, `yclid`;
- preserve meaningful query params and the path;
- strip trailing slash on **non-root** paths; normalize root consistently;
- **full URL with path, never reduced to domain.** Root variants dedup; distinct service paths do not.

## 6. `url_registry` dedup

`Check url_registry` reads `url_registry` (read-only — Workflow 05 never writes `url_registry`). Per candidate:
- in `url_registry` → `registry_status=in_registry`, `dedup_status=duplicate_in_registry`,
  `approval_status=duplicate`, estimates 0 (already processed; do not re-spend).
- repeated within the same request → `dedup_status=duplicate_in_batch`, `approval_status=duplicate`.
- else → `registry_status=not_in_registry`, `dedup_status=unique`, `approval_status=new`.

## 7. Candidate confidence scoring (deterministic, no LLM)

Score over `query` + `title` + `snippet` + `domain`, clamp **1–100**:
- **+30** contains `залог`
- **+25** contains `ПТС` or `авто`/`автомобиль`
- **+20** contains `Москва` / `московск` / `msk` / `mo`
- **+15** contains `кредит` / `займ`
- **+10** contains `ставка` / `сумма` / `одобрен`
- **−30** irrelevant domain / unrelated marketplace (e.g. generic marketplace, news, gov)
- **−50** if `duplicate_in_registry`

`service_hint` is derived deterministically (same token logic as Workflow 04's service-type override:
`pts`/`pledge-pts` → `pts_loan`; `pod-zalog-avto` → `secured_auto_loan`; `pod-zalog-nedvizhimosti`/
`недвижимост` → `secured_real_estate_loan`). `region_hint` from the query/snippet.

## 8. Approval gate (human)

- Unique candidates land `approval_status=new`; duplicates land `approval_status=duplicate`.
- **Operator reviews** `url_candidates` and sets `approved` (filling `approved_by`/`approved_at`) or
  `rejected` (filling `rejection_reason`). `discovery_requests.status` moves `needs_review → approved`.
- Only `approved` rows feed Workflow 04. **Hand-off is manual for now** (copy ≤5 approved URLs into
  Workflow 04). Stage 2.2c Approved Candidates Runner may automate it later, in **batches of 5**.
- **No candidate reaches Firecrawl/Claude until `approval_status=approved`.**

## 9. Cost (Workflow 05 vs processing)

- **Workflow 05 itself must not spend Firecrawl or Claude.** Its only cost is the **Apify search call**
  (per-request, to be measured — see `docs/COSTS_AND_LIMITS.md`).
- Per unique not-in-registry candidate, the estimate columns show *future* processing cost:
  `estimated_firecrawl_credits=1`, `estimated_claude_cost_usd` ≈ a configurable rough **$0.01–0.03/URL**
  until measured. Duplicates = 0/0.
- Default 10 candidates → if all approved, processed by Workflow 04 as **two batches of 5** (≈10 Firecrawl
  credits + ~$0.10–0.30 Claude), only after approval.

## 10. Hard limits

- **Default `requested_limit=10` candidates/request** (Apify result cap aligned to this).
- Apify call is **search/discovery only** — no scraping of page content, no crawl/batch.
- No Firecrawl, no Claude, no schedule, no auto-processing.
- Human approval required before Workflow 04; Workflow 04 keeps ≤5 URLs/run.

## 11. Test plan (when built — not now)

1. Create `discovery_requests` (18 cols) and confirm `url_candidates` (25 cols).
2. Create the `Apify API - Marketing Scout` Header Auth credential in n8n.
3. Run one query (e.g. «займ под залог ПТС Москва», limit 10). Verify: ≤10 `url_candidates` rows with
   normalized URLs (registry format), `dedup_status`/`registry_status`/`approval_status`, deterministic
   `confidence_score`/`service_hint`/`region_hint`; one `discovery_requests` row with counts +
   `status=needs_review`; **0 Firecrawl / 0 Claude**.
4. Include a query likely to hit an already-registered URL → confirm it lands `duplicate`.
5. Approve 1–5 rows, copy into Workflow 04 (≤5), confirm normal processing + `url_registry` dedup on re-run.
6. Record the Apify cost for the request.

## 12. Telegram-ready (future, not now)

The schema is built so a future Telegram Control Bot is a thin interface over `discovery_requests` +
`url_candidates` + Workflow 04 (see Strategy §). The bot **must not** duplicate scraping/analyzer logic.

## 13. Not building yet

Planning only. Build is gated on: operator approval of `discovery_requests` (18) + `url_candidates` (25)
schemas, obtaining an Apify API token, and creating the n8n Header Auth credential. SerpAPI / Google CSE
fallbacks and Firecrawl `/v2/search` (parked) and the Telegram bot remain deferred.

---

## 14. Stage 2 quick review result (2026-06-07)

Reviewed (not patched) during the Stage 2 final hardening pass — **no bug found, no change needed**:
- No Firecrawl node, no Claude node (only the Apify Google Search `httpRequest`).
- Writes **`url_candidates` = 26 fields** and **`discovery_requests` = 18 fields**; no business-tab writes.
- `candidate_type` classification present; domain extraction present; `duplicate_in_registry` dedup works
  (reads `url_registry`).
- `active=false`. Confirmed in the Stage 2 review: `docs/STAGE_2_WEB_PIPELINE_REVIEW.md` §2/§8 (test T1/T11).
