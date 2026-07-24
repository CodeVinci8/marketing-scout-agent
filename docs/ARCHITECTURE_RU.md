# Vinci AI Pilot — архитектура и карта workflow

Компактная карта системы для оператора. Подробности приёмки — в `docs/STAGE_F_ACCEPTANCE.md`,
решения — в `docs/DECISIONS.md`.

## Стек

| Слой | Технология |
|---|---|
| Оркестрация | n8n (self-hosted, Docker, VPS Ubuntu 24.04) |
| Сбор | Firecrawl (сайты), Apify (классифайды), официальный VK API, Telegram |
| Анализ | Claude API (`claude-sonnet-4-6`), доказательно-привязанный |
| Хранение | Google Sheets (44 таба-контракта) |
| Уведомления | Telegram Bot |
| Общий движок | `n8n/lib/*.js` — встраивается в Code-узлы генератором |

## Принцип генерации workflow

Экспорты n8n НЕ редактируются вручную. Источник истины — генератор
`tools/gen_stage4_workflows.js`, который встраивает библиотеки `n8n/lib/*.js` в Code-узлы
(`stripCore`, проверка дрейфа). Регенерация побайтово стабильна (идемпотентна). Все закоммиченные
экспорты имеют `active: false` (проверяется CI).

Изменение логики → правка `n8n/lib/*.js` → `node tools/gen_stage4_workflows.js` → тесты → деплой.

## Карта workflow

Активный агентский стек — WF17–WF28. WF00–WF16 — компоненты и тесты ранних стадий.

| ID | Workflow | Роль |
|---|---|---|
| WF17 | Agent Settings & Config Loader | Загрузка центральной конфигурации и флагов. |
| WF18 | Telegram Agent Gateway | Безопасный диспетчер входящих (webhook, allowlist пользователей, секрет). |
| WF19 | Request Planner | Детерминированное планирование запроса + управляемый Claude. |
| WF20 | Agent Orchestrator | Ядро: одобрение → сбор → WF16 (качество) → WF08 (анализ) → WF10 (агрегация) → WF12 (отчёт) → доставка. Здесь строится XLSX и компактный Telegram-ответ. |
| WF21 | Deep Competitor Analysis | Углублённый анализ (bounded, доказательный). |
| WF22 | Conversation Control & Sources | Управление диалогом и списком источников. |
| WF23 | Scheduled Tracked Source Monitor | Рекуррентный мониторинг (**неактивен по умолчанию**). |
| WF24 | Report Export, Filter, Compare, Refresh & Delivery | Выгрузка/фильтр/сравнение/обновление отчётов и доставка. |
| WF25 | Weekly Digest | Еженедельный дайджест из сохранённых данных. |
| WF26 | VK Public Community Collector | Сбор из VK по официальному API (**выключен по умолчанию**). |
| WF27 | Cross-Source Competitor Discovery | Поиск конкурентов (Firecrawl Search, bounded). |
| WF28 | Claude Analyst (Stage F) | Доказательно-привязанный анализ; feature-gated. |

Вспомогательные ранние workflow: WF04 (Firecrawl URL-list), WF08 (Touchpoint Analyzer), WF09 (Avito),
WF10 (агрегатор), WF12 (сборщик отчёта), WF16 (ворота качества источника), WF13/WF14 (VK-источник, Stage D).

## Контракт данных отчёта (WF04 → WF20)

Детерминированный учёт источников вычисляется ОДИН раз в `execution_summary.sourceAccounting` и
пробрасывается в бандл (узел `Shape Report Bundle`):

- Корзины по типизированному состоянию каждого источника: `reuse` / `fresh` / `rejected`;
  `contributing = reuse ∪ fresh`.
- Число свежесобранных источников НИКОГДА не выводится из числа внешних вызовов.
- Счётчик внешних вызовов (`external_calls_actual`) — отдельная величина.
- «Собрано заново» = только свежие; «в анализе» = участвовавшие (reuse+fresh) — три независимых числа
  (свежие ≠ участвовавшие ≠ вызовы).

## Рендеринг и правдивость

- XLSX: `report_package.js` (листы) + `xlsx_writer.js` (OOXML, серийные даты, МСК-сдвиг один раз).
- Telegram: `compact_report_ru.js` — один короткий структурный ответ, не markdown-простыня.
- Общие гарантии (единые для XLSX и Telegram): source-aware качество (fail-closed), структурная детекция
  универсальных заявлений с нейтральной припиской, гипотезы для «незанятых ниш», МСК-время из
  канонического `ms_time.instantOf`.

## Тесты и CI

- Офлайн-регрессия: `node tests/run_all.js` (= `make test`) — JS-наборы + Python-валидатор workflow +
  Lead Scout. Внешних вызовов 0, стоимость $0.
- GitHub Actions `offline-regression` (`.github/workflows/regression.yml`): `make test` + скан утечки
  секретов + проверка `active=false`. Триггеры: push в `main` и pull_request.
