# Руководство по тестированию Prompt v2.4 в n8n

**Дата:** 2026-06-05 (обновлено: v2.4 — compact KEY=VALUE)
**Цель:** Протестировать Marketing Agent Prompt v2.4 на 7 синтетических записях через
TEST HARNESS workflow — без ручного редактирования кода.
**Не изменять:** `n8n/workflows/02_claude_api_single_record_analysis.json` — только после одобрения.
**TEST HARNESS JSON:** `n8n/workflows/02_claude_api_single_record_v2_test_harness.json`
**Промпт v2.4:** `modules/marketing-scout-v0/MARKETING_AGENT_PROMPT_V2.md`
**Тестовые записи:** `modules/marketing-scout-v0/TEST_RECORDS_V2.md`
**Ожидаемая стоимость:** ~$0.04–0.10 за 7 вызовов (max_tokens 700, compact prompt)

---

## История изменений — почему каждая версия не прошла

| Версия | Проблема | Причина |
|--------|----------|---------|
| v2.0 | JSON.parse упал на Тесте 5 | Claude поставил кавычки/двоеточие в `offer_text` |
| v2.1 | JSON.parse упал на Тесте 1 | Claude нарушил форматирование в `reason`/`detected_need` |
| v2.2 | 502 Bad Gateway на всех тестах | Шлюз не поддерживает `tools`/`tool_choice`. Также: сломанное соединение (Select Test Record не подключён к Build ноде) |
| v2.3 | 502 Bad Gateway на Тесте 1 | Промпт слишком большой (9.2 KB) или запрос слишком тяжёлый для шлюза |

**Подтверждено:** минимальный curl к шлюзу с маленьким промптом работает нормально.
Значит шлюз живой, ключ верный, модель доступна.
502 в v2.3 — это проблема размера/тяжести запроса, не сети.

**v2.4 — compact patch (DEC-027):**
- Промпт сокращён с 9.2 KB до **5.3 KB** (та же бизнес-логика, компактный формат).
- `max_tokens`: 1100 → **700**.
- Лимиты символов ужесточены: offer_text 140, detected_need 160, text_context 220, reason 220.
- Протокол KEY=VALUE и parse-нода — **без изменений** от v2.3.
- Все соединения workflow пересобраны с нуля.

**Если 502 повторится с v2.4 compact** — проблема не в размере промпта.
Нужно проверить: баланс шлюза, лимиты на модель, статус шлюза.

---

## Что такое TEST HARNESS

- **Промпт v2.4 встроен** — не нужно копировать вручную.
- **Все 7 записей встроены** — менять только `test_id` (1–7).
- **Нода `Build Claude Request v2.4`**: нет tools, нет tool_choice; max_tokens=700, temperature=0.1.
- **Нода `Parse Claude Line Response`**: KEY=VALUE парсер, `parse_method=line_protocol` или `line_failed`.

---

## Шаг 1 — SSH-туннель

```
ssh -L 5678:127.0.0.1:5678 root@ВАШ_IP_СЕРВЕРА
```
Открыть: `http://localhost:5678`

---

## Шаг 2 — Импортировать TEST HARNESS

1. **Удалить старую версию TEST HARNESS из n8n** (если есть — любая версия v2.x).
2. В n8n: **+** → **Import from file** → выбрать `n8n/workflows/02_claude_api_single_record_v2_test_harness.json`
3. Убедиться: нода называется **`Build Claude Request v2.4`** (не v2.3, не v2.2, не v2).
4. Workflow должен быть **inactive**.

---

## Шаг 3 — Credentials и Spreadsheet ID

| Нода | Credential |
|------|-----------|
| Claude API Request | `Claude API - Marketing Scout` (HTTP Header Auth) |
| Append Row to Google Sheets | `Google Sheets - Marketing Scout Service Account` |

Вставить реальный Spreadsheet ID в ноду `Append Row to Google Sheets` (заменить `PASTE_SPREADSHEET_ID_HERE`).

---

## Шаг 4 — Порядок запуска тестов

**Обязательный порядок для v2.4:**

1. **Тест 1 первым** — ранее падал в v2.1 (JSON.parse) и v2.3 (502). Ключевой индикатор: если 502 повторится, проблема не в промпте.
2. **Тест 5 вторым** — ранее падал в v2.0/v2.1 (content_idea, сложные строки).
3. **Тест 6 третьим** — SEO-мусор, должен вернуть `status=skipped`, Quality Gate = false.
4. Если Тесты 1, 5, 6 прошли → запускать Тесты 2, 3, 4, 7.

**Стоп-условия:**
- Если Тест 1 вернул 502 — остановиться. Проблема на уровне шлюза. Не запускать остальные.
- Если `parse_method=line_failed` — смотреть `raw_response_preview`. Claude не вернул KEY=VALUE.

**Как проверить 502:** В n8n Тест 1 покажет красную ноду на `Claude API Request`.
Открыть ноду → вкладка Output → смотреть `statusCode` и `message`.

---

## Шаг 5 — Что проверять

### Нода `Parse Claude Line Response` (вкладка Output):
- `parse_method=line_protocol` — успех ✓
- `parse_method=line_failed` — Claude вернул не KEY=VALUE ✗
- `test_pass_basic=true` — entity_type совпал с ожидаемым

