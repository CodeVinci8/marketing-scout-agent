# Hot Memory — Recent Sessions

Most recent first. Keep last 3 sessions max. Archive older entries to `core/warm/decisions.md`.

---

## Session: 2026-06-11 (session 3) — STAGE 3.3 CLOSED (DEC-102) · WF09 v006 canonical URLs (DEC-103) · WF10 v0.1 BUILT (DEC-104) · backlog (DEC-105)

**What was done (closure + URL fix + first aggregator; no external calls):**
- **Stage 3.3 CLOSED / APPROVED (DEC-102):** live run #3 `avito_req_20260611_184324` — 10/10 structurally valid,
  **7 false positives hard-skipped BEFORE raw/registry**, 3 relevant brokers (duplicate `4379480780` + unique
  `8000151804`/`8011965808`), registry +2 exact. WF08 live handoff (filtered, deterministic_first):
  **monitor_queue +2 / technical_errors=0 / Claude=0**, full ad-intel fields (terms «от 500 ₽»/«Цена договорная»,
  strength 79, content_idea 45). All 10 closure criteria pass; Avito = первый стабильный live-источник.
- **WF09 v006 (DEC-103):** root cause of the live `?context=` leak — `normUrl`/`canonUrl`/`slugText` used
  `new URL()`, недоступный в sandbox Code-ноды n8n → try/catch молча сохранял query и обнулял slug-evidence.
  Переписаны на чистые regex/string (канон-срез query/hash только при id объявления в пути; dedup_key не менялся).
  **Verified в vm-контексте БЕЗ глобального URL (12 checks PASS):** fixture/duplicate без изменений; live-батч по
  мотивам run #3 → принятые строки и registry канонические (без `?`), счётчики 4 hard_skipped/2 unique/1 duplicate.
  **Watch item:** на следующем рутинном live-прогоне проверить отсутствие `?context=` в source_url/post_url.
- **WF10 v0.1 BUILT (DEC-104, `10_competitor_audience_intelligence_aggregator.json`, active=false, 22 nodes, $0,
  детерминированный — без Claude/Apify/Firecrawl):** monitor/content/review → окно 30 дней + фильтры
  (niche=credit_brokerage, region='Москва/МО') → группировка конкурентов (company_name → profile_name →
  offer+platform → listing id) → competitor_profiles (17) / market_angles (9 фикс. углов) /
  audience_activity_signals (14, только агрегаты) / content_positioning_plan (12) / source_confidence_rules
  (5, seed=7 правил только при пустой вкладке) + 1 agent_requests (21, $0). **Verified (19 checks PASS):** фильтры
  окна/региона, 2 профиля из реальных live-строк (с ценой → confidence 80), углы с frequency/примерами, seed-skip,
  колонки 17/9/14/12/5, детерминизм повторного прогона, нигде нет контактов/outreach. MSK +03:00.
- **New docs:** `WF10_TABLE_SCHEMAS.md` (точные колонки/ключи/update strategy/примеры), `FUTURE_CAPABILITIES_BACKLOG.md`
  (DEC-105: Control Kernel, Niche Packs, Market Graph (Sheets-first), Report Builder, Source/Budget Planner, WF10,
  Contact Handoff — у каждого status/purpose/prereqs/risks/first-safe-step), `N8N_WORKFLOW_10_…_RU.md`.
  **Stage 3.4 strategy polished:** компактная таблица решений (9 колонок), Telegram preview ≠ groups/client-session,
  VK API ≠ scraping, reviews/maps подчёркнуты, Instagram deferred, обоснование «Telegram preview — №2».
  Contact policy проверена — соответствует, без правок.
- **Decisions:** DEC-102…105. Docs: STAGE_3_3_TEST_RESULTS/plan/source-decision, WF09 RU, WF10 plan, NICHE_PACK,
  COMPETITOR_AD, LEAD_DISCOVERY, SOCIAL_MATRIX, TABLE_SCHEMA, DECISIONS, NEXT_ACTIONS, COSTS, CAPABILITIES,
  ROADMAP, AGENT_LOG, core/hot/recent. WF04/05/06/07/08 untouched.

**Next operator action:** commit → re-import WF09 v006 → создать 5 вкладок WF10 (заголовки из WF10_TABLE_SCHEMAS) →
импорт WF10 → первый прогон ($0; profiles +2, angles ≥3, signals +1, plan +1, rules +7, agent_requests +1) →
повторный прогон (rules +0) → затем Stage 3.4 шаг 2 (Telegram public feasibility, только после одобрения).

---

## Session: 2026-06-11 (session 2) — WF09 live business relevance filter (DEC-095) + Stage 3.4 architecture pack (DEC-096…101)

**What was done (relevance filter after live false positives; fixture/baseline preserved; docs pack; no external calls):**
- **Live retest #2 diagnosis:** `avito_req_20260611_001222`, actor `fatihtahta~avito-russia-scraper` — **transport
  PASS** (10/10 valid), but both unique rows were **false positives**: `yuridicheskiy_adres_dlya_ooo_ot_sobstvennika` +
  `ne_massovyy_yuridicheskiy_adres_ot_sobstvennika` (legal-address services); the relevant broker row was a duplicate.
- **WF09 patch (`…v005-live-relevance-filter-20260611`, DEC-095):** relevance evidence = **title + description +
  decoded URL slug + category only** (query NEVER qualifies; Cyrillic + translit); strong phrases → competitor;
  weak finance → market_signal; **hard negatives** (юр. адрес/регистрация ООО-ИП/бухгалтерия/эквайринг/POS-терминал/
  касса/печать/штамп/ЭЦП/аренда офиса/коворкинг/юр. услуги/оборудование) без сильного кредитного evidence →
  `hard_skipped` — не пишутся в raw/registry, не расходуют `pipeline_limit` (10); 8-count `result_summary`;
  канонические listing-URL. Fixture-путь не изменён (sim 31 checks PASS).
- **New docs (DEC-096…101):** CONTACT_AND_OUTREACH_POLICY (публичные контакты + evidence; no auto-outreach),
  STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY (one source at a time: Avito → TG public → VK API → reviews/maps →
  Dzen → IG after risk review), WF10 plan (gate: stable live source), NICHE_PACK_SYSTEM_PLAN,
  COMPETITOR_AD_INTELLIGENCE_PLAN.
- **Resolution (session 3):** live retest #3 PASSED → Stage 3.3 closed (DEC-102); `?context=` remnant root-caused
  and fixed in v006 (DEC-103).

---

## Session: 2026-06-11 — Workflow 09 live valid-listing guard after failed live smoke #1 (DEC-093/094)

**What was done (live extraction validation; fixture/baseline preserved):**
- **Live smoke #1 diagnosis:** actor `fatihtahta~avito-russia-scraper` (`avito_req_20260610_234404`) — the live Apify
  call ran but returned 1 empty/search-only item; pre-patch WF09 wrongly registered it as unique. **PARTIAL FAIL /
  NORMALIZATION GUARD FAIL.** Actor `limit` min ≈10.
- **WF09 patch (`…v004-live-valid-guard`):** `actor_limit=10` + `pipeline_limit` split; Apify body limit+startUrls;
  broad field aliases; **strict valid-listing guard** (invalid/over-cap не пишутся, не unique); summary counts
  `actor_items_received/valid_items/invalid_items/unique/duplicates/skipped` + debug preview.
- **Resolution (sessions 2–3):** retest #2 → transport PASS / relevance FAIL → DEC-095 filter; retest #3 → PASS →
  Stage 3.3 closed (DEC-102).
