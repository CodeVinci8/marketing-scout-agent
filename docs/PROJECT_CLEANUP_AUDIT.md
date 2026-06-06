# PROJECT_CLEANUP_AUDIT.md — Pre-Implementation Cleanup Audit

**Date:** 2026-06-06
**Status:** Phase 1 complete — approved files deleted 2026-06-06
**Prepared by:** project-engineer agent
**Trigger:** Preparation for implementing Resilient Output Layer (DEC-033)

---

## 1. Cleanup Objective

The Workflow 02 v2 experiment phase generated multiple workflow JSON files, test harnesses,
experimental prompt docs, and planning files. Before implementing the Resilient Output Layer
(two-pass repair + multi-tab router), the repository should be cleaned up so that:

- Only one active test harness exists per workflow stage.
- Failed experiments (gateway 502, superseded formats) do not create confusion about what the
  current approach is.
- The new TEST HARNESS for the Resilient Output Layer has a clear, unambiguous name.
- Untracked ghost files left by earlier tooling are removed from the working tree.

---

## Phase 1 Execution Summary (2026-06-06)

**Executed by:** project-engineer agent, operator approval confirmed.

### Deleted (git rm)

| File | Size | Reason |
|------|------|--------|
| `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` | 28,139 bytes | v2.5 MICRO experiment harness — all gateway 502; superseded by Resilient Output Layer |
| `n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json` | 33,018 bytes | Test 5 short-text variant only; superseded by extended tests and Resilient Output Layer approach |

### Ghost files (untracked zero-byte files)

Ghost files (`=70`, `Append`, `Build`, `Claude`, `Parse`, `Quality`, `Select`, `Set`) were
confirmed absent from the filesystem at execution time — already removed prior to this session.
No `rm` action was needed.

### Intentionally kept (confirmed present after cleanup)

| File | Status |
|------|--------|
| `n8n/workflows/00_healthcheck_manual_test.json` | ✓ present |
| `n8n/workflows/01_google_sheets_append_row_test.json` | ✓ present |
| `n8n/workflows/02_claude_api_single_record_analysis.json` | ✓ present |
| `n8n/workflows/02_claude_api_single_record_v2_baseline_raw_json.json` | ✓ present (33,250 bytes) |
| `n8n/workflows/02_claude_api_single_record_v2_extended_tests.json` | ✓ present (30,879 bytes) |
| `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` | ✓ present |
| `docs/WORKFLOW_02_V2_TEST_RESULTS.md` | ✓ present |
| `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` | ✓ present |
| `modules/marketing-scout-v0/TEST_RECORDS_V2.md` | ✓ present |
| `modules/marketing-scout-v0/TEST_RECORDS_V2_EXTENDED.md` | ✓ present |

### Deferred to cleanup phase 2 (not deleted in this session)

| File | Deferred reason |
|------|----------------|
| `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md` | Operator did not approve in this phase |
| `modules/marketing-scout-v0/SYSTEM_PROMPT.md` | Operator did not approve in this phase |
| `modules/marketing-scout-v0/TEST_DATA.md` | Operator did not approve in this phase |
| `docs/MILESTONE_REVIEW_02.md` | Operator did not approve in this phase |

Deeper prompt/doc cleanup is deferred to a future session after the Resilient Output Layer
TEST HARNESS is built and Tests A–E are confirmed.

---

**Original audit note:** Phase 1 is now complete.
Operator reviews and approves deletions before any `git rm` is run.

---

## 2. Active / Keep Files

These files are confirmed necessary and must not be touched.

### Project Foundation

