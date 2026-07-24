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
// REPORT-TRUTH-A: user-facing Russian names for the canonical analysis modes (never leak the enum itself).
var RU_ANALYSIS_MODE = {
  source_analysis: 'анализ текущего состояния источника',
  change_report: 'отчёт об изменениях с прошлой проверки',
  comparison: 'сравнение указанных источников',
  synthesis: 'сводный анализ нескольких источников',
  candidate_enrichment: 'оценка найденных кандидатов',
  public_lead_interpretation: 'интерпретация публичных сигналов спроса',
  opportunity_radar: 'поиск возможностей',
  monitoring_insight: 'мониторинговое уведомление'
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
// WIP2 SOURCE-ROLE-001: the plan goal must NOT assert «конкурент» for a public social source just because the
// niche is credit_brokerage (regression: PRObonds/frank_media/banksta are public sources, not competitors). At
// plan time there is no evidence yet, so the goal is a deterministic heuristic by SOURCE TYPE + analysis mode:
// a named company WEBSITE is a candidate direct competitor (the report confirms/scopes with evidence); a
// Telegram/VK channel is a public source of market signals; a mix is a preliminary relevance assessment. The
// evidence-bound source_role (source_role.js) decides direct_competitor in the report, never the niche.
function planGoalRu(plan) {
  plan = plan || {};
  if (ruText(plan.intent) === 'competitor_discovery') return 'поиск новых источников и оценка их релевантности';
  var mode = ruText(plan.analysis_mode) || 'source_analysis';
  if (mode === 'comparison') return 'сравнение источников';
  if (mode === 'synthesis') return 'сводный анализ нескольких источников';
  if (mode === 'change_report') return 'что изменилось у источника с прошлой проверки';
  var tg = (Array.isArray(plan.telegram_channels) ? plan.telegram_channels : []).length;
  var vk = (Array.isArray(plan.vk_sources) ? plan.vk_sources : []).length;
  var web = (Array.isArray(plan.websites) ? plan.websites : []).length;
  var social = tg + vk;
  if (social + web === 0) return ruIntent(plan.intent); // no explicit source: niche competitor scan
  // «анализ конкурента» requires a TRUSTED competitor signal in the approved input — NEVER a website's mere
  // existence, source type or the niche (regression: a public/news/aggregator website is not a competitor). The
  // signal is: operator marked it known; a stored owner-scoped source_role=direct_competitor with confidence; or
  // deterministic own-offer evidence already in the plan. Evidence-confirmed role is decided in the report.
  var provenCompetitor = plan.known_competitor === true || plan.direct_competitor === true ||
    (Array.isArray(plan.source_roles) && plan.source_roles.some(function (r) {
      return r && (r.direct_competitor === true || ruText(r.source_role) === 'direct_competitor') && Number(r.role_confidence) >= 0.6;
    }));
  if (provenCompetitor) return 'анализ конкурента';
  // social-only feeds are public sources of market signals by nature; a website (or a mix) with no proven
  // competitor status is a preliminary relevance assessment until evidence classifies it.
  if (social > 0 && web === 0) return 'анализ публичного источника и рыночных сигналов';
  return 'предварительная оценка релевантности публичного источника';
}
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
  // COST-REUSE-001: a 'reuse' run makes ZERO new external calls but is NOT "no active sources" — it analyzes a
  // saved snapshot. Only a genuinely fresh scan with no planned calls fails closed.
  var fresh = dataMode !== 'existing_data' && dataMode !== 'reuse';
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
  // PLAN-SHAPE-001 (B2): the scope + volume wording must match the request SHAPE. A single website is not
  // "до N результатов с каждого источника" and a single source is not a "сравнение". Source-specific collection
  // units; a comparison is claimed only for ≥2 sources (or a real historical baseline).
  var maxItems = Math.max(1, ruNum(plan.max_items, 10));
  var nExplicit = exSites.length + exTg.length + exVk.length;
  var isDiscovery = /discovery/.test(ruText(plan.intent));
  var explicitBlock = null, scopeBlock = null, comparison = false;
  if (hasExplicit && nExplicit === 1 && exSites.length === 1) {
    scopeBlock = ['Проверю сайт ' + exSites[0] + ' и релевантные страницы:',
      '• услуги и позиционирование;', '• офферы и цены;', '• CTA и точки обращения;', '• сильные и слабые стороны.'].join('\n');
  } else if (hasExplicit && nExplicit === 1 && exTg.length === 1) {
    scopeBlock = 'Проверю публичный Telegram-канал ' + exTg[0] + ' и до ' + maxItems + ' последних доступных публикаций.';
  } else if (hasExplicit && nExplicit === 1 && exVk.length === 1) {
    scopeBlock = 'Проверю публичное VK-сообщество ' + exVk[0] + ' и до ' + maxItems + ' доступных записей.';
  } else if (hasExplicit && nExplicit >= 2) {
    var eb = ['Проверю указанные источники:'];
    if (exSites.length) eb.push('• сайт' + (exSites.length > 1 ? 'ы' : '') + ': ' + exSites.slice(0, 3).join(', '));
    if (exTg.length) eb.push('• Telegram: ' + exTg.slice(0, 3).join(', '));
    if (exVk.length) eb.push('• VK: ' + exVk.slice(0, 3).join(', '));
    explicitBlock = eb.join('\n');
    scopeBlock = 'Сравню ' + nExplicit + ' указанны' + (nExplicit >= 5 ? 'х' : 'е') + ' источник' + (nExplicit >= 5 ? 'ов' : 'а') + '.';
    comparison = true;
  } else if (isDiscovery) {
    scopeBlock = 'Найду новых конкурентов в выбранной нише и оценю релевантные источники (до ' + maxItems + ' кандидатов).';
  } else {
    // niche competitor scan across the configured sources — many competitors, comparison is meaningful.
    scopeBlock = 'Объём: до ' + maxItems + ' результатов с каждого источника.';
    comparison = true;
  }
  if (ruText(plan.intent) === 'compare_periods') comparison = true; // real historical baseline
  var lines = [
    '🔎 План анализа',
    '',
    'Цель: ' + planGoalRu(plan),
    // REPORT-TRUTH-A: the mode is part of what the user approves — "что изменилось" and "проанализируй" are
    // different deliverables. Rendered only when it adds information beyond the default.
    (ruText(plan.analysis_mode) && plan.analysis_mode !== 'source_analysis'
      ? ('Тип отчёта: ' + ruEnum(RU_ANALYSIS_MODE, plan.analysis_mode, 'анализ источника')) : null),
    'Регион: ' + ruRegion(plan.region),
    (hasExplicit ? null : ('Источники: ' + ruSources(plan.sources, dataMode))),
    explicitBlock,
    scopeBlock,
    '',
    'Что будет подготовлено:',
    '• краткий отчёт в Telegram;',
    '• таблица Excel;',
    (comparison ? '• сравнение и основные выводы.' : '• основные выводы.')
  ];
  // §7 COST-UX-001: est_source/est_llm carry the request's BUDGET CAPS (e.g. $5+$3) — presenting their sum as
  // the expected price of one request was wrong. Show a dollar amount ONLY when the caller supplies a real
  // projection computed from the planned provider calls (cost_model.projectRequestCost) and marks it reliable;
  // otherwise omit the line. The technical hard cap is NEVER rendered here — it stays in rows/diagnostics.
  var pc = ruNum(opts.projected_cost_usd, NaN);
  var cost = (opts.cost && typeof opts.cost === 'object') ? opts.cost : null;
  var d2 = function (v) { return (Math.round(ruNum(v, 0) * 100) / 100).toFixed(2); };
  if (cost && ruNum(cost.projected_cost_usd, 0) >= 0 && cost.reliable !== false) {
    // B3: a deterministic per-work band + breakdown. AI enrichment is EXCLUDED and named as off until Stage F,
    // so the user is never quoted a Claude cost for work that will not run. The hard cap is the run ceiling.
    var lo = ruNum(cost.cost_low_usd, cost.projected_cost_usd), hi = ruNum(cost.cost_high_usd, cost.projected_cost_usd);
    var bd = cost.breakdown || {};
    var mgn = ruNum(cost.reserve_margin, 0.5);
    var band = function (v) { return '~$' + d2(v) + '–' + d2(Math.round(v * (1 + mgn) * 100) / 100); };
    // COST-REUSE-001: an execution-aware estimate reflects what the run will actually spend — reused data is $0
    // collection / $0 deep analysis, and only the per-report summary AI remains. Never a mechanical fixed band.
    var reuseCol = cost.reuse_collection === true, reuseAn = cost.reuse_analysis === true;
    var snapDate = ruText(cost.snapshot_collected_at).slice(0, 10);
    lines.push('');
    lines.push('💰 Оценка стоимости: $' + d2(lo) + '–' + d2(hi) + ((reuseCol || reuseAn) ? ' (используются сохранённые данные)' : ''));
    if (reuseCol) {
      lines.push('• сбор данных: $0' + (snapDate ? ' (сохранённый снимок от ' + snapDate + ')' : ' (используются сохранённые данные)'));
    } else {
      if (ruNum(bd.firecrawl_usd, 0) > 0) lines.push('• сбор данных: ~$' + d2(bd.firecrawl_usd));
      if (ruNum(bd.apify_usd, 0) > 0) lines.push('• объявления: ~$' + d2(bd.apify_usd));
    }
    // §4 AI-COST-001: three honest states. ON+usable -> quote the MEASURED evidence-based AI range (never the old
    // $0.01-0.02 fiction). ON but the credential is missing/failing -> we must NOT promise analysis that cannot
    // run, and must not bill for it. OFF -> say it is off, with no AI cost in the total.
    var deepUsd = ruNum(bd.claude_analysis_usd, 0) + ruNum(bd.claude_usd, 0);
    var summaryUsd = ruNum(bd.summary_ai_usd, 0);
    var reuseAnPossible = cost.reuse_analysis_possible === true;
    if (reuseAn) {
      lines.push('• AI-анализ: $0 (будет переиспользован сохранённый анализ)');
    } else if (reuseAnPossible && cost.llm_enabled && deepUsd > 0) {
      // COST-REUSE-002 (§4, residual-risk #1): the source data is reused, but a saved AI-analysis is NOT
      // guaranteed to match (a different report type/model, or a snapshot never analysed, still costs a fresh
      // call). Quote the real cost as the ceiling and state the exact condition for the charge — never promise a
      // $0 the run may not deliver.
      lines.push('• AI-анализ: ' + band(deepUsd) + ' (спишется, если готового анализа под этот отчёт ещё нет)');
    } else if (cost.llm_enabled && deepUsd > 0) {
      lines.push('• AI-анализ: ' + band(deepUsd));
    } else if (cost.llm_requested && cost.llm_auth_ok === false) {
      lines.push('• AI-анализ: сейчас недоступен — отчёт будет собран без него');
    } else if (cost.llm_enabled !== true) {
      lines.push('• AI-анализ: выключен');
    }
    // The per-report summary AI: present only in the execution-aware projection. It is why a full-reuse run is
    // never promised as an exact $0 total.
    if (summaryUsd > 0) lines.push('• AI-сводка: ' + band(summaryUsd));
    // §D PHASE-2: the internal hard cap (source+LLM budget ceiling) is an operator/diagnostics value — it is
    // enforced in cost_model/approval-gate/execution-gate/telemetry and lives ONLY in rows + the hidden tech
    // sheet. It must never appear in the normal Telegram approval message.
  } else if (isFinite(pc) && pc > 0 && opts.projected_reliable !== false) {
    lines.push('');
    lines.push('💰 Ориентировочная стоимость: около $' + d2(pc) + '.');
  }
  // SOURCE-EXEC-001: a refresh spends money on a source we already have. Say so BEFORE the user approves — an
  // approval must never hide a repeated paid collection.
  if (plan.force_reprocess === true || ruText(plan.force_reprocess) === 'true') {
    lines.push('');
    lines.push('♻️ Это повторный сбор: данные по источнику уже есть, но вы попросили обновить их — платный сбор запустится заново.');
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

// CALLBACK-IDEMP-001: a repeated approval tap for a plan that is already running/finished gets an idempotent,
// NON-contradictory acknowledgement — never «план не найден» for a run the user can see happening.
var RU_APPROVAL_DUP = {
  duplicate_running: 'Этот анализ уже запущен.',
  duplicate_done: 'Этот анализ уже завершён.',
  duplicate_closed: 'Этот запрос уже закрыт.'
};
function approvalDuplicateRu(kind) { return ruEnum(RU_APPROVAL_DUP, ruText(kind), 'Этот анализ уже обрабатывается.'); }
// Short callback-toast (answerCallbackQuery text) for the same states — clears the button spinner instantly.
var RU_APPROVAL_DUP_TOAST = {
  duplicate_running: 'Уже выполняется',
  duplicate_done: 'Уже завершено',
  duplicate_closed: 'Уже закрыто'
};
function approvalDuplicateToastRu(kind) { return ruEnum(RU_APPROVAL_DUP_TOAST, ruText(kind), 'Уже обрабатывается'); }

// WIP2 CALLBACK-UX-001: a self-contained, user-facing message for an approval callback that could not be applied
// (a stale/expired keyboard, a button for another request, or a malformed callback). Unlike approvalFailureRu
// (a lowercase fragment reused by the WF20 budget/gate blocked-response), this returns a COMPLETE sentence and
// exposes NO internal code, workflow/execution id, row number, ownership detail or exception. The callback stays
// bound to its exact agent_request_id upstream; this only chooses the words the user sees.
// CALLBACK-PRIVACY-001: only the SAFE, self-owned cases get a specific message. Any cross-scope mismatch
// (owner/chat/request/hash or unknown) collapses to ONE neutral result that reveals nothing about whether a
// foreign plan exists, who owns it, which chat/request/hash it is, or any workflow/row/exec id. The exact reason
// code stays in execution telemetry only.
var RU_APPROVAL_OUTCOME = {
  not_awaiting_approval: 'Этот план уже запущен или завершён.',
  no_plan: 'Этот план устарел. Отправьте запрос ещё раз, чтобы создать новый.'
};
var RU_APPROVAL_NEUTRAL = 'Не удалось применить это подтверждение. Отправьте запрос ещё раз, чтобы создать новый план.';
function approvalOutcomeRu(reason) {
  var first = ruText(reason).split(';')[0].trim();
  // prefix-match: reason codes may carry a suffix (e.g. "not_awaiting_approval:running")
  var keys = Object.keys(RU_APPROVAL_OUTCOME);
  for (var i = 0; i < keys.length; i++) { if (first.indexOf(keys[i]) === 0) return RU_APPROVAL_OUTCOME[keys[i]]; }
  // owner_mismatch / chat_mismatch / request_mismatch / plan_hash_mismatch / anything else → privacy-neutral.
  return RU_APPROVAL_NEUTRAL;
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
    'Здравствуйте! Я Vinci AI Pilot — помощник по анализу конкурентов и рынка.',
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
    'Я Vinci AI Pilot — бизнес-помощник по анализу конкурентов и рынка.',
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
  competitor_discovery: 'найти новых конкурентов (Telegram, VK, сайты)',
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
  competitor_search: 'analysis', competitor_discovery: 'analysis', deep_competitor_analysis: 'analysis', compare_periods: 'analysis',
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


// F-3 ENUM-RU-001 — single-source labels for report cells. A workbook cell must read «сайт», not «website»,
// and «принят», not «accepted»/«healthy». Unknown values fall back to the raw text only when it is already
// Russian; a latin/underscore token is never shown to a user.
var RU_SOURCE_ONE = { website: 'сайт', avito: 'Авито', telegram: 'Telegram-канал', telegram_channel: 'Telegram-канал',
  vk: 'сообщество VK', vk_community: 'сообщество VK', search: 'поисковая выдача', discovery: 'поиск источников' };
var RU_QUALITY = { accepted: 'принят', healthy: 'исправен', degraded: 'с замечаниями', rejected: 'отклонён',
  quality_rejected: 'отклонён по качеству', unknown: '', blocked: 'недоступен', stale: 'устарел' };
function ruSafeText(v) { var t = ruText(v); return (t && !/[a-z_]/i.test(t)) ? t : ''; }
function ruSourceLabel(v) { return ruEnum(RU_SOURCE_ONE, v, ruSafeText(v)); }
function ruQualityLabel(v) { return ruEnum(RU_QUALITY, v, ruSafeText(v)); }

module.exports = {
  planApprovalMessageRu, planStatusLineRu, planGoalRu, approvalFailureRu, approvalOutcomeRu, approvalDuplicateRu, approvalDuplicateToastRu,
  ruIntent, ruNiche, ruRegion, ruSources, ruEnum, ruIntentAny, ruSourceLabel, ruQualityLabel,
  ruStartMessage, ruWhoAmIMessage, ruIsWhoAmI,
  ruCapabilityGroups, ruHelpMessage, ruCapLabel, ruCapAdvertisable,
  RU_CAP_LABEL, RU_CAP_GROUP,
  ruUnavailableSourceMessage, ruAvitoUnavailableMessage, ruCollectionDisabledMessage, ruCapabilityUnavailableMessage,
  ruStatusReport, ruErrorMessage, ruSourceOpFailure, ruSourceStatusLabel,
  RU_INTENT, RU_INTENT_EXTRA, RU_NICHE, RU_REGION, RU_SOURCE, RU_PLAN_STATUS, RU_STAGE, RU_ERROR
};
