'use strict';
// intent_router.js — Part 2: natural-language intent router.
//
// Free-form conversation is the primary interface; buttons are optional accelerators. Routing is
// deterministic-first: obvious commands/callbacks and clear keyword phrases resolve with no LLM. Genuinely
// ambiguous free text is handed to a GUARDED Claude classifier whose JSON is validated against a strict
// schema; anything invalid/unsupported falls back to ONE clarification question. No external collection may
// start from an unvalidated intent. Standalone (no cross-lib require) so it embeds cleanly into a Code node.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }

// The ONLY routable intent IDs (mirrors agent_charter capability IDs + the request-lifecycle callbacks). A
// contract test asserts this set stays in sync with the capability registry.
const INTENT_IDS = [
  'competitor_search', 'competitor_discovery', 'deep_competitor_analysis', 'clarify_request', 'report_followup', 'generate_ideas',
  'add_source', 'manage_sources', 'compare_periods', 'rerun_request', 'status', 'cancel', 'help', 'manage_memory',
  // reporting UX intents (operate on the last report / stored data)
  'export_report', 'show_chart', 'show_evidence', 'filter_report', 'refresh_sources', 'weekly_digest', 'manage_digest'
];
const REQUESTED_ACTIONS = ['build_plan', 'discovery', 'answer_from_context', 'manage_sources', 'manage_memory', 'approve', 'reject', 'status', 'cancel', 'help', 'clarify'];
const APPROVAL_INTENTS = ['competitor_search', 'deep_competitor_analysis', 'rerun_request', 'refresh_sources'];
const CONTEXT_INTENTS = ['deep_competitor_analysis', 'report_followup', 'generate_ideas', 'compare_periods', 'add_source', 'manage_sources', 'rerun_request',
  'export_report', 'show_chart', 'show_evidence', 'filter_report'];
// reporting intents that only make sense once a report exists (same guard as report_followup/ideas/compare)
const HISTORY_REQUIRED_INTENTS = ['report_followup', 'generate_ideas', 'compare_periods', 'export_report', 'show_chart', 'show_evidence', 'filter_report'];

