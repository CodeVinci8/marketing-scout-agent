# Runtime configuration (QA-006)

Marketing Scout's n8n runtime is configured by **non-secret environment variables** plus the **n8n credential
store**. This file documents every knob, what is required vs. optional, and how the deploy preflight enforces it.
Copy `ops/n8n/runtime.env.example` to your own env file and fill it in. **Never put secrets in env or in workflow
JSON** — tokens/keys/service-account JSON live only in the n8n credential store.

## Preflight

`tools/preflight_config.js` validates the environment. The deploy script calls it:

| Deploy mode | Preflight | On failure |
|---|---|---|
| `--check-config` | fail-closed | non-zero exit |
| `--dry-run` | soft (warnings) | continues, prints machine-readable warnings |
| `--apply` | fail-closed | refuses to import |
| `--activate-triggers` | fail-closed **+ `--require-zlib`** | refuses to activate |

Run it directly any time:

```bash
node tools/preflight_config.js --json            # fail-closed report
node tools/preflight_config.js --json --soft     # dry-run style (missing required → warnings)
node tools/preflight_config.js --json --require-zlib   # as used before activation
```

Secret-ish values are **never printed** — only a verdict and a masked length (`set(len=…)`).

## Required (non-secret)

| Variable | Meaning | Validation |
|---|---|---|
| `MS_SPREADSHEET_ID` | Google Sheets id holding all tabs | present, not a placeholder |
| `MS_TELEGRAM_ALLOWED_USER_IDS` | comma-separated numeric Telegram user ids (authorization) | present, all numeric |
| `NODE_FUNCTION_ALLOW_BUILTIN` | must contain `zlib` (or `*`) | **required before activating** WF24/WF25 |

### Why zlib is required

The XLSX report writer (`n8n/lib/xlsx_writer.js`, used by WF24 report export and WF25 weekly digest) deflates the
workbook with Node's built-in `zlib` inside an n8n **Code node**. n8n's task-runner sandbox blocks built-ins unless
they are allow-listed. Proven in a disposable n8n 2.23.3 container (QA-005):

* **without** `NODE_FUNCTION_ALLOW_BUILTIN=zlib` → the Code node throws `Module 'zlib' is disallowed` and the
  execution fails (controlled denial);
* **with** it → the round trip succeeds. The task runner **does** inherit the variable.

So `--activate-triggers` runs a `--require-zlib` preflight and refuses to activate an XLSX-capable release when zlib
is not allowed.

## Feature flags (boolean: `true`/`false`/`yes`/`no`/`1`/`0`)

| Flag | Effect | Default |
|---|---|---|
| `MS_MONITORING_ENABLED` | activate the scheduled monitor (WF23) | `false` |
| `MS_WEEKLY_DIGEST_ENABLED` | activate the weekly digest (WF25, needs zlib) | `false` |
| `MS_ENABLE_LLM_PLANNER` | allow guarded Claude planning | `false` |
| `MS_ENABLE_LLM_SUMMARY` | allow guarded Claude summarization | `false` |
| `MS_REQUIRE_APPROVAL` | human approval before paid/external work | `true` |
| `MS_REQUIRE_SOURCE_HEALTH` | require source health before collection | `true` |

A malformed boolean is a **warning** (dry-run continues) — but activation fails closed on any hard error.

## Budgets / limits (non-negative numbers; blank → safe defaults)

`MS_MAX_SOURCES`, `MS_MAX_ITEMS_PER_SOURCE`, `MS_MAX_EXTERNAL_CALLS`, `MS_SOURCE_BUDGET_USD`,
`MS_LLM_BUDGET_USD`. A negative value is a hard error.

## Scope

`MS_SOURCE_ALLOWLIST` (subset of `website vk telegram avito reviews forum classifieds social`),
`MS_DEFAULT_REGION`, `MS_DEFAULT_NICHE`.

**`MS_AVITO_ENABLED`** (default `false`) — AVITO-BLOCK-001 product gate. Avito is operator-infra-blocked (needs a
Residential proxy on a paid Apify plan). While `false`, Avito is **stripped from the resolved `source_allowlist`**
even if listed in `MS_SOURCE_ALLOWLIST`, so the bot never offers/plans/selects/runs it and an explicit Avito request
gets an honest "temporarily unavailable" reply. Re-enable: provision the Residential proxy, then set
`MS_AVITO_ENABLED=true` (and keep `avito` in `MS_SOURCE_ALLOWLIST`) — no code change. See
`docs/STAGE_D_SOURCE_QUALITY_ACCEPTANCE.md` → AVITO-BLOCK-001.

## Secrets — credential store only (never env, never JSON)

`MS_TELEGRAM_BOT_TOKEN`, Google service-account JSON, Claude/Anthropic key, Apify token, Firecrawl key, VK access
token. These are referenced by workflows through the n8n credential store. The repo's secret-leak scan fails the
build if any of these patterns ever appear in a tracked file.
