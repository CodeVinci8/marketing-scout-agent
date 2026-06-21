# Stage 3 Closure Report

Status of the Stage 3 runtime-contract closure driven by the live investigation (WF05 `disc_20260620_102308`,
WF06 `approved_run_20260620_103507`, WF04 `firecrawl_20260620_104531`). This report tracks the contract fixes
landed and the items still open.

## Canonical identity & lineage contract (§2.1) — LANDED

Single source of truth: `n8n/lib/lineage.js`.

| Field | Meaning | Join key? |
|-------|---------|-----------|
| `agent_request_id` | the originating request (Telegram/operator), stable across the fan-out | no |
| `source_run_id` | **one per source-connector execution — THE canonical lineage join key** | **yes** |
| `workflow_run_id` | workflow-local execution id; observability only | no |
| `source_record_id` | stable id of one canonical raw record | record-level |
| `analysis_run_id` | one per WF08 analyzer execution | no |
| `aggregation_run_id` | one per WF10 aggregation | no |
| `report_id` | one per WF12 report build | no |
| `data_mode` | `fixture` \| `manual_test` \| `live` — gates report eligibility | filter |

Rules enforced:

- A source connector creates exactly one `source_run_id`; that exact value is used by raw records, snapshots,
  source_health, analyzer outputs, aggregation lineage and reports.
- A workflow-local execution id (e.g. WF04's `wf04_<stamp>`) **never** silently replaces `source_run_id`; it is
  recorded separately as `workflow_run_id`.
- Joins resolve via `lineage.canonicalSourceRunId()` = `source_run_id || run_id (legacy) || agent_request_id`.

### WF04 mismatch (the live blocker) — FIXED

The live run wrote downstream rows with `firecrawl_20260620_104531` but `live_source_runs` with
`wf04_20260620_104531`. `Build live_source_runs Row` had **deliberately rewritten** `firecrawl_*` → `wf04_*`,
so WF16's `source_run_id` join found no matching ledger row → `no_compatible_baseline`.

Now WF04 `live_source_runs` emits `source_run_id = run_id = firecrawl_<stamp>` (canonical, join-safe) and
`workflow_run_id = wf04_<stamp>` (separate). `competitor_site_snapshots` carry the same canonical
`source_run_id` + `workflow_run_id` + `data_mode`. Proven by `tests/test_lineage_contract.js`.

### Ledger honesty (§2.7) — FIXED in WF04 `live_source_runs`

- `approval_token_used = 'not_required'` (WF04 has no paid-approval token gate) — accurate, not a fake `no`.
- `primary_calls` / `repair_calls` separated from run staticData; `external_calls` = Firecrawl calls.
- Unrecovered provider cost ⇒ `source_cost_status`/`llm_cost_status`/`cost_status = unknown`, actual cost
  `null` — never a fake `0`.

## WF16 Sheets-boolean fidelity (§2.3) — LANDED

`Assemble Run Bundles` previously used `is_valid_listing !== false`, which treated the Google Sheets **string**
`'FALSE'` as truthy (structurally valid). It now coerces via an embedded `cbool()` mirroring
`lineage.coerceSheetBool` (drift-proven): explicit `TRUE`/`FALSE`/strings/booleans/empty are all preserved, so a
string-`FALSE` row is correctly scored structurally invalid.

## Website source quality & analysis pipeline (§2.2/§2.3/§2.4/§2.6) — LANDED (commit 2)

Canonical website data now flows **WF04 → `raw_market_records` → WF16 → WF08 (exactly-once)**:

- **WF04 = website source adapter.** A new `Build Canonical Raw Record` node emits **one canonical
  `raw_market_records` row per scraped URL** with full lineage (`agent_request_id`, `source_run_id`,
  `workflow_run_id`, `source_record_id`, `data_mode`), structural/quality fields, `analysis_status='pending'`,
  and WF04's own extraction kept only as **source hints/evidence** (`service_hint`/`competitor_name`/`offer_text`).
  Transport, Firecrawl evidence, cleaning and `competitor_site_snapshots` are preserved.
- **WF08 = single semantic owner.** It consumes the canonical record exactly once. `Filter & Select Records`
  gained `source_run_id_filter`, a **record-level quality gate** (degraded/quarantined/pending never reach
  analysis — mixed runs gate per record, not per run), and **exactly-once idempotency** via a new `analysis_runs`
  ledger (`analysis_idempotency_key = source_run_id::source_record_id`); `force_reprocess=true` overrides.
- **WF16** reads the WF04 canonical rows and evaluates them by `source_run_id` (no `no_compatible_baseline`).

Proven by `tests/test_website_pipeline.js` (36 checks) on the live-shaped run (`firecrawl_20260620_104531`;
CASHMOTOR healthy reaches WF08 once; CarCapital degraded blocked; lineage identical across all three).

## Open items (follow-ups)

- **§2.4 WF08 LLM via runtime guard:** `llm_enabled` is still a node-level kill switch; the production target is
  a runtime guard (approval token + budget) rather than a disabled node. Exactly-once handoff is now done.
- **§2.5 WF10** (`time_window_days` from config, source mix from included rows, agent-request isolation).
- **§2.6 WF12** (live isolation, consistent snapshot/profile quality filtering, enable guarded Claude summary).
- **§2.7 remainder:** WF09 `items_relevant` search-card semantics; WF05 `items_relevant` + real approval/budget
  guard + `approval_token_used` semantics; WF06 root-homepage detection; WF04 full-contact extraction.
- **Phase B (Stage 4 orchestration):** Telegram gateway, request planner, state machine, approval/budget gate,
  source-adapter contract, durable idempotency/outbox, dead-letter, observability — not started.

## Source capability limitations (documented, not "fixed")

- Avito (WF09) frequently returns only search cards, not detail pages; these are quarantined as
  `source_candidate` pending detail enrichment. This is a source limitation, not a pipeline defect.
