# Воркфлоу 01 — Google Sheets Append Row Test

**Язык:** Русский (технический гид для оператора)
**Файл:** `docs/N8N_WORKFLOW_01_GOOGLE_SHEETS_RU.md`
**JSON-файл:** `n8n/workflows/01_google_sheets_append_row_test.json`
**Статус:** ВЫПОЛНЕН УСПЕШНО — 2026-06-04
**Не изменять** — служит базовым Google Sheets-эталоном для всего проекта

---

## Что проверяет этот воркфлоу

Это второй воркфлоу в системе. Его цель — убедиться, что n8n может:
- взять структурированные тестовые данные конкурента;
- обработать их Code-нодом (полное формирование строки таблицы);
- записать строку в Google Sheets через Service Account credential.

Claude API, Apify и Firecrawl в этом воркфлоу **не используются**.

---

## Почему тестируем Google Sheets раньше Claude API

Запись в таблицу — самая хрупкая часть pipeline. Если credentials не настроены, таблица не расшарена или заголовки не совпадают, данные просто исчезнут без ошибки. Лучше обнаружить это сейчас, на тестовых данных, чем после первого реального запуска с Apify.

Порядок верификации: платформа (Workflow 00) → хранилище (Workflow 01) → анализ (Workflow 02) → скрейпинг (Workflow 10).

---

## Импорт воркфлоу

### Способ 1 — Импорт из файла

1. Открыть n8n: `http://localhost:5678` (через SSH-туннель)
2. Слева нажать **Workflows**
3. Нажать **⋮** → **Import from File**
4. Выбрать файл `n8n/workflows/01_google_sheets_append_row_test.json`
5. Нажать **Import** — воркфлоу появится с именем `01 - Google Sheets Append Row Test`

### Способ 2 — Импорт из буфера обмена

```bash
cat n8n/workflows/01_google_sheets_append_row_test.json
```

Скопировать весь вывод (от `{` до `}`), затем в n8n: **⋮ → Import from Clipboard**.

---

## Что нужно настроить вручную после импорта

После импорта воркфлоу **не запустится** без двух обязательных настроек. Они не хранятся в JSON по соображениям безопасности.

### 1. Выбрать Google Sheets credential

1. Открыть узел **Append Row to Google Sheets** (кликнуть на него)
2. В поле **Credential** нажать на выпадающий список
3. Выбрать: **Google Sheets - Marketing Scout Service Account**
4. Если credential ещё не создан — создать его через **Settings → Credentials → Add Credential → Google API (Service Account)**

### 2. Указать Spreadsheet ID

1. В том же узле найти поле **Document**
2. Заменить placeholder `PASTE_SPREADSHEET_ID_HERE` на реальный Spreadsheet ID

**Как получить Spreadsheet ID:**
Открыть таблицу в браузере. URL выглядит так:
```
https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit
                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                       Это и есть Spreadsheet ID — скопировать его
```

### 3. Проверить имя листа

Лист должен называться `results` (строчными буквами, без пробелов).
Поле **Sheet** в узле уже установлено на `results` — убедиться, что в таблице есть лист с таким именем.

### 4. Важно: структура заголовков в таблице

Заголовки должны быть **только в строке 1** — одна строка, 25 столбцов (по `docs/TABLE_SCHEMA.md`).

**Типичная ошибка:** при ручном создании таблицы заголовки иногда вставляются вертикально в столбец A вместо горизонтально в строку 1. Это приводит к тому, что n8n пишет данные не в те колонки.

**Как исправить:** если строки 2–25 содержат названия полей в столбце A — удалить строки 2–25 целиком. Оставить только строку 1 с горизонтальными заголовками.

**Никогда не коммитить в Git:** реальный Spreadsheet ID и email сервисного аккаунта.
Эти данные хранятся только в n8n Credentials и в настройках узла на VPS.

---

## Ожидаемый вывод в n8n

