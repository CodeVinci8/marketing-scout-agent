# Vinci AI Pilot — Live Rollout Runbook (operator)

Authoritative, **sequential** live‑test procedure. Nothing here was run live during implementation. Run stages
in order; do **not** proceed to the next stage until the current one shows its PASS markers. Every step lists
preconditions, the action, expected output, PASS/FAIL markers, rollback, and evidence to save.

**Golden safety rules (all stages):** secrets come only from the environment / n8n credential store and are
never typed into workflow JSON, CLI arguments, logs, or screenshots. Never run `docker compose down -v`,
`docker volume rm`, `docker system prune`, or ancestor‑filter container deletion. All workflows stay inactive
until the explicit activation step. Estimate and confirm maximum cost before any paid live smoke.

Production facts: n8n `2.23.3`, container `n8n-n8n-1`, compose dir `/opt/n8n`, volume `n8n_n8n_data`.

---

## Stage 3C — Google Sheets operations acceptance

**Preconditions:** a SEPARATE staging spreadsheet bootstrapped with all 40 tabs + contract‑hash marker
(`ops/n8n/workflows/qa_stage3_sheets_bootstrap.json`); Google Service Account credential present in n8n.

1. **Re‑import corrected QA workflow** `ops/n8n/workflows/qa_stage3_sheets_operations_acceptance.json` (inactive). Select the Google credential on every HTTP node; restrict domains to `https://sheets.googleapis.com`.
2. **Dry‑run** — `Set QA Config`: paste staging id; `execute_writes=false`, `confirm_staging_spreadsheet=false`. Run.
   - PASS: `Init, Guard & Embed Engine` runs without `SyntaxError` (the `MS_TZ` regression); `PREFLIGHT=PASS`, `SHEETS_READ=PASS`, `WRITE_PLAN=PASS`, live‑op markers `NOT_EXECUTED_DRY_RUN`, `CHANGES_APPLIED=false`.
3. **Live write** — set `execute_writes=true` AND `confirm_staging_spreadsheet=true`. Run once.
   - PASS: live‑op markers `PASS`, `CHANGES_APPLIED=true`, `READ_BACK_FAILURES=[]`, `BEFORE_AFTER_FAILURES=[]`, `FORMULA_SAFETY_DETAILS` shows `stringValue` (never `formulaValue`).
4. **Same‑run repeat** — copy `QA_RUN_ID` into `reuse_qa_run_id`; run again. PASS: every `DUPLICATE_*=0`, `IDEMPOTENCY=PASS`.
5. **Final dry‑run** to confirm no residual mutation.
   - **FAIL markers:** any `SyntaxError`; `READ_BACK_FAILURES`/`BEFORE_AFTER_FAILURES` non‑empty; foreign rows touched.
   - **Rollback:** none needed (QA writes only tagged `manual_test` rows). **Evidence:** the Report node JSON for each run.
   - Result: marks **QA‑018/QA‑019 LIVE‑RETESTED** only if all above PASS (do not infer from offline).

## Stage 4 — Telegram free path (zero‑paid)

**Preconditions:** Stage 3C green; bot token; one allowlisted numeric user id; public HTTPS for n8n.
Env (zero‑paid): `MS_ENABLE_TELEGRAM=true`, `MS_ENABLE_EXTERNAL_ACTIONS=false`, `MS_ENABLE_CLAUDE=false`,
`MS_MAX_EXTERNAL_CALLS=0`, `MS_MONITORING_ENABLED=false`, `MS_WEEKLY_DIGEST_ENABLED=false`.

