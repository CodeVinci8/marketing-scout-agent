# WF18 Gateway Rearchitecture — Handoff for the next focused session

**Why this is separate:** Stage 8 release-core is done and offline-proven, but the Telegram gateway (WF18) is
**not safe to publish**. `tools/wf18_activation_gate.js` mechanically blocks WF18 activation until every P0/P1
item in `config/wf18_blockers.json` is resolved **with a named regression test**. This document is the exact work
order. Do **not** publish WF18 or run live Telegram calls until the gate is OPEN.

## Operating constraints (unchanged)

Inactive-only; `active=false` for all workflows; no production mutation; no live Telegram/Google/Claude calls; no
secrets/raw ids in Git/logs/argv; `$0`; deterministic generators; commit on a branch, do not push/merge unless
asked. Resolve each blocker = real code + fixture test, then flip its `status` to `resolved` with the test name in
`evidence` (the gate rejects "resolved without evidence").

## Recommended order (each item: code + a `tests/test_wf18_*.js` regression, then flip the registry entry)

### 1. Security gates BEFORE any side effect (P0)
- **SECURITY-001 / TELEGRAM-002** webhook secret: validate `X-Telegram-Bot-Api-Secret-Token` against
  `MS_TELEGRAM_WEBHOOK_SECRET` as the FIRST node after the Webhook node — before any Sheets read, state change,
  sub-workflow, or `sendMessage`. Negative test: wrong/missing secret ⇒ no side effects, fast 2xx.
- **TELEGRAM-003** kill switch: `MS_ENABLE_TELEGRAM=false` stops before side effects with a safe response.
- **TELEGRAM-004** auth gate: `decision=unauthorized` must not reach Build Context / any Append / Persist State.
  Move the authorization gate ahead of all private-data reads/writes. Assert exact nodes NOT executed.
- **TELEGRAM-005 / IDEMP-001** duplicate-update stop: a duplicate creates no rows, no state change, no dispatch.

### 2. Topology: plan → approval → orchestrate (P0/P1)
- **RUNTIME-001** wire `WF18 → WF19 (planner) → approval keyboard → WF20 (orchestrator)`; today WF18 ends at Send
  Reply. Use the existing Execute Sub-workflow triggers + manifest binding edges (add new edges to
  `config/workflow_manifest.json` POLICY + regenerate; the binder/audit/tests will pick them up).
- **RUNTIME-002** add Execute Sub-workflow Triggers + input contracts to WF19/WF20/WF21/WF22 where the gateway
  must call them; topology audit should fail when a declared-callable lacks a trigger.
- **TELEGRAM-007** real approval keyboard carrying the real `agent_request_id`; **TELEGRAM-006** `answerCallbackQuery`.
- **RUNTIME-003** capability→workflow dispatch matrix: every advertised capability has a real route or an honest
  "unavailable" — never a generic "ready to help". Contract test over the capability registry.

### 3. State machine + once-only dispatch (P0/P1)
- **STATE-004** durable once-only marker (approval consumed / orchestrator dispatched / dispatch idempotency key)
  so repeated approve callbacks invoke WF20 at most once. Must survive restart/re-import (not workflow static data).
- **STATE-001** use the accepted transition result so the persisted event and current state agree.
- **TELEGRAM-013/014** stale/expired approval callbacks + re-checked authorization at action time.

### 4. Memory + Sheets shaping (P1)
- **MEMORY-001** patch existing conversation state instead of overwriting with `newConversationState`.
- **DATA-001** add explicit Shape nodes before every Append (flat rows matching `config/sheets_contracts.json`;
  no nested objects into `autoMapInputData`).

### 5. Idempotency, concurrency, isolation (P1)
- **IDEMP-001** production-grade dedupe (n8n Data Store / DB uniqueness), surviving restart/re-deploy.
- **SECURITY-006** cross-user isolation proof (one allowed user cannot reach another's memory/request/callback).

## How to prove it offline (no live calls)
Mirror the Stage 5/6/7 pattern: pure decision libs in `n8n/lib/` + fixture-driven `tests/test_wf18_*.js`
exercising the REAL code paths, then thread them into the WF18 generator (`tools/gen_stage4_workflows.js`) and
assert via the generated-code compile gate + a topology test that proves the **absence of side effects** for each
negative scenario (§15.5 lists 35 scenarios), not just `start_work=false`.

## Opening the gate
When all 19 registered P0/P1 blockers are `resolved` with evidence, `node tools/wf18_activation_gate.js` prints
`WF18_REARCHITECTURE=READY` and `deploy_n8n.sh --activate-triggers` will allow WF18. Only then proceed to the
controlled live acceptance checklist (§17): preflight → publish WF18 only → register webhook+secret → controlled
`/start` → exact-row checks → approve-once → reject/cancel/stale → deactivate → rollback.

## Then: disposable + production + live (operator-run)
Run `make release-smoke` (disposable import/reimport/bind), `make deploy-inactive` + `make verify-production`
(real export reconciliation via `runtime_ids.js resolve --apply` and `reconcile_credentials.js`), then the gated
`make telegram-activate`. These flip `DISPOSABLE_IMPORT`, `WORKFLOW_VERSION_SEMANTICS`, `TELEGRAM_PRELIVE`,
`CONTROLLED_LIVE_ACCEPTANCE` from `OPERATOR_PENDING` to PASS, after which `STAGE8_RELEASE_ENGINEERING=PASS` may be
asserted.
