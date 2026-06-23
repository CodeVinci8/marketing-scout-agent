# Stage 3C — Google Sheets Operations Acceptance (QA harness)

**Status:** built, inactive, never auto-run. **Cost:** $0 to build/test (every check is offline).
**Scope:** this is an **acceptance harness for the existing persistence layer**, *not* a product feature.

**Verification status (offline-proven, live retest pending):**
Stage 3A = PASS · Stage 3B1 = PASS · Stage 3B2 = PASS · Stage 3C core persistence = PASS ·
**QA-018 = FIXED IN CODE — LIVE RETEST REQUIRED** (Google-normalized read-back) ·
**QA-019 = FIXED IN CODE — LIVE RETEST REQUIRED** (before/after scope). The contract-aware read-back, the
identity-based before/after scope, the typed formula-safety read, and the truthful mutation markers are all
proven in `tests/test_sheets_operations_qa.js` (**190 checks**, offline, `$0`, 0 external calls). They have
**not** yet been re-run against the live staging spreadsheet — see *§ Live retest sequence* below.

**Works on a NON-EMPTY staging spreadsheet.** The second live failure occurred because the sheet already held
rows from earlier QA runs. The harness now: (a) locates request A by the **full identity contract**
(`findRequestARow`: current `qa_run_id` + exact `agent_request_id` + owner + `data_mode=manual_test` +
`role=request_a` marker — never "first matching-looking row"); (b) classifies every row three ways —
`current_run_owned` / `previous_qa_run` / `foreign_non_qa` — and holds previous-QA and foreign rows unchanged
(surfaced as `CURRENT_RUN_OWNED_ROWS` / `PREVIOUS_QA_RUN_ROWS` / `FOREIGN_NON_QA_ROWS`); (c) writes and compares
**Europe/Moscow** timestamps. Proven by §21 (fresh run over prior QA run A+B + foreign business rows).

**Moscow timezone.** System timestamps are written as RFC3339 with the Moscow offset (`…+03:00`) via
`n8n/lib/ms_time.js` (IANA offset, not a hard-coded +3); the engine's timestamp comparison is Moscow-aware so a
written instant matches Google's offset-less locale rendering (`23.06.2026 15:04:05`). See [[DEC-157]].

It proves — against a **separate staging spreadsheet** — that the project can correctly:
read, append, filtered read-back, insert-style upsert, update-style upsert, dedup-idempotently,
isolate by owner and by request, neutralize formula injection, preserve negative numbers, and touch
**nothing** outside its own generated QA run.

| Artifact | Path |
|----------|------|
| Pure engine (planning + verification, embeddable) | `n8n/lib/sheets_operations_qa.js` |
| Deterministic generator | `tools/gen_sheets_operations_qa_workflow.js` |
| Generated workflow (inactive, manual-only) | `ops/n8n/workflows/qa_stage3_sheets_operations_acceptance.json` |
| Offline test suite (190 checks) | `tests/test_sheets_operations_qa.js` |
| Moscow-time helper (RFC3339 +03:00 / Russian display) | `n8n/lib/ms_time.js` (+ `tests/test_ms_time.js`, 24) |

The workflow lives under `ops/` so it is **excluded** from the production runtime manifest
(`config/workflow_manifest.json`), the Python workflow validator, and the Sheets-contract validator
(all of which scan only `n8n/workflows/`).

---

## What it reuses (no parallel implementations)

The engine mirrors — and the test suite asserts behavioural equality with — the canonical project libs:

| Concern | Canonical source | Reused as |
|---------|------------------|-----------|
| Formula-injection neutralization (`'`-prefix `= + - @ \t \r`; finite numbers exempt) | `n8n/lib/report_export.js` → `neutralize` / `isFiniteNumber` | identical functions |
| Un-neutralized formula detector | `n8n/lib/sheet_audit.js` → `isUnsafeCell` | identical function |
| Outbox delivery id + dedup key (`dlv_<req>_<rep>_<djb2(payload)>`) | `n8n/lib/telegram_io.js` → `makeDelivery` / `payloadHash` | identical id format |
| Sheet contract (ordered headers, identity columns, scope, dropdown enums) | `config/sheets_contracts.json` + `config/sheets_ui_contracts.json` via `n8n/lib/sheets_contract_resolver.js` | frozen snapshot, baked into the workflow |
| Contract-hash marker (`marketing_scout_bootstrap` developerMetadata) | written by `tools/gen_sheets_bootstrap_workflow.js` | read at preflight |

