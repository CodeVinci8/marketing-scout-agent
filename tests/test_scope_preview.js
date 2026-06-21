'use strict';
// test_scope_preview.js — pre-approval scope + cost preview: available/unavailable/setup-required sources,
// reuse/refresh split, known/unknown budgets, duration category, NO fabricated price (Sections 9 / 21).
const A = require('./_assert.js');
const S = require('../n8n/lib/scope_preview.js');

A.section('source availability (website/Avito available; Telegram/VK setup_required by default)');
A.ok('website available', S.collectorAvailable('website', {}));
A.ok('avito available (discovery/search-card)', S.collectorAvailable('avito', {}));
A.ok('telegram needs collector', !S.collectorAvailable('telegram', {}));
A.ok('vk needs collector', !S.collectorAvailable('vk', {}));
A.ok('vk available when configured', S.collectorAvailable('vk', { enable_vk_collector: true }));
A.ok('telegram available when configured', S.collectorAvailable('telegram_channel', { enable_telegram_collector: true }));

A.section('preview splits available vs setup-required platforms');
const p1 = S.buildScopePreview({
  goal: 'Сравнить ставки конкурентов', niche: 'credit_brokerage', region: 'Москва',
  competitors: ['Cashmotor', 'CarCapital'], platforms: ['website', 'vk', 'telegram'],
  cfg: { max_external_calls: 40, source_budget_usd: 0.20, llm_budget_usd: 0.50 },
  refresh_plan: { expected_calls: 4, reused: ['cashmotor.ru'], refreshed: ['carcapital.ru'], skipped: [] },
  expected_llm_calls: 0, outputs: { telegram_summary: true, xlsx: true, charts: true }
});
A.ok('website in available', p1.available_sources.indexOf('website') >= 0);
A.ok('vk in unavailable', p1.unavailable_sources.some(u => u.platform === 'vk' && u.status === 'setup_required'));
A.ok('telegram in unavailable', p1.unavailable_sources.some(u => u.platform === 'telegram'));
A.eq('reuse count', p1.reuse.length, 1);
A.eq('refresh count', p1.refresh.length, 1);
A.eq('expected external calls from plan', p1.expected_external_calls, 4);
A.eq('max external calls', p1.max_external_calls, 40);
A.ok('xlsx + charts in outputs', p1.expected_outputs.xlsx === true && p1.expected_outputs.charts === true);
A.ok('text mentions plan + approval', /План запроса/.test(p1.text) && /Подтвердить/.test(p1.text));

A.section('budgets: known ceiling vs unknown — never a fabricated precise price');
A.eq('source ceiling shown', p1.source_budget_ceiling_usd, 0.20);
A.eq('llm ceiling shown', p1.llm_budget_ceiling_usd, 0.50);
A.eq('source cost basis is known_ceiling (no per-call contract)', p1.source_cost.basis, 'known_ceiling');
A.eq('source cost value stays unknown', p1.source_cost.value, 'unknown');

const pUnknown = S.buildScopePreview({ competitors: ['X'], platforms: ['website'], cfg: { max_external_calls: 10 }, refresh_plan: { expected_calls: 2 } });
A.eq('no budget configured -> unknown basis', pUnknown.source_cost.basis, 'unknown');
A.eq('no budget -> ceiling unknown', pUnknown.source_budget_ceiling_usd, 'unknown');

const pContract = S.buildScopePreview({ competitors: ['X'], platforms: ['website'], cfg: { source_budget_usd: 1.0, source_cost_per_call_usd: 0.01, max_external_calls: 40 }, refresh_plan: { expected_calls: 5 } });
A.eq('per-call contract -> estimated basis', pContract.source_cost.basis, 'estimated_from_contract');
A.eq('estimate 5 * 0.01 = 0.05', pContract.source_cost.value, 0.05);

A.section('duration category');
A.eq('zero calls -> quick', S.durationCategory(0, 0, 0), 'quick');
A.eq('small -> quick', S.durationCategory(2, 1, 0), 'quick');
A.eq('medium -> standard', S.durationCategory(5, 2, 1), 'standard');
A.eq('large -> deep', S.durationCategory(20, 6, 2), 'deep');

A.report('scope-preview');
