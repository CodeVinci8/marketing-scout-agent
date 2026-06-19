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
