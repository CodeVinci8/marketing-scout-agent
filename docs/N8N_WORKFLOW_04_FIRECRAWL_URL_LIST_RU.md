# N8N_WORKFLOW_04_FIRECRAWL_URL_LIST_RU.md — Workflow 04: Firecrawl список URL (мини-батч)

**Файл:** `n8n/workflows/04_firecrawl_url_list_resilient.json`
**Имя в n8n:** `04 - Firecrawl URL List Mini-Batch to Resilient Analyzer`
**Дата:** 2026-06-08
**Статус:** Готов к ручному тесту. НЕ активировать.
**План:** `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md` · **Связано:** DEC-045–052

> **Патч 2026-06-08 (под тестом):** дедуп переведён на отдельную вкладку **`url_registry`** (по `normalized_source_url`) вместо обхода 6 бизнес-вкладок; добавлены **детерминированный fallback по конкуренту** после провала primary+repair, **очистка markdown** (картинки/svg) + cap `text_context` **3500**, обновление `url_registry` после каждой не-дублирующей обработки, чистый layout. Остаётся **под тестом** до прохождения ретеста на 3 URL.

---

## 1. Назначение

Обрабатывает **ручной список из 3–5 URL конкурентов** за один ручной запуск, по одному URL.
Перед любыми тратами проверяет **дубликат `source_url`**; новые URL скрапятся Firecrawl, анализируются
тем же устойчивым анализатором, что и Workflow 03, и пишутся в нужную вкладку Google Sheets.

**Это НЕ:** расписание, crawl, batch-эндпоинт, search-эндпоинт, MCP/CLI, большой парсинг.

---

## 2. Отличие от Workflow 03

| | Workflow 03 | Workflow 04 |
|---|---|---|
| Вход | 1 URL (`Set Firecrawl URL`) | список 3–5 URL (`Set URL List`) |
| Итерация | нет | `Loop Over Items` (по одному URL) |
| Дедуп | нет | `url_registry` lookup (по `normalized_source_url`) ДО Firecrawl/Claude |
| Схема | 33 колонки | **35 колонок** (+`run_id`, +`batch_index`) + вкладка `url_registry` (10 колонок) |
| Сбой 1 URL | завершает | продолжает следующий URL |
| Невалидный JSON после ремонта | technical_errors | **deterministic_competitor_fallback → monitor_queue** при ≥5 сигналах |

Анализатор (Build Primary … Normalize + Route), языковой страж, competitor-харденинг,
мультипродукт→`generic_lending`, нормализация — **скопированы из Workflow 03 без изменений логики**.

---

## 3. Жёсткие лимиты

- Только ручной запуск (нет Schedule). `active=false`.
- **Максимум 5 URL** (жёсткая отсечка в `Set URL List`). Первый запуск — **3 URL**.
- Один запрос `POST /v2/scrape` на каждый НЕ-дубликат. Никаких crawl/batch/search.
- `text_context` ≤ **3500** символов перед Claude (после очистки от картинок/svg, релевантное первым).
- Сбой Firecrawl или пустой/непригодный markdown → `technical_errors` БЕЗ Claude.
- Дубликат (есть в `url_registry`, `force_reprocess=false`) → `skipped_log` БЕЗ Firecrawl/Claude (0 стоимости).
- После обработки каждого НЕ-дубликата (включая `technical_errors`) → строка в `url_registry`.
- `force_reprocess=false` по умолчанию (поле в `Set URL List`); `true` обходит дедуп (ручной/будущий override).

---

## 4. Требуемые креденшлы (по имени)

| Нода(ы) | Креденшл |
|---------|----------|
| `Firecrawl Scrape API` | `Firecrawl API - Marketing Scout` (Header Auth) |
| `Claude Primary API Request`, `Claude Repair API Request` | `Claude API - Marketing Scout` |
| `Registry Lookup`, `Append url_registry`, `Append Skipped Log (Duplicate)`, `Append to Dynamic Route Sheet` | `Google Sheets - Marketing Scout Service Account` |

---

## 5. Требуемые вкладки

### 5a. 6 бизнес-вкладок, 35-колоночный заголовок

Все 6 вкладок (`results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors`)
должны существовать и иметь **одинаковый 35-колоночный заголовок** (см. `docs/TABLE_SCHEMA.md`):
33 прежние колонки + **`run_id`** + **`batch_index`**.

> Оператор уже обновил все 6 вкладок до 35 колонок.

### 5b. Новая вкладка `url_registry` (10 колонок) — создать ДО теста

Создать отдельную вкладку **`url_registry`** с заголовком ровно из 10 колонок (в этом порядке):

```
normalized_source_url	source_url	first_seen_at	last_seen_at	last_route	last_processing_status	last_entity_type	run_id	batch_index	note
```

