# Workflow 02 v2 — Resilient Router TEST HARNESS — Руководство по тестированию

Версия: 2026-06-06  
Файл workflow: `n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json`

---

## Что тестируется

Архитектура Resilient Output Layer (DEC-033):

1. **Primary Claude Analysis** — один вызов Claude API для анализа записи (baseline v2, raw JSON).
2. **JSON Repair Formatter** — второй вызов Claude (temp=0.0, max_tokens=900), если первичный ответ нечитаем.
3. **Multi-Tab Router** — направляет результат в одну из 6 вкладок Google Sheets по правилам маршрутизации.

Три состояния вывода:
- `parsed_success` — первичный или отремонтированный JSON разобран успешно
- `business_skip` — Claude счёл запись нерелевантной
- `technical_error` — JSON не разобрать ни первично, ни через repair

---

## Шаг 1 — Импорт workflow в n8n

1. Открой n8n в браузере (через SSH-туннель или прямой доступ).
2. Слева: **Workflows → Import from file**.
3. Выбери файл:
   ```
   n8n/workflows/02_claude_api_single_record_v2_resilient_router_test.json
   ```
4. Workflow откроется с именем **"02 - Claude API Single Record Analysis v2 RESILIENT ROUTER TEST"**.
5. Убедись, что `active = false` (переключатель вверху выключен). **Не активируй workflow.**

---

## Шаг 2 — Настройка credentials

Workflow использует два credential:

### Claude API (HTTP Header Auth)

1. В n8n: **Settings → Credentials → New → Header Auth**.
2. Имя: `Claude API - Marketing Scout`.
3. Header: `Authorization`, Value: `Bearer <твой_токен_aiprimetech>`.
4. Сохрани. Скопируй ID credential.
5. Открой nodes **"Claude Primary API Request"** и **"Claude Repair API Request"**.
6. В каждом: замени `PASTE_CREDENTIAL_ID_HERE` на ID credential.

### Google Sheets (Service Account)

1. В n8n: **Settings → Credentials → New → Google Sheets API** (Service Account).
2. Имя: `Google Sheets - Marketing Scout Service Account`.
3. Загрузи JSON-ключ сервисного аккаунта.
4. Сохрани. Скопируй ID credential.
5. Открой все 6 nodes **"Append to ..."** (results, review_queue, monitor_queue, content_queue, skipped_log, technical_errors).
6. В каждом: замени `PASTE_CREDENTIAL_ID_HERE` на ID credential.

---

## Шаг 3 — Прописать Spreadsheet ID

В каждом из 6 Append-nodes:
- Найди поле `documentId` → значение `PASTE_SPREADSHEET_ID_HERE`
- Замени на реальный ID Google Sheets таблицы (из URL: `https://docs.google.com/spreadsheets/d/<ID>/edit`)

---

## Шаг 4 — Создать вкладки в Google Sheets

Создай вручную 6 вкладок (или убедись, что они уже есть):

| Вкладка | Назначение |
|---|---|
| `results` | Горячие лиды — lead_signal_score ≥ 70 + contact |
| `review_queue` | Лиды на проверку — score 35–69 или investigate |
| `monitor_queue` | Конкуренты — competitor_strength ≥ 45 |
| `content_queue` | Идеи контента — content_idea_score ≥ 50 |
| `skipped_log` | Нерелевантные и пропущенные записи |
| `technical_errors` | Технические ошибки — JSON не разобран ни primary, ни repair |

### Заголовки колонок (первая строка каждой вкладки)

```
created_at | source_type | platform | source_url | parsed_at | published_at | freshness_status | entity_type | company_name | profile_name | profile_url | region | service_type | offer_text | terms | contact_public | text_context | detected_need | competitor_strength | lead_signal_score | content_idea_score | quality_score | reason | recommended_action | status | processing_status | parse_method | parse_error | raw_response_preview | route | needs_manual_review | source_record_type | repair_used | repair_status | test_id | expected_route | expected_entity_type | expected_recommended_action | expected_quality_range | actual_entity_type | actual_recommended_action | actual_quality_score | actual_lead_signal_score | actual_content_idea_score | actual_competitor_strength | test_pass_basic | test_notes
```

Всего 47 колонок. Можно добавить все в одну строку — n8n auto-map заполнит их автоматически.

---

## Шаг 5 — Запись баланса API перед тестами

Запиши текущий баланс в личном кабинете aiprimetech.io **ДО** запуска тестов.  
Тесты A, B, C используют 1 вызов API каждый.  
Тесты D и E: mock_mode → repair API вызывается (1 доп. вызов).  
Суммарно: ≈5 вызовов Claude.

---

## Тесты A–E — подробное описание

### Как менять тест

Открой node **"Set Test Selector"** → поле `test_id` → поменяй значение (A / B / C / D / E) → сохрани → нажми **"Execute Workflow"** (ручной запуск).

---

### Тест A — Горячий лид → `results`

| Поле | Значение |
|---|---|
| test_id | A |
| mock_mode | none (реальный API) |
| Ожидаемый route | results |
| Ожидаемый entity_type | lead_signal |
| Ожидаемый recommended_action | contact |
| Ожидаемый lead_signal_score | ≥ 70 |

**Сценарий:** Москва, Toyota Camry 2019, залог ПТС, нужно 250 000 руб., банки отказали, срочно сегодня.

**Проверь в Google Sheets (вкладка `results`):**
- `test_pass_basic = TRUE`
- `route = results`
- `parse_method = primary_json`
- `repair_used = FALSE`
- `lead_signal_score` ≥ 70
- `recommended_action = contact`

---

### Тест B — Слабый лид → `review_queue`

