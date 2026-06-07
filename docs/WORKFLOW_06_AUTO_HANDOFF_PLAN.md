# WORKFLOW_06_AUTO_HANDOFF_PLAN.md — Auto-Handoff (06 → 04) Feasibility & Design

**Date:** 2026-06-07
**Decision:** 🟥 **DEFERRED — not implemented in this pass.** Manual handoff remains the Stage 2 approved
path. Auto-handoff is scheduled as **Stage 2.4** (a future improvement, before the Telegram Control Bot).
**Why a plan and not code:** a *safe* implementation is non-trivial and **cannot be live-tested in this
environment** (no n8n runtime, no external API calls). The task is explicit: *"Do not force an unsafe
auto-handoff. Stability is more important than removing one manual copy step before Stage 3."*

---

## 1. Goal

Remove the one manual step where the operator copies Workflow 06's `Set URL List` block into Workflow 04 —
**without** duplicating Workflow 04's Firecrawl+Claude analyzer logic and **without** destabilizing the proven
manual pipeline.

## 2. Current state (inspected)

- **Workflow 04** (`04_firecrawl_url_list_resilient.json`): 25 nodes, `active=false`. Entry = `Manual Start`
  → `Set URL List` (code) → `Loop Over Items` (splitInBatches) → dedup → Firecrawl → resilient Claude
  (primary → repair → fallback) → `Normalize + Route` → three sink appends (`Append Skipped Log`,
  `Append url_registry`, `Append to Dynamic Route Sheet`). Output business row is **locked to exactly 35
  fields**. **`source_candidate_id` is NOT present anywhere in Workflow 04.** No Execute Workflow Trigger.
- **Workflow 06** (`06_approved_candidates_runner.json`): `active=false`. Reads url_candidates, re-reads
  url_registry, selects (runner modes), emits a per-item batch (already shaped with `target_url`,
  `source_candidate_id`, `discovery_request_id`, `candidate_type`, `service_hint`, `run_id`, `batch_index`)
  and a paste-ready `Set URL List` block. `processing_mode=manual_handoff_to_workflow_04`. A disabled
  `Mark Candidates Processed` node exists (sets `approval_status=processed`) — **disabled by design**.

## 3. Preferred design (when implemented in Stage 2.4)

A **callable entry path on Workflow 04**, manual mode preserved:

1. **Workflow 04 — add an `Execute Workflow Trigger` node** as a *second* entry that feeds the **same**
   `Loop Over Items` node (multiple inbound connections are allowed). `Manual Start` + `Set URL List` stay
   exactly as-is. The callable trigger accepts items:
   `target_url, source_candidate_id, discovery_request_id, candidate_type, service_hint, runner_run_id,
   batch_index, force_reprocess`. **No analyzer node is duplicated** — both entries converge on the existing
   chain.
2. **Workflow 04 — thread identity through without breaking the 35-field sheet schema.** `source_candidate_id`
   / `discovery_request_id` / `runner_run_id` must ride alongside each item through the loop and branches
   (dedup-skip, firecrawl-error, primary, repair) to a **new, separate `Build Callable Response` node** that
   emits a *non-sheet* per-candidate result `{ source_candidate_id, target_url, route, processing_status,
   entity_type }`. This response is **only** returned to the caller; it is **not** appended to the six
   business tabs, so the **35-field business row stays 35 fields** and the manual path is unaffected.
3. **Workflow 06 — add `processing_mode=auto_execute_workflow_04`** (config alongside `runner_mode`),
   **default stays `manual_handoff_to_workflow_04`**. In auto mode WF06 routes selected items into an
   **Execute Workflow** node targeting Workflow 04 (by workflow id — a local instance value, committed as a
   placeholder `PASTE_WORKFLOW_04_ID_HERE`, never a real id).
4. **Workflow 06 — confirm-then-mark.** Only **after** Workflow 04 returns, WF06 maps each response back to its
   `source_candidate_id` and updates `url_candidates`:
   - `processing_status=parsed_success` (or a successful `business_skip`) → `approval_status=processed`
     (append `Processed by Workflow 06 run_id=…` to notes);
   - `processing_status=technical_error` → `approval_status=error` (or stay `approved` with an explanatory
     note — implementation-safety choice), **never** `processed`.
   Nothing is marked processed before Workflow 04 confirms.

## 4. Hard safety rules (carried from the task; must hold in any implementation)

- Do **not** duplicate Workflow 04 analyzer logic inside Workflow 06.
- Do **not** break manual Workflow 04 usage (`Manual Start` + `Set URL List` remain).
- Do **not** remove `manual_handoff_to_workflow_04` unless auto mode is fully tested; keep it as fallback.
- Keep `active=false`. Keep `max_per_run=5`. Keep the runtime `url_registry` recheck.
- Never auto-process anything without `approval_status=approved`.
- Never mark a candidate `processed` before Workflow 04 confirms processing.

## 5. Blockers / risks (why deferred now)

1. **No identity threading exists.** `source_candidate_id` is absent throughout Workflow 04. Threading it (and
   `discovery_request_id`/`runner_run_id`) through a 25-node branching, looped analyzer touches ~8–10 nodes
   across 4 branches — meaningful surface area on a **proven, approved** workflow.
2. **35-field invariant tension.** The confirm-then-mark loop needs a per-candidate response carrying
   `source_candidate_id`, but the business sheet row must stay exactly 35 fields. This requires a *separate*
   response node and careful wiring so the callable output never pollutes the sheet schema.
3. **Execute Workflow return semantics + loop.** Workflow 04 uses `splitInBatches` with three append sinks;
   getting a clean, ordered, per-candidate response set back to the caller (mapped to `source_candidate_id`)
   needs a dedicated aggregation node and validation.
4. **Cannot be live-tested here.** The entire value of auto-handoff is the *confirm-then-mark* safety
   property, which is exactly the part that must be validated against a live n8n run with real Firecrawl/Claude
   results. This environment forbids external calls, so the riskiest behavior would ship untested.
5. **Local instance coupling.** The Execute Workflow node needs Workflow 04's real workflow id (a per-instance
   value), adding a rebind step similar to credential IDs.

## 6. Decision

Per the decision branch ("if non-trivial or risky → do not implement now"), **defer**. Manual handoff is the
Stage 2 approved limitation. Auto-handoff becomes **Stage 2.4** and must be built + **live-validated** with the
confirm-then-mark path before it can replace manual handoff. The default `processing_mode` will remain
`manual_handoff_to_workflow_04` even after auto mode is added.

## 7. Acceptance criteria for Stage 2.4 (when picked up)

- Workflow 04 callable trigger added; manual path byte-for-byte preserved; analyzer not duplicated; business
  row still **35** fields; `url_registry` still **10** fields.
- Workflow 06 `processing_mode=auto_execute_workflow_04` added; default still manual; `max_per_run=5`,
  registry recheck, runner modes intact.
- Live test: approve N fresh URLs → run WF06 in auto mode → WF04 processes → WF06 marks each candidate
  `processed` **only** on success, `error`/`approved+note` on `technical_error`; no candidate marked before
  confirmation; duplicates still skipped by the registry recheck.
