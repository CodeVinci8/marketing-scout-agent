# Stage C Defect Ledger Reconciliation — after Closure Patch 3

Status legend: **fixed** = production path corrected AND proven by automated execution of the real node code;
**contained** = bad data is gated/excluded but the root producer is a different workflow; **runtime-only** =
correct in code, still needs a live n8n run to confirm; **partial**; **open**; **operator-error**.
A defect is `fixed` ONLY with execution proof — documentation alone never counts.

> **Ledger scope honesty.** The full "64 recorded product defects + separately tracked operator configuration
> errors" register is **not present in this repository or this conversation**. The authoritative IDs available
> here are those enumerated in the Stage C Closure Patch 2 task brief (§16) plus the Patch-2 adversarial-audit
> findings. IDs outside that set are listed as **`ledger context unavailable`** at the end with the exact
> missing source identified — they are NOT fabricated, merged, or renumbered.

## A. Patch-3 audit findings (the blocking set this patch targets)

| ID | symptom | status | workflow/file · node | automated test | source wf changed? | remaining runtime proof | blocks Stage 3.5? |
|---|---|---|---|---|---|---|---|
| B1 | WF10/WF12 source_health gate inert — no upstream `source_run_id`/mode fields on queue rows | **fixed** | WF09/WF07/WF13 raw builders + `08…json` `Build Deterministic Row`/`Merge LLM Enrichment` (lineage) + `report_gate.js` `rowEligible` | `tests/test_lineage_e2e.js` (WF09→WF08→WF10 quarantine exclusion) | yes (WF07/08/09/13) | live n8n: queue tabs carry the new columns; WF16 join resolves | yes (was) |
| B2 | WF04 repair/fallback counters (`__rr`/`__acct`) dead code | **fixed** | `04…json` `Parse Repaired JSON` (dead `__rr` removed), `Normalize + Route` (outcome counters), `Build competitor_site_snapshots Row` (quality counters) | `tests/test_wf04_accounting.js` (real nodes → Final Summary) | yes (WF04) | live n8n: `$getWorkflowStaticData` persistence across SplitInBatches | no |
| C1(audit) | WF12 "enforcement" metadata-only; body not filtered | **fixed** | `12…json` `Build Deterministic Report` `__bodyEligible` + WF10 lineage stamp | `tests/test_lineage_e2e.js` (WF12 body excludes quarantined run; `body_records_excluded`) | yes (WF10, WF12) | live n8n render | yes (was) |
| C2(audit) | migration doc didn't document the gate's join columns | **fixed** | `docs/SOURCE_LINEAGE_CONTRACT.md`, `docs/SHEETS_MIGRATION_…` §14–§18 (doc) + the WF08 product change it documents | covered by B1 test (the product path); doc is reconciliation only | yes (product = WF08) | operator applies columns | no |
| D1(audit) | tests injected `source_run_id`/`staticData` → false confidence | **fixed** | tests rewritten to production-shaped + real execution | `test_lineage_e2e.js`, `test_wf04_accounting.js` (no injected staticData; old injection test removed) | n/a (tests) | — | no |
| D5(audit) | fail-open was the production default | **fixed** | `report_gate.js` `rowEligible` (fail-closed; `allow_unverified_source` default false in WF10/WF12 configs) | `test_report_gate.js` (missing-lineage excluded; override includes), `test_lineage_e2e.js` matrix | yes (WF10, WF12, lib) | — | yes (was) |

## B. Patch-2 §16 product defects (carried forward; lineage-dependent ones upgraded by Patch 3)

