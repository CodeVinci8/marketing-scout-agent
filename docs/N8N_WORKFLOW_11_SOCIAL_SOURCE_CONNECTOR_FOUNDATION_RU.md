# N8N_WORKFLOW_11_SOCIAL_SOURCE_CONNECTOR_FOUNDATION_RU.md — Workflow 11 (Telegram Public Channel Preview, foundation)

**Workflow:** `n8n/workflows/11_social_source_connector_foundation.json`
**Имя:** `11 - Social Source Connector Foundation (Telegram Public Channel Preview)`
**Статус:** ✅ **FIXTURE FOUNDATION PASS (операторские тесты 2026-06-12) + патч v0.1.1 контактов (DEC-114).**
`active=false`, `fixture_mode=true`, `live_mode=false`. Детерминированный, $0, **в воркфлоу нет ни одной
HTTP-ноды** — live-режим НЕ реализован (guard с ошибкой). Live public-preview = план v0.2 (§4), требует
отдельного явного одобрения.
**Дата:** 2026-06-12 · **Решения:** DEC-109 (выбор источника), DEC-110 (foundation, fixture-first),
DEC-114 (contact_channel — категория канала, не формат), DEC-116 (fixture PASS + live v0.2 план),
DEC-096 (один источник за раз), DEC-097/098 (политика контактов).
**Стратегия:** `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md` §5.

> **Результаты операторских fixture-тестов (2026-06-12) — ВСЕ PASS, $0, без внешних вызовов и Claude:**
> - **Тест 1** (`agent_request_id=wf11_req_20260612_033442`): posts_received=6, structurally_valid=6,
>   invalid=0, business_relevant=5, hard_skipped=1, unique=4, duplicates=1, over_pipeline_limit=0 →
>   raw_market_records +5, market_record_registry +4, agent_requests +1. **PASS.**
> - **Тест 2** (повтор, `wf11_req_20260612_033756`): unique=0, duplicates=5, registry +0,
>   duplicate-audit строки в raw. **PASS.**
> - **Тест 3** (live guard, `fixture_mode=false`): корректная остановка на `LIVE Mode Guard` с ошибкой
>   «WF11 live_mode is not implemented…», внешних вызовов нет. **PASS.**
>
> **Патч v0.1.1 (DEC-114), после тестов:** Тест 1 записал `contact_channel=handle` — это формат, а не
> категория канала. Исправлено: Telegram-@handle → `contact_channel=telegram`; в `notes` добавляются
> `contact_format=handle`, `contact_source_url=<post_url>`, `contact_use_policy=manual_review`; строки без
> контакта пишут пустой `contact_channel` (раньше — нестандартное `none`). Fixture-поведение и счётчики не
> изменились (симуляция 24 проверки PASS). Допустимые `contact_channel`: phone, email, telegram, profile,
> form, unknown.

> Первый non-Avito коннектор. Шаблон — проверенный WF09: fixture-first → валидность → business relevance →
> registry dedup → запись ТОЛЬКО в `agent_requests` / `raw_market_records` / `market_record_registry` →
> ручной handoff в WF08. Никаких приватных чатов, групп, MTProto, скрытых контактов, outreach.

---

## 1. Архитектура (17 нод)

```
Manual Start
  → Set Connector Config            (fixture_mode=true, live_mode=false, allowlist каналов, MSK ids)
  → IF fixture_mode?
       ├ true  → Build Fixture Telegram Channel Posts   (6 постов, каналы *_fixture — НЕ реальные)
       └ false → LIVE Mode Guard (not implemented)      (throw: live требует одобрения+транспорта+креденшла)
  → Normalize Telegram Posts        (валидность → strong/weak/hard-negative → контакты дословно → dedup_key)
  → Read market_record_registry
  → Deduplicate Posts               (registry + in-batch; hard-skip ДО raw/registry; pipeline cap)
  → Build raw_market_records Rows (40) → Append raw_market_records
       → Build market_record_registry Rows (15, только unique) → Append market_record_registry
       → Build agent_requests Row (21) → Append agent_requests → Final Summary Output
```

## 2. Ключевые правила

- **Источник:** публичные превью-страницы каналов `https://t.me/s/<channel>` из явного allowlist оператора.
  Только каналы; никаких групп/комментаторов/участников. MTProto/клиентские сессии — запрещённый путь
  (отдельный risk review, не планируется).
- **Контакты (DEC-097/098, DEC-114):** `contact_public` — только дословно видимый в тексте поста @handle или
  телефон. `contact_channel` — **категория канала** (phone/email/telegram/profile/form/unknown), не формат:
  @handle → `contact_channel=telegram`. Формат и политика пишутся в `notes` строки:
  `contact_format=handle|phone`, `contact_source_url=post_url`, `contact_use_policy=manual_review`
  (в 40-колоночной схеме пока нет отдельных колонок). Ничего не реконструируется и не выдумывается.
- **Relevance (словарь v0.1, как в WF09; уйдёт в niche packs DEC-100):** strong-фразы → `competitor_activity`
  (confidence 70, predicted_route monitor_queue); слабые финансовые сигналы ≥2 → `market_signal` (45,
  content_queue); hard-negatives (юр. адрес, регистрация ООО/ИП, бухгалтерия…) без strong-evidence →
  `hard_skipped` — НЕ пишутся в raw/registry.
