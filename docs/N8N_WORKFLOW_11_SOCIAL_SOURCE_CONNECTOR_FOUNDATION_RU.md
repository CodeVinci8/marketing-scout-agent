# N8N_WORKFLOW_11_SOCIAL_SOURCE_CONNECTOR_FOUNDATION_RU.md — Workflow 11 (Telegram Public Channel Preview, foundation)

**Workflow:** `n8n/workflows/11_social_source_connector_foundation.json`
**Имя:** `11 - Social Source Connector Foundation (Telegram Public Channel Preview)`
**Статус:** ✅ **FIXTURE FOUNDATION PASS + v0.4.1 пост-уровневая релевантность + 🔧 v0.4.2 ФИНАЛЬНЫЙ QUALITY
GATE Stage 3 (DEC-135, 2026-06-17): adjacent-класс по недвижимости + gate-защищённый транспорт.** По умолчанию
`active=false`, `fixture_mode=true`, `live_mode=false`. Fixture-режим = $0. **Live-путь реален, но инертен по
умолчанию через гейт одобрения:** транспорт-ноды включены, но недостижимы, пока гейт не пропустит (токен +
непустой валидированный список **отслеживаемых каналов** + выбранный транспорт). Безопасность = гейт +
валидация + капы, а не ручное отключение нод. Подробности — патч v0.4.2 и план приёмки (≤5 тестов) в конце файла.

> **ПАТЧ v0.4 (DEC-132) — реальный, но gated live-транспорт публичного preview `t.me/s/<channel>`.**
> - **Транспорт:** `live_transport` = `firecrawl` (предпочтительно, если есть креденшл Firecrawl) или `http_get`
>   (fallback, без поштучной платы). Маршрут — нода `Route Live Transport` (IF). **Обе транспорт-ноды `disabled`.**
> - **Гейт:** принимает username ИЛИ `https://t.me/s/<channel>` / `https://t.me/<channel>`, нормализует в username;
>   ОТКЛОНЯЕТ `t.me/+`, `joinchat`, `t.me/c`, группы, `+`-ссылки, числовые id; капы `live_max_channels<=2`, `max_posts<=10`.
> - **Парсер:** из preview-HTML (`tgme_widget_message`) извлекает channel, post_url, дату, текст, **view_count (опц.)**,
>   публичный контакт дословно; понимает Firecrawl (`data.html`) и HTTP (текст); нет HTML → ошибка (инертность).
> - **Стоимость** в agent_requests + live_source_runs: `http_get`=$0, `firecrawl`=`cost_not_recovered` (записать факт после прогона).
> - **БЕЗ:** Telegram Bot API для сбора, MTProto, user-сессий, групп/приватных чатов, выгрузки участников, авто-аутрича. `llm_calls=0`.
> - **Парность с fixture** сохранена (6/5/1/4/1). Санитизированный sample парсера: `n8n/fixtures/wf11_tme_s_preview_sample.html`.
**Дата:** 2026-06-12 · **Решения:** DEC-109 (выбор источника), DEC-110 (foundation, fixture-first),
DEC-114 (contact_channel — категория канала, не формат), DEC-116 (fixture PASS + live v0.2 план),
DEC-096 (один источник за раз), DEC-097/098 (политика контактов).
**Стратегия:** `docs/STAGE_3_4_SOCIAL_SOURCE_PARSING_STRATEGY.md` §5.

> **ПАТЧ v0.2 (DEC-120) — ОХРАНЯЕМЫЙ live-путь (инертен по умолчанию).** Live-ветка теперь:
> `LIVE Preview Approval Gate` (бросает ошибку, если `live_approval_token!=='I_APPROVE_LIVE_TELEGRAM_PREVIEW'`
> или пустой `live_channel_allowlist`; отвергает группы/инвайт-ссылки/приватные записи) →
> **ОТКЛЮЧЁННАЯ** HTTP-нода (GET `https://t.me/s/<channel>` — только публичные preview-страницы, без
> credentials) → `Parse Live Preview Posts (inert)` (бросает ошибку без HTML — сфабрикованные посты
> невозможны; при реальном HTML парсит tgme_widget_message, cap `live_max_posts_per_channel<=10`).
> `Normalize Telegram Posts` читает `$input` — fixture и live ветки используют одну нормализацию;
> fixture-счётчики НЕ изменились (6/5/1/4/1; повтор 0/5 — перепроверено симуляцией).
> Запуск live требует ДВУХ осознанных действий оператора: токен в конфиге + включение HTTP-ноды.
> Скоуп прежний: allowlist-only публичные каналы; никаких групп/приватных чатов/MTProto/выгрузки
> участников/скрытых контактов/auto-outreach. Live в этой сессии НЕ выполнялся.

