# VK_MONITORED_SOURCE_RUNBOOK.md — Monitored VK Groups: config, credential & future-live runbook

**Status:** 🟡 ARCHITECTURE IMPLEMENTED · LIVE = **BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN**.
The monitored engine + deterministic simulation are built and validated ($0). The live two-stage transport ships
**DISABLED/staged**. **Do NOT run live now.** Live is unblocked only after: Stage C.1 retest passes, required
Stage 2/3 tests pass, the operator provides a VK credential + approved public groups, and the operator explicitly
authorizes the run.
**Date:** 2026-06-19 · **Decisions:** DEC-141. **Workflow:** WF13 (`active=false`).
**Related:** `docs/STAGE_C_1_TEST_RESULTS.md`, `docs/STAGE_C_ACCEPTANCE_PACK.md`, `docs/CONTACT_AND_OUTREACH_POLICY.md`.

---

## 1. What "monitored VK groups" means

The canonical live Lead Scout flow is two-stage and PUBLIC-only:

```
group allowlist → wall.get (recent public posts) → POST-level relevance → select relevant posts (capped)
              → wall.getComments (public comments on selected posts) → COMMENT-level relevance
              → raw_market_records → market_record_registry → (manual) WF14 → public_lead_signals
```

The operator does **not** copy each post URL by hand (that is the separate **explicit-post smoke** mode, kept for
first acceptance and fallback). Monitored mode discovers recent posts itself, but only fetches comments for posts
that pass post-level relevance, within hard caps.

**Hard scope (CONTACT_AND_OUTREACH_POLICY):** official VK API + PUBLIC data only. **No** private messages, closed
groups, member/follower lists, hidden/inferred contacts, MTProto, unofficial scraping, or auto-outreach. Every
final lead has `outreach_allowed=false`. Author/contact stored only if **verbatim public** + with a source URL.

## 2. Two live modes (both gated, both currently inert)

- **Mode 1 — explicit-post smoke** (first acceptance / fallback): `live_post_allowlist` of 1–2 approved public
  post URLs → `wall.getComments` only. Smallest, safest diagnostic. (Existing C4 path.)
- **Mode 2 — monitored groups** (this runbook): `monitored_groups` allowlist → `wall.get` → select → `wall.getComments`.
  Enable **only after** Mode 1 smoke passes.

## 3. Monitored configuration (no workflow-code edits required)

Set in WF13 **`Set Connector Config`** (defaults are inert/empty — real groups are **never** committed):

| Field | Meaning | Default |
|-------|---------|---------|
| `monitored_mode` | arm live two-stage monitored crawl | `false` |
| `monitored_fixture_mode` | run the deterministic $0 simulation (no network) | `false` |
| `monitored_groups` | allowlist `[{screen_name, category, enabled, region, niche_scope, post_lookback_days, max_posts_per_group, max_relevant_posts, max_comments_per_post}]` | `[]` |
| `monitored_max_groups_per_run` | hard cap on groups per run | `5` |
| `monitored_max_posts_per_group` | wall.get page cap per group | `10` |
| `monitored_max_relevant_posts` | max posts selected for comment fetch per group | `5` |
| `monitored_max_comments_per_post` | wall.getComments cap per post | `20` |
| `monitored_max_total_comments` | hard cap on comments per run | `100` |
| `monitored_post_lookback_days` | post recency window | `14` |
| `monitored_request_timeout_ms` / `monitored_max_retries` / `monitored_backoff_ms` | transport bounds | 15000 / 2 / 1500 |

`category` ∈ `competitor` · `finance_community` · `city_community` · `entrepreneur_community` (preserved in
normalized metadata so downstream can tell competitor / market context / consumer demand apart).

**Post-level relevance** (decides whether comments are fetched): `relevant_demand_context` and `competitor_activity`
posts trigger comment fetch; `market_signal` is retained as market context (no auto-lead, no comment fetch);
`hard_negative` / `irrelevant` posts never consume the comment budget. **Comment-level relevance**: a comment becomes
a lead only with its **own** demand/question/objection/complaint **and** finance relevance — supplier/broker, admin/
moderator, promotional and spam replies are skipped; a parent post's credit terms do **not** make a comment a lead.

