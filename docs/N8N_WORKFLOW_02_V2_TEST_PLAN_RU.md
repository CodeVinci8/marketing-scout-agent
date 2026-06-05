# Руководство по тестированию Prompt v2 в n8n

**Дата:** 2026-06-05
**Цель:** Протестировать Marketing Agent Prompt v2 на 7 синтетических записях через
готовый TEST HARNESS workflow — без ручного редактирования кода.
**Не изменять:** `n8n/workflows/02_claude_api_single_record_analysis.json` — только после одобрения.
**TEST HARNESS JSON:** `n8n/workflows/02_claude_api_single_record_v2_test_harness.json`
**Промпт v2:** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md`
**Тестовые записи:** `modules/marketing-scout-v0/TEST_RECORDS_V2.md`
**Ожидаемая стоимость:** ~$0.10–0.20 за 7 вызовов (≈ 7–15 руб.)

---

## Что такое TEST HARNESS

TEST HARNESS — отдельный workflow, специально созданный для тестирования Prompt v2.
Он содержит:
- **Промпт v2 уже встроен** — не нужно ничего копировать вручную.
- **Все 7 тестовых записей уже встроены** — не нужно редактировать поля вручную.
- **Один параметр для смены теста:** поле `test_id` в ноде `Set Test Selector` (число от 1 до 7).
- **Поля сравнения** — после Claude возвращает ответ, Parse-нода добавляет:
  `expected_entity_type`, `actual_entity_type`, `test_pass_basic`, `test_notes` и т.д.

Старый Workflow 02 (`02_claude_api_single_record_analysis.json`) не трогается до одобрения v2.

---

## Шаг 1 — Открыть SSH-туннель и зайти в n8n

На локальной машине:
```
ssh -L 5678:127.0.0.1:5678 root@ВАШ_IP_СЕРВЕРА
```
Открыть в браузере: `http://localhost:5678`

---

## Шаг 2 — Импортировать TEST HARNESS

1. В n8n нажать **+** (New workflow) или **Import from file**.
2. Выбрать файл: `n8n/workflows/02_claude_api_single_record_v2_test_harness.json`
   (скопировать через GitHub или напрямую с сервера)
3. Workflow появится с именем: **"02 - Claude API Single Record Analysis v2 TEST HARNESS"**
4. Убедиться, что workflow **inactive** (переключатель выключен — это важно)

> Если файл не виден в файловой системе n8n — скопировать JSON содержимое из репозитория
> и использовать **Import from clipboard** (кнопка в меню workflow).

---

## Шаг 3 — Настроить credentials в импортированном workflow

После импорта n8n может показать предупреждение о credentials. Нужно привязать:

| Нода | Credential | Тип |
|------|-----------|-----|
| Claude API Request | `Claude API - Marketing Scout` | HTTP Header Auth |
| Append Row to Google Sheets | `Google Sheets - Marketing Scout Service Account` | Google API |

Для каждой ноды: открыть → найти поле Credential → выбрать из уже сохранённых в n8n.
Spreadsheet ID вставить в параметр **Document ID** ноды `Append Row to Google Sheets`
(заменить `PASTE_SPREADSHEET_ID_HERE` на реальный ID таблицы).

---

## Шаг 4 — Выбрать тест и запустить

1. Открыть ноду **`Set Test Selector`**
2. Изменить значение поля **`test_id`** с 1 до нужного числа (1–7)
3. Сохранить ноду (Save)
4. Нажать **Test workflow** (кнопка вверху)
5. Дождаться выполнения — 2–5 секунд

**Тест 6 (SEO boilerplate)** — Quality Gate закроет эту запись (false-ветка). Это правильное поведение.
Все остальные тесты должны проходить Quality Gate (true-ветка) и добавлять строку в Google Sheets.

---

## Шаг 5 — Проверить результат

### В ноде `Parse Claude JSON Response`:
- Открыть ноду → вкладка **Output**
- Проверить наличие полей: `actual_entity_type`, `actual_recommended_action`, `test_pass_basic`, `test_notes`
- `test_pass_basic = true` означает, что `entity_type` совпал с ожидаемым

### В ноде `Quality Gate`:
- Если запись прошла — данные ушли в Google Sheets (true-ветка)
- Если нет — false-ветка завершилась (для теста 6 это правильно)

### В Google Sheets:
- Открыть таблицу "Marketing Scout Results", лист `results`
- Проверить добавленную строку
- Посмотреть поля: `entity_type`, `recommended_action`, `quality_score`, `reason`

---

## Что проверять для каждого теста

| Тест | Что проверить |
|------|--------------|
| 1 — Сильный лид | `entity_type=lead_signal`, `recommended_action=contact`, `lead_signal_score≥82`, `contact_public` не пустой, `reason` цитирует "банки отказали" или "сегодня" |
| 2 — Слабый лид | `entity_type=lead_signal`, `recommended_action≠contact`, `lead_signal_score≤50`, `region` пустой |
| 3 — Конкурент авто | `entity_type=competitor`, `recommended_action=monitor`, `competitor_strength≥80`, `terms` содержит ставку |
| 4 — Конкурент RE | `entity_type=competitor`, `competitor_strength` 60–85 (не 90+), `terms` пустой (ставка не указана) |
| 5 — Контент-идея | `entity_type=content_idea`, `recommended_action=create_content`, `offer_text` — предложенный заголовок статьи |
| 6 — SEO-мусор | `status=skipped`, `quality_score=1`, Quality Gate = false, строка НЕ добавляется в Sheets |
| 7 — Рефинансирование | `entity_type=lead_signal`, `recommended_action=investigate`, `lead_signal_score` 40–70, `region` — МО/Подмосковье |

