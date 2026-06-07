# Workflow 06 — Approved Candidates Runner (RU)

**Файл:** `n8n/workflows/06_approved_candidates_runner.json`
**Имя в n8n:** `06 - Approved Candidates Runner`
**Статус:** 🔧 BUILT, `active=false` — мост одобрение → обработка (Stage 2.2c, DEC-064). НЕ активировать.

---

## 1. Назначение

Workflow 06 — **мост между обнаружением и потребителем URL**. Он берёт **одобренные** кандидатов из вкладки
`url_candidates` (их туда кладёт Workflow 05) и готовит управляемый батч (максимум 5 URL) для Workflow 04 —
существующего потребителя URL. Он **не дублирует** логику обнаружения и **не анализирует** сайты сам.

Чего Workflow 06 **не делает** (архитектурное правило):
- не вызывает Apify и не ищет новые URL;
- не вызывает Firecrawl/Claude напрямую — анализ только через Workflow 04;
- не пишет в бизнес-вкладки (`results`, `monitor_queue`, …) напрямую;
- не авто-одобряет, не обрабатывает дубли, не использует расписание, не Telegram.

---

## 2. Как это встроено в поток

```
Workflow 05 (Apify discovery)
        │  пишет url_candidates (approval_status=new)
        ▼
   url_candidates
        │  ОПЕРАТОР вручную: approval_status=approved
        ▼
Workflow 06 (Approved Candidates Runner)   ← вы здесь
        │  фильтр + приоритет + отсечка ≤5 → Execution Summary + готовый блок URL
        ▼
Workflow 04 (Firecrawl URL List → Resilient Analyzer)   ← ручная вставка URL (v0.1)
        │
        ▼
   monitor_queue  (+ строка в url_registry)
```

**v0.1 = ручная передача (manual handoff).** Workflow 06 **не вызывает** Workflow 04 как подворкфлоу:
у Workflow 04 ручной триггер и фиксированный узел `Set URL List`, превращение его в callable subworkflow —
рискованный рефактор триггера/входа, отложен (DEC-064). Workflow 06 готовит чистый список ≤5 URL и
готовый блок для вставки в `Set URL List`.

---

## 3. Узлы

| Узел | Тип | Что делает |
|------|-----|------------|
| Manual Start | manualTrigger | Ручной запуск |
| Read url_candidates | googleSheets (read) | Читает всю вкладку `url_candidates` |
| Select, Prioritize & Annotate | code | Единый источник правды: фильтр + приоритет + отсечка ≤5 + аннотация каждой строки (`_selected`, `_skip_reason`) |
| IF Selected? | if | Пропускает дальше только выбранные строки |
| Mark Candidates Processed (DISABLED) | googleSheets (update) | **Выключен по умолчанию.** При включении ставит `approval_status=processed` и дописывает в `notes` `Processed by Workflow 06 run_id=…` |
| Build Execution Summary & Handoff | code | Один итог на прогон: счётчики, выбранные URL, причины пропуска, готовый блок для `Set URL List` |

---

## 4. Логика отбора

**Строка попадает в обработку только если выполнены ВСЕ условия:**
- `approval_status = approved`
- `dedup_status = unique`
- `registry_status = not_in_registry`
- `candidate_url` не пуст
- `candidate_type` НЕ из `aggregator / directory / marketplace / social / media_article` —
  **если только** оператор явно не разрешил, добавив `aggregator_approved` в `notes` этой строки.

**Приоритет (сортировка выбранных):** сначала `direct_competitor`, затем выше `confidence_score`, затем ниже `rank`.

**Жёсткая отсечка:** максимум **5** кандидатов за прогон. Подходящие строки сверх 5 помечаются как пропущенные
с причиной `over_max_5_limit` (их можно одобрить в следующем прогоне).

---

## 5. Настройка (после импорта)

1. **НЕ активировать** workflow (`active=false`).
2. Вкладки уже есть: `url_candidates` (26 колонок), `url_registry` (10 колонок). **Новых вкладок не требуется.**
3. Перепривязать креденшл (ID локальны, в файле плейсхолдеры):
   - `Read url_candidates` → **Google Sheets - Marketing Scout Service Account**
   - `Mark Candidates Processed (DISABLED)` → тот же креденшл
