# QA defect register — Stage 1 & Stage 2 acceptance (QA-001 … QA-012)

Branch: `fix/qa-stage1-stage2-all-findings` · baseline `628cacf` · n8n tested version **2.23.3**
(image id `sha256:c0c39b1ca69d43f736bc65f8ddd70972a8989f736e8a4b6a075823f98cc48a23`).

All disposable runtime evidence was produced in throwaway n8n 2.23.3 containers (`--network none`, ephemeral
SQLite, repo read-only, `--rm`, no credentials, no production volume, nothing activated/published). Offline
regression is `$0` with zero external calls.

Statuses: `CONFIRMED` `FIXED` `RETESTED` `LIVE_VERIFICATION_REQUIRED` `READY_FOR_OPERATOR_APPLY` `DISPROVED` `DEFERRED`.

| ID | Title | Status |
|----|-------|--------|
| QA-001 | Deploy runtime set incomplete (missing WF04/08/10/12/16) | FIXED · RETESTED |
| QA-002 | Sub-workflow ids not bound after import | FIXED · RETESTED |
| QA-003 | Parent→child runtime never verified | RETESTED (topology) · LIVE_VERIFICATION_REQUIRED (execution) |
| QA-004 | SVG chart routed via `sendPhoto` | FIXED · LIVE_VERIFICATION_REQUIRED (Telegram) |
| QA-005 | zlib in Code node never proven at runtime | FIXED · RETESTED |
| QA-006 | Runtime-config preflight too weak | FIXED · RETESTED |
| QA-007 | Import smoke not fail-closed / not manifest-driven | FIXED · RETESTED |
| QA-008 | Weekly-digest (WF25) activation ungated | FIXED · RETESTED |
| QA-009 | Docs told operator to bind ids manually | FIXED |
| QA-010 | n8n image not pinned | READY_FOR_OPERATOR_APPLY |
| QA-011 | Smoke used GNU `find -printf` / could print false PASS | FIXED · RETESTED |
| QA-012 | Activation/publication semantics assumed, not verified | FIXED · RETESTED |
| QA-015 | `sheets_contracts.json` had no ordered headers; `source_health.required_columns` did not exist on the tab | FIXED · RETESTED (offline) |
| QA-018 | `READ_BACK_AGENT_REQUEST` failed on Google-normalized values (numeric/boolean/timestamp re-render) | FIXED IN CODE · LIVE RETEST REQUIRED |
| QA-019 | `BEFORE_AFTER_SCOPE` failed though all scope counters were zero (own-row normalization mis-read as foreign) | FIXED IN CODE · LIVE RETEST REQUIRED |

---

## QA-001 — Deploy runtime closure was incomplete
**Evidence.** `scripts/deploy_n8n.sh` hard-coded only WF17–WF26; the callable dependencies WF04/08/10/12/16 (and
WF26) were never imported, so an applied deployment could not resolve its sub-workflow calls.
**Root cause.** Two independent hand-maintained workflow lists (deploy script + smoke) with no derived closure.
**Fix.** `config/workflow_manifest.json` is now the single source of truth. `tools/gen_workflow_manifest.js`
computes the runtime closure (roots ∪ Execute Sub-workflow targets) = **15** workflows; `tools/manifest_lib.js` is
the one reader; `scripts/deploy_n8n.sh` derives its import order from it and fails on any missing dependency.
`tools/validate_workflow_manifest.js` rejects a broken manifest.
**Tests.** `tests/test_workflow_manifest.js` (closure=15, topological import order, rejection rules);
`make test` green.
**Disposable runtime.** Imported exactly 15, `MISSING=0`, `EXTRA=0`, `DUPLICATE=0`.
**Status: FIXED · RETESTED.**

## QA-002 — Imported sub-workflow ids were not bound
**Evidence.** Every caller's Execute Sub-workflow node carried `PASTE_WORKFLOW_ID` after import; nothing rebound it.
**Root cause.** No post-import binding step.
**Fix.** `tools/bind_n8n_workflow_ids.js` rewrites each of the 8 edges to the target's real id, matched by **exact
workflow name + exact caller-node name** (never by position), fail-closed and idempotent. n8n 2.23.3 also requires
a non-null workflow id on import, so `tools/stage_runtime_workflows.js` assigns deterministic ids before import.
**Tests.** `tests/test_binding_tool.js` (8 resolved, 0 placeholders, idempotent, duplicate/missing/ambiguous/
wrong-type rejected).
**Disposable runtime.** `RESOLVED_EDGES=8`, `PLACEHOLDER_BINDINGS=0`, idempotent repeat (`LIST_COUNT` 15→15).
Report: `{bindings_expected:8, bindings_resolved:8, placeholders_remaining:0, missing_targets:0, ambiguous_targets:0, duplicate_workflows:0, all_inactive:true}`.
**Status: FIXED · RETESTED.**

