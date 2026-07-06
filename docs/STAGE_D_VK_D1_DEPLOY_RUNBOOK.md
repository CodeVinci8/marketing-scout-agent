# Stage D · D1 — VK posts → canonical pipeline: deploy + bounded live-test runbook

**Status:** local implementation + tests COMPLETE; **NOT deployed, NOT live-proven.** This runbook is the exact
production-mutation + bounded live-test sequence to run **only under explicit operator authorization** (production
write + paid/live external calls). Nothing here has been executed by the agent.

## What D1 changed (canonical source, committed)

| File | Change |
|---|---|
| `tools/gen_stage4_workflows.js` | `libCore()` now inlines `config/taxonomy.json` when embedding `semantic_core` (strips the `fs`/`path` requires + the `readFileSync` taxonomy load) so the **real `classifyOffline`** is embeddable in an n8n Code node. New WF26 nodes **"Build VK raw_market_records Rows"** (embeds `semantic_core`) + **"Append raw_market_records"** (tab `raw_market_records`), wired `Parse Wall & Detect Changes → Build → Append`. |
| `n8n/workflows/26_vk_public_community_collector.json` | Regenerated: 24 → **26 nodes** (byte-identical to generator). |
| `config/sheets_contracts.json` | `raw_market_records.writers` += `"26"` (drift validator). |
| `tests/test_wf26_vk_rmr_mapping.js` (+ `run_all.js`) | 105 checks: topology, exact 42 collector columns ⊆ real 68-col contract, embedded classifier == library (drift-proof), VK semantics (promo→competitor, market→market_signal, greeting→not-competitor). |

**Behavior:** every collected VK post is classified by the single canonical `classifyOffline` contract and written as a
canonical `raw_market_records` row carrying `record_type_hint`, `confidence_score`, `service_hint`, `semantic_keywords`,
`competitor_related`/`competitor_name`, and a grounded `manager_note` reason. Off-topic posts classify as `irrelevant`
and are excluded downstream (WF16 `report_candidate=0`; WF08 routes `irrelevant`→`skipped_log`). VK now flows
`WF26 → raw_market_records → WF16 → WF08 → WF10 → WF12` exactly like Website/Telegram.

## Preconditions
- Operator authorizes: (a) a production write to WF26 (`SMQkUppyeFH2sFuf`), (b) bounded paid/free live VK calls.
- VK token present in the n8n `httpQueryAuth` credential (never printed); Apify not involved.
- Verified backup taken first.

## Step 1 — Backup prod WF26 (mandatory, before any mutation)
```bash
# writes a timestamped backup of the live workflow row + a full DB backup
bash scripts/backup.sh                       # full-container backup (documented, --user 0:0)
# also snapshot just WF26 for a targeted rollback:
docker cp n8n-n8n-1:/home/node/.n8n/database.sqlite /tmp/ms_db_pre_d1.sqlite   # read-only copy
```

## Step 2 — Surgical splice: add the 2 D1 nodes to prod WF26 (preserves cred bindings, id, active)
The 2 new nodes are additive; the other 24 nodes/edges are unchanged. `Append raw_market_records` must bind the **same
googleApi credential** the existing `Append vk_posts` node uses in prod. Export → splice → import → reactivate:
```bash
source scripts/lib/n8n_exec.sh
n8n_get "$WF26_ID" /tmp/wf26_prod.json        # docker cp the live export out  (WF26_ID=SMQkUppyeFH2sFuf)
# splice: copy the 2 canonical nodes + 2 edges into the prod export, copy the Google cred binding from
# 'Append vk_posts' onto 'Append raw_market_records' (node tools/splice helper below), keep id+active:
node tools/splice_wf26_d1.js /tmp/wf26_prod.json n8n/workflows/26_vk_public_community_collector.json /tmp/wf26_spliced.json
n8n_put /tmp/wf26_spliced.json                # docker cp in + `n8n import:workflow` (deactivates on import)
# reactivate WF26 (import deactivates):
docker exec n8n-n8n-1 n8n update:workflow --id="$WF26_ID" --active=true
```
> `tools/splice_wf26_d1.js` is NOT yet written (would be created at deploy time under approval) — or splice by hand:
> add the two node objects + the two connection entries, and set the new Append node's `credentials` equal to the
> prod `Append vk_posts` node's `credentials`. Verify the spliced JSON has 26 nodes and the new edges before import.

## Step 3 — Bounded live VK run (3 approved communities), one marked request
For each community, invoke WF26 with a shared unique `agent_request_id`/`source_run_id` marker so the whole VK sample
is one request family. `execute` needs the broker-port override on this n8n build:
```bash
REQ="req_vk_d1_$(date +%Y%m%d_%H%M%S)"
for C in kredit874 da_credit anna_findoctor; do
  # invoke WF26 callable with: community=$C, vk_enable_approval=VK_LIVE_APPROVED, owner_user_id=<operator chat>,
  # agent_request_id=$REQ, source_run_id="${REQ}::vk::$C", data_mode=live, mode=manual
  # (via WF20 dispatch OR a direct execute with the callable input JSON)
  N8N_RUNNERS_TASK_BROKER_PORT=5690 N8N_RUNNERS_BROKER_PORT=5690 \
    docker exec n8n-n8n-1 n8n execute --id="$WF26_ID"   # with the input JSON above
done
```
Public data only. Token stays in the credential. Expect `raw_market_records` rows appended per community (kredit874≈6,
da_credit≈25, anna_findoctor≈25 from the last live snapshot).

## Step 4 — Downstream over the SAME request (request-scoped)
```bash
# WF16 quality gate (write source_health), filtered to the VK request:
#   fixture_self_test=false, write_result=true, agent_request_id=$REQ
# WF08 classifier over $REQ (deterministic, llm_enabled=false):
#   agent_request_id_filter=$REQ, analysis_mode=deterministic_first
# WF10 aggregate, then WF12 report over $REQ.
```

## Step 5 — Inspect real executions + Sheets (read-only, $0)
```bash
node -e '
const {DatabaseSync}=require("node:sqlite");
const flatted=require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db=new DatabaseSync("/home/node/.n8n/database.sqlite",{readOnly:true});
// newest WF26 executions + the raw_market_records rows the VK request produced
'   # run inside the container; confirm record_type_hint/confidence_score/manager_note per VK post
```
**D1 is complete only when:** fresh evidence shows VK competitor rows in `raw_market_records` with confidence+reason,
WF16 marks the VK run report-eligible (or correctly excludes an all-irrelevant run), and **VK competitors appear in a
real WF12 report with evidence URLs**. Record exec IDs + row counts in `docs/STAGE_D_SOURCE_QUALITY_ACCEPTANCE.md`.

## Rollback
```bash
n8n_put /tmp/wf26_prod.json && docker exec n8n-n8n-1 n8n update:workflow --id="$WF26_ID" --active=true
# or scripts/rollback.sh with the Step-1 backup
```

## Guardrails
- No token/secret printed. Public VK data only (no private groups/DMs/hidden members).
- Only WF26 is mutated; other workflows untouched. WF18 gate unchanged.
- If Sheets append mismatches the 68-col header, STOP — do not force; investigate header order first.
