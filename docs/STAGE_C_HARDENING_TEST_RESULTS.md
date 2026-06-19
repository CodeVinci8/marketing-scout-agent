# Stage C Hardening — Test Results

**Environment:** offline. **External calls: 0. Live cost: $0.** No Claude/Apify/Firecrawl/VK/Telegram calls,
no real credentials, no Spreadsheet IDs, all workflows `active=false`.

## Command

```bash
make test            # == node tests/run_all.js
```

Also runnable individually:
```bash
node tests/test_taxonomy.js
node tests/test_semantic_contract.js
node tests/test_quality_gate.js
node tests/test_wf16_node.js
node tests/test_intake_gates.js
python3 scripts/validate_workflows.py
node n8n/fixtures/lead_scout/run_all.js
```

## Result

```
[PASS]  taxonomy                    passed=96 failed=0
[PASS]  semantic-contract           passed=86 failed=0
[PASS]  quality-gate                passed=31 failed=0
[PASS]  wf16-node                   passed=37 failed=0
[PASS]  intake-gates                passed=55 failed=0
[PASS]  validate_workflows.py       passed=217 failed=0
[PASS]  lead_scout (WF12/13/14)     passed=all (132/132) failed=0
ALL SUITES PASS   (external calls=0, live cost=$0)
```

**Totals:** 305 JS assertions + 217 Python validator checks + 132 legacy lead-scout checks = **654 checks, 0
failures**. **21 workflow JSON files** validated and importable. **12 semantic evidence fixtures**
(`tests/fixtures/semantic_cases.json`) + 3 quality-gate run fixtures.

## What each suite proves

| Suite | Proves |
|---|---|
| `taxonomy` | `semantic_core.TAXONOMY === config/taxonomy.json`; every record_type → valid route + entity; all aliases resolve to canonical sets; `secured_auto_loan→pts_loan`, `return_lease_refinancing→auto_lease_refinance`, `question_objection→audience_question`; unresolved alias surfaces a flag (never silent). |
| `semantic-contract` | The §16 evidence fixtures classify correctly via the **offline** engine: Credéo affiliate→`affiliate_program`/monitor_queue; return-leasing→`educational_offer`/`auto_lease_refinance` (+`pts_loan` secondary); 15M direct offer (conf ≥80, speed=same day); Telegram system event→hard_skip/skipped_log; owned credit-history article→`owned_media_content`; SBP→`payments_regulation`; CBR rate→`central_bank_rate`; credit-secured-by-apartment→`real_estate_secured_loan` (not skipped); scam quote→not an author offer (`quoted_claims` set, report_eligible=false); Avito placeholder→`source_candidate`/detail_fetch_required/no fabricated offer; Avito mortgage listing→`competitor_activity`/monitor_queue (not market_signal); exact post/listing URL preserved on every routed record. |
| `quality-gate` | WF16 scoring: healthy/degraded/quarantined; degraded excluded by default, opt-in adds `report_quality_warning`; search-cards-only & semantic-validation-failure quarantine via critical flags; fixture/manual_test never report-eligible; no-data baseline quarantined (never a trend baseline); unknown cost = `null` not `0`. |
| `wf16-node` | The **real** WF16 nodes run; embedded `computeRunHealth` is byte-equal to `quality_gate.js`; Final Summary reports `external_calls=0`, only the healthy run report-eligible. |
| `intake-gates` | The **real** patched WF08/WF09/WF11 nodes: Avito placeholder/search-card quarantine + query separation; paid Apify gate blocks fixture/no-token/no-budget and never logs the token value; WF11 affiliate subtype + system-event gate (service not from title) + freshness; WF08 declares `llm_primary` + emits the `semantic-v2` evidence-separated prompt + hard-skips system events + guard blocks Claude when `llm_enabled=false`. |
| `validate_workflows.py` | All 21 workflow JSON parse, `active=false`, unique node names, connections reference existing nodes, **no secret/token leakage**, WF16 has the required nodes + no httpRequest, taxonomy internally consistent. |
| `lead_scout` | Pre-existing WF12/13/14 behavior unchanged (132/132) — no regression from the Stage C patch. |