### Quality Gate:
- Тесты 1, 2, 3, 4, 5, 7 → true-ветка (строка в Google Sheets)
- Тест 6 → false-ветка (строка НЕ добавляется)

---

## Что проверять для каждого теста

| Тест | parse_method | entity_type | action | Дополнительно |
|------|-------------|------------|--------|--------------|
| 1 — Сильный лид | line_protocol | lead_signal | contact | `lead_signal_score≥82`, `contact_public` не пустой |
| 2 — Слабый лид | line_protocol | lead_signal | ≠contact | `lead_signal_score≤50`, `region` пустой |
| 3 — Конкурент авто | line_protocol | competitor | monitor | `competitor_strength≥80`, `terms` содержит ставку |
| 4 — Конкурент RE | line_protocol | competitor | monitor | `competitor_strength` 60–85, `terms` пустой |
| 5 — Контент-идея | line_protocol | content_idea | create_content | `offer_text` без кавычек и лейбла |
| 6 — SEO-мусор | line_protocol | irrelevant | ignore | `status=skipped`, `quality_score=1`, Quality Gate = false |
| 7 — Рефинансирование | line_protocol | lead_signal | investigate | `lead_signal_score` 40–70, `region` — МО |

---

## Таблица-протокол

| Тест | 502? | parse_method | entity_type | action | quality | status | test_pass_basic | Прошёл? |
|------|------|-------------|------------|--------|---------|--------|----------------|---------|
| 1 — Сильный лид | | | | | | | | |
| 5 — Контент-идея | | | | | | | | |
| 6 — SEO-мусор | | | | | | | | |
| 2 — Слабый лид | | | | | | | | |
| 3 — Конкурент авто | | | | | | | | |
| 4 — Конкурент RE | | | | | | | | |
| 7 — Рефинансирование | | | | | | | | |

**Стоимость:** ________ до → ________ после 7 тестов → ________ за вызов

---

## Шаг 6 — Замерить стоимость

1. Записать баланс на aiprimetech.io **до** первого теста.
2. Запустить все 7 тестов.
3. Записать баланс после.
4. Разделить разницу на 7.

Ожидаемый диапазон v2.4: $0.006–0.015 за вызов (compact prompt, max_tokens 700).

---

## Критерии одобрения Prompt v2.4

**Блокеры (все обязательны):**

- [ ] Тест 1 прошёл без 502 и с `parse_method=line_protocol`
- [ ] Тест 5 прошёл с `parse_method=line_protocol`
- [ ] Тест 6 прошёл с `parse_method=line_protocol` и `status=skipped`
- [ ] Ноль тестов с `parse_method=line_failed`
- [ ] Ноль 502 ответов

**Логические критерии (минимум 6 из 7):**

- [ ] Тест 1: `entity_type=lead_signal`, `recommended_action=contact`, `lead_signal_score≥82`
- [ ] Тест 2: `entity_type=lead_signal`, `recommended_action≠contact`, `lead_signal_score≤50`
- [ ] Тест 3: `entity_type=competitor`, `recommended_action=monitor`, `competitor_strength≥80`, `terms` содержит ставку
- [ ] Тест 4: `entity_type=competitor`, `competitor_strength` 60–85, `terms` пустой
- [ ] Тест 5: `entity_type=content_idea`, `recommended_action=create_content`, `offer_text` без лейбла
- [ ] Тест 6: `status=skipped`, `quality_score=1`, Quality Gate = false
- [ ] Тест 7: `entity_type=lead_signal`, `recommended_action=investigate`, `lead_signal_score` 40–70
- [ ] Стоимость одного вызова ≤ $0.05

**6 из 7 логических + все блокеры → обсудить. 7 из 7 → одобрять.**

---

## Диагностика 502

Если 502 повторяется с v2.4 compact prompt:

1. Проверить баланс шлюза (aiprimetech.io) — 402 маскируется как 502.
2. Сделать минимальный curl вручную прямо с VPS (не через n8n):
   ```bash
   curl -s https://aiprimetech.io/v1/messages \
     -H "Authorization: Bearer ВАШ_ТОКЕН" \
     -H "anthropic-version: 2023-06-01" \
     -H "Content-Type: application/json" \
     -d '{"model":"claude-sonnet-4-6","max_tokens":50,"messages":[{"role":"user","content":"Say OK"}]}'
   ```
3. Если curl OK, но n8n даёт 502 — проблема в конфигурации HTTP Request ноды.
4. Сравнить заголовки n8n запроса с curl запросом (n8n → ноды → Claude API Request → вкладка Input).

---

## Что делать после одобрения

1. Получить явное подтверждение оператора.
2. Обновить `02_claude_api_single_record_analysis.json`:
   - Заменить Build ноду на v2.4 структуру (compact prompt, max_tokens=700, KEY=VALUE).
   - Добавить Parse ноду `Parse Claude Line Response`.
3. Обновить `docs/PROMPTS.md` — статус v2 → Active.
4. Оставить TEST HARNESS JSON в репозитории как архив.

---

## Валидация JSON

```bash
python3 -m json.tool n8n/workflows/02_claude_api_single_record_v2_test_harness.json > /tmp/v2_test_harness_validated.json
```

---

## Безопасность

- Реальные данные не передаются — только синтетические записи из `TEST_RECORDS_V2.md`.
- TEST HARNESS должен оставаться **inactive**.
- Не изменять Workflow 00, 01, 02 во время тестирования.
