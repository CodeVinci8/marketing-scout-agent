# Workflow 06 — Approved Candidates Runner (RU)

**Файл:** `n8n/workflows/06_approved_candidates_runner.json`
**Имя в n8n:** `06 - Approved Candidates Runner`
**Статус:** ✅ ОДОБРЕН (Stage 2, с ограничениями) — registry recheck (DEC-065) + доменное разнообразие (DEC-066) + режимы `runner_mode` (DEC-072), `active=false`. Передача в WF04 — **ручная** (`manual_handoff_to_workflow_04`); авто-handoff отложен в Stage 2.4 (`docs/WORKFLOW_06_AUTO_HANDOFF_PLAN.md`). Результаты: `docs/STAGE_2_FINAL_TEST_RESULTS.md`. НЕ активировать.

> **Время (DEC-083):** генерируемые метки (`now`) и `run_id` (`approved_run_YYYYMMDD_HHmmss`) теперь в московском времени **+03:00** через `moscowIsoNow()`/`moscowStamp()`. Источниковый `approved_at` (ставит оператор) и `published_at` не меняются; старые UTC-`Z` строки не переписываются.

> **Результаты тестов (2026-06-08).** Test 4 (registry recheck) — ✅ PASS: после возврата уже обработанных URL
> в `approved` прогон дал `selected_count=0`, `skipped_count=18` (`registry_recheck_duplicate`,
> `already_processed`, `duplicate_status`, `approval_status_not_approved`). Режимы `first_pass_domain_diversity`
> и `deep_domain_analysis` — реализованы и проверены симуляцией; «живой» тест со свежими необработанными
> URL одного домена рекомендован (watch item W1 в STAGE_2_FINAL_TEST_RESULTS).
> **Авто-handoff (processing_mode=auto_execute_workflow_04) пока НЕ реализован** — только ручная передача.

---

## 0a. Результат сквозного теста (E2E, 2026-06-07) — выявил необходимость доменного разнообразия

Сквозной тест веб-пайплайна прошёл (WF05 → WF06 → WF04). По запросу «автоломбард Москва займ под ПТС без
проверки кредитной истории» WF06 прочитал **18** строк `url_candidates`, выбрал **4** одобренных
`direct_competitor`, пропустил **14**, `max_per_run=5`, `registry_recheck=enabled`,
`processing_mode=manual_handoff_to_workflow_04`. WF04 обработал все 4 → `monitor_queue`.

**Проблема:** среди 4 выбранных были **два URL одного домена** `autolombard-moskva.ru` (корень и страница
`/services/.../dmitrovskoe-shosse/`). За один прогон лучше охватить **разные** домены. Отсюда патч
**доменного разнообразия** (DEC-066): по умолчанию максимум 1 URL на домен за прогон; root-страница имеет
приоритет. Семантика `url_registry` **не изменена**.

---

## 0. Результат первого теста (2026-06-07) и патч

**Первый тест выявил баг доверия.** В `url_candidates` было 9 строк. Оператор вручную изменил **старый дубликат**:

```
URL: https://www.autolombard-moskva.ru/pledge-pts/
dedup_status     = unique
registry_status  = not_in_registry
candidate_type   = direct_competitor
approval_status  = approved
```

Workflow 06 **доверился** этим редактируемым полям и выбрал URL для передачи:

```
selected_count   = 1
processing_mode  = manual_handoff_to_workflow_04
selected_urls    = https://www.autolombard-moskva.ru/pledge-pts/
```

**Проблема:** этот URL **уже есть в `url_registry`**. Передача его в Workflow 04 вызвала бы повторную (дублирующую) трату Firecrawl/Claude. Поля `dedup_status`/`registry_status` в `url_candidates` ставятся один раз во время обнаружения (Workflow 05) и редактируются оператором — это **не** безопасный финальный фильтр.

