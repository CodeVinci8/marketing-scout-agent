# N8N_WORKFLOW_12_MARKET_INTELLIGENCE_REPORT_BUILDER_RU.md — Workflow 12 (Report Builder, deterministic skeleton)

**Workflow:** `n8n/workflows/12_market_intelligence_report_builder.json`
**Имя:** `12 - Market Intelligence Report Builder (Deterministic Skeleton)`
**Статус:** 🔧 ПОСТРОЕН скелет v0.1 (DEC-118). `active=false`, **полностью детерминированный, $0**:
`enable_llm_summary=false` (ветка Claude = guard с ошибкой, НЕ реализована), `telegram_send=false`
(доставка НЕ реализована, `delivered_to=none`), **HTTP-нод нет вообще**.
**Дата:** 2026-06-12 · **Решения:** DEC-112 (Claude — в report/control-слое, НЕ в WF10), DEC-118 (скелет v0.1),
DEC-108 (обязательный source_mix), DEC-097/098 (контакты/outreach — запрещены в отчётах).
**Схема выходной вкладки:** `docs/MARKET_INTELLIGENCE_REPORT_SCHEMA.md` (20 колонок).
**Архитектура слоя:** `docs/REPORTING_AND_TELEGRAM_SUMMARY_PLAN.md`.

> **ПАТЧ v0.2 (DEC-122) — операторский отчёт + охраняемая Claude-ветка.**
> Детерминированный отчёт расширен секциями (всё только из строк WF10, $0): executive_summary,
> competitor_snapshot (кол-во профилей + площадки), top_offers_and_prices (offers/prices_terms из
> competitor_profiles), market_angles_summary (с трендами), audience_signals_summary (aggregate-only),
> content_plan, source_confidence (avg/min/max source_confidence_score + ссылка на source_confidence_rules),
> limitations/source_mix (DEC-108), next_actions. `no_data` → `no_data_notice` без выдуманных секций.
> **Claude-ветка (выключена по умолчанию):** `Claude Summary Approval Gate` (ошибка без
> `llm_approval_token=I_APPROVE_CLAUDE_REPORT_SUMMARY`) → `Build Claude Summary Prompt` (evidence-bound:
> только поля детерминированного отчёта, без raw-записей и контактов; запрет выдумывать факты/контакты/
> аутрич; max_tokens=1200) → **ОТКЛЮЧЁННАЯ** HTTP-нода (`claude-sonnet-4-6`, ключ = плейсхолдер-строка,
> заменить на n8n credential только после одобрения; live-вызовов в этой сессии НЕ было) →
> `Merge Claude Summary Into Report` (ошибка без ответа API; при ответе считает `llm_cost_usd` из usage:
> $3/MTok input + $15/MTok output, пишет токены в notes). WF10 = детерминированное фактовое ядро;
> Claude = слой бизнес-интерпретации поверх (DEC-112). Стоимость фиксировать в agent_requests +
> COSTS_AND_LIMITS.md.

> Первый воркфлоу отчётного слоя. WF10 остаётся детерминированным фактическим ядром; WF12 читает его
> выходные вкладки и собирает один отчётный ряд. Claude и Telegram — отдельные gated-шаги поверх.

---

## 1. Архитектура (15 нод)

```
Manual Start
  → Set Report Config                 (enable_llm_summary=false, telegram_send=false, niche/region/top_n)
  → Read competitor_profiles → Read market_angles
  → Read audience_activity_signals → Read content_positioning_plan
  → Build Deterministic Report        (последний снапшот WF10 по plan_id; тренды углов vs предыдущий прогон;
                                       топ конкурентов/углов; агрегаты аудитории; Markdown; 20-кол. ряд)
  → IF enable_llm_summary?
       ├ true  → LLM Summary Guard (not implemented)   (throw: Claude требует одобрения+bounded prompt+учёта стоимости)
       └ false → Append market_intelligence_reports
                   → Build agent_requests Row (21) → Append agent_requests → Final Summary Output
```