> **Результаты операторских fixture-тестов (2026-06-12) — ВСЕ PASS, $0, без внешних вызовов и Claude:**
> - **Тест 1** (`agent_request_id=wf11_req_20260612_033442`): posts_received=6, structurally_valid=6,
>   invalid=0, business_relevant=5, hard_skipped=1, unique=4, duplicates=1, over_pipeline_limit=0 →
>   raw_market_records +5, market_record_registry +4, agent_requests +1. **PASS.**
> - **Тест 2** (повтор, `wf11_req_20260612_033756`): unique=0, duplicates=5, registry +0,
>   duplicate-audit строки в raw. **PASS.**
> - **Тест 3** (live guard, `fixture_mode=false`): корректная остановка на `LIVE Mode Guard` с ошибкой
>   «WF11 live_mode is not implemented…», внешних вызовов нет. **PASS.**
>
> **Патч v0.1.1 (DEC-114), после тестов:** Тест 1 записал `contact_channel=handle` — это формат, а не
> категория канала. Исправлено: Telegram-@handle → `contact_channel=telegram`; в `notes` добавляются
> `contact_format=handle`, `contact_source_url=<post_url>`, `contact_use_policy=manual_review`; строки без
> контакта пишут пустой `contact_channel` (раньше — нестандартное `none`). Fixture-поведение и счётчики не
> изменились (симуляция 24 проверки PASS). Допустимые `contact_channel`: phone, email, telegram, profile,
> form, unknown.

> Первый non-Avito коннектор. Шаблон — проверенный WF09: fixture-first → валидность → business relevance →
> registry dedup → запись ТОЛЬКО в `agent_requests` / `raw_market_records` / `market_record_registry` →
> ручной handoff в WF08. Никаких приватных чатов, групп, MTProto, скрытых контактов, outreach.

---

## 1. Архитектура (17 нод)

```
Manual Start
  → Set Connector Config            (fixture_mode=true, live_mode=false, allowlist каналов, MSK ids)
  → IF fixture_mode?
       ├ true  → Build Fixture Telegram Channel Posts   (6 постов, каналы *_fixture — НЕ реальные)
       └ false → LIVE Mode Guard (not implemented)      (throw: live требует одобрения+транспорта+креденшла)
  → Normalize Telegram Posts        (валидность → strong/weak/hard-negative → контакты дословно → dedup_key)
  → Read market_record_registry
  → Deduplicate Posts               (registry + in-batch; hard-skip ДО raw/registry; pipeline cap)
  → Build raw_market_records Rows (40) → Append raw_market_records
       → Build market_record_registry Rows (15, только unique) → Append market_record_registry
       → Build agent_requests Row (21) → Append agent_requests → Final Summary Output
```

## 2. Ключевые правила

- **Источник:** публичные превью-страницы каналов `https://t.me/s/<channel>` из явного allowlist оператора.
  Только каналы; никаких групп/комментаторов/участников. MTProto/клиентские сессии — запрещённый путь
  (отдельный risk review, не планируется).
- **Контакты (DEC-097/098, DEC-114):** `contact_public` — только дословно видимый в тексте поста @handle или
  телефон. `contact_channel` — **категория канала** (phone/email/telegram/profile/form/unknown), не формат:
  @handle → `contact_channel=telegram`. Формат и политика пишутся в `notes` строки:
  `contact_format=handle|phone`, `contact_source_url=post_url`, `contact_use_policy=manual_review`
  (в 40-колоночной схеме пока нет отдельных колонок). Ничего не реконструируется и не выдумывается.
