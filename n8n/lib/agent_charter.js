'use strict';
// agent_charter.js — Part 1: immutable agent charter (L0) + deterministic capability registry.
//
// The charter is a compact, versioned, immutable block injected into EVERY planning/response turn so the
// agent never drifts from its purpose or safety rules. The capability registry is the single source of truth
// for what the agent can do: Claude may select and phrase a capability, but may NOT invent capability IDs or
// callback actions — only IDs that exist here are runnable. Pure + deterministic; no secrets, no I/O.

function str(v) { return v == null ? '' : String(v).trim(); }

// ---- L0 charter (compact, versioned, immutable) -----------------------------------------------------------
// NOTE: the canonical product identity + Claude system prompt live in n8n/lib/agent_identity.js
// (identity-v1). This charter mirrors the SAME product identity for prompt injection; an anti-drift test
// (test_agent_identity.js / test_agent_contracts.js) asserts the two stay consistent on the product name.
const CHARTER = {
  version: 'charter-v2',
  identity: 'Vinci AI Pilot — бизнес-агент для исследования рынков, анализа конкурентов, поиска точек роста и подготовки обоснованных решений.',
  does: [
    'collects and monitors public marketing data',
    'searches competitors and market signals',
    'analyzes offers, prices, positioning, CTA, content and changes',
    'produces factual reports and practical marketing ideas',
    'manages tracked public sources'
  ],
  never: [
    'never invents evidence, capabilities, source access or completed actions',
    'always distinguishes suggestions (recommendations) from observed facts',
    'requires approval before paid/external work when configured'
  ]
};

// One compact string for prompt injection. Stable across turns; never includes user data or secrets.
function charterText() {
  return [
    'AGENT CHARTER (' + CHARTER.version + ') — immutable:',
    CHARTER.identity,
    'DOES: ' + CHARTER.does.join('; ') + '.',
    'NEVER: ' + CHARTER.never.join('; ') + '.'
  ].join('\n');
}

