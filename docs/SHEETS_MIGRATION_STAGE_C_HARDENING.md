# Google Sheets Migration — Stage C Hardening

This migration is **additive and backward-compatible**. No existing column is renamed, reordered, or removed.
n8n Google Sheets `append` matches by header name, so new columns can be added to the right of existing ones
without breaking current workflows. **No automatic schema mutation is assumed** — the operator adds headers
manually (one row edit per tab). Legacy rows keep empty cells; defaults below apply when a workflow reads them.

> Safety: do this on the working spreadsheet only after a copy/snapshot. Rollback = delete the added columns
> (no existing data is touched).

## 1. NEW TAB: `source_health` (WF16)

Create a new tab named exactly `source_health` with this header row (see `docs/SOURCE_QUALITY_GATE.md` for the
full column list). No backfill required — WF16 populates it going forward. Manual action: **create tab + header
row**.

## 2. `raw_market_records`

Existing contract preserved. Recommended additive columns:

| column | default for legacy rows | written by |
|---|---|---|
| `data_mode` | `live` (assume historical live) | WF09/WF11/WF13 |
| `source_run_id` | copy of `run_id`/`agent_request_id` | connectors |
| `quality_status` | `healthy` | connectors (`degraded`/`quarantined` for search cards) |
| `report_eligible` | empty → evaluated by WF16 | connectors |
| `llm_eligible` | `true` | connectors |
| `quality_flags` | empty | connectors |
| `placeholder_title` | `false` | WF09 |
| `detail_fetch_required` / `detail_fetch_status` | `false` / `not_required` | WF09 |
| `is_detail` | `true` (legacy assumed detail) | WF09 |
| `search_query` | copy of `query` if it is a phrase, else empty | WF09 |
| `source_search_url` | empty | WF09 |
| `exact_evidence_url` | copy of `post_url`/`source_url` | WF09/WF11 |
| `activity_subtype` | empty | WF11/WF08 |
| `skip_reason` | empty | WF11 |
| `age_days` / `freshness_bucket` / `within_default_window` | empty | WF11 |
| `taxonomy_version` | `semantic-v1` | connectors (`semantic-v2.0` going forward) |

> The connectors already emit the new fields; the only operator action is **adding the headers** so the values
> land in named columns instead of being dropped.

## 3. Analyzer output tabs (`monitor_queue`, `content_queue`, `review_queue`, `results`, `skipped_log`)

Additive columns for the `semantic-v2` contract (WF08 `llm_primary`):

| column | default | notes |
|---|---|---|
| `schema_version` | `semantic-v1` | `semantic-v2` going forward |
| `record_type` | derived from legacy `entity_type` | canonical class |
| `activity_subtype` | empty | competitor sub-class |
| `service_primary` / `service_secondary` | `service_type` / empty | canonical service |
| `raw_model_service_type` / `normalized_service_type` | empty | audit of alias resolution |
| `candidate_entity_type` / `review_status` | empty / `confirmed` | pending-review isolation (§2.4) |
| `report_eligible` / `llm_eligible` | evaluated by WF16 | gating |
| `confidence_reasons` / `evidence_completeness_score` | empty | explainable confidence |
| `quoted_claims` / `negated_claims` | empty | negation/quotation safety |
| `taxonomy_version` | `semantic-v1` | `semantic-v2.0` going forward |

**Pending-review isolation:** rows with `review_status=pending` or
`parse_method=deterministic_uncertain_no_llm` keep `entity_type=unknown`, `candidate_entity_type=<guess>`,
`report_eligible=false`. WF10/WF12 must exclude them by default.

## 4. `live_source_runs` (cost & observability, §12)