| Поле | Значение |
|---|---|
| test_id | B |
| mock_mode | none (реальный API) |
| Ожидаемый route | review_queue |
| Ожидаемый entity_type | lead_signal |
| Ожидаемый recommended_action | investigate |
| Ожидаемый lead_signal_score | 35–69 |

**Сценарий:** VK, интересуется займами под залог, ~100 тыс., не срочно, регион не уточнён.

**Проверь в Google Sheets (вкладка `review_queue`):**
- `test_pass_basic = TRUE`
- `route = review_queue`
- `parse_method = primary_json`
- `repair_used = FALSE`
- `lead_signal_score` в диапазоне 35–69
- `recommended_action = investigate`

---

### Тест C — Конкурент → `monitor_queue`

| Поле | Значение |
|---|---|
| test_id | C |
| mock_mode | none (реальный API) |
| Ожидаемый route | monitor_queue |
| Ожидаемый entity_type | competitor |
| Ожидаемый recommended_action | monitor |
| Ожидаемый competitor_strength | ≥ 45 |

**Сценарий:** Сайт конкурента МФО, займы под ПТС, ставка от 2,5%, Москва и МО, одобрение за 1 час.

**Проверь в Google Sheets (вкладка `monitor_queue`):**
- `test_pass_basic = TRUE`
- `route = monitor_queue`
- `entity_type = competitor`
- `competitor_strength` ≥ 45
- `repair_used = FALSE`

---

### Тест D — Принудительный Markdown → Repair → `results`

| Поле | Значение |
|---|---|
| test_id | D |
| mock_mode | mock_markdown |
| Ожидаемый route | results |
| Ожидаемый entity_type | lead_signal |
| Ожидаемый recommended_action | contact |
| Ожидаемый parse_method | mock_markdown_repair |

**Что происходит:** Primary API пропускается (mock). В `Build Repair Request` подаётся симулированный Markdown-ответ. Repair Claude разбирает его в JSON. Должна произойти маршрутизация в `results`.

**Проверь в Google Sheets (вкладка `results`):**
- `test_pass_basic = TRUE`
- `route = results`
- `repair_used = TRUE`
- `repair_status = success`
- `parse_method = mock_markdown_repair`
- `lead_signal_score` ≥ 70

---

### Тест E — Нечитаемый ответ → `technical_errors`

| Поле | Значение |
|---|---|
| test_id | E |
| mock_mode | mock_unrepairable |
| Ожидаемый route | technical_errors |
| Ожидаемый processing_status | technical_error |
| Ожидаемый repair_status | failed |

**Что происходит:** Primary API пропускается (mock). Repair API вызывается, но в `Parse Repaired JSON` обнаруживается `mock_mode = mock_unrepairable` → принудительно устанавливается `processing_status = technical_error`, `route = technical_errors`, без реального вызова Repair (реально repair API всё же вызывается, но результат игнорируется после возврата из `Parse Repaired JSON`).

> **Примечание:** В данной реализации repair API для теста E всё равно вызывается, но его ответ игнорируется. Это одна реальная стоимость вызова. Если нужно избежать вызова — добавь IF перед `Claude Repair API Request` для mock_unrepairable.

**Проверь в Google Sheets (вкладка `technical_errors`):**
- `test_pass_basic = TRUE`
- `route = technical_errors`
- `processing_status = technical_error`
- `repair_status = failed`
- `repair_used = TRUE`

---

## Таблица ожидаемых результатов

| Тест | mock_mode | API-вызовы | Ожидаемый route | parse_method | repair_used | test_pass_basic |
|---|---|---|---|---|---|---|
| A | none | 1 primary | results | primary_json | FALSE | TRUE |
| B | none | 1 primary | review_queue | primary_json | FALSE | TRUE |
| C | none | 1 primary | monitor_queue | primary_json | FALSE | TRUE |
| D | mock_markdown | 1 repair | results | mock_markdown_repair | TRUE | TRUE |
| E | mock_unrepairable | 1 repair | technical_errors | repaired_json | TRUE | TRUE |

---

## Что делать при ошибках

### `test_pass_basic = FALSE` для теста A, B или C

Claude вернул другой entity_type или score — это не технический сбой, а вариативность модели. Проверь поле `reason` в таблице. Если аргументация логична — score порогово допустим. Если нет — скорректируй тестовый текст.

### Тест D route = technical_errors вместо results

Repair Claude не смог разобрать Markdown. Проверь `raw_response_preview` в `Parse Repaired JSON`. Если Claude вернул валидный JSON, но lead_signal_score < 70 — это `review_queue`, а не `results`. Проверь `reason`.

### Ошибка `Could not find node credentials`

Credential ID не заменён. Повтори Шаг 2.

### Ошибка `Spreadsheet not found` или `Sheet not found`

Spreadsheet ID или имя вкладки неверно. Повтори Шаги 3 и 4.

### HTTP 401 / 403 от aiprimetech.io

Токен истёк или неверен. Обнови credential.

### HTTP 502 / 503 от aiprimetech.io

Gateway временно недоступен. Подожди 5–10 минут и повтори.

---

## Учёт стоимости

После всех 5 тестов:
1. Открой баланс aiprimetech.io.
2. Вычти из баланса ДО.
3. Запиши расход в `docs/COSTS_AND_LIMITS.md`.

Ориентировочная стоимость 5 тестов: ≈3–6 primary токенов + ≈2 repair токена. Точные числа — в интерфейсе aiprimetech.io.

---

## После успешных тестов

Если все 5 тестов прошли (`test_pass_basic = TRUE` для всех):

1. Зафикси результаты в `docs/TEST_RESULTS.md`.
2. Обнови `docs/NEXT_ACTIONS.md` — шаг D Phase 3 выполнен.
3. Переходи к Step D Phase 4: миграция на production Workflow 02.