| File | Reason to keep |
|------|---------------|
| `README.md` | Project entry point |
| `CLAUDE.md` | Agent operating rules — session-critical |
| `docs/PROJECT_BRIEF.md` | Business goal and MVP definition |
| `docs/BUSINESS_REQUIREMENTS.md` | Uncle's confirmed requirements — referenced by prompt and scoring |
| `docs/ARCHITECTURE.md` | System design reference |
| `docs/ROADMAP.md` | Stage plan — updated this session |
| `docs/NEXT_ACTIONS.md` | Immediate next steps — updated this session |
| `docs/DECISIONS.md` | Full decision register — DEC-001 through DEC-033 |
| `docs/AGENT_CAPABILITIES.md` | What the agent can and cannot do — updated this session |
| `docs/TABLE_SCHEMA.md` | Google Sheets column definitions |
| `docs/COSTS_AND_LIMITS.md` | Gateway and API cost/size constraints |
| `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` | Resilient Output Layer design spec — just created |
| `docs/WORKFLOW_02_V2_TEST_RESULTS.md` | Extended test results — updated this session |
| `core/hot/recent.md` | Session continuity memory |
| `core/warm/decisions.md` | Stable design decisions |
| `core/rules.md` | Agent operating rules |
| `core/AGENTS.md` | Agent role definitions |
| `core/USER.md` | Operator profile |
| `core/MEMORY.md` | Memory index |

### Active Workflow JSONs

| File | Reason to keep |
|------|---------------|
| `n8n/workflows/00_healthcheck_manual_test.json` | Baseline healthcheck — do not modify |
| `n8n/workflows/01_google_sheets_append_row_test.json` | Baseline Sheets test — do not modify |
| `n8n/workflows/02_claude_api_single_record_analysis.json` | Production Workflow 02 v1 — do not modify until Resilient Output Layer approved |

### Active Module Files

| File | Reason to keep |
|------|---------------|
| `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` | Active primary analysis prompt |
| `modules/marketing-scout-v0/TEST_RECORDS_V2.md` | Original 7 synthetic test records |
| `modules/marketing-scout-v0/TEST_RECORDS_V2_EXTENDED.md` | Extended tests 8–12 — test evidence |
| `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md` | Production reference — v1 prompt in production Workflow 02 |

### Keep-for-Reference Workflow JSONs

| File | Reason to keep |
|------|---------------|
| `n8n/workflows/02_claude_api_single_record_v2_baseline_raw_json.json` | d350069 baseline — the working harness that confirmed hot lead scoring. Reference for Resilient Output Layer build. **Currently untracked — must be added to git before any cleanup.** |
| `n8n/workflows/02_claude_api_single_record_v2_extended_tests.json` | Tests 8–12 were run on this. Historical test evidence. Keep until Resilient Output Layer re-runs those tests. |

---

## 3. Workflow JSON Inventory

Full scan of `n8n/workflows/`:

| File | Size | Git status | Classification | Reason |
|------|------|-----------|---------------|--------|
| `00_healthcheck_manual_test.json` | 4,392 bytes | tracked, clean | **keep active** | Baseline healthcheck; do not touch |
| `01_google_sheets_append_row_test.json` | 7,004 bytes | tracked, clean | **keep active** | Baseline Sheets test; do not touch |
| `02_claude_api_single_record_analysis.json` | 16,303 bytes | tracked, clean | **keep active** | Production Workflow 02 v1 — source of truth until Resilient Output Layer approved |
| `02_claude_api_single_record_v2_baseline_raw_json.json` | 33,250 bytes | **untracked** | **keep as reference — add to git** | d350069 baseline: confirmed working for hot leads (Tests 1, 8). Must be committed before cleanup so it is not lost. |
| `02_claude_api_single_record_v2_baseline_short_test5.json` | 33,018 bytes | tracked, clean | **archive candidate** | Test 5 short-text variant only. Superseded: extended tests changed the priority; Resilient Output Layer replaces prompt-level fixes. No longer needed as an active harness. |
| `02_claude_api_single_record_v2_extended_tests.json` | 30,879 bytes | tracked, clean | **keep as reference** | Tests 8–12 were run on this. Historical test evidence. Keep until Resilient Output Layer TEST HARNESS re-runs those tests and results are confirmed. |
| `02_claude_api_single_record_v2_test_harness.json` | 24,138 bytes | tracked, **modified** | **archive candidate** | v2.5 MICRO TEST HARNESS — KEY=VALUE line protocol, micro prompt. All v2.1–v2.5 experiments failed (JSON.parse failures or gateway 502). Superseded by Resilient Output Layer direction. The modified state reflects the last experiment state. |

