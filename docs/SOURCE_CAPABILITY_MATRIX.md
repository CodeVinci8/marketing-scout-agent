# Source Capability Matrix

Honest, single-page truth table of what Marketing Scout can and cannot collect, and under what
preconditions. The agent must never claim a capability it cannot run; unavailable capabilities are surfaced as
`setup_required` with the exact missing prerequisite (see `n8n/lib/agent_charter.js`, `source_monitor.js`,
`tracked_sources.js`, `vk_collector.js`, `telegram_channel.js`).

Status legend:

- **available** — collector exists and runs with the default/website configuration.
- **setup_required** — visible and selectable, but needs an operator-enabled collector and/or credentials before
  it will run. Never silently skipped, never a fake empty success.
- **unsupported** — out of scope by policy (private/closed/credential-bypassing); never attempted.

## Platforms

| Platform | Mode | Status (default) | Enabled by | Reads | Hard limits / never |
|---|---|---|---|---|---|
| Website | Firecrawl pipeline (WF04→WF16) | **available** | always (source_allowlist includes `website`) | public pages, offers, prices, CTA, positioning, changes | only URLs that pass `url_safety` (no private/loopback/metadata hosts) |
| Avito | discovery / search-card (WF09) | **available** (bounded) | always | public search cards / listing discovery | no login-walled detail scraping, no private contact data |
| Telegram channel | bot update (`channel_post`/`edited_channel_post`) | **setup_required** | bot added as channel **admin** + `MS_ENABLE_TELEGRAM_COLLECTOR` | **future** posts only (after activation), edits | cannot read arbitrary past history; no private chats/DMs |
| Telegram channel | external history | **setup_required** | external MTProto user-client collector + its credentials | public channel history | not built-in; never fabricated |
| VK community | public wall (WF26, official API) | **setup_required** | `MS_ENABLE_VK_COLLECTOR` + VK token in n8n credential store | public community wall posts, new/edited posts, bounded backfill | no private/closed groups, no profiles, no messages, no member/audience scraping, no full archive |
| VK community | comments | **setup_required** (flag) | `vk_enable_comments` (disabled by default) + separate budget | bounded public comments per post | no private/deleted comments |

## VK official API operations (WF26)

| Operation | API method | Purpose | Bound |
|---|---|---|---|
| resolve community | `groups.getById` | screen name / numeric id → canonical community (id, owner_id, screen_name) | one call |
| read wall | `wall.get` (`owner_id` negative, `filter=owner`) | public wall posts | `vk_max_posts` × `vk_max_pages`, `vk_page_size` |
| read comments | `wall.getComments` | optional public comments | only if `vk_enable_comments`; `vk_max_comments_per_post` |

`VK_API_VERSION` is configurable and validated against a supported set (default `5.199`). The access token lives
**only** in the n8n credential store (`httpQueryAuth`) — never in workflow JSON, params, logs, Sheets or fixtures.

### VK error → status mapping

| Condition | VK signal | Mapped to |
|---|---|---|
| missing token / collector disabled | (no call made) | `setup_required` (no spend) |
| invalid/expired token | `error_code 5` | `token_invalid` → setup_required |
| rate limit | `error_code 6` / `29` | `rate_limited` → bounded backoff, keep cursor |
| access denied / private | `error_code 15` / `203`, `is_closed≠0` | `access_denied` / `private_group` |
| deleted / banned group | `deactivated` | `deleted` / `banned` |
| invalid screen name / params | `error_code 100` | `invalid_request` |

## VK monitoring (WF23 → WF26)

First successful run **establishes a baseline** (no "new" alerts unless explicitly requested). Thereafter: a new
post emits one event; an edited post emits one event per actual changed version (version = `post_id@edit_ts` or
content hash); a deterministic `change_id` dedups across scheduled runs; an old pinned post does not re-alert; a
failed collection keeps the last cursor/baseline and backs off; `setup_required` sources are skipped without
spend. Alerts link to the canonical post URL (`https://vk.com/wall<owner_id>_<post_id>`).

## Record identity & isolation (all platforms)

- Stable identity: website = canonical URL; VK = `owner_id + post_id`; Telegram = `channel + message_id`.
- Edited content carries a version id (edit timestamp or content hash) so an edit is one distinct version.
- Every record carries `agent_request_id`, `source_run_id`, `workflow_run_id`, `owner_user_id` — exports and
  digests are scoped by `(owner_user_id, agent_request_id, report_id)` and never leak across owners/requests.

## Safety preconditions

- **URL fetch**: every target passes `url_safety.assertSafeUrl` (blocks loopback/private/link-local/metadata
  hosts, `file://`, non-http(s) schemes, credentialed URLs, dangerous ports).
- **Untrusted content**: scraped text is wrapped as data-only and scanned for prompt injection
  (`url_safety.wrapUntrusted` / `detectInjection`) before it can reach a prompt.

## Repository capability status

The VK collector is **structurally implemented, offline-tested, live-unverified** — do not mark it
production-live until an actual credentialed staging test is completed. The Telegram bot-update path is likewise
offline-tested and live-unverified. All workflows ship `active=false`.
