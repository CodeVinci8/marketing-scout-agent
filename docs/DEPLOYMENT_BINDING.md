# Deployment & automatic sub-workflow binding (QA-001/002/003/009)

The runtime workflow set, import order, the eight Execute Sub-workflow edges, and the activation policy all come
from **one machine-readable source of truth** — `config/workflow_manifest.json` — read through
`tools/manifest_lib.js`. No script keeps its own hand-maintained workflow list.

```bash
node tools/manifest_lib.js runtime-count     # 15
node tools/manifest_lib.js binding-count      # 8
node tools/manifest_lib.js callable-count     # 6
node tools/manifest_lib.js import-order        # deterministic order, one file per line
node tools/manifest_lib.js plan-json           # full machine-readable plan
node tools/validate_workflow_manifest.js       # fail-closed validator (rejects a broken manifest)
```

## Runtime closure (15 workflows)

Roots = the Stage-4 entrypoints/orchestration (WF17–WF26). Closure = roots ∪ every workflow they reach through an
Execute Sub-workflow node. That pulls in the Stage 1–3 callables WF04/08/10/12/16 and the VK collector WF26:

```
WF04 WF08 WF10 WF12 WF16 WF17 WF18 WF19 WF20 WF21 WF22 WF23 WF24 WF25 WF26
```

Test/manual/diagnostic workflows (00–03, 05–07, 09, 11, 13–15, the 02_* variants) are **excluded** and never
enter the production runtime set.

## n8n 2.23.3 import requires a workflow id

Proven in a disposable container: `n8n import:workflow` on an id-less template fails with
`NOT NULL constraint failed: workflow_entity.id`. The committed templates intentionally carry no id, so deploy and
the smokes **stage** them first with a deterministic, reproducible id
(`tools/stage_runtime_workflows.js`, e.g. WF04 → `00000000-0000-4000-8000-000000000004`). Stable ids also make
import idempotent (re-import updates the same row) and let the binder resolve every edge by exact name.

Import always uses `--activeState=false`, which (per QA-012) deactivates every imported workflow regardless of its
JSON `active` field — imports can never accidentally activate anything.

## The eight binding edges

After import, each caller's Execute Sub-workflow node still references `PASTE_WORKFLOW_ID`.
`tools/bind_n8n_workflow_ids.js` rewrites that value to the **real assigned id** of the target, matched by **exact
workflow name** and **exact caller-node name** (never by node-array position, never by substring):

```
WF20 :: Run Website Source (WF04)     -> WF04
WF20 :: Run WF16 Quality Gate         -> WF16
WF20 :: Run WF08 Analyzer             -> WF08
WF20 :: Run WF10 Aggregator           -> WF10
WF20 :: Run WF12 Report               -> WF12
WF21 :: Collect Deep Evidence (WF04)  -> WF04
WF23 :: Run Website Check (WF04)      -> WF04
WF23 :: Run VK Check (WF26)           -> WF26
```

The binder is **fail-closed** — it rejects missing/empty/duplicate/ambiguous workflow names, an absent caller
node, a caller node of the wrong type, or a missing target — and **idempotent** (a second run rewrites nothing).
It emits a machine-readable report:

```json
{ "bindings_expected": 8, "bindings_resolved": 8, "placeholders_remaining": 0,
  "missing_targets": 0, "ambiguous_targets": 0, "duplicate_workflows": 0, "all_inactive": true }
```

The committed templates keep their `PASTE_WORKFLOW_ID` placeholders — binding happens only at deploy/disposable
time against assigned ids, never in the repo.

## Deploy command surface

```
scripts/deploy_n8n.sh --check-config        # fail-closed runtime-config preflight
scripts/deploy_n8n.sh --dry-run             # validate + soft preflight + full plan (default; no changes)
scripts/deploy_n8n.sh --apply [--yes]       # stage(ids) → import inactive → auto-bind → verify; never activates
scripts/deploy_n8n.sh --verify-bindings     # export + confirm 8 edges bound, zero placeholders
scripts/deploy_n8n.sh --plan-triggers       # which triggers WOULD activate (no changes)
scripts/deploy_n8n.sh --activate-triggers   # activate ONLY trigger workflows (fail-closed zlib preflight first)
scripts/deploy_n8n.sh --deactivate-triggers # rollback of activation
scripts/deploy_n8n.sh --status              # imported runtime workflows + active state
```

`--apply` imports and binds only — it **never** activates. Activation is a separate, explicit, operator-only step.

## Parent → child at runtime (QA-003)

The deployment artifacts are runtime-correct: after import + bind + export in disposable n8n 2.23.3, each caller's
Execute Sub-workflow node resolves to the child's real assigned id, every callable target carries an Execute
Sub-workflow Trigger, and the named input contract matches on both sides.

Note (proven): the CLI `n8n execute` harness refuses to invoke an **inactive** database sub-workflow ("Workflow is
not active and cannot be executed"). Production does not use CLI execute — callable sub-workflows are invoked by
the **server runtime** from the active gateway/trigger workflows, which does not require callables to be active.
Cross-workflow execution on the live server is therefore a live-verification step; the topology that makes it work
is proven here.
