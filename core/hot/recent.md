# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-16 (session 6) — WF11 v0.4.1 post-level relevance fix + WF08 loop-summary accounting fix (DEC-133/134)

**Status (exact):** first gated WF11 live smoke ran end-to-end (transport/parser/dedup PASS) but **live relevance
was too loose** — holiday/personal posts written as business-relevant, market news inflated to competitor. This
session is a **focused correction patch only** (no new sources, no VK/groups/MTProto/Claude/Stage 5). The live
runs `wf11_req_…054733/055318/055705`, `touchpoint_…060227`, `wf10_…061138` are **contaminated diagnostics — NOT
Stage 3 closure evidence.** Stage 3 is NOT closed.

**WF11 v0.4.1 (DEC-133; $0, fixture default, inert live):**
- Relevance now decided by **post text only**; channel title/username/allowlist = confidence/metadata, never
  relevance. `OFFER`→competitor_activity, `MARKET`/`POSITIVE`→market_signal, no post-level finance evidence →
  `irrelevant_live_false_positive`→hard_skip (counted in `hard_skipped_items`/`irrelevant_false_positives`; not
  written to raw/registry by default; `live_debug_audit=false` gates optional audit). Short tokens use Cyrillic
  word boundaries; no hardcoded post IDs. market/news on a competitor channel stays market_signal.
- LIVE `agent_requests` now logs the **actual live allowlist** + `source=live_preview` + `transport=…` (was
  fixture allowlist). next_action gated on `unique>0 && business_relevant>0`; suggests allowlist/relevance
  change when false positives dominate; no auto-handoff.

**WF08 v0.10 (DEC-134; summary accounting only — routing untouched):**
- `Final Summary` aggregates the loop **done** output (`$input.all()`) instead of last-iteration in-loop `.all()`
  → `total_processed`/`deterministic_rows`/`route_counts` were 1, now correct (sim: selected=8 → processed=8).
  `processed_accounting_ok` added. `llm_enabled=false` ⇒ claude_calls=0, cost=0 preserved.

**Validation:** JSON valid; 7 Code nodes pass `node --check`; relevance sim 11/11; WF08 summary sim coherent;
active=false; transports DISABLED; fixture_mode=true/live_mode=false defaults; no keys/Spreadsheet ID/Bot
API/MTProto-usage.

**Next operator action:** (1) commit; (2) re-import WF11 + WF08; (3) **WF11 fixture retest** (expect unchanged:
6/1/5/4/1, false_positives=0); (4) **WF11 live retest** on `brokershakurova` + `ipotekapro` — expect
1231/1233/1240/4106 skipped as false positives, real service posts kept, market digests = market_signal; (5)
WF08 handoff on a **clean** WF11 live run and confirm summary counters match queue rows. Live VK + Claude summary
remain gated. Stage 3/4 NOT closed.

---

## Session: 2026-06-16 (session 5) — WF14 quota patch v0.2 + RETESTS PASS · consistency pass · WF11 v0.4 gated Telegram live preview (DEC-130/131/132)

**Status (exact):** all operator retests now PASS — **no open blocker.** WF14 v0.2 (single-read + scoped/capped
+ capped append) cleared the Google Sheets quota failure; WF12 post-WF14 deterministic report now shows the
public-lead-signal block. Next step is the first gated Telegram live smoke (WF11 v0.4), under its own approval.

**Operator retest pack — PASS:**
- **WF14 TEST B (first patched run):** `public_lead_signals +4`, `agent_requests +1`, `signals_written=4`,
  `duplicates_skipped=2`, `status=completed`, no quota error, no outreach, `raw_market_records/registry/technical_errors +0`.
- **WF14 TEST C (repeat dedup):** `+0`, `duplicates_skipped=6`, `signals_written=0`, `status=completed`.
- **WF14 TEST E (full-history quota check):** no quota error, `+0`, `duplicates_skipped=6`, `technical_errors +0`.
- **WF12 TEST D (deterministic after WF14):** `market_intelligence_reports +1`, `agent_requests +1`,
  `live_source_runs +1`, `llm_status=disabled`, `llm_cost_usd=0`, report includes `public_lead_signals: 4 (new: 4)`
  (no longer says the tab is empty).
- Rest of pack still green: WF13 fixture/repeat/live-guard · WF11 fixture/live-guard · WF13→WF08 · WF10 · WF12 Claude guards · WF15 logger/enum.

**Test pack result:** 12 PASS (WF13 fixture/repeat/live-guard · WF11 fixture/live-guard · WF13→WF08 handoff ·
WF10 · WF12 deterministic + 2 Claude guards · WF15 logger + enum), **WF14 FAIL → patched**.

**WF14 v0.2 patch ($0, no external/Claude/live; ONLY WF14 touched):**
- Root cause: linear sheet-reader chain → `Read raw_market_records` / `Read public_lead_signals` ran once per
  upstream item (15 → 1410+ → thousands of API requests) before append.
- Fix: single-read architecture (collapse `Hold Config` nodes → each tab read ONCE); real `Set Triage Config`
  scoping (`max_source_rows=100`, `max_signals_to_write=25`, `min_signal_score=50`, platform/source filters,
  only/backfill untriaged); candidate pool scored/sorted/deduped/capped BEFORE append; append ≤25 items (one
  batch); deterministic hash `lead_signal_id` dedup + fallback key; controlled `completed_no_data`.
