# Workflow 05 — Apify Search Candidate Discovery (RU гайд)

**Файл:** `n8n/workflows/05_apify_search_candidate_discovery.json`
**Статус:** 🔧 BUILT, под тестом (active=false) — 2026-06-08
**Связано:** `docs/WORKFLOW_05_URL_DISCOVERY_PLAN.md`, `docs/URL_DISCOVERY_STRATEGY.md`, `docs/TABLE_SCHEMA.md`, DEC-059/060

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
| `url_candidates` | 25 | кандидаты с гейтом одобрения (Workflow 05 пишет) |
| `url_registry` | 10 | источник правды дедупа (Workflow 05 только читает) |

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
