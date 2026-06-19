# Stage C Closure Patch 2 — Implementation

**Status:** BUILT + offline-validated. **External calls: 0. Live cost: $0.** All workflows `active=false`.
**Operator runtime retest required** before Stage C / MVP close (see "Runtime retest order" below).

This patch finishes the Stage C work the previous hardening patch (DEC-142) left partial, merged-only,
documented-only, or not physically wired into its source workflows. It does **not** redesign that foundation
(`config/taxonomy.json`, `n8n/lib/semantic_core.js`, `n8n/lib/quality_gate.js`, WF16, WF08 `llm_primary`).

## What this patch adds

### Shared runtime
- **`n8n/lib/report_gate.js`** — pure, deterministic ($0) source-health gate consumed by WF10 + WF12. Turns
  WF16 `source_health` rows into run-level eligibility decisions: a run is **excluded by default** when
  `report_eligible=false`, `quality_status=quarantined`, `data_mode∈{fixture,manual_test}`,
  `review_status=pending`, `semantic_validation_failed`, or `stale_source`. **Degraded** runs are excluded
  unless `allow_degraded_report=true` (then a visible warning is attached). **Fixture/manual_test** runs are
  excluded unless `allow_fixture_report=true` (then a TEST/FIXTURE watermark is rendered). Also provides
  `rowEligible` (per-record: drops `review_status=pending` and `parse_method=deterministic_uncertain_no_llm`),
  `selectBaseline` (compatible trend baseline → `no_compatible_baseline` when none), and `trendMarker`/
  `freqSuffix` (never emit a dangling `(x34 =)`).
- WF10 and WF12 **embed a mirror** of `report_gate.js`; the offline harness runs the real node code and
  asserts it equals the library (drift-proof, like WF16).

### WF16 enforcement physically wired into WF10 and WF12 (the headline item)
- **WF10** (`Aggregate Market Intelligence`): added a `Read source_health` node + config switches, builds the
  eligibility index, applies **strict run isolation** (`source_run_id`, `agent_request_id`, `data_mode`,
  `report_eligible`, `quality_status`, `review_status` filters) **before** aggregation, and drops rows whose
  source run is not report-eligible / whose record is pending-review or LLM-uncertain. Adds
  `observed_audience_signals` (observed counters only) vs `inferred_audience_insights` (no-LLM inferences).
- **WF12** (`Build Deterministic Report`): added a `Read source_health` node + config switches, enforces the
  same gate, renders a **source-quality section**, a **watermark** for fixture reports and a **quality
  warning** for opted-in degraded data, and reports `source_runs_included/excluded`,
  `report_contains_degraded_data`, `report_contains_contacts=false`.

## Direct source-workflow corrections (by workflow)

- **WF04** — new `Final Summary Output` node (run-level totals + repair/fallback accounting via staticData);
  parse nodes count primary/repair calls + parse success/failure; rebuilt `competitor_site_snapshots` writer:
  brand preserved from title/domain (never "Конкурент без бренда" when evidence exists), evidence-based
  `page_type` (no false `other`), canonical `service_primary`/`service_secondary` (Finardi stays
  `credit_brokerage`), evidence-based `source_confidence` (no fixed 80), RU phone normalization, raw Markdown
  kept only in an audit field, `quality_status`/`report_eligible`/`fallback_reason`, and explicit cost
  telemetry (`cost_status=unknown` ≠ 0, `actual_*_cost_usd=null`, `primary_calls`/`repair_calls`).
- **WF05** — `Classify Candidates` now separates **direct / indirect / regulator / publisher / source
  candidate / irrelevant** (cbr.ru → regulator, not a competitor entity), canonical service hints, broad-query
  vs narrow-focus representation (`requested_search_scope`, `service_primary/secondary`, `query_terms`),
  root-domain detection + URL canonicalization (`is_root`, `canonical_url`), non-uniform confidence, and Apify
  cost telemetry (`apify_cost_status=unknown`). Discovery summary + live_source_runs persist the new fields.
- **WF06** — registry-confirmed candidates now carry `approval_status=processed` in the actual node payload
  (`processed_update_payload`), and the Sheets update node maps `approval_status` from the node (not a detached
  literal). Summary surfaces `registry_recheck_duplicate` + `confirm_processed_count`.
- **WF07** — separated `actual_analysis_cost_usd` (0) vs `estimated_future_analysis_cost_usd` (unique-relevant
  only), `eligible_unique_for_analysis`, `irrelevant_items`, `hard_skipped_items=0`, `audit_rows_written`;
  `data_mode=manual_test` set explicitly (also in live_source_runs, so WF16 detects it); live_source_runs no
  longer mislabels stored irrelevant rows as `hard_skipped`.
- **WF09** — declared `search_queries` now build one Avito search **start URL per query** with an overall batch
  limit + per-query allocation; cross-query results dedupe on canonical listing id while preserving the
  originating `search_query`/`source_search_url`.
- **WF14** — successful writes set `zero_write_reason=not_applicable` (never an ambiguous empty string);
  zero-write runs use the explicit enum (`all_eligible_already_exist`, …); `outreach=false` + redaction
  preserved.

## Tests
Extended the existing offline harness (no coverage removed). New suites under `tests/` exercise the **real
extracted node code** (or inspect the actual workflow nodes), plus a `report_gate` unit suite and a CI
structural suite. See `docs/STAGE_C_HARDENING_TEST_RESULTS.md`.

## CI
`.github/workflows/regression.yml` runs `make test` on `pull_request` and `push:main` with stable Node 20 /
Python 3.12, **no repository secrets, no external calls**; it fails on workflow JSON errors, taxonomy drift,
secret-leak patterns, regression failures, or any committed `active=true` workflow.

## Runtime retest order (operator)
1. Apply the Sheets migration (`docs/SHEETS_MIGRATION_STAGE_C_HARDENING.md` §"Closure Patch 2"): create/extend
   columns; create the `source_health` tab if not already present.
2. Import the updated workflow JSON (WF04–WF12, WF14) into n8n; keep all `active=false`.
3. Run **WF16** (self-test path) → confirm it writes `source_health` rows.
4. Run a connector in fixture mode (WF09 fixture / WF07 manual) → WF16 → confirm health rows.
5. Run **WF10** → confirm fixture/manual/quarantined/pending/degraded runs are excluded; healthy included.
6. Run **WF12** → confirm the source-quality section, no dangling trend marker, contact counters, watermark on
   an explicit fixture report.
7. Spot-check WF04 snapshots (brand/page_type/service/confidence/phone), WF05 classification (cbr.ru regulator),
   WF06 processed persistence, WF14 `zero_write_reason`.

## Risks / not proven offline
- Google Sheets header order and the new columns are validated only in code; real n8n import + a live append
  are required to confirm the Sheets nodes map the new fields.
- WF04 repair accounting depends on n8n `$getWorkflowStaticData` persistence across SplitInBatches iterations;
  proven in the offline harness, must be confirmed in a real run.
- No live transport (Apify/Firecrawl/Claude/VK/Telegram) was exercised; all paid paths remain gated/off.