## QA-003 — Parent→child runtime never verified
**Evidence.** No proof the orchestrator could actually reach a callable after deployment.
**Fix / proof.** Fixtures `tests/fixtures/n8n/{parent,child}.json` use real `executeWorkflow` /
`executeWorkflowTrigger` nodes. In disposable n8n 2.23.3 the import→bind→export round-trip proves the parent's
Execute Sub-workflow node resolves to the child's **real assigned id**, the child carries an Execute Sub-workflow
Trigger, and the named input contract matches (`PC_CHILD_TRIGGER=yes`, `PC_PARENT_BOUND=yes`); the 6 production
callables likewise each carry a trigger (`CALLABLE_TRIGGERS_VALID=6`).
**Finding (n8n 2.23.3).** The CLI `n8n execute` harness refuses to invoke an **inactive** database sub-workflow
("Workflow is not active and cannot be executed"). Production never uses CLI execute — callables are invoked by
the **server runtime** from the active gateway/trigger workflows, which does not require callables to be active.
**Status: RETESTED (topology proven) · LIVE_VERIFICATION_REQUIRED (cross-execution on the live server).**

## QA-004 — SVG chart was routed through `sendPhoto`
**Evidence.** WF24 sent the generated chart (`image/svg+xml`) via Telegram `sendPhoto`; SVG is a vector and
`sendPhoto` rejects/mangles it.
**Fix.** New canonical policy `n8n/lib/attachment_router.js` (raster→`sendPhoto`; `svg+xml`/`csv`/`xlsx`/`pdf`→
`sendDocument`; unknown MIME → **fail closed**). WF24's export Code node embeds it (drift-checked) and the chart is
now uploaded via `sendDocument`; WF24 no longer has a `sendPhoto` node.
**Tests.** `tests/test_attachment_routing.js` (policy + "SVG never sendPhoto" + WF24 structure);
`tests/test_reporting_workflows.js` updated to assert no `sendPhoto` and SVG-via-`sendDocument`.
**Status: FIXED · LIVE_VERIFICATION_REQUIRED (actual Telegram upload of the .svg/.xlsx is a live step).**

## QA-005 — zlib in the Code node never proven at runtime
**Evidence.** The XLSX writer relies on Node `zlib`; whether n8n's sandbox allowed it was unverified.
**Fix / proof.** `scripts/n8n_zlib_runtime_smoke.sh` + fixture `tests/fixtures/n8n/zlib_roundtrip.json`. In
disposable n8n 2.23.3:
* **negative control** (no `NODE_FUNCTION_ALLOW_BUILTIN`): Code node throws `Module 'zlib' is disallowed`,
  execution exits non-zero → `ZLIB_NEGATIVE_CONTROL=PASS`;
* **positive control** (`NODE_FUNCTION_ALLOW_BUILTIN=zlib`): `zlib_loaded:true, round_trip_ok:true`
  (429→45 bytes) → `ZLIB_CODE_NODE=PASS`. The task runner **does** inherit the variable.
**Config.** `ops/n8n/runtime.env.example` documents it; deploy `--activate-triggers` runs a `--require-zlib`
preflight that blocks XLSX-capable activation when zlib is absent.
**Status: FIXED · RETESTED.**

## QA-006 — Runtime-config preflight too weak
**Fix.** `tools/preflight_config.js`: required (`MS_SPREADSHEET_ID`, `MS_TELEGRAM_ALLOWED_USER_IDS`, zlib when
required), boolean flags, non-negative budgets, source-allowlist vocabulary, placeholder rejection; secret-ish
values never printed (masked). Wired into deploy `--check-config`/`--dry-run`(soft)/`--apply`/`--activate-triggers`.
**Tests.** `tests/test_deploy_preflight.js`.
**Status: FIXED · RETESTED.**