- **Dedup:** `dedup_key = telegram::social_channel::<canonical post_url>` (query/hash срезаются);
  registry + in-batch; duplicate-audit строки в raw (как WF09).
- **Никакого auto-handoff** в WF08; никаких записей в бизнес-вкладки. MSK `+03:00`; без голого
  `new Date().toISOString()`.

## 3. Импорт и тесты

1. НЕ активировать. Вкладки уже существуют (по WF07/WF09): `agent_requests` (21), `raw_market_records` (40),
   `market_record_registry` (15).
2. Перепривязать креденшл Google Sheets на 4 sheet-нодах (1 read + 3 append); заменить
   `PASTE_SPREADSHEET_ID_HERE` на реальный ID.
3. **Тест 1 (fixture, $0):** Execute once. Ожидаемо: `posts_received=6; structurally_valid_items=6;
   invalid_items=0; business_relevant_items=5; hard_skipped_items=1; unique=4; duplicates=1;
   over_pipeline_limit=0` → `raw_market_records +5` (4 unique + 1 duplicate-audit), `market_record_registry +4`,
   `agent_requests +1` (completed). Контакт только у поста 101 (`@kredit_broker_msk_fixture`, evidence в notes).
4. **Тест 2 (fixture повтор):** unique=0, duplicates=5, registry +0, raw +5 (duplicate audit);
   next_action: НЕ запускать WF08.
5. **Тест 3 (live guard):** `fixture_mode=false` → ошибка на ноде `LIVE Mode Guard (not implemented)` —
   это ожидаемое поведение. Вернуть `fixture_mode=true`.
6. **WF08 handoff (вручную):** использовать `agent_request_id` **ПЕРВОГО** прогона (unique>0), НЕ повторного.
   Проверенная конфигурация:
   `agent_request_id_filter='wf11_req_20260612_033442'`, `platform_filter='telegram'`, `source_type_filter=''`,
   `max_records=10`, `analysis_mode='deterministic_first'`, `llm_enrichment=false`,
   `llm_enrichment_test_mode=false`. Ожидаемо: unique/new competitor-посты → monitor_queue, market_signal →
   content/review_queue, `technical_errors=0`, Claude=0. Очистить фильтры после.

   > ⚠️ **Id повторного прогона даст 0 записей — это не баг.** Повторный (duplicate) прогон WF11 пишет только
   > duplicate-audit строки с `approval_status=duplicate`; дефолт WF08 `analyze_statuses=['approved','new']`
   > их корректно игнорирует (зафиксировано на `wf11_req_20260612_033756`). Анализ duplicate-строк возможен
   > только явным добавлением `duplicate` в `analyze_statuses` — не рекомендуется для нормального handoff.
   > Диагностика нулевой выборки: §"Диагностика" в `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`.

**Симуляция сборки (vm-sandbox, 31 проверка PASS):** счётчики/схемы 40/15/21, политика контактов, дедуп
повторного прогона, live-guard, отсутствие httpRequest-нод, детерминизм.

## 4. Live v0.2 — план Telegram public-channel preview (СПРОЕКТИРОВАН, НЕ реализован; DEC-116)

Live НЕ входит в foundation; внешний транспорт требует **отдельного явного одобрения оператора**.
В конфиге уже есть **placeholder-поля v0.2** (ничего не включают; guard срабатывает независимо от них):
`live_transport='none_not_implemented'`, `live_channel_allowlist=[]`, `live_max_posts_per_channel=10`,
`live_requires_operator_approval=true`.

Жёсткие границы live v0.2:
- **Только allowlist публичных каналов** (явный список оператора) и **только публичные превью-страницы
  `https://t.me/s/<channel>`**. Никаких групп, приватных чатов, MTProto/клиентских сессий, логинов,
  member-данных, скрытых контактов, авто-outreach.
- `max_posts` по умолчанию 10 на канал; `live_mode=false` по умолчанию.
- Контакты — только если дословно видны в тексте публичного поста (политика DEC-097/098/114 без изменений).
- Пайплайн тот же (контракт коннектора): WF11 → agent_requests / raw_market_records / market_record_registry
  → WF08 → WF10 → report.

Порядок включения:
1. Явное одобрение оператора (отдельное, как для WF09 live).
2. Выбор транспорта: Firecrawl fetch страницы `t.me/s/<channel>` (предпочтительно — уже в стеке) или прямой
   HTTP GET; парсер DOM-превью (посты/даты/просмотры) — отдельный patch с фикстурами реальной разметки,
   сначала тестируется в fixture-режиме.
3. Креденшл только в n8n; лимиты: ≤2 канала, ≤10 постов превью на канал; стоимость записывается в
   `COSTS_AND_LIMITS.md` и `agent_requests`.
4. Ограничения превью честно фиксируются: только недавние посты, без комментариев, без авторов аудитории.

## 5. Чего НЕ делает

- НЕ ходит в сеть (нет HTTP-нод); НЕ вызывает Claude/Apify/Firecrawl.
- НЕ читает группы, приватные чаты, участников, комментаторов; НЕ использует MTProto/клиентские сессии.
- НЕ выдумывает контакты; НЕ рекомендует outreach; НЕТ auto-handoff в WF08.
- НЕ пишет business-вкладки/`url_registry`/WF10-вкладки.
