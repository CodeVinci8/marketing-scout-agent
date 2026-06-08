# N8N_WORKFLOW_07_MANUAL_TOUCHPOINT_INTAKE_RU.md — Workflow 07 (Ручной приём точек касания)

**Workflow:** `n8n/workflows/07_manual_touchpoint_intake.json`
**Имя:** `07 - Manual Touchpoint Intake`
**Статус:** ✅ PASS (Stage 3.1). `active=false`. Stage 3.1 (Business Scout Agent).
**Дата:** 2026-06-08

> **Тест Stage 3.1 — PASS:** 1-й прогон — 12 уникальных → `raw_market_records` + 12 строк реестра; 2-й прогон — 12 `duplicate_in_registry`, реестр +0 (идемпотентный дедуп подтверждён).

> **Время (DEC-083):** генерируемые метки (`created_at`, `parsed_at`, `first_seen_at`, `last_seen_at`) и stamp в `agent_request_id`/`record_id` теперь в московском времени **+03:00** через `moscowIsoNow()`/`moscowStamp()`. Источниковый `published_at` не меняется; старые UTC-`Z` строки не переписываются.

> Это **НЕ парсер и НЕ анализатор**. Workflow только **детерминированно нормализует** вручную собранные примеры
> в `raw_market_records` и `market_record_registry`. **Никаких внешних вызовов, никакого LLM, никакого скрейпинга.**

---

## 1. Назначение

Первый безопасный шаг Stage 3 (Social/Classified Touchpoint Discovery). Оператор вручную собрал смешанные
примеры точек касания (Avito-объявления, посты/комментарии Дзен, выдача/группы VK, публичные Telegram-каналы,
страницы/отзывы конкурентов, форумы/отзывы, нерелевантные и синтетические контрольные лиды). Workflow приводит их
к общей модели данных и валидирует схему + дедуп **до** постройки реальных коннекторов и анализатора.

## 2. Требуемые вкладки Google Sheets (уже созданы оператором)

| Вкладка | Колонок | Роль в Workflow 07 |
|---------|:------:|--------------------|
| `agent_requests` | 21 | пишется (1 строка запроса) |
| `raw_market_records` | 40 | пишется (все 12 записей — аудит-след) |
| `market_record_registry` | 15 | читается + пишется (только уникальные) |
| `agent_memory` | 13 | **не используется** в этом workflow |

Stage 2 вкладки (`results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`,
`technical_errors`, `url_registry`, `url_candidates`, `discovery_requests`) **не трогаются**.

### Заголовки (строка 1, ровно как ниже)

**agent_requests (21):** `agent_request_id, created_at, requested_by, request_text, request_type, source_scope,
platforms, query, region, service_focus, requested_limit, status, plan_summary, estimated_source_cost_usd,
estimated_analysis_cost_usd, approval_required, approved_by, approved_at, result_summary, next_action, notes`

**raw_market_records (40):** `record_id, agent_request_id, created_at, source_type, platform, source_url,
post_url, profile_url, profile_name, author_handle, published_at, region_hint, service_hint, query, text_context,
comment_text, contact_public, contact_channel, dedup_key, record_type_hint, touchpoint_type, lead_intent_hint,
urgency_hint, interest_topic, probable_need, competitor_related, competitor_name, semantic_keywords,
ad_channel_hint, confidence_score, lead_temperature, next_action, responsible, dedup_status, approval_status,
approved_by, approved_at, estimated_analysis_cost_usd, manager_note, notes`

**market_record_registry (15):** `dedup_key, source_type, platform, source_url, post_url, profile_url,
author_handle, text_hash, first_seen_at, last_seen_at, last_route, last_processing_status, last_entity_type,
agent_request_id, note`

**agent_memory (13, не используется):** `memory_id, created_at, updated_at, memory_type, entity_type, entity_key,
title, content, source, confidence, status, last_used_at, notes`

## 3. Структура (14 нод)

1. **Overview Note RU** / **Setup and Test Note RU** — sticky notes.
2. **Manual Start** — ручной триггер.
3. **Set Manual Intake Request** (code) — один запрос: `request_type=manual_intake`,
   `agent_request_id=agentreq_YYYYMMDD_HHmmss`, регион Москва, лимит 12.
