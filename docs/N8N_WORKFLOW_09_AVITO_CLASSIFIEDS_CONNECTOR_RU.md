# N8N_WORKFLOW_09_AVITO_CLASSIFIEDS_CONNECTOR_RU.md — Workflow 09 (Avito/Classifieds Listing Connector)

**Workflow:** `n8n/workflows/09_avito_classifieds_listing_connector.json`
**Имя:** `09 - Avito Classifieds Listing Connector`
**Статус:** 🔧 ПОСТРОЕН; fixture + handoff PASS; **live-smoke #1 (actor `fatihtahta~avito-russia-scraper`) запущен → PARTIAL FAIL (actor вернул пустой/поисковый элемент); добавлена строгая валидация (DEC-094); валидная live-выгрузка ещё не достигнута**. `active=false`. Stage 3.3 (Business Scout Agent).
**Дата:** 2026-06-11 · **Решения:** DEC-094 (валидация live + actor_limit/pipeline_limit) · DEC-093 (actor `fatihtahta~avito-russia-scraper`) · DEC-092 (ad-intel) · DEC-090 (build) · DEC-084 (выбор источника).
**План:** `docs/STAGE_3_3_AVITO_CLASSIFIEDS_CONNECTOR_PLAN.md` · **Тест-лог:** `docs/STAGE_3_3_TEST_RESULTS.md`.

> **ПЕРВЫЙ реальный коннектор-источник после ручного приёма (Workflow 07).** Превращает данные объявлений
> Avito/классифайдов в строки `raw_market_records`, чтобы их затем мог проанализировать Workflow 08
> (Touchpoint Analyzer). **НЕ анализатор, НЕ маршрутизатор, НЕ скрейпер «с нуля».** По умолчанию работает в
> **fixture-режиме без вызова Apify** ($0). Авто-хэндоффа в Workflow 08 нет.

---

## 1. Назначение

Stage 3.3 добавляет первый реальный источник: **Avito / классифайды**. Главная ценность для заказчика —
**Competitor Ad Intelligence / Semantic Intelligence**: офферы конкурентов, цены/условия, рекламные формулировки,
позиционирование, семантика (ключевые слова), боли, на которые они таргетируются, и рекламные каналы. Эти данные
складываются в `raw_market_records`, а Workflow 08 потом маршрутизирует их в бизнес-очереди
(`monitor_queue` / `content_queue` / `review_queue` / `skipped_log`).

Коннектор **не вызывает Claude** и **не пишет в бизнес-вкладки** — это зона ответственности Workflow 08.

## 2. Архитектура (узлы)

```
Manual Start
  → Set Avito Connector Config           (code; fixture_mode=true, MSK id/timestamps)
  → IF fixture_mode?                      (if)
       true  → Build Fixture Avito Listings        (code; 6 примеров, без Apify, $0)
       false → Apify Avito Classifieds Actor Request (httpRequest; ТОЛЬКО live)
  → Normalize Avito Listings              (code; детерминированная нормализация → shape raw_market_records)
  → Read market_record_registry           (googleSheets read)
  → Deduplicate Listings                   (code; по dedup_key + внутри батча)
  → Build raw_market_records Rows          (code; 40 колонок; все строки при write_duplicate_audit=true)
  → Append raw_market_records              (googleSheets append)
       ├→ Build market_record_registry Rows (code; 15 колонок; ТОЛЬКО уникальные)
       │    → Append market_record_registry (googleSheets append)
       └→ Build agent_requests Row          (code; 21 колонка; status=completed)
            → Append agent_requests          (googleSheets append)
              → Final Summary Output         (code)
```

Обе ветки IF сходятся в `Normalize Avito Listings`. При `fixture_mode=true` нода Apify **не выполняется**.

## 3. Конфигурация (`Set Avito Connector Config`)