// ---- capability registry (deterministic; the only runnable capability IDs) --------------------------------
const CAPABILITIES = [
  {
    id: 'competitor_search', name: 'Поиск конкурентов',
    intent_examples: ['найди конкурентов по займам под ПТС в Москве', 'find competitors for title loans'],
    required_config: ['source_allowlist'], required_credentials: ['apify_or_firecrawl'],
    platforms: ['website'], requires_approval: true, external_calls: true, requires_history: false
  },
  {
    id: 'deep_competitor_analysis', name: 'Глубокий анализ конкурентов',
    intent_examples: ['сравни первых двух подробнее', 'deep analysis of that competitor'],
    required_config: ['source_allowlist'], required_credentials: ['apify_or_firecrawl'],
    platforms: ['website'], requires_approval: true, external_calls: true, requires_history: false
  },
  {
    id: 'report_followup', name: 'Вопрос по последнему отчёту',
    intent_examples: ['что по второму конкуренту?', 'explain the first one'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: true
  },
  {
    id: 'generate_ideas', name: 'Идеи на основе отчёта',
    intent_examples: ['какие идеи можно адаптировать?', 'what ideas can we use'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: true
  },
  {
    id: 'compare_periods', name: 'Сравнение с прошлым периодом',
    intent_examples: ['сравни с прошлым отчётом', 'compare with last time'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: true
  },
  {
    id: 'add_source', name: 'Добавить источник в мониторинг',
    intent_examples: ['добавь их сайты в мониторинг', 'add this telegram channel'],
    required_config: ['source_allowlist'], required_credentials: [],
    platforms: ['website', 'telegram_channel', 'vk_community'], requires_approval: false, external_calls: false, requires_history: false
  },
  {
    id: 'manage_sources', name: 'Управление источниками',
    intent_examples: ['покажи источники', 'поставь на паузу второй источник', 'list tracked sources'],
    required_config: [], required_credentials: [],
    platforms: ['website', 'telegram_channel', 'vk_community'], requires_approval: false, external_calls: false, requires_history: false
  },
  {
    id: 'rerun_request', name: 'Повторить запрос',
    intent_examples: ['запусти это снова', 'run it again next week'],
    required_config: ['source_allowlist'], required_credentials: ['apify_or_firecrawl'],
    platforms: ['website'], requires_approval: true, external_calls: true, requires_history: true
  },
  {
    id: 'manage_memory', name: 'Память и контекст',
    intent_examples: ['/new', '/context', '/memory', 'забудь предыдущего конкурента'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: false
  },
  {
    id: 'status', name: 'Статус',
    intent_examples: ['/status', 'что сейчас происходит?'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: false
  },
  {
    id: 'cancel', name: 'Отмена',
    intent_examples: ['/cancel', 'отмена'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: false
  },
  {
    id: 'help', name: 'Возможности',
    intent_examples: ['/help', 'что ты умеешь?', 'what else can you help me with'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: false
  },
  // --- reporting UX capabilities (operate on the LAST report; reuse stored data, no new collection) ---
  {
    id: 'export_report', name: 'Экспорт отчёта (CSV/Excel)',
    intent_examples: ['пришли таблицу', 'сделай Excel', 'экспортируй CSV'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: true
  },
  {
    id: 'show_chart', name: 'График по отчёту',
    intent_examples: ['покажи график', 'построй диаграмму по ставкам'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: true
  },
  {
    id: 'show_evidence', name: 'Доказательства',
    intent_examples: ['покажи доказательства', 'покажи источники фактов'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: true
  },
  {
    id: 'filter_report', name: 'Фильтр/сортировка отчёта',
    intent_examples: ['покажи только ставки ниже 5%', 'оставь только healthy источники'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: true
  },
  {
    id: 'refresh_sources', name: 'Обновить устаревшие источники',
    intent_examples: ['обнови только устаревшие источники', 'пересобери устаревшие данные'],
    required_config: ['source_allowlist'], required_credentials: ['apify_or_firecrawl'],
    platforms: ['website'], requires_approval: true, external_calls: true, requires_history: false
  },
  {
    id: 'weekly_digest', name: 'Недельная сводка',
    intent_examples: ['пришли недельную сводку', 'что изменилось за эту неделю?'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: false
  },
  {
    id: 'manage_digest', name: 'Еженедельный отчёт (вкл/выкл)',
    intent_examples: ['включи еженедельный отчёт', 'выключи еженедельный отчёт'],
    required_config: [], required_credentials: [],
    platforms: [], requires_approval: false, external_calls: false, requires_history: false
  }
];

function capabilityById(id) {
  id = str(id);
  for (let i = 0; i < CAPABILITIES.length; i++) if (CAPABILITIES[i].id === id) return CAPABILITIES[i];
  return null;
}

// A capability is AVAILABLE only when every platform it needs is configured (in the source allowlist) and any
// required runtime config is complete. Availability derives from cfg (allowlist = the operator's declaration
// of what adapters/credentials are configured) — never from a guess. Returns an annotated copy.
function annotateAvailability(cap, cfg) {
  cfg = cfg || {};
  const allow = (cfg.source_allowlist || []).map(s => String(s).toLowerCase());
  const reasons = [];
  for (const p of (cap.platforms || [])) {
    if (allow.indexOf(String(p).toLowerCase()) < 0) reasons.push('platform ' + p + ' not configured (not in source allowlist / adapter unavailable)');
  }
  if (cap.external_calls && cfg.config_complete === false) reasons.push('central config incomplete');
  return Object.assign({}, cap, {
    available: reasons.length === 0,
    unavailable_reason: reasons.join('; ')
  });
}

// All capabilities annotated for this config.
function availableCapabilities(cfg) {
  return CAPABILITIES.map(c => annotateAvailability(c, cfg));
}

// Human-readable catalog of the AVAILABLE capabilities (for /help). Unavailable ones are listed honestly with
// their reason so the agent never claims a capability it cannot run.
function capabilityCatalogText(cfg) {
  const anns = availableCapabilities(cfg);
  const ok = anns.filter(a => a.available);
  const off = anns.filter(a => !a.available);
  const lines = [CHARTER.identity, '', 'Что я умею (доступно сейчас):'];
  ok.forEach(a => lines.push('• ' + a.name));
  if (off.length) {
    lines.push('Недоступно (нужна настройка):');
    off.forEach(a => lines.push('• ' + a.name + ' — ' + a.unavailable_reason));
  }
  return lines.join('\n');
}

module.exports = {
  CHARTER, charterText, CAPABILITIES, capabilityById,
  annotateAvailability, availableCapabilities, capabilityCatalogText, str
};