**Патч (DEC-065):** Workflow 06 теперь **повторно читает `url_registry` в момент прогона**, заново нормализует `candidate_url` теми же правилами, что Workflow 04/05, и сверяет с реестром. См. §4.1.

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
| Set Runner Config | code | **НОВЫЙ (DEC-072).** Задаёт `runner_mode` (`first_pass_domain_diversity` по умолчанию / `deep_domain_analysis`). Чтобы переключить режим — отредактируйте строку `const runner_mode = '…'` в этой ноде. Креденшл не нужен. |
| Read url_candidates | googleSheets (read) | Читает всю вкладку `url_candidates` |
| Read url_registry | googleSheets (read) | **НОВЫЙ (DEC-065).** Читает `url_registry` в момент прогона — источник правды дедупа |
| Select, Prioritize & Annotate | code | Единый источник правды: повторная нормализация `candidate_url` + сверка с `url_registry` + фильтр + приоритет + отсечка ≤5 + аннотация каждой строки (`_selected`, `_skip_category`, `_skip_reason`) |
| IF Selected? | if | Пропускает дальше только выбранные строки |
| Mark Candidates Processed (DISABLED) | googleSheets (update) | **Выключен по умолчанию.** При включении ставит `approval_status=processed` и дописывает в `notes` `Processed by Workflow 06 run_id=…` |
| Build Execution Summary & Handoff | code | Один итог на прогон: счётчики, выбранные URL, причины пропуска, готовый блок для `Set URL List` |

---

## 4. Логика отбора

**Строка попадает в обработку только если выполнены ВСЕ условия:**
- `approval_status = approved` (а `processed` / `duplicate` / `rejected` / `error` — пропуск);
- `candidate_url` не пуст;
- **повторно нормализованный** `candidate_url` ОТСУТСТВУЕТ в `url_registry` (runtime recheck, §4.1).

`candidate_type` из `aggregator / directory / marketplace / social / media_article` **можно** выбрать,
если `approval_status = approved`, но в выбранном элементе ставится `warning`:
`candidate_type is not direct_competitor; review before Workflow 04`.

> **Важно (DEC-065):** `dedup_status` и `registry_status` из `url_candidates` — это **подсказки времени
> обнаружения (advisory)**, а НЕ финальный фильтр. Workflow 06 их **не** использует для решения и
> перепроверяет `url_registry` сам. Ручное редактирование этих полей не может протолкнуть дубликат.

**Приоритет (сортировка выбранных):** сначала `direct_competitor`, затем выше `confidence_score`, затем ниже
`rank`, затем **root-страница вперёд** (главная страница домена предпочтительнее для первого прохода анализа
конкурента).

**Режимы прогона `runner_mode` (нода `Set Runner Config`, DEC-072).** Значение по умолчанию —
`first_pass_domain_diversity`. Оба режима ВСЕГДА сохраняют: `max_per_run=5`, runtime-перепроверку
`url_registry`, точный дедуп по нормализованному URL, приоритет (`direct_competitor` → `confidence_score` ↓ →
`rank` ↑ → root вперёд), ручную передачу, без авто-вызова WF04, без авто-`processed`. Домен заново выводится
из `candidate_url` (как в Workflow 05: hostname, нижний регистр, срезается `www.`). **Семантика `url_registry`
не меняется** (дедуп по полному нормализованному URL, НЕ по домену) в обоих режимах.

| `runner_mode` | Правило по домену | Лишние URL того же домена | Предупреждение на выбранном |
|---------------|-------------------|---------------------------|------------------------------|
| `first_pass_domain_diversity` (ПО УМОЛЧАНИЮ) | максимум **1** URL на домен за прогон | пропуск, `reason_category=duplicate_domain_in_run`, reason «Same domain already selected in this run; use deep_domain_analysis mode for multi-page domain analysis.» | — |
| `deep_domain_analysis` (ЯВНО) | максимум **3** URL на домен за прогон | сверх 3 — пропуск, `reason_category=domain_deep_limit` | `warning="deep_domain_analysis mode: multiple URLs from same domain allowed intentionally."` |

**Жёсткая отсечка:** максимум **5** кандидатов за прогон (оба режима). Подходящие строки сверх 5 помечаются
как пропущенные с причиной `over_limit` (их можно одобрить в следующем прогоне).

**Категории причин пропуска (`reason_category` в `skipped[]`):**

