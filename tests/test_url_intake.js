'use strict';
// test_url_intake.js — URL-INTAKE-001: a user-supplied Website URL is extracted safely, threaded onto the plan,
// persisted, bound into the approval hash, and used by WF20's collection set INSTEAD of the preset competitor list.
const A = require('./_assert');
const PLN = require('../n8n/lib/request_planner.js');
const RU = require('../n8n/lib/plan_render_ru.js');
const CFG = require('../n8n/lib/agent_config.js');

A.section('extractSafeUrls — public https only; reject private/loopback/credentials/non-web');
A.eq('extracts a public https url', PLN.extractSafeUrls('глянь https://finardi.ru/uslugi вот').join(','), 'https://finardi.ru/uslugi');
A.eq('strips trailing punctuation', PLN.extractSafeUrls('сайт https://mkbkfin.ru.').join(','), 'https://mkbkfin.ru');
A.eq('rejects http (non-https)', PLN.extractSafeUrls('http://finardi.ru').length, 0);
A.eq('rejects localhost', PLN.extractSafeUrls('https://localhost/admin').length, 0);
A.eq('rejects private ip 192.168', PLN.extractSafeUrls('https://192.168.0.1/x').length, 0);
A.eq('rejects loopback 127', PLN.extractSafeUrls('https://127.0.0.1').length, 0);
A.eq('rejects 10.x private', PLN.extractSafeUrls('https://10.1.2.3/p').length, 0);
A.eq('rejects 172.16 private', PLN.extractSafeUrls('https://172.16.5.9').length, 0);
A.eq('rejects cloud metadata', PLN.extractSafeUrls('https://169.254.169.254/latest').length, 0);
A.eq('rejects credentials-in-url', PLN.extractSafeUrls('https://user:pass@evil.ru/x').length, 0);
A.eq('dedups + caps at 3', PLN.extractSafeUrls('https://a.ru https://a.ru/ https://b.ru https://c.ru https://d.ru').length, 3);

A.section('deterministicPlan — a pasted URL becomes plan.urls + forces website source');
const cfg = CFG.resolveConfig({ MS_SPREADSHEET_ID: 'S', MS_TELEGRAM_ALLOWED_USER_IDS: '111', MS_SOURCE_ALLOWLIST: 'website,telegram' });
const p = PLN.deterministicPlan('проанализируй https://lioncredit.ru кредитного брокера', cfg);
A.eq('plan.urls carries the supplied url', (p.urls || []).join(','), 'https://lioncredit.ru');
A.ok('website is planned when a url is supplied', p.sources.indexOf('website') >= 0);
const p0 = PLN.deterministicPlan('найди кредитных брокеров в телеграм', cfg);
A.eq('no url supplied => empty plan.urls', (p0.urls || []).length, 0);

A.section('normalizePlan re-sanitizes urls (never trusts a carried raw value)');
const np = PLN.normalizePlan({ sources: ['website'], urls: ['https://ok.ru', 'http://bad.ru', 'https://127.0.0.1'] }, cfg);
A.eq('only the safe https public url survives', (np.urls || []).join(','), 'https://ok.ru');

A.section('planHash binds to the url set (a changed url cannot be approved under an old callback)');
const hNoUrl = PLN.planHash(PLN.normalizePlan({ sources: ['website'], urls: [] }, cfg));
const hUrlA = PLN.planHash(PLN.normalizePlan({ sources: ['website'], urls: ['https://a.ru'] }, cfg));
const hUrlB = PLN.planHash(PLN.normalizePlan({ sources: ['website'], urls: ['https://b.ru'] }, cfg));
A.ok('url set changes the hash', hNoUrl !== hUrlA && hUrlA !== hUrlB);

A.section('buildPlanRow persists urls (space-joined) for WF20');
const row = PLN.buildPlanRow(p, PLN.planIdentity(p, 'req_x', 1), { agent_request_id: 'req_x', owner_user_id: '111', chat_id: '111', ts: 't' });
A.eq('row.urls persisted', String(row.urls), 'https://lioncredit.ru');

A.section('approval message names the supplied site');
const rend = RU.planApprovalMessageRu(p, {});
A.ok('mentions "Проверю указанные сайты"', rend.text.indexOf('Проверю указанные сайты: https://lioncredit.ru') >= 0, rend.text);
const rend0 = RU.planApprovalMessageRu(p0, {});
A.ok('no supplied-site line when no url', rend0.text.indexOf('Проверю указанные сайты') < 0);
A.ok('no stray blank line artifact', !/\n\n\n/.test(rend0.text));

A.section('WF20 threads plan.urls (generator drift-proof)');
const gen = require('../tools/gen_stage4_workflows.js');
function node(file, name) { const w = (gen.generated || []).find(g => g.file === file).workflow; return w.nodes.find(n => n.name === name); }
const planres = node('20_agent_orchestrator.json', 'Resolve Approved Plan').parameters.jsCode;
A.ok('Resolve Approved Plan reads row.urls into the plan', /urls:String\(row\.urls\|\|''\)\.split/.test(planres));
const colset = node('20_agent_orchestrator.json', 'Resolve Collection Set').parameters.jsCode;
A.ok('Resolve Collection Set prefers plan.urls over preset competitor list', /plan\.urls&&plan\.urls\.length\)\?plan\.urls/.test(colset));

A.report('url-intake');