Additive columns: `actual_source_cost_usd`, `actual_llm_cost_usd`, `estimated_future_analysis_cost_usd`,
`cost_status` (`known|estimated|unknown|not_applicable`), `source_cost_status`, `llm_cost_status`,
`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `primary_calls`, `repair_calls`,
`cost_per_unique_record`, `data_mode`, `approval_token_used` (`yes|no`, never the value).
Default for legacy rows: cost columns empty + `cost_status=unknown` (NOT `0`).

## 5. Backfill strategy

None required. New columns default to empty; the reading workflows apply the documented defaults. Optional
one-time backfill: set `data_mode=live` and `taxonomy_version=semantic-v1` on historical rows so WF16 reports
them with explicit provenance. This is optional and safe.

## 6. Rollback

Delete the added columns and the `source_health` tab. No existing column or value is modified by this
migration, so rollback is lossless.

---

# Closure Patch 2 (additive — same rules: append columns to the right, never reorder)

> Header order matters only **within** a tab for the n8n Google Sheets node that uses `defineBelow` mapping by
> header name; appending to the right is safe. Create the `source_health` tab first (§1 above) — WF10 and WF12
> now **read** it. All new columns default empty/`unknown` for legacy rows; the reading workflows apply the
> documented defaults. Rollback = delete the added columns (lossless).

## 7. WF10/WF12 source_health enforcement — required reads
WF10 (`Read source_health`) and WF12 (`Read source_health`) both read the **`source_health`** tab. No new
columns are required on `source_health` beyond the WF16 schema (`docs/SOURCE_QUALITY_GATE.md`); ensure the tab
exists. WF10/WF12 config switches (in the `Set …Config` node, not Sheets): `enforce_source_health=true`,
`require_source_health=false`, `allow_degraded_report=false`, `allow_fixture_report=false`,
WF12 `report_data_mode=live`.

## 8. `competitor_site_snapshots` (WF04) — additive columns
| column | default for legacy rows | written by |
|---|---|---|
| `brand_source` (`analysis\|title\|domain\|none`) | `analysis` | WF04 |
| `broken_brand` | `false` | WF04 |
| `service_primary` / `service_secondary` | empty (derive from `service_types`) | WF04 |
| `offer_text_raw_audit` | empty | WF04 (raw Markdown audit only) |
| `contact_public_raw_audit` | empty | WF04 |
| `quality_status` / `report_eligible` / `fallback_reason` | `healthy` / `true` / empty | WF04 |
| `parse_method` / `repair_used` | empty / `false` | WF04 |
| `primary_calls` / `repair_calls` / `firecrawl_calls` / `claude_calls` | empty | WF04 |
| `input_tokens` / `output_tokens` | empty | WF04 |
| `actual_source_cost_usd` / `actual_llm_cost_usd` / `cost_status` | empty / empty / `unknown` | WF04 |

`source_confidence` is now evidence-based (was a fixed `80`); `page_type` may now be `home`/`services`/`offer`/
`prices`/`about`/`contact`/`other`.

## 9. `url_candidates` (WF05) — additive columns
`requested_search_scope`, `canonical_url`, `is_root`, `competitor_class`
(`direct\|indirect\|regulator\|publisher\|source_candidate\|irrelevant`), `is_competitor_entity`,
`service_primary`, `service_secondary`. Legacy rows: empty. cbr.ru-style regulator/article rows now carry
`is_competitor_entity=false` and must **not** be promoted to competitor entities.

## 10. `discovery_requests` (WF05) — additive columns
`requested_search_scope`, `service_primary`, `service_secondary`, `query_terms`, `direct_competitor_count`,
`regulator_count`, `publisher_count`, `source_candidate_count`, `estimated_apify_cost_usd`,
`actual_apify_cost_usd`, `apify_cost_status` (`unknown` for legacy/non-recovered).

## 11. WF07 / WF14 — additive columns
- WF07 summary + `live_source_runs`: `data_mode=manual_test`, `audit_rows_written`,
  `eligible_unique_for_analysis`, `irrelevant_items`, `hard_skipped_items` (now `0` for stored irrelevant),
  `actual_analysis_cost_usd`, `estimated_future_analysis_cost_usd`, `cost_status`.
- WF14 `public_lead_signals`/summary: `zero_write_reason` is now `not_applicable` on a successful write (never
  an empty string) and an explicit enum (`all_eligible_already_exist`, `no_eligible_records`, …) on zero
  writes. No schema change required — only the value semantics changed.

## 12. `market_intelligence_reports` (WF12) — additive columns
`trend_status` (`baseline_selected\|no_compatible_baseline`), `source_runs_evaluated`, `source_runs_included`,
`source_runs_excluded`, `report_contains_degraded_data`, `report_contains_fixture_data`,
`report_contains_contacts` (always `false`), `contacts_detected`, `contacts_redacted`,
`contacts_excluded_from_report`, `quality_warning`, `website_snapshots_excluded`, `is_fixture_report`.

## 13. Operator actions (order)
1. Create `source_health` tab (if not already present).
2. Append the columns in §8–§12 to the right of each tab's existing header row.
3. Import updated workflows (all `active=false`), then run the retest sequence in
   `docs/STAGE_C_CLOSURE_PATCH_2.md`.

---

# Closure Patch 3 (lineage contract — makes source_health enforcement functional)

Patch 2 wired the WF10/WF12 gate but the join key + mode fields were never produced upstream, so the gate did
nothing on real data. Patch 3 produces and consumes the lineage end-to-end. Full field/producer/consumer
table: `docs/SOURCE_LINEAGE_CONTRACT.md`. Additive only; legacy rows keep the documented defaults.

## 14. `raw_market_records` — lineage columns (producers: WF07/WF09/WF13)
Add (right of existing): `source_run_id`, `data_mode` (`live|fixture|manual_test`), `quality_status`
(`healthy|degraded|quarantined`), `report_eligible` (bool), `review_status` (`confirmed|pending`),
`quality_flags`. Legacy default: `source_run_id`←`run_id|agent_request_id` at read time; `data_mode=live`;
`quality_status=healthy`; `report_eligible` blank→eligible; `review_status=confirmed`.

## 15. `monitor_queue` / `content_queue` / `review_queue` — lineage columns (producer: WF08)
Add: `source_run_id`, `data_mode`, `quality_status`, `report_eligible`, `review_status`, `quality_flags`.
WF08 writes these on BOTH the deterministic (`Build Deterministic Row`) and LLM (`Merge LLM Enrichment With
Deterministic Row`) paths with identical derivation. **Without these columns WF10's run-level source_health
gate cannot match and (production fail-closed) the rows are excluded as unverified** — so this column add is
required for WF10/WF12 to render any live data after Patch 3.

## 16. `competitor_profiles` / `market_angles` / `audience_activity_signals` — WF10 lineage stamp
Add: `source_run_ids` (comma-joined contributing runs), `data_mode`, `report_eligible`. Producer: WF10
`Aggregate Market Intelligence`. Consumer: WF12 `Build Deterministic Report` (`__bodyEligible`). Legacy rows
(no stamp) are treated as unverified by WF12 and excluded unless `allow_unverified_source=true`.

## 17. `market_intelligence_reports` (WF12) — add `body_records_excluded`
Count of WF10-derived body rows dropped by the defensive gate (keeps body/section consistent).

## 18. Operator order (Patch 3)
1. Add columns §14–§17. 2. Re-run connectors (WF07/WF09/WF13) so `raw_market_records` carry lineage.
3. Run WF08 (queues now carry lineage). 4. Run WF16 (writes `source_health`). 5. Run WF10 then WF12.
Rollback: delete the added columns; the gate then fails closed (excludes unverified) — set
`allow_unverified_source=true` on WF10/WF12 only for a non-production bring-up run.

## 19. Runtime Patch 4 — `raw_market_records` §13 observability columns (producer: WF09 `Build raw_market_records Rows`)
Add (append-only; `Append raw_market_records` is `autoMapInputData`, so the tab must hold these headers):
`llm_eligible`, `placeholder_title`, `detail_fetch_required`, `detail_fetch_status`, `is_detail`,
`search_query`, `source_search_url`, `exact_evidence_url` (BOOLEAN — exact evidence requires DETAIL content,
not a listing-shaped URL), `activity_subtype`, `skip_reason`. `quality_flags` is now populated by WF09 (was
empty). **Without these, WF16 cannot classify a non-detail search card and wrongly scores the run healthy.**

## 20. Runtime Patch 4 — `live_source_runs` identity + cost columns (producer: WF09 `Build live_source_runs Row`)
- `run_id` now = the connector execution id (e.g. `avito_20260620_055017`), **not** `agent_request_id`.
- Add: `source_run_id` (= `run_id`), `agent_request_id` (preserved), `actual_source_cost_usd` (null when not
  recovered), `source_cost_status`, `actual_llm_cost_usd`, `llm_cost_status`, `cost_status`.
- `approval_token_used` is taken from the live safety gate (`yes` only when it validated the token; the token
  value is never stored). When `external_calls>0` and provider cost was not recovered: cost statuses =
  `unknown`, actual cost = `null` (never `0`/`not_applicable`).
- **WF16 joins `live_source_runs` to `raw_market_records` on this `run_id`** (legacy fallback: match
  `agent_request_id`). The pre-patch `run_id=agent_request_id` broke that join → blank workflow/platform/family.

## 21. Operator order (Patch 4)
1. Add columns §19–§20. 2. Re-run WF09 (live) → raw rows + `live_source_runs` row now carry the corrected
identity/observability. 3. Run WF16 → a search-card-only run is `quarantined` (`search_cards_only`/`no_detail_records`
critical), `report_eligible=false`, `llm_eligible=false`, `duplicate_items`/metadata correct. No WF10/WF12 change.
