# Stage 8 — Release Core (operator runbook)

**Scope of this document:** the release-engineering core plus the **release-path integration repair**
(branch `fix/stage8-release-integration`). The first release-core session produced good standalone components that
were **not wired into the real operator deploy path**; this repair connected them into ONE shared, ordered,
fail-closed, idempotent release pipeline used by both production and the disposable acceptance. The WF18 gateway
rearchitecture and controlled live acceptance are **separate, still pending** (`docs/WF18_REARCHITECTURE_HANDOFF.md`).

> Honest marker summary:
> `STAGE8_RELEASE_CORE=PASS` · `DISPOSABLE_DEPLOY=PASS` (disposable n8n 2.23.3, this repair) ·
> `WF18_REARCHITECTURE=PENDING` · `CONTROLLED_LIVE_ACCEPTANCE=PENDING` · `PRODUCTION_UNTOUCHED=true`.
> `STAGE8_RELEASE_ENGINEERING` is intentionally **not** asserted yet (live acceptance is operator-run).

## Correct operator sequence (DOCS-001)

The deploy path is **one ordered, fail-closed pipeline**. Resolve ids BEFORE deploying — never after:

```
discovery  →  resolve IDs  →  preflight  →  dry-run  →  backup  →  apply inactive  →  verify
```

`make deploy-inactive` performs the whole spine internally (acquire lock → capture live export → resolve+persist
installation-local ids → reconcile workflows + credentials → strict preflight → **backup before any import** →
import STAGED JSON inactive → bind → fresh-export verify → sanitized evidence → release lock). A failure stops
immediately, preserves sanitized diagnostics, prints the rollback command, and releases the lock.

## What is proven where

| Layer | Meaning | Status |
|---|---|---|
| Green offline harness | `node tests/run_all.js` (pure JS + fixtures, $0, 0 calls) | ✅ proven |
| Disposable n8n integration | throwaway 2.23.3 container, separate SQLite/volume | ⚠️ tooling built; **operator-run** (needs docker + image) |
| Real production (Docker-only) | `n8n-n8n-1`, 15 WF imported, `active=false`, 8/8 bound | ⛔ untouched by this work (read-only facts) |
| Controlled live acceptance | published WF18 + Telegram webhook | ⛔ operator-only; gated by the WF18 blocker registry |

## Operator-local workflow id strategy (DEPLOY-007/003/002/006)

Real n8n workflow ids are **installation-specific and never committed**. The committed manifest
(`config/workflow_manifest.json → runtime_identity`) is the logical source of truth (WF key, exact name, file,
role, callable/trigger expectations, binding edges, `canonical_id:null`, `id_source:operator_local`). Real ids
live in `config/runtime_ids.local.json` (gitignored, mode 600, backup-before-write).

Ids are resolved **as part of the deploy** (the apply captures the live export and runs the resolver before
staging), so the normal path needs no manual id step. The resolver can also be run standalone for discovery:

```bash
node tools/runtime_ids.js init                 # scaffold the local map from the manifest (15 keys, no ids)
node tools/runtime_ids.js resolve --export-dir <export> --apply   # discover existing ids by exact name (or
                                               #   generate for a fresh install) — fail-closed, idempotent
node tools/runtime_ids.js status               # coverage + fingerprints (no raw ids)
# (optional) migrate ids from an operator map BEFORE the first deploy — never commit the result:
node tools/runtime_ids.js seed --from /root/ids.json --apply
```

**Production install (existing 15 workflows) does NOT need `seed`** — the resolver discovers the installation's
real ids by exact workflow name from the live export and persists them to the gitignored local map automatically.

Resolver decisions (fail-closed, idempotent): verified / discover / generate / create-with-local-id / **abort**
(ambiguous name, id↔name mismatch, map-vs-production disagreement, stale key). Reports carry **fingerprints only**.

## Docker-only execution (DEPLOY-001 / BACKUP-001)

The production VPS runs n8n only via Docker (no host CLI; image entrypoint is `n8n`; container has `/bin/sh`, not
bash). `scripts/lib/n8n_exec.sh` abstracts this:

```bash
export MS_N8N_MODE=docker MS_N8N_CONTAINER=n8n-n8n-1   # or MS_N8N_COMPOSE_PROJECT + MS_N8N_SERVICE
# rehearse any step without touching anything:
MS_N8N_EXEC_DRY=1 scripts/deploy_n8n.sh --status
```

`n8n_run_image_sh` overrides the entrypoint with `--entrypoint /bin/sh` (the BACKUP-001 fix). A destructive guard
refuses `down -v` / `volume rm|prune` / `system prune` / `--decrypted`.

## The unified release path (`make release-help`)

In operator order (discovery → resolve → preflight → dry-run → backup → apply → verify):

```bash
make release-discovery          # LIVE read-only discovery (manifest plan + runtime-id coverage + git state)
make release-setup-check        # validate env profile (non-secret); env discovered from file/container/process
make release-preflight          # fail-closed runtime config preflight (effective env, secrets never printed)
make release-smoke              # disposable n8n: the SAME shared pipeline against a throwaway 2.23.3 container
make deploy-dry-run             # PRODUCTION-target discovery + id resolution + reconcile + ordered plan (no change)
                                #   (rehearse offline with: scripts/deploy_n8n.sh --offline-plan — soft, never claims prod readiness)
make deploy-inactive            # the full inactive release: lock→resolve→reconcile→preflight→BACKUP→import staged→bind→verify→evidence
make verify-production          # 15 workflows, exact-name count 1, resolved ids, all inactive, creds valid, edges bound, zero placeholders
make release-preflight-activate # activation-strict preflight (token/webhook/secret/$env/zlib) — stricter than inactive deploy
make wf18-gate                  # hard WF18 pre-live blocker gate (currently PENDING)
make telegram-prelive           # read-only getWebhookInfo + activation preflight
make telegram-activate          # GATED + TRANSACTIONAL: publish WF18 ONLY, register+verify webhook, auto-unpublish on failure
make telegram-deactivate        # unpublish WF18 + delete webhook
make rollback-dry-run / make rollback   # REAL rollback: webhook + publication + id-map + backup restore + verify
```

