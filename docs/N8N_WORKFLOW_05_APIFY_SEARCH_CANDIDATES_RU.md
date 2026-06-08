# Workflow 05 — Apify Search Candidate Discovery (RU гайд)

**Файл:** `n8n/workflows/05_apify_search_candidate_discovery.json`
**Статус:** ✅ ОДОБРЕН (Stage 2) — коннектор веб-поиска кандидатов (active=false) — 2026-06-08. Test 1 PASS: запрос «автоломбард Москва займ под ПТС без проверки кредитной истории» → 9 кандидатов; классификация (`direct_competitor`/`aggregator`/`directory`/`media_article`); извлечение домена; дедуп через `url_registry`; 0 Firecrawl/0 Claude. `url_candidates`=26 полей, `discovery_requests`=18 полей. Быстрый ревью в этом проходе — багов нет, без изменений. См. `docs/STAGE_2_FINAL_TEST_RESULTS.md`.

> **Время (DEC-083):** генерируемые метки (`created_at`/`now`, `generated_at`) и stamp в `discovery_request_id`/`candidate_id` теперь в московском времени **+03:00** через `moscowIsoNow()`/`moscowStamp()`. Источниковый `published_at` не меняется; старые UTC-`Z` строки не переписываются.
**Связано:** `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`, `docs/URL_DISCOVERY_STRATEGY.md`, `docs/TABLE_SCHEMA.md`, `docs/STAGE_2_FINAL_TEST_RESULTS.md`, DEC-059/060/061/074

## 0. Итог первого реального теста (запрос «займ под залог ПТС Москва»)

Технически прошёл: 10 кандидатов записаны, 1 дубликат по `url_registry` (`https://cashmotor.ru/`),
строка `discovery_requests` создана (`candidate_count=10`, `unique=9`, `duplicate=1`, `status=needs_review`,
`estimated_firecrawl_credits=9`, `estimated_claude_cost_usd=0.18`).

Найдены проблемы и исправлены патчем (DEC-061):
1. **`domain` был пустым** у всех кандидатов → исправлено надёжное извлечение хоста (без `www.`).
2. **`confidence_score` завышен** для агрегаторов/каталогов/СМИ → переработана формула.
3. Добавлена колонка **`candidate_type`** (схема `url_candidates`: 25 → **26 колонок**).

После патча на тех же данных: прямые конкуренты (autolombard-moskva.ru, carcapital.ru, zalog24h.ru,
autolombardn1.ru) → `direct_competitor`, confidence ~100; cashmotor.ru → `direct_competitor`, но `duplicate`;
2gis.ru → `directory`; finuslugi.ru/vbr.ru/banki.ru → `aggregator`; kp.ru → `media_article` — все с заметно
более низким confidence.

---

## 1. Назначение

Workflow 05 — это **URL Supplier** (поставщик кандидатов), а не анализатор. По одному поисковому
запросу он:
1. вызывает **Apify Google Search Results Scraper**,
2. извлекает органические URL-кандидаты (url, title, snippet, rank),
3. нормализует URL (теми же правилами, что Workflow 04 → ключ совпадает с `url_registry`),
4. читает `url_registry` и классифицирует дубликаты,
5. детерминированно (без LLM) считает `confidence_score`, `region_hint`, `service_hint`,
6. пишет до 10 строк в `url_candidates`,
7. пишет одну строку в `discovery_requests` (`status=needs_review` или `error`).

Дальше — **ручное одобрение** оператором, и только потом ≤5 URL передаются в Workflow 04.

## 2. Почему НЕ вызывает Firecrawl / Claude

Discovery (поиск кандидатов) и analysis (разбор страниц) — **разные слои** с разной стоимостью и
разными типами сбоев. Workflow 05 только **находит и классифицирует** кандидатов; он **не тратит**
Firecrawl-кредиты и Claude-токены. Деньги тратятся только после того, как человек поставит
`approval_status=approved` и передаст URL в Workflow 04 (URL Consumer). Единственная стоимость
Workflow 05 — вызов Apify-поиска.

## 3. Требуемые вкладки Google Sheets

| Вкладка | Колонок | Роль |
|---------|---------|------|
| `discovery_requests` | 18 | одна строка на запрос (Workflow 05 пишет) |
| `url_candidates` | **26** | кандидаты с гейтом одобрения (Workflow 05 пишет) — +`candidate_type` (DEC-061) |
| `url_registry` | 10 | источник правды дедупа (Workflow 05 только читает) |

### `candidate_type` (DEC-061)

Детерминированная классификация (без LLM) типа источника:

- `direct_competitor` — кредитор / автоломбард / МФО / брокер, выдаёт займы напрямую (приоритет на одобрение).
- `aggregator` — агрегаторы/сравнения (banki.ru, vbr.ru, finuslugi.ru).
- `directory` — карты/каталоги/отзывы (2gis).
- `media_article` — статьи/подборки/рейтинги (kp.ru).
- `marketplace` — маркетплейсы/доски объявлений.
- `social` — соцсети/каналы/профили.
- `unknown` — запасной вариант.

**Прямых конкурентов одобрять в первую очередь.** Агрегаторы/каталоги/СМИ полезны как источник интеллекта
(можно вытащить новых конкурентов вручную), но **не являются прямыми конкурентами** — у них пометка в `notes`:
«Review manually; not a direct competitor». Авто-отклонения нет.

