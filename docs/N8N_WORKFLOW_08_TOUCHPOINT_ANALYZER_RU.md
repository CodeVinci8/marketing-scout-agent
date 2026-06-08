# N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md — Workflow 08 (Touchpoint Analyzer)

**Workflow:** `n8n/workflows/08_touchpoint_analyzer.json`
**Имя:** `08 - Touchpoint Analyzer`
**Статус:** 🔧 BUILT, PATCHED (v3, DETERMINISTIC-FIRST), UNDER RETEST. `active=false`. Stage 3.2 (Business Scout Agent).
**Дата:** 2026-06-08 (v3-патч после второго live-теста — DEC-082)

> **ПАТЧ v3 (DEC-082):** второй live-тест (v2) дал ROUTING PASS, но `primary_json=0`, `repaired_json=2`,
> `deterministic_fallback_after_llm_fail=8`, и **стоимость Claude ≈ $0.159 за 12 записей** при том, что
> детерминированный слой делал всю реальную классификацию (шлюз почти всегда возвращал прозу/thinking).
> Поэтому Workflow 08 теперь **ДЕТЕРМИНИРОВАННО-ПЕРВЫЙ**: `Set Analyzer Config` задаёт
> `analysis_mode='deterministic_first'`, `llm_enrichment=false` (дефолт). Очевидные записи маршрутизируются
> **БЕЗ Claude** (`deterministic_pre_route` / `deterministic_irrelevant_skip`, $0). Claude вызывается только если
> `deterministic_needs_llm=true` или включено обогащение (`llm_enrichment=true`). Для 12-записного фикстура в
> дефолте: **Claude calls=0, repair_used=0, technical_errors=0**.

> **ПАТЧ v2 (DEC-081):** первый live-тест показал, что шлюз часто возвращает **прозу/thinking/signature вместо
> JSON** (иногда вообще без `text`-блока), из-за чего primary+repair падали и классифицируемые записи (включая
> контрольный лид — запись 11) уходили в `technical_errors`. Введён **детерминированный fallback** после провала
> Claude+repair (`parse_method=deterministic_fallback_after_llm_fail`). v3 строит на этом, делая детерминированный
> путь основным, а не запасным.

> **Source-agnostic анализатор точек касания.** Читает approved/unique записи из `raw_market_records`,
> анализирует через Claude (resilient JSON + repair, как Stage 2) и маршрутизирует в 6 существующих
> бизнес-вкладок (35 колонок). **НЕ парсер, НЕ скрейпинг, НЕ Apify/Firecrawl.** Только Claude HTTP.

---

## 1. Назначение

Stage 3.2 превращает нормализованные записи Workflow 07 в проанализированные строки с маршрутизацией. Анализатор
**переиспользует** resilient-паттерн Stage 2 (Workflow 04): primary JSON → repair formatter → technical_errors
fallback; поля `parse_method`, `repair_used`, `repair_status`, `processing_status`, `raw_response_preview`;
валидация `route`.

## 2. Требуемые вкладки

| Вкладка | Колонок | Роль |
|---------|:------:|------|
| `raw_market_records` | 40 | читается (вход) |
| `results` / `review_queue` / `monitor_queue` / `content_queue` / `skipped_log` / `technical_errors` | 35 каждая | пишется (динамически по `route`) |

6 бизнес-вкладок уже существуют (Stage 2). Заголовки **не меняются**. `agent_requests` /
`market_record_registry` / `agent_memory` этим workflow **не пишутся**.

## 3. Структура (20 нод)

1. **Overview Note RU / Test Instructions RU** — sticky.
2. **Manual Start**.
3. **Set Analyzer Config** (code) — `analysis_mode='deterministic_first'`, `llm_enrichment=false`,
   `test_mode=true`, `max_records=12`, `analyze_statuses=[approved,new]`; `production_statuses=[approved]`
   задокументировано (не дефолт); `run_id=touchpoint_YYYYMMDD_HHmmss`. Будущий режим: `analysis_mode='llm_enriched'`
   + `llm_enrichment=true`.
4. **Read raw_market_records** (Google Sheets read).
5. **Filter & Select Records** (code) — `dedup_status=unique` + `approval_status` ∈ allowed; в test_mode
   irrelevant тоже берём (уйдут в `skipped_log`); cap `max_records`; присваивает `batch_index`.
6. **Loop Over Items** (splitInBatches, по 1) — out0 (done) → Final Summary; out1 (loop) → обработка.
7. **Prepare Record** (code) — на итерацию: `parsed_at`, склейка `analyzer_text`, детерминированная
   классификация `det`, флаг `deterministic_needs_llm`, LLM-шлюз `call_claude = (НЕ irrelevant) И
   (llm_enrichment=true ИЛИ deterministic_needs_llm=true)`.
8. **IF Call Claude?** — `call_claude=true` → Claude; `false` → детерминированная строка (БЕЗ Claude, $0).
9. **Build Deterministic Row** (code) → 35-полей строка: irrelevant → `deterministic_irrelevant_skip`/`skipped_log`;
   иначе → `deterministic_pre_route` с маршрутом из `det`.
10. **Build Primary Claude Request** (code) → компактный промпт, `max_tokens=1200`, `temperature=0.2`.
11. **Claude Primary API Request** (httpRequest) → `https://aiprimetech.io/v1/messages`, креденшл
    `Claude API - Marketing Scout`.