**Note on modified status of `02_claude_api_single_record_v2_test_harness.json`:**
This file shows as modified in `git status`. The modification was from a prompt experiment session.
Before archiving, the operator should decide: stash the modifications (git restore) or commit them
as-is with an archive note. Either way, the file becomes the Resilient Output Layer TEST HARNESS
after rebuild — or a new named file is created to avoid confusion.

---

## 4. Ghost Files — Untracked Zero-Byte Artifacts

During git status inspection, 8 zero-byte untracked files were found at the project root:

| File | Size | Origin |
|------|------|--------|
| `=70` | 0 bytes | Accidental creation — likely `exec "=70..."` or shell evaluation artifact from a Python script that used node names as variables |
| `Append` | 0 bytes | n8n node name artifact |
| `Build` | 0 bytes | n8n node name artifact |
| `Claude` | 0 bytes | n8n node name artifact |
| `Parse` | 0 bytes | n8n node name artifact |
| `Quality` | 0 bytes | n8n node name artifact |
| `Select` | 0 bytes | n8n node name artifact |
| `Set` | 0 bytes | n8n node name artifact |

**All eight files are zero bytes and untracked.** They contain no content. They are not referenced
by any workflow, script, or documentation. They were never committed to git.

These are safe to remove with `rm` (not `git rm` — they are not tracked).

**Risk:** Zero. These files have no content and are not referenced anywhere.

---

## 5. Module Files — Audit

| File | Classification | Reason |
|------|---------------|--------|
| `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md` | **keep** | Production reference — embedded in `02_claude_api_single_record_analysis.json` |
| `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md` | **keep** | Active v2 prompt — used in all v2 harnesses |
| `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md` | **archive candidate** | Planning doc written before v2 was implemented. The plan was executed; the actual prompt is in `MARKETING_AGENT_PROMPT_V2.md`. This doc has 20,840 bytes of detail that is now redundant and may cause confusion about what the "current" prompt is. |
| `modules/marketing-scout-v0/README.md` | **keep** | Module entry point |
| `modules/marketing-scout-v0/SYSTEM_PROMPT.md` | **archive candidate** | v1.0 draft system prompt — predates `MARKETING_AGENT_PROMPT_V1.md`. Status: Draft. Not referenced in any workflow. Superseded by v1 and v2 prompts. May confuse a reader about which prompt is active. |
| `modules/marketing-scout-v0/TEST_DATA.md` | **archive candidate** | Sample records from Stage 1 foundation (2026-06-04). Superseded by `TEST_RECORDS_V2.md` (7 records) and `TEST_RECORDS_V2_EXTENDED.md` (tests 8–12). Original records are structurally different from the current v2 input format. |
| `modules/marketing-scout-v0/TEST_RECORDS_V2.md` | **keep** | 7 synthetic test records for the v2 prompt — still referenced in test plan |
| `modules/marketing-scout-v0/TEST_RECORDS_V2_EXTENDED.md` | **keep** | Tests 8–12 — was the basis for extended test runs |
| `modules/marketing-scout-v0/WORKFLOW_DESIGN.md` | **review — possible archive** | Detailed v0.1 workflow design doc (Step-by-step node plan, 10-node design, Apify/Firecrawl integration). Still relevant as architectural reference for future Workflow 03+ design. However, some node names and schema details may be outdated vs. current production workflow. Recommend reviewing before archiving. |

---

## 6. Docs Cleanup — Audit

