# N8N_WORKFLOW_14_PUBLIC_LEAD_SIGNAL_TRIAGE_RU.md — WF14: триаж публичных лид-сигналов

**Статус:** BUILT v0.1 (2026-06-12) · детерминированный, $0, без Claude · **Решение:** DEC-130
**Файл:** `n8n/workflows/14_public_lead_signal_triage.json` (`active=false`, только ручной запуск)
**Связано:** `PUBLIC_LEAD_SIGNAL_LAYER.md`, `TABLE_SCHEMA.md` (public_lead_signals, 28 колонок),
`CONTACT_AND_OUTREACH_POLICY.md` (обязательная политика).

---

## 1. Что делает

Перечитывает `review_queue` + `raw_market_records` (только публичные комментарии/вопросы/отзывы:
`record_type_hint=question_objection`, `touchpoint_type` ∈ public_comment/forum_discussion/review_source),
детерминированно классифицирует боли и намерения и пишет строки в `public_lead_signals` + одну строку в
`agent_requests`. Дедуп против уже записанных сигналов: `post_url` + text_hash.

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

## 4. Операторские тесты ($0)

**Тест 1 (после WF13→WF08 handoff):** Execute once → ожидаемо:
- ≥2 строки `public_lead_signals` из VK-комментариев Анны:
  - вопрос «кто брал кредит после отказов… сколько стоит» → pain: after_refusal, bad_credit_history,
    overdue_debt, broker_price_question; intent=buying_intent; recommended_action=manual_review;
    contact_use_policy=aggregate_only (контакта в тексте нет);
  - возражение «боюсь мошенников… предоплата» → pain: prepayment_fear, fraud_fear; intent=objection;
    recommended_action=content_idea; objection_score≥50;
- `agent_requests` +1 (request_type=public_lead_signal_triage, status=completed, $0);
- ни одна строка не содержит рекомендации связаться с автором; Claude calls=0.

**Тест 2 (повтор):** Execute once ещё раз → signals_written=0 (дедуп по post_url+text_hash),
agent_requests +1 с `no_signals;` или `signals_written=0` в result_summary.

**Тест 3 (контакт):** строка с контактом `+7…` (пост конкурента НЕ попадает — он не audience-тип;
проверка на live-данных позже) → contact_public отображается текстом без `#ERROR!`,
contact_use_policy=manual_review.