Header arrays are **never** duplicated by hand. Generation **fails closed** if any field, identity key,
owner/request column, or marker field used by the QA plan is not a declared header in the relevant sheet
contract (or if any dropdown-bound value is not a member of the resolved enum).

---

## Operation matrix

| # | Sheet | Operation proven | Matching / identity key | Marker field |
|---|-------|------------------|--------------------------|--------------|
| A | `agent_requests` | append + filtered read-back (request A carries the formula + negative tests; request B is the isolation control) | `agent_request_id` | `notes` |
| B | `agent_request_events` | append an event linked to request A | `agent_request_id` + `idempotency_key` | `reason` |
| C | `conversation_state` | insert-style upsert (base row) | `conversation_id` | `pending_clarification` |
| D | `conversation_state` | update-style upsert (same key, changed `current_state`; **no second row**) | `conversation_id` | `pending_clarification` |
| E | `tracked_sources` | lifecycle upsert (`status` active→paused) for an RFC-2606 example domain; **no collector runs** | `source_id` | `label` |
| F | `telegram_outbox` | idempotency record (DB row only; **no Telegram send**) | `delivery_id` | `last_error` |

Every QA row is tagged in a declared free-text field as
`[MSQA data_mode=manual_test qa_run_id=… owner=… role=…]`. The tag starts with `[`, which is not a
formula-lead character, so it is never altered by neutralization.

**Insert-vs-update semantics.** A fresh live run reaches the *final* (updated) state in one write. The
insert→update transition is proven by a two-phase in-memory upsert over the live before-snapshot
(`UPSERT_INSERT`, `UPSERT_UPDATE`), and true idempotency is proven by re-planning against the
projected-after state, which yields **zero** new inserts (`IDEMPOTENCY`).

---

## Running it against the staging spreadsheet

> **Prerequisite:** run the Stage 3 bootstrap workflow (`docs/STAGE3_SHEETS_BOOTSTRAP.md`) against the
> same staging spreadsheet first, so all 40 contract tabs and the contract-hash marker exist.

### 1. Import
In n8n: *Workflows → Import from File* → select
`ops/n8n/workflows/qa_stage3_sheets_operations_acceptance.json`. It imports **inactive**. Keep it inactive.

### 2. Select the credential (no new credential)
On **every** HTTP Request node — all **7**: *Get Spreadsheet Metadata*, *Get Header Rows*, *Get Before
Snapshot*, *Expand Grid (spreadsheets:batchUpdate)*, *Apply Writes (values:batchUpdate)*, *Get After
Snapshot*, *Get Request-A Cell Types* — select the existing **“Google Sheets - Marketing Scout Service
Account”** credential. On that Google
Service Account credential, enable *“Set up for use in HTTP Request node”* and restrict allowed domains to
`https://sheets.googleapis.com`. The workflow contains **no credential id** — selection is manual.

### 3. Replace the placeholder
In *Set QA Config*, set `spreadsheet_id` to your **staging** spreadsheet ID (the file ships with
`PASTE_STAGING_SPREADSHEET_ID`; the Init node throws if you forget). Never point it at a production sheet.

### 4. Dry-run first (default, no mutation)
Leave `execute_writes = false` **and** `confirm_staging_spreadsheet = false`. Execute the workflow.
It reads metadata + the before-snapshot, plans every operation, and **sends nothing**. The *Verify & Report*
item shows `CHANGES_APPLIED = false`, `WRITE_PLAN = PASS`, and `NEXT_DATA_ROWS` (the physical append rows the
live write *would* use). In a dry-run the live-operation markers read **`NOT_EXECUTED_DRY_RUN`** — they are
**not** reported as `PASS`, because nothing was written or read back yet.

### 5. Confirm staging, then the first live write
Set **both** `execute_writes = true` **and** `confirm_staging_spreadsheet = true`, then run again.
Writes require *both* flags **and** a clean preflight (40 tabs present, matching contract hash, required
test columns present). The single `values:batchUpdate` (USER_ENTERED) appends/updates only this run’s
clearly-tagged rows at their **physical** data rows; the header row (row 1) is never written, and only the
5 test sheets are targeted. If an append would land beyond a sheet’s grid capacity, the *Expand Grid* node
first grows **only that sheet** (`updateSheetProperties`, `rowCount` up). Live-operation markers become
`PASS` only after the write succeeds **and** the after-snapshot is re-read and verified (then
`CHANGES_APPLIED = true`).