Это реестр обработанных URL. Дедуп ищет `normalized_source_url` здесь **до** Firecrawl/Claude.
Поиск по одной вкладке надёжнее и проще обхода шести бизнес-вкладок и готов под будущий
Telegram-бот / URL Discovery.

---

## 6. Импорт

1. n8n → **Workflows → ⋮ → Import from File** → выбрать `04_firecrawl_url_list_resilient.json`.
2. Убедиться, что `active = false`.

---

## 7. Чек-лист привязки креденшлов (ПОСЛЕ КАЖДОГО ИМПОРТА)

n8n не сохраняет привязку из JSON (ID локальны — DEC-046). Перепривязать вручную:

- [ ] `Firecrawl Scrape API` → `Firecrawl API - Marketing Scout`
- [ ] `Claude Primary API Request` → `Claude API - Marketing Scout`
- [ ] `Claude Repair API Request` → `Claude API - Marketing Scout`
- [ ] `Registry Lookup` → `Google Sheets - Marketing Scout Service Account`
- [ ] `Append url_registry` → то же
- [ ] `Append Skipped Log (Duplicate)` → то же
- [ ] `Append to Dynamic Route Sheet` → то же
- [ ] На **всех 4 нодах Google Sheets** вставить реальный **Spreadsheet ID** (заменить `PASTE_SPREADSHEET_ID_HERE`).

---

## 8. Как редактировать список URL

Открыть ноду **`Set URL List`** → массив `rawUrls`. Вставить 3–5 реальных URL конкурентов.
В репозитории остаются только плейсхолдеры `example.com`. Лишние URL свыше 5 отсекаются автоматически.

---

## 9. Запуск

- **Первый запуск: только 3 URL.** Записать кредиты Firecrawl и баланс Claude ДО.
- **Execute Workflow** один раз. Записать ПОСЛЕ; занести в `docs/COSTS_AND_LIMITS.md`.
- **Второй запуск: максимум 5 URL** — только если первый прошёл чисто.

---

## 10. Поведение дедупа (через `url_registry`)

Перед Firecrawl `Registry Lookup` читает вкладку **`url_registry`** и фильтрует по
`normalized_source_url`. `Evaluate Dedup` сравнивает нормализованный ключ.

- Найден дубликат (и `force_reprocess=false`) → `skipped_log`, `parse_method=dedup_source_url`,
  `processing_status=business_skip`, БЕЗ Firecrawl/Claude (0 кредитов, 0 токенов).
- Не найден (или `force_reprocess=true`) → обычный путь Firecrawl → анализатор.
- После обработки НЕ-дубликата → `Build Registry Row` → `Append url_registry` добавляет строку
  (`last_route`, `last_processing_status`, `last_entity_type`, `note=processed_by_workflow_04`).
  Даже `technical_errors` попадает в реестр (оператор не хочет повторной обработки по умолчанию).

> **Почему реестр, а не обход 6 вкладок:** поиск по одной вкладке `url_registry` надёжнее и проще,
> и готов под будущий Telegram-бот / URL Discovery. Обход шести бизнес-вкладок отклонён как хрупкий.

### Правила нормализации URL (ключ дедупа)

Ключ дедупа — **нормализованный полный URL с путём**, а НЕ домен (DEC-051). Нода `Normalize URL for Dedup`:

- приводит к нижнему регистру **только** схему и хост (путь не трогает);
- убирает `#fragment` после `#`;
- убирает трекинговые параметры: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`,
  `utm_content`, `fbclid`, `gclid`, `yclid`; значимые query-параметры сохраняет;
- сохраняет путь; убирает завершающий слеш только у НЕ-корневых путей; корень нормализует единообразно;
- **не схлопывает страницы до хоста** — разные страницы одного домена остаются разными ключами.

**Дубликаты (один ключ):**

```
https://example.com/                       →  https://example.com/
https://example.com                        →  https://example.com/
https://example.com/#top                   →  https://example.com/
https://example.com/?utm_source=test       →  https://example.com/
```

**НЕ дубликаты (разные ключи — страницы одного домена):**

```
https://example.com/                       →  https://example.com/
https://example.com/kredit/pod-zalog-avto/ →  https://example.com/kredit/pod-zalog-avto
https://example.com/kredit/refinansirovanie/ → https://example.com/kredit/refinansirovanie
```

> **«Лучшая попытка».** Используется нода Google Sheets `read` с фильтром по `normalized_source_url`
> (`filtersUI`/lookup), `alwaysOutputData=true` + `onError=continueRegularOutput`. Если сборка n8n не
> принимает фильтр при импорте — см. Troubleshooting → «dedup lookup failed» (fallback).

### Loop Over Items

`Loop Over Items` (Split In Batches) обрабатывает по одному URL за итерацию: оба завершающих пути —
`Append url_registry` (обработанный) и `Append Skipped Log (Duplicate)` (дубликат) — возвращаются в
`Loop Over Items`, чтобы перейти к следующему URL. Сбой одного URL не останавливает остальные.

### Layout (после патча)

Ноды разнесены по дорожкам без наложений (оператор больше не двигает их вручную):
- **Верх:** Manual Start → Set URL List → Loop Over Items → Normalize URL → Registry Lookup → Evaluate Dedup → IF Duplicate?
- **Дубликат (вниз):** Append Skipped Log (Duplicate) → Loop.
- **Середина:** Build Firecrawl → Firecrawl → Normalize Firecrawl → IF Firecrawl OK → Build/Claude/Parse Primary → IF Primary OK → Normalize + Route → Append → Build Registry Row → Append url_registry → Loop.
- **Низ:** Build Repair → Claude Repair → Parse Repaired → Normalize + Route.

---

## 11. Ожидаемые выходы

| Тип страницы | Вкладка |
|--------------|---------|
| Активный конкурент | `monitor_queue` |
| Дубликат (есть в `url_registry`) | `skipped_log` (`dedup_source_url`) |
| Сбой/пустой Firecrawl | `technical_errors` (`firecrawl_error`) |
| Невалидный JSON после ремонта + ≥5 сигналов конкурента | `monitor_queue` (`deterministic_competitor_fallback`) |
| Невалидный JSON после ремонта + <5 сигналов | `technical_errors` (`technical_error`) |
| Горячий лид (редко для конкурентов) | `results` |
| Слабый/неоднозначный сигнал | `review_queue` |
| Нерелевантно/boilerplate | `skipped_log` |

`run_id` одинаков для всех строк одного запуска; `batch_index` — порядковый номер URL (1..5).
Каждый обработанный НЕ-дубликат добавляет строку в `url_registry`.

---

## 11a. Ретест (после патча) — обязателен до 5 URL

1. Оставить существующую запись `url_registry` для `mosinvestfinans.ru/kredit/pod-zalog-avto`
   (если её нет — добавить вручную одну строку с этим `normalized_source_url`, чтобы проверить дубликат).
2. В `Set URL List` указать **3 URL**: старый (`…/pod-zalog-avto`) + 2 новых конкурента.
3. Ожидать: старый → `skipped_log`/`dedup_source_url` (0 трат); два новых → `monitor_queue`
   (обычный анализ или `deterministic_competitor_fallback`, если JSON не распарсился).
4. Проверить: 2 новые строки появились в `url_registry`; дубликат — нет.
5. Записать стоимость (раздел 13). Только при чистом прохождении — переходить к 5 URL.

---

## 12. Troubleshooting

| Симптом | Действие |
|---------|----------|
| Firecrawl **401/403** | Проверить Header Value `Bearer <ключ>`, домен `api.firecrawl.dev` |
| Firecrawl **429** | Подождать; не перезапускать сразу; уменьшить список |
| **Пустой markdown** | Страница за JS/капчей/логином → строка в `technical_errors`; выбрать другой URL |
| Claude **502** | Строка в `technical_errors` с Primary+Repair диагностикой; повторить позже |
| **Дубликат URL** | Ожидаемо → `skipped_log`, без трат. Чтобы переобработать — удалить строку из `url_registry` или поставить `force_reprocess=true` в `Set URL List` |
| **Неверный маршрут** | Проверить `Normalize + Route`; competitor-харденинг должен дать `monitor_queue` |
| **Вкладка не найдена** | Создать все 6 бизнес-вкладок (35 колонок) + `url_registry` (10 колонок) |
| **dedup lookup failed** (`Registry Lookup` падает/не импортируется) | Fallback: (1) временно отключить дедуп — соединить `Normalize URL for Dedup` → `Evaluate Dedup` напрямую (при пустом `.all()` всё считается НЕ-дубликатом, тратит Firecrawl), и чистить дубли вручную; или (2) заменить `filtersUI` на чтение всей вкладки `url_registry` + сравнение в `Evaluate Dedup`. Дедуп — «лучшая попытка». |

---

## 13. Логирование стоимости

Записывать в `docs/COSTS_AND_LIMITS.md` на каждый запуск:
`run_id`, число URL, число дубликатов, кредиты Firecrawl до/после, баланс Claude до/после,
число `technical_errors`, число `repair_used`, стоимость на успешную строку.

> Дубликаты должны стоить **0** Firecrawl/Claude, если дедуп работает.

---

## 14. Будущее: Telegram Control Bot / URL Discovery (НЕ строится сейчас)

В будущем Telegram-бот сможет принимать запрос на естественном языке, например:
«найди конкурентов по кредитам под залог авто в Москве». Бот будет:
1. собирать/генерировать список URL-кандидатов,
2. показывать оценку стоимости,
3. спрашивать подтверждение,
4. передавать список URL в Workflow 04,
5. присылать сводку.

Дедуп Workflow 04 предотвратит повторную обработку. **Сейчас Workflow 04 принимает только URL,
введённые вручную.** Обнаружение URL и NL-запросы — будущий слой (DEC-050), не этот workflow.
