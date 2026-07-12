'use strict';
// plan_render_ru.js — the ONE user-facing Russian renderer for plan approval, /status lines and plan/approval
// errors (UX-RU-001). Internal enum values (competitor_market_scan, credit_brokerage, deterministic, …),
// provider/LLM call counts and internal budget arithmetic are implementation detail: they stay in structured
// rows and logs and are NEVER rendered into a Telegram message. An unknown enum value falls back to a generic
// Russian label — never to the raw identifier. A cost line appears ONLY when the user is approving a real
// non-zero spend. Helper names are prefixed ru* — this lib is embedded into Code nodes ALONGSIDE other libs
// (request_planner/telegram_io/scope_preview) and must not collide with their top-level declarations.

function ruText(v) { return v == null ? '' : String(v).trim(); }
function ruNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }

var RU_INTENT = {
  competitor_market_scan: 'анализ конкурентов',
  competitor_search: 'анализ конкурентов',
  deep_competitor_analysis: 'углублённый анализ конкурента',
  report_refresh: 'обновление отчёта'
};
var RU_NICHE = {
  credit_brokerage: 'кредитный брокер',
  pts_loan: 'кредиты под залог авто (ПТС)',
  microloans: 'микрозаймы (МФО)',
  mortgage: 'ипотека',
  refinance: 'рефинансирование'
};
var RU_REGION = { 'Москва/МО': 'Москва и Московская область' };
var RU_SOURCE = {
  website: 'сайты конкурентов',
  avito: 'Авито',
  telegram: 'Telegram-каналы', telegram_channel: 'Telegram-каналы',
  vk: 'ВКонтакте', vk_community: 'ВКонтакте',
  apify: 'веб-каталоги'
};
var RU_PLAN_STATUS = {
  awaiting_approval: 'ждёт подтверждения',
  approved: 'подтверждён, готовится запуск',
  collecting: 'идёт сбор данных',
  analyzing: 'идёт анализ',
  delivered: 'отчёт доставлен',
  rejected: 'отклонён',
  cancelled: 'отменён',
  failed: 'завершился с ошибкой'
};

function ruEnum(map, key, fallback) {
  var k = ruText(key);
  return (k && Object.prototype.hasOwnProperty.call(map, k)) ? map[k] : fallback;
}
function ruIntent(v) { return ruEnum(RU_INTENT, v, 'анализ конкурентов'); }
function ruNiche(v) { return ruEnum(RU_NICHE, v, 'кредитные услуги'); }
// region values are produced in Russian by the planner; map the canonical short form to the full phrase and
// never leak a latin/underscore internal token if one ever appears.
function ruRegion(v) {
  var t = ruText(v);
  if (Object.prototype.hasOwnProperty.call(RU_REGION, t)) return RU_REGION[t];
  return (t && !/[a-z_]/i.test(t)) ? t : 'Москва и Московская область';
}
function ruSources(list, dataMode) {
  if (ruText(dataMode) === 'existing_data') return 'сохранённые данные предыдущих отчётов';
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (s) {
    var label = ruEnum(RU_SOURCE, ruText(s).toLowerCase(), '');
    if (label && out.indexOf(label) < 0) out.push(label);
  });
  return out.length ? out.join(', ') : 'сайты конкурентов';
}

