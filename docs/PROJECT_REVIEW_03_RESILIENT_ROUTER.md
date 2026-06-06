# PROJECT_REVIEW_03_RESILIENT_ROUTER.md — Full Project Review

**Date:** 2026-06-06
**Reviewer:** project-engineer agent
**Type:** REVIEW ONLY — no code, workflow, or file changes made during this review.
**Trigger:** Resilient Router (dynamic-sheet) Tests A–E passed. Gate review before the first scraper.
**Active workflow under review:** `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`

---

## 1. Executive Summary

The Resilient Output Layer is working. The dynamic-sheet resilient router passed Tests A–E: hot lead → `results` (A), weak lead → `review_queue` (B, after the DEC-036 routing-priority fix), competitor → `monitor_queue` (C), forced-Markdown → repair → `results` (D), unrepairable → `technical_errors` (E). The two-pass architecture (Primary → Parse → conditional Repair → Parse → Normalize+Route → one dynamic Google Sheets node) is structurally sound, has explicit readable connections, route validation, enum normalization, and a competitor `company_name` fallback. Run cost for A–E was ~$0.075.

The core AI loop is **proven for single, hand-fed records**. It is **not yet wired to any real source**, and the active workflow is still a **test harness** — it writes 16 test-only columns (`test_id`, `expected_*`, `actual_*`, `test_pass_basic`, `test_notes`) into the same tabs alongside the 25 business + 6 technical columns. That is correct for testing but must not ship to production.