| File | Classification | Reason |
|------|---------------|--------|
| `docs/AGENT_LOG.md` | **keep** | Session log — maintained each session |
| `docs/AGENT_CAPABILITIES.md` | **keep** | Updated this session |
| `docs/ARCHITECTURE.md` | **keep** | System design reference |
| `docs/BUSINESS_REQUIREMENTS.md` | **keep** | Uncle's confirmed requirements |
| `docs/COSTS_AND_LIMITS.md` | **keep** | Gateway/API constraint log |
| `docs/DECISIONS.md` | **keep** | Decision register through DEC-033 |
| `docs/MILESTONE_REVIEW_02.md` | **archive candidate** | Comprehensive audit written 2026-06-05. Captured 12 doc issues and 7 risks. Most findings were acted on. As a historical audit snapshot, it is not regularly consulted. It clutters the docs/ index. Could be moved to `backups/` or a `docs/archive/` directory. |
| `docs/N8N_DEPLOYMENT.md` | **keep** | Deployment guide — still needed for VPS reference |
| `docs/N8N_WORKFLOW_00_HEALTHCHECK_RU.md` | **keep** | Russian guide for Workflow 00 — operator reference |
| `docs/N8N_WORKFLOW_01_GOOGLE_SHEETS_RU.md` | **keep** | Russian guide for Workflow 01 — operator reference |
| `docs/N8N_WORKFLOW_02_CLAUDE_API_RU.md` | **keep** | Russian guide for production Workflow 02 — operator reference |
| `docs/N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md` | **update candidate** | Russian test plan written during extended test design. Describes a 3-phase plan that is now partially superseded by the Resilient Output Layer. Should be rewritten to describe Tests A–E instead of Tests 8–12 as the completion gate. Not urgent; keep for now. |
| `docs/NEXT_ACTIONS.md` | **keep** | Updated this session |
| `docs/PROJECT_BRIEF.md` | **keep** | Business goal definition |
| `docs/PROMPTS.md` | **review — possible merge** | Prompt version history and active prompt reference. May overlap with `AGENT_CAPABILITIES.md` prompt section. Low priority but worth reviewing for consolidation in Step B doc fixes. |
| `docs/ROADMAP.md` | **keep** | Updated this session |
| `docs/TABLE_SCHEMA.md` | **update candidate** | Schema currently lists 25 columns. After Resilient Output Layer implementation, 6 new technical fields will need to be added. Not urgent now — update after Phase 2. |
| `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` | **keep** | Just created — Resilient Output Layer design spec |
| `docs/WORKFLOW_02_V2_TEST_RESULTS.md` | **keep** | Updated with actual test results this session |

---

## 7. Proposed Cleanup Commands

**DO NOT RUN YET. For operator review only.**
Run only after operator explicitly approves each section.

### 7a. Remove ghost files (zero-byte untracked artifacts at project root)

```bash
# These files are untracked — use rm, not git rm
rm /opt/marketing-scout-agent/=70
rm /opt/marketing-scout-agent/Append
rm /opt/marketing-scout-agent/Build
rm /opt/marketing-scout-agent/Claude
rm /opt/marketing-scout-agent/Parse
rm /opt/marketing-scout-agent/Quality
rm /opt/marketing-scout-agent/Select
rm /opt/marketing-scout-agent/Set
```

Risk: None. All zero bytes, untracked, not referenced anywhere.

### 7b. Add untracked baseline to git before any cleanup

```bash
# MUST run this BEFORE any deletions so the working baseline is preserved
git add n8n/workflows/02_claude_api_single_record_v2_baseline_raw_json.json
git add docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md
git commit -m "Add Resilient Output Layer design and d350069 baseline reference"
```

### 7c. Archive experiment workflow JSONs (delete candidates)

```bash
# Only after 7b is complete and operator approves
git rm n8n/workflows/02_claude_api_single_record_v2_test_harness.json
git rm n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json
```

Alternative: move to `n8n/workflows/archive/` instead of deleting.

### 7d. Archive experiment module files (delete candidates)

```bash
# Only after operator approves
git rm modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md
git rm modules/marketing-scout-v0/SYSTEM_PROMPT.md
git rm modules/marketing-scout-v0/TEST_DATA.md
```

### 7e. Archive docs (lower priority — decide separately)

```bash
# Only after operator approves — these are less urgent
git rm docs/MILESTONE_REVIEW_02.md
```

### 7f. Commit cleanup

```bash
git commit -m "Clean up superseded experiment files before Resilient Output Layer implementation"
```

---

## 8. Risk Controls

