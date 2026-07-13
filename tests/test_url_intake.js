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

A.section('approval message names the supplied site (grouped explicit-source block)');
const rend = RU.planApprovalMessageRu(p, {});
A.ok('mentions "Проверю указанные источники" + the site host', rend.text.indexOf('Проверю указанные источники:') >= 0 && rend.text.indexOf('lioncredit.ru') >= 0, rend.text);
const rend0 = RU.planApprovalMessageRu(p0, {});
A.ok('no explicit-source block when no url', rend0.text.indexOf('Проверю указанные') < 0);
A.ok('generic "Источники:" shown when no explicit source', rend0.text.indexOf('Источники:') >= 0);
A.ok('no stray blank line artifact', !/\n\n\n/.test(rend0.text));

A.section('URL-INTAKE-002 — extractExplicitSources: mixed websites + Telegram + VK; reject invite/private');
const ex = PLN.extractExplicitSources('сравни https://finardi.ru t.me/da_credit vk.com/kredit874 и t.me/+secret');
A.eq('website extracted', ex.websites.join(','), 'https://finardi.ru');
A.eq('telegram channel normalized to @handle', ex.telegram_channels.join(','), '@da_credit');
A.eq('vk community normalized', ex.vk_sources.join(','), 'vk.com/kredit874');
A.ok('invite-only telegram rejected with reason', ex.rejected.some(r => r.reason === 'invite_only_or_private'));
A.eq('t.me/s/<ch> preview form also parses', PLN.extractExplicitSources('https://t.me/s/broker_Aleksey').telegram_channels.join(','), '@broker_aleksey');
A.eq('total explicit sources capped at 3', (function () { const e = PLN.extractExplicitSources('https://a.ru https://b.ru https://c.ru https://d.ru t.me/e'); return e.websites.length + e.telegram_channels.length + e.vk_sources.length; })(), 3);

A.section('URL-INTAKE-002 — plan carries per-platform supplied sources (allowlisted only)');
const cfg3 = CFG.resolveConfig({ MS_SPREADSHEET_ID: 'S', MS_TELEGRAM_ALLOWED_USER_IDS: '111', MS_SOURCE_ALLOWLIST: 'website,telegram' });
const pm = PLN.deterministicPlan('Проверь https://finardi.ru и t.me/da_credit', cfg3);
A.eq('plan sources = supplied platforms (website+telegram)', pm.sources.slice().sort().join(','), 'telegram,website');
A.eq('plan.urls', (pm.urls || []).join(','), 'https://finardi.ru');
A.eq('plan.telegram_channels', (pm.telegram_channels || []).join(','), '@da_credit');
A.ok('plan.explicit_sources flagged', pm.explicit_sources === true);
const pvk = PLN.deterministicPlan('глянь vk.com/kredit874', cfg3);
A.ok('supplied VK dropped when vk not in allowlist', (pvk.vk_communities || []).length === 0 && pvk.sources.indexOf('vk') < 0);
const rowm = PLN.buildPlanRow(pm, PLN.planIdentity(pm, 'req_m', 1), { agent_request_id: 'req_m', owner_user_id: '111', ts: 't' });
A.eq('row persists telegram_channels', String(rowm.telegram_channels), '@da_credit');
A.eq('row persists explicit flag', String(rowm.explicit_sources), 'true');

A.section('URL-INTAKE-002 — grouped-by-platform plan text');
const rendm = RU.planApprovalMessageRu(pm, {});
A.ok('shows "Проверю указанные источники:"', rendm.text.indexOf('Проверю указанные источники:') >= 0, rendm.text);
A.ok('groups sites', /•\s*сайт[ыа]?:\s*finardi\.ru/.test(rendm.text), rendm.text);
A.ok('groups Telegram', /•\s*Telegram:\s*@da_credit/.test(rendm.text), rendm.text);
A.ok('does NOT show generic "Источники:" when explicit', rendm.text.indexOf('Источники: сайты конкурентов') < 0);

A.section('WF20 threads plan.urls (generator drift-proof)');
const gen = require('../tools/gen_stage4_workflows.js');
function node(file, name) { const w = (gen.generated || []).find(g => g.file === file).workflow; return w.nodes.find(n => n.name === name); }
const planres = node('20_agent_orchestrator.json', 'Resolve Approved Plan').parameters.jsCode;
A.ok('Resolve Approved Plan reads row.urls into the plan', /urls:String\(row\.urls\|\|''\)\.split/.test(planres));
const colset = node('20_agent_orchestrator.json', 'Resolve Collection Set').parameters.jsCode;
A.ok('Resolve Collection Set prefers plan.urls over preset competitor list', /plan\.urls&&plan\.urls\.length\)\?plan\.urls/.test(colset));
A.ok('Resolve Collection Set prefers supplied Telegram channels', /plan\.telegram_channels&&plan\.telegram_channels\.length/.test(colset));
A.ok('Resolve Collection Set prefers supplied VK communities', /plan\.vk_communities&&plan\.vk_communities\.length/.test(colset));
A.ok('Resolve Approved Plan reads telegram_channels + vk_communities from the row', /telegram_channels:String\(row\.telegram_channels/.test(planres) && /vk_communities:String\(row\.vk_communities/.test(planres));

A.section('E2-ROUTE-001 — a BARE domain (no scheme) is extracted as an explicit website source');
const P = require('../n8n/lib/request_planner.js');
A.eq('"дай отчёт по autolombardn1.ru" -> website', P.extractExplicitSources('дай отчёт по этому сайту autolombardn1.ru').websites.join(','), 'https://autolombardn1.ru');
A.eq('"разбери autolombardn1.ru" -> website', P.extractExplicitSources('разбери autolombardn1.ru').websites.join(','), 'https://autolombardn1.ru');
A.eq('mixed https + bare domain both extracted', P.extractExplicitSources('проанализируй https://finardi.ru и mkbkfin.ru').websites.join(','), 'https://finardi.ru,https://mkbkfin.ru');
A.eq('an email host is NOT a source', P.extractExplicitSources('напиши на me@finardi.ru').websites.length, 0);
A.eq('discovery text without a domain extracts nothing', P.extractExplicitSources('найди сайты конкурентов по ПТС').websites.length, 0);
A.eq('bare domain deduped against its https form', P.extractExplicitSources('отчёт по https://autolombardn1.ru и autolombardn1.ru').websites.length, 1);

A.report('url-intake');
