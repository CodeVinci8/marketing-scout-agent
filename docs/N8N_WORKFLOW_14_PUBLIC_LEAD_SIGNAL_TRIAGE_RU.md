# N8N_WORKFLOW_14_PUBLIC_LEAD_SIGNAL_TRIAGE_RU.md — WF14: Lead Scout (триаж + скоринг)

> **v0.3 (2026-06-17, Stage 3.5, DEC-139) — переименован «Lead Scout Triage & Scoring».** Детерминированный
> **скоринговый движок**: читает audience-строки `raw_market_records` (ПЕРВИЧНО, без зависимости от WF08) +
> `review_queue` (обогащение); скоринг 0–100 (intent25+urgency15+pain20+niche15+contact8+region7+freshness10 −
> штрафы) → `lead_score`/`score_band`(high≥75/medium50-74/low25-49/ignore<25)/`review_priority`/
> `recommended_action`/`score_reasons`; извлечение ТОЛЬКО публичных контактов (verbatim; `contact_source_url`
> обязателен; бланк+`do_not_use` если публичность не подтверждается); мультиключевой дедуп; исключение
> рекламы/конкурентов; пишет `public_lead_signals` **v0.3 (47 колонок, TABLE_SCHEMA §G)** + `agent_requests`;
> self-test (read_once/cap/dedup/policy). **`outreach_allowed=false` всегда.** review_status:
> new → needs_review → accepted/rejected/duplicate/stale. Полная приёмка = пакет Stage C
> (`STAGE_C_ACCEPTANCE_PACK.md`). Раздел ниже (v0.2) — история.

> **Выравнивание по аудиту (DEC-140, 2026-06-17):** `review_priority` ∈ **{high, medium, low, ignore}** —
> точно повторяет `score_band` (`priorityOf`). При дефолтном `min_lead_score=25` строки полосы `ignore`
> отсекаются **до** записи, поэтому фактически пишутся только {high, medium, low}; `ignore` появится, только если
> оператор понизит `min_lead_score`. **Канонические таймстемпы:** `created_at` (время записи/append) / `updated_at`
> / `extracted_at` — колонки `append_timestamp`/`timestamp_appended` **не существует** ни под одним именем.
> `splitCmt()` извлекает `source_comment_url` из `post_url` с якорем `#reply`/`?reply=` и оставляет в
> `source_post_url` базовый пост, поэтому фикстурные и live-строки дают одинаковые dedup-ключи и `lead_signal_id`.

> **Stage C.1 (2026-06-19, DEC-141):** (B) `service_type` теперь **детерминированно-первичен** — `svcType()`
> по тексту-доказательству побеждает; неинформативная подсказка (`unknown`/пусто) НЕ перекрывает её, поэтому
> спрос «под залог ПТС» → **`pts_loan`** (а не `unknown`). (E) При нулевой записи диагностика
> `diagnoseZeroWrite()` называет реальную причину (8 случаев): для повторного прогона — «все N подходящих сигналов
> уже существуют (дедуп успешен), порог менять не нужно, собрать новые данные», а НЕ «понизьте min_lead_score»;
> добавлен счётчик `below_threshold_skipped`. (G) Изоляция прогона: `include_review_queue` (по умолчанию true;
> false — чтобы старые строки `review_queue` не загрязняли приёмку конкретного прогона WF13) и
> `source_agent_request_id` (фильтр `raw_market_records` по agent_request_id прогона WF13). Дефолты = прежнее
> поведение; закреплённые fixture-счётчики неизменны. Локальная проверка: `node n8n/fixtures/lead_scout/run_all.js`.

**Статус (история v0.2):** v0.2 (2026-06-16) — **ОПЕРАТОРСКИЙ РЕТЕСТ PASS** (TEST B: `public_lead_signals +4`,
`signals_written=4`, `duplicates_skipped=2`, без quota-ошибки; TEST C повтор: `+0`, `duplicates_skipped=6`;
TEST E full-history: без quota-ошибки) · детерминированный, $0,
без Claude · **Решение:** DEC-130 (+ **DEC-131** — патч квоты Google Sheets: single-read + scoped/capped + capped append)
**Файл:** `n8n/workflows/14_public_lead_signal_triage.json` (`active=false`, только ручной запуск)
**Связано:** `PUBLIC_LEAD_SIGNAL_LAYER.md`, `TABLE_SCHEMA.md` (public_lead_signals, 28 колонок),
`CONTACT_AND_OUTREACH_POLICY.md` (обязательная политика).

---

## 0. v0.2 PATCH (2026-06-16) — фикс квоты Google Sheets / item explosion

**Симптом (операторский тест):** нода `Append public_lead_signals` падала с
`The service is receiving too many requests from you`. Причина — линейная цепочка sheet-ридеров:
`Read review_queue` (15 строк) → `Read raw_market_records` исполнялась по разу на каждый входящий item,
`Read public_lead_signals` — ещё больше, итог 1410+ строк и тысячи API-запросов перед append (item explosion).

**Что изменено:**
- **Single-read архитектура:** между ридерами добавлены collapse-ноды (`Hold Config (before raw)`,
  `Hold Config (before pls)`), которые возвращают один control-item → каждая вкладка читается РОВНО ОДИН РАЗ.
  Данные доступны дальше через `$('Read ...').all()`.
