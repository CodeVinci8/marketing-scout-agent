'use strict';
// test_recheck_target.js — RECHECK-TARGET-001 (DEFECT-C). "Проверить изменения повторно" (a button whose callback
// text is 'intent:rerun_request', or the NL phrase) carries NO url. The planner must PRESERVE the original target
// (url + intent + recheck mode) from the prior report instead of silently degrading to a generic discovery across
// websites/Telegram (live-observed: https://crediti.ru/ became a discovery). A request that DOES name a source is
// unaffected. Covers the canonical planner behaviour AND the WF19 wiring that seeds the prior target.
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const RP = require('../n8n/lib/request_planner.js');

const cfg = { source_allowlist: ['website', 'telegram', 'avito'], default_region: 'Москва/МО', default_niche: 'credit_brokerage' };

A.section('recheck with a prior target preserves the ORIGINAL url + becomes a change-report refresh');
const p = RP.deterministicPlan('проверить изменения повторно', cfg, { prior: { urls: ['https://crediti.ru/'], niche: 'credit_brokerage', region: 'Москва/МО' } });
A.eq('the original url survives exactly', p.urls, ['https://crediti.ru/']);
A.ok('scope is the explicit source, NOT discovery', p.scope_mode === 'explicit_source');
A.eq('analysis_mode is change_report (a re-check)', p.analysis_mode, 'change_report');
A.eq('source_execution_mode is refresh (re-collect the same target)', p.source_execution_mode, 'refresh');
A.ok('force_reprocess + honest recheck reason', p.force_reprocess === true && p.refresh_reason === 'recheck_previous_target');
A.ok('sources are website only (the target platform), not a broad fan-out', JSON.stringify(p.sources) === JSON.stringify(['website']));

A.section('the button callback text form ("intent:rerun_request") is handled the same way');
// the planner itself only sees text + prior; the WF19 node maps the callback to a rerun and supplies the prior.
const pCb = RP.deterministicPlan('intent:rerun_request', cfg, { prior: { urls: ['https://crediti.ru/'] } });
A.eq('callback-form recheck still preserves the url', pCb.urls, ['https://crediti.ru/']);
A.eq('callback-form recheck is a change_report', pCb.analysis_mode, 'change_report');

A.section('no prior target -> unchanged legacy behaviour (generic discovery), never a crash');
const g = RP.deterministicPlan('проверить изменения повторно', cfg, {});
A.eq('without a prior target there is no invented url', g.urls, []);
A.ok('degrades to discovery only when there is genuinely nothing to re-check', g.scope_mode === 'discovery');

A.section('a request that NAMES a source is unaffected — current text wins over prior');
const e = RP.deterministicPlan('Проанализируй https://other.ru/', cfg, { prior: { urls: ['https://crediti.ru/'] } });
A.eq('the current url wins; the prior is ignored', e.urls, ['https://other.ru/']);

A.section('prior with Telegram/VK targets is preserved too (multi-platform recheck)');
const tg = RP.deterministicPlan('проверить изменения повторно', cfg, { prior: { telegram_channels: ['@rusmicrofinance'] } });
A.ok('prior Telegram channel preserved', /rusmicrofinance/.test((tg.telegram_channels || []).join(',')) && tg.analysis_mode === 'change_report' && tg.scope_mode === 'explicit_source');

A.section('WF19 wiring: the Deterministic Plan node derives the prior target for a rerun');
const wf19 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '19_request_planner.json'), 'utf8'));
const det = wf19.nodes.find(function (n) { return n.name === 'Deterministic Plan'; });
const js = (det && det.parameters && det.parameters.jsCode) || '';
A.ok('Deterministic Plan node exists', !!det);
A.ok('node detects a rerun/recheck (callback or NL)', /intent:rerun_request/.test(js) && /RECHECK-TARGET-001/.test(js));
A.ok('node reads url_registry to recover the prior target', /Read url_registry/.test(js) && /__prior/.test(js));
A.ok('node passes the prior to the planner', /deterministicPlan\(text,cfg,__prior/.test(js));
A.ok('node is owner-scoped when recovering the prior', /owner_user_id/.test(js));

A.report('recheck-target');
