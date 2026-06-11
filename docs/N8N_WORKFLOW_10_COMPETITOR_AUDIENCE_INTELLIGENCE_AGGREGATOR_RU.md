# N8N_WORKFLOW_10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_RU.md — Workflow 10 (Aggregator v0.1)

**Workflow:** `n8n/workflows/10_competitor_audience_intelligence_aggregator.json`
**Имя:** `10 - Competitor Audience Intelligence Aggregator`
**Статус:** 🔧 ПОСТРОЕН v0.1 (DEC-104), ожидает первый прогон оператора. `active=false`. Детерминированный, $0.
**Дата:** 2026-06-11 · **Решения:** DEC-104 (WF10 v0.1) · DEC-099 (план/гейт) · DEC-102 (Stage 3.3 закрыт — гейт выполнен).
**Спецификация таблиц:** `docs/WF10_TABLE_SCHEMAS.md` · **План:** `docs/WF10_COMPETITOR_AUDIENCE_INTELLIGENCE_AGGREGATOR_PLAN.md`.

> **WF08 отвечает: «что это за одна запись?». WF10 отвечает: «что происходит на рынке в целом?».**
> v0.1 — полностью **детерминированная** агрегация: без LLM, без Apify/Firecrawl, без внешних API, стоимость $0.
> Только агрегатный анализ аудитории (политика контактов): без авторов, без контактов, без outreach-рекомендаций.

---

## 1. Архитектура (22 ноды)

```
Manual Start
  → Set Aggregator Config            (code; окно 30 дней, фильтры, MSK id/timestamps)
  → Read monitor_queue → Read content_queue → Read review_queue → Read source_confidence_rules
  → Aggregate Market Intelligence    (code; ВСЯ детерминированная логика)
       ├→ Build competitor_profiles Rows        → Append competitor_profiles
       ├→ Build market_angles Rows              → Append market_angles
       ├→ Build audience_activity_signals Rows  → Append audience_activity_signals
       ├→ Build content_positioning_plan Rows   → Append content_positioning_plan
       ├→ Build source_confidence_rules Rows    → Append source_confidence_rules   (seed только если вкладка пуста)
       └→ Build agent_requests Row              → Append agent_requests → Final Summary Output
```

Read-ноды: `alwaysOutputData` + `onError=continueRegularOutput` — отсутствующая/пустая вкладка не роняет прогон.

## 2. Конфигурация (`Set Aggregator Config`)

| Поле | По умолчанию | Назначение |
|------|--------------|-----------|
| `time_window_days` | **30** | окно агрегации (по `created_at` строк бизнес-вкладок; строки без даты исключаются) |
| `niche_id` | `credit_brokerage` | метаданные ниши (словарь v0.1 захардкожен; нишевые пакеты — DEC-100) |
| `platform_filter` | `''` | точное совпадение platform (пусто = все) |
| `region_filter` | `Москва/МО` | подстрочное совпадение в обе стороны; пустой region строки НЕ отфильтровывается |
| `service_type_filter` | `''` | точное совпадение service_type |
| `max_examples_per_item` | 3 | максимум примеров URL/офферов в строке |
| `write_confidence_seed_rules_if_empty` | true | сидировать 7 правил доверия, только если вкладка пуста |
| `agent_request_id` / `run_id` / `created_at` | `wf10_req_<МСК>` / `wf10_<МСК>` / `+03:00` | как в WF07/09 |

## 3. Логика агрегации (детерминированная)

1. **Окно/фильтры:** строки monitor/content/review с парсируемым `created_at` внутри окна + фильтры.
2. **Группировка конкурентов** (строки `entity_type=competitor` или вкладка monitor_queue), ключ по приоритету:
   `company_name` → `profile_name` → нормализованный `offer_text`+platform → listing id из `source_url`.
3. **competitor_profiles (17 колонок):** офферы/цены/семантика/боли/каналы/сильные-слабые стороны/evidence_count/
   `source_confidence_score` (80 — есть цена; 60 — ≥2 свидетельства; 45 — одиночное).
4. **market_angles (9):** 9 фиксированных углов — скорость, ценовой якорь («от N ₽»), без предоплаты, оплата за
   результат, после отказов, плохая КИ/просрочки, бизнес-финансы (ИП/ООО), ипотека/рефинанс, договор/гарантии.
   frequency + примеры + рекомендованный контент-ответ; confidence high ≥3 / medium 2 / low 1.
5. **audience_activity_signals (14):** по 1 строке на платформу; **только агрегаты** — счётчики авторов для
   классифайдов пустые (не выдумываются), buying_intent = строки с `lead_signal_score≥50`.
6. **content_positioning_plan (12):** 1 строка/прогон — топ-3 угла, посты/объявления/FAQ/контраргументы/
   лид-магниты (детерминированные шаблоны), source_evidence, `next_action` без outreach.
7. **source_confidence_rules (5):** 7 seed-правил, только если вкладка пуста; дальше курирует оператор.
8. **agent_requests:** 1 строка (21 колонка, `status=completed`, `request_type=market_intelligence_aggregation`),
   `result_summary` со счётчиками; стоимость 0.

## 4. Импорт и первый прогон

1. **Создать 5 вкладок** с заголовками из `docs/WF10_TABLE_SCHEMAS.md`: `competitor_profiles` (17),
   `market_angles` (9), `audience_activity_signals` (14), `content_positioning_plan` (12),
   `source_confidence_rules` (5).
2. Импортировать WF10 (НЕ активировать). Перепривязать креденшл Google Sheets на 10 sheet-нодах; заменить
   `PASTE_SPREADSHEET_ID_HERE` на реальный ID.
3. **Execute Workflow** один раз.

### Ожидаемо (после Stage 3.3: 2 live-конкурента в monitor_queue)
- `competitor_profiles` **+2** (КредитЭксперт-подобные группы из live-строк, confidence 80 у строки с ценой);
- `market_angles` **+N** (минимум: скорость, ценовой якорь, договор/гарантии, после отказов — по live-данным);
- `audience_activity_signals` **+1** (avito, агрегатная, авторы пустые);
- `content_positioning_plan` **+1**; `source_confidence_rules` **+7** (первый прогон); `agent_requests` **+1**;
- `Final Summary Output`: счётчики rows_considered/in_window/after_filters + next_action;
- стоимость **$0**; 0 внешних вызовов; технических ошибок нет.

### Повторный прогон
- `source_confidence_rules` **+0** (seed только при пустой вкладке); остальные вкладки — новый snapshot
  (append-only v0.1; upsert competitor_profiles — v0.2).

## 5. Чего НЕ делает v0.1

- НЕ вызывает Claude/Apify/Firecrawl/внешние API (LLM-синтез — возможный v0.2, только с одобрением на прогон).
- НЕ пишет в raw_market_records / market_record_registry / бизнес-вкладки маршрутизации.
- НЕ выдумывает контакты и НЕ рекомендует outreach (DEC-097/098).
- НЕ строит графовую логику (Market Graph Engine — backlog №3).
- НЕ запускается по расписанию; `active=false`, только ручной старт.