После успешного запуска узел **Append Row to Google Sheets** должен вернуть:

```json
{
  "updatedRange": "results!A2:Y2",
  "updatedRows": 1,
  "updatedColumns": 25,
  "updatedCells": 25
}
```

Цифры могут отличаться в зависимости от версии n8n и API-ответа Google. Главный критерий: **нет красных узлов**, поле `updatedRows` равно `1`.

---

## Ожидаемый результат в Google Sheet

В листе `results` должна появиться новая строка со следующими значениями:

| Поле | Значение |
|------|---------|
| `created_at` | текущее время ISO (например, `2026-06-04T12:34:56.789Z`) |
| `source_type` | `manual_test` |
| `platform` | `test` |
| `source_url` | `https://example.com/test-google-sheets` |
| `parsed_at` | `2026-06-04` |
| `published_at` | *(пусто)* |
| `freshness_status` | `unknown` |
| `entity_type` | `competitor` |
| `company_name` | `Test Competitor` |
| `profile_name` | `Test Profile` |
| `profile_url` | `https://example.com/profile` |
| `region` | `Москва` |
| `service_type` | `secured_auto_loan` |
| `offer_text` | `Кредит под залог автомобиля, решение за 1 день` |
| `terms` | `Тестовые условия, не реальные данные` |
| `contact_public` | *(пусто)* |
| `text_context` | `Компания предлагает кредит под залог автомобиля...` |
| `detected_need` | `Потребность в быстром займе под залог авто` |
| `competitor_strength` | `60` |
| `lead_signal_score` | `40` |
| `content_idea_score` | `70` |
| `quality_score` | `75` |
| `reason` | `Test Google Sheets row processed successfully` |
| `recommended_action` | `Use this as a baseline row format before connecting Claude API` |
| `status` | `analyzed` |

---

## Типичные ошибки

| Ошибка | Вероятная причина | Решение |
|--------|-------------------|---------|
| `The caller does not have permission` | Таблица не расшарена с сервисным аккаунтом | Открыть таблицу → Настройки доступа → Добавить email сервисного аккаунта с правом **Редактор** |
| `Unable to parse range: results!A1` или `Sheet not found` | Лист называется не `results` | Переименовать лист в Google Sheets или исправить поле Sheet в узле |
| Строка появляется, но все значения в одну колонку | Заголовки строки 1 отсутствуют или не совпадают с именами полей | Добавить заголовки в строку 1 таблицы — точно по списку из `docs/TABLE_SCHEMA.md` |
| `No credential for this node` | Credential не выбран в поле Credential узла | Открыть узел → выбрать **Google Sheets - Marketing Scout Service Account** |
| `Invalid Spreadsheet ID` | В поле Document оставлен placeholder | Заменить `PASTE_SPREADSHEET_ID_HERE` на реальный ID таблицы |
| Узел зелёный, но строка не появляется | `autoMapInputData` не нашёл совпадений с заголовками | Убедиться, что заголовки в строке 1 совпадают с именами полей JSON (регистр важен) |

---

## Как объяснить результат нетехническому клиенту

> «Мы проверили, что система умеет автоматически сохранять данные в Google Sheets.
> Система взяла информацию об одной тестовой компании, обработала её — определила тип услуги,
> поставила оценку качества 75 из 100 — и добавила строку в таблицу.
> Всё произошло автоматически, без копирования вручную.
> Следующий шаг — научить систему анализировать данные с помощью Claude AI
> вместо тестовых значений.»

---

## Следующий воркфлоу

**02 - Claude API Single Record Analysis**

Цель: заменить Code-нод с хардкоженными значениями на реальный вызов Claude API.
Входные данные те же, выходная строка — та же. Меняется только источник анализа.
Это изолирует тест Claude API от остальной части pipeline.

Гид будет в файле: `docs/N8N_WORKFLOW_02_CLAUDE_API_RU.md`
JSON будет в файле: `n8n/workflows/02_claude_api_single_record.json`
