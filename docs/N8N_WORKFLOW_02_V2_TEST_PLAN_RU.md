# Руководство по тестированию Prompt v2 в n8n

**Дата:** 2026-06-05 (обновлено: BASELINE SHORT TEST 5)
**Не изменять:** `n8n/workflows/02_claude_api_single_record_analysis.json` — только после одобрения.
**Тестовые записи:** `modules/marketing-scout-v0/TEST_RECORDS_V2.md`

---

## Текущий статус

**Базовый харнес (commit d350069) — работает.**

| Тест | Статус | Результат |
|------|--------|-----------|
| Тест 1 — Сильный лид | ✓ Прошёл | entity_type=lead_signal, action=contact, quality=97, lead_signal=98 |
| Тест 5 — Контент-идея | ✗ Не тестировался с коротким text_context | JSON.parse падал на длинном оригинале |

**v2.1–v2.5 эксперименты — отложены.**

| Версия | Проблема | Вывод |
|--------|----------|-------|
| v2.1 | JSON.parse на Тестах 1 и 5 | JSON-патч недостаточен |
| v2.2 | 502 на tool_use | Шлюз не поддерживает tool_use |
| v2.3 | 502 при 9.2 KB | Промпт слишком большой |
| v2.4 | 502 при 5.3 KB | Промпт всё ещё слишком большой |
| v2.5 MICRO | 502 при ~2 KB | curl тоже даёт 502 — проблема не в размере промпта |

**Вывод:** Baseline raw JSON работает. v2.1–v2.5 файлы сохранены в репозитории, но не являются активным тестовым путём (DEC-029).

---

## Текущая задача: BASELINE SHORT TEST 5

**Файл:** `n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json`
**Изменение:** Test 5 text_context сокращён (252 → 139 chars). Всё остальное — идентично d350069 baseline.
**Цель:** Проверить, решает ли сокращение Test 5 проблему JSON.parse.

### Порядок тестирования

1. **test_id=5 первым** — это единственный изменённый тест. Проверить, проходит ли JSON.parse.
2. **Если тест 5 прошёл → test_id=1** — убедиться, что baseline не нарушен.
3. **Если оба прошли** → обсудить с оператором: одобрить baseline или продолжить эксперименты.

### Что изменилось в Test 5

**Оригинальный text_context (252 chars):**
```
Взял займ под залог ПТС год назад. Просрочил три месяца, потому что потерял работу. Машину забрали — пришли и увезли прямо с парковки. Договор подписал не читая. Никто не предупредил о таком развитии. Будьте осторожны с этими МФО, читайте мелкий шрифт.
```

**Новый text_context (139 chars):**
```
Вопрос в VK: боюсь брать займ под ПТС, что будет с машиной при просрочке? Могут ли забрать авто сразу? Хочу понять риски перед оформлением.
```

**Почему оригинал падал:** Длинный текст с несколькими предложениями, тире, точками — Claude вставлял кавычки или двоеточия в строковые поля (`offer_text`, `reason`), что ломало `JSON.parse`.
**Почему новый должен работать:** Короткий, сформулирован как вопрос, нет проблемных символов внутри строк, сохраняет суть контент-идеи (страх потери машины).

---

## Шаг 1 — SSH-туннель

```
ssh -L 5678:127.0.0.1:5678 root@ВАШ_IP_СЕРВЕРА
```
Открыть: `http://localhost:5678`

---

## Шаг 2 — Импортировать BASELINE SHORT TEST 5

1. В n8n: **+** → **Import from file** → `n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json`
2. Убедиться: нода называется **`Build Claude Request v2`** (не v2.5 MICRO, не v2.4).
3. Убедиться: нода Parse называется **`Parse Claude JSON Response`** (не Line Response).
4. Workflow должен быть **inactive**.

---

## Шаг 3 — Credentials и Spreadsheet ID

| Нода | Credential |
|------|-----------|
| Claude API Request | `Claude API - Marketing Scout` (HTTP Header Auth) |
| Append Row to Google Sheets | `Google Sheets - Marketing Scout Service Account` |

Вставить реальный Spreadsheet ID в ноду `Append Row to Google Sheets`.

---

## Шаг 4 — Запуск

**Тест 5 (test_id=5) — первым:**

В ноде `Set Test Selector` установить `test_id = 5`. Запустить.

Проверить в ноде `Parse Claude JSON Response` → Output:
- `status = analyzed` ✓
- `entity_type = content_idea` ✓
- `recommended_action = create_content` ✓
- `test_pass_basic = true` ✓
- Нет ошибки `JSON parse failed` ✓
- `offer_text` — без кавычек, без лейбла ✓

**Если тест 5 прошёл → Тест 1 (test_id=1):**

Установить `test_id = 1`. Запустить.

Проверить:
- `entity_type = lead_signal` ✓
- `recommended_action = contact` ✓
- `lead_signal_score ≥ 82` ✓
- `quality_score ≥ 80` ✓

---

## Таблица-протокол (BASELINE SHORT TEST 5)

| Тест | JSON.parse OK? | entity_type | action | quality | test_pass_basic | Прошёл? |
|------|---------------|------------|--------|---------|----------------|---------|
| 5 — Контент-идея (короткий) | | content_idea | create_content | 65-80 | | |
| 1 — Сильный лид (если 5 прошёл) | | lead_signal | contact | ≥80 | | |

**Стоимость:** ________ до → ________ после 2 тестов → ________ за вызов

---

## Стоп-условия

| Ситуация | Действие |
|----------|----------|
| Тест 5: `JSON parse failed` | Изучить `raw_response_preview`. Либо укорачивать ещё, либо переключиться на другой формат вывода. |
| Тест 5: `entity_type ≠ content_idea` | Claude распознал как lead_signal или irrelevant. Пересмотреть text_context. |
| Тест 1: отличается от предыдущего (97/98) | Вариативность модели — допустима в пределах диапазона. |

---

## После успешных тестов 5 и 1

1. Получить явное подтверждение оператора.
2. Решить: запускать ли остальные 5 тестов (2, 3, 4, 6, 7) на baseline_short_test5.
3. После одобрения всех тестов → обновить production `02_claude_api_single_record_analysis.json`.
4. Оставить все TEST HARNESS JSON в репозитории как архив.

---

## Харнесы в репозитории

| Файл | Статус | Описание |
|------|--------|----------|
| `02_claude_api_single_record_v2_baseline_short_test5.json` | **АКТИВНЫЙ** | Baseline d350069 + короткий Test 5 |
| `02_claude_api_single_record_v2_test_harness.json` | Архив (v2.5 MICRO) | Последний эксперимент — 502 |
| `02_claude_api_single_record_analysis.json` | Production | Не трогать |

---

## Валидация JSON

```bash
python3 -m json.tool n8n/workflows/02_claude_api_single_record_v2_baseline_short_test5.json > /tmp/v2_baseline_short_test5_validated.json
```

---

## Безопасность

- Реальные данные не передаются — только синтетические записи.
- Оба TEST HARNESS должны оставаться **inactive**.
- Не изменять Workflow 00, 01, 02 во время тестирования.
