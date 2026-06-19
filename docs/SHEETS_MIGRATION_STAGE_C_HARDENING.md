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