| Поле | Значение по умолчанию | Назначение |
|------|----------------------|-----------|
| `fixture_mode` | **true** | fixture-режим без Apify ($0) |
| `live_mode` | **false** | разрешение на live-сбор (информативный флаг) |
| `source_type` | `classified` | тип источника |
| `platform` | `avito` | площадка |
| `requested_by` | `operator` | кто запросил |
| `request_type` | `classified_competitor_discovery` | тип запроса |
| `region` | `Москва/МО` | регион |
| `service_focus` | `credit_broker` | продуктовый фокус |
| `search_queries` | 5 запросов (брокер/после отказов/бизнес/ИП) | поисковые запросы |
| `max_items` | **`6`** | в fixture-режиме = **общее число эмитируемых записей** (конкуренты + контрольная нерелевантная) |
| `include_irrelevant_control_fixture` | **`true`** | включать нерелевантную контрольную запись (POS-терминал) для теста `skipped_log` |
| `approval_status_for_unique` | `new` | статус уникальных строк |
| `write_duplicate_audit` | `true` | писать дубликаты в raw (аудит) |
| `duplicate_next_action` | `monitor_duplicate` | next_action для дубликата-конкурента |
| `actor_limit` | **`10`** | отправляется в Apify как `limit` (у actor `fatihtahta~avito-russia-scraper` минимум ~10) |
| `pipeline_limit` | **`3`** | сколько **валидных** нормализованных объявлений WF09 пишет (live-smoke) |
| `live_max_items` | `3` | legacy-алиас `pipeline_limit` (совместимость) |
| `start_urls` | 1 URL поиска «кредитный брокер» (Москва) | `startUrls` для actor (live) |
| `apify_actor_id` | **`fatihtahta~avito-russia-scraper`** | REST-id выбранного actor (формат с `~`, не `/`) |
| `apify_token_placeholder` | `PASTE_APIFY_TOKEN_OR_USE_CREDENTIAL` | плейсхолдер токена |
| `spreadsheet_id_placeholder` | `PASTE_SPREADSHEET_ID` | плейсхолдер ID таблицы |
| `agent_request_id` | `avito_req_YYYYMMDD_HHmmss` | id запроса (МСК) |
| `run_id` | `avito_YYYYMMDD_HHmmss` | id прогона (МСК) |
| `created_at` | `moscowIsoNow()` (+03:00) | время создания |

**MSK-хелперы** (как в Stage 3.2): `moscowIsoNow()` → `YYYY-MM-DDTHH:mm:ss.sss+03:00`; `moscowStamp()` →
`YYYYMMDD_HHmmss`. Голый `new Date().toISOString()` для операционных меток **не используется**.
**ID:** `agent_request_id=avito_req_<stamp>`, `record_id=avito_rec_<stamp>_<index>`, `run_id=avito_<stamp>`.

## 4. Fixture-режим (по умолчанию)

`Build Fixture Avito Listings` отдаёт **6 представительных объявлений** (5 конкурентов + 1 контрольная нерелевантная).
В fixture-режиме **`max_items` = общее число эмитируемых записей**, включая контрольную; при
`include_irrelevant_control_fixture=true` контрольная запись всегда сохраняется (даже при урезании `max_items`):
1. кредитный брокер, цена **от 30 000 ₽** → `service_hint=credit_broker`;
2. брокер, помощь при отказах, **от 500 ₽**, без предоплаты → `service_hint=credit_after_refusals`;
3. кредит для бизнеса/ИП/ООО, оборотные/тендерные/гарантии → `service_hint=business_credit`;
4. кредит после отказов / просрочки / плохая КИ → `service_hint=credit_after_refusals`;
5. ипотечный брокер / рефинансирование / снижение ставки → `service_hint=mortgage_refinance`;
6. продажа POS-терминала (**нерелевантно** → `service_hint=unknown`, демонстрация skip).

Поля fixture: `title, description, url, price, location, seller_name, seller_url, category, published_at, query,
listing_id`. Реального вызова Apify нет ($0). **`max_items=6` по умолчанию — соответствует 6 эмитируемым записям**
(`agent_requests.requested_limit` в fixture-режиме равен фактическому числу выданных записей; `result_summary` не
противоречит `requested_limit`).

> **Важно: fixture ≠ реальный скрейпинг Avito.** Fixture-тесты доказывают только **форму конвейера**
> (Avito-подобное объявление → `raw_market_records` → реестр → Workflow 08 → monitor/skipped), а **не** реальный сбор
> с Avito. Реальный скрейпинг не выполнялся: `fixture_mode=true`, `live_mode=false`, source cost = 0, Apify HTTP-нода
> не запускалась. Статус: **fixture + handoff одобрены; live-скрейпинг не тестировался** (см. §5).

## 5. Live-режим Apify (опционально)

Нода **`Apify Avito Classifieds Actor Request`** выполняется **только** при `fixture_mode=false` (ветка ELSE из IF).
**Live-режим ещё НЕ запускался (live scrape не тестировался)** — выбран первый smoke-actor
**`fatihtahta~avito-russia-scraper`** (человекочитаемый slug `fatihtahta/avito-russia-scraper`; в конфиге — REST-id с
`~`). Описание для будущего прогона:
- `POST https://api.apify.com/v2/acts/{{ $json.apify_actor_id }}/run-sync-get-dataset-items` (actor id из конфигурации
  = `fatihtahta~avito-russia-scraper`);
