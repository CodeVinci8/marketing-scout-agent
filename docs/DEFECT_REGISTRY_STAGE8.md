# Stage 8 Defect Registry

Status legend — **Code:** fixed in source · **Offline:** proven by `node tests/run_all.js` ·
**Disposable:** needs a throwaway n8n container (operator-run) · **Prod:** verified against the live export /
production (operator-run) · **Live:** controlled live acceptance (operator-run).

## Release-path INTEGRATION defects ADDRESSED in `fix/stage8-release-integration` (disposable-proven)

The first release-core session built good standalone components but did **not wire them into the real operator
deploy path**. This repair connected them into one shared, ordered, fail-closed pipeline used by both production
and the disposable acceptance. Proven against **real n8n 2.23.3** (`DISPOSABLE_DEPLOY=PASS`; production
`n8n-n8n-1` / `n8n_n8n_data` never touched).

| ID | Sev | Root cause | Fix | Tests | Code | Disposable | Prod |
|---|---|---|---|---|---|---|---|
| RELEASE-005 | P0 | release-core tools existed but `deploy_n8n.sh`/disposable never called them | shared `release_plan.js` + `release_pipeline.sh`; deploy + disposable both invoke them | release-integration | ✅ | ✅ | pending |
| DEPLOY-001b | P0 | docker-mode `import --input=<host path>` ENOENTs (CLI runs in-container) | `n8n_exec.sh` `n8n_put`/`n8n_get` (docker cp); deploy copies staged in before import | release-integration | ✅ | ✅ | pending |
| DEPLOY-002b | P0 | first-match `awk … {print $1; exit}` still in deploy | strict exact-name 0/1/>1 `resolve_exact_name`; ambiguous aborts | release-integration | ✅ | ✅ | pending |
| DEPLOY-003b | P0 | deploy printed `id=(assigned on import)` | fingerprint logs (`id_fp=`); raw ids only in gitignored local map | release-integration | ✅ | ✅ | pending |
| DEPLOY-004 | P0 | dry-run "successful" with 0/15 coverage / unresolved env | production dry-run fails closed; explicit soft `--offline-plan` | release-integration | ✅ | ✅ | pending |
| CONFIG/PREFLIGHT | P1 | preflight inspected only the shell env (prod vars reported missing) | `env_discovery.js` (file/compose/container/process; SET/MISSING/fp, secrets never printed) | release-integration | ✅ | ✅ | pending |
| STAGE-001 | P1 | apply imported RAW templates (no id/bindings/creds) | `prepare_staged_workflows.js` → staged JSON (resolved id+bindings+creds, active=false); import staged only | prepare-staged, release-integration | ✅ | ✅ | pending |
| BACKUP-003 | P1 | backup container (user `node`) couldn't write root-owned dest | `backup.sh` runs the backup container `--user 0:0`; volume still `:ro`, never decrypts | release-integration (disposable) | ✅ | ✅ | pending |
| ACTIVATE-001 | P0 | activation called bare `n8n publish:workflow` (no host CLI in prod) | publish/unpublish via `n8n_cli` Docker-safe abstraction | release-integration | ✅ | n/a | pending |
| ACTIVATE-002 | P0 | publish-then-set: webhook failure left WF18 published | transactional `--activate-telegram`: WF18 only, register+verify webhook, auto-unpublish on failure | release-integration | ✅ | n/a | pending |
| ROLLBACK-001 | P1 | rollback = Telegram deactivation only | `scripts/rollback.sh`: webhook+publication+id-map+backup restore + verify | release-integration | ✅ | ✅ (readiness) | pending |
| TEST-002 | P1 | disposable smoke tested the legacy path | disposable e2e drives the shared `deploy_n8n.sh --apply` | release-integration | ✅ | ✅ | n/a |
| TEST-003 | P2 | broad `\|\| true` hid primary failures | exit codes captured + asserted | smoke-hardening, release-integration | ✅ | ✅ | n/a |
| MARKER-001 | P2 | `PARENT_CHILD_RUNTIME=PASS` overclaimed | renamed `PARENT_CHILD_TOPOLOGY` (no real child execution claimed) | release-integration | ✅ | ✅ | n/a |
| DOCS-001 | P2 | docs resolved ids AFTER deploy | corrected to discovery→resolve→preflight→dry-run→backup→apply→verify everywhere | (docs) | ✅ | n/a | n/a |

## Release-core defects ADDRESSED in the first session (now disposable-proven)

> The `Disposable`/`Prod` columns below were `pending` after the first session. The integration repair's disposable
> acceptance (`DISPOSABLE_DEPLOY=PASS` against real n8n 2.23.3) now exercises import/reimport, exact-name
> reconciliation, id resolution, credential reconciliation, bindings, backup/restore, the release lock and
> sanitized evidence end-to-end — so DEPLOY-001/002/003/005/006/007/008/011, BACKUP-001/002, RELEASE-002/003/004
> are **Disposable ✅** now (Prod still operator-run).