## QA-007 — Import smoke not fail-closed / not manifest-driven
**Fix.** `scripts/n8n_import_smoke.sh` rewritten around the manifest: stage(ids)→import inactive→auto-bind→export→
verify (exact count, zero placeholders, 8 edges, all inactive)→repeat (idempotency). Every mandatory failure
propagates non-zero.
**Disposable runtime.** `RUNTIME_WORKFLOWS_IMPORTED=15  MISSING=0  EXTRA=0  DUPLICATE=0  PLACEHOLDER_BINDINGS=0
RESOLVED_EDGES=8  ACTIVE_WORKFLOWS=0  REPEAT_DEPLOY=PASS`.
**Status: FIXED · RETESTED.**

## QA-008 — Weekly digest (WF25) activation ungated
**Fix.** Activation policy in the manifest: WF18 always; WF23 only if `MS_MONITORING_ENABLED=true`; **WF25 only if
`MS_WEEKLY_DIGEST_ENABLED=true`**; never a callable. Deploy carries `TRIGGER_WORKFLOWS_WEEKLY_DIGEST` and
cross-checks the activation set against the manifest.
**Tests.** `tests/test_workflow_manifest.js` (WF25 gated, not in `always`, no callable in any plan).
**Status: FIXED · RETESTED.**

## QA-009 — Docs told the operator to bind ids manually
**Fix.** Binding is automatic (QA-002). `docs/DEPLOYMENT_BINDING.md` documents it; the deploy script no longer
prints a "bind WF04/08/10/12/16 manually in the UI" instruction.
**Status: FIXED.**

## QA-010 — n8n image not pinned
**Fix.** `ops/n8n/docker-compose.pinned.example.yml` (`n8nio/n8n:2.23.3` + zlib), `docs/N8N_VERSION_PINNING.md`,
`scripts/check_n8n_runtime.sh` (reports configured/running image + version, floating-tag UNSAFE unless
`MS_ALLOW_FLOATING_N8N_IMAGE=true`, version mismatch). The live `/opt/n8n/docker-compose.yml` is **not** modified;
an operator-only diff is provided.
**Status: READY_FOR_OPERATOR_APPLY.**

## QA-011 — Smoke used GNU `find -printf` / could print a false PASS
**Fix.** Smokes rewritten POSIX/BusyBox-safe (no `find -printf`), `set -euo pipefail`, fail-closed (a failed
mandatory check is never followed by a final PASS), with `OPTIONAL_CHECK_SKIPPED` labels when docker is absent.
**Tests.** `tests/test_smoke_hardening.js` (static checks + a real negative propagation test proving a mandatory
failure exits non-zero and never prints PASS).
**Status: FIXED · RETESTED.**

## QA-012 — Activation/publication semantics assumed, not verified
**Evidence captured** in a disposable container (`docs/n8n_2.23.3_cli_semantics.md`):
* `publish:workflow` **and** `unpublish:workflow` exist in 2.23.3; `update:workflow` is **`[DEPRECATED]` — use
  publish/unpublish** (still accepts `--active`). The legacy assumption "OSS n8n has no publish step" is false.
* `import:workflow --activeState` defaults to `false`, which **deactivates every imported workflow regardless of
  its JSON `active` field** — imports cannot accidentally activate anything.
**Fix.** Deploy now imports with `--activeState=false`, activates via `publish:workflow` (falling back to the
deprecated `update:workflow --active=true` only on an older CLI) and rolls back via `unpublish:workflow`. Rollback
procedure documented. No workflow was activated or published during this work.
**Status: FIXED · RETESTED.**

## QA-015 — Sheets contract lacked ordered headers; one tab's required_columns were phantom
**Context.** The Stage 3 Google Sheets staging bootstrap needs the exact ordered headers for all 40 contract tabs.
`config/sheets_contracts.json` declared the 40 tab names + `required_columns` but **no ordered `headers`** — the
project relied on `autoMapInputData` so the full header set was only implicit (the union of what each writer emits),
scattered across the schema docs. `docs/REPORTING_UX_AND_RELEASE_VERIFICATION.md` even claimed "headers in
`config/sheets_contracts.json`" though none were present.

Separately, **`source_health.required_columns` was `["source", "status"]`**, but the canonical WF16 schema
(`docs/SOURCE_QUALITY_GATE.md`) has no `source`/`status` columns — they are `source_run_id` / `quality_status`. So
`required_columns` referenced phantom columns.

