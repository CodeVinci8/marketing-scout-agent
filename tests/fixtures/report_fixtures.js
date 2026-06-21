'use strict';
// report_fixtures.js — shared deterministic report bundles for the reporting-UX suites (export, xlsx, charts,
// evidence, compare, filter, refresh, digest, e2e). Fresh deep copies each call so a test can mutate safely.
// Data is fixture/offline only — credit-brokerage niche (Москва/МО). Includes deliberate unknowns and a
// formula-injection payload so the safety paths are exercised.

function clone(o) { return JSON.parse(JSON.stringify(o)); }

const OWNER = '100200300';

// ---- current report (report_2026_06_21) --------------------------------------------------------------
const CURRENT = {
  report_id: 'report_20260621_101500', agent_request_id: 'req_aaa', owner_user_id: OWNER,
  created_at: '2026-06-21T10:15:00+03:00', niche: 'credit_brokerage', region: 'Москва/МО',
  time_window_days: 30, source_mix: 'web pipeline (live)', data_mode: 'live',
  run_ids: { wf10_run_id: 'wf10_0621', wf16_run_id: 'wf16_0621' },
  budgets: { source_budget_usd: 0.20, llm_budget_usd: 0.50, max_external_calls: 40 },
  summary: {
    competitors_found: 3, sources_checked: 3, quality_status: 'healthy',
    key_findings: ['Cashmotor снизил ставку до 4,5%', 'CarCapital добавил акцию на рефинансирование'],
    key_recommendations: ['Подсветить ставку ниже рынка', 'Ответить на акцию рефинансирования'],
    external_calls: 6, llm_primary_calls: 0, source_cost_status: 'known', llm_cost_status: 'unknown'
  },
  competitors: [
    { competitor: 'Cashmotor', domain: 'cashmotor.ru', region: 'Москва', positioning: 'ПТС-займы под низкую ставку', score: 8.5, quality: 'healthy', last_checked: '2026-06-21T09:00:00+03:00', source_url: 'https://cashmotor.ru/', source_run_id: 'wf16_0621' },
    { competitor: 'CarCapital', domain: 'carcapital.ru', region: 'Москва', positioning: 'Рефинансирование автокредитов', score: 7.0, quality: 'degraded', last_checked: '2026-06-21T09:05:00+03:00', source_url: 'https://carcapital.ru/', source_run_id: 'wf16_0621' },
    { competitor: 'AvtoDengi', domain: 'avtodengi.ru', region: 'Московская область', positioning: '-агрессивный маркетинг ставок', score: null, quality: 'quarantined', last_checked: '', source_url: 'https://avtodengi.ru/', source_run_id: 'wf16_0621' }
  ],
  offers: [
    { competitor: 'Cashmotor', offer: 'Займ под ПТС', price_rate: '4,5%', amount_range: 'от 100 000 до 1 500 000 ₽', term: 'до 48 мес', cta: 'Оставить заявку', promotion: '', collected_at: '2026-06-21T09:00:00+03:00', evidence_url: 'https://cashmotor.ru/pts', evidence_id: 'ev1', source_record_id: 'rec_1', source_run_id: 'wf16_0621' },
    { competitor: 'CarCapital', offer: 'Рефинансирование', price_rate: '5,9%', amount_range: 'до 3 000 000 ₽', term: 'до 60 мес', cta: 'Рассчитать', promotion: '=HYPERLINK("http://evil","скидка")', collected_at: '2026-06-21T09:05:00+03:00', evidence_url: 'https://carcapital.ru/refi', evidence_id: 'ev2', source_record_id: 'rec_2', source_run_id: 'wf16_0621' },
    { competitor: 'AvtoDengi', offer: 'Займ под авто', price_rate: '', amount_range: '', term: '', cta: 'Звонок', promotion: '', collected_at: '', evidence_url: 'https://avtodengi.ru/zaim', evidence_id: 'ev3', source_record_id: 'rec_3', source_run_id: 'wf16_0621' }
  ],
  evidence: [
    { finding_id: 'f_rate_cashmotor', finding: 'Ставка Cashmotor 4,5%', competitor: 'Cashmotor', excerpt: 'Ставка от 4,5% годовых по займам под ПТС', url: 'https://cashmotor.ru/pts', source_record_id: 'rec_1', source_run_id: 'wf16_0621', source_quality: 'healthy', confidence: 'high', collected_at: '2026-06-21T09:00:00+03:00', available: true },
    { finding_id: 'f_promo_carcapital', finding: 'Акция рефинансирования CarCapital', competitor: 'CarCapital', excerpt: 'Рефинансирование под 5,9% — спецпредложение июня', url: 'https://carcapital.ru/refi', source_record_id: 'rec_2', source_run_id: 'wf16_0621', source_quality: 'degraded', confidence: 'medium', collected_at: '2026-06-21T09:05:00+03:00', available: true }
  ],
  recommendations: [
    { recommendation: 'Подсветить ставку ниже рынка', priority: 'high', rationale: 'Cashmotor агрессивно демпингует по ставке', linked_finding_ids: ['f_rate_cashmotor'], next_action: 'Обновить лендинг со ставкой' },
    { recommendation: 'Ответить на акцию рефинансирования', priority: 'medium', rationale: 'CarCapital запустил спецпредложение', linked_finding_ids: ['f_promo_carcapital'], next_action: 'Подготовить контр-акцию' },
    { recommendation: 'Проверить вручную агрессивные заявления AvtoDengi', priority: 'low', rationale: 'нет подтверждённых доказательств', linked_finding_ids: [], next_action: 'Запросить повторный сбор' }
  ],
  source_quality: [
    { source: 'cashmotor.ru', platform: 'website', health_score: 0.95, status: 'healthy', freshness: '2026-06-21T09:00:00+03:00', exclusions: [], error: '', source_run_id: 'wf16_0621', last_collected_at: '2026-06-21T09:00:00+03:00', last_success_at: '2026-06-21T09:00:00+03:00' },
    { source: 'carcapital.ru', platform: 'website', health_score: 0.6, status: 'degraded', freshness: '2026-06-21T09:05:00+03:00', exclusions: ['low_extraction_confidence'], error: '', source_run_id: 'wf16_0621', last_collected_at: '2026-06-21T09:05:00+03:00', last_success_at: '2026-06-21T09:05:00+03:00' },
    { source: 'avtodengi.ru', platform: 'website', health_score: 0.2, status: 'quarantined', freshness: '2026-06-10T09:00:00+03:00', exclusions: ['stale_source', 'semantic_validation_failed'], error: 'parse_failed', source_run_id: 'wf16_0621', last_collected_at: '2026-06-10T09:00:00+03:00', last_success_at: '2026-06-10T09:00:00+03:00' }
  ],
  changes: [],
  run_metadata: { calls: 6, llm_primary: 0, run_ids: ['wf10_0621', 'wf16_0621'], data_mode: 'live', generated_at: '2026-06-21T10:15:00+03:00' }
};

