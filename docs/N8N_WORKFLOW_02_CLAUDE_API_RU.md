# N8N_WORKFLOW_02_CLAUDE_API_RU.md — Workflow 02: Claude API Single Record Analysis

**Статус:** ✓ ВЫПОЛНЕН УСПЕШНО 2026-06-05
**JSON-файл:** `n8n/workflows/02_claude_api_single_record_analysis.json`
**Дата:** 2026-06-05

---

## Результат выполнения (2026-06-05)

Воркфлоу выполнен успешно. Claude вернул валидный JSON, Quality Gate пропустил запись, строка добавлена в Google Sheets.

| Поле | Значение |
|------|---------|
| `service_type` | `pts_loan` |
| `quality_score` | 72 |
| `lead_signal_score` | 75 |
| `content_idea_score` | 80 |
| `competitor_strength` | 68 |
| `status` | `analyzed` |
| `recommended_action` | `monitor` |

**Измеренная стоимость:** $0.0115 за один короткий AI-скоринг ≈ 0.84 RUB. Подробнее: `docs/COSTS_AND_LIMITS.md`.

**Доказанная цепочка:** n8n → Claude API gateway → парсинг JSON → Quality Gate → Google Sheets ✓

**Не изменять этот воркфлоу** — он является базовым Claude API + Google Sheets baseline.

---

## Что проверяет этот воркфлоу

Workflow 02 — первый настоящий AI-воркфлоу проекта. Он проверяет полную цепочку:
n8n формирует запрос → отправляет в Claude API → Claude анализирует данные как Marketing Scout Agent → n8n парсит ответ → фильтр качества → запись в Google Sheets.

В отличие от Workflow 01 (мок-анализ), здесь Claude реально обрабатывает данные и возвращает структурированный JSON на основе промпта.

---

## Почему это первый настоящий агентный воркфлоу

Workflow 00 и 01 работали с захардкоженными значениями — данные генерировал сам Code-нод, без внешних API. Workflow 02 впервые использует реальный Claude API: данные уходят во внешнюю систему и возвращаются в виде структурированного анализа. С этого момента pipeline перестаёт быть демо и начинает работать как агент.

---

## Как Claude работает в этом воркфлоу

Claude получает один рыночный/конкурентный рекорд в формате JSON и должен вернуть строгий JSON-объект с анализом. Claude выступает в роли **Marketing Scout Agent** — специалиста по рынку залогового кредитования в России.

Промпт задаёт:
- Контекст рынка (займы под залог авто, ПТС, недвижимости, рефинансирование)
- Правила классификации (competitor, lead_signal, market_signal, content_idea, irrelevant)
- Правила скоринга (quality_score, lead_signal_score, content_idea_score, competitor_strength) от 1 до 100
- Условия пропуска записей (boilerplate, слишком короткий текст, нерелевантный контент)
- Требования к выходному JSON (точная схема, запрет на выдумку данных)

Полный промпт: `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V1.md`

---

## Структура нодов

| № | Нод | Тип | Назначение |
|---|-----|-----|-----------|
| 1 | Sticky Note | Описание | Объяснение оператору |
| 2 | Manual Start | Manual Trigger | Ручной запуск |
| 3 | Set Test Competitor Data | Set/Edit Fields | Тестовые данные конкурента |
| 4 | Build Claude Request | Code | Формирует тело запроса для /v1/messages |
| 5 | Claude API Request | HTTP Request | POST-запрос к gateway |
| 6 | Parse Claude JSON Response | Code | Парсит ответ, убирает markdown-обёртку |
| 7 | Quality Gate | IF | Пропускает только analyzed + quality_score >= 60 |
| 8 | Append Row to Google Sheets | Google Sheets | Записывает строку в лист results |
| 9 | Sticky Note | Инструкции | Напоминание о конфиге перед запуском |

---

## Ручная настройка после импорта

После импорта воркфлоу нужно настроить три вещи вручную.

### 1. Credential для Claude API

Нод: **Claude API Request**

- Открыть нод → в поле **Credential** выбрать `Claude API - Marketing Scout`
- Тип: **HTTP Header Auth**
- Если credential ещё не создан: Settings → Credentials → New → HTTP Header Auth
  - Name: `Claude API - Marketing Scout`
  - Header Name: `Authorization`
  - Header Value: `Bearer <твой токен>`
- Gateway URL: `https://aiprimetech.io/v1/messages` (уже прописан в ноде)
- Model: `claude-sonnet-4-6` (уже в коде Build Claude Request)

> **Важно:** токен хранится только в n8n Credentials. Никогда не вставляй его в код нода или в файлы проекта.

### 2. Credential для Google Sheets

Нод: **Append Row to Google Sheets**

- Открыть нод → в поле **Credential** выбрать `Google Sheets - Marketing Scout Service Account`
- Credential уже создан при настройке Workflow 01

### 3. Spreadsheet ID

Нод: **Append Row to Google Sheets**

- В поле **Document** заменить `PASTE_SPREADSHEET_ID_HERE` на реальный ID таблицы `Marketing Scout Results`
- ID находится в URL таблицы: `https://docs.google.com/spreadsheets/d/<ID>/edit`
- Sheet name: `results` (уже задано)

---

## Как запустить воркфлоу