| ID | symptom | status | workflow · node | automated test | source changed? | blocks 3.5? |
|---|---|---|---|---|---|---|
| C1-D1 | WF12 dangling `(x34 =)` trend marker | fixed | WF12 `Build Deterministic Report`; `report_gate.trendMarker/freqSuffix` | `test_wf12_closure.js`, `test_report_gate.js` | yes | no |
| C1-D2 | ambiguous contact counters | fixed | WF12 report node | `test_wf12_closure.js`, lead_scout WF12 redaction | yes | no |
| C1-D3 | outdated VK/MVP wording | fixed | WF12 report node | `test_wf12_closure.js` | yes | no |
| C1-D4 | WF14 empty `zero_write_reason` | fixed | WF14 classify + Final Summary | lead_scout `run_wf14_triage` | yes | no |
| S2-D1 | broad query vs narrow service_focus | fixed | WF05 `Classify Candidates` | `test_wf05_classify.js` | yes | no |
| S2-D2 | regulator/article/competitor separation (cbr.ru) | fixed | WF05 `Classify Candidates` | `test_wf05_classify.js` | yes | no |
| S2-D3 | discovery confidence quality | fixed | WF05 `Classify Candidates` | `test_wf05_classify.js` | yes | no |
| S2-D4 | weak service hint | fixed | WF05 `Classify Candidates` | `test_wf05_classify.js` | yes | no |
| S2-D5 | Apify cost telemetry | fixed | WF05 classify + summary + live_source_runs | `test_wf05_classify.js` | yes | no |
| S2-D6 | root-domain detection | fixed | WF05 `Classify Candidates` (`is_root`/`canonical_url`) | `test_wf05_classify.js` | yes | no |
| S2-D7 | WF04 Final Summary | fixed | WF04 `Final Summary Output` (new node) | `test_wf04_accounting.js` | yes | no |
| S2-D8 | WF04 repair calls/failures distinguishable | **fixed (upgraded)** | WF04 counters now wired (B2) | `test_wf04_accounting.js` | yes | no |
| S2-D9 | high repair rate surfaced as degraded | **fixed (upgraded)** | WF04 Final Summary `repair_rate_pct`/next_action | `test_wf04_accounting.js` | yes | no |
| S2-D10 | MKBK brand/raw-markdown fallback | fixed | WF04 snapshot writer | `test_wf04_processed.js` | yes | no |
| S2-D11 | fixed snapshot confidence (80) | fixed | WF04 snapshot writer | `test_wf04_processed.js` | yes | no |
| S2-D12 | Finardi incorrectly indirect | fixed | WF04 snapshot (brand) / WF05 (class) | `test_wf04_processed.js`, `test_wf05_classify.js` | yes | no |
| S2-D13 | Finardi service too narrow | fixed | WF04 snapshot writer | `test_wf04_processed.js` | yes | no |
| S2-D14 | MKBK/Royal `page_type=other` | fixed | WF04 snapshot writer | `test_wf04_processed.js` | yes | no |
| S2-D15 | phone normalization | fixed | WF04 snapshot writer | `test_wf04_processed.js` | yes | no |
| S2-D16 | completed status hides fallback | **fixed (upgraded)** | WF04 quality_status + counters (B2) | `test_wf04_processed.js`, `test_wf04_accounting.js` | yes | no |
| S2-D17 | WF04 Firecrawl/Claude cost telemetry | fixed | WF04 snapshot + Final Summary (`cost_status=unknown`, null) | `test_wf04_processed.js`, `test_wf04_accounting.js` | yes | no |
| S2-D18 | WF06 status not persisted as processed | fixed | WF06 select node + Sheets update mapping | `test_wf06_processed.js` | yes | no |
| S2-D19 | WF12 changed-domain action when count=0 | fixed | WF12 report node | `test_wf12_closure.js` | yes | no |
| S2-D20 | degraded snapshots in stakeholder report | fixed | WF12 `__snapDegraded` (uses WF04 `quality_status`) | `test_wf12_closure.js` | yes | no |
| S3-D4 | static fixture next_action text | fixed | WF12 report node (no static "12-record"; trend wording) | `test_wf12_closure.js` | yes | no |
| S3-D5 | WF10 run/request isolation | **fixed (end-to-end)** | WF10 `__isoMatch` + lineage join | `test_wf10_source_health.js`, `test_lineage_e2e.js` | yes | no |
| S3-D6 | observed vs inferred mixed | fixed | WF10 `observed_audience_signals`/`inferred_audience_insights` | `test_wf10_source_health.js` | yes | no |
| S3-D7 | no-data baseline marks NEW | fixed | WF12 + `report_gate.selectBaseline` | `test_wf12_closure.js`, `test_report_gate.js` | yes | no |
| S3-D8 | fixture data in stakeholder report | **fixed (end-to-end)** | WF10 gate + WF12 body filter + watermark | `test_lineage_e2e.js`, `test_wf12_closure.js` | yes | no |
| S3-D17 | Claude cost absent/null where usage exists | fixed | WF04 cost telemetry (`unknown`/null) | `test_wf04_accounting.js` | yes | no |
| S3-D18 | WF07 planned vs actual cost | fixed | WF07 Final Summary | `test_wf07_cost.js` | yes | no |
| S3-D19 | irrelevant rows called hard-skipped | fixed | WF07 Final Summary + live_source_runs | `test_wf07_cost.js` | yes | no |
| S3-D21 | WF09 search-card counted relevant | **fixed (direct proof)** | WF09 `Normalize Avito Listings` (search_card quarantine) | `tests/test_wf09_searchcard.js` (real node) | verified, no change needed | no |
| S3-D24 | WF09 declared multi-query not used | fixed | WF09 `Set Avito Connector Config` (per-query start URLs) | `test_wf09_multiquery.js` | yes | no |

## C. Confirmed-cost vs unknown-cost semantics (explicit, per brief)
`actual_*_cost_usd` is `null` with `cost_status=unknown` whenever a paid provider was (or would be) called but
the cost was not recovered into the row — **never coerced to 0**. A genuine no-call path may report `0`.
Proven: `test_wf04_accounting.js` (WF04 `cost_status=unknown`, `actual_*_cost_usd=null`), `test_wf07_cost.js`
(WF07 `actual_analysis_cost_usd=0` for a no-analysis intake vs estimated future cost), `test_wf05_classify.js`
(`apify_cost_status=unknown`, nulls).

## D. `ledger context unavailable`
The following are **not present** in this repo or conversation and are NOT reconstructed here:
- **The full 64-item Stage C product defect register** (only the Patch-2 §16 subset above is authoritative).
  Missing source record: the external acceptance/audit defect register that enumerates all 64 IDs (e.g. the
  pre-Stage-4 external audit spreadsheet referenced by `docs/PRE_STAGE_4_EXTERNAL_AUDIT_BRIEF.md`, which does
  not contain the numbered list in-repo).
- **The separately tracked operator-configuration-error register.** Missing source record: the operator-error
  tracker is not committed to this repo.
- Any `S1-D*` series and the un-enumerated portions of `S2-D*`/`S3-D*` beyond the IDs listed above.

To reconcile these, supply the register file (CSV/MD) and they will be matched 1:1 without renumbering.