| ID | Sev | Root cause | Fix | Tests | Code | Disposable | Prod |
|---|---|---|---|---|---|---|---|
| DEPLOY-001 | P0 | `deploy_n8n.sh` required a host `n8n` CLI; prod is Docker-only | `scripts/lib/n8n_exec.sh` host/docker/sh abstraction; deploy routes through `n8n_cli` | release-shell, stage8-release-e2e | ✅ | pending | pending |
| DEPLOY-002 | P0 | id picked by `awk … {print $1; exit}` (no count check) | `reconcile_workflows.js` exact-name 0/1/>1 fail-closed | reconcile-and-gate | ✅ | pending | pending |
| DEPLOY-003 | P0 | workflow JSON had no id → SQLITE NOT NULL | operator-local id map + resolver (generate/discover) | runtime-ids | ✅ | pending | pending |
| DEPLOY-005 | P1 | no workflow reconciliation (preserve id, update topology) | `reconcile_workflows.js` UPDATE preserves prod id; drift detection | reconcile-and-gate | ✅ | pending | pending |
| DEPLOY-006 | P1 | ambiguous binder | binder already by exact name; reconciler asserts uniqueness | binding-tool, reconcile-and-gate | ✅ | pending | pending |
| DEPLOY-007 | P0 | canonical id map missing from release flow | `runtime_identity` in manifest + `runtime_ids.js` single source | runtime-ids, stage8-release-e2e | ✅ | pending | pending |
| DEPLOY-008 | P1 | credential reconciliation not automated | `reconcile_credentials.js` (non-decrypted, fingerprints, placeholder refusal) | reconcile-and-gate | ✅ | pending | pending |
| DEPLOY-011 | P2 | generated/committed/prod drift undetected | `reconcile_workflows.detectDrift` (node sig compare) | reconcile-and-gate | ✅ | pending | pending |
| BACKUP-001 | P1 | backup `sh` without `--entrypoint` override (entrypoint is `n8n`) | `n8n_run_image_sh` forces `--entrypoint /bin/sh`; `backup.sh` | release-shell, release-scripts | ✅ | pending | n/a |
| BACKUP-002 | P1 | backup existence checked but restore unproven | `restore_validate.sh` offline sha256+content; disposable restore | release-scripts | ✅ (offline) | pending | n/a |
| CONFIG-002/003 | P1 | env profile incomplete / flags implicit | explicit zero-paid profile in `n8n.env.example` + `--profile zero-paid` | preflight-strict | ✅ | n/a | pending |
| CONFIG-005 | P1 | invalid env silently defaults | strict tz/report-mode/numeric/url validation | preflight-strict | ✅ | n/a | pending |
| PREFLIGHT-001 | P1 | bot token not checked | shape check, never echoed (masked) | preflight-strict | ✅ | n/a | pending |
| PREFLIGHT-002 / LIVE-001 | P0 | `$env` access not verified | `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` activation-gate + negative test | preflight-strict | ✅ | n/a | pending (verify in running container) |
| PREFLIGHT-005 | P2 | tz/clock drift unchecked | IANA validation; `MS_TIMEZONE` enforced | preflight-strict | ✅ | n/a | pending |
| FUTURE-015 | P1 | paid cross-field invariants unchecked | collector⇒actions, actions⇒calls, claude⇒budget, allowlist/monitoring | preflight-strict | ✅ | n/a | pending |
| TELEGRAM-001 | P0 | no public HTTPS ingress contract | `PUBLIC_WEBHOOK_BASE_URL` HTTPS validation; never auto-takes 443 | preflight-strict, release-scripts | ✅ | n/a | pending (operator ingress) |
| TELEGRAM-002 | P0 | no webhook secret | `MS_TELEGRAM_WEBHOOK_SECRET` validation + `setWebhook(secret_token)` | preflight-strict, release-scripts | ✅ (tooling) | n/a | pending |
| TELEGRAM-009 | P1 | no webhook lifecycle automation | `telegram_webhook.sh` info/verify/set/delete (dry-run default) | release-scripts | ✅ | n/a | pending (live) |
| RELEASE-002 | P1 | no unified release path | `make release-*` interface | stage8-release-e2e | ✅ | partial | pending |
| RELEASE-003 | P1 | release evidence not persisted/sanitized | `release_report.js` (fingerprints only, rollback cmd) | release-scripts | ✅ | n/a | n/a |
| RELEASE-004 | P1 | no release lock | `release_lock.sh` (stale-safe) | release-scripts | ✅ | n/a | n/a |
| OPERATOR-001 | P2 | broken `${#!v}` indirection | shell scan forbids it; safe idiom used | release-shell | ✅ | n/a | n/a |
| OPERATOR-002 | P2 | heredoc corruption | committed scripts replace pasted heredocs | release-shell | ✅ | n/a | n/a |
| SECURITY-003 | P1 | secrets in temp files | mode-600 trap-cleaned curl `--config`; backup mode 600 | release-scripts | ✅ | n/a | pending |
| SECURITY-005 | P1 | export/log secret leakage | `release_report.sanitize` + redaction; fingerprint-only reports | release-scripts, runtime-ids | ✅ | n/a | n/a |
| LIVE-003 / TEST-001 | — | locale numeric read-back | already fixed (`866b8eb`); preserved | (stage3 suites) | ✅ | n/a | ✅ (Stage 3C) |

## Hard pre-live WF18 gate (this session)

`config/wf18_blockers.json` registers 19 P0/P1 WF18/Telegram blockers; `tools/wf18_activation_gate.js` refuses to
publish WF18 while any is open (a `resolved` item must cite proving evidence). `deploy_n8n.sh --activate-triggers`
consults the gate. Current state: **PENDING** (all 19 open).

## DEFERRED to the WF18 rearchitecture session (NOT addressed here)

These are real defects but belong to the gateway rearchitecture, not release-core. They are tracked in the WF18
blocker registry and `docs/WF18_REARCHITECTURE_HANDOFF.md`, and the activation gate keeps WF18 unpublishable until
each is fixed **with a named regression test**:

TELEGRAM-003/004/005/006/007/008/010/011/012/013/014/015/016/017 · RUNTIME-001..009 · STATE-001/002/003/004 ·
MEMORY-001/002/003/004 · DATA-001..008 · IDEMP-001..005 · SECURITY-001/002/006/007/008/009/010 ·
FUTURE-001..014/016..030.

> No item is silently dropped: every one is either fixed-and-tested above, or registered as an open blocker that
> mechanically prevents WF18 activation.
