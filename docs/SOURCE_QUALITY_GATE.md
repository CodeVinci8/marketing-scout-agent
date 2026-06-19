# WF16 — Source Quality Gate & Health Score

**File:** `n8n/workflows/16_source_quality_gate_health_score.json` · **Engine:** `n8n/lib/quality_gate.js`
(`quality_rule_version: qrule-v1.0`) · **No external API** (no Claude/Apify/Firecrawl/VK).

WF16 evaluates **run-level and source-level health BEFORE report generation** and writes the new
**`source_health`** tab. WF10 and WF12 must consult `source_health.report_eligible` before treating a run as
production intelligence. This is the gate that stops fixture/degraded/quarantined/no-data runs from reaching a
stakeholder report as facts.

## Inputs

`Set WF16 Config` accepts:

| field | default | meaning |
|---|---|---|
| `fixture_self_test` | `true` | run the 3 demo cases offline ($0, no creds). Set `false` for real runs. |
| `source_run_id_filter` / `agent_request_id_filter` | `''` | evaluate one run/request |
| `source_family_filter` / `platform_filter` | `''` | optional narrowing |
| `freshness_window_days` | `30` | staleness window |
| `allow_degraded_report` | `false` | opt-in to admit degraded runs (adds a visible warning) |
| `write_result` | `false` | dry-run by default; `true` appends to `source_health` |

In live mode WF16 reads `live_source_runs` + `raw_market_records` (+ `market_record_registry` and queues),
groups records by `source_run_id`, normalizes each row into a quality descriptor, and scores each run.

## Scoring formula (total 100)

| dimension | weight | basis |
|---|---|---|
| transport_health | 15 | items arrived; transport did not fail |
| structural_validity | 20 | `structurally_valid_rate` |
| semantic_reliability | 25 | low parse-failure / repair / unknown-service / generic-offer / system-event / pending |
| evidence_completeness | 20 | exact-evidence-url rate · (1−placeholder) · (1−missing-description) |
| freshness | 10 | within-window rate |
| observability_cost | 10 | cost recovered or not-applicable; approval gate present |

## Statuses

- **healthy** — `score ≥ 80` and **no critical flag**.
- **degraded** — `50–79` or recoverable problems.
- **quarantined** — `score < 50` **or any critical flag** **or** no-data baseline.

**Critical flags** (force quarantine regardless of score): `semantic_validation_failed`,
`system_event_contamination`, `no_detail_records`, `broken_brand`, `approval_gate_missing`,
`no_compatible_baseline`.

## Eligibility (defaults)

`report_eligible = false` for: fixture / manual_test, pending review, system events, unresolved semantic
validation, raw-markdown fallback, broken brand, Avito search cards without detail, placeholder titles, records
without an exact evidence URL, stale-out-of-window, unknown taxonomy, no-data baseline, quarantined run.
A **live healthy** run is eligible; a **degraded** run is eligible **only** with `allow_degraded_report=true`
and then carries a visible `report_quality_warning`.

`llm_eligible = false` for: duplicates, irrelevant, system events, source candidates without observation, empty
text, search cards lacking detail, placeholder-only content, quarantined runs, or batches with `unique=0`.

## `source_health` columns

`quality_evaluation_id, evaluated_at, source_run_id, agent_request_id, workflow, source_family, platform,
source_key, data_mode, items_received, structurally_valid_items, invalid_items, unique_items, duplicate_items,
hard_skipped_items, irrelevant_items, report_candidate_items, structurally_valid_rate, invalid_rate,
duplicate_rate, hard_skip_rate, irrelevant_rate, unknown_service_rate, generic_offer_rate,
placeholder_title_rate, missing_description_rate, missing_identity_rate, missing_published_at_rate,
exact_evidence_url_rate, primary_parse_failure_rate, repair_rate, fallback_rate, degraded_record_rate,
pending_review_rate, stale_rate, newest_published_at, oldest_published_at, source_staleness_days,
external_calls, llm_calls, actual_source_cost_usd, actual_llm_cost_usd, source_cost_status, llm_cost_status,
cost_per_unique_record, quality_score, quality_status, report_eligible, llm_eligible, quality_flags,
operator_next_action, notes, taxonomy_version, quality_rule_version`.

**Cost is never faked.** Unknown cost is stored as `null` + `cost_status=unknown` (never `0`). A no-call /
fixture run is `0` + `cost_status=not_applicable`.

## Quality flags

`fixture_data, manual_test_data, stale_source, search_cards_only, no_detail_records, placeholder_titles,
missing_seller_identity, missing_descriptions, missing_published_at, missing_exact_evidence_url,
high_unknown_service_rate, high_generic_offer_rate, high_repair_rate, deterministic_fallback,
raw_markdown_fallback, broken_brand, taxonomy_drift, owned_media_misclassification,
system_event_contamination, metadata_contamination, pending_review, semantic_validation_failed, cost_unknown,
approval_gate_missing, no_compatible_baseline, report_quality_warning`.

## Final Summary (§7.6)

WF16 emits per run: `source_run_id, data_mode, quality_score, quality_status, report_eligible, llm_eligible,
quality_flags, key rates, cost status, operator_next_action`, plus `status_counts` and the list of
`report_eligible_runs`. The self-test demonstrates exactly one healthy, one degraded, one quarantined run with
`external_calls=0, llm_calls=0, cost_status=not_applicable`.

## Self-test (offline, $0)

`node tests/test_wf16_node.js` runs the **real** WF16 nodes and asserts the embedded scoring equals
`n8n/lib/quality_gate.js` for the same bundles (drift-proof). Import WF16, keep `fixture_self_test=true`, run,
and read the Final Summary to see the three statuses before pointing it at live data.

---

## Closure Patch 2 — WF10/WF12 now physically enforce source_health

The gate is no longer advisory. `n8n/lib/report_gate.js` (mirrored, drift-proof, inside the WF10
`Aggregate Market Intelligence` and WF12 `Build Deterministic Report` nodes) turns `source_health` rows into
run-level decisions both workflows consume:

- **Excluded by default:** `report_eligible=false`, `quality_status=quarantined`, `data_mode∈{fixture,
  manual_test}`, `review_status=pending` (or `pending_review` flag), `semantic_validation_failed`,
  `stale_source`.
- **Degraded:** excluded unless `allow_degraded_report=true`; when included it carries a visible
  `report_quality_warning`.
- **Fixture/manual_test:** excluded unless `allow_fixture_report=true`; when included WF12 renders the
  `TEST / FIXTURE DATA — NOT PRODUCTION INTELLIGENCE` watermark.
- **Per record:** `review_status=pending` and `parse_method=deterministic_uncertain_no_llm` are dropped so
  they never become confirmed content ideas or market facts.

WF10 nodes: `Set Aggregator Config` (switches) → `Read source_health` → `Aggregate Market Intelligence`
(builds eligibility, run isolation, gate, observed/inferred split). WF12 nodes: `Set Report Config` (switches)
→ `Read source_health` → `Build Deterministic Report` (eligibility, source-quality section, baseline,
watermark). Proven by `tests/test_wf10_source_health.js` and `tests/test_wf12_closure.js` (each asserts the
embedded gate equals `n8n/lib/report_gate.js`).