| Категория | Когда |
|-----------|-------|
| `approval_status_not_approved` | `approval_status` не `approved` (например `new`/пусто) |
| `already_processed` | `approval_status = processed` (уже передан ранее) |
| `duplicate_status` | `approval_status` = `duplicate` / `rejected` / `error` |
| `registry_recheck_duplicate` | нормализованный URL **уже в `url_registry`** (даже если оператор вручную поставил `unique`/`not_in_registry`) |
| `duplicate_domain_in_run` | (режим `first_pass_domain_diversity`) другой URL этого же домена уже выбран в этом прогоне |
| `domain_deep_limit` | (режим `deep_domain_analysis`) более 3 URL одного домена за прогон — лишние отсекаются |
| `missing_candidate_url` | `candidate_url` пуст |
| `not_direct_competitor_optional_warning` | предупреждение на выбранном элементе: тип не `direct_competitor` (не блокирует, см. §4) |
| `over_limit` | подходит, но сверх лимита 5/прогон |

**Выходные поля сводки:** добавлены `runner_mode`, `domain_diversity` (описание режима),
`domain_selected_counts` (сколько URL выбрано на каждый домен).

---

## 4.1. Повторная проверка реестра (registry recheck, DEC-065)

1. Узел `Read url_registry` читает вкладку `url_registry` **в момент прогона** (источник правды дедупа).
2. Код собирает множество значений `normalized_source_url` из реестра.
3. Для каждого кандидата `candidate_url` **заново нормализуется** теми же правилами, что в Workflow 04/05:
   - убрать фрагмент (`#…`);
   - привести схему и хост к нижнему регистру;
   - удалить трекинговые параметры (`utm_*`, `gclid`, `yclid`, `fbclid`);
   - убрать хвостовой слэш пути.
4. Если результат нормализации **есть** в `url_registry` → кандидат пропускается с
   `reason_category = registry_recheck_duplicate` (не выбирается), **независимо** от `dedup_status`/`registry_status`.

Почему так: реестр — единственный надёжный источник дедупа; нормализация совпадает с ключами `url_registry`,
которые пишет Workflow 04. Подсказки в `url_candidates` фиксируются при обнаружении и могут устареть или быть
изменены вручную, поэтому решение принимается только по реестру.

---

## 5. Настройка (после импорта)

1. **НЕ активировать** workflow (`active=false`).
2. Вкладки уже есть: `url_candidates` (26 колонок), `url_registry` (10 колонок). **Новых вкладок не требуется.**
3. Перепривязать креденшл (ID локальны, в файле плейсхолдеры):
   - `Read url_candidates` → **Google Sheets - Marketing Scout Service Account**
   - `Read url_registry` → тот же креденшл
   - `Mark Candidates Processed (DISABLED)` → тот же креденшл
4. На **всех трёх** Google Sheets нодах вставить **реальный Spreadsheet ID** (заменить `PASTE_SPREADSHEET_ID_HERE`).
5. Внешних API-ключей здесь **нет** (нет Apify/Firecrawl/Claude). Если используется Execute Workflow в будущем —
   дополнительных внешних креденшлов Workflow 06 не требует.

---

## 6. Креденшлы

| Узел | Креденшл | Примечание |
|------|----------|------------|
| Read url_candidates | Google Sheets - Marketing Scout Service Account | чтение |
| Read url_registry | Google Sheets - Marketing Scout Service Account | чтение (runtime recheck дедупа) |
| Mark Candidates Processed (DISABLED) | Google Sheets - Marketing Scout Service Account | запись в `url_candidates`, по умолчанию выключен |

Apify / Firecrawl / Claude креденшлы здесь **не нужны и не используются**.

---

## 7. Как одобрять кандидатов

1. Открыть вкладку `url_candidates`.
2. Выбрать строку-кандидата (для теста лучше `candidate_type=direct_competitor`).
3. Поставить `approval_status = approved`; заполнить `approved_by` (id оператора) и `approved_at` (ISO 8601).
4. Агрегатор/каталог/маркетплейс/соцсеть/медиа **тоже можно** одобрить (DEC-065): если `approval_status=approved`,
   кандидат будет выбран, но в выбранном элементе появится `warning` (тип не `direct_competitor`; проверить перед WF04).
   Отдельная метка в `notes` больше не требуется.
5. **Не имеет смысла** подтверждать дубликат: даже если поставить `dedup_status=unique`/`registry_status=not_in_registry`,
   Workflow 06 перепроверит `url_registry` и пропустит URL как `registry_recheck_duplicate` (DEC-065).