- **тело JSON (под этот actor):**
  ```
  {
    "limit": {{ $json.actor_limit || 10 }},
    "startUrls": {{ JSON.stringify($json.start_urls) }}
  }
  ```
  Actor ожидает `limit` + `startUrls`. **НЕ отправляем** `queries` / `maxItems` / `region`;
  **`actor_limit` (10) ≠ `pipeline_limit` (3):** `actor_limit` уходит в Apify (минимум actor ~10), а `pipeline_limit`
  ограничивает, сколько **валидных** объявлений WF09 запишет (DEC-094);
- **аутентификация (предпочтительно, настроено):** `authentication=genericCredentialType`,
  `genericAuthType=httpHeaderAuth`. **Оператор привязывает в n8n** HTTP Header Auth креденшл `Apify API - Marketing
  Scout`: **header name = `Authorization`, header value = `Bearer <APIFY_TOKEN>`**. В файле **нет** реального токена/
  ключа/actor id (только плейсхолдеры);
  - *допустимый fallback:* `Send Headers=true`, `Authorization: Bearer {{$env.APIFY_TOKEN}}` (токен из env, не в файле);
  - *альтернатива:* query-параметр `token={{$env.APIFY_TOKEN}}` — но **header-auth предпочтительнее**;
- `onError=continueRegularOutput` — при сбое actor прогон не падает;
- Включать **только** после явного одобрения оператора и выбора actor. Прямой скрейпинг Avito не делаем; ToS
  площадки соблюдаем. **По умолчанию (fixture_mode=true) эта нода не выполняется.**

### Как запустить первый live-smoke (после одобрения; ещё НЕ запускался)
1. Привязать Apify HTTP Header Auth креденшл (`Authorization: Bearer <APIFY_TOKEN>`) на ноде Apify.
2. В `Set Avito Connector Config`: `fixture_mode=false`, `live_mode=true`, `include_irrelevant_control_fixture=false`,
   `write_duplicate_audit=true`. Лимит — `live_max_items=3` (используется как `limit`). `apify_actor_id` уже
   `fatihtahta~avito-russia-scraper`; `start_urls` уже задан (поиск «кредитный брокер», Москва).
3. Execute once. Записать стоимость Apify-actor (source cost). 0 Firecrawl/Claude.
4. **Ожидаемо:** `agent_requests +1`; `raw_market_records` 0–3 строки (зависит от ответа actor); реестр — уникальные
   новые объявления. **Если actor вернул 0 объектов — это проблема источника/входа (actor/startUrls), а НЕ сбой
   конвейера** (конвейер на fixture уже доказан).
5. После live-smoke — запустить Workflow 08 с `agent_request_id_filter=<id этого live-прогона>` (см. §9).

### Валидация листинга и счётчики (DEC-094 — после неудачной live-попытки #1)
Live-actor может вернуть пустые/поисковые элементы (так и произошло в попытке #1: 1 элемент с пустыми url/title/price и
только поисковым URL — pre-patch ошибочно зарегистрировал его как unique). Теперь действует **строгая проверка**:
объявление **валидно**, только если `listing_url` непустой, это `avito.ru`-URL, **не** равен `start_url`, **не** поисковый/
категорийный URL (нет `?q=`, есть id листинга `_<6+ цифр>` или `/<7+ цифр>`), **и** есть хотя бы одно из title/description/
price. **Невалидные элементы** (и валидные сверх `pipeline_limit` в live-режиме) **не пишутся** ни в
`raw_market_records`, ни в `market_record_registry`, **не** считаются unique, **не** записываются как `competitor_activity`
(`dedup_status=invalid` / `over_pipeline_limit`). Fixture-объявления проверку проходят — поведение fixture не меняется.

`Final Summary` и `agent_requests.result_summary` теперь содержат: `actor_items_received`, `valid_items`,
`invalid_items`, `unique`, `duplicates`, `skipped`. При наличии невалидных элементов в `notes` добавляется отладочная
строка: «Live Apify returned item(s), but no valid listing_url/title/price fields were found. Inspect Apify node output
and actor schema.» + `raw_response_preview` (≤300 символов; полный JSON в Sheets не пишем).

> **Если `valid_items=0` — НЕ запускайте Workflow 08 handoff.** Это означает, что actor не отдал валидных листингов:
> проверьте JSON-выход ноды Apify и схему actor; если actor продолжает возвращать пустые/поисковые элементы — оцените
> альтернативный Avito-actor. Пример провальной попытки: `actor_items_received=1; valid_items=0; invalid_items=1;
> unique=0; duplicates=0; skipped=0` — это **корректное** поведение (ничего не записано, реестр не засорён).