// Keyword rules — literal Russian/English (NO \w/\b on Cyrillic). Ordered: most specific first.
const TEXT_RULES = [
  // --- reporting UX rules first (most specific) so they win over generic search/source rules ---
  ['weekly_digest', /недельн[а-яё]*\s*сводк|сводк[а-яё]*\s*за\s*недел|что\s*измен[а-яё]*\s*за\s*(эту\s*)?недел|за\s*эту\s*неделю|weekly\s*digest/i],
  ['manage_digest', /(включ|выключ|отключ|enable|disable|turn (on|off)).{0,25}(еженедельн|недельн|сводк|digest)|(еженедельн[а-яё]*\s*отчёт)/i],
  ['export_report', /пришли\s*таблиц|таблиц[ауы]|экспорт|выгруз|скачать|сделай\s*(excel|эксель|таблиц)|\bexcel\b|\bxlsx\b|\bcsv\b|в\s*файл/i],
  ['show_chart', /график|диаграмм|chart|визуализ|построй\s*(график|диаграмм)/i],
  ['show_evidence', /доказательств|пруф[ыов]?|evidence|цитат[аыу]|подтвержден[а-яё]*\s*(фактом|источник)/i],
  ['refresh_sources', /(обнов[а-яё]*|пересобери|собери\s*заново|refresh|пере-?проверь).{0,30}(устаревш|источник|данны|сайт)|обнови\s*(только\s*)?устаревш/i],
  ['filter_report', /(покажи|оставь|только|фильтр|отфильтр|отсортир|сортир).{0,40}(ставк|%|процент|ниже|выше|дешевле|дороже|качеств|healthy|degraded|акци)|ставк[аи]\s*(ниже|выше|меньше|больше)/i],
  ['deep_competitor_analysis', /подробн|глубж|глубок|детальн|разбери|deep (dive|analy)|in more detail/i],
  ['compare_periods', /сравн[а-яё]*\s*(с\s*)?(прошл|предыдущ|раньше|last|previous|прошлым)|по сравнению с прошл/i],
  ['generate_ideas', /иде[ия]|придум|адаптир|adapt|what ideas|ideas (we|to)|контент-?план/i],
  ['add_source', /(добав|подключ|включ|add|track|мониторинг).{0,30}(сайт|канал|сообществ|источник|telegram|телеграм|vk|вконтакте|http|url)|добавь (их|это|этот)/i],
  ['manage_sources', /(покажи|список|list|какие).{0,20}источник|tracked sources|пауз|останов|возобнов|resume|pause|убери источник|удали источник|проверь источник|поставь.{0,10}паузу|проверь\s+отслеживаем|отслеживаем[а-яё]*\s+(сайт|канал|источник|сообществ)/i],
  // MEMORY-INTENT-001: natural-language memory questions ("что ты помнишь", "покажи память", "какие предпочтения
  // сохранены") must reach the memory view — NOT fall through to competitor clarification.
  ['manage_memory', /что\s+(ты\s+)?(обо\s+мне\s+)?(помн|знаешь\s+обо\s+мне)|покажи\s*(мою\s*)?памят|мою\s*памят|очисти\s*памят|забудь\s+(всё|все)|какие\s*(мои\s*)?предпочтени|что\s*(у\s*тебя\s*)?сохранен|что\s*ты\s*запомнил/i],
  ['rerun_request', /запусти.{0,10}снова|повтор|сделай снова|again|rerun|перезапус|next week|на след/i],
  ['report_followup', /(что по|расскажи (о|про)|объясни|подробнее о|поясни|explain|what about|tell me about).{0,40}(конкурент|перв|втор|компан|first|second|them|их)/i],
  ['competitor_search', /найд|поищ|ищ[уи]|подбери|find|search|конкурент|competitor|рынок|market/i],
  // identity / "who are you" / capability questions resolve deterministically to help — a non-external,
  // no-paid, no-pipeline answer that leads with the Vinci AI Pilot identity (see agent_identity.js).
  ['help', /умеешь|умеете|что ты можешь|какие возможност|твои возможност|что ещё|what (can|else)|\bhelp\b|помощь|capabilit|кто ты|ты кто|кто вы|вы кто|что ты такое|что ты за|что такое vinci|что за (бот|агент|сервис|vinci)|расскажи о себе|представься|как ты работаешь|как вы работаете|для чего ты|зачем ты|чем (ты )?(можешь )?помоч|какие задачи ты решаешь|who are you|what are you/i]
];

function entityExtract(text, ctx) {
  const t = low(text);
  ctx = ctx || {};
  const refs = [];
  if (/перв(ых|ые)?\s*дв|first two|обоих|оба|двух/i.test(t)) refs.push('first_two');
  else {
    if (/первого|первый|первой|first one|the first|номер один|№?\s*1/i.test(t)) refs.push('first');
    if (/второго|второй|second|номер два|№?\s*2/i.test(t)) refs.push('second');
  }
  if (/(этого|того|тот|that|this) (конкурент|competitor|компан)/i.test(t)) refs.push('that');
  if (/\b(их|them|those|these|эти[хм]?)\b/i.test(t) && !refs.length) refs.push('selected');
  if (/прошл[ыо][йм]?\s*отч[её]т|previous report|last report|предыдущ[а-яё]*\s*отч/i.test(t)) refs.push('previous_report');

  const platforms = [];
  if (/сайт|website|firecrawl|http|url|страниц/i.test(t)) platforms.push('website');
  if (/telegram|телеграм|тг|tg|канал/i.test(t)) platforms.push('telegram_channel');
  if (/vk|вконтакте|сообществ/i.test(t)) platforms.push('vk_community');

  let region = null;
  if (/москв|moscow|мо\b|msk/i.test(t)) region = 'Москва/МО';
  else if (/питер|спб|петербург|spb/i.test(t)) region = 'Санкт-Петербург';

  const refresh = /обнов|refresh|свеж|заново собери|пересобери|re-?collect/i.test(t);
  return { competitor_refs: refs, platforms: platforms, region: region, service: null, refresh: refresh };
}

