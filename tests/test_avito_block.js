'use strict';
// test_avito_block.js — AVITO-BLOCK-001: graceful, feature-flagged temporary disablement of Avito in the bot /
// product UX. Avito is OPTIONAL and operator-infra-blocked (needs a Residential proxy on a paid Apify plan;
// AVITO_SOURCE_QUALITY=BLOCKED_OPTIONAL_OPERATOR_INFRA_PREREQUISITE). While blocked the bot must never offer,
// plan, select or run Avito; an explicit Avito request must get an honest Russian "temporarily unavailable"
// message; the WF09 implementation + tests + evidence stay intact for a future re-enable (MS_AVITO_ENABLED=true).
const A = require('./_assert');
const fs = require('fs');
const path = require('path');
const CFG = require('../n8n/lib/agent_config.js');
const PLN = require('../n8n/lib/request_planner.js');
const RU = require('../n8n/lib/plan_render_ru.js');
const CH = require('../n8n/lib/agent_charter.js');
const SP = require('../n8n/lib/scope_preview.js');
const RP = require('../n8n/lib/refresh_policy.js');

// Production-like env: the operator's allowlist DOES list avito, and every paid gate is wide open — the block
// must still hold purely from the source-quality flag, not from a happens-to-be-off collector.
const PROD_ENV = {
  MS_SPREADSHEET_ID: 'SHEET', MS_TELEGRAM_ALLOWED_USER_IDS: '111',
  MS_SOURCE_ALLOWLIST: 'website, avito, telegram',
  MS_ENABLE_EXTERNAL_ACTIONS: 'true', MS_ENABLE_APIFY: 'true', MS_MAX_EXTERNAL_CALLS: '40'
};

A.section('agent_config — the ONE gate: Avito stripped from the resolved allowlist while blocked');
const blocked = CFG.resolveConfig(PROD_ENV);
A.eq('avito stripped from runtime allowlist (default blocked)', blocked.source_allowlist.join(','), 'website,telegram');
A.ok('blocked_sources records avito', (blocked.blocked_sources || []).indexOf('avito') >= 0);
A.eq('block reason is residential proxy', blocked.avito_block_reason, 'residential_proxy_required');
A.ok('sourceAllowed(avito) is false while blocked', !CFG.sourceAllowed(blocked, 'avito'));
A.ok('other allowlisted sources unaffected', CFG.sourceAllowed(blocked, 'website') && CFG.sourceAllowed(blocked, 'telegram'));
A.ok('NO Avito collection can be triggered even with apify + external actions ON',
  !CFG.collectorEnabled(blocked, 'avito') && CFG.freePathStatus(blocked).collectors.avito === false);

A.section('agent_config — re-enable path is intact (nothing deleted): MS_AVITO_ENABLED=true');
const on = CFG.resolveConfig(Object.assign({}, PROD_ENV, { MS_AVITO_ENABLED: 'true' }));
A.eq('re-enabled allowlist keeps avito', on.source_allowlist.join(','), 'website,avito,telegram');
A.eq('re-enabled => blocked_sources empty', (on.blocked_sources || []).length, 0);
A.ok('re-enabled sourceAllowed(avito) true', CFG.sourceAllowed(on, 'avito'));
A.ok('dormant Avito config preserved (queries not deleted)', Array.isArray(on.avito_queries) && on.avito_queries.length === 3);

A.section('request planner — Avito is never proposed in normal planning while blocked');
const genericPlan = PLN.deterministicPlan('найди кредитных брокеров в Москве и сравни их предложения', blocked);
A.ok('generic scan uses only allowlisted sources (no avito)', genericPlan.sources.indexOf('avito') < 0);
const avitoPlan = PLN.deterministicPlan('спарси объявления конкурентов на авито в Москве', blocked);
A.ok('explicit avito request does NOT plan avito (clamped to allowlist)', avitoPlan.sources.indexOf('avito') < 0);
A.ok('explicit avito request still yields a runnable plan on remaining sources', avitoPlan.sources.length >= 1);