### Маппинг полей actor `fatihtahta~avito-russia-scraper` (Task D)
`Normalize Avito Listings` принимает поля и из fixture, и из ответа actor (псевдонимы, без выдумывания
отсутствующего):
- `source_url=post_url` = `url || sourceUrl`; `published_at` = `validFrom || ''`;
- `title` = `title || ''`; цена = `priceText || price || ''` (если есть `currency` — не комбинируем принудительно);
- `location` = `location || региона из конфигурации`; `seller_name` = `sellerName || seller || ''`;
- `description` = `description || ''` — **если описания нет, используем только title + цена/локацию, описание не
  выдумываем** (сегмент описания в `text_context` опускается);
- `query` = `parentSourceUrl || первый start_url || склейка search_queries`;
- `listing_id` = `listing_id || числовой id из хвоста URL` (для стабильного дедупа `avito_listing_<id>`).
Поля `currency` / `image` не имеют колонок в схеме и игнорируются.

## 6. Нормализация (Competitor Ad / Semantic Intelligence)

Детерминированно, без LLM. На каждое объявление:
- `source_type='classified'`, `platform='avito'`, `source_url=post_url=`нормализованный URL объявления,
  `profile_url=`URL продавца, `profile_name=seller_name`;
- классификация **по title+description+category** (НЕ по поисковому запросу, чтобы запрос не «загрязнял» тип):
  - сервисное брокерское объявление → `record_type_hint=competitor_activity`, `touchpoint_type=competitor_listing`,
    `competitor_related=true`, `competitor_name=seller_name`, прогноз маршрута `monitor_queue` / `competitor`;
  - более широкое финансовое объявление → `market_signal` / `classified_offer` → `content_queue` / `content_idea`;
  - явно нерелевантное (продажа оборудования и т.п.) → `irrelevant` / `irrelevant_source` → `skipped_log`;
- `service_hint` (DEC-092, по title+description+category, **не** по поисковому запросу):
  - `business_credit` — только при явном ИП/ООО/«для бизнеса»/оборотные/тендерные/банковские гарантии (не просто слово «бизнесу»);
  - `mortgage_refinance` — ипотека/рефинансирование/снижение ставки;
  - `credit_after_refusals` — после отказов / просрочки / плохая кредитная история;
  - `credit_broker` — общий брокер;
  - `unknown` — нерелевантное;
- `semantic_keywords` (DEC-092): конкретные рекламные/семантические фразы из title/description/query
  (помощь в получении кредита, после отказов, без предоплаты, оплата за результат, работа по договору, ИП, ООО,
  оборотные кредиты, тендерные займы, банковские гарантии, рефинансирование, снижение ставки, …), без дублей,
  через запятую; для нерелевантного — пусто;
- `ad_channel_hint='classifieds'`;
- `interest_topic=query`, `probable_need` — выведенная потребность (после отказов / бизнес / ипотека / помощь);
- `lead_intent_hint='low'`, `urgency_hint='low'` (если нет явной срочности); `lead_temperature`: конкурент=`cold`,
  нерелевантное=`none`;
- `contact_public` / `contact_channel` — **пусто, если явно не указано** (телефон/почту НЕ выдумываем);
- `confidence_score` 60–85 для конкурентов/сигналов (с ценой 82, без цены 74, market_signal 65), ниже для
  нерелевантного (40);
- `manager_note`: «Семантика/оффер конкурента: <оффер> | ключевые слова: … | площадка: Avito (classifieds)».

## 7. Дедупликация

- `dedup_key` стабилен и включает platform/source_type:
  - есть `listing_id` → `avito::classified::avito_listing_<listing_id>`;
  - иначе → `avito::classified::avito_url_<hash(normalized_url)>`.
- `text_hash` = hash(нормализованные title + description + price).
- `Read market_record_registry` → `Deduplicate Listings`:
  - если `dedup_key` уже в реестре → `dedup_status=duplicate_in_registry`, `approval_status=duplicate`,
    `next_action=monitor_duplicate` (для конкурента) или `ignore` (для нерелевантного); **в реестр НЕ пишем**;
  - дубликат внутри батча → `duplicate_in_batch`, `approval_status=duplicate`;
  - уникальное → `dedup_status=unique`, `approval_status=` `approval_status_for_unique` (по умолчанию `new`);
    **пишем в реестр**.

## 8. Выходные вкладки

