# Руководство по тестированию Prompt v2.3 в n8n

**Дата:** 2026-06-05 (обновлено: v2.3 — KEY=VALUE line protocol)
**Цель:** Протестировать Marketing Agent Prompt v2.3 на 7 синтетических записях через
TEST HARNESS workflow — без ручного редактирования кода.
**Не изменять:** `n8n/workflows/02_claude_api_single_record_analysis.json` — только после одобрения.
**TEST HARNESS JSON:** `n8n/workflows/02_claude_api_single_record_v2_test_harness.json`
**Промпт v2.3:** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md`
**Тестовые записи:** `modules/marketing-scout-v0/TEST_RECORDS_V2.md`
**Ожидаемая стоимость:** ~$0.08–0.15 за 7 вызовов (max_tokens 1100, temperature 0.1)

---

## История изменений и причина перехода на KEY=VALUE

**v2.0:** Claude возвращал сырой JSON-текст. Тест 5 (content_idea) упал с ошибкой JSON.parse —
Claude поставил кавычки и двоеточие внутри строки `offer_text`.

**v2.1:** Добавлены JSON SAFETY RULES в промпт + многоступенчатая очистка в Parse-ноде.
Тест 5 прошёл, но Тест 1 упал с JSON.parse. Сырой JSON ненадёжен.

**v2.2:** Переход на Anthropic tool_use structured output.
Шлюз (aiprimetech.io) вернул **502 Bad Gateway** — tool_use не поддерживается или нестабилен.
Также обнаружена ошибка соединений: нода `Select Test Record` не была подключена к `Build Claude Request v2.2`
(сломанное соединение — запись никогда не доходила до Claude).

**v2.3 — архитектурное решение (DEC-026):**
Вместо JSON или tool_use используется **KEY=VALUE line protocol**:
- Claude возвращает ровно 25 строк: `field_name=value`
- Без JSON, без Markdown, без кода, без фигурных скобок.
- Parse-нода (`Parse Claude Line Response`) делит строки по `=` и собирает объект.
- Никакого `JSON.parse` на выводе Claude. Нет риска сломать парсер.
- Все соединения workflow пересобраны с нуля — цепочка исправлена.

---

## Что такое TEST HARNESS

TEST HARNESS — отдельный workflow для тестирования Prompt v2.3:
- **Промпт v2.3 уже встроен** — не нужно ничего копировать вручную.
- **Все 7 тестовых записей уже встроены** — менять только `test_id` (1–7).
- **Нода `Build Claude Request v2.3`**: нет tools, нет tool_choice; max_tokens=1100, temperature=0.1.
- **Нода `Parse Claude Line Response`**: парсит KEY=VALUE строки, добавляет `parse_method`.
- Поле `parse_method`: `line_protocol` = успех, `line_failed` = ошибка парсинга.

---

## Шаг 1 — Открыть SSH-туннель и зайти в n8n

На локальной машине:
```
ssh -L 5678:127.0.0.1:5678 root@ВАШ_IP_СЕРВЕРА
```
Открыть в браузере: `http://localhost:5678`

---

## Шаг 2 — Импортировать TEST HARNESS

1. **Если старая версия TEST HARNESS уже импортирована в n8n — удалить её.**
2. В n8n нажать **+** (New workflow) → **Import from file**.
3. Выбрать файл: `n8n/workflows/02_claude_api_single_record_v2_test_harness.json`
4. Workflow появится с именем: **"02 - Claude API Single Record Analysis v2 TEST HARNESS"**
5. Убедиться, что workflow **inactive** (переключатель выключен).
6. Убедиться в наличии ноды **`Build Claude Request v2.3`** — не v2.2 и не v2.

> Если файл не виден в файловой системе — скопировать JSON из репозитория
> и использовать **Import from clipboard**.

---

## Шаг 3 — Настроить credentials

| Нода | Credential | Тип |
|------|-----------|-----|
| Claude API Request | `Claude API - Marketing Scout` | HTTP Header Auth |
| Append Row to Google Sheets | `Google Sheets - Marketing Scout Service Account` | Google API |