Бизнес-вкладки (`results`, `review_queue`, `monitor_queue`, `content_queue`, `skipped_log`,
`technical_errors`) Workflow 05 **не трогает**. Точные заголовки — в `docs/TABLE_SCHEMA.md`.

## 4. Требуемые креденшлы

1. **`Apify API - Marketing Scout`** — тип **Header Auth**, Header Name `Authorization`,
   Value `Bearer <APIFY_API_TOKEN>`, разрешённый домен `api.apify.com`.
   *Токен вводится ТОЛЬКО в n8n, не в файлы репозитория.*
2. **`Google Sheets - Marketing Scout Service Account`** — для `discovery_requests`,
   `url_candidates` и чтения `url_registry`.

Firecrawl-креденшл НЕ нужен. Claude-креденшл НЕ нужен.

## 5. Импорт

1. Импортировать `n8n/workflows/05_apify_search_candidate_discovery.json`.
2. **НЕ активировать** (active остаётся false). Триггер только ручной.

## 6. Перепривязка креденшлов (ПОСЛЕ КАЖДОГО ИМПОРТА)

n8n не сохраняет привязку из JSON (ID локальны). Перепривязать вручную:

- [ ] `Apify Search API Request` → `Apify API - Marketing Scout`
- [ ] `Read url_registry` → `Google Sheets - Marketing Scout Service Account`
- [ ] `Append url_candidates` → то же
- [ ] `Append discovery_requests` → то же
- [ ] На **3 нодах Google Sheets** вставить реальный **Spreadsheet ID** (заменить `PASTE_SPREADSHEET_ID_HERE`).

## 7. Как изменить запрос

Открыть ноду **`Set Discovery Request`** → отредактировать `query` и `request_text`.
По умолчанию (v0.1):
- `request_text` = «найти конкурентов по займам под ПТС в Москве»
- `query` = «займ под залог ПТС Москва»
- `region` = «Москва», `service_focus` = `pts_loan`, `requested_limit` = 10

Один запрос за прогон (v0.1). Примеры запросов: «кредит под залог авто Москва», «автоломбард ПТС Москва»,
«займ под залог недвижимости Москва», «рефинансирование под залог Москва».

## 8. Первый тест

1. Создать вкладки `discovery_requests` (18) и `url_candidates` (25). Убедиться, что `url_registry` (10) есть.
2. Создать креденшл Apify (п. 4) и перепривязать (п. 6).
3. Тестовый запрос: **«займ под залог ПТС Москва»**.
4. **Execute Workflow** один раз.

**Ожидаемый результат:**
- `discovery_requests`: **одна** строка, `status=needs_review`, заполнены `candidate_count`,
  `unique_candidate_count`, `duplicate_count`, оценки.
- `url_candidates`: **до 10** строк; уникальные → `approval_status=new`, дубли (по реестру или в батче) →
  `approval_status=duplicate`.
- Записей в `monitor_queue` / `results` / другие бизнес-вкладки **нет**.
- **0 Firecrawl, 0 Claude.**

## 9. Troubleshooting

| Симптом | Действие |
|---------|----------|
| Apify **401/403** | Проверить креденшл `Apify API - Marketing Scout`: Header `Authorization: Bearer <token>`, домен `api.apify.com`. |
| Актор **таймаут** | Запрос минимальный (1 страница, 10 результатов). Повторить позже; при необходимости увеличить timeout ноды `Apify Search API Request`. |
| **Пустой результат** | `discovery_requests.status=error`, `candidate_count=0`, в `notes` — превью ошибки; `url_candidates` не пишется. Проверить запрос/регион. |
| **Другая форма ответа** | `Normalize Apify Results` устойчиво разбирает `organicResults` / `results` / item-как-результат. Если поля иные — поправить маппинг в этой ноде по актуальной схеме актора. |
| **Google Sheets mapping** | Маппинг = Automatically. Заголовки вкладок должны точно совпадать со схемой (18 / 25 колонок). |
| **Registry lookup** | `Read url_registry` читает всю вкладку (`alwaysOutputData`). При пустом реестре всё считается `not_in_registry` — это нормально. Дедуп — «лучшая попытка». |

## 10. Логирование стоимости

На каждый прогон записывать в `docs/COSTS_AND_LIMITS.md`: `discovery_request_id`, запрос, число кандидатов,
**стоимость прогона Apify**, число уникальных/дублей. Firecrawl/Claude не тратятся (только оценки в строках).

## 11. Процесс одобрения (после появления кандидатов)

1. Открыть `url_candidates`, отфильтровать по `discovery_request_id`.
2. Просмотреть `confidence_score`, `title`, `snippet`, `service_hint`, `region_hint`.
3. Для подходящих поставить `approval_status=approved`, заполнить `approved_by` и `approved_at`;
   неподходящие → `rejected` + `rejection_reason`.
4. Передать **≤5** одобренных URL в `Set URL List` Workflow 04 (если одобрено 10 — двумя батчами по 5).
5. Никакой автоматической обработки: **ни один кандидат не уходит в Firecrawl/Claude без `approved`.**

> Telegram-бот (позже) станет интерфейсом над `discovery_requests` + `url_candidates` + Workflow 04 и
> **не будет дублировать** логику поиска/анализа. Лид-коннекторы (Avito/соцсети/классифайды) — будущее,
> отдельные source-коннекторы поверх тех же анализаторов.