### 6. Locate the QA rows
In each test sheet, filter the marker column (e.g. `agent_requests.notes`) for your `QA_RUN_ID`
(copy it from the Report item). Every row you find is tagged `data_mode=manual_test` and is traceable to
that run id, owner, and role.

### 7. Repeat-run (idempotency)
Copy `QA_RUN_ID` from the Report into `reuse_qa_run_id`, keep both write flags true, and run again.
The Report must show every `DUPLICATE_*_CREATED = 0`, `UPSERT_ROW_COUNT_STABLE = PASS`, and
`IDEMPOTENCY = PASS`. The repeat run rewrites its own rows in place (and suppresses the outbox delivery by
`delivery_id`); it never creates a duplicate.

### 8. Verify formula-injection + isolation
- **Formula injection:** open request A’s row. The cells `query / plan_summary / result_summary / next_action`
  show the literal text `=1+1`, `+SUM(1,1)`, `@IMPORTXML(...)`, `-CMD|' /C calc'!A0` — **not** evaluated
  results. `estimated_source_cost_usd = -5` and `estimated_analysis_cost_usd = -4.5` remain real negative
  numbers (not text). Markers: `FORMULA_INJECTION_NEUTRALIZATION = PASS`, `NEGATIVE_NUMBER_PRESERVATION = PASS`.
  This is verified two ways and they are **separate** assertions: (a) the contract-aware read-back proves the
  *value* matches, and (b) a **bounded typed read** (*Get Request-A Cell Types* → `spreadsheets.get?
  includeGridData=true`, `fields=…userEnteredValue,effectiveValue,formattedValue`, scoped to request A's single
  row) proves Google stored each formula-bearing cell as `userEnteredValue.stringValue` and **not**
  `userEnteredValue.formulaValue`. `FORMULA_INJECTION_NEUTRALIZATION = PASS` requires *both*; the detail is in
  `FORMULA_SAFETY_DETAILS`.
- **Isolation:** the harness filters `conversation_state` to owner A and `agent_requests` to request A and
  asserts nothing foreign is returned. Google Sheets has no server-side row ACL, so this is enforced by a
  **strict post-read assertion** (the limitation is explicit). Markers: `OWNER_ISOLATION = PASS`,
  `REQUEST_ISOLATION = PASS`, `FOREIGN_ROWS_RETURNED = 0`.

---

## Live retest sequence (QA-018 / QA-019 closure)

QA-018 and QA-019 are **FIXED IN CODE — LIVE RETEST REQUIRED**. Run the following four executions, in order,
against the staging spreadsheet to close them. Record the Report item from each run.

1. **Dry-run** — `execute_writes=false`, `confirm_staging_spreadsheet=false`, leave `reuse_qa_run_id` empty.
   Expect: `WRITE_PLAN=PASS`, `NEXT_DATA_ROWS` populated, all live-operation markers `NOT_EXECUTED_DRY_RUN`,
   `WRITE_NODE_EXECUTED=false`, `CHANGES_APPLIED=false`, `RESULT=PASS`.
2. **First live write, new `QA_RUN_ID`** — set `execute_writes=true` **and** `confirm_staging_spreadsheet=true`,
   leave `reuse_qa_run_id` empty (a fresh run id is generated). Expect the closure markers below, plus
   `EXPECTED_ROWS_WRITTEN=7` and `UNEXPECTED_ROWS_WRITTEN=0`. Copy the `QA_RUN_ID`.
3. **Repeat live write, same `QA_RUN_ID`** — paste the copied id into `reuse_qa_run_id`, keep both write flags
   true. Expect every `DUPLICATE_*_CREATED=0`, `UPSERT_ROW_COUNT_STABLE=PASS`, `IDEMPOTENCY=PASS` (no new rows),
   and the same closure markers.
4. **Final dry-run** — flip `execute_writes=false`, `confirm_staging_spreadsheet=false`. Expect a clean plan over
   the now-populated sheet: `WRITE_PLAN=PASS`, live markers `NOT_EXECUTED_DRY_RUN`, `RESULT=PASS`.

**Live closure markers** (runs 2 and 3 must show all of):

