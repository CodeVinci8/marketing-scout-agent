# N8N_WORKFLOW_04_FIRECRAWL_URL_LIST_RU.md — Workflow 04: Firecrawl список URL (мини-батч)

**Файл:** `n8n/workflows/04_firecrawl_url_list_resilient.json`
**Имя в n8n:** `04 - Firecrawl URL List Mini-Batch to Resilient Analyzer`
**Дата:** 2026-06-08
**Статус:** Готов к ручному тесту. НЕ активировать.
**План:** `docs/WORKFLOW_04_FIRECRAWL_URL_LIST_PLAN.md` · **Связано:** DEC-045–050

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
| Дедуп | нет | `source_url` lookup ДО Firecrawl/Claude |
| Схема | 33 колонки | **35 колонок** (+`run_id`, +`batch_index`) |
| Сбой 1 URL | завершает | продолжает следующий URL |

Анализатор (Build Primary … Normalize + Route), языковой страж, competitor-харденинг,
мультипродукт→`generic_lending`, нормализация — **скопированы из Workflow 03 без изменений логики**.

---

## 3. Жёсткие лимиты

- Только ручной запуск (нет Schedule). `active=false`.
- **Максимум 5 URL** (жёсткая отсечка в `Set URL List`). Первый запуск — **3 URL**.
- Один запрос `POST /v2/scrape` на каждый НЕ-дубликат. Никаких crawl/batch/search.
- `text_context` ≤ 6000 символов перед Claude.
- Сбой Firecrawl или пустой/непригодный markdown → `technical_errors` БЕЗ Claude.
- Дубликат `source_url` → `skipped_log` БЕЗ Firecrawl/Claude (0 стоимости).

---

## 4. Требуемые креденшлы (по имени)

| Нода(ы) | Креденшл |
|---------|----------|
| `Firecrawl Scrape API` | `Firecrawl API - Marketing Scout` (Header Auth) |
| `Claude Primary API Request`, `Claude Repair API Request` | `Claude API - Marketing Scout` |
| 4 ноды `Dedup Lookup — *`, `Append to Dynamic Route Sheet` | `Google Sheets - Marketing Scout Service Account` |

---

## 5. Требуемые 6 вкладок и 35-колоночный заголовок

Все 6 вкладок (`results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors`)
должны существовать и иметь **одинаковый 35-колоночный заголовок** (см. `docs/TABLE_SCHEMA.md`):
33 прежние колонки + **`run_id`** + **`batch_index`**.

> Оператор уже обновил все 6 вкладок до 35 колонок.

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
- [ ] `Dedup Lookup — results` → `Google Sheets - Marketing Scout Service Account`
- [ ] `Dedup Lookup — review_queue` → то же
- [ ] `Dedup Lookup — monitor_queue` → то же
- [ ] `Dedup Lookup — content_queue` → то же
- [ ] `Append to Dynamic Route Sheet` → то же
- [ ] На **всех 5 нодах Google Sheets** вставить реальный **Spreadsheet ID** (заменить `PASTE_SPREADSHEET_ID_HERE`).

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

## 10. Поведение дедупа

Перед Firecrawl проверяется `source_url` (нормализованный) в 4 бизнес-вкладках:
`results`, `review_queue`, `monitor_queue`, `content_queue`.
`technical_errors` и `skipped_log` **не** блокируют как дубликат (чтобы можно было повторить неудачные).

- Найден дубликат → `skipped_log`, `parse_method=dedup_source_url`, `processing_status=business_skip`,
  БЕЗ Firecrawl/Claude (0 кредитов, 0 токенов).
- Не найден → обычный путь Firecrawl → анализатор.

> **Реализация дедупа — «лучшая попытка».** Используются ноды Google Sheets `read` с фильтром по
> `source_url` (`filtersUI`/lookup). Если конкретная сборка n8n не принимает этот фильтр при импорте,
> см. раздел Troubleshooting → «dedup lookup failed» (fallback).

---

## 11. Ожидаемые выходы

| Тип страницы | Вкладка |
|--------------|---------|
| Активный конкурент | `monitor_queue` |
| Дубликат `source_url` | `skipped_log` (`dedup_source_url`) |
| Сбой/пустой Firecrawl | `technical_errors` (`firecrawl_error`) |
| Горячий лид (редко для конкурентов) | `results` |
| Слабый/неоднозначный сигнал | `review_queue` |
| Нерелевантно/boilerplate | `skipped_log` |

`run_id` одинаков для всех строк одного запуска; `batch_index` — порядковый номер URL (1..5).

---

## 12. Troubleshooting

| Симптом | Действие |
|---------|----------|
| Firecrawl **401/403** | Проверить Header Value `Bearer <ключ>`, домен `api.firecrawl.dev` |
| Firecrawl **429** | Подождать; не перезапускать сразу; уменьшить список |
| **Пустой markdown** | Страница за JS/капчей/логином → строка в `technical_errors`; выбрать другой URL |
| Claude **502** | Строка в `technical_errors` с Primary+Repair диагностикой; повторить позже |
| **Дубликат URL** | Ожидаемо → `skipped_log`, без трат. Чтобы переобработать — удалить старую строку или использовать новый URL |
| **Неверный маршрут** | Проверить `Normalize + Route`; competitor-харденинг должен дать `monitor_queue` |
| **Вкладка не найдена** | Создать все 6 вкладок с 35-колоночным заголовком |
| **dedup lookup failed** (нода Google Sheets read падает/не импортируется) | Fallback: (1) временно отключить дедуп — соединить `Normalize URL for Dedup` → `Evaluate Dedup` напрямую (Evaluate Dedup при пустом `.all()` пропускает как НЕ-дубликат, тратит Firecrawl), и удалить дубли вручную; или (2) заменить `filtersUI` на чтение всей вкладки + сравнение в `Evaluate Dedup`. Дедуп помечен как «лучшая попытка». |

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
