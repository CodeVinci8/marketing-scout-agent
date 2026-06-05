# Руководство по тестированию Workflow 02 v2

**Дата:** 2026-06-05 (финальный план: extended tests 8–12)
**Не изменять:** `n8n/workflows/02_claude_api_single_record_analysis.json` — только после одобрения.

---

## Текущий статус

**Baseline raw JSON (d350069) — рабочий.**

| Тест | Статус | Результат |
|------|--------|-----------|
| Тест 1 | ✓ Прошёл | entity_type=lead_signal, action=contact, quality=97, lead_signal=98 |
| Тест 5b (короткий) | Ожидает | `02_claude_api_single_record_v2_baseline_short_test5.json` готов |
| Тесты 2–4, 6–7 | Не запускались | Заменены расширенными тестами 8–12 |

**v2.1–v2.5 эксперименты — отложены.**
Gateway возвращает 502 на любой нестандартный формат (tool_use, KEY=VALUE).
Baseline сырой JSON остаётся единственным рабочим подходом.

**content_idea — отложено.**
Не включается в расширенные тесты. Деферировано в Stage 3 (Content Agent). См. DEC-030.

---

## Три активных харнеса

| Файл | Назначение | Статус |
|------|-----------|--------|
| `02_claude_api_single_record_v2_baseline_short_test5.json` | Тест 5 с коротким text_context | Ожидает запуска |
| `02_claude_api_single_record_v2_extended_tests.json` | Тесты 8–12 по бизнес-приоритетам | Готов к запуску |
| `02_claude_api_single_record_v2_test_harness.json` | v2.5 MICRO архив (502) | Архив |

---

## Порядок действий

### Этап A — Test 5 (short)

1. Импортировать `02_claude_api_single_record_v2_baseline_short_test5.json`
2. Установить `test_id = 5`
3. Запустить. Проверить: нет `JSON parse failed`, `entity_type=content_idea`, `action=create_content`
4. Записать результат в `docs/WORKFLOW_02_V2_TEST_RESULTS.md`

### Этап B — Расширенные тесты 8–12

1. Импортировать `02_claude_api_single_record_v2_extended_tests.json`
2. Записать баланс aiprimetech.io **до** тестов
3. Запускать по порядку: 8 → 9 → 10 → 11 → 12 (каждый раз менять test_id)
4. Для каждого теста записывать в `docs/WORKFLOW_02_V2_TEST_RESULTS.md`:
   - entity_type, action, quality_score, lead_signal_score, competitor_strength, status
   - Прошёл Quality Gate или нет
   - Записан ли ряд в Google Sheets
5. Записать баланс **после** и вычислить стоимость

### Этап C — Закрытие этапа

После 5 тестов:
- Итог: сколько из 5 прошло (цель: минимум 4 из 5)
- Обязательные: Тест 8 (hot lead), Тест 12 (region cap)
- Обсуждение с оператором → одобрение → переход к первому реальному источнику

---

## Шаги для Этапа B

### Шаг 1 — SSH-туннель

```
ssh -L 5678:127.0.0.1:5678 root@ВАШ_IP_СЕРВЕРА
```

### Шаг 2 — Импорт

n8n → **+** → **Import from file** → `02_claude_api_single_record_v2_extended_tests.json`

Убедиться:
- Нода `Build Claude Request v2` (не v2.5 MICRO)
- Нода `Parse Claude JSON Response` (не Line Response)
- Workflow **inactive**

### Шаг 3 — Credentials и Spreadsheet ID

| Нода | Credential |
|------|-----------|
| Claude API Request | `Claude API - Marketing Scout` |
| Append Row to Google Sheets | `Google Sheets - Marketing Scout Service Account` |

Вставить реальный Spreadsheet ID в ноду `Append Row to Google Sheets`.

### Шаг 4 — Запускать по одному

Для каждого теста: изменить `test_id` в ноде `Set Test Selector` → запустить → записать результат.

---

## Что проверять для каждого теста

| test_id | entity_type | action | Ключевые проверки |
|---------|-------------|--------|------------------|
| 8 (Telegram) | lead_signal | contact | lead_signal_score≥80, contact_public=@ivan_tg_test, Quality Gate=PASS |
| 9 (Instagram) | competitor | monitor | competitor_strength≥65, terms содержит "2%", Quality Gate=PASS |
| 10 (Avito рефинанс.) | lead_signal | investigate | action≠contact, lead_signal 50–70 |
| 11 (Website слабый) | competitor | monitor | competitor_strength≤65, terms="" |
| 12 (СПб) | lead_signal/irrelevant | investigate/ignore | lead_signal≤40, Quality Gate=FAIL |

---

## Критерии одобрения Workflow 02 v2 (закрытие этапа)

**Обязательные блокеры:**
- [ ] Ни одного `JSON parse failed`
- [ ] Тест 8: lead_signal_score ≥ 80, action = contact
- [ ] Тест 12: lead_signal_score ≤ 40 (регион не Москва — не должен попасть в контакт)

**Логические критерии (минимум 4 из 5):**
- [ ] Тест 8: entity_type=lead_signal, action=contact ✓
- [ ] Тест 9: entity_type=competitor, action=monitor ✓
- [ ] Тест 10: action=investigate (не contact) ✓
- [ ] Тест 11: competitor_strength≤65 ✓
- [ ] Тест 12: lead_signal_score≤40 ✓
- [ ] Стоимость одного вызова ≤ $0.05 ✓

---

## Валидация JSON

```bash
python3 -m json.tool n8n/workflows/02_claude_api_single_record_v2_extended_tests.json > /tmp/v2_extended_tests_validated.json
```

---

## Безопасность

- Реальные данные не передаются — только синтетические записи.
- Все TEST HARNESS должны оставаться **inactive**.
- Не изменять Workflow 00, 01, 02 во время тестирования.
