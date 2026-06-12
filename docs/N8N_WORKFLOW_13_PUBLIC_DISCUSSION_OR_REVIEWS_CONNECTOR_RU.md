# N8N_WORKFLOW_13_PUBLIC_DISCUSSION_OR_REVIEWS_CONNECTOR_RU.md — Workflow 13 (VK Public Discussions, foundation)

**Workflow:** `n8n/workflows/13_public_discussion_or_reviews_connector_foundation.json`
**Имя:** `13 - Public Discussion Connector Foundation (VK Public Groups)`
**Статус:** 🔧 ПОСТРОЕН foundation v0.1 (DEC-121). `active=false`, `fixture_mode=true`, `live_mode=false`.
Детерминированный, $0, **в воркфлоу нет ни одной HTTP-ноды** — live-режим НЕ реализован (guard с ошибкой).
**Дата:** 2026-06-12 · **Решения:** DEC-121 (выбор источника = VK public), DEC-096 (один источник за раз),
DEC-097/098/114 (политика контактов), DEC-119 (handoff в WF08 при llm_enabled=false).
**Стратегия:** `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md`, матрица `docs/SOCIAL_CLASSIFIED_SOURCE_MATRIX.md`.

## 1. Почему VK (решение DEC-121)

Сравнивались три кандидата на третий источник после Avito (WF09) и Telegram (WF11):

| Вариант | Даёт | Вердикт |
|---|---|---|
| **A. VK public groups/posts/comments** | боли аудитории, вопросы, возражения, активные обсуждения, агрегаты авторов | ✅ **выбран** |
| B. Reviews/Maps (Zoon/Яндекс/2GIS) | репутация конкурентов, жалобы, trust-сигналы | рекомендуемый 4-й источник |
| C. Dzen | контент/SEO-семантика конкурентов | позже |

Обоснование: Avito и Telegram оба дают **конкурентную рекламу**; самая слабая вкладка WF10 —
`audience_activity_signals` (questions/objections/complaints/buying_intent/active_authors). VK public
обсуждения закрывают именно этот разрыв. Это же соответствует порядку матрицы источников
(Avito → Telegram → VK API → reviews/maps → Dzen).

## 2. Жёсткие ограничения

- Только ПУБЛИЧНЫЕ группы/посты/комментарии. **Никаких** приватных чатов/сообщений, выгрузки участников,
  скрытых контактов, рекомендаций аутрича.
- `contact_public` — только если контакт дословно виден в публичном тексте (телефон/@handle);
  `contact_channel` = категория канала (phone/telegram…, НЕ `handle` — DEC-114); формат и evidence URL — в notes.
- `profile_url` автора — только если профиль публичный (`author_profile_public=true` в фикстуре).
- Агрегаты авторов (`active_author_count`/`repeat_author_count`) — только счётчики по UNIQUE-записям,
  никогда не списки участников и не цели аутрича.
- Без Claude. Без авто-handoff в WF08. Пишет только agent_requests / raw_market_records (40) /
  market_record_registry (15). MSK `+03:00`. Дедуп и hard-negative фильтр — паттерн WF09/WF11
  (hard-skip ДО registry и ДО pipeline_limit).

## 3. Архитектура (16 нод)

```
Manual Start → Set Connector Config → IF fixture_mode?
  true  → Build Fixture VK Group Items → Normalize VK Items → Read market_record_registry
          → Deduplicate Items → Build raw_market_records Rows → Append raw_market_records
          → (Build registry Rows → Append registry) + (Build agent_requests Row → Append agent_requests)
          → Final Summary Output
  false → LIVE Mode Guard (not implemented) — throw
```

Классификация в Normalize: конкурентное объявление (strong-словарь + признаки рекламы) →
`competitor_activity`/`monitor_queue`; вопрос/возражение (QUESTION/OBJECTION-словари + niche evidence) →
`question_objection`/`forum_discussion`/`review_queue` (lead_intent medium/low, temperature warm);
слабый финансовый контент → `market_signal`/`content_queue`; hard-negative (юр. адрес, регистрация ООО…)
→ hard_skip.

