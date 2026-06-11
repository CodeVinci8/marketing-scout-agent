# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-12 — WF10 v0.2 patch (DEC-106/107/108) · WF11 Telegram-preview foundation (DEC-109/110) · validation/report/Telegram architecture (DEC-111/112/113)

**What was done ($0, no external calls; WF04–09 untouched):**
- **WF10 v0.2** after operator tests v0.1 (Test 1: 82 rows → 21 profiles/9 angles/8 signals/1 plan/7 rules;
  repeat +0 rules; Avito-фильтр PASS; **no-data тест нашёл баг** — generic план при rows=0):
  **no-data guard** (только помеченный `no_data` план: пустые списки, `source_evidence=rows=0`,
  `next_action=no_data; broaden filters or source scope`; result_summary начинается `no_data;`),
  **entity resolution** company_name → profile_url → canonical listing id → profile_name → offer+platform
  (fallback) — `(unnamed)`-дубли одного объявления схлопываются, **source_mix метка**
  `mixed: live + historical/manual + web pipeline`. Сим: **31 PASS**; схемы 17/9/14/12/5 без изменений.
- **WF11 BUILT** (`11_social_source_connector_foundation.json`, active=false, 17 nodes): первый non-Avito
  источник = **Telegram public-channel preview** (DEC-109, матрица сравнения в STAGE_3_4 §5). Fixture-only:
  `fixture_mode=true`, `live_mode=false`, **HTTP-нод нет** (live-ветка = guard с ошибкой); 6 fixture-постов
  (3 competitor ads / 1 market signal / 1 hard-negative контроль / 1 дубль); пишет ТОЛЬКО agent_requests(21)/
  raw_market_records(40)/market_record_registry(15); политика контактов соблюдена. Сим: **31 PASS**
  (6 received / 1 hard-skip / 4 unique / 1 dup; raw +5 / registry +4; повтор unique=0; guard throws).
- **Новые планы:** GOOGLE_SHEETS_VALIDATION_PLAN (DEC-111: вкладка validation_lists, 25 списков, dropdowns =
  validation-правила на ручных полях, НЕ новые колонки), REPORTING_AND_TELEGRAM_SUMMARY_PLAN +
  MARKET_INTELLIGENCE_REPORT_SCHEMA (20 cols, proposed) + TELEGRAM_CONTROL_AGENT_PLAN (DEC-112: **Claude — в
  report/control-слое, НЕ в WF10**; поток WF10 tabs → Report Builder → optional Claude → reports tab →
  Telegram digest → Control Kernel; Telegram = control/report интерфейс, не парсер).
- **DEC-113:** MVP = connectors → raw → WF08 → WF10 → report/Telegram; Avito — первый стабильный live-источник,
  не продукт.
- Decisions: DEC-106…113. Docs: STAGE_3_4 (§5), SOCIAL_MATRIX, WF10 plan/schemas/RU, WF11 RU, TABLE_SCHEMA,
  DECISIONS, ROADMAP, NEXT_ACTIONS, COSTS, CAPABILITIES, BACKLOG, AGENT_LOG, recent.

**Next operator action:** commit → re-import WF10 v0.2 (retest: обычный прогон — профилей меньше 21, source_mix
в summary; no-data прогон — помеченный план, `no_data;` префикс; вернуть фильтр) → импорт WF11 (Тест 1:
6/1/4/1 → raw +5/registry +4; Тест 2 повтор: unique=0; Тест 3: live guard) → опционально WF08 handoff по
wf11_req_… → применить validation_lists → дальше (по одобрению) WF11 live transport / Report Builder v1.

---

## Session: 2026-06-11 (session 3) — STAGE 3.3 CLOSED (DEC-102) · WF09 v006 canonical URLs (DEC-103) · WF10 v0.1 BUILT (DEC-104) · backlog (DEC-105)

**What was done (closure + URL fix + first aggregator; no external calls):**
- **Stage 3.3 CLOSED / APPROVED (DEC-102):** live run #3 `avito_req_20260611_184324` — 10/10 structurally valid,
  **7 false positives hard-skipped BEFORE raw/registry**, 3 relevant brokers (duplicate `4379480780` + unique
  `8000151804`/`8011965808`), registry +2 exact. WF08 live handoff (filtered, deterministic_first):
  **monitor_queue +2 / technical_errors=0 / Claude=0**, full ad-intel fields (terms «от 500 ₽»/«Цена договорная»,
  strength 79, content_idea 45). All 10 closure criteria pass; Avito = первый стабильный live-источник.
- **WF09 v006 (DEC-103):** root cause of the live `?context=` leak — `normUrl`/`canonUrl`/`slugText` used
  `new URL()`, недоступный в sandbox Code-ноды n8n → переписаны на чистые regex/string. **Verified (12 checks
  PASS).** **Watch item:** на следующем рутинном live-прогоне проверить отсутствие `?context=`.
- **WF10 v0.1 BUILT (DEC-104, active=false, 22 nodes, $0, детерминированный):** monitor/content/review → окно
  30 дней + фильтры → competitor_profiles (17) / market_angles (9) / audience_activity_signals (14, агрегаты) /
  content_positioning_plan (12) / source_confidence_rules (5, seed-once) + 1 agent_requests. 19 checks PASS.
- **New docs:** WF10_TABLE_SCHEMAS, FUTURE_CAPABILITIES_BACKLOG (DEC-105), N8N_WORKFLOW_10_RU; Stage 3.4
  strategy polished. Decisions: DEC-102…105.

**Resolution (2026-06-12):** WF10 операторские тесты пройдены, no-data баг найден и исправлен в v0.2 (DEC-106).

---

## Session: 2026-06-11 (session 2) — WF09 live business relevance filter (DEC-095) + Stage 3.4 architecture pack (DEC-096…101)

**What was done (relevance filter after live false positives; fixture/baseline preserved; docs pack; no external calls):**
- **Live retest #2 diagnosis:** `avito_req_20260611_001222` — transport PASS (10/10 valid), но обе unique-строки
  были false positives (юр. адреса); релевантный брокер — дубликат.
- **WF09 patch (v005, DEC-095):** relevance evidence = title + description + decoded URL slug + category only;
  hard negatives без сильного кредитного evidence → `hard_skipped` (не пишутся в raw/registry, не тратят
  `pipeline_limit`); 8-count `result_summary`; канонические listing-URL. Fixture-путь не изменён (31 checks PASS).
- **New docs (DEC-096…101):** CONTACT_AND_OUTREACH_POLICY, STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY (one source
  at a time), WF10 plan (gate), NICHE_PACK_SYSTEM_PLAN, COMPETITOR_AD_INTELLIGENCE_PLAN.
- **Resolution (session 3):** live retest #3 PASSED → Stage 3.3 closed (DEC-102); `?context=` исправлен в v006.
