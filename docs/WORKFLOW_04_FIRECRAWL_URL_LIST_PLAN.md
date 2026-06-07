# WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md — Firecrawl URL List Mini-Batch

**Status:** ✅ BUILD COMPLETED, dedup VALIDATED on **3-URL and 5-URL** runs + **manual E2E with Workflow 05**, **APPROVED for manual ≤5-URL mini-batch** (2026-06-08, DEC-053/054/062) — `n8n/workflows/04_firecrawl_url_list_resilient.json`. active=false. Larger automation (schedule / crawl / batch / search / >5 URLs / discovery / Telegram) **still blocked.**

> **service_type patch (DEC-062):** after the E2E test (`carcapital.ru/` came back `generic_lending`), the `Normalize + Route` override now lets a **root homepage** receive a specific `service_type` when content is overwhelmingly PTS/auto-focused (deterministic signal counts), while genuine multi-product roots stay `generic_lending`. No dedup/architecture change; 35/10 field counts unchanged.
**Guide:** `docs/N8N_WORKFLOW_04_FIRECRAWL_URL_LIST_RU.md`
**Date:** 2026-06-08
**Related:** Workflow 03 (`03_firecrawl_single_url_resilient.json`), DEC-039–052, `docs/FIRECRAWL_SETUP.md`, `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`

---

## SELECTED ARCHITECTURE — `url_registry` dedup (DEC-051)

