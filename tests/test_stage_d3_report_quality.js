// test_stage_d3_report_quality.js — Stage D / D3: report-quality repair, proven on the REAL WF12 + WF10 Code nodes.
// Covers the defects the D1/D2 live reports reproduced:
//   * phantom "Публичных лид-сигналов: 999" (WF12 counted ALL public_lead_signals, not this request's)
//   * empty «» / unknown lead rows rendered (blank stale rows)
//   * malformed CTA / markdown link "…](https://www" (unsanitized cta_text truncated mid-link)
//   * competitor wall posts counted as audience "вопросов N" (WF10 counted '?' on competitor rows)
// $0, no network.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf12 = H.loadWorkflow('12_market_intelligence_report_builder.json');
const wf10 = H.loadWorkflow('10_competitor_audience_intelligence_aggregator.json');
const NICHE = 'credit_brokerage', REGION = 'Москва/МО';
const STAMP = '20260710_120000';
const REQ = 'req_d3_test';
const LIN = { source_run_ids: 'run_healthy', data_mode: 'live', report_eligible: true };
const health = [{ source_run_id: 'run_healthy', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' }];

// ---------------- WF12: lead scoping + markdown/CTA sanitize ----------------
function runReport(leads, snaps) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf12, 'Set Report Config', [])[0].json;
  Object.assign(cfg, { niche_id: NICHE, region: REGION, agent_request_id: REQ });
  run.outputs['Set Report Config'] = [{ json: cfg }];
  H.inject(run, 'Read competitor_profiles', [Object.assign({ competitor_id: 'c1', competitor_name: 'Тест', platforms: 'vk', offers: 'Кредитный брокер', evidence_count: 3, source_confidence_score: 70, notes: 'run wf10_' + STAMP }, LIN)]);
  H.inject(run, 'Read market_angles', [Object.assign({ angle_id: 'a_' + STAMP, angle_text: 'скорость', category: 'speed', frequency: 3, recommended_content_response: 'x' }, LIN)]);
  H.inject(run, 'Read audience_activity_signals', [Object.assign({ signal_id: 'sig_vk_' + STAMP, platform: 'vk', question_count: 2, objection_count: 0, complaint_count: 0, buying_intent_count: 0, top_pains: '' }, LIN)]);
  H.inject(run, 'Read content_positioning_plan', [{ plan_id: 'plan_' + STAMP, niche: NICHE, region: REGION, source_evidence: 'rows=5 (window 30d)', top_angles: 'скорость (x3)' }]);
  H.inject(run, 'Read competitor_site_snapshots', snaps || []);
  H.inject(run, 'Read public_lead_signals', leads);
  H.inject(run, 'Read source_health', health);
  return H.runCodeNode(run, wf12, 'Build Deterministic Report', [])[0].json;
}

// 1 valid lead in THIS request; 1 foreign-request lead; 1 phantom (blank); + 20 stale blank rows (the "999" class)
const leads = [
  { lead_signal_id: 'L1', agent_request_id: REQ, run_id: 'wf14_x', review_status: 'new', source_platform: 'vk', lead_score: 62, score_band: 'medium', review_priority: 'medium', intent_type: 'buying', pain_type: 'отказы банков', evidence_excerpt: 'Нужен кредит после отказов банков, поможете?', recommended_action: 'manual_review' },
  { lead_signal_id: 'L2', agent_request_id: 'some_other_request', run_id: 'wf14_y', review_status: 'new', source_platform: 'vk', lead_score: 55, score_band: 'medium', review_priority: 'medium', intent_type: 'question', pain_type: 'ипотека', evidence_excerpt: 'Другой запрос — не должен считаться', recommended_action: 'manual_review' },
  { lead_signal_id: '', agent_request_id: REQ, review_status: 'new', source_platform: 'vk', lead_score: 0, evidence_excerpt: '' }
];
for (let i = 0; i < 20; i++) leads.push({ lead_signal_id: '', agent_request_id: '', review_status: 'new', source_platform: '', lead_score: 0, score_band: '', evidence_excerpt: '' });

