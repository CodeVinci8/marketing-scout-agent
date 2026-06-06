# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-06 — Project Cleanup Audit

**What was done:**
- Inspected all files: 7 workflow JSONs, 9 module files, 20 docs, full git status.
- Found 8 zero-byte ghost files at project root (untracked): `=70`, `Append`, `Build`, `Claude`, `Parse`, `Quality`, `Select`, `Set` — artifacts from a Python script that used n8n node names.
- Found `02_claude_api_single_record_v2_baseline_raw_json.json` (33,250 bytes, d350069) is untracked — must be added to git before cleanup.
- Created `docs/PROJECT_CLEANUP_AUDIT.md` — full inventory: keep list, archive candidates, ghost file list, proposed commands (not run), 6-phase cleanup plan, operator decision table (9 items).
- Updated NEXT_ACTIONS.md (added Step D0 — cleanup before Resilient Output Layer build).
- No files deleted.

**Key findings:**
- Delete candidates: 8 ghost files + 2 experiment workflow JSONs + 3 module files + 1 docs archive.
- Must-add-to-git: `02_claude_api_single_record_v2_baseline_raw_json.json` + `WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`.
- `02_claude_api_single_record_v2_test_harness.json` is tracked but modified — needs decision (commit as-is or restore) before archiving.

**What is next (in order):**
1. **Operator reviews `docs/PROJECT_CLEANUP_AUDIT.md` Section 10.** Approves or denies each of the 9 items.
2. **Step D0 Phase 3 (git add):** Add baseline + design spec to git; commit pending docs.
3. **Step D0 Phase 4 (deletions):** `rm` ghost files; `git rm` approved candidates.
4. **Step D (Resilient Output Layer):** After clean repo confirmed — operator creates Sheets tabs; Claude Code builds TEST HARNESS JSON; run Tests A–E.
5. Step B: minor doc fixes; Step E: Workflow 03 Firecrawl.

---

## Session: 2026-06-06 — Resilient Output Layer Design

**What was done:**
- Extended tests 8–12 were run (by operator). Tests 1 and 8 (hot PTS leads) passed strongly. Tests 9–12 failed with output-contract errors: no text item (9), Markdown analysis blocks (10, 11), invalid JSON (12). Test 5 remains unstable.
- Diagnosis confirmed: failures are at the serialization layer, not business logic. Claude reasons correctly but returns human-readable output where machine-parseable JSON is required.
- Created `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` — full design for a two-pass architecture:
  - Primary Parse → if fail → JSON Repair Formatter (Haiku, schema-only prompt) → if fail → technical_errors
  - Multi-tab Router replacing binary Quality Gate: results / review_queue / monitor_queue / content_queue / skipped_log / technical_errors
  - 6 new technical fields: processing_status, parse_method, parse_error, raw_response_preview, route, needs_manual_review
  - 5 Tests A–E for validation; 6-phase rollout plan
- Added DEC-033. Updated TEST_RESULTS, CAPABILITIES, ROADMAP, NEXT_ACTIONS, AGENT_LOG.

**Key decisions:**
- DEC-033: stop prompt format experiments. Two-pass repair + routing is the architectural fix.
- tool_use and KEY=VALUE remain deferred (gateway 502).
- JSON Repair Formatter uses Haiku model (formatting task, not analysis) to reduce cost.

**What is next (in order):**
1. ~~Step D Phase 1: cleanup audit~~ → Done. See 2026-06-06 Cleanup Audit session.
2. Step D0: operator approves cleanup; execute deletions.
3. Step D: build Resilient Output Layer TEST HARNESS.
4. Step E: Workflow 03 Firecrawl (first real source).

---

## Session: 2026-06-05 — Extended Tests 8–12 + Final Test Docs

**What was done:**
- Created `02_claude_api_single_record_v2_extended_tests.json` (30,879 bytes): d350069 baseline + tests 8–12 (Telegram hot lead, Instagram competitor, Avito refinancing MO, weak website competitor, out-of-region SPb). JSON valid.
- Created `TEST_RECORDS_V2_EXTENDED.md`: full test specs with input JSON, expected outputs, pass/fail criteria.
- Created `WORKFLOW_02_V2_TEST_RESULTS.md`: empty protocol table ready for operator to fill.
- Updated test plan, AGENT_CAPABILITIES.md, ROADMAP.md (Stage 2.5 Telegram Control Bot), DECISIONS.md (DEC-030, DEC-031, DEC-032), COSTS_AND_LIMITS.md, NEXT_ACTIONS.md.

**Key decisions:**
- DEC-030: content_idea deferred to Stage 3. DEC-031: no repeat tests. DEC-032: Telegram bot is future roadmap.

**What is next (in order):**
1. ~~Run Tests 8–12~~ → Done. See 2026-06-06 sessions.
2. Step D0 cleanup → Step D Resilient Output Layer → Step E Firecrawl.

---

<!-- Sessions older than 3 archived in core/warm/decisions.md -->
<!-- Removed: 2026-06-05 Baseline Raw JSON SHORT TEST 5, Prompt v2.5 MICRO, v2.4 Compact KEY=VALUE, v2.3 KEY=VALUE, v2.2 tool_use, v2.1 JSON Stability, TEST HARNESS, Prompt v2 Written, Business Requirements, Milestone Review 02, 2026-06-04 Foundation -->