Spreadsheet ID вставить в параметр **Document ID** ноды `Append Row to Google Sheets`
(заменить `PASTE_SPREADSHEET_ID_HERE` на реальный ID таблицы).

---

## Шаг 4 — Выбрать тест и запустить

1. Открыть ноду **`Set Test Selector`**
2. Изменить поле **`test_id`** (число от 1 до 7)
3. Сохранить ноду
4. Нажать **Test workflow**
5. Дождаться выполнения — 2–5 секунд

**Порядок запуска тестов v2.3:**

1. **Тест 1 первым** — сильный лид ПТС, Москва, ранее падал в v2.1.
2. **Тест 5 вторым** — content_idea (VK-пост, страх потери авто), ранее падал в v2.0.
3. **Тест 6 третьим** — SEO-мусор. Должен вернуть `status=skipped`, Quality Gate = false.
4. Если Тесты 1, 5, 6 прошли → запускать Тесты 2, 3, 4, 7.

**Стоп-условие:** Если хотя бы один тест вернул `parse_method=line_failed` — остановиться и сообщить оператору.

---

## Шаг 5 — Проверить результат

### В ноде `Parse Claude Line Response`:
- Открыть ноду → вкладка **Output**
- **Первым делом проверить `parse_method`:**
  - `line_protocol` — парсинг успешен ✓
  - `line_failed` — Claude вернул не KEY=VALUE; смотреть `raw_response_preview` ✗
- Проверить: `actual_entity_type`, `actual_recommended_action`, `test_pass_basic`, `test_notes`
- `test_pass_basic = true` — `entity_type` совпал с ожидаемым

### В ноде `Quality Gate`:
- Тесты 1, 2, 3, 4, 5, 7 — true-ветка (строка в Google Sheets)
- Тест 6 — false-ветка (строка НЕ добавляется)

### В Google Sheets:
- Открыть таблицу → лист `results`
- Проверить: `entity_type`, `recommended_action`, `quality_score`, `reason`

---

## Что проверять для каждого теста

| Тест | parse_method | entity_type | action | Дополнительно |
|------|-------------|------------|--------|--------------|
| 1 — Сильный лид | line_protocol | lead_signal | contact | `lead_signal_score≥82`, `contact_public` не пустой, `reason` цитирует "банки отказали" или "сегодня" |
| 2 — Слабый лид | line_protocol | lead_signal | ≠contact | `lead_signal_score≤50`, `region` пустой |
| 3 — Конкурент авто | line_protocol | competitor | monitor | `competitor_strength≥80`, `terms` содержит ставку |
| 4 — Конкурент RE | line_protocol | competitor | monitor | `competitor_strength` 60–85 (не 90+), `terms` пустой |
| 5 — Контент-идея | line_protocol | content_idea | create_content | `offer_text` — тема без кавычек и лейбла |
| 6 — SEO-мусор | line_protocol | irrelevant | ignore | `status=skipped`, `quality_score=1`, Quality Gate = false |
| 7 — Рефинансирование | line_protocol | lead_signal | investigate | `lead_signal_score` 40–70, `region` — МО/Подмосковье |

---

## Таблица-протокол тестирования

Заполнить после каждого запуска:

| Тест | parse_method | entity_type | action | quality | lead | status | test_pass_basic | Прошёл? |
|------|-------------|------------|--------|---------|------|--------|----------------|---------|
| 1 — Сильный лид | | | | | | | | |
| 5 — Контент-идея | | | | | | | | |
| 6 — SEO-мусор | | | | | | | | |
| 2 — Слабый лид | | | | | | | | |
| 3 — Конкурент авто | | | | | | | | |
| 4 — Конкурент RE | | | | | | | | |
| 7 — Рефинансирование | | | | | | | | |

**Стоимость:** ________ до тестов → ________ после 7 тестов → ________ за вызов

---

## Шаг 6 — Замерить стоимость API