| Risk | Control |
|------|---------|
| Accidentally deleting working baseline | `02_claude_api_single_record_v2_baseline_raw_json.json` is in the KEEP list. Must be added to git (7b) before any deletions. |
| Losing test result evidence | `02_claude_api_single_record_v2_extended_tests.json` and both `TEST_RESULTS` docs are in KEEP list. |
| Losing business requirements | `docs/BUSINESS_REQUIREMENTS.md` and `docs/TABLE_SCHEMA.md` are in KEEP list. |
| Losing active prompt | `MARKETING_AGENT_PROMPT_V2.md` and `MARKETING_AGENT_PROMPT_V1.md` are in KEEP list. |
| Touching /opt/n8n runtime | All commands target only `/opt/marketing-scout-agent/`. Do not touch `/opt/n8n/`. |
| Removing a file that is still referenced | Update `docs/NEXT_ACTIONS.md` and `core/hot/recent.md` after any deletion to remove stale references. |
| Deleting before operator review | This entire document is for review only. No deletions in this session. |

---

## 9. Recommended Cleanup Plan

| Phase | Description | Who | Gate |
|-------|-------------|-----|------|
| **Phase 1** | Audit only (this document). Identify candidates. | Agent | Operator reads audit |
| **Phase 2** | Operator reviews. Approves which files to delete and which to keep. | Operator | Explicit written approval per section |
| **Phase 3a** | Add untracked files to git (`02_claude_api_single_record_v2_baseline_raw_json.json`, `WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md`, modified docs). Commit. | Agent + Operator | Must happen before any deletions |
| **Phase 3b** | Remove ghost files (`rm` for untracked zero-byte files). | Agent or Operator | Requires Phase 3a complete |
| **Phase 3c** | `git rm` approved delete candidates. | Agent | Requires Phase 2 approval for each file |
| **Phase 4** | Update doc references: remove stale file mentions from NEXT_ACTIONS.md, N8N_WORKFLOW_02_V2_TEST_PLAN_RU.md, etc. | Agent | After Phase 3c |
| **Phase 5** | Commit cleanup with descriptive message. | Operator + Agent | After Phase 4 |
| **Phase 6** | Build Resilient Output Layer TEST HARNESS JSON on a clean repo. | Agent | After Phase 5 |

---

## 10. Summary: What to Decide

The operator needs to confirm each of the following before Phase 3 begins:

### Delete candidates — confirm yes/no for each:

| # | File | Recommended action | Notes |
|---|------|--------------------|-------|
| 1 | Root ghost files (8 files: `=70`, `Append`, etc.) | **Delete (rm)** | Zero bytes, untracked, safe |
| 2 | `n8n/workflows/02_claude_api_single_record_v2_test_harness.json` | **Archive/delete** | v2.5 MICRO experiment; gateway 502; superseded |
| 3 | `n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json` | **Archive/delete** | Test 5 short variant; superseded by Resilient Output Layer approach |
| 4 | `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2_PLAN.md` | **Archive/delete** | Planning doc; plan was executed; now redundant |
| 5 | `modules/marketing-scout-v0/SYSTEM_PROMPT.md` | **Archive/delete** | v1.0 draft; superseded by PROMPT_V1 and V2 |
| 6 | `modules/marketing-scout-v0/TEST_DATA.md` | **Archive/delete** | v1 test data; superseded by TEST_RECORDS_V2.md |
| 7 | `docs/MILESTONE_REVIEW_02.md` | **Archive (lower priority)** | Historical audit; findings addressed; not actively consulted |

### Add to git — confirm:

| # | File | Action |
|---|------|--------|
| 8 | `n8n/workflows/02_claude_api_single_record_v2_baseline_raw_json.json` | **git add + commit** — untracked baseline must be preserved |
| 9 | `docs/WORKFLOW_02_RESILIENT_OUTPUT_LAYER.md` | **git add + commit** — new design spec |

---

**No files were deleted in this session. This document is an audit only.**

Next action: Operator reviews this document and states which files to delete.
Agent then executes approved deletions in Phase 3.