---

## Таблица-протокол тестирования

Заполнить после каждого запуска:

| Тест | entity_type | action | quality | lead | comp | content | status | test_pass_basic | reason цитирует? | Прошёл? |
|------|------------|--------|---------|------|------|---------|--------|----------------|-----------------|---------|
| 1 — Сильный лид | | | | | | | | | | |
| 2 — Слабый лид | | | | | | | | | | |
| 3 — Конкурент авто | | | | | | | | | | |
| 4 — Конкурент RE | | | | | | | | | | |
| 5 — Контент-идея | | | | | | | | | | |
| 6 — SEO-мусор | | | | | | | | | | |
| 7 — Рефинансирование | | | | | | | | | | |

**Стоимость:** ________ до тестов → ________ после 7 тестов → ________ за вызов

---

## Шаг 6 — Замерить стоимость API

1. Зайти в личный кабинет шлюза (aiprimetech.io) **до** запуска первого теста
2. Записать баланс
3. Запустить все 7 тестов
4. Снова проверить баланс
5. Разделить разницу на 7 → стоимость одного вызова v2
6. Сравнить с базовым v1: $0.0115 за вызов

Ожидаемый диапазон v2: $0.018–0.030 за вызов (промпт длиннее, ~1400 токенов вывода).

---

## Критерии одобрения Prompt v2

Все критерии должны быть выполнены:

- [ ] Тест 1: `recommended_action = contact`, `lead_signal_score ≥ 82`, `reason` цитирует конкретную фразу
- [ ] Тест 2: `recommended_action ≠ contact`, `lead_signal_score ≤ 50`
- [ ] Тест 3: `recommended_action = monitor`, `competitor_strength ≥ 80`, `terms` содержит ставку
- [ ] Тест 4: `competitor_strength` от 60 до 85 (не 90+), `terms` пустой
- [ ] Тест 5: `recommended_action = create_content`, `offer_text` — заголовок/тема (не описание поста)
- [ ] Тест 6: `status = skipped`, `quality_score = 1`, все остальные оценки = 1
- [ ] Тест 7: `recommended_action = investigate`, `lead_signal_score` 40–70, `region` — МО или Подмосковье, не Москва
- [ ] Все 7 вызовов вернули валидный JSON без ошибок парсинга
- [ ] Ни один ответ не содержит markdown-обрамления (``` )
- [ ] Стоимость одного вызова не превышает $0.05

**Если 6 из 7 тестов прошли → допустимо обсудить с оператором. Если все 7 → одобрять.**

---

## Что делать после тестирования

### Если промпт одобрен:

1. Сообщить оператору результаты и стоимость. Получить явное подтверждение.
2. После подтверждения:
   - Обновить `02_claude_api_single_record_analysis.json` — нода `Build Claude Request` (заменить промпт)
   - Обновить `docs/PROMPTS.md` — статус v2 → Active
   - Обновить `docs/AGENT_CAPABILITIES.md`
   - Добавить запись в `docs/AGENT_LOG.md`
3. Удалить TEST HARNESS workflow из n8n (он больше не нужен)
4. Оставить JSON-файл в репозитории как архив

### Если промпт не прошёл:

1. Записать: какой тест, какое поле, что получили, что ожидали
2. Определить раздел промпта, который нужно скорректировать
3. Внести правки в `MARKETING_AGENT_PROMPT_V2.md`
4. Regenerate TEST HARNESS JSON через `agent` (Python-скрипт)
5. Повторить только проблемные тесты

### Восстановление сломанного workflow в n8n:

Если n8n workflow случайно испорчен через UI:
1. Удалить испорченную версию из n8n
2. Повторно импортировать из Git-репозитория: `n8n/workflows/02_claude_api_single_record_v2_test_harness.json`
3. Заново привязать credentials и Spreadsheet ID
4. Исходный файл в репозитории всегда остаётся эталоном

---

## Валидация JSON перед импортом

```bash
python3 -m json.tool n8n/workflows/02_claude_api_single_record_v2_test_harness.json > /tmp/v2_test_harness_validated.json
```

Если команда выполнилась без ошибок — JSON валиден и готов к импорту.

---

## Разрешения и безопасность

- Этот тест вызывает реальный Claude API → стоимость ~$0.10–0.20 (~7–15 руб.)
- Синтетический тест одобрён (DEC-021): тестовые вызовы входят в бюджет
- Реальные данные не передаются — только синтетические записи из `TEST_RECORDS_V2.md`
- Не вносить изменения в Workflow 00, 01, 02 во время тестирования
- TEST HARNESS workflow должен оставаться **inactive** — не активировать
