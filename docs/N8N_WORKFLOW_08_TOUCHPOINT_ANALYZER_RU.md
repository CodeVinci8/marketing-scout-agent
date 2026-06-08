# N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md — Workflow 08 (Touchpoint Analyzer)

**Workflow:** `n8n/workflows/08_touchpoint_analyzer.json`
**Имя:** `08 - Touchpoint Analyzer`
**Статус:** 🔧 BUILT, UNDER TEST. `active=false`. Stage 3.2 (Business Scout Agent).
**Дата:** 2026-06-08

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
3. **Set Analyzer Config** (code) — `test_mode=true`, `max_records=12`, `analyze_statuses=[approved,new]`;
   `production_statuses=[approved]` задокументировано (не дефолт); `run_id=touchpoint_YYYYMMDD_HHmmss`.
4. **Read raw_market_records** (Google Sheets read).
5. **Filter & Select Records** (code) — `dedup_status=unique` + `approval_status` ∈ allowed; в test_mode
   irrelevant тоже берём (уйдут в `skipped_log`); cap `max_records`; присваивает `batch_index`.
6. **Loop Over Items** (splitInBatches, по 1) — out0 (done) → Final Summary; out1 (loop) → обработка.
7. **Prepare Record** (code) — на итерацию: `parsed_at`, склейка `analyzer_text` (text_context + комментарий +
   тема + вероятная потребность).
8. **IF Irrelevant?** — `is_irrelevant=true` → детерминированный skip (БЕЗ Claude, $0); иначе → Claude.
9. **Build Skip Row (Irrelevant)** (code) → 35-полей `skipped_log`.
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

**Ожидаемая маршрутизация ключевых записей:**
- Запись **1** (Avito competitor_listing) → `entity_type=competitor` → **monitor_queue**.
- Записи **9–10** (irrelevant) → **skipped_log** (детерминированно, БЕЗ Claude, **$0**).
- Запись **11** (форум: «отказали в 3 банках, просрочки, нужен кредит 700 тыс.») → паттерн lead_signal, но
  без прямого контакта → **review_queue** (`recommended_action=investigate`, НЕ авто-`contact`).
- Источники (Dzen/VK/Telegram каналы, VK-поиск) → `investigate`/`add_to_semantics` → **review_queue/content_queue**.
- Отзывы (Yandex Maps, Zoon) → `content_idea` → **content_queue**.

**Стоимость:** только Claude по ~10 не-irrelevant записям (irrelevant = $0). См. `docs/COSTS_AND_LIMITS.md`.

## 7. Чего НЕ делает
- НЕ скрейпит, НЕ вызывает Apify/Firecrawl, НЕ парсит источники.
- НЕ пишет `agent_requests` / `market_record_registry` / `agent_memory`.
- НЕ меняет заголовки существующих вкладок.
- НЕ Telegram-бот, НЕ расписание, НЕ авто-активация.