// Resolve contextual references ("first_two", "them", "previous_report") against L1 state / last report.
function resolveReferences(entities, ctx) {
  entities = entities || {}; ctx = ctx || {};
  const competitors = (ctx.last_report && Array.isArray(ctx.last_report.competitors)) ? ctx.last_report.competitors : [];
  const selected = Array.isArray(ctx.selected_competitors) ? ctx.selected_competitors : [];
  const out = { competitors: [], report_id: null, unresolved: [] };
  for (const r of (entities.competitor_refs || [])) {
    if (r === 'first_two') out.competitors = competitors.slice(0, 2);
    else if (r === 'first') out.competitors = out.competitors.concat(competitors.slice(0, 1));
    else if (r === 'second') out.competitors = out.competitors.concat(competitors.slice(1, 2));
    else if (r === 'selected') out.competitors = selected.length ? selected.slice() : competitors.slice();
    else if (r === 'that') out.competitors = selected.length ? selected.slice(0, 1) : competitors.slice(0, 1);
    else if (r === 'previous_report') out.report_id = str(ctx.previous_report_id) || str(ctx.comparison_baseline_id);
    else out.unresolved.push(r);
  }
  // de-dup by company_name/ref
  const seen = {}; out.competitors = out.competitors.filter(c => {
    const k = str((c && (c.company_name || c.ref || c)) || ''); if (!k || seen[k]) return false; seen[k] = 1; return true;
  });
  return out;
}

function buildIntent(intentId, conf, entities, ctx) {
  const requiresContext = CONTEXT_INTENTS.indexOf(intentId) >= 0;
  const requiresApproval = APPROVAL_INTENTS.indexOf(intentId) >= 0;
  let action = 'answer_from_context';
  if (intentId === 'competitor_discovery') action = 'discovery';
  else if (APPROVAL_INTENTS.indexOf(intentId) >= 0) action = 'build_plan';
  else if (intentId === 'add_source' || intentId === 'manage_sources') action = 'manage_sources';
  else if (intentId === 'manage_memory') action = 'manage_memory';
  else if (intentId === 'status') action = 'status';
  else if (intentId === 'cancel') action = 'cancel';
  else if (intentId === 'help') action = 'help';
  else if (intentId === 'clarify_request') action = 'clarify';
  return {
    intent: intentId, confidence: num(conf, 0.6), entities: entities || {},
    requires_context: requiresContext, requires_approval: requiresApproval, requested_action: action
  };
}

