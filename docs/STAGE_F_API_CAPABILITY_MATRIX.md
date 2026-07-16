# Stage F — aiprimetech.io API Capability Matrix (measured live)

> Endpoint: `https://aiprimetech.io/v1/messages` · auth `Authorization: Bearer <token>` (n8n cred
> `Claude API - Marketing Scout`, id `OEen8Vl1tdWtv7v4`) · header `anthropic-version: 2023-06-01`.
> Measured 2026-07-16 with **19 bounded live probes** (no secret ever printed). This file records what the real
> endpoint DOES, which overrides any assumption from the public Anthropic docs.

## TL;DR — what the adapter must assume

| Capability | Result | Consequence for Stage F |
|---|---|---|
| Anthropic Messages shape (`content[]`, `stop_reason`, `usage`) | **Yes** | standard response parsing |
| Model `claude-sonnet-4-6` | **Works** (echoed back) | use it; do not hardcode other names unverified |
| **Extended thinking** | **Always ON** (responses carry `thinking` blocks; `thinking:{type:"disabled"}` ignored) | never surface thinking; extract only the result block |
| Forced `tool_choice:{type:"tool"}` | **Unreliable** (thinking ⇒ sometimes returns text, no tool call) | do **not** force |
| **`tool_choice:{type:"auto"}` + one `submit_*` tool** | **Reliable — 3/3 valid schema JSON** | **PRIMARY structured-output transport** |
| Native `response_format` (json_schema) | **Ignored** (plain text) | unsupported — do not use |
| Native `output_config.format` | **Ignored** (plain text) | unsupported — do not use |
| `max_tokens` bound | **NOT honored** (asked 1 → got 295) | set generous; never rely on it to cap output/cost |
| Prompt caching (`cache_control`) | **Ineffective** (cache tokens always 0; caching probe timed out) | do not rely on cache; measure but expect 0 |
| `/v1/messages/count_tokens` | **Works** (`{input_tokens:N}`, ~0.3 s) | use for input estimation of our own content |
| Auth failure (bad token) | **401, ~170 ms** | map → `auth_error`, fail closed, no retry |
| Bad model / bad request | **400 `upstream_error`** (nested JSON message) | map → `bad_request`, no blind retry |
| Latency | **16–28 s/call** | timeouts ≥ 60 s; minimize call count; async/progress UX |
| Hidden injected input tokens | **~465–2200 per call, variable** | gateway keeps server-side state; trust response `usage`, budget conservatively |
| Server-side conversation state | **Yes** — leaked *"Your conversation is too long. Please use /compact"* | keep evidence packages tight; each call self-contained + bounded |

**Conclusion:** aiprimetech.io is a **Claude-Code / claude.ai-wrapped proxy**, not the raw Anthropic API. It speaks
the Messages wire format but (a) always runs extended thinking, (b) ignores native structured-output fields, (c)
ignores `max_tokens`, (d) injects a large hidden system context and keeps per-key conversational state. The only
robust structured transport is **tool use with `tool_choice:auto`**, which returns a clean JSON object — so on the
primary path there are **zero JSON-syntax errors** and repair is reserved for schema/evidence validation only.

## Probe log (sanitized)

| # | Feature | Status | stop_reason | blocks | input/output tok | latency |
|---|---|---|---|---|---|---|
| 01 | plain messages | 200 | end_turn | text | 1930 / 2 | 17.1 s |
| 02 | system + blocks | 200 | end_turn | text ("Red.") | 1941 / 3 | 16.6 s |
| 03 | forced tool_choice | 200 | end_turn | thinking, text (**no tool_use**) | 217 / 271 | 22.4 s |
| 04 | auto tool_choice | 200 | **tool_use** | tool_use:submit_color | 2021 / 22 | 16.9 s |
| 05 | response_format json_schema | 200 | end_turn | text (ignored) | 1936 / 41 | 17.8 s |
| 06 | output_config.format | 200 | end_turn | text (ignored) | 1936 / 27 | 16.8 s |
| 07 | prompt cache (beta hdr) | **timeout 30 s** | — | — | — | — |
| 08 | count_tokens | 200 | — (`{input_tokens}`) | — | — | 3.0 s |
| 09 | max_tokens=1 truncation | 200 | end_turn (**not capped**) | text | 1935 / 295 | 22.3 s |
| 10 | missing max_tokens (400?) | **200** (lenient default) | end_turn | text | 1924 / 29 | 18.2 s |
| 11 | bad token | **401** | — | — | — | 0.17 s |
| 12 | bogus model | **400 upstream_error** | — | — | — | 15.6 s |
| 13 | 250 ms client timeout | timeout (client) | — | — | — | 0.25 s |
| 14 | tool auto (analysis schema) | 200 | tool_use | tool_use:submit_analysis ✓valid | 2202 / 75 | 19.3 s |
| 15 | tool auto (repeat) | 200 | tool_use | thinking, tool_use ✓valid | 465 / 418 | 28.4 s |
| 16 | tool auto (repeat) | 200 | tool_use | thinking, text, tool_use ✓valid | 465 / 605 | 28.2 s |
| 17 | thinking:disabled + forced tool | 200 | tool_use | thinking (ignored disable), tool_use ✓ | 492 / 280 | 23.4 s |
| 18 | count_tokens shape | 200 | `{input_tokens:89}` | — | — | 0.29 s |
| 19 | min input "x" | 200 | end_turn | text | **1923** / 12 | 17.1 s |

P14–16 all returned schema-valid `submit_analysis` JSON (correct enum, integer confidence, Russian `summary_ru`,
`evidence_ids:["ev_1"]`) — the transport is reliable.

## Adapter contract implied by these results

1. **Transport:** `messages` + `tools:[submit_X]` + `tool_choice:{type:"auto"}` + a system/user instruction that
   ends with *"You MUST call submit_X exactly once."* Extract `content.find(b=>b.type==="tool_use").input`.
2. **Fallback:** if `stop_reason≠tool_use` or no tool_use block → try to parse a JSON object from the last `text`
   block; if that fails → deterministic fallback (no LLM section).
3. **Repair:** only on schema/evidence-validation failure of the tool_use input; **max one** repair; repair message
   carries only the rejected object + validation errors + schema + allowed evidence IDs. Never a JSON-syntax repair.
4. **Timeouts:** default 75 s; transient (timeout/429/5xx/network) retried with bounded backoff+jitter; 400/401/
   schema errors never blind-retried.
5. **Cost:** from response `usage` (input+output tokens × configured per-Mtok price). `count_tokens` estimates our
   own input; actual billed input includes variable gateway overhead — persist actuals, budget conservatively.
6. **Telemetry:** `schema_mode=tool_use`, `stop_reason`, tokens, cache tokens (expect 0), latency, repair flags.

## Not measured / left as fixtures
Live 429 and 5xx were not force-triggered (avoid abusive traffic); handled by category in the adapter and covered by
unit fixtures. Refusal not force-triggered live; covered by a fixture. Prompt-cache treated as unsupported (0 tokens).