## 2. Ключевые правила

- **Выбор прогона WF10:** `content_positioning_plan` содержит ровно один план на прогон → последний `plan_id`
  задаёт текущий снапшот (`wf10_run_id`), предыдущий план — базу трендов (`prev_wf10_run_id`). Углы/профили/
  сигналы фильтруются по штампу прогона в `angle_id`/`notes`/`signal_id`.
- **Тренды углов:** стабильный ключ угла = `angle_id` без штампа; частота сравнивается с предыдущим прогоном
  (↑ / ↓ / = / NEW). Первый отчёт — без трендов (prev пустой).
- **no_data (DEC-106):** если последний план WF10 — `no_data` (или rows=0) → `report_type=no_data_notice`,
  топ-списки пустые, фиксированная рекомендация `no_data; broaden filters or source scope`. Шаблонный контент
  никогда не выдаётся за рыночные данные.
- **source_mix обязателен (DEC-108)** в строке отчёта и в Markdown — отчёт не подразумевает, что все данные
  собраны live в последнем прогоне.
- **Детерминизм прежде всего (DEC-112):** колонки 1–15 всегда считаются без LLM; отчёт с пустыми `llm_*` —
  полный и валидный. `llm_cost_usd=0`, `delivered_to=none` в v0.1 всегда.
- **Контакты/outreach:** в отчёте нет индивидуальных контактов; аудитория — только агрегаты; рекомендаций
  outreach нет (DEC-097/098).
- Markdown-отчёт в v0.1 хранится inline в `notes` ряда (`report_markdown_path` пустой; запись файла/Drive —
  будущий шаг).

## 3. Импорт и тесты

1. НЕ активировать. **Сначала создать вкладку `market_intelligence_reports`** (20 колонок — заголовки по
   `docs/MARKET_INTELLIGENCE_REPORT_SCHEMA.md` §2).
2. Перепривязать креденшл Google Sheets на 6 sheet-нодах (4 read + 2 append); заменить
   `PASTE_SPREADSHEET_ID_HERE` на реальный ID.
3. Требование: ≥1 завершённый прогон WF10 (иначе понятная ошибка `content_positioning_plan is empty`).
   Тренды появляются при ≥2 прогонах WF10.
4. **Тест 1 ($0):** Execute once → `market_intelligence_reports` +1 (`report_type=on_demand`,
   top_competitors/top_angles из последнего снапшота, `source_mix` заполнен, `llm_*` пустые, `llm_cost_usd=0`,
   `delivered_to=none`), `agent_requests` +1 (`request_type=report_summary`, completed, $0).
5. **Тест 2 (no-data):** если последний прогон WF10 был no_data → `report_type=no_data_notice`, пустые
   топ-списки, фиксированная рекомендация.
6. **Тест 3 (LLM guard):** `enable_llm_summary=true` → ожидаемая ошибка на `LLM Summary Guard`. Вернуть `false`.

**Симуляция сборки (vm-sandbox, 20 проверок PASS):** выбор последнего/предыдущего прогона, топ-сортировки,
тренды ↑/↓/NEW, no_data-путь, 20/21 колонок, пустая вкладка планов → понятная ошибка, $0-инварианты.

## 4. Путь к Claude/Telegram (будущее, отдельные одобрения — DEC-112)

1. **Claude summary:** только после явного одобрения; bounded facts-only prompt (строки WF10-вкладок + статистика
   прогона, НИКОГДА сырые контактные поля); токен-кэп; результат — в `llm_summary`/`llm_recommendations` РЯДОМ с
   детерминированными секциями (не вместо); стоимость — в `llm_cost_usd` + `agent_requests` + `COSTS_AND_LIMITS.md`.
2. **Telegram-доставка:** короткий дайджест из ряда отчёта (рендер в `MARKET_INTELLIGENCE_REPORT_SCHEMA.md` §4);
   токен бота только в креденшлах n8n; allowlist chat-id.
