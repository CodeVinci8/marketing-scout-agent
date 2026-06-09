# N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md — Workflow 08 (Touchpoint Analyzer)

**Workflow:** `n8n/workflows/08_touchpoint_analyzer.json`
**Имя:** `08 - Touchpoint Analyzer`
**Статус:** ✅ DETERMINISTIC-FIRST BASELINE ОДОБРЕН (Test 3 PASS); **LLM enrichment — НЕ ОДОБРЕН, ПОД ТЕСТОМ (Test C4 после патча v7).** `active=false`. Stage 3.2 (Business Scout Agent).
**Дата:** 2026-06-09 (v7 — специализированная схема source_candidate — DEC-088; ранее DEC-087/085/086/082/083)

> **ПАТЧ v7 (DEC-088) — специализированные компактные схемы обогащения ПО СЕМЕЙСТВУ записей. LLM enrichment остаётся
> НЕ ОДОБРЕН до прохождения Test C4 (или явного отказа от обогащения).** Test C3 обработал 4 записи
> (`technical_errors=0`, маршруты сохранены, MSK OK), качество выросло (Avito — хороший `primary_json` 78/80; Banki —
> корректно `review_queue`/`lead_signal`/`investigate`, без прямого контакта, lead 75; Zoon — `content_idea`/
> `content_queue`, comp 45 / content 70 / qual 68), **но `primary_json=2/4`: Telegram `source_candidate` (7) по-прежнему
> срывает строгий JSON и уходит в fallback.** Патч v7 (без роста стоимости — путь даже короче):
> - **Специализированный путь для source_candidate / social-каналов.** Записи с
>   `record_type_hint=market_signal AND touchpoint_type=source_candidate`, **или** `source_type=social_channel`,
>   **или** `platform=telegram` без прямого личного запроса — используют **отдельный ультра-короткий системный промпт**
>   («Return JSON only… первый символ `{`, последний `}`… только данная запись, без браузинга… публичный источник
>   мониторинга/контента, НЕ прямой лид и НЕ outreach») и **минимальный payload** (`task=enrich_source_candidate`,
>   platform, profile_name, profile_url, text_context, interest_topic, service_hint, deterministic_entity_type,
>   deterministic_action). Выходная схема — **только 7 ключей**: `profile_name, service_type, offer_text, detected_need,
>   reason, content_idea_score, quality_score`. Модели **запрещено** возвращать `company_name / route / entity_type /
>   recommended_action / lead_signal_score / competitor_strength`. **Меньшая поверхность ответа = выше надёжность
>   строгого JSON**, и Telegram больше не уходит в fallback. `max_tokens=500`.
> - **Repair для этого семейства** чинит в **те же 7 ключей** (не раздувает до 15-ключевой общей схемы), `max_tokens=400`.
> - **Merge** накладывает только эти 7 описательных полей + content/quality-баллы; `route=content_queue`,
>   `entity_type=content_idea`, `recommended_action=create_content`, `lead_signal_score=1`, `competitor_strength=1`,
>   `contact_public=''` остаются **детерминированными**. **Пост-merge safety assertion** (Task D) гарантирует это для
>   social-источников: route остаётся `content_queue` (если det-маршрут не был `review_queue`), entity=content_idea,
>   action∈{create_content,investigate}, контакт пуст (если не указан явно), lead=1 (если нет прямого личного запроса),
>   competitor_strength=1 (если запись не `competitor_activity`).
> - **Avito/Banki/Zoon — без изменений** (общий промпт / review-source v6). Регрессии нет.
> Цель Test C4: `primary_json≥3/4`, `fallback=0` (идеально, ≤1 допустимо), `technical_errors=0`, **Telegram не
> fallback**, Banki без прямого контакта, Zoon→content, стоимость ≤$0.04. Шаги — `docs/STAGE_3_2_TEST_RESULTS.md` Test C4.