1. Открыть n8n через SSH tunnel → `http://localhost:5678`
2. Импортировать: **Workflows → ⋮ → Import from File** → выбрать `02_claude_api_single_record_analysis.json`
3. Открыть воркфлоу, настроить credentials и Spreadsheet ID (см. выше)
4. Нажать кнопку **Test workflow** (или **Execute Workflow**) — Manual Trigger запустит цепочку
5. Следить за выполнением нодов по зелёным/красным иконкам

---

## Ожидаемый результат

При успешном выполнении:

1. **Set Test Competitor Data** — выводит тестовую запись (platform=manual_test, текст про займ под залог авто)
2. **Build Claude Request** — выводит JSON-тело запроса с model, system, messages
3. **Claude API Request** — выводит HTTP-ответ от gateway с полем `content` (массив)
4. **Parse Claude JSON Response** — выводит распарсенный JSON-анализ от Claude, например:
   ```json
   {
     "entity_type": "competitor",
     "service_type": "pts_loan",
     "company_name": "Тестовый конкурент",
     "region": "Москва",
     "offer_text": "Займы под залог автомобиля с решением за 1 день",
     "competitor_strength": 55,
     "quality_score": 72,
     "lead_signal_score": 15,
     "content_idea_score": 60,
     "status": "analyzed",
     "recommended_action": "monitor"
   }
   ```
5. **Quality Gate** — пропускает запись (status=analyzed, quality_score >= 60 → true branch)
6. **Append Row to Google Sheets** — добавляет строку в лист `results`

После запуска открой таблицу `Marketing Scout Results` → лист `results` → убедись, что появилась новая строка с данными от Claude.

---

## Как проверить строку в Google Sheets

- Открыть таблицу `Marketing Scout Results` → вкладка `results`
- Последняя строка должна содержать данные Claude-анализа: entity_type, service_type, offer_text, competitor_strength, quality_score, reason и т.д.
- `created_at` будет в ISO-формате (UTC)
- `status` = `analyzed`
- Если строка не появилась — проверь, прошёл ли нод Quality Gate (true branch)

---

## Частые ошибки

### Ошибка: неправильное имя поля в Header Auth

**Симптом:** HTTP 401 Unauthorized от gateway.
**Причина:** при создании HTTP Header Auth credential поле "Header Name" заполнено как `X-Api-Key` вместо `Authorization`.
**Решение:** в credential поставить Header Name = `Authorization`, Header Value = `Bearer <токен>` (включая слово Bearer и пробел).

---

### Ошибка: неправильный model id

**Симптом:** HTTP 400 или ответ `"No available accounts"`.
**Причина:** использован `claude-sonnet-4.6` (с точкой) вместо `claude-sonnet-4-6` (с дефисом).
**Решение:** в коде нода Build Claude Request проверить строку `model: 'claude-sonnet-4-6'`. Точка запрещена — только дефис.

---

### Ошибка: gateway "No available accounts"

**Симптом:** HTTP-ответ содержит `"No available accounts"`.
**Причина:** либо неверный model id (см. выше), либо токен не активен, либо лимит исчерпан.
**Решение:** сначала проверить model id. Если модель правильная — обратиться к провайдеру gateway.

---

### Ошибка: Parse node не может распарсить ответ

**Симптом:** нод Parse Claude JSON Response возвращает `status: skipped`, `reason: "Failed to parse Claude response"`.
**Причины и решения:**
- Claude вернул ответ в markdown-обёртке (```json ... ```) — нод автоматически убирает обёртку, но если формат нестандартный, промпт нужно усилить.
- Claude вернул thinking block вместо text block — нод ищет item с `type === 'text'`, thinking blocks игнорируются. Если всё равно ошибка — проверить `raw_response_preview` в выводе нода.
- Ответ невалидный JSON — проверить полный текст ответа в `raw_response_preview`.

---

### Ошибка: нет доступа к Google Sheets

**Симптом:** нод Append Row to Google Sheets выдаёт ошибку доступа.
**Причина:** сервисный аккаунт не добавлен как Editor в таблицу.
**Решение:** открыть таблицу `Marketing Scout Results` → поделиться с email сервисного аккаунта с правами Editor.

---

### Запись не попадает в Google Sheets (нет ошибки, но строки нет)

**Симптом:** воркфлоу завершился зелёным, но строки в таблице нет.
**Причина:** Quality Gate пропустил запись по false branch (quality_score < 60 или status != analyzed).
**Решение:** открыть нод Quality Gate → посмотреть результат на false branch. Если score низкий — это ожидаемое поведение. Для тестирования временно поменяй порог в IF-условии на >= 1.

---

## Объяснение для нетехнического клиента

Этот воркфлоу — первый шаг к автоматической разведке рынка. Он берёт информацию об одном конкуренте или потенциальном клиенте и отправляет её искусственному интеллекту (Claude). Claude анализирует запись и отвечает: кто это — конкурент или лид? Насколько сильный? Стоит ли следить или связаться? И сохраняет результат в таблицу Google Sheets.

Пока воркфлоу работает с одной тестовой записью. Следующие шаги — подключить реальные источники данных (Firecrawl, Apify) и запускать анализ автоматически.

---

## Следующий воркфлоу

**Workflow 03 — Firecrawl Website Analysis**

Цель: взять реальный URL конкурента, отправить его в Firecrawl для чистой экстракции текста, и передать результат в Claude для анализа.

Это первый воркфлоу с реальными внешними данными (не тестовыми).

Подготовка: потребуется Firecrawl API key и создание n8n credential для Firecrawl.