**Fix.**
* Added `sheet_order` (40), ordered `headers` (superset of `required_columns`), and `identity_columns` to
  `config/sheets_contracts.json`, sourced from the canonical schema docs / library row shapes (provenance recorded
  in `config/sheets_ui_contracts.json._provenance`). Tabs written by more than one workflow generation (notably
  `agent_requests` — Stage 3 ledger vs Stage 4 WF18; and `source_change_events` — WF23 vs WF26) carry the **union**
  of every writer's columns, because Google Sheets `append` maps by header *name* and a missing column silently
  drops a writer's field.
* Corrected `source_health.required_columns` to `["source_run_id", "quality_status"]`.
* These are additive top-level keys; the existing `tools/validate_sheet_contracts.js` (363 checks) and
  `tests/test_sheets_contracts.js` continue to pass unchanged.

**Tests.** `tests/test_sheets_bootstrap.js` (resolver fails closed on duplicate/empty/missing-required/bad-enum;
headers non-empty + unique; `required ⊆ headers`). No live Google call — offline-verified.
**Status: FIXED · RETESTED (offline).** Live Google Sheets apply against the operator's staging spreadsheet is a
deliberate manual step (`docs/STAGE3_SHEETS_BOOTSTRAP.md`).

---

## QA-018 — Read-back compared Google-normalized cells byte-for-byte
**Context.** The Stage 3C operations acceptance harness writes request A to `agent_requests` with
`values:batchUpdate` (`valueInputOption=USER_ENTERED`), then reads the row back and asserts equality
(`READ_BACK_AGENT_REQUEST`). The first **live** run failed even though the write was correct. Root cause: the
read-back used a **byte/loose** field comparison, but Google does not return the literal characters that were
sent — it returns the **rendered** value under the cell's number format.

The exact mismatching columns and typed values:

| column | written (USER_ENTERED) | read back (FORMATTED_VALUE) | why |
|--------|------------------------|-----------------------------|-----|
| `estimated_source_cost_usd` | `-5` | `-5.00` | bootstrap applies number format `#,##0.00####` to `*_usd` columns (`RE_USD = /(_usd$\|cost_usd\|_cost$)/`) |
| `estimated_analysis_cost_usd` | `-4.5` | `-4.50` | same number format |
| `approval_required` | `false` | `FALSE` | checkbox column → boolean rendered as upper-case `TRUE`/`FALSE` |
| `created_at` (latent) | ISO-8601 instant | same instant, possibly re-serialized | timestamp re-render |

`-5` vs `-5.00` and `false` vs `FALSE` are byte-unequal but semantically identical, so the harness reported a
false failure.

**Fix (in code).** A single **contract-aware comparison layer** in `n8n/lib/sheets_operations_qa.js`, applied to
*every* read-back field (no field dropped):
* **blank semantics** — `undefined`/`null`/missing-trailing-cell/`""` are equivalent *only* where the contract
  represents an unset value; a blank is **never** equal to `0` or `false`.
* **boolean semantics** (contract checkbox columns) — `true == "TRUE"`, `false == "FALSE"` (case-insensitive);
  arbitrary truthy strings (`"yes"`, `"1"`) are rejected.
* **numeric semantics** (columns the contract proves numeric — `*_usd`/`_cost`, rate, int, score, never
  id-hash/timestamp) — compared numerically (`-5 == -5.0 == "-5" == "-5.00"`, `1234.5 == "1,234.50"`); locale
  thousands separators are tolerated **only** for proven-numeric columns; free text is never coerced.
* **timestamp semantics** (contract timestamp columns) — compared as normalized instants.
* **text semantics** — a leading formula-escape apostrophe is tolerated **only** when the de-escaped text is a
  dangerous formula lead; legitimate apostrophes (`O'Brien`) are never stripped.

Structured diagnostics (`READ_BACK_FAILURES`, also `BEFORE_AFTER_FAILURES`) carry
`{sheet,key,column,expected_raw,actual_raw,expected_type,actual_type,comparison_mode}`.

