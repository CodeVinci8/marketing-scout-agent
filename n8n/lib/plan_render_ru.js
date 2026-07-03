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
  var lines = [
    '🔎 План анализа',
    '',
    'Цель: ' + ruIntent(plan.intent),
    'Регион: ' + ruRegion(plan.region),
    'Источники: ' + ruSources(plan.sources, dataMode),
    'Объём: до ' + Math.max(1, ruNum(plan.max_items, 10)) + ' результатов с каждого источника',
    '',
    'Что будет подготовлено:',
    '• краткий отчёт в Telegram;',
    '• таблица Excel;',
    '• сравнение и основные выводы.'
  ];
  var cost = ruNum(plan.est_source_cost_usd, 0) + ruNum(plan.est_llm_cost_usd, 0);
  if (cost > 0) {
    lines.push('');
    lines.push('⚠️ Запуск потратит до $' + (Math.round(cost * 100) / 100).toFixed(2) + ' на внешние сервисы.');
  }
  lines.push('');
  lines.push('Запустить анализ?');
  return { ok: true, status: 'plan_ready', text: lines.join('\n') };
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

module.exports = {
  planApprovalMessageRu, planStatusLineRu, approvalFailureRu,
  ruIntent, ruNiche, ruRegion, ruSources, ruEnum,
  RU_INTENT, RU_NICHE, RU_REGION, RU_SOURCE, RU_PLAN_STATUS
};
