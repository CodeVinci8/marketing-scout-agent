# Source Lineage Contract (Stage C Closure Patch 3)

This is the canonical, end-to-end lineage contract that makes WF16 `source_health` enforcement **actually
function** in WF10 and WF12. Patch 2 wired the gate logic but the join key and mode fields were never
produced upstream (audit findings B1/C1/C2/D1/D5), so the gate was a no-op on real data. Patch 3 carries the
lineage from the connectors → WF08 → the analyzer queues → WF10 → WF12, and merges it with the WF16
`source_health` verdict in `n8n/lib/report_gate.js` (`rowEligible`).

> An operator who creates the columns below and runs the connectors → WF08 → WF16 → WF10 → WF12 in order gets
> working production gating with **no guessing**. There is no documentation-only claim here: every field is
> produced and consumed by the listed node, proven by `tests/test_lineage_e2e.js` (real node execution).

## Canonical join key

`source_run_id` is the connector run identifier. It is derived with the **same fallback chain WF16 uses** to
key `source_health`, so the join always resolves:

```
source_run_id = record.source_run_id || record.run_id || record.agent_request_id
```

WF16 (`Assemble Run Bundles`) groups `raw_market_records` by exactly this chain and writes
`source_health.source_run_id = <that value>`. WF08 stamps the same value onto every queue row. They match.

## Lineage fields — producer → consumer

| field | type | producer workflow · node (→ tab) | consumer workflow · node | default / legacy-row behaviour |
|---|---|---|---|---|
| `source_run_id` | string | WF09 `Build raw_market_records Rows` (=`cfg.run_id`), WF07 `Dedup Against Registry` (=`agent_request_id`), WF13 `Build raw_market_records Rows` (=`cfg.run_id`) → `raw_market_records`; **WF08 `Build Deterministic Row` + `Merge LLM Enrichment With Deterministic Row`** (= `src.source_run_id‖run_id‖agent_request_id`) → `monitor_queue`/`content_queue`/`review_queue` | WF10 `Aggregate Market Intelligence` (gate + isolation); WF12 `Build Deterministic Report` (`__bodyEligible`); WF16 `Assemble Run Bundles` (keys `source_health`) | empty → treated as **unverified**; row excluded by default unless `allow_unverified_source=true` |
| `data_mode` | `live`\|`fixture`\|`manual_test` | connectors → `raw_market_records` (WF09 `cfg.data_mode`, WF07 `manual_test`, WF13 `cfg.data_mode`); WF08 builders (= `src.data_mode‖cfg.data_mode‖live`) → queues | WF10/WF12 gate (`rowEligible`) | empty → `live` (assumed) by WF08; a non-`live` value excludes the row unless `allow_fixture_report` |
| `quality_status` | `healthy`\|`degraded`\|`quarantined` | WF09 `Normalize Avito Listings` → raw; WF08 builders (worse of `src.quality_status` and the route-derived status) → queues | WF10/WF12 gate | empty → `healthy` |
| `report_eligible` | boolean | WF09 `Normalize Avito Listings` → raw; WF08 builders (`!(quarantined‖pending‖connector-false)` — **decoupled from `data_mode`** so fixture opt-in works) → queues | WF10/WF12 gate | empty → not false (eligible on quality grounds) |
| `review_status` | `confirmed`\|`pending` | WF08 builders (`pending` when `parse_method=deterministic_uncertain_no_llm`) → queues; connectors may set it | WF10/WF12 gate | empty → `confirmed` |
| `quality_flags` | string (`; `-joined) | WF09/WF16 (`stale_source`, `pending_review`, …) | WF10/WF12 gate (stale/pending) | empty |
| `source_run_ids` | string (`, `-joined) | **WF10 `Aggregate Market Intelligence`** → `competitor_profiles`/`market_angles`/`audience_activity_signals` (the contributing eligible runs) | WF12 `Build Deterministic Report` `__bodyEligible` (defensive body gate) | empty → WF12 evaluates the row's own `data_mode`/`report_eligible`; no stamp → unverified |

## Gate semantics (`n8n/lib/report_gate.js` `rowEligible`, embedded verbatim in WF10 & WF12)

A record enters a **production** report only when **affirmatively verified eligible** — *(source_health
matched-and-eligible)* OR *(record self-attests `data_mode=live` + healthy + report-eligible)* OR
*(explicit `allow_fixture_report` opt-in for fixture/manual)*. The **stricter** of record-local lineage and
the matched `source_health` verdict wins. Explicit behaviour for every case:

| case | default result | override |
|---|---|---|
| healthy live run | **included** | — |
| degraded + report-eligible run | **excluded** | `allow_degraded_report=true` → included + visible warning |
| quarantined run | **excluded** | none |
| fixture run | **excluded** | `allow_fixture_report=true` → included + watermark |
| manual_test run | **excluded** | `allow_fixture_report=true` → included + watermark |
| pending review record | **excluded** | none |
| stale source run (`stale_source` flag) | **excluded** | none |
| missing `source_health` row (run unscored) but record self-attests live+healthy | **included** | — |
| missing `source_health` row AND no live/healthy self-attestation | **excluded** (fail closed) | `allow_unverified_source=true` |
| empty `source_health` tab | same as "missing row" per record | `allow_unverified_source=true` |
| missing `source_run_id` / no lineage | **excluded** (fail closed) | `allow_unverified_source=true` |

`allow_unverified_source` defaults **false** in WF10 `Set Aggregator Config` and WF12 `Set Report Config`:
fail-open is never the production default (audit D5). WF12 additionally filters its **body** (top
competitors / angles / audience) by the stamped `source_run_ids`, so the rendered body and the source-quality
section can never contradict each other (audit C1; `body_records_excluded` is reported).