**Formula safety stays a separate assertion.** Read-back equality must not double as the injection guard, so a
bounded official-API typed read (`spreadsheets.get?includeGridData=true`,
`fields=…userEnteredValue,effectiveValue,formattedValue`, scoped to request A's single row) checks that each
formula-bearing cell is stored as `userEnteredValue.stringValue` and **not** `userEnteredValue.formulaValue`.
`=1+1`, `+SUM(1,1)`, `@IMPORTXML("https://example.com","/")`, `-CMD|' /C calc'!A0` must remain literal text;
`-5`, `-4.5` must remain numeric. The injection test was **not** weakened — `FORMULA_INJECTION_NEUTRALIZATION`
now requires planned neutralization **and** the typed read proving `stringValue`.

**Second live failure (non-empty staging) + the residual cause.** A later live write was correct
(`MUTATIONS_EXECUTED=true`, `EXPECTED_ROWS_WRITTEN=7`, scope counters `0`) yet still returned
`READ_BACK_AGENT_REQUEST=FAIL` because the staging spreadsheet **already held rows from earlier QA runs** and the
residual mismatch was the **timestamp** columns: `created_at`/`ts`/`updated_at`/`added_at`/`last_change_at` are
`COL_TIME` columns, and Google re-renders a written instant in an offset-less locale form (`23.06.2026 15:04:05`)
that `Date.parse` cannot round-trip, so the timestamp branch fell through to a text compare and mismatched.
**Robust fix:** (1) system timestamps are now written in **Europe/Moscow** RFC3339 (`…+03:00`) via the shared
`n8n/lib/ms_time.js` (IANA offset, not a hard-coded +3); (2) the engine's `toInstant` is now Moscow-aware
(mirrors `ms_time.instantOf`) — `Z`, `+03:00`, offset-less ISO, and Google's RU/US locale renderings all resolve
to the **same instant**; (3) request A is located by the **full identity contract** (`findRequestARow`: current
`qa_run_id` + exact `agent_request_id` + owner `user_id` + `data_mode=manual_test` + `role=request_a` marker),
never "first matching-looking row", so prior-run rows and request B can't satisfy it. Diagnostics now carry
`physical_row`, `key`, `qa_run_id`, `reason`, and empty findings are `[]` (never `[null]`).

**Tests.** `tests/test_sheets_operations_qa.js` §15c (QA-018 regression: old byte comparator FAILS, new
contract-aware READ_BACK/NEGATIVE PASS on `-5.00`/`-4.50`/`FALSE`), §15d (blank/boolean/numeric/missing-trailing/
timestamp/escape unit tests), §15e (typed formula safety: `stringValue` PASS, a real `formulaValue` FAILs),
**§21 (NON-EMPTY staging: a fresh run over prior QA runs + foreign business rows reads only its own request A,
creates no false duplicate, modifies nothing foreign, READ_BACK/BEFORE_AFTER PASS, empty diagnostics)**, **§22
(full-identity location rejects request B / prior-run rows)**, **§23 (Moscow timestamp round-trip)**; plus
`tests/test_ms_time.js` (24 checks). Suite total **190**.
**Status: FIXED IN CODE · LIVE RETEST REQUIRED** — proven offline (incl. a non-empty-staging fixture); not yet
re-run against the live spreadsheet.

---

## QA-019 — Before/after scope failed although every scope counter was zero
**Context.** `BEFORE_AFTER_SCOPE` must prove the run touched only its own rows. The first live run reported the
aggregate as FAIL while `FOREIGN_ROWS_MODIFIED=0`, `UNEXPECTED_ROWS_WRITTEN=0`, `HEADERS_MODIFIED=0`,
`UNDECLARED_TABS_MODIFIED=0` — a contradiction. Root cause: the old predicate compared the whole before/after
sheet **byte-for-byte** and counted any changed row as foreign. Because Google normalizes the run's **own** QA
rows on read-back (QA-018), the workflow's own freshly-written rows were mis-counted as foreign modifications,
and a read-back content difference bled into the scope verdict.

**Fix (in code).** `verifyBeforeAfter` is now **identity-based**. It classifies every after-row by whether the
run *owns* it (carries the run marker **or** matches a desired QA identity) and asserts, per declared tab:
* the header row is unchanged;
* every desired QA identity is present **exactly once** (else `expected_row_missing` / `duplicate_qa_row`);
* no unexpected run-owned row exists (`unexpected_qa_row`);
* every **foreign** (non-run) row is unchanged, compared with the **same contract-aware** comparator
  (`foreign_row_modified` / `foreign_row_removed` / `foreign_row_added`);
* no undeclared tab was written (`undeclared_tab_written`).

Normalization of the workflow's own QA rows is therefore **not** a foreign-scope violation; a read-back content
problem surfaces under `READ_BACK_AGENT_REQUEST` / `READ_BACK_FAILURES`, never as a phantom scope failure. PASS
requires all expected inserts/updates present, zero unexpected QA rows, foreign rows + foreign-owner rows
unchanged, headers unchanged, and undeclared tabs untouched. No check was removed to manufacture a PASS;
failures return structured `BEFORE_AFTER_FAILURES`.

**Non-empty staging (the live trigger).** `verifyBeforeAfter` now classifies every after-row three ways —
`current_run_owned` / `previous_qa_run` (a manual_test row from an **earlier** run) / `foreign_non_qa` — and
surfaces the counts (`CURRENT_RUN_OWNED_ROWS`, `PREVIOUS_QA_RUN_ROWS`, `FOREIGN_NON_QA_ROWS`). Only
`current_run_owned` rows may be inserted/updated; previous-QA and foreign rows are held **unchanged** with the
same Moscow-aware contract-aware comparator (so their existence never causes a failure, they are never counted as
this run's duplicates, never satisfy an expected write, and are never rewritten or deleted). `PASS` requires: all
current-run expected rows present, all canonical keys unique, previous-QA rows unchanged, foreign rows unchanged,
`UNEXPECTED_ROWS_WRITTEN=0`, `HEADERS_MODIFIED=0`, `UNDECLARED_TABS_MODIFIED=0`. `BEFORE_AFTER_FAILURES` /
`READ_BACK_FAILURES` / `FORMULA_SAFETY_DETAILS` are empty arrays (never `[null]`) when clean.

**Tests.** §15f isolates each genuine violation (`foreign_row_modified`, `expected_row_missing`,
`duplicate_qa_row`); §15c proves PASS survives normalization of the run's own rows; §17 proves a clean run leaves
foreign rows byte-identical; **§21 proves PASS over a populated sheet (prior QA run A+B + foreign business rows +
preallocated checkbox rows)**. **Status: FIXED IN CODE · LIVE RETEST REQUIRED.**

**Mutation / acceptance markers (Section D).** Alongside QA-018/019 the summary now carries truthful, separable
markers so a verification failure can never imply Google applied no mutation:
`WRITE_NODE_EXECUTED`, `WRITE_REQUEST_SUCCEEDED`, `MUTATIONS_EXECUTED`, `AFTER_SNAPSHOT_READ`,
`ACCEPTANCE_VERIFIED`, `CHANGES_APPLIED`, `RESULT`. Dry-run → all false + live-only checks `NOT_EXECUTED_DRY_RUN`.
Write rejected → `WRITE_NODE_EXECUTED=true, WRITE_REQUEST_SUCCEEDED=false, MUTATIONS_EXECUTED=false,
CHANGES_APPLIED=false, RESULT=FAIL`. Write accepted but verification fails → `…MUTATIONS_EXECUTED=true,
AFTER_SNAPSHOT_READ=true, ACCEPTANCE_VERIFIED=false, CHANGES_APPLIED=true, RESULT=FAIL`. Full acceptance → all
true, `RESULT=PASS`. Once the write node executes, the verdict is acceptance-based and never falls back to the
dry-run success path. (Tests §15, §15b.)

---

## Remaining live-only verification
* **QA-003** — cross-workflow execution on the live n8n **server** (callables invoked from the active gateway).
* **QA-004** — actual Telegram `sendDocument` upload of the `.svg` chart and `.xlsx` workbook to a real chat.
* **QA-010** — operator applies the pinned-image diff to `/opt/n8n/docker-compose.yml` and recreates the container.
* **QA-018 / QA-019** — operator re-runs the Stage 3C operations harness against the staging spreadsheet
  (dry-run → first live write with a new `QA_RUN_ID` → repeat live write with the same `QA_RUN_ID` → final
  dry-run) and confirms `READ_BACK_AGENT_REQUEST=PASS`, `BEFORE_AFTER_SCOPE=PASS`, `ACCEPTANCE_VERIFIED=true`,
  `RESULT=PASS`, and `IDEMPOTENCY=PASS` (0 duplicates on repeat). See
  `docs/STAGE3_SHEETS_OPERATIONS_ACCEPTANCE.md`.