> **ПАТЧ v6 (DEC-087) — качество обогащения после C2 PARTIAL PASS. LLM enrichment остаётся НЕ ОДОБРЕН до прохождения
> Test C3.** Test C2 (attempt #2) обработал нужные 4 записи (`technical_errors=0`, маршруты сохранены, MSK OK), но
> `primary_json=2/4` (цель ≥3/4) и были проблемы качества: Telegram (7) ушёл в fallback; Zoon (12) потребовал repair и
> классифицирован как сильный конкурент (хотя это обобщённый каталог отзывов); Banki (11) reason содержал «обратиться
> напрямую» без публичного контакта; риск необоснованных «спрос растёт». Патч v6 (без роста `max_tokens`/стоимости):
> (A) **короткий компактный промпт** для source_candidate/Telegram (`content_idea` + `create_content/investigate`,
> reason как «источник мониторинга», без прямого лида/контакта/внешних фактов); (B) **`review_source`**: сильный
> конкурент только при заданном `competitor_name` → `monitor_queue`; обобщённый каталог/категория (Zoon
> «кредитные брокеры в Москве») → `content_idea`/`content_queue`, `competitor_strength` ≤45; (C) **санитайзер reason**
> в `Merge …`: без контакта нельзя «обратиться напрямую/написать/позвонить/связаться» (замена на «требует ручной
> проверки»), маршрут остаётся `review_queue`/`investigate`; (D) запрет «спрос растёт/активно задают/много
> лидов/высокая конверсия», если их нет в исходной записи; (E) детерминированные **HINTS**
> (`expected_entity_type/action/route`, `no_contact_safety`, `forbidden_phrases`) в payload primary **и** repair.
> Цель Test C3: `primary_json≥3/4`, fallback≤1/4, `technical_errors=0`, Banki без прямого контакта, Zoon→content,
> Telegram не fallback, стоимость ≤$0.04. Шаги — `docs/STAGE_3_2_TEST_RESULTS.md` Test C3.

> **ПАТЧ v4 (DEC-085) — обогащение через компактный JSON, мерж в детерминированную строку.** Первый LLM-тест (Test C,
> v3) был PARTIAL PASS / LLM НЕ ОДОБРЕН: маршруты безопасны, но слишком много fallback и **стоимость $0.0967 за 4
> записи** — причина: v3 просил Claude сгенерировать **всю строку из 25/35 полей с нуля** (длинный ответ → шлюз
> возвращал прозу/thinking). Теперь Claude возвращает **только компактный enrichment-JSON** (15 ключей:
> company_name/profile_name/region/service_type/offer_text/terms/contact_public/detected_need/reason/
> recommended_action/entity_type/4 балла), `temperature=0`, `max_tokens=700`, **`thinking={type:'disabled'}`**.
> Узел **`Merge LLM Enrichment With Deterministic Row`** берёт детерминированную 35-полей строку и накладывает
> **только безопасное обогащение** (описательные поля + баллы с полом det). **Маршрут, recommended_action,
> entity_type и contact остаются детерминированными** — Claude не меняет маршрутизацию, не понижает competitor до
> irrelevant, не ставит contact/results без реального контакта из приёма.

> **Как включить/выключить LLM (важно):**
> - **Дефолт (одобрено): всё ВЫКЛ** — `analysis_mode='deterministic_first'`, `llm_enrichment=false`,
>   `llm_enrichment_test_mode=false`. Claude не вызывается, стоимость $0.
> - **Малый тест 4 записей (Test C2):** `llm_enrichment_test_mode=true` (через Claude идут только
>   `llm_test_batch_indexes=[1,7,11,12]`; остальные 8 записей **не пишутся**). **После теста вернуть
>   `llm_enrichment_test_mode=false`.**
> - **Полное обогащение (после успешного Test C2):** `analysis_mode='llm_enriched'` + `llm_enrichment=true`
>   (Claude по всем не-irrelevant записям; детерминированный fallback сохраняется). **Включать только после
>   прохождения Test C2; иначе оставить флаги `false`.**

> **Время (DEC-083):** `created_at`/`parsed_at`/`generated_at` и stamp в `run_id` (`touchpoint_YYYYMMDD_HHmmss`)
> теперь в московском времени **+03:00** через `moscowIsoNow()`/`moscowStamp()`, напр.
> `2026-06-08T21:55:43.425+03:00`. Источниковый `published_at` не меняется; старые UTC-`Z` строки не переписываются.

> **LLM-тест (Part C, исправлено в v5 — DEC-086):** в `Set Analyzer Config` есть `llm_enrichment_test_mode`
> (по умолч. `false`) и `llm_test_batch_indexes=[1,7,11,12]`. При `llm_enrichment_test_mode=true` отбор фильтруется
> **ДО цикла** в узле **`Filter & Select Records`**: `batch_index` назначается по полному отбору (1..12 стабильны),
> затем остаются только записи с `batch_index ∈ llm_test_batch_indexes`. В цикл попадают **ровно 4** записи (все —
> цели Claude): Avito-конкурент, Telegram source candidate, Banki форум hot без контакта, Zoon отзывы; остальные 8
> **вообще не входят в цикл** и не пишутся. **`Build Deterministic Row` больше НЕ возвращает `[]`** — иначе пустой
> возврат внутри Split-in-Batches останавливает продолжение цикла (баг попытки C2 #1: записалась только запись 1).
> Ожидаемо: ровно 4 строки, `selected_count=4`, `primary_json≥3/4`, `repaired_json≤1/4`, fallback≤1/4, маршруты как
> в baseline, стоимость ≤ $0.04. Шаги — `docs/STAGE_3_2_TEST_RESULTS.md` Test C2 (attempt #2).

> **ПАТЧ v3 (DEC-082):** второй live-тест (v2) дал ROUTING PASS, но `primary_json=0`, `repaired_json=2`,
> `deterministic_fallback_after_llm_fail=8`, и **стоимость Claude ≈ $0.159 за 12 записей** при том, что
> детерминированный слой делал всю реальную классификацию (шлюз почти всегда возвращал прозу/thinking).
> Поэтому Workflow 08 теперь **ДЕТЕРМИНИРОВАННО-ПЕРВЫЙ**: `Set Analyzer Config` задаёт
> `analysis_mode='deterministic_first'`, `llm_enrichment=false` (дефолт). Очевидные записи маршрутизируются
> **БЕЗ Claude** (`deterministic_pre_route` / `deterministic_irrelevant_skip`, $0). Claude вызывается только если
> `deterministic_needs_llm=true` или включено обогащение (`llm_enrichment=true`). Для 12-записного фикстура в
> дефолте: **Claude calls=0, repair_used=0, technical_errors=0**.

> **ПАТЧ v2 (DEC-081):** первый live-тест показал, что шлюз часто возвращает **прозу/thinking/signature вместо
> JSON** (иногда вообще без `text`-блока), из-за чего primary+repair падали и классифицируемые записи (включая
> контрольный лид — запись 11) уходили в `technical_errors`. Введён **детерминированный fallback** после провала
> Claude+repair (`parse_method=deterministic_fallback_after_llm_fail`). v3 строит на этом, делая детерминированный
> путь основным, а не запасным.

> **Source-agnostic анализатор точек касания.** Читает approved/unique записи из `raw_market_records`,
> анализирует через Claude (resilient JSON + repair, как Stage 2) и маршрутизирует в 6 существующих
> бизнес-вкладок (35 колонок). **НЕ парсер, НЕ скрейпинг, НЕ Apify/Firecrawl.** Только Claude HTTP.

---

## 1. Назначение

Stage 3.2 превращает нормализованные записи Workflow 07 в проанализированные строки с маршрутизацией. Анализатор
**переиспользует** resilient-паттерн Stage 2 (Workflow 04): primary JSON → repair formatter → technical_errors
fallback; поля `parse_method`, `repair_used`, `repair_status`, `processing_status`, `raw_response_preview`;
валидация `route`.

## 2. Требуемые вкладки

| Вкладка | Колонок | Роль |
|---------|:------:|------|
| `raw_market_records` | 40 | читается (вход) |
| `results` / `review_queue` / `monitor_queue` / `content_queue` / `skipped_log` / `technical_errors` | 35 каждая | пишется (динамически по `route`) |

6 бизнес-вкладок уже существуют (Stage 2). Заголовки **не меняются**. `agent_requests` /
`market_record_registry` / `agent_memory` этим workflow **не пишутся**.

## 3. Структура (20 нод)

1. **Overview Note RU / Test Instructions RU** — sticky.
2. **Manual Start**.
3. **Set Analyzer Config** (code) — `analysis_mode='deterministic_first'`, `llm_enrichment=false`,
   `llm_enrichment_test_mode=false`, `llm_test_batch_indexes=[1,7,11,12]`, `test_mode=true`, `max_records=12`,
   `analyze_statuses=[approved,new]`; `production_statuses=[approved]` задокументировано (не дефолт);
   `run_id=touchpoint_YYYYMMDD_HHmmss` (МСК). Будущий режим: `analysis_mode='llm_enriched'` + `llm_enrichment=true`.
   Малый LLM-тест: `llm_enrichment_test_mode=true` (Claude только по `llm_test_batch_indexes`).
4. **Read raw_market_records** (Google Sheets read).
5. **Filter & Select Records** (code) — `dedup_status=unique` + `approval_status` ∈ allowed; в test_mode
   irrelevant тоже берём (уйдут в `skipped_log`); cap `max_records`; присваивает `batch_index`. **C2 (DEC-086):**
   при `llm_enrichment_test_mode=true` здесь же, **до цикла**, отбор фильтруется до `llm_test_batch_indexes` — в
   цикл уходит ровно 4 записи; добавляет `selected_count_before/after_test_filter`.
6. **Loop Over Items** (splitInBatches, по 1) — out0 (done) → Final Summary; out1 (loop) → обработка.
7. **Prepare Record** (code) — на итерацию: `parsed_at`, склейка `analyzer_text`, детерминированная
   классификация `det`, флаг `deterministic_needs_llm`, LLM-шлюз `call_claude = (НЕ irrelevant) И
   (llm_enrichment=true ИЛИ deterministic_needs_llm=true)`.
8. **IF Call Claude?** — `call_claude=true` → Claude; `false` → детерминированная строка (БЕЗ Claude, $0).
9. **Build Deterministic Row** (code) → 35-полей строка: irrelevant → `deterministic_irrelevant_skip`/`skipped_log`;
   иначе → `deterministic_pre_route` с маршрутом из `det`. **Никогда не возвращает `[]`** (DEC-086) — пустой возврат
   внутри цикла останавливает Split-in-Batches; C2-фильтрация перенесена в `Filter & Select Records`.
10. **Build Primary Claude Request** (code) → **компактный enrichment-only** промпт (ORIGINAL_RECORD +
    DETERMINISTIC_ROW + OUTPUT_SCHEMA из 15 ключей), `max_tokens=700`, `temperature=0`, `thinking={type:'disabled'}`.
11. **Claude Primary API Request** (httpRequest) → `https://aiprimetech.io/v1/messages`, креденшл
    `Claude API - Marketing Scout` (тело передаёт `thinking`).
12. **Parse Primary JSON** (code) — парсит компактный enrichment-объект (только `text`-блоки, fence-strip,
    balanced/`{`…`}`); прозу/thinking → `non_json_non_text_or_thinking_response`.
13. **IF Primary Parse OK?** — true → Merge; false → repair.
14. **Build Repair Request** (code) → enrichment-only repair, `max_tokens=600`, `temperature=0`, thinking disabled.
15. **Claude Repair API Request** (httpRequest).
16. **Parse Repaired JSON** (code) — успех → enrichment; провал обоих → маркер детерминированного fallback.
17. **Merge LLM Enrichment With Deterministic Row** (code, ранее Normalize + Route) — берёт детерминированную
    35-полей строку и накладывает только безопасное обогащение (описательные поля + баллы с полом det); маршрут/
    действие/entity/контакт остаются детерминированными; `market_signal`→`content_idea`; 35 полей.
18. **Append to Dynamic Route Sheet** (Google Sheets append) — `Sheet Name = {{ $json.route }}` → возврат в Loop.
19. **Final Summary Output** (code) — сводка: `route_counts`, `entity_counts`, `repair_used_count`,
    `technical_errors_count`.

## 4. Маппинг точек касания на 35-схему

| Touchpoint класс | entity_type | route |
|------------------|-------------|-------|
| hot_lead / warm_touchpoint | `lead_signal` | `results` (если score≥70 + action=contact + контакт) иначе `review_queue` |
| competitor_activity / competitor_audience | `competitor` | `monitor_queue` |
| client_pain / question_objection / semantic_signal / ad_channel_signal / content_idea | `content_idea` (или `market_signal`) | `content_queue` |
| irrelevant | `irrelevant` | `skipped_log` |

`recommended_action` → route: `contact`→results, `investigate`→review_queue, `monitor`→monitor_queue,
`create_content`/`add_to_semantics`→content_queue, `ignore`→skipped_log. Невалидный route → `technical_errors`.

## 4a. Детерминированная классификация и fallback (v2, DEC-081)

`Prepare Record` считает `det` для каждой записи по подсказкам приёма:
1. `record_type_hint=irrelevant` ИЛИ `touchpoint_type ∈ {irrelevant_source, weak_market_noise}` → `skipped_log`
   (до Claude, `deterministic_irrelevant_skip`, $0).
2. `record_type_hint=competitor_activity` ИЛИ (`competitor_related=true` И `touchpoint_type` содержит
   `competitor`) → `competitor` → `monitor_queue`; `competitor_strength` 70–85 (есть оффер/цена) иначе 55–69;
   `company_name` из `competitor_name`/`profile_name`/домена; `service_type` из `service_hint`.
3. `record_type_hint=market_signal` И `touchpoint_type=source_candidate` → `content_idea` → `content_queue`
   (`content_idea_score` 40–65, `needs_manual_review=true`).
4. `touchpoint_type=review_source` → если `competitor_related=true` → `competitor`/`monitor_queue`; иначе
   `content_idea`/`content_queue`.
5. `record_type_hint=question_objection` ИЛИ `lead_temperature=hot` ИЛИ `lead_intent_hint=high` ИЛИ
   `urgency_hint=high` → `lead_signal`; есть пригодный контакт + прямой запрос → `results`/`contact`
   (`lead_signal_score` 85–95); иначе → `review_queue`/`investigate` (`lead_signal_score` 70–85,
   `needs_manual_review=true`).
6. иначе → `review_queue`/`content_idea`/`investigate` (всё ещё классифицируемо).

**Применение `det`:** (а) решает `is_irrelevant` до Claude; (б) если Claude+repair не дали валидный JSON —
строит строку по `det` (`deterministic_fallback_after_llm_fail`). `technical_errors` — только если у `det` нет
валидного маршрута или сбой Sheets/API.

**parse_method:** `primary_json` | `repaired_json` | `deterministic_irrelevant_skip` |
`deterministic_fallback_after_llm_fail` | `deterministic_pre_route` | `technical_error`.
**repair_status:** `''` | `success` | `failed_fallback` | `failed`.

## 5. Импорт и настройка

1. Импортировать `08_touchpoint_analyzer.json`. **НЕ активировать** (`active=false`).
2. Перепривязать креденшлы (ID локальны):
   - **Claude Primary API Request** + **Claude Repair API Request** → `Claude API - Marketing Scout`.
   - **Read raw_market_records** + **Append to Dynamic Route Sheet** → `Google Sheets - Marketing Scout Service Account`.
3. Заменить `PASTE_SPREADSHEET_ID_HERE` на реальный Spreadsheet ID на 2 Google Sheets нодах.
4. API-ключей в файле нет.

## 6. Тест (12 записей Workflow 07)

1. Записать баланс Claude **ДО**.
2. **Execute Workflow** один раз (test_mode берёт `approved`+`new`, включая 2 irrelevant).
3. Записать баланс **ПОСЛЕ** и результаты → `docs/STAGE_3_2_TEST_RESULTS.md`.

**Ожидаемо (deterministic_first, llm_enrichment=false):**
- **Claude calls = 0** (Primary и Repair НЕ выполняются), cost delta **$0**, `repair_used=false` ×12.
- `deterministic_pre_route = 10`, `deterministic_irrelevant_skip = 2`, `technical_errors = 0`.
- Записи **1–4, 6, 12** (Avito/Dzen competitor, Yandex Maps/Zoon отзывы competitor_related) → **monitor_queue**.
- Записи **5, 7, 8** (VK-поиск, Telegram source_candidate) → **content_queue**.
- Записи **9–10** (irrelevant) → **skipped_log**.
- Запись **11** (форум hot, без контакта) → **review_queue**, `lead_signal`, `investigate`, `lead_signal_score=75`,
  `needs_manual_review=true`.

**Стоимость:** в дефолте Claude не вызывается → $0. В будущем режиме `llm_enriched` — Claude по ~10 не-irrelevant
записям. См. `docs/COSTS_AND_LIMITS.md`.

## 7. Чего НЕ делает
- НЕ скрейпит, НЕ вызывает Apify/Firecrawl, НЕ парсит источники.
- НЕ пишет `agent_requests` / `market_record_registry` / `agent_memory`.
- НЕ меняет заголовки существующих вкладок.
- НЕ Telegram-бот, НЕ расписание, НЕ авто-активация.
