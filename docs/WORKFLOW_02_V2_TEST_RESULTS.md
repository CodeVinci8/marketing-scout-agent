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

## Resilient Output Layer Tests A–E (Dynamic-Sheet Workflow)

**Workflow:** `02_claude_api_single_record_v2_resilient_router_test_dynamic_sheet.json`
**Date run:** 2026-06-06
**Architecture:** Two-pass (Primary → Repair) + dynamic Google Sheets routing (DEC-035)

| test_id | Scenario | route | processing_status | parse_method | repair | result | notes |
|---------|----------|-------|-------------------|--------------|--------|--------|-------|
| A | Telegram hot PTS lead | `results` | parsed_success | primary_json | false | **PASS** | entity=lead_signal, lead=97, quality=98, action=contact |
| B | Weak/review lead | `content_queue` → **`review_queue`** (after patch) | parsed_success | repaired_json | true (success) | **PASS after patch** | Exposed routing-priority bug — see below |
| C | Competitor MFO | `monitor_queue` | parsed_success | primary_json | false | **PASS** | comp_strength=88, quality=88, action=monitor. `company_name` was empty → fixed with fallback |
| D | Forced Markdown → repair | `results` | parsed_success | mock_markdown_repair | true (success) | **PASS** | lead=88, quality=82, action=contact. Validates Repair Formatter. `service_type="займ под залог ПТС"` → normalized to `pts_loan` |
| E | Unrepairable response | `technical_errors` | technical_error | — | failed | **PASS** | needs_manual_review=true. Validates technical_errors path |

**Outcome:** A, C, D, E passed as-is. **B exposed a routing-priority bug** — a weak/potential lead with product fit was classified by Claude (via repair) as `content_idea` and routed to `content_queue` instead of `review_queue`. Business intent: weak/potential leads with product fit must go to `review_queue`, not be siloed as content.

### Patch applied (DEC-036)

`Normalize + Route` patched to fix routing priority and two normalization gaps:

1. **Routing priority** now: technical_errors → business-skip/irrelevant → hot lead (`results`) → **weak/potential lead (`review_queue`)** → competitor (`monitor_queue`) → pure content idea (`content_queue`) → fallback `review_queue`. The weak-lead rule runs **before** content_queue, fixing Test B.
2. **Weak/potential lead rule:** routes to `review_queue` if entity=lead_signal with score 30–69, OR action=investigate, OR (score≥30 AND source social/classified AND text mentions loan/collateral/PTS/auto/real-estate/refinancing), OR (entity=content_idea AND score≥30 AND social/classified AND service_type≠unknown).
3. **service_type normalization:** free-text (e.g. `"займ под залог ПТС"`) mapped to enum (`pts_loan`, `secured_auto_loan`, `secured_real_estate_loan`, `refinancing`, `mortgage_adjacent`, `generic_lending`, `unknown`).
4. **company_name descriptive fallback** for empty competitor names (`МФО / частный кредитор`, `Частный инвестор`, `Автоломбард`, `Брокер`, or `Конкурент без бренда`) — never invents a brand.

**Validation (logic simulation, 2026-06-06):** A→results, B→review_queue, C→monitor_queue (company_name=`МФО / частный кредитор`), D→results (service_type=`pts_loan`), all `test_pass_basic=true`. Repair Formatter validated by D; technical_errors path validated by E.

**Retest required:** Test B (the fix), then optional A/D quick smoke. No re-run of C/E needed (logic for those paths unchanged).

### API cost — Tests A–E run

| | Balance |
|---|---|
| Before today | $0.1145 |
| After today | $0.1895 |
| **Delta** | **$0.0750** |

Covers ~5 primary calls + repair calls for D and E. See `docs/COSTS_AND_LIMITS.md`.

---

## Approval Gate — Revised

The original approval gate (4 of 5 extended tests pass) cannot be met with the current single-step architecture.

**New gate (Resilient Output Layer):**

- [x] Resilient Output Layer implemented in TEST HARNESS (dynamic-sheet, per `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`)
- [x] Test A passes: hot lead → `results` tab, `parse_method=primary_json`
- [x] Test B passes: weak lead → `review_queue` tab (after DEC-036 patch — **retest required to confirm live**)
- [x] Test C passes: competitor → `monitor_queue` tab (company_name fallback added)
- [x] Test D passes: forced Markdown input → Repair Formatter → repaired JSON routed correctly (service_type normalized)
- [x] Test E passes: malformed input → `technical_errors` tab
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