Workflow 09 пишет **только**:
- `agent_requests` (21 колонка) — один запрос, `status=completed`, `source_scope=classified_listings`,
  `platforms=avito`, `query=` склейка `search_queries`, `result_summary=total/unique/duplicates/skipped`,
  `next_action='Run Workflow 08 on collected raw records manually'`, `notes` — нет авто-хэндоффа в v0.1.
- `raw_market_records` (40 колонок) — все строки (аудит) при `write_duplicate_audit=true`.
- `market_record_registry` (15 колонок) — **только уникальные** строки. `last_route` = прогноз
  (`monitor_queue`/`content_queue`/`review_queue`/`skipped_log`), `last_processing_status='raw_collected'`,
  `last_entity_type` = `competitor`/`content_idea`/`irrelevant`, `author_handle` = `seller_name`,
  `note='avito_classifieds_connector_stage_3_3'`.

**НЕ пишет** в `results` / `review_queue` / `monitor_queue` / `content_queue` / `skipped_log` /
`technical_errors` — это делает Workflow 08.

## 9. Ручной хэндофф в Workflow 08 (без авто-запуска)

1. Запустить Workflow 09 (fixture или live) → собрать строки в `raw_market_records`.
2. Открыть `raw_market_records`, проверить собранные строки (offer/семантика/competitor_name/предсказанный маршрут).
3. При необходимости запустить **Workflow 08 вручную** (Touchpoint Analyzer) — он маршрутизирует записи в
   бизнес-очереди. Workflow 09 **не** запускает Workflow 08 автоматически.

## 10. Импорт и настройка

1. Импортировать `09_avito_classifieds_listing_connector.json`. **НЕ активировать** (`active=false`).
2. Перепривязать креденшл Google Sheets на 4 нодах (Read market_record_registry, Append raw_market_records,
   Append market_record_registry, Append agent_requests) → `Google Sheets - Marketing Scout Service Account`.
3. Заменить `PASTE_SPREADSHEET_ID_HERE` на реальный Spreadsheet ID на всех Google Sheets нодах.
4. Для live: задать `apify_actor_id`, привязать Apify-креденшл, `fixture_mode=false`, `live_mode=true`.
   Для fixture-теста Apify не нужен.

## 11. Тест-план

- **Тест 1 (fixture, пустой реестр):** `fixture_mode=true`, Execute once. Ожидаемо: raw +6; реестр +6 уникальных;
  1 `agent_requests` (status=completed); прогноз маршрутов: `monitor_queue=5`, `skipped_log=1`; `skipped_count=1`.
- **Тест 2 (fixture, повтор):** Execute снова. Ожидаемо: все 6 `duplicate_in_registry`, `approval_status=duplicate`;
  raw +6 (аудит); реестр +0; `next_action` конкурента = `monitor_duplicate`, нерелевантного = `ignore`.
- **Тест 3 (live Apify smoke, ещё НЕ запускался):** actor `fatihtahta~avito-russia-scraper`, `fixture_mode=false`,
  `live_mode=true`, `live_max_items=3`, `include_irrelevant_control_fixture=false`, привязан Apify header-auth
  креденшл. Записать стоимость Apify-actor. 0 Firecrawl/Claude. Ожидаемо: `agent_requests +1`, `raw_market_records`
  0–3, реестр — уникальные новые. 0 объектов = проблема источника/actor, не сбой конвейера. Шаги — §5.
- **Тест 4 (хэндофф):** запустить Workflow 08 вручную на собранных строках; проверить маршрутизацию в очереди.

Детали и таблицы — `docs/STAGE_3_3_TEST_RESULTS.md`.

## 12. Риски

- **Anti-bot / rate limits / ToS Avito** — поэтому используем Apify-actor (не прямой скрейпинг) и только при
  явном одобрении; live по умолчанию выключен.
- **Дубликаты/перевыкладки** — закрываются дедупом по `listing_id`/URL-hash.
- **Скрытые контакты** — `contact_public` заполняется только если контакт явно присутствует; не выдумываем.
- **Стоимость live** — зависит от actor; fixture = $0.
- **Качество классификации** — детерминированное по ключевым словам; тонкую семантику добавляет Workflow 08
  (опциональный LLM enrichment), не этот коннектор.

## 13. Чего НЕ делает

- НЕ пишет бизнес-вкладки, НЕ вызывает Claude, НЕ авто-запускает Workflow 08.
- НЕ Telegram/Instagram/VK/Dzen парсер, НЕ Telegram-бот, НЕ расписание.
- По умолчанию НЕ вызывает Apify (fixture_mode=true), НЕ Firecrawl. `active=false`.