`make deploy-dry-run` against production fails closed if ids/env/export are unresolved (DEPLOY-004); it never
prints `id=(assigned on import)` and never mutates production or the local id map.

Every step prints machine-readable `PASS/FAIL` markers, is non-interactive (or documents prompts), exits non-zero
on failure, never prints secrets, and is idempotent.

## Backup & restore (BACKUP-001/002)

```bash
scripts/backup.sh --dry-run                       # default: validate + print plan, write nothing
scripts/backup.sh --apply --dest /root/backups/n8n-backup-<ts>
scripts/restore_validate.sh --dir /root/backups/<dir>   # offline sha256+content; disposable restore if docker
```

Backup tars the encrypted `/home/node/.n8n` (never `--decrypted`), via a read-only volume mount in a disposable
container with the entrypoint overridden to `/bin/sh`. It never removes or recreates the production volume. The
existing valid backup `/root/backups/stage4-before-import-20260624-143606` must not be deleted or modified.

## Telegram webhook lifecycle (TELEGRAM-009/001/002)

```bash
scripts/telegram_webhook.sh info                  # getWebhookInfo (token redacted)
scripts/telegram_webhook.sh verify                # current webhook == expected url + pending count
scripts/telegram_webhook.sh set    --apply        # register PUBLIC_WEBHOOK_BASE_URL/webhook/<path> + secret
scripts/telegram_webhook.sh delete --apply        # activation rollback
```

Token is env-only (`MS_TELEGRAM_BOT_TOKEN`), never on argv/logs (curl `--config` via a mode-600 trap-cleaned
file). HTTPS + secret are validated before registering. **Do not take port 443 from `sing-box`**; provide
`PUBLIC_WEBHOOK_BASE_URL` via an operator-owned HTTPS ingress.

## Release lock & evidence (RELEASE-003/004)

```bash
scripts/release_lock.sh acquire --owner you      # non-zero on contention; stale steal only if dead AND > TTL
scripts/release_lock.sh release --owner you
echo '{...}' | node tools/release_report.js --out release-evidence/<ts>.json   # sanitized (fingerprints only)
```

## Rollback (ROLLBACK-001)

```bash
make rollback-dry-run   # print the exact rollback plan, change nothing
make rollback           # scripts/rollback.sh --apply
```

`scripts/rollback.sh` is a **real** release rollback, not "delete the workflows in the UI": (1) delete the Telegram
webhook, (2) unpublish/deactivate the trigger workflow(s), (3) restore the runtime-id map from its `.bak`,
(4) the documented pre-release backup DB-restore path (operator-gated; never auto-replaces the volume), (5)
post-rollback verification. Every release-evidence record carries the exact `rollback_command`. The apply path's
EXIT-trap also writes sanitized ABORT diagnostics + the rollback command and releases the lock on any failure.

## Disposable acceptance proves the SHARED pipeline (not a parallel reimplementation)

`make release-smoke` (`scripts/n8n_disposable_e2e.sh`) drives the **same** `scripts/deploy_n8n.sh --apply` the
operator runs, against a throwaway, persistent n8n 2.23.3 container (disposable-named, `--network none`, never the
production container/volume). It emits honest markers (real PASS only after a real success; SKIPPED without docker):

```
RELEASE_PIPELINE_SHARED=PASS  DISPOSABLE_IMPORT=PASS  DISPOSABLE_REIMPORT=PASS  RUNTIME_ID_RESOLUTION=PASS
EXACT_NAME_RECONCILIATION=PASS  CREDENTIAL_RECONCILIATION=PASS  BACKUP_RESTORE_SMOKE=PASS  BINDINGS=PASS
ACTIVE_WORKFLOWS=0  PARENT_CHILD_TOPOLOGY=PASS  RELEASE_LOCK=PASS  RELEASE_EVIDENCE=PASS  ROLLBACK_READINESS=PASS
PRODUCTION_UNTOUCHED=true  DISPOSABLE_DEPLOY=PASS
```

`PARENT_CHILD_TOPOLOGY` (not `PARENT_CHILD_RUNTIME`) is honest: it proves an import→bind→export round-trip, not a
real parent→child execution. **Docker-only note:** the n8n CLI runs *inside* the container, so the pipeline copies
staged files in with `n8n_put` (docker cp) before `import:workflow` — a host-path import would ENOENT.

## Hard stops (the tooling refuses; operator decision required)

`> 1` exact-name workflow match · credential id↔type mismatch or ambiguity · local-map vs production id
disagreement · `N8N_BLOCK_ENV_ACCESS_IN_NODE != false` · missing HTTPS ingress or webhook secret on activation ·
**any open WF18 P0/P1 blocker** (activation refused). See `docs/DEFECT_REGISTRY_STAGE8.md`.