// The single approval message shown to the user. Returns { ok, status, text }:
//   ok:true  -> text is the ONE approval block (ends with the launch question; inline buttons follow it)
//   ok:false -> status 'no_active_sources': a fresh scan that would execute ZERO source calls is not a
//               runnable competitor analysis — fail closed with a clear Russian explanation, no approval UI.
function planApprovalMessageRu(plan, opts) {
  plan = plan || {}; opts = opts || {};
  var dataMode = ruText(opts.data_mode);
  var fresh = dataMode !== 'existing_data';
  if (fresh && ruNum(plan.max_external_calls, 0) <= 0) {
    return {
      ok: false, status: 'no_active_sources',
      text: [
        '⚠️ Анализ сейчас недоступен',
        '',
        'Ни один источник данных не активен: сбор с сайтов и площадок отключён, а сохранённых данных для этого запроса нет.',
        'Попросите администратора включить источники данных и повторите запрос.'
      ].join('\n')
    };
  }
  // URL-INTAKE-002: if the user supplied explicit sources, show them grouped by platform instead of a generic label.
  var exSites = (Array.isArray(plan.urls) ? plan.urls : []).map(function (u) { return String(u).replace(/^https?:\/\//, '').replace(/\/$/, ''); });
  var exTg = (Array.isArray(plan.telegram_channels) ? plan.telegram_channels : []).map(String);
  var exVk = (Array.isArray(plan.vk_communities) ? plan.vk_communities : []).map(String);
  var hasExplicit = plan.explicit_sources === true || exSites.length || exTg.length || exVk.length;
  var explicitBlock = null;
  if (hasExplicit) {
    var eb = ['Проверю указанные источники:'];
    if (exSites.length) eb.push('• сайт' + (exSites.length > 1 ? 'ы' : '') + ': ' + exSites.slice(0, 3).join(', '));
    if (exTg.length) eb.push('• Telegram: ' + exTg.slice(0, 3).join(', '));
    if (exVk.length) eb.push('• VK: ' + exVk.slice(0, 3).join(', '));
    explicitBlock = eb.join('\n');
  }
  var lines = [
    '🔎 План анализа',
    '',
    'Цель: ' + ruIntent(plan.intent),
    'Регион: ' + ruRegion(plan.region),
    (hasExplicit ? null : ('Источники: ' + ruSources(plan.sources, dataMode))),
    explicitBlock,
    'Объём: до ' + Math.max(1, ruNum(plan.max_items, 10)) + ' результатов с каждого источника',
    '',
    'Что будет подготовлено:',
    '• краткий отчёт в Telegram;',
    '• таблица Excel;',
    '• сравнение и основные выводы.'
  ];
  // §7 COST-UX-001: est_source/est_llm carry the request's BUDGET CAPS (e.g. $5+$3) — presenting their sum as
  // the expected price of one request was wrong. Show a dollar amount ONLY when the caller supplies a real
  // projection computed from the planned provider calls (cost_model.projectRequestCost) and marks it reliable;
  // otherwise omit the line. The technical hard cap is NEVER rendered here — it stays in rows/diagnostics.
  var pc = ruNum(opts.projected_cost_usd, NaN);
  if (isFinite(pc) && pc > 0 && opts.projected_reliable !== false) {
    lines.push('');
    lines.push('💰 Ориентировочная стоимость: около $' + (Math.round(pc * 100) / 100).toFixed(2) + '.');
  }
  lines.push('');
  lines.push('Запустить анализ?');
  return { ok: true, status: 'plan_ready', text: lines.filter(function (l) { return l !== null; }).join('\n') };
}

// One /status line for a plan row — never the raw "intent [status]" enum pair.
function planStatusLineRu(planRow) {
  planRow = planRow || {};
  return ruIntent(planRow.intent) + ' — ' + ruEnum(RU_PLAN_STATUS, planRow.status, 'в обработке');
}

// Human message for an approval callback that cannot be applied. Reason CODES stay in logs/rows.
var RU_APPROVAL_FAIL = {
  no_plan: 'план не найден',
  owner_mismatch: 'подтверждать может только автор запроса',
  chat_mismatch: 'подтверждение пришло из другого чата',
  request_mismatch: 'этот план относится к другому запросу',
  plan_hash_mismatch: 'план изменился после показа — запросите его заново'
};
function approvalFailureRu(reason) {
  var first = ruText(reason).split(';')[0].trim();
  if (first.indexOf('not_awaiting_approval') === 0) return 'этот план уже обработан';
  return ruEnum(RU_APPROVAL_FAIL, first, 'подтверждение устарело или не может быть применено');
}

// ================= UX-RU-002 — Vinci persona + full user-facing message surface =========================
// The bot's audience is a Russian-speaking credit broker, not a developer. NOTHING below may contain env var
// names, enum values, workflow/execution ids, adapter names, allowlists, credential states, raw provider
// errors, stack traces or budget arithmetic. Internal codes come IN as arguments and are mapped to Russian;
// unknown codes fall back to a generic Russian phrase — never to the raw identifier.

// Extended intent labels so a routed intent can always be described in Russian («Понял так: …»).
var RU_INTENT_EXTRA = {
  report_followup: 'вопрос по последнему отчёту',
  generate_ideas: 'идеи на основе отчёта',
  compare_periods: 'сравнение с прошлым периодом',
  add_source: 'добавление источника в мониторинг',
  manage_sources: 'управление источниками',
  rerun_request: 'повтор запроса',
  manage_memory: 'память и контекст',
  status: 'статус запроса',
  cancel: 'отмена операции',
  help: 'справка',
  export_report: 'выгрузка отчёта',
  show_chart: 'график по отчёту',
  show_evidence: 'доказательства из отчёта',
  filter_report: 'фильтр по отчёту',
  refresh_sources: 'обновление источников',
  weekly_digest: 'недельная сводка',
  manage_digest: 'настройка недельной сводки',
  clarify_request: 'уточнение запроса'
};
function ruIntentAny(v) {
  var k = ruText(v);
  if (k && Object.prototype.hasOwnProperty.call(RU_INTENT, k)) return RU_INTENT[k];
  if (k && Object.prototype.hasOwnProperty.call(RU_INTENT_EXTRA, k)) return RU_INTENT_EXTRA[k];
  return 'ваш запрос';
}

// /start — concise welcome; NEVER the internal capability matrix.
function ruStartMessage() {
  return [
    'Здравствуйте! Я Vinci — помощник по анализу конкурентов и рынка.',
    '',
    'Я могу:',
    '• находить и сравнивать конкурентов;',
    '• анализировать сайты, объявления и публичные сообщества;',
    '• выделять предложения, цены и сильные стороны;',
    '• сохранять результаты в таблицу;',
    '• готовить краткие отчёты и Excel-файлы.',
    '',
    'Напишите, что нужно изучить. Например:',
    '«Найди кредитных брокеров в Москве и сравни их предложения».'
  ].join('\n');
}

// «кто ты?» / «представься» — short self-description, no command list.
function ruWhoAmIMessage() {
  return [
    'Я Vinci — бизнес-помощник по анализу конкурентов и рынка.',
    '',
    'Я собираю информацию из открытых источников, сравниваю предложения, выделяю важные факты и готовлю понятный отчёт.'
  ].join('\n');
}
function ruIsWhoAmI(text) {
  return /кто\s+(ты|вы)|ты\s+кто|вы\s+кто|что\s+ты\s+такое|что\s+ты\s+за|что\s+такое\s+vinci|что\s+за\s+(бот|агент|сервис|vinci)|расскажи\s+о\s+себе|представься|who\s+are\s+you|what\s+are\s+you/i.test(ruText(text));
}

// Derive user-goal groups from the ANNOTATED capability list (agent_charter.availableCapabilities output),
// so /help can never advertise stale features — but the ids/reasons themselves never reach the user.
var RU_HELP_GROUP_IDS = {
  analysis: ['competitor_search', 'deep_competitor_analysis', 'compare_periods', 'rerun_request', 'refresh_sources'],
  reports: ['report_followup', 'export_report', 'show_chart', 'filter_report', 'show_evidence'],
  monitoring: ['add_source', 'manage_sources', 'weekly_digest', 'manage_digest']
};
function ruCapabilityGroups(annotatedCaps) {
  var by = {}; (Array.isArray(annotatedCaps) ? annotatedCaps : []).forEach(function (c) { if (c && c.id) by[c.id] = c; });
  function anyOn(ids) { return ids.some(function (id) { return by[id] && by[id].available; }); }
  return {
    analysis: anyOn(RU_HELP_GROUP_IDS.analysis),
    reports: anyOn(RU_HELP_GROUP_IDS.reports),
    monitoring: anyOn(RU_HELP_GROUP_IDS.monitoring)
  };
}

// User-facing Russian labels for every routable capability id. Internal ids stay unchanged for routing —
// only the label shown to the user is simplified. A capability id with no entry falls back to the registry's
// own Russian name, so a NEW capability is advertised automatically and can never be hidden by this map.
var RU_CAP_LABEL = {
  competitor_search: 'найти и сравнить конкурентов',
  deep_competitor_analysis: 'изучить конкурента подробнее',
  compare_periods: 'сравнить с прошлым периодом',
  rerun_request: 'повторить предыдущий запрос',
  refresh_sources: 'обновить ранее собранные данные',
  report_followup: 'показать последний отчёт и ответить на вопросы по нему',
  generate_ideas: 'предложить идеи на основе отчёта',
  filter_report: 'отфильтровать результаты',
  export_report: 'выгрузить Excel',
  show_chart: 'построить график',
  show_evidence: 'показать подтверждающие цитаты и ссылки',
  add_source: 'добавить источник в мониторинг',
  manage_sources: 'управлять источниками (пауза, проверка, список)',
  weekly_digest: 'посмотреть недельную сводку',
  manage_digest: 'включить или выключить еженедельную сводку',
  manage_memory: 'запоминать ваши предпочтения (спросите «что ты помнишь?»)'
};
// Goal group per capability id. 'commands' render as /commands; 'hidden' = the help capability itself.
var RU_CAP_GROUP = {
  competitor_search: 'analysis', deep_competitor_analysis: 'analysis', compare_periods: 'analysis',
  rerun_request: 'analysis', refresh_sources: 'analysis',
  report_followup: 'reports', generate_ideas: 'reports', filter_report: 'reports',
  export_report: 'reports', show_chart: 'reports', show_evidence: 'reports',
  add_source: 'monitoring', manage_sources: 'monitoring', weekly_digest: 'monitoring', manage_digest: 'monitoring',
  manage_memory: 'settings',
  status: 'commands', cancel: 'commands', help: 'hidden'
};
var RU_GROUP_HEADERS = [
  ['analysis', '🔎 Анализ'],
  ['reports', '📊 Отчёты'],
  ['monitoring', '🔔 Мониторинг'],
  ['settings', '⚙️ Настройки']
];
function ruCapLabel(cap) {
  cap = cap || {};
  if (Object.prototype.hasOwnProperty.call(RU_CAP_LABEL, ruText(cap.id))) return RU_CAP_LABEL[cap.id];
  var n = ruText(cap.name);
  return n ? (n.charAt(0).toLowerCase() + n.slice(1)) : '';
}
// A capability is ADVERTISED only when it is fully ready to run: planning-available (allowlist + config) AND,
// if it needs external collection, executable right now (master switch + call budget + collector flag). A
// working capability can never be hidden by a stale text block — the bullets come from the live registry.
function ruCapAdvertisable(cap) {
  return !!(cap && cap.available && cap.execution_available !== false && RU_CAP_GROUP[ruText(cap.id)] !== 'hidden');
}
// /help — grouped by USER GOAL, generated from the ANNOTATED capability registry (agent_charter
// availableCapabilities output). Labels update automatically as sources/flags change. Also accepts the
// legacy {analysis,reports,monitoring} booleans object (renders representative static bullets).
function ruHelpMessage(caps) {
  var lines = ['Что можно сделать:'];
  if (Array.isArray(caps)) {
    var byGroup = {};
    caps.forEach(function (c) {
      if (!ruCapAdvertisable(c)) return;
      var g = RU_CAP_GROUP[ruText(c.id)] || 'settings';
      if (g === 'commands') return;
      var label = ruCapLabel(c);
      if (!label) return;
      (byGroup[g] = byGroup[g] || []).push(label);
    });
    RU_GROUP_HEADERS.forEach(function (gh) {
      var items = byGroup[gh[0]] || [];
      if (!items.length) return;
      lines.push('', gh[1]);
      items.forEach(function (l, i) { lines.push('• ' + l + (i === items.length - 1 ? '.' : ';')); });
    });
    if (lines.length === 1) {
      // nothing runnable right now — honest, with the next action (plan building always works)
      lines = [ruCollectionDisabledMessage()];
    }
    var byId = {}; caps.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    var cmds = [];
    if (!byId.status || byId.status.available) cmds.push('/status — состояние текущего запроса');
    if (!byId.cancel || byId.cancel.available) cmds.push('/cancel — отменить текущую операцию');
    if (cmds.length) { lines.push('', 'Также доступны команды:'); cmds.forEach(function (c) { lines.push(c); }); }
    return lines.join('\n');
  }
  var groups = caps || { analysis: true, reports: true, monitoring: true };
  if (groups.analysis !== false) {
    lines.push('', '🔎 Анализ',
      '• найти и сравнить конкурентов;',
      '• изучить предложения, цены и условия;',
      '• обновить ранее собранные данные.');
  }
  if (groups.reports !== false) {
    lines.push('', '📊 Отчёты',
      '• показать последний отчёт;',
      '• отфильтровать результаты;',
      '• выгрузить Excel;',
      '• построить график.');
  }
  if (groups.monitoring !== false) {
    lines.push('', '🔔 Мониторинг',
      '• проверить новые публикации;',
      '• посмотреть недельную сводку.');
  }
  lines.push('', 'Также доступны команды:',
    '/status — состояние текущего запроса',
    '/cancel — отменить текущую операцию');
  return lines.join('\n');
}

// AVITO-BLOCK-001: honest notice for a user who explicitly asked for Avito while it is temporarily blocked.
// Distinct from the generic "пока настраивается" — it names the reason (residential proxy / provider access not
// configured) and reassures that Avito can be enabled later without losing the existing implementation. No env
// var names, flags, workflow ids or provider errors — user-facing Russian only.
function ruAvitoUnavailableMessage() {
  return [
    'Мониторинг Авито сейчас временно недоступен: для него нужен доступ к резидентному прокси, который пока не подключён.',
    'Его можно будет включить позже — реализация сохранена, ничего не потеряно.',
    'Пока подготовлю анализ по остальным доступным источникам.'
  ].join('\n');
}

// A single unavailable source (e.g. VK before its credential exists) — brief, with the next available action.
function ruUnavailableSourceMessage(source) {
  var label = ruEnum(RU_SOURCE, ruText(source).toLowerCase(), 'этого источника');
  return 'Сбор данных из ' + (label === 'этого источника' ? label : '«' + label + '»') +
    ' пока настраивается. Остальные доступные источники можно использовать уже сейчас.';
}
// ALL external collection temporarily off — planning still works.
function ruCollectionDisabledMessage() {
  return 'Сейчас доступно создание плана анализа, но запуск сбора данных временно отключён. Попробуйте немного позже.';
}
// A capability that cannot run right now (annotated capability object comes from agent_charter; its
// internal unavailable_reason stays in logs). If it is source-bound, name the source; otherwise generic.
function ruCapabilityUnavailableMessage(cap) {
  cap = cap || {};
  var platforms = Array.isArray(cap.platforms) ? cap.platforms : [];
  if (platforms.length === 1) return ruUnavailableSourceMessage(platforms[0]);
  return 'Эта функция пока настраивается. Напишите, что нужно изучить, — я подготовлю план анализа из доступных источников.';
}

// Business-level /status block: stage -> Russian, counts only when known, never workflow/execution ids.
var RU_STAGE = {
  awaiting_approval: 'ожидание подтверждения',
  approved: 'подготовка запуска',
  collecting: 'сбор данных',
  analyzing: 'анализ и сравнение',
  reporting: 'подготовка отчёта',
  delivered: 'отчёт доставлен',
  cancelled: 'отменён',
  rejected: 'отклонён',
  failed: 'остановлен из-за ошибки'
};
var RU_NEXT_STAGE = {
  awaiting_approval: 'запуск после подтверждения',
  approved: 'сбор данных',
  collecting: 'сравнение и подготовка отчёта',
  analyzing: 'подготовка отчёта',
  reporting: 'доставка отчёта в Telegram'
};
function ruStatusReport(st) {
  st = st || {};
  var lines = ['Статус запроса:', ''];
  lines.push('Этап: ' + ruEnum(RU_STAGE, st.status, 'в обработке'));
  if (st.sources_total > 0) {
    lines.push('Готово источников: ' + Math.max(0, ruNum(st.sources_ready, 0)) + ' из ' + ruNum(st.sources_total, 0));
  } else if (st.sources && st.sources.length) {
    lines.push('Источники: ' + ruSources(st.sources));
  }
  if (st.found != null && isFinite(Number(st.found))) lines.push('Найдено результатов: ' + ruNum(st.found, 0));
  if (st.processed != null && isFinite(Number(st.processed))) lines.push('После обработки: ' + ruNum(st.processed, 0));
  var next = ruEnum(RU_NEXT_STAGE, st.status, '');
  if (next) lines.push('Следующий этап: ' + next);
  return lines.join('\n');
}

// Error translations — user ACTIONS, never raw provider errors. Unknown kind -> safe generic phrase.
var RU_ERROR = {
  source_failed: 'Не удалось получить данные с одного из источников. Остальные результаты будут обработаны.',
  report_failed: 'Не удалось подготовить отчёт. Я сохранил собранные данные и повторю формирование отчёта без повторного сбора.',
  not_recognized: 'Запрос не распознан. Напишите, какую нишу, регион и конкурентов нужно изучить.',
  export_failed: 'Не удалось подготовить файл. Данные сохранены, попробуйте выгрузку ещё раз чуть позже.',
  gate_blocked: 'Запуск сейчас невозможен: настройки источников или лимиты не позволяют начать сбор. План сохранён.'
};
function ruErrorMessage(kind) {
  return ruEnum(RU_ERROR, kind, 'Что-то пошло не так. Данные сохранены, попробуйте ещё раз чуть позже.');
}

// Tracked-source command failures (tracked_sources reason codes -> Russian).
var RU_SOURCE_OP_FAIL = {
  unparseable_source: 'не удалось распознать ссылку или название источника — пришлите адрес сайта, канала или сообщества',
  platform_unavailable: 'этот тип источника пока настраивается',
  already_tracked: 'этот источник уже отслеживается',
  bad_status: 'такое действие с источником недоступно',
  not_found_or_unchanged: 'источник не найден или уже в этом состоянии'
};
function ruSourceOpFailure(reason) {
  return ruEnum(RU_SOURCE_OP_FAIL, ruText(reason), 'не получилось изменить источник — уточните название или ссылку');
}
var RU_SOURCE_STATUS = { active: 'активен', paused: 'на паузе', removed: 'удалён', pending: 'готовится' };
function ruSourceStatusLabel(status) { return ruEnum(RU_SOURCE_STATUS, ruText(status), 'в обработке'); }

module.exports = {
  planApprovalMessageRu, planStatusLineRu, approvalFailureRu,
  ruIntent, ruNiche, ruRegion, ruSources, ruEnum, ruIntentAny,
  ruStartMessage, ruWhoAmIMessage, ruIsWhoAmI,
  ruCapabilityGroups, ruHelpMessage, ruCapLabel, ruCapAdvertisable,
  RU_CAP_LABEL, RU_CAP_GROUP,
  ruUnavailableSourceMessage, ruAvitoUnavailableMessage, ruCollectionDisabledMessage, ruCapabilityUnavailableMessage,
  ruStatusReport, ruErrorMessage, ruSourceOpFailure, ruSourceStatusLabel,
  RU_INTENT, RU_INTENT_EXTRA, RU_NICHE, RU_REGION, RU_SOURCE, RU_PLAN_STATUS, RU_STAGE, RU_ERROR
};