## 4. Fixture-тесты (операторские)

1. **Тест 1 (первый прогон):** items_received=6, business_relevant=5, hard_skipped=1, unique=4,
   duplicates=1 (in-batch дубль поста 201), raw +5, registry +4, agent_requests +1;
   `active_author_count=3`, `repeat_author_count=1` (Анна: 2 комментария), `question_objection_unique=2`.
   Контакты: только пост 201 (`contact_public=+7 999 000-11-22`, `contact_channel=phone`,
   notes: contact_format/contact_source_url/contact_use_policy=manual_review). Автор без публичного
   профиля (`id_fin_editor_fixture`) — `profile_url` пустой.
2. **Тест 2 (повтор):** unique=0, duplicates=5, registry +0.
3. **Тест 3 (guard):** `fixture_mode=false` → ошибка `WF13 live_mode is not implemented…`.
4. **Handoff в WF08** (после одобрения, $0): `agent_request_id_filter=<первый wf13_req_*>`,
   `platform_filter=vk`, `llm_enabled=false` → ожидаются: конкурентный пост → monitor_queue
   (deterministic_pre_route), вопросы/возражения → review_queue, market signal → content_queue
   ИЛИ review_queue с `parse_method=deterministic_uncertain_no_llm` (cost-control, DEC-119);
   `technical_errors=0`, Claude=0.

## 5. Live-режим (НЕ реализован — план)

Включение live потребует, по порядку: явное одобрение оператора → выбор транспорта (официальный VK API
community/wall/comments-методы с токеном в n8n credential, или Apify VK actor) → привязка credential →
оценка стоимости в COSTS_AND_LIMITS.md. `live_*` поля конфига — плейсхолдеры; guard срабатывает
независимо от их значений. Allowlist-only, max_items_per_group=10.

---

## v0.2 (2026-06-12, DEC-124/125/126) — live-готовность VK + фиксы

**Изменения:**
1. **Фикс `#ERROR!` (DEC-124):** `contact_public` с ведущим `+`/`=` пишется с апострофом —
   `+7 999 000-11-22` отображается текстом.
2. **`touchpoint_type=public_comment` (DEC-125):** бизнес-релевантные КОММЕНТАРИИ VK; посты по-прежнему
   `competitor_content_post` / `forum_discussion`.
3. **Метка этапа:** `stage_3_source_foundation_vk_public_discussion` (в notes raw-строк и registry).
4. **Охраняемый live-путь (DEC-125):** `LIVE VK Approval Gate` (token
   `I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION` + непустой `live_group_allowlist`, отказ инвайтам/приватным) →
   ОТКЛЮЧЁННАЯ HTTP-нода **официального VK API `wall.get`** (access_token ТОЛЬКО как n8n-креденшл;
   `wall.getComments` добавится в live-сессии) → инертный парсер (ошибка без ответа API — выдуманные
   записи невозможны). Только публичные группы/посты/комментарии; никаких приватных сообщений, закрытых
   групп, выгрузки участников, скрытых контактов, авто-аутрича; агрегаты авторов только счётчиками.
5. **Журнал (DEC-126):** каждый прогон пишет 1 строку в `live_source_runs`.

**Тесты v0.2 (fixture, $0):**
- Тест 1: прежние счётчики (6/5/1/4/1, raw +5, registry +4) + `live_source_runs` +1; телефон поста 201 —
  текстом без `#ERROR!`; комментарии Анны — `public_comment`; notes — новая метка этапа.
- Тест 2 (повтор): unique=0 / dups=5 / registry +0; runlog +1.
- Тест 3 (guard): fixture_mode=false, токен пуст → ошибка на `LIVE VK Approval Gate`
  (HTTP-нода остаётся DISABLED). Вернуть fixture_mode=true.

**Включение live (отдельное одобрение, НЕ в этой сессии):** токен + allowlist публичных групп +
VK-креденшл в n8n + включить HTTP-ноду; ожидаемая стоимость $0 (официальный API, публичные стены),
лимиты — по quota VK; прогон логируется в live_source_runs.