- **Dedup uses a dedicated `url_registry` tab**, keyed by `normalized_source_url`, checked **before** Firecrawl/Claude.
- **Six-tab lookup REJECTED as too fragile** (the first build's 4×`Dedup Lookup` chain). One registry tab is cleaner, cheaper, and future-proof for the Telegram Bot / URL Discovery agent.
- Duplicates (and `force_reprocess=false`) → `skipped_log`/`dedup_source_url`, **0 cost**.
- Every non-duplicate processing attempt (including `technical_errors`) appends a row to `url_registry`.
- `force_reprocess` (default `false`) reserved for future/manual override.
- **Deterministic competitor fallback (DEC-052):** after primary+repair both fail to yield JSON, if ≥5 competitor signals over `text_context`+raw preview → `monitor_queue` row (`deterministic_competitor_fallback`); else `technical_errors`.
- `text_context` cap lowered to **3500** + markdown cleaning (drop images/svg, commercially-relevant lines first).
- **VALIDATED (2026-06-08, DEC-053):** Run 1 (empty registry) processed 3 URLs → all `monitor_queue`; Run 2 (same 3 URLs) → all `skipped_log`/`dedup_source_url`, 0 Firecrawl/Claude. `url_registry` dedup confirmed. Output quality hardened: URL/path service-type override + Russian output-language guard. **Mini-batch manual mode APPROVED**; larger automation still blocked.
- **Dedup source of truth = `url_registry`.** Business rows created before the registry existed are not deduped unless backfilled; backfill is optional future maintenance.
- **5-URL validation PASSED (2026-06-08, DEC-054, run `firecrawl_20260607_100715`):** 2 duplicates → `skipped_log` (0 cost), 1 placeholder → `skipped_log`, 2 competitors → `monitor_queue`. Claude Δ $0.0429, Firecrawl ~3 credits (non-duplicates only).
- **Minor hardening applied (DEC-054):** (1) placeholder/parking pre-filter in `Normalize Firecrawl Output` (`parse_method=firecrawl_placeholder_prefilter`) skips parked pages **before** Claude; (2) stronger PTS/path `service_type` override (`pledge-pts`/`zalog-pts`/`залог птс` → `pts_loan`); (3) primary-lane node positions lifted (y=140) for readability. No logic/dedup/architecture change.

---

## BUILD SUMMARY (2026-06-08)

- **25 nodes.** Manual Start → Set URL List → Loop Over Items (Split In Batches) → Normalize URL for Dedup → 4× Dedup Lookup (results/review_queue/monitor_queue/content_queue) → Evaluate Dedup → IF Duplicate? → [dup → Append] / [new → Build Firecrawl Request → Firecrawl Scrape API → Normalize Firecrawl Output → IF Firecrawl Normalized OK? → resilient analyzer → Normalize + Route] → Append → back to Loop.
- **Schema = 35 fields** (33 + `run_id` + `batch_index`) on every output path (verified by simulation).
- **Hard cap 5 URLs** in `Set URL List`; placeholders only (`example.com`).
- **Dedup status: IMPLEMENTED (best-effort).** Google Sheets `read` lookups filter `source_url` (`filtersUI`) against `results/review_queue/monitor_queue/content_queue`; `Evaluate Dedup` aggregates via `$('node').all()`. `alwaysOutputData=true` + `onError=continueRegularOutput` on each lookup. If a given n8n build rejects the lookup config on import, the guide documents a fallback (whole-tab read + compare, or temporary dedup bypass). Duplicate → `skipped_log`, `parse_method=dedup_source_url`, **no Firecrawl/Claude cost**.
- **Credentials by name** only (placeholder IDs); operator must rebind after import (DEC-046).
- `active=false`. No schedule, no crawl/batch/search, no MCP/CLI. JSON validated.

---

## 1. Purpose

Process a **small, manually provided list of 3–5 competitor URLs** in **one manual run**, reusing the
proven Workflow 03 chain (Firecrawl scrape → normalize → resilient analyzer → dynamic Sheets routing).

This is the smallest safe step up from single-URL: it tests **iteration + per-URL failure isolation +
cost-per-URL** before any real batch/crawl/schedule is ever considered.

**It is NOT** a crawler, NOT a scheduled job, NOT a large batch. Max 5 URLs, manual trigger only.

---

## 2. Architecture (proposed)

```
Manual Start
  → Set URL List              (3–5 competitor URLs, the only place the operator edits)
  → Split In Batches / Loop Over Items   (batchSize = 1, iterate one URL at a time)
      → Build Firecrawl Request          (per URL)
      → Firecrawl Scrape API             (onError = continue → failure isolated to that URL)
      → Normalize Firecrawl Output       (success → source record; failure/empty → technical_errors row)
      → IF Firecrawl Normalized OK?       (OK → analyzer; failure → straight to Append)
          → Build Primary Claude Request → Claude Primary → Parse Primary
            → IF Primary Parse OK? → (ok) Normalize + Route
                                    (fail) Build Repair → Claude Repair → Parse Repaired → Normalize + Route
      → Append to Dynamic Route Sheet     (Sheet Name = {{ $json.route }})
  ← loop back for the next URL
```

**Reuse:** the analyzer + normalize + routing nodes are identical to Workflow 03 (including the
post-repair business-consistency hardening, DEC-043/044). The only new structure is the
**list input + per-item loop**.

**Loop node choice:** prefer `Split In Batches` (a.k.a. Loop Over Items) with `batchSize = 1` so each URL
is fully processed (scrape → analyze → append) before the next, keeping memory low and failures isolated.

---

## 3. Hard limits (must be enforced in the build)

- **Max 5 URLs.** `Set URL List` validation rejects / truncates anything beyond 5 (a Code node should
  cap the list to the first 5 and log the rest as ignored).
- **Manual trigger only.** No Schedule Trigger node. `active = false`.
- **No crawl.** Single `POST /v2/scrape` per URL — never `/v2/crawl`, `/v2/batch/scrape`, `/v2/search`.
- **`text_context` capped at 6000 chars** before Claude (DEC-042), per URL.
- **Continue on individual URL failure** — `Firecrawl Scrape API` keeps `onError=continueRegularOutput`;
  a failed/empty URL produces a 33-field `technical_errors` row (DEC-041) and the loop continues.
- **No secrets in JSON** — placeholders + credential-by-name only (DEC-046 rebinding still applies).

---

## 4. Deduplication (first-class requirement)

Multiple runs over overlapping lists will create duplicate rows. For Workflow 04, dedup is a
**first-class requirement**, not an afterthought. Options (recommend one at build time):

1. **Google Sheets lookup by `source_url` before append** (recommended for v0.1): before the Append,
   read the target tab and skip the URL if `source_url` already exists. Simple, no schema change.
   Cost: one extra Sheets read per URL.
2. **Dedup within the run only:** de-duplicate the input URL list (and resolved `source_url`) so the same
   page is not scraped twice in one run. Cheap; does not catch cross-run duplicates.
3. **Dedicated `dedup_key` column later:** add a hash/normalized-URL column (requires a documented schema
   + 34-column header change). Deferred — only if (1) proves insufficient.

**Recommendation:** implement (2) always (free, in-run), and (1) as the cross-run guard. Document the
choice in the build session. `source_url` remains the v0.1 dedup key (DEC-037).

---

## 5. Cost tracking

- Record **Firecrawl credits before/after** the run (1 credit per `/v2/scrape` observed in Workflow 03).
- Record **Claude balance before/after** (today + total deltas).
- Compute **per-URL cost** = total delta ÷ number of URLs actually analyzed.
- Expect homepages to cost more and trigger the paid repair pass more often than specific service pages
  (see `docs/COSTS_AND_LIMITS.md`). Prefer specific service pages in the first list.
- Pre-run balance buffer: ≥ $0.20 recommended for a 5-URL run with repair headroom.

---

## 6. Expected outputs

| Page type | Expected route |
|-----------|----------------|
| Active competitor (offer/rates/region/contact) | `monitor_queue` |
| Broken / empty / Firecrawl error | `technical_errors` (no Claude call) |
| Hot lead page (rare for competitor lists) | `results` |
| Weak/ambiguous signal | `review_queue` |
| Irrelevant / boilerplate | `skipped_log` |

Per-URL `processing_status`, `parse_method`, `repair_used` are written so the operator can see which URLs
needed repair.

---

## 7. Test plan

1. **3 URLs first** (mix: 1 homepage + 2 specific service pages, all known competitors). Verify each
   lands in the expected tab; confirm a deliberate broken URL → `technical_errors` and the loop continues.
2. If stable, **5 URLs**. Confirm the >5 cap rejects extras.
3. Re-run the same list once to verify the **dedup** guard prevents duplicate rows.
4. Record Firecrawl credits + Claude deltas; update `docs/COSTS_AND_LIMITS.md`.

---

## 8. Out of scope (still blocked)

- Whole-site crawl, batch scrape over large lists, scheduled scraping.
- Avito / Telegram / Instagram real ingestion.
- Firecrawl MCP/CLI.
- Automated lead outreach.

---

## 9. Build gate — ✅ CLEARED & BUILT (2026-06-08)

Built `n8n/workflows/04_firecrawl_url_list_resilient.json` + guide `docs/N8N_WORKFLOW_04_FIRECRAWL_URL_LIST_RU.md`,
reusing Workflow 03's analyzer nodes verbatim and adding the list input, Split-In-Batches loop, dedup guard,
and `run_id`/`batch_index`. **Next gate:** operator runs the 3-URL manual test before any 5-URL run.
