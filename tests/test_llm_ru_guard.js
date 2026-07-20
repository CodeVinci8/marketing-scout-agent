// test_llm_ru_guard.js — MVP-F RU-NARRATIVE guards: a Claude (aiprimetech.io) response that parses but is not
// Russian narrative never persists. WF08 replaces a non-Cyrillic enrichment reason with the deterministic
// Russian reason; WF12 falls back to the deterministic report on a non-Russian executive summary. Runs the
// REAL committed node code via the harness. Offline, $0, no network.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

// ---------------------------------------------------------------------------------------------------------
A.section('WF08 — parse-ok enrichment with an ENGLISH reason is replaced by the deterministic Russian reason');
const WF08 = H.loadWorkflow('08_touchpoint_analyzer.json');
function runMerge08(enrichment, parseOk) {
  const run = H.makeRun();
  H.inject(run, 'Prepare Record', [{
    det: {
      route: 'monitor_queue', entity_type: 'competitor', recommended_action: 'investigate',
      service_type: 'credit_broker', company_name: 'Брокер-Икс', offer_text: 'ставка от 5%',
      lead_signal_score: 40, competitor_strength: 60, content_idea_score: 30, quality_score: 70
    },
    source_run_id: 'srun_ru1', run_id: 'run_ru1', batch_index: 0, data_mode: 'fixture',
    source_type: 'website', platform: 'website', source_url: 'https://example.ru/x',
    profile_name: '', analyzer_text: 'Кредитный брокер, ставка от 5%, Москва'
  }]);
  H.inject(run, 'Set Analyzer Config', [{ data_mode: 'fixture' }]);
  const inp = parseOk
    ? { parse_ok: true, parse_method: 'primary_json', enrichment: enrichment }
    : { parse_ok: false, parse_method: 'primary_json', enrichment: null, parse_error: 'x' };
  return H.runCodeNode(run, WF08, 'Merge LLM Enrichment With Deterministic Row', [{ json: inp }])[0].json;
}
{
  const en = runMerge08({ reason: 'This competitor is strong and offers low rates in the region.' }, true);
  A.ok('English reason NOT persisted', en.reason.indexOf('This competitor') < 0);
  A.ok('deterministic Russian reason used instead', /[а-яё]/i.test(en.reason) && /Детерминированная классификация/.test(en.reason));
  A.eq('route unchanged (deterministic source of truth)', en.route, 'monitor_queue');
  const ru = runMerge08({ reason: 'Сильный конкурент: низкие ставки, активная реклама.' }, true);
  A.ok('Russian reason IS accepted', ru.reason.indexOf('Сильный конкурент') === 0);
  const fb = runMerge08(null, false);
  A.ok('parse failure still yields a Russian deterministic reason', /[а-яё]/i.test(fb.reason));
  A.eq('parse failure recorded as deterministic fallback', fb.parse_method, 'deterministic_fallback_after_llm_fail');
}

// ---------------------------------------------------------------------------------------------------------
A.section('WF12 — a non-Russian executive summary falls back to the deterministic report (nothing malformed persists)');
const WF12 = H.loadWorkflow('12_market_intelligence_report_builder.json');
function runMerge12(text) {
  const run = H.makeRun();
  H.inject(run, 'Set Report Config', [{ llm_model: 'claude-sonnet-4-6', llm_input_price_per_mtok: 3, llm_output_price_per_mtok: 15 }]);
  H.inject(run, 'Build Claude Summary Prompt', [{ llm_facts_string: 'записей 12, конкурентов 4' }]);
  H.inject(run, 'Build Deterministic Report', [{ report_id: 'r1', notes: 'базовый отчёт', records_total: 12 }]);
  const resp = { content: [{ type: 'text', text: text }], usage: { input_tokens: 100, output_tokens: 50 }, stop_reason: 'end_turn' };
  return H.runCodeNode(run, WF12, 'Merge Claude Summary Into Report', [{ json: resp }])[0].json;
}
{
  const en = runMerge12(JSON.stringify({ executive_summary_ru: 'The market is competitive with 4 strong brokers.', key_findings: ['finding one'] }));
  A.eq('non-Russian summary -> deterministic fallback', en.llm_status, 'fallback_deterministic');
  A.ok('flagged as non_russian_summary', en.llm_quality_flags.indexOf('non_russian_summary') >= 0);
  A.eq('no summary text persisted', en.llm_summary_ru, '');
  A.eq('deterministic facts preserved', en.records_total, 12);
  const ru = runMerge12(JSON.stringify({ executive_summary_ru: 'Рынок конкурентный: 4 сильных брокера, записей 12.', key_findings: ['ставки от 5%'] }));
  A.ok('Russian summary accepted', ru.llm_status.indexOf('ok') === 0 && ru.llm_summary_ru.indexOf('Рынок конкурентный') >= 0);
  const bad = runMerge12('Sorry, I cannot produce JSON right now.');
  A.eq('non-JSON output -> deterministic fallback (unchanged behavior)', bad.llm_status, 'fallback_deterministic');
  A.ok('non-JSON flagged', bad.llm_quality_flags.indexOf('non_json_output') >= 0);
}

A.report('llm-ru-guard');
