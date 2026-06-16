# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-16 (session 5) — Operator test pack (12 PASS) · WF14 quota patch v0.2 (DEC-130 patch)

**Current blocker (exact):** WF14 TEST 8 failed in operator run — `Append public_lead_signals` →
`The service is receiving too many requests from you` (Google Sheets quota / item explosion). TEST 9 (repeat
dedup) NOT RUN, blocked by TEST 8. **This session patched WF14 only; retest is pending.**

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

**Next operator action:** re-import patched WF14 v0.2 (do NOT activate; paste Spreadsheet ID + rebind
credential on 5 sheet nodes) → **TEST 8 retest** (≥2 rows, no quota error, status=completed, rows_read_* show
one read/tab) → **TEST 9 retest** (signals_written=0, duplicates_skipped>0, status=completed_no_data) →
rerun WF12 deterministic to ingest `public_lead_signals` → only then stage-closure review. Stage 3/4 NOT closed.

**Consistency pass (2026-06-16, same session):** WF10 internal identity labels synced v0.2 → **v0.3**
(versionId was already v003; code already had DEC-127 objection/pain behavior — labels only, no logic change);
WF12 public-lead-signal wording made fully conditional (only says "tab empty — run WF14" when zero rows; new
branch for all-dismissed); **DEC-131** recorded (triage workflows: single-read sheets + scoped/capped pool +
capped append to avoid Sheets quota). No external calls, no activation, no stage closure. recent.md trimmed
to 3 sessions (session 2 archived in AGENT_LOG).

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

---

## Session: 2026-06-12 (session 3) — WF08 llm_enabled kill switch (DEC-119) · WF11 v0.2 live path (DEC-120) · WF13 VK foundation (DEC-121) · WF12 v0.2 (DEC-122) · Stage 3/4/5 defined (DEC-123)

**What was done ($0, без внешних вызовов/Claude/live; WF09/WF10 не тронуты):**
- **WF08 v10:** причина `primary_json` при handoff найдена (uncertain → Claude при llm_enrichment=false).
  Добавлен **`llm_enabled=false`** master switch: uncertain → review_queue с
  `parse_method=deterministic_uncertain_no_llm` ($0); throw-guard в Claude-ноде; zero-record диагностика
  в summary. Avito-поведение без изменений. Сим PASS.
- **WF11 v0.2:** охраняемый live-путь: гейт (token `I_APPROVE_LIVE_TELEGRAM_PREVIEW` + allowlist, отказ
  группам/инвайтам) → ОТКЛЮЧЁННАЯ HTTP-нода (t.me/s preview) → инертный парсер (ошибка без HTML).
  Fixture-счётчики не изменились (6/5/1/4/1; повтор 0/5). Live НЕ выполнялся.
- **WF13 BUILT:** VK public groups/posts/comments foundation (выбор A: закрывает разрыв
  audience_activity_signals). Fixture-first, без HTTP-нод, guard; 40/15/21 колонок; агрегаты авторов
  только счётчиками по unique (3 актив. / 1 повторный); вопросы/возражения → review_queue. Сим PASS:
  6/5/1/4/1, raw +5, registry +4, повтор 0/5.
- **WF12 v0.2:** полный отчёт (executive_summary / competitor_snapshot / top_offers_and_prices /
  market_angles+тренды / audience / content_plan / source_confidence / limitations+source_mix /
  next_actions) + охраняемая ОТКЛЮЧЁННАЯ Claude-ветка (claude-sonnet-4-6 плейсхолдер, evidence-bound
  промпт, llm_cost_usd по usage $3/$15 за MTok; merge бросает ошибку без ответа). Сим PASS (вкл. no_data,
  cost=0.012 на 2000/400 токенов).
- Docs: STAGE_3/4/5 (новые), WF13 RU (новый), патч-ноты WF08/11/12 RU, STAGE_3_4 §5.7, ROADMAP,
  NEXT_ACTIONS, AGENT_CAPABILITIES, BACKLOG, DECISIONS DEC-119…123, AGENT_LOG.

**Next operator action:** commit → re-import WF08 v10 (тест cost-control на первом id
`wf11_req_20260612_033442` + нулевой прогон на duplicate id) → re-import WF11 v0.2 (fixture retest +
gate-тест) → import WF13 (3 fixture-теста + handoff `platform=vk`) → re-import WF12 v0.2
(детерминированный прогон + guard-тест) → WF10 → WF12 (тренды по 2 прогонам). Live/Claude/Telegram —
каждое за отдельным явным одобрением.
