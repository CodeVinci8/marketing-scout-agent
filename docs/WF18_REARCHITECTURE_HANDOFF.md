# WF18 Gateway Rearchitecture — Handoff for the next focused session

> **RESOLVED IN CODE — DEC-161 (session 29, branch `fix/wf18-gateway-rearchitecture`).** WF18 is now a real
> fail-closed secure dispatcher: webhook-secret + `MS_ENABLE_TELEGRAM` + auth + supported-type + private-chat
> hard-stops BEFORE any side effect; a real `executeWorkflow` dispatcher to WF19/20/21/22/24; callable children
> with named contracts; a durable `execution_plans` store with plan persisted **before** approval and approval
> bound by owner/chat/plan_hash; shaped Sheets writes; callback ack; cross-user isolation; `request=t.record`.
> **18 of 19 P0/P1 blockers resolved with named regression tests** (mostly `tests/test_wf18_real_topology.js`,
> 85 checks). `make test` ALL SUITES PASS ($0, 0 external calls, 0 active workflows).
>
> **Still OPEN (by design):**
> - **TELEGRAM-001** — public HTTPS webhook URL / ingress. This is **operator infrastructure** (sing-box / port
>   443), not a repo change, so `tools/wf18_activation_gate.js` correctly still reports `WF18_REARCHITECTURE=PENDING`
>   and refuses to activate WF18. The code is *dispatcher-ready*, not yet *live-ready*.
> - **IDEMP-001 caveat** — the durable idempotency CLAIM happens before any persistence/dispatch and uses a
>   deterministic key (sequential-duplicate proven). TRUE concurrent atomicity additionally requires running WF18
>   at **single concurrency** in this n8n install (set the workflow/instance concurrency to 1) — there is no
>   atomic compare-and-set primitive in n8n 2.23.3 Sheets. Document/enforce concurrency=1 at deploy.
> - **ORCH-STATE-001 partial** — WF20/WF21 enforce approved/not-cancelled at the entry gate; a per-stage
>   cancellation re-read between long-running collection/analysis stages is a documented follow-up.
> - **RELEASE-006 / DISCOVERY-001** — production export-capture (`make release-discovery`/dry-run) is unchanged;
>   they still block `make deploy-inactive`/`make telegram-activate`. Not touched this session (no production
>   dry-run was run, per the no-prod-mutation rule).

---


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
The release path is now one shared, ordered pipeline (the `fix/stage8-release-integration` repair), so the
operator sequence is **discovery → resolve IDs → preflight → dry-run → backup → apply inactive → verify** — ids are
resolved as part of the deploy, never after it. Run, in order:

1. `make release-smoke` — disposable acceptance via the SAME shared pipeline (already **DISPOSABLE_DEPLOY=PASS**
   against real n8n 2.23.3 in the integration repair).
2. `make deploy-dry-run` — production-target discovery + id resolution + reconcile + ordered plan (fail-closed).
3. `make deploy-inactive` — the full inactive release (lock→resolve→reconcile→preflight→backup→import staged→bind→
   verify→evidence); `make verify-production` confirms 15 workflows / exact-name count 1 / resolved ids / all
   inactive / creds valid / 8 edges bound / zero placeholders.
4. Only after the WF18 gate is OPEN: the gated, transactional `make telegram-activate` (WF18 only).

These flip `WORKFLOW_VERSION_SEMANTICS`, `TELEGRAM_PRELIVE`, `CONTROLLED_LIVE_ACCEPTANCE` from `OPERATOR_PENDING`
to PASS, after which `STAGE8_RELEASE_ENGINEERING=PASS` may be asserted.