## 4. Deterministic simulation (run now, $0)

```
node n8n/fixtures/lead_scout/run_wf13_monitored.test.js   # or set monitored_fixture_mode=true in n8n
```

The simulation exercises 20 cases (§6.4): competitor/finance/city/entrepreneur posts with valid comments; irrelevant
post whose comments are NOT fetched; supplier/admin/spam comment skips; market-news retention; duplicate post +
duplicate comment; comments-disabled / deleted / API-error / rate-limit posts; hard-negative post; public contact
with evidence; contact without evidence (source-level blank); repeat-run producing no new rows; relevant comment
under a competitor promo. Result: clean WF14-ready records, all $0.

## 5. VK credential & live-readiness (operator — verify immediately before any live run)

- **Token type:** a VK **standalone/service** app access token with PUBLIC wall read. Public `wall.get` /
  `wall.getComments` work on **open** communities; no special review for public read.
- **n8n credential:** create a credential (Header Auth or a query param) carrying the token. **Bind it as an n8n
  credential only** — the token is NEVER pasted into the workflow JSON (the placeholder is
  `BIND_N8N_VK_CREDENTIAL_NEVER_PASTE_TOKEN`).
- **Nodes that use it:** the disabled placeholders `Fetch VK Group Walls (DISABLED placeholder)` (wall.get) and
  `Fetch VK Post Comments (DISABLED placeholder)` (wall.getComments). Enable them only when arming live.
- **Permissions:** read-only public wall/comments. Do **NOT** request friends/messages/groups-management/offline scopes.
- **API version:** `5.199`. **Cost:** public `wall.get`/`wall.getComments` are free (exposure is VK rate limits,
  operational, not money).
- **Non-secret IDs to configure:** `monitored_groups` screen names/categories (Mode 2) and/or `live_post_allowlist`
  public post URLs `https://vk.com/wall-<owner>_<post>` (Mode 1).
- **Verify safely:** keep caps tiny on the first run (1–2 groups, `max_posts_per_group≤5`, `max_total_comments≤20`).
- **Rotate/revoke:** rotate the token in the VK app dashboard and update the n8n credential; revoke by deleting the
  app token. Never store the approval-token value in any ledger (WF15 validator enforces this).

⚠️ **Verify before live:** confirm the exact current VK API token form / n8n credential mapping in the VK developer
docs at run time — VK API specifics can change; this runbook is based on the implemented `wall.get`/`wall.getComments`
v5.199 public-read path and does not assume any non-public permission.

## 6. Future first-live runbook (BLOCKED — do not execute now)

Prerequisites (ALL): Stage C.1 retest PASS · required Stage 2/3 tests PASS · VK credential provided · approved
public groups/posts provided · explicit operator authorization.

**Initial group selection criteria:** active recent public posts; public comments enabled; relevant Moscow/region or
business audience; enough credit/finance discussion; no private-access requirement; low volume suitable for a bounded
smoke.

**First live = Mode 1 explicit-post smoke** (1–2 approved posts, tiny caps, `wall.getComments` only):
arm `live_approval_token=I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION`, fill `live_post_allowlist`, bind the VK credential,
enable the single-stage HTTP node, run once. **Expect:** real public comments → audience rows → (manual) WF14 leads;
`live_source_runs +1` (mode=live, external_calls counted, cost ≈ $0); no member extraction, no private data.

**Monitored Mode 2 is enabled only after the explicit-post smoke passes**: fill `monitored_groups`, set
`monitored_mode=true` + the approval token, bind the credential, enable the two-stage HTTP placeholders, run once
with tiny caps. **PASS criteria, separated:** transport success (HTTP 200) ≠ extraction success (posts/comments
parsed) ≠ relevance success (business-relevant posts/comments) ≠ dedup success ≠ storage success ≠ business
acceptance (real consumer demand). A successful API response alone is **never** a successful lead-source test.

**Sheet deltas (live):** `raw_market_records` += accepted posts/comments, `market_record_registry` += unique,
`agent_requests +1`, `live_source_runs +1` (mode=live). Inspect the WF13 monitored counters, then run WF14 manually.

**Credential rotation/revocation:** see §5.