// Deterministic resolution. Returns an intent object, or null if the free text is genuinely ambiguous.
function deterministicIntent(parsed, ctx) {
  parsed = parsed || {}; ctx = ctx || {};
  const kind = str(parsed.kind);
  // 1. callbacks (button shortcuts) — always deterministic. Two forms:
  //    approve|reject|cancel:<arid>  -> request lifecycle
  //    intent|act:<capability_id>    -> a button equivalent to typing that intent
  if (kind === 'callback') {
    const data = low(parsed.callback_data);
    const life = data.match(/^(approve|reject|cancel):/);
    if (life) {
      const action = life[1];
      const intentId = action === 'cancel' ? 'cancel' : (str(ctx.current_intent) || 'competitor_search');
      const i = buildIntent(intentId, 1, {}, ctx); i.requested_action = action; i.from = 'callback';
      return i;
    }
    const shortcut = data.match(/^(?:intent|act):([a-z_]+)$/);
    if (shortcut && INTENT_IDS.indexOf(shortcut[1]) >= 0) {
      return Object.assign(buildIntent(shortcut[1], 1, {}, ctx), { from: 'callback' });
    }
    // unknown callback payload -> never invent an action
    return Object.assign(buildIntent('clarify_request', 0.3, {}, ctx), { from: 'callback' });
  }
  // 2. slash commands
  if (kind === 'status') return Object.assign(buildIntent('status', 1, {}, ctx), { from: 'command' });
  if (kind === 'cancel') return Object.assign(buildIntent('cancel', 1, {}, ctx), { from: 'command' });
  const text = str(parsed.text);
  // /start is a deterministic onboarding command — it returns the Russian welcome/help (capabilities, examples,
  // commands), starts no request and calls no API. It shares the help action; `entities.start` lets the responder
  // open with a welcome line if desired.
  if (/^\/start\b/i.test(text)) return Object.assign(buildIntent('help', 1, { start: true }, ctx), { from: 'command' });
  const cmd = text.match(/^\/(new|context|memory|forget_all|forget|help)\b\s*(.*)$/i);
  if (cmd) {
    if (/help/i.test(cmd[1])) return Object.assign(buildIntent('help', 1, {}, ctx), { from: 'command' });
    return Object.assign(buildIntent('manage_memory', 1, { memory_op: low(cmd[1]), arg: str(cmd[2]) }, ctx), { from: 'command' });
  }
  if (kind !== 'request') return null;
  // 3. natural-language free-text rules
  const ent = entityExtract(text, ctx);
  // "compare the first two (more deeply)" -> deep analysis using prior report
  if ((ent.competitor_refs.length && /подробн|глубж|детальн|deep|more detail/i.test(text))) {
    return Object.assign(buildIntent('deep_competitor_analysis', 0.9, ent, ctx), { from: 'rule' });
  }
  // URL-INTAKE-002 / E2-ROUTE-001: a named PUBLIC source is an explicit-source ANALYSIS request — route to
  // competitor_search (the plan path extracts + targets exactly those sources), never source-add or discovery.
  // Covers a pasted URL, t.me / vk.com, AND a BARE domain ("дай отчёт по autolombardn1.ru") — the latter used to
  // fall through to a source-add clarification. A bare domain needs a real TLD so ordinary text never trips it.
  const BARE_DOMAIN = /(^|[\s(«"'“„])([a-z0-9][a-z0-9-]{0,62}\.)+(ru|рф|com|net|org|io|su|by|kz|ua|info|biz|pro|site|online|store|shop|club|team|app)\b/i;
  // E2-ROUTE-001 guard: a source-MANAGEMENT command ("убери/добавь/проверь/поставь на паузу/возобнови источник X",
  // "добавь X в мониторинг", "убери отслеживаемый …") keeps its domain/URL but is NOT an analysis request — let it
  // fall through to the manage_sources rule instead of being intercepted as single-source analysis.
  const __isSourceOp = /(убери|удали|добав|подключ|включ|проверь|поставь|возобнов|пауз|останов|track|отслеж)[а-яё\s]{0,25}(источник|канал|сообществ|мониторинг)|в\s+мониторинг/i.test(text);
  if (!__isSourceOp && (/https?:\/\/[^\s]+|(^|\s)t\.me\/[a-z0-9_]|(^|\s)vk\.com\/[a-z0-9_]/i.test(text) || BARE_DOMAIN.test(text))) {
    return Object.assign(buildIntent('competitor_search', 0.9, ent, ctx), { from: 'rule' });
  }
  // DISCOVERY-003: a "find/поищи ..." request routes to DISCOVERY (new-source search via WF27) ONLY on an explicit
  // discovery signal — "новых", "telegram-каналы/vk-сообщества/сайты конкурентов", an explicit platform ("в тг/vk"),
  // or "найди и добавь". A PLAIN "найди конкурентов" stays competitor_search (the analysis/plan path). A pasted
  // URL/@channel is explicit-source analysis (handled above); "проверь отслеживаемые …" is a tracked-source check.
  const __discoverySignal =
    /нов[а-яё]*\s+(источник|конкурент|канал|сообществ|сайт)/i.test(text)
    || /(telegram|телеграм|(^|\s)tg(\s|$))\s*-?\s*канал/i.test(text)
    || /(vk|вк|вконтакте)\s*-?\s*сообществ/i.test(text)
    || /канал[а-яё]*\s+(кредитн|брокер|конкурент|мфо|займ)/i.test(text)
    || /сообществ[а-яё]*\s+(кредитн|брокер|конкурент|по\s+кредит|по\s+займ)/i.test(text)
    // DEFECT-8: a find-request naming "сайт(ы)" is website discovery — "сайты конкурентов", "кредитных брокеров
    // сайты", "новые сайты …". A pasted URL is routed to analysis above; "проанализируй эти сайты" has no find-verb.
    || /сайт[а-яё]*/i.test(text)
    || /(в|во)\s+(тг|телеграм|telegram|вк|vk|вконтакте)(\s|$|,|\.)/i.test(text)
    || /найди?\s*и\s*добав|добавь\s*найден/i.test(text);
  if (/(найд|поищ|ищ[уи]|подбер|собери|find|search)/i.test(text)
    && __discoverySignal
    && !/отслеживаем|в\s+мониторинг[еа]|мои\s+источник|уже\s+добавл/i.test(text)) {
    return Object.assign(buildIntent('competitor_discovery', 0.9, ent, ctx), { from: 'rule' });
  }
  for (const [intentId, rx] of TEXT_RULES) {
    if (rx.test(text)) {
      // report_followup/ideas/compare/export/chart/evidence/filter only make sense with a prior report
      if (HISTORY_REQUIRED_INTENTS.indexOf(intentId) >= 0 && !(ctx.last_report || ctx.last_report_id)) {
        // no report yet -> treat the ask as needing a search first (clarify)
        continue;
      }
      return Object.assign(buildIntent(intentId, 0.85, ent, ctx), { from: 'rule' });
    }
  }
  return null; // ambiguous -> caller decides LLM vs clarify
}

// Facts for the guarded Claude classifier — bounded, no transcript, only capability IDs + light context.
function classifierFacts(parsed, ctx, capabilityIds) {
  ctx = ctx || {};
  return {
    user_message: str(parsed && parsed.text),
    allowed_intents: capabilityIds || INTENT_IDS,
    requested_actions: REQUESTED_ACTIONS,
    context: {
      current_intent: str(ctx.current_intent) || null,
      has_last_report: !!(ctx.last_report || ctx.last_report_id),
      selected_competitors: (ctx.selected_competitors || []).length,
      pending_clarification: str(ctx.pending_clarification) || null
    }
  };
}

// Validate raw Claude classifier JSON against the strict schema. Invalid => caller MUST clarify (never run).
function validateIntentJSON(rawText) {
  let obj;
  try { obj = typeof rawText === 'string' ? JSON.parse(rawText) : rawText; }
  catch (e) { return { valid: false, intent: null, reason: 'not_json' }; }
  if (!obj || typeof obj !== 'object') return { valid: false, intent: null, reason: 'not_object' };
  if (INTENT_IDS.indexOf(str(obj.intent)) < 0) return { valid: false, intent: null, reason: 'unknown_intent' };
  const conf = Number(obj.confidence);
  if (!(conf >= 0 && conf <= 1)) return { valid: false, intent: null, reason: 'bad_confidence' };
  const action = str(obj.requested_action) || 'clarify';
  if (REQUESTED_ACTIONS.indexOf(action) < 0) return { valid: false, intent: null, reason: 'bad_action' };
  const intent = {
    intent: str(obj.intent), confidence: conf,
    entities: (obj.entities && typeof obj.entities === 'object') ? obj.entities : {},
    requires_context: obj.requires_context === true || CONTEXT_INTENTS.indexOf(str(obj.intent)) >= 0,
    requires_approval: obj.requires_approval === true || APPROVAL_INTENTS.indexOf(str(obj.intent)) >= 0,
    requested_action: action, from: 'llm'
  };
  return { valid: true, intent: intent, reason: '' };
}

function clarificationFor(parsed, ctx) {
  ctx = ctx || {};
  if (ctx.pending_clarification) return str(ctx.pending_clarification);
  const t = low(parsed && parsed.text);
  if (/иде|adapt|сравн/i.test(t) && !(ctx.last_report || ctx.last_report_id))
    return 'Пока нет готового отчёта. Сначала найти конкурентов — по какой нише и в каком регионе?';
  if (/добав|источник|канал|сайт/i.test(t))
    return 'Какой источник добавить в мониторинг — пришлите ссылку на сайт, Telegram-канал или VK-сообщество.';
  return 'Уточните, пожалуйста: искать новых конкурентов, разобрать кого-то подробнее, поработать с источниками или с последним отчётом?';
}

// Top-level router. Deterministic first; otherwise guarded-LLM (only if enabled) or clarification.
function routeIntent(parsed, ctx, cfg) {
  cfg = cfg || {};
  const det = deterministicIntent(parsed, ctx);
  if (det) return { route: 'deterministic', intent: det, clarification: '' };
  if (cfg.enable_llm_intent === true) {
    return { route: 'llm', intent: null, clarification: '', facts: classifierFacts(parsed, ctx, INTENT_IDS) };
  }
  return { route: 'clarify', intent: buildIntent('clarify_request', 0.3, {}, ctx), clarification: clarificationFor(parsed, ctx) };
}

module.exports = {
  INTENT_IDS, REQUESTED_ACTIONS, APPROVAL_INTENTS, CONTEXT_INTENTS, HISTORY_REQUIRED_INTENTS,
  entityExtract, resolveReferences, deterministicIntent, classifierFacts,
  validateIntentJSON, clarificationFor, routeIntent, str, low, num
};