1. **Backup** (Stage 8 backup step) before any deploy.
2. **Deploy inactive runtime** — `scripts/deploy_n8n.sh` (validates config, dry‑run, imports the 15‑workflow closure, all inactive, resolves the 8 binding edges, fails on placeholders/duplicates).
3. **Binding verification** — `node tools/audit_workflows.js` → "no hard errors".
4. **Configure env + credentials** in n8n (token in credential store; `MS_TELEGRAM_ALLOWED_USER_IDS`; `MS_SPREADSHEET_ID`; Google credential).
5. **Command menu** — `MS_TELEGRAM_BOT_TOKEN=… scripts/configure_telegram_commands.sh --live` → "PASS: … matches the canonical Russian menu exactly (5 commands)."
6. **Register webhook** for WF18 (Telegram setWebhook to the n8n production webhook URL). Then **activate only WF18**.
7. **Russian smoke** from the allowlisted account: `/start`, `Кто ты?`, a research ask (→ plan + approval buttons), Reject, `/status`, `/cancel`.
   - PASS: Russian replies; identity answer with no plan; approval card; safe‑mode note after approval (collection disabled); `CLAUDE_CALLS=0`, `COLLECTOR_CALLS=0`.
8. **Duplicate update replay** — re‑deliver the same `update_id`; PASS: no duplicate request/event/send.
   - **FAIL:** unauthorized user gets a reply; any paid call; duplicate persisted.
   - **Rollback:** deactivate WF18; delete webhook; (if needed) restore backup. **Evidence:** chat transcript + `agent_request_events` rows.

## Stage 5 — adapters (one at a time)

For each adapter (website → Firecrawl → Apify → Claude → VK → Avito[experimental]):
1. **Credential preflight** (adapter disabled). 2. Enable its single flag + set a small `MS_MAX_EXTERNAL_CALLS`
and cost ceiling; **confirm estimated max cost**. 3. Run a **bounded live smoke** via its acceptance workflow.
4. Verify normalized result + provenance (`source_url`, `fetched_at`, `http_status`, `content_hash`) persisted.
5. **Disable the adapter** after the smoke.
   - PASS: one bounded call, normalized record stored, no secret in logs. FAIL: auth error / budget exceeded /
     empty result mis‑reported as success. Rollback: disable flag. Evidence: the run log + stored source row.
   - Avito stays `EXPERIMENTAL`; VK is optional.

## Stage 6 — one real research request (end‑to‑end)

**Preconditions:** Stages 4–5 green; required adapters enabled with budgets; Claude enabled if used.
1. Submit one business research task; **approve** the plan. 2. Verify **progress** (single editable card, monotonic %).
3. Verify **sources** actually collected (provenance). 4. Verify **report** sections + **calculations** (inputs/formula/confidence).
5. Verify **export** (Google Sheet/XLSX). 6. Verify **Telegram delivery** + **follow‑up** buttons; run one follow‑up.
   - PASS: claims anchored to evidence; assumptions labelled; export opens; follow‑up creates a linked child (not overwrite).
   - FAIL: fabricated source/number; unanchored claim presented as fact; budget bypass. Rollback: `/cancel`; disable adapters.

## Stage 7 — monitoring + weekly digest

1. Add **one** monitored source. 2. Manually change the source; run WF23 once. 3. Verify **alert** (owner‑specific, old/new value, Moscow time).
4. Re‑run unchanged → **no duplicate alert** / cosmetic change suppressed. 5. Run **weekly digest** (WF25); verify per‑owner content; verify **no‑change** behaviour. 6. **Disable** the schedule (`MS_MONITORING_ENABLED=false`, `MS_WEEKLY_DIGEST_ENABLED=false`).
   - PASS: meaningful change alerts once; empty week suppressed. Rollback: deactivate WF23/WF25.

## Stage 8 — release acceptance

1. **Disk preflight** then **backup** (db + workflow metadata + deploy config + commit SHA; no secrets; stored outside active db path).
2. **Clean deployment validation** — config validate → dry‑run → import closure inactive → binding/duplicate/placeholder checks → repeat‑deploy idempotency.
3. **Full E2E** (Stage 6) on the deployed runtime. 4. **Health checks**. 5. **Rollback drill** — deactivate triggers, delete webhook, roll back workflows, **restore db from backup**, verify. 6. Generate **release checklist** + final acceptance report.
   - PASS: clean deploy, all inactive except approved triggers, restore verified. FAIL: any closure/binding/placeholder error; restore mismatch.

---

## Final push (only when the operator decides)

```
git push -u origin feat/vinci-mvp-stage4-8
```
Nothing in this task pushed, merged, activated a workflow, or called a live external API.
