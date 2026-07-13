# Stage E — Scoring + Google Sheets Persistence Contract Map (E1)

Canonical map of the Stage-E-relevant tabs: what workflow produces each row, the append/upsert mode, the
unique/dedup key, and which columns carry **owner/run lineage**, **evidence**, **score/confidence**, and
**quality/dedup status**. Source of truth = `config/sheets_contracts.json` (headers + identity_columns) +
`docs/SOURCE_LINEAGE_CONTRACT.md` (the `source_run_id` join + `report_gate.js` eligibility). This map is the
audit baseline for E2 live-row inspection.

Enforced by tests: `test_sheets_contracts` (headers/identity), `test_lineage_contract` + `test_lineage_e2e`
(source_run_id lineage + gate), `test_quality_gate`/`test_report_gate`/`test_wf10_source_health` (scoring/quality
gate), `test_wf04_relevance_score`/`test_wf04_accounting` (relevance scoring), **`test_stage_e_persistence`**
(candidate_sources row shape/score-range/evidence-lineage/dedup — added in E1).

## Canonical join key (lineage)

`source_run_id = record.source_run_id || record.run_id || record.agent_request_id` — same fallback chain WF16
uses to key `source_health`, so the join always resolves. Empty ⇒ treated as **unverified** ⇒ excluded from a
production report unless `allow_unverified_source` / `allow_fixture_report`.

## Tab map (Stage-E-relevant)

| tab | producer(s) | mode · key | owner/run lineage | evidence | score | quality/dedup |
|---|---|---|---|---|---|---|
| `raw_market_records` (68) | WF04/07/09/11/13/14/16/26 | append · `record_id` / `dedup_key` | agent_request_id, source_run_id, workflow_run_id | source_url, post_url, profile_url, exact_evidence_url | confidence_score | dedup_key, dedup_status, quality_status, report_eligible, review_status, quality_flags |
| `competitor_profiles` (20) | WF10 | append · `competitor_id` | source_run_ids | source_urls, evidence_count | source_confidence_score | report_eligible |
| `market_angles` (12) | WF10 | append · `angle_id` | source_run_ids | — | confidence | report_eligible |
| `audience_activity_signals` (17) | WF10 | append · `signal_id` | source_run_ids | source_url | confidence | report_eligible |
| `public_lead_signals` (47) | WF14 | append · `lead_signal_id` | agent_request_id, run_id | source_url, evidence_text, evidence_excerpt, contact_source_url | lead_score, score_band, source_confidence, contact_confidence | freshness_status, review_status, review_priority |
| `review_queue` (54) | WF08 | append · `source_url` | run_id, source_run_id | source_url, profile_url, evidence_completeness_score | lead_signal_score, content_idea_score, quality_score | quality_status, report_eligible, review_status, processing_status |
| `candidate_sources` (33) | **WF27** | append · `candidate_id` (`<discovery_run_id>::<normalized_key>`) | owner_user_id, discovery_run_id, source_run_id | source_url, **provider_result_url**, evidence_url, **evidence_excerpt**, recent_posts_sample | confidence (0–100), relevance_score (0–100) | quality_status (validated/unvalidated), dedup_status, region, already_tracked, status |
| `source_health` (54) | WF10/12/16 | append · `quality_evaluation_id` | source_run_id, agent_request_id | exact_evidence_url_rate | quality_score | quality_status, report_eligible, quality_flags, quality_rule_version |
| `report_bundles` (7) | WF20 | append · `report_id` | owner_user_id, agent_request_id | (structured bundle JSON) | (bundle carries competitors/offers/evidence) | — |
| `execution_summaries` (25) | WF20/25 | append · `agent_request_id` | agent_request_id, owner_user_id | — | — | source_cost_status, llm_cost_status, delivery_status |
| `tracked_sources` (20) | WF22/23 | upsert · `source_id` (owner-scoped) | owner_user_id, agent_request_id | — | — | status, last_status |
| `execution_plans` (21) | WF18/20/22 | upsert · `plan_id` | owner_user_id, agent_request_id, chat_id | — | — | status (terminal-marked by WF20 after delivery) |

## E1 finding + fix

**Gap (fixed in E1):** `candidate_sources` (the discovery persistence layer) was the one Stage-E evidence tab
with no persistence/contract test and it silently omitted 3 of its 33 contract columns —
`provider_result_url` (raw provider provenance), `evidence_excerpt` (the text that justified the classification),
`recent_posts_sample` (TG/VK preview) — so persisted candidate rows carried the verdict but not the evidence.
WF27 now emits all 33 columns; `confidence`/`relevance_score` are clamped to 0–100; validated candidates persist
the scraped page excerpt. `test_stage_e_persistence` executes the real WF27 Finalize node and asserts: exact
contract match (no drift/no missing), scores in range, quality/dedup/region persisted, evidence + owner/run
lineage present on every row, unique owner-scoped `candidate_id`.

## Acceptance status (E1)

| Stage E criterion | status |
|---|---|
| scores in a sane range (0–100), no impossible values | ✅ candidate_sources clamped + tested; core pipeline via relevance/quality tests |
| accepted rows carry `quality_status`; excluded carry reason | ✅ raw/queue via lineage; candidate_sources validated/unvalidated tested |
| dedup keys prevent duplicate persistence, owner-scoped | ✅ candidate_id `<run>::<key>` unique + tested; upsert tabs keyed on plan_id/source_id |
| append/upsert targets correct | ✅ per map; verified against contract writers |
| every persisted row has evidence/source lineage | ✅ **candidate_sources gap fixed in E1**; other tabs covered by lineage tests |
| Google Sheets columns match contracts, no drift | ✅ `test_sheets_contracts` + `test_stage_e_persistence` (candidate_sources) |
| report rows link back to source rows | ✅ `source_run_ids` on profiles/angles/signals; report_bundle carries them |
| owner/chat/request isolation | ✅ owner_user_id on candidate/lead/tracked; report/plan owner-scoped |

## Deferred to E2 (live-row proof, needs bounded live run + real Google Sheets read)

- Inspect real `candidate_sources` rows written by a live WF27 run: confirm the 3 new columns are populated and
  `source_run_id` resolves.
- Inspect real `competitor_profiles` / `report_bundles` rows and confirm report ↔ XLSX ↔ bundle counts agree on
  production data (also closes the deferred pre-Stage-E WF20 report/XLSX live proof).
- Confirm no duplicate persistence across two runs of the same source/owner on production rows.
