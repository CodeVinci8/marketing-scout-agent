# Semantic Taxonomy — Stage C Hardening (`semantic-v2`)

Single machine-readable source of truth: **`config/taxonomy.json`** (`taxonomy_version: semantic-v2.0`).
Runtime engine mirror: **`n8n/lib/semantic_core.js`** (loads the JSON; `tests/test_taxonomy.js` asserts
`semantic_core.TAXONOMY === config/taxonomy.json`, so drift is impossible). Workflow Code nodes embed the
relevant functions because the n8n sandbox cannot `require()` local files; the offline harness runs the **real**
node code (`tests/wf_harness.js`) so the embedded copies cannot silently diverge from the tested library.

> Do **not** redeclare enum lists ad-hoc inside individual workflows. Add to `config/taxonomy.json`.

## Why a central taxonomy (root-cause fix, not keyword crutches)

Before Stage C, each connector (WF09/WF11) and the analyzer (WF08) carried its own private enum lists and
keyword heuristics. The result: `secured_auto_loan` vs `pts_loan` drift (S3-D15), `business_credit` /
`credit_after_refusals` / `mortgage_refinance` collapse (S3-D2), `content_idea` used as a record type (S3-D12),
and hint over-trust (S3-D9). The systemic fix is one versioned taxonomy + one engine that:

1. **classifies semantics from POST/LISTING evidence** (Claude in `llm_primary`, or the offline deterministic
   classifier as the free fixture/fallback path),
2. **normalizes** every value through canonical enums + alias maps (preserving `raw_model_service_type`),
3. **maps** the semantic class to a physical queue deterministically — the model never names a sheet.

## `record_type` (what a record *is*)

`competitor_activity` · `market_signal` · `audience_question` · `audience_objection` · `audience_complaint` ·
`buying_intent` · `lead_signal` · `source_candidate` · `irrelevant` · `system_event` · `unknown`

`content_idea` is **not** a raw record type — it is a downstream entity/candidate type only. The alias map
resolves a stray `content_idea` record_type to `market_signal` and flags `taxonomy_drift`.

## `entity_type`

`competitor` · `market_signal` · `content_idea` · `audience_signal` · `lead` · `source_candidate` ·
`irrelevant` · `system_event` · `unknown`. A `legacy_entity_for_record_type` map preserves backward
compatibility with downstream sheets that still expect the old `{competitor, content_idea, lead_signal,
irrelevant}` set.

## `activity_subtype` (for `competitor_activity`)

`direct_offer` · `owned_media_content` · `affiliate_program` · `product_explainer` · `educational_offer` ·
`client_case` · `price_change` · `service_change` · `channel_profile` · `other`

## `market_signal_subtype`

`central_bank_rate` · `payments_regulation` · `regulation` · `program` · `demand_shift` · `scoring_change` · `other`

## `service` taxonomy

`credit_brokerage` · `credit_after_refusals` · `credit_history_consulting` · `pts_loan` · `secured_financing` ·
`real_estate_secured_loan` · `business_credit` · `mortgage_brokerage` · `mortgage_refinance` · `auto_credit` ·
`auto_lease_refinance` · `debt_refinancing` · `debt_consolidation` · `bankruptcy_advisory` ·
`business_credit_rehabilitation` · `credit_legal_consulting` · `consumer_credit` · `bank_guarantee` · `unknown`

Use `service_primary` + `service_secondary[]`. Do not overload a single `service_hint` with product + pain +
mentioned future product. Separate fields: `company_type`, `pain_tags`, `content_topics`, `audience_segments`,
`collateral_types`, `mentioned_products`.

### Alias compatibility (selected)

| Legacy / model value | Canonical |
|---|---|
| `secured_auto_loan`, `auto_collateral_loan`, `loan_against_vehicle`, `займ под авто`, `займ под ПТС` | `pts_loan` |
| `return_lease_refinancing`, `sale_leaseback_refinancing`, `рефинансирование возвратного лизинга` | `auto_lease_refinance` |
| `secured_real_estate_loan`, `залог недвижимости` | `real_estate_secured_loan` |
| `credit_broker`, `generic_lending`, `kreditnyy_broker` | `credit_brokerage` |
| `mortgage_adjacent`, `ipoteka` | `mortgage_brokerage` |
| `refinancing`, `credit_refinancing` | `debt_refinancing` |
| `question_objection` | `audience_question` |
| `content_idea` (as record_type) | `market_signal` (+ `taxonomy_drift` flag) |

An **unresolved** value is never silently discarded: `normalizeService` returns
`{normalized_service_type:'unknown', raw_model_service_type:<original>, unresolved:true}` and the validator
raises a `taxonomy_drift` flag plus a confidence cap (≤50).

## Route mapper (deterministic; the model never names a sheet)

| record_type | route |
|---|---|
| competitor_activity | monitor_queue |
| market_signal | content_queue |
| audience_question / audience_objection / audience_complaint | review_queue |
| buying_intent | review_queue |
| lead_signal | results (→ review_queue if no usable public contact) |
| source_candidate | review_queue (report_eligible=false) |
| irrelevant / system_event | skipped_log |
| unknown | review_queue (report_eligible=false) |

## Explainable confidence (`§6`)

Confidence reflects **evidence**, not the execution branch. Positive factors (complete text, exact evidence
URL, brand mention, direct-offer language, explicit CTA/amount, owned domain, seller identity, consistent
service) raise the score; hard caps bound it: placeholder title ≤20, missing description ≤45, source-metadata
only ≤30, query-prior only ≤20, deterministic fallback ≤40, raw-markdown fallback ≤25, unresolved alias ≤50.
Every record carries `confidence_score` + `confidence_reasons` + `evidence_completeness_score`.

## `semantic-v2` output schema (Claude `llm_primary`)

See `docs/STAGE_C_HARDENING_IMPLEMENTATION.md` §WF08. Strict enums, no prose, evidence quotes for important
facts, `null` instead of invention, quoted/negated scam claims marked, system events hard-skipped before LLM.