// ---- prior compatible report (one week earlier) — for compare/digest ---------------------------------
const PRIOR = {
  report_id: 'report_20260614_101500', agent_request_id: 'req_zzz', owner_user_id: OWNER,
  created_at: '2026-06-14T10:15:00+03:00', niche: 'credit_brokerage', region: 'Москва/МО',
  time_window_days: 30, source_mix: 'web pipeline (live)', data_mode: 'live',
  run_ids: { wf10_run_id: 'wf10_0614' },
  competitors: [
    { competitor: 'Cashmotor', domain: 'cashmotor.ru', region: 'Москва', positioning: 'ПТС-займы', score: 8.0, quality: 'healthy', last_checked: '2026-06-14T09:00:00+03:00', source_url: 'https://cashmotor.ru/' },
    { competitor: 'CarCapital', domain: 'carcapital.ru', region: 'Москва', positioning: 'Рефинансирование автокредитов', score: 7.0, quality: 'healthy', last_checked: '2026-06-14T09:05:00+03:00', source_url: 'https://carcapital.ru/' }
  ],
  offers: [
    { competitor: 'Cashmotor', offer: 'Займ под ПТС', price_rate: '5,5%', amount_range: 'от 100 000 до 1 500 000 ₽', term: 'до 48 мес', cta: 'Оставить заявку', promotion: '', collected_at: '2026-06-14T09:00:00+03:00', evidence_url: 'https://cashmotor.ru/pts', source_record_id: 'rec_p1', source_run_id: 'wf16_0614' },
    { competitor: 'CarCapital', offer: 'Рефинансирование', price_rate: '5,9%', amount_range: 'до 3 000 000 ₽', term: 'до 60 мес', cta: 'Рассчитать', promotion: '', collected_at: '2026-06-14T09:05:00+03:00', evidence_url: 'https://carcapital.ru/refi', source_record_id: 'rec_p2', source_run_id: 'wf16_0614' }
  ],
  evidence: [
    { finding_id: 'f_rate_cashmotor', finding: 'Ставка Cashmotor 5,5%', competitor: 'Cashmotor', excerpt: 'Ставка от 5,5% годовых', url: 'https://cashmotor.ru/pts', source_record_id: 'rec_p1', source_run_id: 'wf16_0614', source_quality: 'healthy', confidence: 'high', collected_at: '2026-06-14T09:00:00+03:00', available: true }
  ],
  recommendations: [],
  source_quality: [
    { source: 'cashmotor.ru', platform: 'website', health_score: 0.9, status: 'healthy', freshness: '2026-06-14T09:00:00+03:00', exclusions: [], error: '' },
    { source: 'carcapital.ru', platform: 'website', health_score: 0.9, status: 'healthy', freshness: '2026-06-14T09:05:00+03:00', exclusions: [], error: '' }
  ],
  changes: [],
  run_metadata: { calls: 6, llm_primary: 0, run_ids: ['wf10_0614'], data_mode: 'live', generated_at: '2026-06-14T10:15:00+03:00' }
};

// an UNRELATED report (different owner) — must never be selected as a compare baseline or leak into exports
const UNRELATED = Object.assign(clone(PRIOR), { report_id: 'report_other_owner', owner_user_id: '999999', agent_request_id: 'req_other' });

function currentReport() { return clone(CURRENT); }
function priorReport() { return clone(PRIOR); }
function unrelatedReport() { return clone(UNRELATED); }
function scopeOf(b) { return { owner_user_id: b.owner_user_id, agent_request_id: b.agent_request_id, report_id: b.report_id }; }

module.exports = { OWNER, currentReport, priorReport, unrelatedReport, scopeOf, clone };