12. **Parse Primary JSON** (code) — извлечение/парсинг строгого JSON (balanced-extract, fence-strip).
13. **IF Primary Parse OK?** — true → Normalize + Route; false → repair.
14. **Build Repair Request** (code) → repair-форматтер, `max_tokens=700`, `temperature=0`.
15. **Claude Repair API Request** (httpRequest).
16. **Parse Repaired JSON** (code) — успех → нормальный путь; провал → `technical_errors` fallback.
17. **Normalize + Route** (code) — нормализация полей + маршрутизация; 35 полей.
18. **Append to Dynamic Route Sheet** (Google Sheets append) — `Sheet Name = {{ $json.route }}` → возврат в Loop.
19. **Final Summary Output** (code) — сводка: `route_counts`, `entity_counts`, `repair_used_count`,
    `technical_errors_count`.

## 4. Маппинг точек касания на 35-схему

| Touchpoint класс | entity_type | route |
|------------------|-------------|-------|
| hot_lead / warm_touchpoint | `lead_signal` | `results` (если score≥70 + action=contact + контакт) иначе `review_queue` |
| competitor_activity / competitor_audience | `competitor` | `monitor_queue` |
| client_pain / question_objection / semantic_signal / ad_channel_signal / content_idea | `content_idea` (или `market_signal`) | `content_queue` |
| irrelevant | `irrelevant` | `skipped_log` |

`recommended_action` → route: `contact`→results, `investigate`→review_queue, `monitor`→monitor_queue,
`create_content`/`add_to_semantics`→content_queue, `ignore`→skipped_log. Невалидный route → `technical_errors`.

## 4a. Детерминированная классификация и fallback (v2, DEC-081)

`Prepare Record` считает `det` для каждой записи по подсказкам приёма:
1. `record_type_hint=irrelevant` ИЛИ `touchpoint_type ∈ {irrelevant_source, weak_market_noise}` → `skipped_log`
   (до Claude, `deterministic_irrelevant_skip`, $0).
2. `record_type_hint=competitor_activity` ИЛИ (`competitor_related=true` И `touchpoint_type` содержит
   `competitor`) → `competitor` → `monitor_queue`; `competitor_strength` 70–85 (есть оффер/цена) иначе 55–69;
   `company_name` из `competitor_name`/`profile_name`/домена; `service_type` из `service_hint`.
3. `record_type_hint=market_signal` И `touchpoint_type=source_candidate` → `content_idea` → `content_queue`
   (`content_idea_score` 40–65, `needs_manual_review=true`).
4. `touchpoint_type=review_source` → если `competitor_related=true` → `competitor`/`monitor_queue`; иначе
   `content_idea`/`content_queue`.
5. `record_type_hint=question_objection` ИЛИ `lead_temperature=hot` ИЛИ `lead_intent_hint=high` ИЛИ
   `urgency_hint=high` → `lead_signal`; есть пригодный контакт + прямой запрос → `results`/`contact`
   (`lead_signal_score` 85–95); иначе → `review_queue`/`investigate` (`lead_signal_score` 70–85,
   `needs_manual_review=true`).
6. иначе → `review_queue`/`content_idea`/`investigate` (всё ещё классифицируемо).

**Применение `det`:** (а) решает `is_irrelevant` до Claude; (б) если Claude+repair не дали валидный JSON —
строит строку по `det` (`deterministic_fallback_after_llm_fail`). `technical_errors` — только если у `det` нет
валидного маршрута или сбой Sheets/API.

**parse_method:** `primary_json` | `repaired_json` | `deterministic_irrelevant_skip` |
`deterministic_fallback_after_llm_fail` | `deterministic_pre_route` | `technical_error`.
**repair_status:** `''` | `success` | `failed_fallback` | `failed`.

## 5. Импорт и настройка

1. Импортировать `08_touchpoint_analyzer.json`. **НЕ активировать** (`active=false`).
2. Перепривязать креденшлы (ID локальны):
   - **Claude Primary API Request** + **Claude Repair API Request** → `Claude API - Marketing Scout`.
   - **Read raw_market_records** + **Append to Dynamic Route Sheet** → `Google Sheets - Marketing Scout Service Account`.
3. Заменить `PASTE_SPREADSHEET_ID_HERE` на реальный Spreadsheet ID на 2 Google Sheets нодах.
4. API-ключей в файле нет.

## 6. Тест (12 записей Workflow 07)

1. Записать баланс Claude **ДО**.
2. **Execute Workflow** один раз (test_mode берёт `approved`+`new`, включая 2 irrelevant).
3. Записать баланс **ПОСЛЕ** и результаты → `docs/STAGE_3_2_TEST_RESULTS.md`.

**Ожидаемо (deterministic_first, llm_enrichment=false):**
- **Claude calls = 0** (Primary и Repair НЕ выполняются), cost delta **$0**, `repair_used=false` ×12.
- `deterministic_pre_route = 10`, `deterministic_irrelevant_skip = 2`, `technical_errors = 0`.
- Записи **1–4, 6, 12** (Avito/Dzen competitor, Yandex Maps/Zoon отзывы competitor_related) → **monitor_queue**.
- Записи **5, 7, 8** (VK-поиск, Telegram source_candidate) → **content_queue**.
- Записи **9–10** (irrelevant) → **skipped_log**.
- Запись **11** (форум hot, без контакта) → **review_queue**, `lead_signal`, `investigate`, `lead_signal_score=75`,
  `needs_manual_review=true`.

**Стоимость:** в дефолте Claude не вызывается → $0. В будущем режиме `llm_enriched` — Claude по ~10 не-irrelevant
записям. См. `docs/COSTS_AND_LIMITS.md`.

## 7. Чего НЕ делает
- НЕ скрейпит, НЕ вызывает Apify/Firecrawl, НЕ парсит источники.
- НЕ пишет `agent_requests` / `market_record_registry` / `agent_memory`.
- НЕ меняет заголовки существующих вкладок.
- НЕ Telegram-бот, НЕ расписание, НЕ авто-активация.
