# WORKFLOW_02_V2_TEST_RESULTS.md — Prompt v2 Test Results Log

**Workflow:** Workflow 02 — Claude API Single Record Analysis v2
**Baseline:** d350069 raw JSON harness
**Date started:** 2026-06-05
**Model:** claude-sonnet-4-6 via aiprimetech.io

---

## Confirmed Results (Baseline Tests)

Tests 1–7 run on baseline harness. Not all were completed; see notes.

| test_id | Scenario | entity_type | action | quality | lead_signal | comp_strength | content_idea | status | Passed | Notes |
|---------|----------|-------------|--------|---------|-------------|---------------|--------------|--------|--------|-------|
| 1 | Авито сильный лид ПТС | lead_signal | contact | 97 | 98 | — | — | analyzed | ✓ | Baseline confirmed. Quality Gate PASS. Sheets written. |
| 5 | VK контент-идея (orig) | — | — | — | — | — | — | — | ✗ JSON | Original 252-char text broke JSON.parse. |
| 5b | VK контент-идея (short) | _pending_ | _pending_ | _pending_ | — | — | — | — | _pending_ | Shortened to 139 chars. Retest required. |
| 2–4,6,7 | Слабый лид, конкуренты, SEO, рефинансирование | _not run_ | _not run_ | _not run_ | — | — | — | — | _not run_ | Skipped — extended tests 8–12 are the priority. |

---

## Extended Test Results (Tests 8–12)

**Workflow:** `02_claude_api_single_record_v2_extended_tests.json`
**Source:** `modules/marketing-scout-v0/TEST_RECORDS_V2_EXTENDED.md`

Fill this table after running each test. Record API balance before and after.

**API balance before tests 8–12:** $__________

| test_id | Scenario | expected_entity_type | actual_entity_type | expected_action | actual_action | quality_score | lead_signal_score | competitor_strength | content_idea_score | status | passed | notes | google_sheets_written | api_cost_note |
|---------|----------|---------------------|-------------------|----------------|--------------|---------------|-------------------|---------------------|-------------------|--------|--------|-------|-----------------------|---------------|
| 8 | Telegram hot lead Москва | lead_signal | | contact | | | | | | | | | | |
| 9 | Instagram competitor МО | competitor | | monitor | | | | | | | | | | |
| 10 | Avito refinancing МО | lead_signal | | investigate | | | | | | | | | | |
| 11 | Website weak competitor | competitor | | monitor | | | | | | | | | | |
| 12 | Out-of-region SPb lead | lead_signal | | investigate | | | | | | | | | | |

**API balance after tests 8–12:** $__________
**Cost per test (avg):** $__________
**Total for 5 tests:** $__________

---

## Pass/Fail Summary

| test_id | JSON OK | entity correct | action correct | score in range | Quality Gate | Overall |
|---------|---------|---------------|---------------|----------------|--------------|---------|
| 8 | | | | lead_signal≥80 | PASS expected | |
| 9 | | | | comp≥65 | PASS expected | |
| 10 | | | | lead 50–70 | borderline | |
| 11 | | | | comp≤65 | borderline | |
| 12 | | | | lead≤40 | FAIL expected | |

---

## Approval Gate for Closing Workflow 02 v2 Testing

To close this test stage and move to first real source test, all of the following must be true:

- [ ] Test 1 confirmed passed (already done)
- [ ] Test 5 (short) passes JSON parse
- [ ] Tests 8–12: zero JSON parse failures
- [ ] Test 8: lead_signal_score ≥ 80, action = contact
- [ ] Test 9: competitor_strength ≥ 65, action = monitor
- [ ] Test 10: action = investigate (not contact)
- [ ] Test 11: competitor_strength ≤ 65 (not over-scored)
- [ ] Test 12: lead_signal_score ≤ 40 (region cap enforced)
- [ ] Operator explicit approval

At least 4 of 5 extended tests must pass. Test 8 (hot lead) is the highest priority.

---

## Known Limitation: Content Ideas Deferred

`content_idea` records are NOT included in the extended test set and are not production-approved for Workflow 02.

**Reason:** The current Quality Gate (`status=analyzed AND quality_score≥60`) passes content_idea records to Google Sheets. However:
1. The Sheets schema has no dedicated column or review process for content ideas.
2. The operator's current workflow does not include a content review step.
3. content_idea records mixed into the leads/competitors table add noise.

**Deferred to:** Stage 3 — Content Agent (see ROADMAP.md). The Content Agent will use a separate n8n branch, a separate Sheets tab, and a Quality Gate tuned for content value rather than lead/competitor actionability.

---

## v2.1–v2.5 Experiments — Archived

These experiments are not part of the active test path. Documented here for completeness.

| Experiment | Format | Result | Root cause |
|------------|--------|--------|-----------|
| v2.1 | Raw JSON + safety rules | JSON.parse failure | Claude inserts chars in strings |
| v2.2 | Anthropic tool_use | 502 gateway | Gateway does not support tool_use |
| v2.3 | KEY=VALUE 9.2 KB | 502 gateway | Prompt too large |
| v2.4 | KEY=VALUE 5.3 KB | 502 gateway | Still too large |
| v2.5 MICRO | KEY=VALUE ~2 KB | 502 gateway (curl) | Gateway-side issue, not prompt size |

All experiment files are preserved in `n8n/workflows/` for reference.
The working approach is the d350069 raw JSON baseline.