1. Зайти в личный кабинет шлюза (aiprimetech.io) **до** первого теста — записать баланс.
2. Запустить все 7 тестов.
3. Снова проверить баланс.
4. Разделить разницу на 7 → стоимость одного вызова v2.3.
5. Сравнить с базовым v1: $0.0115 за вызов.

Ожидаемый диапазон v2.3: $0.012–0.025 за вызов (max_tokens 1100, промпт короче).

---

## Критерии одобрения Prompt v2.3

**Обязательные условия (блокеры):**

- [ ] **Тест 1** прошёл с `parse_method=line_protocol` — обязателен (ранее падал)
- [ ] **Тест 5** прошёл с `parse_method=line_protocol` — обязателен (ранее падал)
- [ ] **Тест 6** прошёл с `parse_method=line_protocol` и `status=skipped` — обязателен
- [ ] **Ноль** тестов с `parse_method=line_failed`

**Логические критерии (минимум 6 из 7):**

- [ ] Тест 1: `entity_type=lead_signal`, `recommended_action=contact`, `lead_signal_score≥82`, `reason` цитирует фразу
- [ ] Тест 2: `entity_type=lead_signal`, `recommended_action≠contact`, `lead_signal_score≤50`
- [ ] Тест 3: `entity_type=competitor`, `recommended_action=monitor`, `competitor_strength≥80`, `terms` содержит ставку
- [ ] Тест 4: `entity_type=competitor`, `competitor_strength` от 60 до 85 (не 90+), `terms` пустой
- [ ] Тест 5: `entity_type=content_idea`, `recommended_action=create_content`, `offer_text` без кавычек и лейбла
- [ ] Тест 6: `status=skipped`, `quality_score=1`, Quality Gate = false
- [ ] Тест 7: `entity_type=lead_signal`, `recommended_action=investigate`, `lead_signal_score` 40–70, `region` — МО
- [ ] Стоимость одного вызова ≤ $0.05

**Если 6 из 7 логических + все блокеры → обсудить с оператором. Если 7 из 7 → одобрять.**

---

## Что делать после тестирования

### Если промпт одобрен:

1. Сообщить оператору результаты и стоимость. Получить явное подтверждение.
2. После подтверждения:
   - Обновить `02_claude_api_single_record_analysis.json` — заменить ноду `Build Claude Request` на v2.3 структуру (KEY=VALUE, без tool_use). Также заменить Parse-ноду.
   - Обновить `docs/PROMPTS.md` — статус v2 → Active
   - Обновить `docs/AGENT_CAPABILITIES.md`
   - Добавить запись в `docs/AGENT_LOG.md`
3. Оставить TEST HARNESS JSON в репозитории как архив

### Если промпт не прошёл:

1. Записать: тест, поле, что получили, что ожидали, `parse_method`.
2. Если `line_failed`: посмотреть `raw_response_preview` — Claude вернул не KEY=VALUE.
3. Если логика плохая (entity_type, score, reason): скорректировать соответствующий раздел промпта.
4. Обновить prompt в тестовом харнессе через Python-скрипт (не редактировать JSON вручную).

### Восстановление сломанного workflow:

1. Удалить испорченную версию из n8n.
2. Повторно импортировать из Git: `n8n/workflows/02_claude_api_single_record_v2_test_harness.json`
3. Заново привязать credentials и Spreadsheet ID.

---

## Валидация JSON перед импортом

```bash
python3 -m json.tool n8n/workflows/02_claude_api_single_record_v2_test_harness.json > /tmp/v2_test_harness_validated.json
```

Если команда выполнилась без ошибок — JSON валиден и готов к импорту.

---

## Разрешения и безопасность

- Этот тест вызывает реальный Claude API → стоимость ~$0.08–0.15 (~6–11 руб.)
- Синтетический тест одобрён (DEC-021): тестовые вызовы входят в бюджет
- Реальные данные не передаются — только синтетические записи из `TEST_RECORDS_V2.md`
- Не вносить изменения в Workflow 00, 01, 02 во время тестирования
- TEST HARNESS workflow должен оставаться **inactive** — не активировать
