# WORKFLOW_05_URL_DISCOVERY_PLAN.md — 05 - URL Candidates Manual Intake (Planning)

**Status:** 📋 PLANNING ONLY — **not building yet.** No workflow JSON, no Firecrawl, no Claude, no schedule.
**Date:** 2026-06-08
**Stage:** 2.2a (Manual Candidate Intake, Option A — first step of the selected hybrid A+B+D, DEC-058)
**Related:** `docs/URL_DISCOVERY_STRATEGY.md`, `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md`, `docs/TABLE_SCHEMA.md`, DEC-055/056/057/058

---

## 1. Purpose

`05 - URL Candidates Manual Intake` takes **manually provided candidate URLs** (and the query that
produced them), normalizes them, checks `url_registry`, classifies duplicates, estimates cost, and writes
rows to a new **`url_candidates`** sheet with `approval_status=new`. This is **candidate collection +
dedup classification only** — no page analysis.

Approved candidates feed Workflow 04 **later**: manually for now (operator copies ≤5 approved URLs into
Workflow 04's `Set URL List`); a future **Stage 2.2c Approved Candidates Runner** may automate the
hand-off in **batches of 5**. Neither is built yet.

**Workflow name:** `05 - URL Candidates Manual Intake`
**Does NOT:** call Firecrawl, call Claude, scrape, analyze pages, schedule, or auto-process.

## 2. Sheet schema — `url_candidates` (25 columns)

Separate from the 6 business tabs (35 cols) and `url_registry` (10 cols). Header, in order. The first
five columns are **request-level grouping fields** (shared by every candidate from one operator request)
so future summaries and the Telegram bot can group/report per request:

| # | Column | Type | Description |
|---|--------|------|-------------|
| 1 | `candidate_id` | string | stable id, e.g. `cand_YYYYMMDD_HHmmss_<index>` |
| 2 | `discovery_request_id` | string | groups all candidates from one request, e.g. `disc_YYYYMMDD_HHmmss` |
| 3 | `created_at` | string | ISO 8601 intake time |
| 4 | `requested_by` | string | `manual` / `operator` / `telegram_operator` / `system` |
| 5 | `requested_limit` | integer | default candidate count for the request (usually 10) |
| 6 | `query` | string | original topic/query (e.g. «займ под залог ПТС Москва») |
| 7 | `source` | string | one of the `source` values (below) |
| 8 | `candidate_url` | string | raw URL as provided |
| 9 | `normalized_source_url` | string | normalized key (same rules as Workflow 04) — matches `url_registry` |
| 10 | `title` | string | optional page/result title (blank for manual) |
| 11 | `snippet` | string | optional result snippet (blank for manual) |
| 12 | `domain` | string | host of the normalized URL |
| 13 | `rank` | integer | position in the source result list (manual = paste order) |
| 14 | `region_hint` | string | e.g. `Москва` / `MSK` / blank |
| 15 | `service_hint` | string | e.g. `pts_loan` / `secured_auto_loan` / `secured_real_estate_loan` / blank |
| 16 | `confidence_score` | integer | 1–100 heuristic relevance (deterministic, no model) |
| 17 | `dedup_status` | string | `unique` / `duplicate_in_batch` / `duplicate_in_registry` |
| 18 | `registry_status` | string | `not_in_registry` / `in_registry` |
| 19 | `approval_status` | string | `new` / `approved` / `rejected` / `processed` / `duplicate` / `error` |
| 20 | `approved_by` | string | operator id/name (blank until approved) |
| 21 | `approved_at` | string | ISO 8601 (blank until approved) |
| 22 | `rejection_reason` | string | free text (blank unless rejected) |
| 23 | `estimated_firecrawl_credits` | integer | estimate if processed (0 for duplicates) |
| 24 | `estimated_claude_cost_usd` | number | estimate if processed (0 for duplicates) |
| 25 | `notes` | string | free text |

**`approval_status` values:** `new` (default), `approved`, `rejected`, `processed`, `duplicate`, `error`.
**`requested_by` values:** `manual`, `operator`, `telegram_operator`, `system`.
**`source` values:** `manual`, `search_api`, `apify_search`, `serp_actor`, `telegram_operator`, `unknown`.
**`dedup_status` values:** `unique`, `duplicate_in_batch` (repeated within the same intake), `duplicate_in_registry` (already in `url_registry`).
**`registry_status` values:** `not_in_registry`, `in_registry`.

## 3. Manual intake workflow (proposed structure)

```
Manual Start
  → Set Candidate URLs + Query   (operator pastes URLs + query; source=manual, requested_by=operator,
                                  discovery_request_id=disc_<ts>, requested_limit=10)
  → Normalize Candidate URLs     (same normalizer as Workflow 04 → normalized_source_url)
  → Check url_registry           (Google Sheets read on url_registry, by normalized_source_url)
  → Build Candidate Rows         (dedup_status, registry_status, confidence_score, estimates,
                                  approval_status = new, or duplicate if a dup)
  → Append url_candidates        (Google Sheets append, Mapping=Automatically, Sheet=url_candidates name)
```

No Firecrawl node, no Claude node, no schedule trigger, no auto-processing.

**Row defaults:** `approval_status=new` for unique not-in-registry candidates; **`approval_status=duplicate`**
when `dedup_status` is `duplicate_in_batch` or `duplicate_in_registry`. All candidates in one run share the
same `discovery_request_id`, `requested_by`, `requested_limit`, and `query`.

## 4. Normalization rules (reuse Workflow 04)

Identical to `Normalize URL for Dedup` so `url_candidates.normalized_source_url` matches
`url_registry.normalized_source_url` exactly:
- lowercase **scheme and host only** (preserve path/case where meaningful);
- drop `#fragment`;
- drop tracking params: `utm_source/medium/campaign/term/content`, `fbclid`, `gclid`, `yclid`;
- preserve meaningful query params and the path;
- strip trailing slash on **non-root** paths; normalize root consistently;
- **full URL with path, never reduced to domain.** Root variants dedup; distinct service paths do not.

## 5. `url_registry` lookup

`Registry Lookup` reads `url_registry` (read-only — Workflow 05 never writes `url_registry`). For each
candidate:
- if `normalized_source_url` ∈ `url_registry` → `registry_status=in_registry`, `dedup_status=duplicate_in_registry`,
  `approval_status=duplicate`, estimates 0 (already processed; no need to re-spend).
- if repeated within the same intake → `dedup_status=duplicate_in_batch`, `approval_status=duplicate`.
- else → `registry_status=not_in_registry`, `dedup_status=unique`, `approval_status=new`.

## 6. Approval flow (human gate)

- New unique candidates land as `approval_status=new`.
- **Operator manually reviews** and sets `approval_status=approved` (filling `approved_by`/`approved_at`)
  or `rejected` (filling `rejection_reason`).
- Only `approved` rows are eligible to feed Workflow 04. **For now the hand-off is manual** (operator
  copies approved URLs into Workflow 04's `Set URL List`, ≤5 at a time). A future **Stage 2.2c Approved
  Candidates Runner** may pick approved candidates and call Workflow 04 in **batches of 5** — **not built yet**.
- **Default volumes:** a request collects up to **10** candidates (`requested_limit=10`); Workflow 04 still
  processes **≤5 per run**, so 10 approved candidates run as **two batches of 5**.
- When a candidate has been processed by Workflow 04, its row may be marked `processed` (manual or future runner).

## 7. Cost estimation (before any processing)

- **Manual intake itself costs 0** Firecrawl / 0 Claude (no scraping/analysis).
- Per unique, not-in-registry candidate the estimate columns show what processing *would* cost:
  - `estimated_firecrawl_credits` = 1 per candidate.
  - `estimated_claude_cost_usd` ≈ $0.01–0.023 per candidate (see `docs/COSTS_AND_LIMITS.md`; repair adds a second call only on parse failure).
  - Duplicates (registry or batch) = 0 / 0.
- Operator sees the **total estimate** for `approval_status in (new, approved)` before approving, so
  spend is decided **before** Workflow 04 runs.

## 8. Hard limits

- **Default 10 candidates per request** (`requested_limit=10`); **hard cap 20 candidate URLs per intake**.
- No Firecrawl, no Claude (intake is classification only).
- No schedule / no auto-trigger.
- No automatic processing — **human approval required** before Workflow 04.
- Workflow 04's own limits stay (≤5 URLs per processing run; 10 approved → two batches of 5).

## 9. Test plan (when built — not now)

1. Create `url_candidates` sheet with the 25-column header.
2. Paste ~5 candidate URLs incl.: one already in `url_registry`, one duplicated within the paste, and
   2–3 fresh ones; set `query` and `source=manual`.
3. Run once. Verify: each row has correct `normalized_source_url` (matches registry format),
   `dedup_status`/`registry_status`/`approval_status`, `domain`, deterministic `confidence_score`, and
   non-zero estimates only for unique not-in-registry rows.
4. Confirm **0 Firecrawl / 0 Claude** spend.
5. Manually approve 1–2 rows, then copy them into Workflow 04 (≤5) and confirm normal processing +
   that re-running the same URLs in Workflow 04 dedups via `url_registry`.

## 10. Not building yet

This is **planning only**. Build is gated on: operator approval of this schema (G1), then a decision to
start Option A (manual intake). Search/API discovery (Option B), Firecrawl `/v2/search` (Option C), and
the Telegram Control Bot (Option D / Stage 2.3) are **deferred**.