A.section('D3 — WF12 public-lead count is request-scoped + valid-only (no phantom 999, no empty rows)');
const rep = runReport(leads, []);
const md = String(rep.report_markdown || '');
A.ok('report has no phantom 999', !/лид-сигнал\w*[:\s].*999/i.test(md) && md.indexOf('999') < 0, 'still shows 999');
A.ok('report counts exactly the 1 valid in-request lead', /лид-сигнал[а-яё]*:\s*1(?!\d)/i.test(md), 'lead count != 1: ' + (md.match(/Публичн[^\n]*лид[^\n]*/i) || ['?'])[0]);
A.ok('foreign-request lead excluded', md.indexOf('Другой запрос') < 0, 'foreign lead leaked');
A.ok('no empty «» lead rows rendered', !/«»/.test(md) && !/«\s*»/.test(md), 'empty lead row rendered');
A.ok('the valid lead evidence IS shown', md.indexOf('Нужен кредит после отказов') >= 0, 'valid lead missing');

A.section('D3 — WF12 sanitizes markdown/CTA links (no "](https" fragment)');
const snap = { domain: 'lioncredit.ru', company_name: 'LionCredit', offer_summary: 'Кредит наличными', prices_terms: 'от 4,99%', cta_text: '[Оставить заявку](https://www.lioncredit.ru/apply)', change_type: 'baseline', created_at: '2026-07-08', quality_status: 'healthy', report_eligible: true };
const rep2 = runReport([leads[0]], [snap]);
const md2 = String(rep2.report_markdown || '');
A.ok('CTA label preserved', md2.indexOf('Оставить заявку') >= 0, 'CTA label lost');
A.ok('no malformed "](https" fragment anywhere in the report', md2.indexOf('](http') < 0, 'malformed markdown link present');
A.ok('no dangling "https://www" tail from a cut link', !/https:\/\/www\s*$/m.test(md2), 'dangling url tail');

// ---------------- WF10: audience counters gated to real comment rows ----------------
function runAgg(monitor, review) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf10, 'Set Aggregator Config', [])[0].json;
  run.outputs['Set Aggregator Config'] = [{ json: cfg }];
  H.inject(run, 'Read monitor_queue', monitor);
  H.inject(run, 'Read content_queue', []);
  H.inject(run, 'Read review_queue', review);
  H.inject(run, 'Read source_confidence_rules', []);
  H.inject(run, 'Read source_health', [{ source_run_id: 'run_aud', data_mode: 'live', quality_status: 'healthy', report_eligible: true, quality_flags: '' }]);
  return H.runCodeNode(run, wf10, 'Aggregate Market Intelligence', [])[0].json;
}
const nowIso = new Date().toISOString();
const base = { source_run_id: 'run_aud', data_mode: 'live', report_eligible: true, quality_status: 'healthy', review_status: 'confirmed', created_at: nowIso, region: REGION, platform: 'vk' };
// competitor wall posts (monitor_queue) that CONTAIN '?' — must NOT be counted as audience questions
const competitorPosts = [
  Object.assign({}, base, { entity_type: 'competitor', source_type: 'vk_community_wall', company_name: 'Брокер А', service_type: 'credit_broker', offer_text: 'Нужен кредит? Оформи заявку без предоплаты!', text_context: 'Нужен кредит? Оформи заявку!' }),
  Object.assign({}, base, { entity_type: 'competitor', source_type: 'vk_community_wall', company_name: 'Брокер Б', service_type: 'credit_broker', offer_text: 'Проблемы с кредитом? Поможем!', text_context: 'Проблемы с кредитом? Поможем!' })
];
// genuine audience comments (review_queue, source_type=public_discussion) WITH '?' — SHOULD be counted
const audienceComments = [
  Object.assign({}, base, { entity_type: 'content_idea', source_type: 'public_discussion', touchpoint_type: 'public_comment', text_context: 'Подскажите, как получить кредит после отказа?', comment_text: 'Подскажите, как получить кредит после отказа?', service_type: 'credit_after_refusals' })
];

A.section('D3 — WF10 audience counts come ONLY from public comments (competitor posts are not questions)');
const aggPostsOnly = runAgg(competitorPosts, []);
const sigPostsOnly = (aggPostsOnly.audience_activity_signals || []).find(s => s.platform === 'vk') || {};
A.eq('2 competitor posts with "?" -> question_count 0', Number(sigPostsOnly.question_count || 0), 0);
A.ok('competitor posts still build competitor profiles (not dropped)', (aggPostsOnly.competitor_profiles || []).length >= 1, 'competitors lost');