- **Relevance (словарь v0.1, как в WF09; уйдёт в niche packs DEC-100):** strong-фразы → `competitor_activity`
  (confidence 70, predicted_route monitor_queue); слабые финансовые сигналы ≥2 → `market_signal` (45,
  content_queue); hard-negatives (юр. адрес, регистрация ООО/ИП, бухгалтерия…) без strong-evidence →
  `hard_skipped` — НЕ пишутся в raw/registry.
- **Dedup:** `dedup_key = telegram::social_channel::<canonical post_url>` (query/hash срезаются);
  registry + in-batch; duplicate-audit строки в raw (как WF09).
- **Никакого auto-handoff** в WF08; никаких записей в бизнес-вкладки. MSK `+03:00`; без голого
  `new Date().toISOString()`.

## 3. Импорт и тесты

1. НЕ активировать. Вкладки уже существуют (по WF07/WF09): `agent_requests` (21), `raw_market_records` (40),
   `market_record_registry` (15).
2. Перепривязать креденшл Google Sheets на 4 sheet-нодах (1 read + 3 append); заменить
   `PASTE_SPREADSHEET_ID_HERE` на реальный ID.
3. **Тест 1 (fixture, $0):** Execute once. Ожидаемо: `posts_received=6; structurally_valid_items=6;
   invalid_items=0; business_relevant_items=5; hard_skipped_items=1; unique=4; duplicates=1;
   over_pipeline_limit=0` → `raw_market_records +5` (4 unique + 1 duplicate-audit), `market_record_registry +4`,
   `agent_requests +1` (completed). Контакт только у поста 101 (`@kredit_broker_msk_fixture`, evidence в notes).
4. **Тест 2 (fixture повтор):** unique=0, duplicates=5, registry +0, raw +5 (duplicate audit);
   next_action: НЕ запускать WF08.
5. **Тест 3 (live guard):** `fixture_mode=false` → ошибка на ноде `LIVE Mode Guard (not implemented)` —
   это ожидаемое поведение. Вернуть `fixture_mode=true`.
6. **WF08 handoff (вручную):** использовать `agent_request_id` **ПЕРВОГО** прогона (unique>0), НЕ повторного.
   Проверенная конфигурация:
   `agent_request_id_filter='wf11_req_20260612_033442'`, `platform_filter='telegram'`, `source_type_filter=''`,
   `max_records=10`, `analysis_mode='deterministic_first'`, `llm_enrichment=false`,
   `llm_enrichment_test_mode=false`. Ожидаемо: unique/new competitor-посты → monitor_queue, market_signal →
   content/review_queue, `technical_errors=0`, Claude=0. Очистить фильтры после.

   > ⚠️ **Id повторного прогона даст 0 записей — это не баг.** Повторный (duplicate) прогон WF11 пишет только
   > duplicate-audit строки с `approval_status=duplicate`; дефолт WF08 `analyze_statuses=['approved','new']`
   > их корректно игнорирует (зафиксировано на `wf11_req_20260612_033756`). Анализ duplicate-строк возможен
   > только явным добавлением `duplicate` в `analyze_statuses` — не рекомендуется для нормального handoff.
   > Диагностика нулевой выборки: §"Диагностика" в `docs/N8N_WORKFLOW_08_TOUCHPOINT_ANALYZER_RU.md`.

**Симуляция сборки (vm-sandbox, 31 проверка PASS):** счётчики/схемы 40/15/21, политика контактов, дедуп
повторного прогона, live-guard, отсутствие httpRequest-нод, детерминизм.

## 4. Live v0.2 — план Telegram public-channel preview (СПРОЕКТИРОВАН, НЕ реализован; DEC-116)

Live НЕ входит в foundation; внешний транспорт требует **отдельного явного одобрения оператора**.
В конфиге уже есть **placeholder-поля v0.2** (ничего не включают; guard срабатывает независимо от них):
`live_transport='none_not_implemented'`, `live_channel_allowlist=[]`, `live_max_posts_per_channel=10`,
`live_requires_operator_approval=true`.

