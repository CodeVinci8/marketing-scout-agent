// test_intake_gates.js — runs the REAL patched WF08/WF09/WF11 Code nodes (no network) and asserts the
// Stage C intake/analyzer hardening: system-event gate, Avito placeholder/search-card quarantine, query
// separation, paid-path approval gate, affiliate subtype, freshness, llm_primary semantic-v2 prompt.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

// ---------------- WF09 Avito ----------------
const wf09 = H.loadWorkflow('09_avito_classifieds_listing_connector.json');
{
  A.section('WF09 — config exposes paid-path safety + data_mode (§8.1/§13)');
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf09, 'Set Avito Connector Config', [])[0].json;
  A.eq('live_mode default false', cfg.live_mode, false);
  A.eq('require_approval_token true', cfg.require_approval_token, true);
  A.ok('max_budget_usd set', Number(cfg.max_budget_usd) > 0);
  A.eq('data_mode fixture', cfg.data_mode, 'fixture');

  A.section('WF09 — normalize quarantines placeholder/search cards, separates query (§8.2/§8.3)');
  const items = [
    { json: { listing_id: '100', title: 'Ещё4 фото', description: '', price: '', location: 'Москва', seller_name: '', url: 'https://www.avito.ru/moskva/predlozheniya_uslug/x_100', query: 'кредитный брокер Москва', is_detail: false, published_at: '' } },
    { json: { listing_id: '123456', title: 'Ипотечный брокер. Семейная ипотека', description: 'Подбор и одобрение семейной ипотеки, рефинансирование действующих кредитов. Работаем с банками.', price: 'от 10 000 ₽', location: 'Москва', seller_name: 'Ипотека Просто', url: 'https://www.avito.ru/moskva/predlozheniya_uslug/ipoteka_semeynaya_123456', query: 'https://www.avito.ru/moskva?q=ipoteka', is_detail: true, published_at: '2026-06-10' } }
  ];
  const out = H.runCodeNode(run, wf09, 'Normalize Avito Listings', items).map(i => i.json);
  const card = out[0], listing = out[1];
  A.eq('card -> source_candidate', card.record_type_hint, 'source_candidate');
  A.eq('card placeholder_title true', card.placeholder_title, true);
  A.eq('card detail_fetch_required true', card.detail_fetch_required, true);
  A.eq('card llm_eligible false', card.llm_eligible, false);
  A.eq('card report_eligible false', card.report_eligible, false);
  A.ok('card manager_note is NOT a fabricated competitor offer', card.manager_note.indexOf('Оффер конкурента') < 0, card.manager_note);
  A.eq('card search_query is human phrase', card.search_query, 'кредитный брокер Москва');
  A.ok('card source_search_url is a URL', /^https?:\/\//.test(card.source_search_url));
  A.eq('mortgage listing -> competitor_activity', listing.record_type_hint, 'competitor_activity');
  A.eq('mortgage listing -> monitor_queue', listing.predicted_route, 'monitor_queue');
  A.ok('encoded URL did NOT leak into interest_topic', !/^https?:\/\//.test(String(listing.interest_topic)), listing.interest_topic);

  A.section('WF09 — paid Apify path is BLOCKED without live_mode + approval (§8.1, S3-D22/D23)');
  // the gate reads config from the named node -> re-inject config per scenario.
  function gate(cfgOverride) {
    H.inject(run, 'Set Avito Connector Config', [Object.assign({}, cfg, cfgOverride)]);
    return H.runCodeNode(run, wf09, 'LIVE Apify Safety Gate', []);
  }
  let blocked = false;
  try { gate({ fixture_mode: true }); } catch (e) { blocked = true; A.ok('gate blocks fixture_mode', /fixture_mode=true/.test(e.message)); }
  A.ok('gate threw (fixture)', blocked);
  let blocked2 = false;
  try { gate({ fixture_mode: false, live_mode: true, approval_token: '' }); } catch (e) { blocked2 = true; A.ok('gate blocks missing token, never logs value', /approval token/.test(e.message) && e.message.indexOf('AVITO_LIVE_APPROVED') < 0); }
  A.ok('gate threw (no token)', blocked2);
  let blocked3 = false;
  try { gate({ fixture_mode: false, live_mode: true, approval_token: 'AVITO_LIVE_APPROVED', max_budget_usd: 0 }); } catch (e) { blocked3 = true; A.ok('gate blocks missing budget guard', /budget/.test(e.message)); }
  A.ok('gate threw (no budget)', blocked3);
  const passed = gate({ fixture_mode: false, live_mode: true, approval_token: 'AVITO_LIVE_APPROVED', live_max_items: 5, max_budget_usd: 0.5 })[0].json;
  A.eq('approved gate passes', passed._safety_gate, 'passed');
  A.eq('logs approval_token_used=yes (not value)', passed.approval_token_used, 'yes');
  A.ok('gate output NEVER contains the token value', JSON.stringify(passed).indexOf('AVITO_LIVE_APPROVED') < 0);
}

// ---------------- WF11 Telegram ----------------
const wf11 = H.loadWorkflow('11_social_source_connector_foundation.json');
{
  A.section('WF11 — system-event gate, affiliate subtype, freshness (§9.1/§9.4/§9.7)');
  const run = H.makeRun();
  H.runCodeNode(run, wf11, 'Set Connector Config', []);
  const items = [
    { json: { channel: 'credeo_fixture', channel_title: 'Credéo', post_id: '10', post_url: 'https://t.me/credeo_fixture/10', published_at: '2026-06-15T10:00:00+03:00', text: 'Партнёрская программа Credéo: получите персональную реферальную ссылку и вознаграждение за каждого заёмщика. Зарегистрируйтесь и получите доступ.' } },
    { json: { channel: 'credeo_fixture', channel_title: 'Credéo финансы', post_id: '13', post_url: 'https://t.me/credeo_fixture/13', published_at: '2026-06-15T10:00:00+03:00', text: 'Channel name was changed to «Credéo финансы»' } },
    { json: { channel: 'kredit_broker_msk_fixture', channel_title: 'Кредитный брокер', post_id: '101', post_url: 'https://t.me/kredit_broker_msk_fixture/101', published_at: '2026-06-11T14:05:00+03:00', text: 'Кредитный брокер. Помощь в получении кредита после отказов. Без предоплаты, оплата за результат. Оставьте заявку.' } }
  ];
  const out = H.runCodeNode(run, wf11, 'Normalize Telegram Posts', items).map(i => i.json);
  const aff = out[0], sysev = out[1], offer = out[2];
  A.eq('affiliate -> competitor_activity', aff.record_type_hint, 'competitor_activity');
  A.eq('affiliate subtype', aff.activity_subtype, 'affiliate_program');
  A.eq('affiliate -> monitor_queue', aff.predicted_route, 'monitor_queue');
  A.eq('system event detected', sysev.record_type_hint, 'system_event');
  A.eq('system event hard_skip', sysev.hard_skip, true);
  A.eq('system event skip_reason', sysev.skip_reason, 'telegram_service_message');
  A.eq('system event service NOT from title', sysev.service_hint, 'unknown');
  A.eq('system event route skipped_log', sysev.predicted_route, 'skipped_log');
  A.eq('system event llm_eligible false', sysev.llm_eligible, false);
  A.eq('direct offer -> competitor_activity', offer.record_type_hint, 'competitor_activity');
  A.eq('direct offer subtype', offer.activity_subtype, 'direct_offer');
  A.ok('freshness computed', typeof offer.age_days === 'number' && !!offer.freshness_bucket, 'age=' + offer.age_days);
}

// ---------------- WF08 analyzer ----------------
const wf08 = H.loadWorkflow('08_touchpoint_analyzer.json');
{
  A.section('WF08 — declares llm_primary mode + versions (§2.1)');
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, wf08, 'Set Analyzer Config', [])[0].json;
  A.eq('analysis_mode=llm_primary', cfg.analysis_mode, 'llm_primary');
  A.eq('llm_enabled false (safe offline default)', cfg.llm_enabled, false);
  A.eq('semantic_schema_version', cfg.semantic_schema_version, 'semantic-v2');
  A.eq('taxonomy_version', cfg.taxonomy_version, 'semantic-v2.0');

  A.section('WF08 — Prepare Record hard-skips a Telegram system event before Claude (§9.1)');
  // build a Prepare Record context: it reads $('Set Analyzer Config') + $json
  H.runCodeNode(run, wf08, 'Set Analyzer Config', []);
  const sysRec = { record_id: 'r1', text_context: 'Channel name was changed to «Credéo финансы»', record_type_hint: 'system_event', platform: 'telegram', source_type: 'social_channel', batch_index: 1 };
  const prep = H.runCodeNode(run, wf08, 'Prepare Record', [{ json: sysRec }])[0].json;
  A.eq('system event -> det.is_irrelevant', prep.det.is_irrelevant, true);
  A.eq('system event -> skipped_log', prep.det.route, 'skipped_log');
  A.eq('system event -> no Claude (call_claude false)', prep.call_claude, false);
  A.ok('system event det service unknown', prep.det.service_type === 'unknown');

  A.section('WF08 — llm_primary prompt is semantic-v2 with evidence separation (§5)');
  // gate requires llm_enabled=true; inject an approved config
  const run2 = H.makeRun();
  H.inject(run2, 'Set Analyzer Config', [Object.assign({}, cfg, { llm_enabled: true })]);
  H.inject(run2, 'Prepare Record', [{ analyzer_text: 'Финансирование под залог авто. До 15 000 000 ₽ в день обращения. Без справок.', text_context: 'x', post_url: 'https://t.me/credeo_fixture/12', platform: 'telegram', source_type: 'social_channel', profile_name: 'Credéo', record_type_hint: 'market_signal', service_hint: 'unknown', det: {} }]);
  const req = H.runCodeNode(run2, wf08, 'Build Primary Claude Request', [])[0].json;
  A.ok('request has system + messages', !!req.system && Array.isArray(req.messages));
  A.ok('uses existing sonnet model', /claude-sonnet/.test(req.model));
  A.ok('system instructs POST_EVIDENCE overrides hints', /POST_EVIDENCE/.test(req.system) && /override/i.test(req.system));
  A.ok('system forbids inferring offer from channel title alone', /channel title or a search query alone/i.test(req.system));
  const user = JSON.parse(req.messages[0].content);
  A.ok('payload separates POST_EVIDENCE/SOURCE_METADATA/UPSTREAM_HINTS', !!user.POST_EVIDENCE && !!user.SOURCE_METADATA && !!user.UPSTREAM_HINTS);
  A.ok('hints labelled weak priors', /WEAK PRIORS/.test(user.UPSTREAM_HINTS._note));
  A.eq('schema is semantic-v2', user.OUTPUT_SCHEMA.schema_version, 'semantic-v2');
  A.ok('enums include canonical record_types', user.ALLOWED_ENUMS.record_type.indexOf('competitor_activity') >= 0 && user.ALLOWED_ENUMS.record_type.indexOf('system_event') >= 0);
  A.ok('service enums include pts_loan + auto_lease_refinance', user.ALLOWED_ENUMS.service.indexOf('pts_loan') >= 0 && user.ALLOWED_ENUMS.service.indexOf('auto_lease_refinance') >= 0);
  A.eq('post_url preserved in POST_EVIDENCE', user.POST_EVIDENCE.post_url, 'https://t.me/credeo_fixture/12');

  A.section('WF08 — llm guard blocks Claude when llm_enabled=false');
  const run3 = H.makeRun();
  H.inject(run3, 'Set Analyzer Config', [Object.assign({}, cfg, { llm_enabled: false })]);
  H.inject(run3, 'Prepare Record', [{ det: {} }]);
  let guarded = false;
  try { H.runCodeNode(run3, wf08, 'Build Primary Claude Request', []); } catch (e) { guarded = /llm_enabled=false/.test(e.message); }
  A.ok('guard throws when llm_enabled=false', guarded);
}

A.report('intake-gates');