const aggMixed = runAgg(competitorPosts, audienceComments);
const sigMixed = (aggMixed.audience_activity_signals || []).find(s => s.platform === 'vk') || {};
A.eq('1 real comment question counted, competitor posts excluded -> question_count 1', Number(sigMixed.question_count || 0), 1);

// ---------------- WF14: competitor/market posts never become leads; weak service complaints capped ----------------
const wf14 = H.loadWorkflow('14_public_lead_signal_triage.json');
function runTriage(review, raw) {
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf14, 'Set Triage Config', [])[0].json;
  run.outputs['Set Triage Config'] = [{ json: cfg }];
  H.inject(run, 'Read review_queue', review);
  H.inject(run, 'Read raw_market_records', raw);
  H.inject(run, 'Read public_lead_signals', []);
  const out = H.runCodeNode(run, wf14, 'Build Candidate Pool & Classify', []);
  const sigs = (out.length === 1 && out[0].json._no_signals) ? [] : out.map(i => i.json);
  return sigs;
}
const nowI = new Date().toISOString();
const rbase = { source_run_id: 'run_aud', data_mode: 'live', report_eligible: true, quality_status: 'healthy', review_status: 'confirmed', dedup_status: 'unique', created_at: nowI, region: REGION, platform: 'vk' };
// review_queue: a telegram MARKET/competitor post (source_type=social_channel) with '?' + credit words — must NOT become a lead
const tgMarketPost = Object.assign({}, rbase, { platform: 'telegram', source_type: 'social_channel', entity_type: 'content_idea', record_type_hint: 'market_signal', post_url: 'https://t.me/mfo_market/223', text_context: 'Микрозаймы: медленная смерть кредитной истории? Перехватил 5 тысяч до зарплаты, почему отказали в кредите?' });
// raw_market_records: a genuine credit-pain VK comment (SHOULD be a strong lead) + a pain-less bank service complaint (must be capped)
const creditComment = Object.assign({}, rbase, { source_type: 'public_discussion', touchpoint_type: 'public_comment', record_type_hint: 'buying_intent', post_url: 'https://vk.com/wall-1_3?reply=10', text_context: 'Нужен кредит после отказов банков, плохая кредитная история, поможете получить?', comment_text: 'Нужен кредит после отказов банков, плохая кредитная история, поможете получить?', agent_request_id: '' });
const serviceComplaint = Object.assign({}, rbase, { source_type: 'public_discussion', touchpoint_type: 'public_comment', record_type_hint: 'audience_question', post_url: 'https://vk.com/wall-2_4?reply=11', text_context: 'Почему не работает приложение? Когда заработает сайт?', comment_text: 'Почему не работает приложение? Когда заработает сайт?', agent_request_id: '' });

A.section('D3 — WF14: competitor/market review_queue posts never become public leads (LEAD-AUD-001)');
const sigs1 = runTriage([tgMarketPost], []);
A.ok('a telegram market/competitor post is NOT written as a public lead', !sigs1.some(s => String(s.source_post_url || s.source_url || '').indexOf('t.me/mfo_market') >= 0), 'market post leaked as a lead');

A.section('D3 — WF14: genuine credit lead stays strong; pain-less service complaint is capped to low (LEAD-STRONG-001)');
const sigs2 = runTriage([], [creditComment, serviceComplaint]);
const credLead = sigs2.find(s => String(s.evidence_excerpt || s.evidence_text || '').indexOf('после отказов') >= 0);
const svcLead = sigs2.find(s => String(s.evidence_excerpt || s.evidence_text || '').indexOf('приложение') >= 0);
A.ok('genuine credit-pain comment is written as a lead', !!credLead, 'credit lead missing');
A.ok('genuine credit-pain lead is strong (high/medium)', credLead && ['high', 'medium'].indexOf(String(credLead.score_band)) >= 0, 'credit lead not strong: ' + (credLead && credLead.score_band));
A.ok('pain-less service complaint is NOT in the strong band', !svcLead || ['high', 'medium'].indexOf(String(svcLead.score_band)) < 0, 'service complaint is strong: ' + (svcLead && svcLead.score_band));

A.report('stage-d3-report-quality');