3. **Control-команды / Business Agent Control Kernel** — `docs/TELEGRAM_CONTROL_AGENT_PLAN.md`.

## 5. Чего НЕ делает

- НЕ вызывает Claude (guard); НЕ шлёт в Telegram; НЕ ходит в сеть (нет HTTP-нод).
- НЕ пишет в WF10-вкладки/raw/registry/бизнес-вкладки — только `market_intelligence_reports` + `agent_requests`.
- НЕ выдумывает факты, числа, конкурентов, тренды; НЕ показывает контакты; НЕ рекомендует outreach.
- НЕ запускается по расписанию (только ручной триггер).

---

## v0.3 (2026-06-12, DEC-128/129/130) — stakeholder-отчёт + рабочий (но выключенный) Claude-путь

**Детерминированная часть (по умолчанию, $0):**
- Дайджест руководителя: 5–7 чистых пунктов (конкуренты, главный угол, аудитория, лид-сигналы, сайты,
  достоверность, фокус контента).
- Чистые имена конкурентов: вместо «(unnamed) <длинный оффер>» — «<Platform> offer: <короткий оффер>»;
  офферы укорочены (`max_offer_chars=90`).
- Блок «Сайты конкурентов»: последний снапшот на домен из `competitor_site_snapshots`
  (офферы/цены/гарантии/CTA/изменения); вкладка может отсутствовать — отчёт не падает.
- Блок «Аудитория и публичные лид-сигналы»: агрегаты `audience_activity_signals` + `public_lead_signals`
  (счётчики по intent/pain; БЕЗ имён/контактов/профилей).
- Блоки действий: менеджер / контент / источники; ограничения + обязательный source_mix.
- Схема строки — 25 колонок (MARKET_INTELLIGENCE_REPORT_SCHEMA.md v0.3): llm-блок разбит на
  `llm_status/llm_model/llm_input_tokens/llm_output_tokens/llm_cost_usd/llm_summary_ru/llm_recommendations_ru/llm_quality_flags`.
- Каждый прогон пишет 1 строку в `live_source_runs` (mode=deterministic или llm_summary).

**Claude-путь (operator-test-ready; в репозитории ВЫКЛЮЧЕН и без ключей):**
1. Подготовка (по явному одобрению): создать Anthropic-креденшл в n8n (header `x-api-key`), привязать к
   HTTP-ноде «Claude Summary API Request», ВКЛЮЧИТЬ её.
2. В Set Report Config: `enable_llm_summary=true`, `llm_approval_token=I_APPROVE_CLAUDE_REPORT_SUMMARY`;
   бюджет: `llm_max_input_chars=8000`, `llm_max_tokens=1200`, `llm_max_estimated_cost_usd=0.10`.
3. Execute once → промпт получает ТОЛЬКО поля детерминированного отчёта + агрегаты; Claude обязан вернуть
   JSON: executive_summary_ru / key_findings / market_risks / recommended_next_actions /
   content_recommendations / source_limitations; запрещено выдумывать конкурентов/контакты/цены/разрешения
   на аутрич.
4. Проверки после прогона: `llm_status=ok` (или ok_with_flags — разобрать флаги), llm_input_tokens /
   llm_output_tokens / llm_cost_usd заполнены; agent_requests.result_summary содержит стоимость;
   live_source_runs (mode=llm_summary, llm_calls=1); summary не содержит фактов вне отчёта;
   записать стоимость в COSTS_AND_LIMITS.md.

**Guard-тесты (без затрат):**
- enable_llm_summary=true без токена → ошибка на Claude Summary Approval Gate.
- с токеном, но `llm_max_estimated_cost_usd=0.0001` → ошибка budget guard ДО HTTP-ноды.
- HTTP-нода disabled → merge-нода бросает ошибку (фиктивное резюме невозможно).