6. Не одобрять более 5 строк к одному прогону (лишние всё равно будут отсечены до 5 с `over_limit`).

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

## 8.1. Ретест registry recheck (DEC-065)

Этот ретест подтверждает, что патч работает. Два кейса в одном прогоне:

**а) Старый дубликат, помеченный оператором как approved — должен быть ПРОПУЩЕН.**
1. Взять строку, чей URL **уже есть в `url_registry`** (например `https://www.autolombard-moskva.ru/pledge-pts/`).
2. Вручную выставить ей `dedup_status=unique`, `registry_status=not_in_registry`,
   `candidate_type=direct_competitor`, `approval_status=approved` (воспроизводим баг первого теста).
3. **Execute Workflow.**
4. **Ожидается:** этот URL **НЕ** в `selected[]`; он в `skipped[]` с `reason_category = registry_recheck_duplicate`.
   `selected_urls` его не содержит. Ручные правки `dedup_status`/`registry_status` проигнорированы.

**б) Новый direct_competitor, одобренный — должен быть ВЫБРАН.**
1. Взять `direct_competitor`, чей нормализованный URL **отсутствует** в `url_registry`.
2. Поставить `approval_status=approved` (+ `approved_by`/`approved_at`).
3. **Execute Workflow.**
4. **Ожидается:** этот URL в `selected[]` и в `selected_urls`; в `selected_count` учтён; готов к Workflow 04.

Если оба кейса в одном прогоне: `selected_count` считает только (б), а (а) попадает в `skipped[]`
с `registry_recheck_duplicate`.

---

## 9. Ожидаемый результат

- В самом Workflow 06: **0 трат** (нет Apify/Firecrawl/Claude).
- Execution Summary (узел `Build Execution Summary & Handoff`) содержит:
  `run_id`, `generated_at`, `total_candidates_read`, `selected_count`, `skipped_count`, `max_per_run`,
  `processing_mode=manual_handoff_to_workflow_04`, `registry_recheck` (статус перепроверки), `selected_urls`,
  массив `selected` (с `warning` для не-`direct_competitor`), массив `skipped` (`reason_category` + `reason`),
  `workflow_04_set_url_list_block`, `operator_note`.
- Стоимость возникает **только** в Workflow 04 на выбранных ≤5 URL. Runtime-перепроверка реестра
  предотвращает повторную трату Firecrawl/Claude на URL, уже присутствующий в `url_registry`.

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
| `selected_count = 0` | Нет строк, проходящих фильтр. Проверьте `approval_status=approved`, непустой `candidate_url`, и что URL **отсутствует** в `url_registry`. Смотрите `reason_category` в `skipped[]`. |
| Одобренный кандидат пропущен с `registry_recheck_duplicate` | URL уже есть в `url_registry` (runtime recheck, DEC-065). Это правильно: повторная обработка вызвала бы дублирующую трату. `dedup_status`/`registry_status` в `url_candidates` тут не помогут — они advisory. |
| Кандидат-агрегатор пропущен | С DEC-065 агрегатор/каталог/медиа **не** блокируется: при `approval_status=approved` он будет выбран с `warning`. Если он всё же в `skipped[]` — смотрите `reason_category` (скорее всего `registry_recheck_duplicate` или `approval_status_not_approved`). |
| Подходящих больше 5, часть пропущена | Это норма: отсечка `over_limit`. Обработайте остаток следующим прогоном. |
| Узел `Read url_candidates` / `Read url_registry` падает при импорте | Перепривяжите Google Sheets креденшл и вставьте реальный Spreadsheet ID на обоих read-нодах. |
| `Mark Candidates Processed` ничего не делает | Узел выключен по умолчанию — включите его вручную после подтверждения обработки. |

---

## 12. Предупреждение

Lead-source коннекторы (соц.сети / доски объявлений) **ещё не построены**. Workflow 06 работает только с
кандидатами из `url_candidates`, полученными через Workflow 05 (Apify Search). Telegram-бот — позже, как интерфейс
над `discovery_requests` + `url_candidates` + Workflow 04/06 (без дублирования логики).