```
READ_BACK_AGENT_REQUEST = PASS
BEFORE_AFTER_SCOPE      = PASS
ACCEPTANCE_VERIFIED     = true
RESULT                  = PASS
```

with the scope evidence:

```
EXPECTED_ROWS_WRITTEN    = 7
UNEXPECTED_ROWS_WRITTEN  = 0
FOREIGN_ROWS_MODIFIED    = 0
HEADERS_MODIFIED         = 0
UNDECLARED_TABS_MODIFIED = 0
```

and on the repeat run `IDEMPOTENCY = PASS` with `0` duplicates of every kind. Only after these four runs may
QA-018 / QA-019 be marked closed; until then they remain **FIXED IN CODE — LIVE RETEST REQUIRED**.

---

## How write rows are chosen (physical occupied rows + capacity)

Write positions are derived from the **physical rows in the actual before-snapshot**, never from the grid’s
preallocated size. The algorithm, per test sheet:

1. Read the full table (`A1:lastCol`) with `values:batchGet`; row 1 is the header.
2. A returned data row counts as **occupied** only if at least one of the sheet’s **identity columns** is
   non-blank (`agent_request_id`, `conversation_id`, `source_id`, `delivery_id`, …). Cells that are blank on
   the identity columns — e.g. a bootstrap **checkbox default `FALSE`** sitting in a preallocated row, or a
   trailing empty row — are **not** occupied.
3. `last_occupied_row` = the highest physical row that is occupied (header counts as row 1);
   `next_free_row` = `last_occupied_row + 1` (never below 2).
4. **Insert** → write at `next_free_row` (advancing per insert). **Update** (matched canonical key) → rewrite
   that key’s **exact physical row**, preserving sparse layouts. **Dedup** (`telegram_outbox`) → suppress.
5. The grid’s `gridProperties.rowCount` is used **only** as a capacity limit. If a target row would exceed it,
   the *Expand Grid* node first grows **only the affected sheet** (`updateSheetProperties` → larger
   `rowCount`; capacity only ever increases) before the values write. Sheets within capacity are never touched.

| Situation | Behavior |
|-----------|----------|
| Header-only sheet (incl. 999 preallocated `FALSE` checkbox rows, grid 1000) | next data row = **2** (the prior bug emitted `A1001`, exceeding the 1000-row grid). |
| Rows 1–7 occupied | next data row = **8**. |
| Trailing empty rows after the last real row | ignored — they do not move the append point. |
| Existing canonical key on physical row *N* | **updated in place at row *N***; no duplicate, no new row. |
| Occupied count == grid capacity | one bounded `updateSheetProperties` grows that sheet’s `rowCount` **before** the write; no delete/clear/shrink. |

This is what the live failure surfaced: a header-only `agent_requests` whose bootstrap left checkbox-default
`FALSE` cells down to row 1000 was mis-counted as 999 occupied rows, so the old logic appended at `A1001`
(one past the grid). Occupancy is now identity-based and rows are physical, so the first append is `A2`.

---

## Reading the markers (Section 9 summary)

The Report node returns one machine-readable item. `RESULT` is **derived** from the sub-markers — it is
never hard-coded. **Truthfulness:** the *live-operation* markers below (everything from `APPEND_AGENT_REQUEST`
through `IDEMPOTENCY`) are reported as `PASS`/`FAIL` **only after a real write + after-snapshot read-back**.
In a dry-run they read **`NOT_EXECUTED_DRY_RUN`**; when preflight blocked, **`NOT_APPLICABLE`**; when formula
tests are disabled, the two formula/negative markers read `SKIPPED`.