4. **Read market_record_registry** (Google Sheets read) — читает реестр для дедупа (1 раз; `alwaysOutputData`).
5. **Set Manual Records** (code) — фиксированный массив из 12 записей.
6. **Normalize Manual Records** (code) — детерминированная нормализация: `record_id`, `dedup_key`, `text_hash`,
   `region_hint`, `urgency_hint`, `lead_intent_hint`, `confidence_score`, `lead_temperature`, `next_action`,
   `approval_status=new`, `dedup_status=pending`, `estimated_analysis_cost_usd` (0.02 / 0 для irrelevant).
7. **Dedup Against Registry** (code) — по `dedup_key`: в реестре → `duplicate_in_registry`; в батче →
   `duplicate_in_batch`; иначе `unique`.
8. **Append raw_market_records** (Google Sheets append, autoMap) — **все 12** строк (включая дубликаты и
   нерелевантные) как аудит-след.
9. **Build Registry Rows** (code) — строки реестра **только для уникальных** (recompute `text_hash`).
10. **Append market_record_registry** (Google Sheets append) — только уникальные.
11. **Build agent_requests Row** (code) — одна строка, `status=needs_review`,
    `estimated_analysis_cost_usd` = сумма по записям.
12. **Append agent_requests** (Google Sheets append) — одна строка.
13. **Final Summary Output** (code) — сводка прогона.

### Поток
`Manual Start → Set Manual Intake Request → Read market_record_registry → Set Manual Records →
Normalize Manual Records → Dedup Against Registry → Append raw_market_records → {Build Registry Rows →
Append market_record_registry} и {Build agent_requests Row → Append agent_requests → Final Summary Output}`

### Логика `dedup_key`
- есть `post_url` → `platform::post::<норм. post_url>`;
- иначе есть `source_url` → `platform::source::<норм. source_url>`;
- иначе `profile_url`+`text_hash` → `platform::profile_text::<profile_url>::<text_hash>`;
- иначе → `platform::text::<text_hash>`.
- **Никогда не по домену.**

## 4. Импорт и настройка

1. Импортировать `07_manual_touchpoint_intake.json` в n8n. **НЕ активировать** (`active=false`).
2. На **4 Google Sheets нодах** (Read market_record_registry, Append raw_market_records,
   Append market_record_registry, Append agent_requests):
   - привязать креденшл **Google Sheets - Marketing Scout Service Account**;
   - заменить `PASTE_SPREADSHEET_ID_HERE` на реальный Spreadsheet ID (ID креденшла локальны — выбрать вручную).
3. Внешних API-ключей здесь нет (нет Apify/Firecrawl/Claude).

## 5. Ожидания теста

**Первый прогон (пустой реестр):**
- `raw_market_records`: **+12** строк (аудит-след).
- `market_record_registry`: **+12** (все уникальны при пустом реестре).
- `agent_requests`: **+1** (`status=needs_review`).
- `Final Summary Output`: `total_records=12`, `unique_count≈12`, `duplicate_count=0`, `irrelevant_count=2`
  (записи 9 и 10), плюс `platform_counts` и `record_type_counts`.
- Ожидаемые `record_type_hint`: 4× `competitor_activity` (1–4), 5× `market_signal` (5–8, 12),
  1× `question_objection` (11), 2× `irrelevant` (9–10).
- Контрольный «горячий» паттерн: запись 11 (форум, «отказали в 3 банках, просрочки, нужен кредит») →
  `urgency_hint=high`, `lead_intent_hint=high`, `lead_temperature=hot`.

**Повторный прогон (реестр заполнен):**
- те же 12 → все `dedup_status=duplicate_in_registry`, `approval_status=duplicate`;
- `raw_market_records` снова **+12** (намеренно, аудит); `market_record_registry` **+0**.

**Стоимость:** 0 (нет внешних вызовов, нет LLM). `estimated_analysis_cost_usd` — только план для будущего
анализатора.

## 6. Чего workflow НЕ делает
- НЕ скрейпит, НЕ вызывает Apify/Firecrawl/Claude, НЕ внешние API, НЕ пишет `agent_memory`.
- НЕ анализирует через LLM (это **Stage 3.2 — Touchpoint Analyzer**).
- НЕ Telegram-бот, НЕ парсер источника, НЕ расписание, НЕ авто-активация.