## Notes / limits

- The `llm_primary` Claude prompt is validated by **structure** (evidence separation, enums, schema, guard),
  not by a live Claude response. Operator runs the controlled batch (see retest checklist in
  `STAGE_C_HARDENING_IMPLEMENTATION.md` / final report).
- Live transports (Apify detail, Firecrawl, VK) remain staged/disabled; the regression exercises only
  deterministic Code-node logic and fixtures.

---

## Stage C Closure Patch 2 — offline results (re-run `make test`)

`make test` (offline, $0, **0 external calls**) — all suites PASS:

| suite | checks | what it proves |
|---|---|---|
| `report-gate` | 32 | shared `n8n/lib/report_gate.js`: default exclusion of fixture/manual/quarantined/pending/stale/semantic-failed/degraded; degraded & fixture opt-ins; per-record gate; compatible-baseline selection; trend marker never dangles. |
| `wf04-processed` | 43 | **real** WF04 snapshot node: MKBK brand-preserving fallback, no raw Markdown in the offer field, evidence `page_type`/`service_primary` (Finardi stays `credit_brokerage`), non-fixed confidence, RU phone normalization, cost telemetry `unknown`≠0; Final Summary repair/fallback accounting (repair success distinguished from primary success / repair failure / deterministic fallback; high repair rate surfaced as degraded). |
| `wf05-classify` | 27 | **real** WF05 classify node: cbr.ru→regulator (not a competitor entity), publisher/direct/indirect/source separation, root-domain canonicalization, broad-query vs narrow-focus, non-uniform confidence, Apify cost `unknown`≠0. |
| `wf06-processed` | 23 | **real** WF06 nodes + Sheets update mapping: registry-confirmed candidate persisted as `approval_status=processed`; `selected_count=0`, `registry_recheck_duplicate` counted. |
| `wf07-cost` | 19 | **real** WF07 nodes: actual=0 vs estimated (unique-relevant only), `eligible_unique_for_analysis=10`, `irrelevant_items=2`, `hard_skipped_items=0`, `data_mode=manual_test`; duplicate-repeat estimates 0. |
| `wf09-multiquery` | 22 | **real** WF09 config + normalize + dedup: each declared query builds its own start URL, overall batch limit + per-query allocation, same listing across queries dedupes, query origin auditable; no live actor. |
| `wf10-source-health` | 27 | **real** WF10 aggregate node: run isolation; observed vs inferred split; pending/uncertain exclusion; source_health enforcement (fixture/manual/quarantined/pending/degraded excluded by default, degraded/fixture only via opt-in with warning); **drift proof** node gate == `report_gate.js`. |
| `wf12-closure` | 30 | **real** WF12 report node: no dangling `(x34 =)`; compatible-baseline / `no_compatible_baseline`; `changed_domains=0` neutral action; corrected VK wording; degraded website snapshot excluded; contact counters; watermark; source_health enforcement + **drift proof**. |
| `ci-workflow` | 10 | `.github/workflows/regression.yml` triggers on PR + push:main, pins Node/Python, runs `make test`, uses no secrets, keeps the secret-leak / active-workflow guards. |
| `lead_scout` (WF12/13/14) | 141 | pre-existing behavior unchanged (WF14 + WF12 redaction extended for the new `zero_write_reason` / contact-counter contract). |
| `validate_workflows.py` | 217 | all 21 workflow JSON parse, `active=false`, unique nodes, connections valid, no secret/token leakage, taxonomy consistent. |

**external calls = 0 · live cost = $0 · all workflows `active=false`.** Runtime validation pending operator
import (see `docs/STAGE_C_CLOSURE_PATCH_2.md`).