4. На обоих Google Sheets нодах вставить **реальный Spreadsheet ID** (заменить `PASTE_SPREADSHEET_ID_HERE`).
5. Внешних API-ключей здесь **нет** (нет Apify/Firecrawl/Claude). Если используется Execute Workflow в будущем —
   дополнительных внешних креденшлов Workflow 06 не требует.

---

## 6. Креденшлы

| Узел | Креденшл | Примечание |
|------|----------|------------|
| Read url_candidates | Google Sheets - Marketing Scout Service Account | чтение |
| Mark Candidates Processed (DISABLED) | Google Sheets - Marketing Scout Service Account | запись в `url_candidates`, по умолчанию выключен |

Apify / Firecrawl / Claude креденшлы здесь **не нужны и не используются**.

---

## 7. Как одобрять кандидатов

1. Открыть вкладку `url_candidates`.
2. Выбрать строку-кандидата (для первого теста — `candidate_type=direct_competitor`, `dedup_status=unique`,
   `registry_status=not_in_registry`).
3. Поставить `approval_status = approved`; заполнить `approved_by` (id оператора) и `approved_at` (ISO 8601).
4. Для агрегатора/каталога/маркетплейса/соцсети/медиа, который вы всё же хотите обработать, дополнительно
   добавить в `notes` метку `aggregator_approved`.
5. Не одобрять более 5 строк к одному прогону (лишние всё равно будут отсечены до 5).

---

## 8. Первый тест

1. В `url_candidates` одобрить **одного** кандидата `direct_competitor` (см. §7).
2. **Execute Workflow** один раз.
3. Открыть выход узла **Build Execution Summary & Handoff**:
   - `selected_count = 1`, `skipped_count` = остальные строки;
   - `selected_urls` содержит нужный URL;
   - `workflow_04_set_url_list_block` — готовый блок `const rawUrls = [...]`.
4. Скопировать URL (≤5) в **Workflow 04 → Set URL List**, запустить Workflow 04.
5. **Ожидаемый результат Workflow 04:** `route=monitor_queue`, `entity_type=competitor`, `parsed_success`,
   строка в `url_registry`.
6. **После подтверждения** обработки: либо включить узел `Mark Candidates Processed (DISABLED)` и перезапустить
   Workflow 06, либо вручную поставить `approval_status=processed` в `url_candidates`.

---

## 9. Ожидаемый результат

- В самом Workflow 06: **0 трат** (нет Apify/Firecrawl/Claude).
- Execution Summary: `run_id`, `selected_count`, `skipped_count`, `selected_urls`, причины пропуска,
  `processing_mode=manual_handoff_to_workflow_04`.
- Стоимость возникает **только** в Workflow 04 на выбранных ≤5 URL.

---

## 10. Жизненный цикл `approval_status`

```
new → approved → processed
duplicate  — остаётся duplicate (не обрабатывается)
rejected   — остаётся rejected (не обрабатывается)
error      — при сбое раннера/обработки
```

Workflow 06 переводит `approved → processed` (через включаемый узел или вручную) только **после** подтверждённой
обработки в Workflow 04. `approved_by` / `approved_at` сохраняются.

---

## 11. Диагностика

| Симптом | Причина / решение |
|---------|-------------------|
| `selected_count = 0` | Нет строк, проходящих фильтр. Проверьте `approval_status=approved`, `dedup_status=unique`, `registry_status=not_in_registry`, непустой `candidate_url`. |
| Кандидат-агрегатор пропущен | `candidate_type` из заблокированного набора. Добавьте `aggregator_approved` в `notes`, если действительно нужно обработать. |
| Подходящих больше 5, часть пропущена | Это норма: отсечка `over_max_5_limit`. Обработайте остаток следующим прогоном. |
| Узел `Read url_candidates` падает при импорте | Перепривяжите Google Sheets креденшл и вставьте реальный Spreadsheet ID. |
| `Mark Candidates Processed` ничего не делает | Узел выключен по умолчанию — включите его вручную после подтверждения обработки. |

---

## 12. Предупреждение

Lead-source коннекторы (соц.сети / доски объявлений) **ещё не построены**. Workflow 06 работает только с
кандидатами из `url_candidates`, полученными через Workflow 05 (Apify Search). Telegram-бот — позже, как интерфейс
над `discovery_requests` + `url_candidates` + Workflow 04/06 (без дублирования логики).
