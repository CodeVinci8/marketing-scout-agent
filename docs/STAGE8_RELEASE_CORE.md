# Stage 8 — Release Core (operator runbook)

**Scope of this document:** the release-engineering core delivered on branch `feat/stage8-release-engineering`.
It is **release-core complete and offline-proven**; the WF18 gateway rearchitecture and controlled live
acceptance are **separate, still pending** (see `docs/WF18_REARCHITECTURE_HANDOFF.md`).

> Honest marker summary (from `make release-core-acceptance`):
> `STAGE8_RELEASE_CORE=PASS` · `WF18_REARCHITECTURE=PENDING` · `CONTROLLED_LIVE_ACCEPTANCE=PENDING` ·
> `PRODUCTION_UNTOUCHED=true`. `STAGE8_RELEASE_ENGINEERING` is intentionally **not** asserted yet.

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

```bash
node tools/runtime_ids.js init                 # scaffold the local map from the manifest (15 keys, no ids)
# migrate the existing production ids (operator input only — NEVER commit this file):
node tools/runtime_ids.js seed --from /root/ids.json --apply
node tools/runtime_ids.js resolve --export-dir <export> --apply   # discover/generate/verify, fail-closed
node tools/runtime_ids.js status               # coverage + fingerprints (no raw ids)
```

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

```bash
make release-discovery          # manifest plan + runtime-id coverage + git state (read-only)
make release-setup-check        # validate env profile (non-secret)
make release-preflight          # fail-closed runtime config preflight
make release-core-acceptance    # offline Stage 8 acceptance (honest markers)
make release-backup             # backup DRY-RUN (entrypoint-overriding plan; writes nothing)
make release-restore-validate BACKUP_DIR=/root/backups/<dir>
make release-smoke              # disposable n8n import/reimport/bind/verify (SKIP without docker)
make deploy-dry-run             # full import/bind plan, no changes
make deploy-inactive            # import 15 workflows INACTIVE + auto-bind (operator)
make verify-production          # status + binding verification against the live export
make release-preflight-activate # activation-strict preflight (token/webhook/secret/$env/zlib)
make wf18-gate                  # hard WF18 pre-live blocker gate (currently PENDING)
make telegram-prelive           # read-only getWebhookInfo + activation preflight
make telegram-activate          # GATED: publish WF18 + register webhook (separate explicit step)
make telegram-deactivate / make rollback
```

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

## Rollback

```bash
make rollback        # scripts/deploy_n8n.sh --deactivate-triggers && scripts/telegram_webhook.sh delete --apply
```

Every release-evidence record carries the exact `rollback_command`. Rollback restores **both** the n8n
publication state and the Telegram webhook state.

## Hard stops (the tooling refuses; operator decision required)

`> 1` exact-name workflow match · credential id↔type mismatch or ambiguity · local-map vs production id
disagreement · `N8N_BLOCK_ENV_ACCESS_IN_NODE != false` · missing HTTPS ingress or webhook secret on activation ·
**any open WF18 P0/P1 blocker** (activation refused). See `docs/DEFECT_REGISTRY_STAGE8.md`.