Жёсткие границы live v0.2:
- **Только allowlist публичных каналов** (явный список оператора) и **только публичные превью-страницы
  `https://t.me/s/<channel>`**. Никаких групп, приватных чатов, MTProto/клиентских сессий, логинов,
  member-данных, скрытых контактов, авто-outreach.
- `max_posts` по умолчанию 10 на канал; `live_mode=false` по умолчанию.
- Контакты — только если дословно видны в тексте публичного поста (политика DEC-097/098/114 без изменений).
- Пайплайн тот же (контракт коннектора): WF11 → agent_requests / raw_market_records / market_record_registry
  → WF08 → WF10 → report.

Порядок включения:
1. Явное одобрение оператора (отдельное, как для WF09 live).
2. Выбор транспорта: Firecrawl fetch страницы `t.me/s/<channel>` (предпочтительно — уже в стеке) или прямой
   HTTP GET; парсер DOM-превью (посты/даты/просмотры) — отдельный patch с фикстурами реальной разметки,
   сначала тестируется в fixture-режиме.
3. Креденшл только в n8n; лимиты: ≤2 канала, ≤10 постов превью на канал; стоимость записывается в
   `COSTS_AND_LIMITS.md` и `agent_requests`.
4. Ограничения превью честно фиксируются: только недавние посты, без комментариев, без авторов аудитории.

## 5. Чего НЕ делает

- НЕ ходит в сеть (нет HTTP-нод); НЕ вызывает Claude/Apify/Firecrawl.
- НЕ читает группы, приватные чаты, участников, комментаторов; НЕ использует MTProto/клиентские сессии.
- НЕ выдумывает контакты; НЕ рекомендует outreach; НЕТ auto-handoff в WF08.
- НЕ пишет business-вкладки/`url_registry`/WF10-вкладки.

---

## v0.3 (2026-06-12, DEC-124/126) — журнал прогонов + Sheets-safe контакты

- Каждый прогон (fixture и live) пишет 1 строку в `live_source_runs` (23 колонки, TABLE_SCHEMA §F):
  режим, allowlist, счётчики, external_calls, стоимость, next action. Значение токена НЕ логируется —
  только yes/no. Перед импортом создать вкладку `live_source_runs`.
- `contact_public` пишется Sheets-safe (DEC-124): значения с ведущим `+`/`=` получают апостроф —
  телефоны из live-постов не превращаются в `#ERROR!`.
- Live-путь (DEC-120) без изменений: token `I_APPROVE_LIVE_TELEGRAM_PREVIEW` + непустой allowlist +
  ВКЛЮЧЕНИЕ отключённой HTTP-ноды; ≤10 постов/канал; только `t.me/s/<channel>`; парсер бросает ошибку
  без HTML (выдуманные посты невозможны). Live в этой сессии НЕ выполнялся.

**Тест v0.3:** fixture-прогон — прежние счётчики (6/5/1/4/1) + `live_source_runs` +1
(mode=fixture, external_calls=0, cost=0).

---

## Патч v0.4.1 (DEC-133) — пост-уровневая бизнес-релевантность + корректный live `agent_requests`

**Проблема (первый live-smoke):** транспорт/парсер/дедуп работали, но релевантность была слишком широкой —
поздравления/личные/мотивационные посты записывались как бизнес-релевантные, рыночные новости повышались до
`competitor_activity`. Причина: `Normalize Telegram Posts` считал релевантность по `text + channel_title`, то
есть **название канала-конкурента само по себе** делало любой пост релевантным.

**Что изменено (`Normalize Telegram Posts`):**
- Релевантность считается **только по тексту поста**. Название/username канала и allowlist влияют **только** на
  `confidence`/метаданные и **никогда** не создают релевантность.
- Три набора пост-уровневых сигналов: `OFFER` (оффер/кейс/цена/CTA/комиссия/гарантия/позиционирование брокера) →
  `competitor_activity`; `MARKET` (новости по ставкам/программам/регулированию/спросу) → `market_signal`;
  `POSITIVE` (общие кредит/ипотека/брокер термины) → `market_signal`. Короткие токены (`ип/ки/цб/ооо/бки`) —
  по границам слова (Cyrillic-aware), без ложных подстрок.
