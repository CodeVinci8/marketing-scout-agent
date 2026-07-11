'use strict';
// scope_preview.js — pre-approval scope + cost preview (Section 9, "before approval").
//
// Renders exactly what a run will do BEFORE the user approves it: interpreted goal, competitors, region/niche,
// platforms (with available vs unavailable), reuse-vs-refresh, max items/calls, expected LLM calls, budget
// ceilings, expected outputs and a duration category. Monetary cost is NEVER faked: it is a known ceiling,
// 'unknown', or estimated only when a per-call contract is configured. The after-run actuals are produced by
// the existing execution_summary.js (not duplicated here). Pure + deterministic, $0.

function str(v) { return v == null ? '' : String(v); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

const DURATIONS = ['quick', 'standard', 'deep'];
function durationCategory(expectedCalls, competitors, llmCalls) {
  const score = num(expectedCalls) + num(competitors) * 0.5 + num(llmCalls);
  if (expectedCalls === 0) return 'quick';
  if (score <= 3) return 'quick';
  if (score <= 8) return 'standard';
  return 'deep';
}

// cost ceiling expression: { ceiling, basis } — never a fabricated precise number.
function costCeiling(budgetUsd, expectedCalls, perCallUsd) {
  if (perCallUsd != null && isFinite(Number(perCallUsd))) {
    return { value: Math.round(num(perCallUsd) * num(expectedCalls) * 1000) / 1000, basis: 'estimated_from_contract', ceiling_usd: budgetUsd != null ? budgetUsd : 'unknown' };
  }
  if (budgetUsd != null && isFinite(Number(budgetUsd))) return { value: 'unknown', basis: 'known_ceiling', ceiling_usd: Number(budgetUsd) };
  return { value: 'unknown', basis: 'unknown', ceiling_usd: 'unknown' };
}

// buildScopePreview(input) -> structured preview + RU text
function buildScopePreview(input) {
  input = input || {};
  const cfg = input.cfg || {};
  const plan = input.refresh_plan || {};
  const competitors = (input.competitors || []).map(str);
  const platforms = (input.platforms || ['website']).map(str);
  const available = platforms.filter(p => collectorAvailable(p, cfg));
  const unavailable = platforms.filter(p => !collectorAvailable(p, cfg)).map(p => ({ platform: p, status: 'setup_required' }));
  // plan may also carry its own unavailable refs (per-source); merge platform-level + source-level
  const unavailableRefs = (plan.unavailable || []).slice();

  const expectedCalls = plan.expected_calls != null ? num(plan.expected_calls) : num(input.expected_external_calls);
  const expectedLlm = num(input.expected_llm_calls, (cfg.enable_llm_summary ? 1 : 0) + (cfg.enable_llm_planner ? 1 : 0));
  const maxCalls = num(cfg.max_external_calls, 40);
  const maxItems = num(input.max_items, num(cfg.max_items_per_source, 25) * Math.max(1, competitors.length));

  const sourceCost = costCeiling(cfg.source_budget_usd, expectedCalls, cfg.source_cost_per_call_usd);
  const llmCost = costCeiling(cfg.llm_budget_usd, expectedLlm, cfg.llm_cost_per_call_usd);

  const outputs = Object.assign({ telegram_summary: true, xlsx: false, charts: false, evidence: false }, input.outputs || {});
  const duration = durationCategory(expectedCalls, competitors.length, expectedLlm);

  const preview = {
    goal: str(input.goal),
    niche: str(input.niche || cfg.default_niche), region: str(input.region || cfg.default_region),
    competitors: competitors,
    platforms: platforms, available_sources: available, unavailable_sources: unavailable.concat(unavailableRefs.map(r => ({ platform: 'source', ref: r, status: 'setup_required' }))),
    pages_per_competitor: num(input.pages_per_competitor, 1),
    reuse: plan.reused || [], refresh: plan.refreshed || [], skipped: plan.skipped || [],
    max_items: maxItems, max_external_calls: maxCalls, expected_external_calls: expectedCalls,
    expected_llm_calls: expectedLlm,
    source_budget_ceiling_usd: cfg.source_budget_usd != null ? num(cfg.source_budget_usd) : 'unknown',
    llm_budget_ceiling_usd: cfg.llm_budget_usd != null ? num(cfg.llm_budget_usd) : 'unknown',
    source_cost: sourceCost, llm_cost: llmCost,
    expected_outputs: outputs, duration_category: duration,
    needs_approval: cfg.require_approval !== false,
    reasons: plan.reasons || []
  };
  preview.text = renderPreviewText(preview);
  return preview;
}

function collectorAvailable(platform, cfg) {
  platform = str(platform).toLowerCase(); cfg = cfg || {};
  if (platform === 'website' || platform === '') return true;
  if (platform === 'telegram_channel' || platform === 'telegram') return cfg.enable_telegram_collector === true;
  if (platform === 'vk_community' || platform === 'vk') return cfg.enable_vk_collector === true;
  // AVITO-BLOCK-001: Avito availability tracks the resolved allowlist (blocked -> stripped from it) instead of a
  // hardcoded "always available", so the scope preview never advertises Avito while it is operator-infra-blocked.
  return ((cfg.source_allowlist || []).map(s => String(s).toLowerCase())).indexOf(platform) >= 0;
}

function money(c) {
  if (c.basis === 'estimated_from_contract') return '≈ $' + c.value + ' (оценка по контракту, потолок: ' + (c.ceiling_usd === 'unknown' ? 'unknown' : ('$' + c.ceiling_usd)) + ')';
  if (c.basis === 'known_ceiling') return 'потолок $' + c.ceiling_usd + ' (точная стоимость неизвестна)';
  return 'unknown';
}
function renderPreviewText(p) {
  const lines = [];
  lines.push('🔎 План запроса (нужно подтверждение):');
  if (p.goal) lines.push('• Цель: ' + p.goal);
  lines.push('• Ниша/регион: ' + p.niche + ' · ' + p.region);
  if (p.competitors.length) lines.push('• Конкуренты: ' + p.competitors.join(', '));
  lines.push('• Площадки: ' + p.available_sources.join(', ') + (p.unavailable_sources.length ? (' (недоступно: ' + p.unavailable_sources.map(u => u.platform + (u.ref ? ':' + u.ref : '')).join(', ') + ')') : ''));
  lines.push('• Использую из отчёта: ' + (p.reuse.length || 0) + ' · обновляю: ' + (p.refresh.length || 0) + ' · пропускаю: ' + (p.skipped.length || 0));
  lines.push('• Лимиты: до ' + p.max_external_calls + ' внешних вызовов, ожидается ' + p.expected_external_calls + '; LLM-вызовов ожидается ' + p.expected_llm_calls);
  lines.push('• Бюджет источников: ' + money(p.source_cost) + ' · LLM: ' + money(p.llm_cost));
  const outs = Object.keys(p.expected_outputs).filter(k => p.expected_outputs[k]);
  lines.push('• Результат: ' + outs.join(', '));
  lines.push('• Длительность: ' + p.duration_category);
  lines.push(p.needs_approval ? 'Подтвердить запуск? (да/нет)' : '(подтверждение не требуется)');
  return lines.join('\n');
}

module.exports = { buildScopePreview, durationCategory, costCeiling, collectorAvailable, DURATIONS };