**Verdict:** Architecture is GO. First scraper is **conditional GO after hardening** — specifically, a production workflow that drops the test columns, plus a schema doc that documents the real 31-column production header. Recommended first source: **Firecrawl on one public competitor website** (lowest risk, already validated by Test C's record shape).

---

## 2. What Is Approved Now

| Item | Status | Evidence |
|------|--------|----------|
| Two-pass resilient output architecture | ✅ Approved | Tests A–E pass |
| Dynamic-sheet routing (`Sheet Name = {{ $json.route }}`) | ✅ Approved | A–E routed to correct tabs |
| Route validation (invalid → technical_errors) | ✅ Approved | Present in `Normalize + Route` (`validRoutes`) |
| `recommended_action` enum guard | ✅ Approved | `validActions` whitelist in Normalize |
| `service_type` enum normalization (DEC-036) | ✅ Approved | Test D `"займ под залог ПТС"` → `pts_loan` |
| `company_name` competitor fallback (DEC-036) | ✅ Approved | Test C empty → descriptive label |
| Routing priority: weak lead before content_queue (DEC-036) | ✅ Approved | Test B → review_queue |
| Repair Formatter (no re-analysis, no invented facts) | ✅ Approved | Test D; repair prompt asserts "Do not add new facts / invent / Extract only" |
| `technical_errors` path + `needs_manual_review` | ✅ Approved | Test E |
| Single-record Claude analysis (Russian secured-lending domain) | ✅ Approved | Tests 1, 8, A, C |
| Google Sheets append (Service Account) | ✅ Approved | Workflow 01 + A–E |

---

## 3. What Is NOT Approved Yet

- **Production resilient Workflow 02** — the resilient layer lives only in a test harness; production `02_claude_api_single_record_analysis.json` is still the old single-step v1.
- **Any real-source ingestion** — no scraper is connected.
- **Multi-item / batch processing** — A–E are single-record runs only.
- **`content_idea` handling** — deferred to Stage 3 (DEC-030); `content_queue` exists but content review process does not.
- **Writing test-harness columns to production sheets** — must be stripped first.
- **Automatic workflow activation** — `active=false` everywhere by policy; not approved to activate.

---

## 4. Blockers Before First Scraper

1. **Production workflow without test columns.** Create a production resilient Workflow 02 (or branch) whose `Normalize + Route` emits only the 25 business + 6 technical fields — no `test_id/expected_*/actual_*/test_pass_basic/test_notes`. Test harness stays separate.
2. **Schema doc drift (`TABLE_SCHEMA.md`).** It documents only the 25 core columns and does not list the 6 technical columns or the 6 tabs. The operator needs the exact production header (31 columns) and all six tab names to build the sheets correctly. Must be reconciled before the operator creates production tabs.
3. **All six tabs must pre-exist.** The dynamic Google Sheets node does not create missing tabs; a missing tab = run error. Operator must create `results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors` with the correct header row before any real run.
4. **Firecrawl credential + free-tier limits recorded** in `COSTS_AND_LIMITS.md` before the first paid scrape (DEC-021 gate).

---

## 5. Important Fixes Before First Scraper

| # | Fix | Why |
|---|-----|-----|
| 1 | Drop test-harness fields in the production Normalize node | 16 noise columns pollute business tabs |
| 2 | Reconcile `raw_response_preview` length | Code truncates at **1200** chars; `WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` §7 says **300**. Pick one (recommend 500) and align code + docs |
| 3 | Add a dedup key | Real scrapes will re-encounter URLs; without `source_url + parsed_at` (or hash) dedup, tabs accumulate duplicate rows |
| 4 | Add error handling on the append node | If a tab is missing or Sheets API errors, decide: route to `technical_errors` vs. hard fail. Currently a missing tab hard-fails the run |
| 5 | Document the production column header in `TABLE_SCHEMA.md` | Operator-facing source of truth (blocker #2) |
| 6 | Confirm Test B live retest is logged | Context reports B now passes live with `parse_method=primary_json`, `lead≈38`; record this as the final A–E state |

---

## 6. Nice-to-Have Fixes

- **Pre-filter node** before the primary Claude call to drop obvious junk (< 40 chars, pure boilerplate) and save API cost.
- **Repair-skip for `mock_unrepairable`** — Test E still fires a real (ignored) repair call (~$0.001). Add an IF before `Claude Repair API Request` for the mock, or accept the trivial cost (DEC-034 already accepts it).
- **Move archived experiment workflows** to `n8n/workflows/archive/` instead of deleting, to declutter the active directory.
- **Consolidate `PROMPTS.md`** with the `AGENT_CAPABILITIES.md` prompt section (possible overlap).
- **`content_idea` routing decision** — confirm whether `content_queue` is wanted now or should route to `skipped_log` until Stage 3.

---

## 7. Cleanup Candidates (NO deletion in this review)

| File | Classification |
|------|---------------|
| `02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json` | **keep active** (current candidate) |
| `02_claude_api_single_record_v2_baseline_raw_json.json` | **keep reference** (d350069 working baseline) |
| `02_claude_api_single_record_v2_extended_tests.json` | **keep historical evidence** (Tests 8–12) |
| `00_healthcheck_manual_test.json` | **keep active** (baseline, do not touch) |
| `01_google_sheets_append_row_test.json` | **keep active** (baseline, do not touch) |
| `02_claude_api_single_record_analysis.json` | **keep active** (production v1, do not touch until migrated) |
| `02_claude_api_single_record_v2_resilient_router_test_fixed.json` | **delete after final smoke test** (Switch v1; keep as six-IF fallback source until production migration done) |
| `02_claude_api_single_record_v2_resilient_router_test.json` | **delete after final smoke test** (Switch v3; superseded) |
| Module/docs deferred (PROMPT_V2_PLAN, SYSTEM_PROMPT, TEST_DATA, MILESTONE_REVIEW_02) | **delete later / deferred** (see PROJECT_CLEANUP_AUDIT.md) |

> Deletion remains blocked until the production migration is done and a final smoke test passes — keep the Switch-based copies as fallback until then. Full plan: `docs/PROJECT_CLEANUP_AUDIT.md` → "Cleanup Phase 2".

---

## 8. Security / Operations Review

| Check | Result |
|-------|--------|
| No API keys / bearer tokens in repo | ✅ Pass (secrets scan clean) |
| No real Spreadsheet ID in workflow JSON | ✅ Pass (`PASTE_SPREADSHEET_ID_HERE` only, 1 occurrence) |
| Credentials by name reference only | ✅ Pass (`PASTE_CREDENTIAL_ID_HERE` ×3; names `Claude API - Marketing Scout`, `Google Sheets - Marketing Scout Service Account`) |
| `active=false` | ✅ Pass |
| No `tool_use` / `tool_choice` / `tools` | ✅ Pass |
| No KEY=VALUE line protocol | ✅ Pass |
| Deployment docs correct | ✅ Pass (`N8N_DEPLOYMENT.md`: localhost bind, SSH tunnel, pruning) |
| Disk constraint documented | ✅ Pass (~86% used, ~1.4G free; upgrade before high-volume — DEC-013) |
| No dangerous prune without approval | ✅ Pass (NEXT_ACTIONS warns against `docker system prune` without approval) |

**Operational note:** before real scraping, revisit disk headroom — n8n execution data + scraped payloads will grow. Pruning is configured (168h / 1000 executions) but high-volume runs need the VPS disk upgrade flagged in DEC-013.

---

## 9. Readiness for First Scraper

| Source | Ready? | Assessment |
|--------|--------|-----------|
| Controlled manual source (paste 1 record) | ✅ Now | Already how A–E run |
| **Firecrawl single competitor website** | ✅ After hardening | **Recommended first.** One URL, clean text output, low anti-bot risk, deterministic, Test C already validated the competitor-website record shape → `monitor_queue` path proven |
| Apify / Avito | ⚠️ Later | Higher cost, anti-bot, ToS risk, multi-item — needs dedup + batch handling first |
| Telegram source | ⚠️ Later | Auth + channel access complexity; better once batch + dedup exist |
| Instagram source | ⛔ Last | Heaviest anti-bot / ToS exposure; defer until pipeline is mature |

**Recommendation:** First scraper = **Firecrawl on one public competitor secured-lending page**, feeding the production resilient Workflow 02. It exercises the full chain (scrape → clean text → primary analysis → route → Sheets) on real data with minimal risk and known cost, and it lands in the already-validated `monitor_queue` path.

---

## 10. Exact Recommended Next Prompt (Implementation Phase)

> **Title:** Build production resilient Workflow 02 (no test fields) + Firecrawl single-URL scraper.
>
> Tasks:
> 1. Create `n8n/workflows/03_firecrawl_single_url_resilient.json` (new file; do not modify production v1 or the test harness).
> 2. Front the resilient layer with: Manual Trigger → Set URL → Firecrawl HTTP Request → Extract clean text → Build Primary Claude Request (reuse the test harness's primary prompt verbatim) → existing two-pass parse/repair → `Normalize + Route` **stripped of all test-harness fields** (emit only the 25 business + 6 technical columns) → one dynamic Google Sheets node (`Sheet Name = {{ $json.route }}`).
> 3. Reconcile `raw_response_preview` truncation to a single value (recommend 500) in code and `WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`.
> 4. Add a dedup key field (`dedup_key = source_url + '|' + parsed_at`) to Normalize output.
> 5. Keep `active=false`, credentials by name only, `PASTE_SPREADSHEET_ID_HERE`, no secrets, no tool_use, no KEY=VALUE.
> 6. Update `TABLE_SCHEMA.md` with the production 31-column header and the six tab names.
> 7. Validate JSON with `python3 -m json.tool`.

---

## 11. Exact Recommended Smoke Tests (After Implementation)

1. **Dry record (no scrape):** inject one known competitor record via Set node → expect `route=monitor_queue`, `parse_method=primary_json`, no test columns written.
2. **Live Firecrawl, one real competitor URL** → expect clean text extracted, primary parse OK, row in `monitor_queue`, `processing_status=parsed_success`.
3. **Forced bad input** (truncate scraped text to garbage) → expect repair branch or `technical_errors`, `needs_manual_review=true`.
4. **Re-run the same URL** → expect dedup key present (and, once dedup logic is added, no duplicate row).
5. **Cost check:** record balance before/after; confirm per-URL cost ≈ baseline + repair-if-triggered; log in `COSTS_AND_LIMITS.md`.
6. **Tab safety:** temporarily test a record with an unexpected route value → expect forced `technical_errors`, not a crash.

---

## 12. Final Recommendation

**GO for the first scraper — conditional on completing the Section 4 blockers and Section 5 important fixes.**

The resilient architecture is validated and safe. The remaining work is not architectural — it is productionization: strip test fields, document the production schema, pre-create tabs, and add dedup. Once those are done, proceed with **Firecrawl on a single competitor website** as the first real source.

**No-go conditions:** do not connect a real source while the only resilient workflow is the test harness (test columns would pollute production tabs), and do not start paid Avito/Apify/Instagram scraping before the Firecrawl single-URL chain is proven and dedup exists.