- Нет пост-уровневых финансовых сигналов ⇒ `irrelevant_live_false_positive` → `hard_skip`: считается в
  `hard_skipped_items` / `irrelevant_false_positives`, **не пишется** в `raw_market_records` /
  `market_record_registry` по умолчанию. Опциональный аудит только при `live_debug_audit=true` (по умолчанию false).
- `competitor_activity` требует пост-уровневых офферных сигналов; рыночный дайджест на канале-конкуренте остаётся
  `market_signal`. **Без хардкода ID постов.**

**`Build agent_requests Row` (Task B):** в LIVE-режиме title/details/notes используют **реальный live-allowlist**
+ `source=live_preview` + `transport=firecrawl|http_get` (раньше логировался fixture-allowlist). `next_action`
требует `unique>0 && business_relevant>0`; при доминировании false positives предлагает поменять allowlist/конфиг
релевантности; авто-handoff нет. `live_source_runs` поведение сохранено.

**Fixture-счётчики не изменились:** 6 получено / 1 hard-neg / 5 релевантных / 4 unique / 1 dup; `false_positives=0`.

---

## Патч v0.4.2 (DEC-135, 2026-06-17) — финальный quality gate Stage 3 + adjacent-класс + gate-защищённый транспорт

**Зачем:** диагностический live-прогон `wf11_req_20260617_032817` (`ipotekapro`) после v0.4.1 показал остаточную
проблему: пост-уровневая релевантность стала строже к поздравлениям, но **смежные (adjacent) посты по
недвижимости** всё ещё проходили как `competitor_activity`/`market_signal` — реклама объектов/ЖК и набор
агентов в недвижимость. Для MVP ниши `credit_brokerage` это шум. Это финальный закрывающий патч Stage 3
(оператор устал от ручных ретестов — см. план приёмки ниже, ≤5 тестов).

**Что изменено (`Normalize Telegram Posts`) — пять пост-уровневых классов вместо трёх:**
1. `competitor_activity` — пост-уровневые доказательства брокер/кредит/ипотека-**услуги**: оффер, кейс, CTA,
   цена/комиссия, гарантия, «подберём банк», «кредит под залог», «рефинансирование», «одобрение», «после
   отказов — помогли», «оплата за результат» и т.п.
2. `market_signal` — рыночные/программные/ставочные/регуляторные **новости** без прямого оффера (дайджесты,
   изменения программ/господдержки, тренды спроса). Дайджест на канале-конкуренте остаётся `market_signal`.
3. `adjacent_real_estate_signal` (**НОВЫЙ**) — реклама объектов/ЛОТ/ЖК/новостроек, набор агентов/риелторов,
   маркетинг недвижимости со **слабым** ипотечным контекстом. **По умолчанию пропускается** (не пишется в
   `raw_market_records`/`market_record_registry`); считается в `adjacent_real_estate_skips`. Переопределяется в
   `competitor_activity` только при **явных сильных** брокер/кредит-сигналах (`STRONG_SERVICE`).
4. `irrelevant_live_false_positive` — поздравления, праздники, личный статус, болезнь/выздоровление,
   мотивация/лайфстайл без финансовых доказательств. Пропускается; считается в `irrelevant_false_positives`.
5. `hard_negative` — юр. адрес, регистрация ООО/ИП, бухгалтерия, несвязанный B2B. Пропускается.

**Жёсткое правило:** релевантность — **только текст поста**. Название/username канала, URL, **список
отслеживаемых каналов**, описание канала или контекст источника **сами по себе** не делают пост релевантным.
`4101` (изменения семейной ипотеки + сильный CTA «запишитесь на консультацию, подберём программу») при сильном
CTA трактуется как `competitor_activity` — выбор зафиксирован и последователен (сильный сервис-CTA > рыночный контекст).

**Task B — транспорт на gate-защите (как в остальных воркфлоу):**
- Транспорт-ноды переименованы: `Firecrawl Scrape t.me Preview (LIVE gated transport)` и
  `Fetch t.me Preview Page (HTTP fallback, LIVE gated)`; **сняты с `disabled`** (включены).