| Marker | Meaning |
|--------|---------|
| `PREFLIGHT` | `PASS` only if all 40 tabs present, contract hash matches the bootstrap marker, and every required test column exists. |
| `CONTRACT_TABS_PRESENT` | how many declared tabs were found in the staging spreadsheet. |
| `SHEETS_READ` | metadata + before-snapshot reads succeeded. |
| `WRITE_PLAN` | plan-level guarantees knowable without writing: every range targets a data row (≥ 2), only the 5 test sheets, no destructive request, planned cells neutralized, and the plan is idempotent. Can be `PASS` in a dry-run; `NOT_APPLICABLE` when blocked. |
| `NEXT_DATA_ROWS` | the physical next-free data row chosen per sheet (e.g. `{agent_requests: 2}`). Derived from occupied rows, never grid capacity. |
| `GRID_EXPANSIONS` | per-sheet `{from,to}` capacity growth the run will perform at the boundary (usually `{}`). |
| `WRITE_NODE_EXECUTED` | the values:batchUpdate node actually ran (a live write was attempted). `false` on a dry-run. |
| `WRITE_REQUEST_SUCCEEDED` | Google returned 2xx for the values write. `false` if the request was rejected. |
| `MUTATIONS_EXECUTED` | the write node ran, the request succeeded, **and** the plan carried ≥1 mutation — i.e. Google applied changes. |
| `AFTER_SNAPSHOT_READ` | the after-snapshot was re-read so the result could be verified. |
| `ACCEPTANCE_VERIFIED` | after a real write + after-read, **every** live-operation marker passed and all scope guards are zero. This is the verification verdict — it is `false` if read-back or scope failed even though the mutation was applied. |
| `APPEND_AGENT_REQUEST` / `READ_BACK_AGENT_REQUEST` | request A was appended and read back **field-for-field via the contract-aware comparator** — numeric columns compared numerically (`-5 == "-5.00"`), checkbox columns as booleans (`false == "FALSE"`), timestamps as instants, formula cells as literal text — so Google's re-rendering (number format, `TRUE`/`FALSE`) is not a false mismatch. Mismatches are listed in `READ_BACK_FAILURES`. |
| `APPEND_REQUEST_EVENT` | an event row linked to request A was appended with a valid state transition. |
| `UPSERT_INSERT` / `UPSERT_UPDATE` / `UPSERT_ROW_COUNT_STABLE` | conversation_state inserted once, updated in place (key stable, `current_state` changed), still exactly one row. |
| `TRACKED_SOURCE_UPSERT` | tracked_sources inserted once then lifecycle-updated (`status` active→paused), one row. |
| `OUTBOX_IDEMPOTENCY` | exactly one outbox row for the deterministic `delivery_id`; re-enqueue adds nothing. |
| `OWNER_ISOLATION` / `REQUEST_ISOLATION` / `FOREIGN_ROWS_RETURNED` | owner A’s view excludes owner B; request A’s view excludes request B; zero foreign rows leaked. |
| `FORMULA_INJECTION_NEUTRALIZATION` / `NEGATIVE_NUMBER_PRESERVATION` | formula strings stored as text — proven by the planned neutralization **and** the typed `spreadsheets.get` read (`userEnteredValue.stringValue`, never `formulaValue`); finite negatives stay numeric. (`SKIPPED` if `formula_tests_enabled = false`.) Typed detail in `FORMULA_SAFETY_DETAILS`. |
| `BEFORE_AFTER_SCOPE` | only this run’s expected rows were added/updated, judged **by row identity** (not byte equality), so Google's normalization of the run's *own* rows is not mistaken for a foreign change. PASS requires every expected insert/update present, zero unexpected QA rows, foreign rows + foreign-owner rows unchanged, headers unchanged, and undeclared tabs untouched. Violations are listed in `BEFORE_AFTER_FAILURES`. |
| `EXPECTED_ROWS_WRITTEN` / `UNEXPECTED_ROWS_WRITTEN` | rows this run added vs. any it should not have (`0`). |
| `CURRENT_RUN_OWNED_ROWS` / `PREVIOUS_QA_RUN_ROWS` / `FOREIGN_NON_QA_ROWS` | three-way classification of after-rows: this run's rows / earlier QA-run rows / unrelated business rows. Only the first group may be written; the other two must be unchanged. |
| `FOREIGN_ROWS_MODIFIED` / `HEADERS_MODIFIED` / `UNDECLARED_TABS_MODIFIED` | other owners/requests untouched (`0`); header row unchanged (`0`); no tab outside the 5 test sheets written (`0`). |
| `DUPLICATE_AGENT_REQUESTS_CREATED` / `_CONVERSATION_STATES_` / `_TRACKED_SOURCES_` / `_OUTBOX_DELIVERIES_` | duplicates a repeat run would create (`0`). |
| `IDEMPOTENCY` | re-planning against the **real after-snapshot** yields zero new inserts (in a dry-run this is `NOT_EXECUTED_DRY_RUN`; the plan-level idempotency is folded into `WRITE_PLAN`). |
| `EXTERNAL_NON_GOOGLE_CALLS` | always `0` — no Telegram/Apify/Firecrawl/VK/Claude call is made. |
| `CHANGES_APPLIED` | `true` whenever Google **applied** the mutation (`MUTATIONS_EXECUTED`), **independent** of whether verification later passed. A failed read-back or scope check sets `ACCEPTANCE_VERIFIED=false`/`RESULT=FAIL` but leaves `CHANGES_APPLIED=true` — a verification failure must never falsely imply Google wrote nothing. `false` on a dry-run, when blocked, or when the write request was rejected. |
| `QA_RUN_ID` / `DATA_MODE` | the generated run id; always `manual_test`. |
| `RESULT` | dry-run (write node never ran): `PASS` when `PREFLIGHT`+`SHEETS_READ`+`WRITE_PLAN` pass (plan is valid). Live (write node executed): the verdict is **acceptance-based** — `PASS` only when `ACCEPTANCE_VERIFIED=true`; `FAIL` if the write was rejected **or** any read-back/scope check tripped (it never falls back to the dry-run success path). `BLOCKED_PREFLIGHT` if a preflight gate failed (no write attempted). |