- **Ограниченный пул кандидатов:** `Set Triage Config` получил реальный скоупинг — `max_source_rows=100`,
  `max_signals_to_write=25`, `min_signal_score=50`, `platform_filter`/`source_type_filter`,
  `only_untriaged`/`backfill_untriaged`. Кэп источника применяется ПОСЛЕ скоринга/сортировки/фильтра, чтобы
  не терять хорошие старые непротриаженные строки.
- **Append получает только усечённый список** (≤25 строк, один execution = один батч-запрос).
- **Дедуп усилен:** `lead_signal_id` теперь детерминированный хэш `platform|post_url|norm(text)|intent`
  (стабилен между прогонами) + fallback-ключ `platform|post_url|text_evidence|intent_type`.
- **Контролируемый no-data:** при отсутствии сигналов — маркер `_no_signals` (без падения), Final Summary
  status=`completed_no_data`.

## 1. Что делает

Перечитывает `review_queue` (основной источник) + `raw_market_records` (вторично, только audience-строки:
`record_type_hint=question_objection`, `touchpoint_type` ∈ public_comment/forum_discussion/review_source),
строит ограниченный пул кандидатов, детерминированно классифицирует боли/намерения, дедупит и пишет ≤25 строк
в `public_lead_signals` + одну строку в `agent_requests`. Дедуп против уже записанных сигналов:
`lead_signal_id` + fallback `platform|post_url|text_evidence|intent_type`.

- **pain_type:** after_refusal · bad_credit_history · overdue_debt · urgent_money_need · prepayment_fear ·
  fraud_fear · broker_price_question · mortgage_refinance_need · business_finance_need
- **intent_type:** question · objection · complaint · buying_intent · content_signal
- **Скоры 0–100:** urgency_score / intent_score / objection_score (по словарю, без LLM)
- **recommended_action:** manual_review / content_idea / monitor — НИКОГДА не аутрич.

## 2. Чего НЕ делает (жёстко)

Не вызывает Claude/внешние API; не пишет никуда, кроме `public_lead_signals` и `agent_requests`;
не использует приватные чаты/скрытые контакты/выгрузку участников; не рекомендует аутрич.
**Публичный profile_url = свидетельство (evidence), а НЕ разрешение писать человеку.**
`contact_use_policy`: `manual_review` (если в публичном тексте был контакт) / `aggregate_only` (иначе).
Контакты с `+7` пишутся Sheets-safe (апостроф, фикс #ERROR!, DEC-124).

## 3. Установка

1. Создать вкладку `public_lead_signals` (28 колонок — заголовки из `TABLE_SCHEMA.md`).
2. Импортировать воркфлоу, НЕ активировать.
3. Вставить SPREADSHEET_ID и перепривязать креденшл Google Sheets на 5 sheet-нодах (3 read + 2 append).

## 4. Граф (v0.2)

`Manual Start → Set Triage Config → Read review_queue → Hold Config (before raw) → Read raw_market_records →
Hold Config (before pls) → Read public_lead_signals → Build Candidate Pool & Classify → IF signals found? →
[true] Append public_lead_signals → Build agent_requests Row → Append agent_requests → Final Summary Output`
([false] ветка IF идёт сразу в `Build agent_requests Row`). Все ноды только: code / googleSheets / if /
manualTrigger / stickyNote. HTTP/Claude/Telegram/VK-нод нет.

## 5. Операторские тесты ($0)

**Тест 8 / Тест 1 (после WF13→WF08 handoff):** Execute once → ожидаемо:
- ≥2 строки `public_lead_signals` из VK-комментариев Анны:
  - вопрос «кто брал кредит после отказов… сколько стоит» → pain: after_refusal, bad_credit_history,
    overdue_debt, broker_price_question; intent=buying_intent; recommended_action=manual_review;
    contact_use_policy=aggregate_only (контакта в тексте нет);
  - возражение «боюсь мошенников… предоплата» → pain: prepayment_fear, fraud_fear; intent=objection;
    recommended_action=content_idea; objection_score≥50;
- `agent_requests` +1 (request_type=public_lead_signal_triage, status=completed, $0);
- ни одна строка не содержит рекомендации связаться с автором; Claude calls=0.

**Тест 9 / Тест 2 (повтор):** Execute once ещё раз → signals_written=0, `duplicates_skipped>0` (дедуп по
`lead_signal_id` + fallback), Final Summary status=`completed_no_data`, БЕЗ quota-ошибки, agent_requests +1.

**Тест 3 (контакт):** строка с контактом `+7…` → contact_public отображается текстом без `#ERROR!`,
contact_use_policy=manual_review, recommended_action ∈ {content_idea, manual_review} (никогда не аутрич).

**Проверка квоты:** в Final Summary `rows_read_review_queue` / `rows_read_raw_market_records` /
`rows_read_existing_public_lead_signals` показывают по одному чтению каждой вкладки; ни одна нода не
исполняется по разу на item.

## 6. Локальная симуляция (2026-06-16, $0, без live)

Прогон логики `Build Candidate Pool & Classify` на двух VK-фикстурах:
- вопрос Анны → pain `after_refusal, bad_credit_history, overdue_debt, broker_price_question`,
  intent=`buying_intent`, intent_score=100, recommended_action=`manual_review`, policy=`aggregate_only`;
- возражение Игоря (`+7 999 000-11-22`) → pain `prepayment_fear, fraud_fear`, intent=`objection`,
  objection_score=100, recommended_action=`content_idea`, policy=`manual_review`, контакт записан как текст
  с апострофом (`'+7…`).
- Повтор: signals_written=0, duplicates_skipped=2, маркер `_no_signals`. Запрещённых действий нет.