- Безопасность теперь = **гейт одобрения + валидация отслеживаемых каналов + капы**, а НЕ ручное отключение нод.
  Транспорт недостижим, пока `LIVE Preview Approval Gate` не пропустит: `live_mode=true` + точный токен +
  непустой валидированный список отслеживаемых каналов + выбранный транспорт. `Route Live Transport` гарантирует
  выполнение **только выбранного** транспорта (firecrawl ИЛИ http_get, не оба).
- Fixture-режим (по умолчанию) ветку гейта не трогает → `external_calls=0`. Пустой токен → гейт бросает ошибку
  до транспорта → `external_calls=0`. Оба свойства гарантированы графом.

**Терминология:** в операторских строках (`agent_requests`, `live_source_runs`, Final Summary) «allowlist»
заменён на «tracked channels / список отслеживаемых каналов». Внутреннее имя конфига `live_channel_allowlist`
сохранено для совместимости.

**Локальная симуляция (node, без сети):** 16/16 представительных сниппетов классифицированы как нужно —
скип: «С Днём России», «привет котятки…», «…выздоровления», «концепция двух часов», `4092` (набор агентов),
ЛОТ НЕДЕЛИ/ЖК; competitor: `1237/1245/4091/4093/4099`; market: `1230/1234/4090/4097`; `4101`→competitor (сильный CTA).
Fixture-регрессия без изменений: 6/6/5/1/0/0/1 → unique=4, dup=1, raw +5, registry +4, `irrelevant_false_positives=0`,
`adjacent_real_estate_skips=0`.

---

## План финальной приёмки Stage 3 (оператор) — МАКСИМУМ 5 тестов

> Цель: закрыть Telegram-источник Stage 3 одним коротким прогоном. Не открывать новый цикл ручных ретестов.

1. **WF11 fixture (регрессия, $0):** Execute once (`fixture_mode=true`). Ожидаемо: `posts_received=6`,
   `business_relevant_items=5`, `hard_skipped_items=1`, `irrelevant_false_positives=0`,
   `adjacent_real_estate_skips=0`, `unique=4`, `duplicates=1`; `raw_market_records +5`, `registry +4`,
   `live_source_runs +1` (mode=fixture, external_calls=0).
2. **WF11 live на `ipotekapro` (точные false positives закрыты):** вооружить гейт (`live_mode=true`,
   `live_approval_token=I_APPROVE_LIVE_TELEGRAM_PREVIEW`, список отслеживаемых каналов = `ipotekapro`,
   `live_transport=firecrawl` либо `http_get`). Ожидаемо: `4106` (С Днём России) →
   `irrelevant_live_false_positive`; `4092` (набор агентов) и `4098` (ЛОТ/ЖК) → `adjacent_real_estate_signal`;
   все три **НЕ** в raw/registry. Реальные сервисные посты (`4091/4093/4099`) → `competitor_activity`;
   дайджесты (`4090/4097`) → `market_signal`. `agent_requests` показывает live-список отслеживаемых каналов +
   `transport=`.
3. **WF11 live на `brokershakurova` (no-regression):** competitor-посты (`1237/1245`) и market (`1230/1234`)
   сохраняются; `1231/1233/1240` остаются скипнутыми. Повторный прогон → `unique=0`, registry +0 (дедуп держит).
4. **WF08 handoff на ЧИСТЫЙ live-прогон WF11** (`agent_request_id_filter=<чистый wf11_req_…>`,
   `deterministic_first`, `llm_enabled=false`): `total_processed` == числу строк очереди, `processed_accounting_ok=true`,
   `claude_calls=0`, `technical_errors=0`.
5. **WF10 на чистых данных:** запустить агрегатор; убедиться, что adjacent/false-positive шум не попал в
   `competitor_profiles`/`audience_activity_signals`. После этого **Stage 3 Telegram-источник можно закрывать**.

> Ожидаемые итоги в Google Sheets: только `competitor_activity` + `market_signal` уникальные строки в
> `raw_market_records`/`market_record_registry`; adjacent/holiday/personal/recruitment строк нет (если
> `live_debug_audit=false`); `agent_requests` и `live_source_runs` +1 на прогон; бизнес-вкладки не трогаются
> до ручного WF08.