---

## Why rows are retained (no cleanup here)

This harness **does not delete or clear** anything. Created QA rows are intentionally **retained** so they
can serve as fixtures for the separate **retention / archival** acceptance work — that step verifies how
the persistence layer ages and prunes rows by retention class, and it needs real manual_test rows to act
on. Cleanup is therefore out of scope here and handled by retention testing. Because every QA row is tagged
`data_mode=manual_test` with its `qa_run_id`, it is trivially filterable and removable later.

---

## Safety confirmations

- **No external collectors / messaging:** tracked_sources uses an RFC-2606 example domain and **no**
  collector runs; telegram_outbox writes a DB row only and **no** Telegram message is sent. The summary’s
  `EXTERNAL_NON_GOOGLE_CALLS` is always `0`. The only external host is `https://sheets.googleapis.com`.
- **No destructive operations:** row writes are a single `values:batchUpdate` (USER_ENTERED) to explicit
  data-row ranges (row ≥ 2). The **only** structural request is a bounded `updateSheetProperties` that
  **increases** a single sheet’s `gridProperties.rowCount` at the capacity boundary — capacity only ever
  grows. There is no `deleteSheet` / `deleteRange` / `deleteDimension`, no `values:clear`, no `batchClear`,
  and capacity is never shrunk.
- **Inactive, manual-only, no secrets:** the workflow is `active: false`, has exactly one Manual Trigger,
  no webhook, no credential id, and no real spreadsheet id (placeholder only). It is excluded from the
  production manifest and validators.
- **Drift-proof:** the contract snapshot + engine are embedded by the generator. Edit the contract or the
  engine and **regenerate** (`node tools/gen_sheets_operations_qa_workflow.js`); never hand-edit the JSON.
  `tests/run_all.js` fails on any drift.

---

## Replacing a previously-imported (broken) workflow in n8n

If you imported an earlier copy that wrote `agent_requests!A1001`, replace it — the generated JSON now has a
new `versionId` and two extra nodes (*Expand Grid?* and *Expand Grid (spreadsheets:batchUpdate)*):

1. **Regenerate** locally: `node tools/gen_sheets_operations_qa_workflow.js` (then `node tests/run_all.js` to
   confirm green). This rewrites `ops/n8n/workflows/qa_stage3_sheets_operations_acceptance.json`.
2. In n8n, open the old **“QA - Stage 3 Google Sheets Operations Acceptance”** workflow. Because it is
   inactive and manual-only, deleting or overwriting it affects nothing in production. Either:
   - **Delete** the old workflow, then *Workflows → Import from File* the regenerated JSON; or
   - open the old workflow → *⋯ menu → Import from File* → select the regenerated JSON to overwrite the
     canvas in place.
3. Re-select the **“Google Sheets - Marketing Scout Service Account”** credential on **all six** HTTP Request
   nodes (the import does not carry credential ids) and re-paste your **staging** `spreadsheet_id` in
   *Set QA Config*.
4. Keep the workflow **inactive**. Run a dry-run first (`execute_writes = false`), confirm
   `WRITE_PLAN = PASS` and `NEXT_DATA_ROWS` shows `2` for a freshly-bootstrapped sheet, then do the gated
   live write as in steps 5–8 above.

No history rewrite, no production workflow, and no activation is involved — this is a plain re-import of an
inactive QA workflow.