- No outreach action reachable; MSK timestamps + active=false preserved.
- Validated: JSON OK, 6 jsCode pass `node --check`, no key/Spreadsheet ID/HTTP/Claude/VK/Telegram nodes;
  local sim: 2 signals on run 1, 0 (duplicates_skipped=2) on repeat.

**Consistency pass (earlier same session):** WF10 identity labels synced v0.2 → **v0.3** (labels only, code
already had DEC-127); WF12 lead-signal wording made fully conditional; **DEC-131** recorded (single-read +
scoped/capped + capped append). recent.md trimmed to 3 sessions (session 2 archived in AGENT_LOG).

**WF11 v0.4 — gated Telegram live preview built (DEC-132; $0, no network, inert by default):** added a real but
INERT live-source path on top of the v0.3 guard. Transport selectable via `live_transport`: **firecrawl**
(preferred, needs Firecrawl credential) or **http_get** (fallback, no per-call fee), routed by a new
`Route Live Transport` IF; **both transport nodes ship DISABLED**. Gate now accepts username OR
`t.me/s|/<channel>` URLs, normalizes to username, and rejects `t.me/+`/joinchat/`t.me/c`/groups/private/numeric
ids; `live_max_channels≤2` (first smoke), `max_posts≤10`. Parser extracts channel/post_url/date/text/view_count
(opt.)/verbatim public contact and handles both Firecrawl and HTTP response shapes. Live source cost recorded in
agent_requests + live_source_runs: http_get=$0, firecrawl=`cost_not_recovered`. Fixture path unchanged
(local sim: 6 posts → 4 unique / 1 dup / 1 hard-skip; manager_note empty). Sanitized parser sample:
`n8n/fixtures/wf11_tme_s_preview_sample.html`. `active=false`; defaults `fixture_mode=true`/`live_mode=false`.

**Next operator action:** (1) commit; (2) **gated WF11 live smoke** — set token + 1–2 public-channel allowlist
+ transport + enable the chosen transport node, run, verify `live_source_runs +1` (mode=live, external_calls=channels,
cost recorded), then WF08 handoff. Live VK is the step AFTER that (see NEXT_ACTIONS checklist). Stage 5 Telegram
bot NOT started. Do NOT mark Stage 3/4 fully closed (live TG/VK + Claude summary still gated).

---

## Session: 2026-06-12 (session 4) — Live-ready WF11/WF13 · WF14 lead signals · live_source_runs+WF15 · WF10 v0.3 · WF12 v0.3 + Claude budget path · Stage 2 reintegration (DEC-124–130)

**What was done ($0, без внешних вызовов/Claude/live; WF04–WF09 не тронуты):**
- **DEC-124:** фикс `#ERROR!` для `+7`-телефонов — Sheets-safe апостроф в WF11/WF13/WF14.
- **WF13 v0.2 (DEC-125):** охраняемый live-путь VK (гейт `I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION` + allowlist →
  ОТКЛЮЧЁННЫЙ HTTP официального VK API wall.get → инертный парсер); комментарии → `public_comment`;
  метки → `stage_3_source_foundation_vk_public_discussion`; fixture-счётчики без изменений.
- **live_source_runs (DEC-126):** 23-колоночный журнал прогонов; WF11/WF12/WF13 пишут автоматически;
  WF15 — ручной логгер с enum-валидацией (отклоняет значения токенов).
- **WF10 v0.3 (DEC-127):** objection_count реальный (был 0): словарь недоверия только по review_queue;
  боли укрупнены («просрочки / плохая КИ», «страх предоплаты / мошенников»); comment_text в blob.
- **WF14 NEW (DEC-130):** детерминированный триаж публичных лид-сигналов → `public_lead_signals` (28);
  9 болей / 5 намерений / скоры 0–100; публичный профиль = evidence, НЕ разрешение на аутрич.
- **WF12 v0.3 (DEC-128):** stakeholder-отчёт (дайджест 5–7 пунктов, чистые имена, блок сайтов из
  `competitor_site_snapshots`, блок лид-сигналов, блоки действий; схема 25 колонок) + test-ready
  Claude-ветка: бюджетный гейт ДО HTTP + JSON-секции + quality-флаги + учёт токенов/стоимости.
- **Stage 2 (DEC-129):** реинтеграция веб-пайплайна: вкладка `competitor_site_snapshots` + блок в отчёте;
  WF04 Phase B — отдельной сессией; auto-handoff 06→04 осознанно остаётся отложенным.
- Валидация: 6 JSON OK; active=false; ключей/ID нет; все HTTP disabled; все jsCode проходят node --check.

**Next operator action:** см. NEXT_ACTIONS session 4: commit → создать 4 вкладки → ретесты WF13/WF11 →
handoff WF08 → проверка WF10 v0.3 (vk: questions≥2, objections≥1, buying≥1) → WF14 (2 сигнала + дедуп) →
WF12 v0.3 (детерминированный + guard/budget тесты) → WF15. Live/Claude — каждое за отдельным одобрением.