A.section('request planner — an EXPLICIT blocked-source request is detected (not silently dropped)');
A.eq('avito mention detected as blocked-requested', PLN.blockedRequestedSources('спарси объявления на авито', blocked).join(','), 'avito');
A.eq('latin "avito" also detected', PLN.blockedRequestedSources('scan avito listings', blocked).join(','), 'avito');
A.eq('no avito mention => nothing blocked', PLN.blockedRequestedSources('посмотри сайты конкурентов', blocked).length, 0);
A.eq('when re-enabled => avito is not "blocked-requested"', PLN.blockedRequestedSources('спарси объявления на авито', on).length, 0);

A.section('plan_render_ru — honest Russian unavailable message, no internal leakage');
const msg = RU.ruAvitoUnavailableMessage();
A.ok('names the residential-proxy reason', /резидентн/i.test(msg) && /временно недоступ/i.test(msg));
A.ok('reassures it can be enabled later without losing work', /(позже|включить)/i.test(msg) && /сохранен/i.test(msg));
A.ok('offers to proceed on other sources', /остальны|доступн/i.test(msg));
A.ok('NO env var / flag / provider / workflow / enum leakage',
  !/MS_[A-Z]/.test(msg) && !/apify/i.test(msg) && !/allowlist/i.test(msg) && !/\bWF\d/i.test(msg) && !/avito/i.test(msg) && !/proxy/i.test(msg));

A.section('capability catalog + help never advertise Avito while blocked');
const catalog = CH.capabilityCatalogText(blocked);
A.ok('catalog does not mention Avito (latin or Cyrillic)', !/avito/i.test(catalog) && catalog.indexOf('Авито') < 0);
const help = RU.ruHelpMessage(CH.availableCapabilities(blocked));
A.ok('help does not mention Avito', !/avito/i.test(help) && help.indexOf('Авито') < 0);

A.section('scope preview + refresh policy track the allowlist (blocked = unavailable)');
A.ok('scope_preview: avito unavailable while blocked', !SP.collectorAvailable('avito', blocked));
A.ok('scope_preview: avito available when re-enabled', SP.collectorAvailable('avito', on));
A.ok('refresh_policy: avito unavailable while blocked', !RP.collectorAvailable('avito', blocked));
A.ok('refresh_policy: avito available when re-enabled', RP.collectorAvailable('avito', on));
const prev = SP.buildScopePreview({ goal: 'g', platforms: ['website', 'avito'], cfg: blocked, refresh_plan: { expected_calls: 1 } });
A.ok('scope preview lists avito as unavailable, website as available',
  prev.available_sources.indexOf('avito') < 0 && prev.available_sources.indexOf('website') >= 0 &&
  prev.unavailable_sources.some(u => String(u.platform).toLowerCase() === 'avito'));

A.section('WF19 approval node wires the honest notice (generator drift-proof)');
const gen = require('../tools/gen_stage4_workflows.js');
function node(file, name) { const w = (gen.generated || []).find(g => g.file === file).workflow; return w.nodes.find(n => n.name === name); }
const approval = node('19_request_planner.json', 'Build Approval Message').parameters.jsCode;
A.ok('WF19 embeds blockedRequestedSources detection', /blockedRequestedSources\(/.test(approval));
A.ok('WF19 prepends ruAvitoUnavailableMessage on an avito request', /ruAvitoUnavailableMessage\(\)/.test(approval) && /avito/.test(approval));

A.section('existing Avito implementation, tests and evidence remain intact (not deleted)');
A.ok('WF09 Avito connector workflow still present', fs.existsSync(path.join(__dirname, '..', 'n8n', 'workflows', '09_avito_classifieds_listing_connector.json')));
['test_wf09_actor_input.js', 'test_wf09_avito_proxy.js', 'test_wf09_searchcard.js', 'test_intake_gates.js'].forEach(function (t) {
  A.ok('Avito test preserved: ' + t, fs.existsSync(path.join(__dirname, t)));
});

A.report('avito-block');
