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
**Status:** Tests run. Two passed strongly. Three failed with output-contract errors.

| test_id | Scenario | expected_entity_type | result | failure_mode | notes |
|---------|----------|---------------------|--------|-------------|-------|
| 8 | Telegram hot lead Москва | lead_signal | **PASS** | — | Passed strongly. Reasoning correct, JSON valid. |
| 9 | Instagram competitor МО | competitor | **FAIL** | No `text` item in response — thinking-only or empty content array | Output contract failure. Not a business skip. |
| 10 | Avito refinancing МО | lead_signal | **FAIL** | Markdown analysis block returned instead of JSON | Output contract failure. Reasoning appears correct. |
| 11 | Website weak competitor | competitor | **FAIL** | Markdown analysis block returned instead of JSON | Output contract failure. Reasoning appears correct. |
| 12 | Out-of-region SPb lead | lead_signal | **FAIL** | Invalid JSON — malformed structure | Output contract failure. Not a business skip. |

**Test 5:** Unstable. Original 252-char text produced JSON.parse failure. Shortened version not yet re-run.

**Key finding:** Tests 9–12 are **not business skips**. Claude reasoned about the records (evidence: Markdown analysis present in 10, 11). The failures are at the serialization layer — Claude produced human-readable output where machine-parseable JSON was required. The prompt cannot reliably prevent this on non-standard inputs.

---

## Pass/Fail Summary (Updated 2026-06-06)

| test_id | Business logic | JSON OK | Overall | Root cause |
|---------|---------------|---------|---------|-----------|
| 1 | ✓ correct | ✓ | **PASS** | Hot lead, straightforward input |
| 8 | ✓ correct | ✓ | **PASS** | Hot lead, Telegram format — similar to Test 1 |
| 9 | probably correct | ✗ no text item | **FAIL** | Output contract — empty/thinking-only response |
| 10 | probably correct | ✗ Markdown | **FAIL** | Output contract — model chose prose over JSON |
| 11 | probably correct | ✗ Markdown | **FAIL** | Output contract — weak signal → prose analysis |
| 12 | probably correct | ✗ invalid JSON | **FAIL** | Output contract — edge case formatting error |
| 5 | probably correct | ✗ JSON.parse | **FAIL** | Output contract — content field with special chars |

---

## Diagnosis: Output Contract Instability

The failure pattern is consistent across Tests 5, 9, 10, 11, 12:
- Failures occur on **ambiguous**, **edge-case**, or **non-standard** inputs.
- Hot leads with clear signals (Tests 1, 8) pass reliably.
- Failures are not business logic errors — the model reasons correctly but serializes incorrectly.
- Five prompt format experiments (v2.0–v2.5) did not solve this at the prompt level.

**Conclusion:** The current single-step output architecture requires a repair layer and multi-tab routing.
See: `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` — DEC-033.

---

## Approval Gate — Revised

The original approval gate (4 of 5 extended tests pass) cannot be met with the current single-step architecture.

**New gate (Resilient Output Layer):**

- [ ] Resilient Output Layer implemented in TEST HARNESS (per `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`)
- [ ] Test A passes: hot lead → `results` tab, `parse_method=json_primary`
- [ ] Test B passes: weak lead → `review_queue` tab
- [ ] Test C passes: competitor → `monitor_queue` tab
- [ ] Test D passes: forced Markdown input → Repair Formatter → repaired JSON routed correctly
- [ ] Test E passes: malformed input → `technical_errors` tab
- [ ] Tests 9–12 re-run on Resilient Output Layer: at least 3 of 4 route correctly (repair or primary)
- [ ] Operator explicit approval

This supersedes the previous 5-test binary pass/fail gate.

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
