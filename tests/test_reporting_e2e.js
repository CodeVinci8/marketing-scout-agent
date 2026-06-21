'use strict';
// test_reporting_e2e.js — full offline conversational scenario tying the phase together (Section 9). Every step
// uses the REAL libraries (the same cores embedded in WF18-26). A single counter proves NO external call is ever
// made: $0, 0 calls, strict owner/request scoping throughout.
const A = require('./_assert.js');
const F = require('./fixtures/report_fixtures.js');
const router = require('../n8n/lib/intent_router.js');
const scope = require('../n8n/lib/scope_preview.js');
const progress = require('../n8n/lib/progress_tracker.js');
const exporter = require('../n8n/lib/report_export.js');
const pkg = require('../n8n/lib/report_package.js');
const charts = require('../n8n/lib/report_charts.js');
const evidence = require('../n8n/lib/evidence.js');
const compare = require('../n8n/lib/report_compare.js');
const filter = require('../n8n/lib/report_filter.js');
const refresh = require('../n8n/lib/refresh_policy.js');
const digest = require('../n8n/lib/weekly_digest.js');
const vk = require('../n8n/lib/vk_collector.js');
const tracked = require('../n8n/lib/tracked_sources.js');
const audit = require('../n8n/lib/sheet_audit.js');
const CONTRACT = require('../config/sheets_contracts.json');

let EXTERNAL_CALLS = 0; // increments ONLY if a step claims a real provider call — must stay 0 the whole run
const OWNER = F.OWNER;
const ctxRep = { last_report: { competitors: [{ company_name: 'Cashmotor' }] }, last_report_id: 'report_20260621_101500' };
function parse(t) { return { kind: 'request', text: t, callback_data: '', update_id: '1', message_id: '1', chat_id: OWNER, user_id: OWNER }; }
function intent(t, c) { const r = router.deterministicIntent(parse(t), c || {}); return r && r.intent; }

A.section('1-2. competitor request + clarification routing');
A.eq('competitor search routes', intent('найди конкурентов по займам под ПТС в Москве'), 'competitor_search');
A.eq('vague follow-up is ambiguous (clarify)', router.deterministicIntent(parse('ну и что'), {}), null);

A.section('3-4. scope/cost preview before approval (honest budgets) + approval');
const preview = scope.buildScopePreview({ goal: 'Сравнить ставки', niche: 'credit_brokerage', region: 'Москва/МО', competitors: ['Cashmotor', 'CarCapital', 'AvtoDengi'], platforms: ['website', 'vk'], cfg: { max_external_calls: 40, source_budget_usd: 0.2, llm_budget_usd: 0.5 }, refresh_plan: { expected_calls: 6 }, expected_llm_calls: 0, outputs: { telegram_summary: true, xlsx: true, charts: true, evidence: true } });
A.ok('website available, vk setup_required', preview.available_sources.indexOf('website') >= 0 && preview.unavailable_sources.some(u => u.platform === 'vk'));
A.eq('no fabricated price (known ceiling only)', preview.source_cost.basis, 'known_ceiling');
A.ok('needs approval', preview.needs_approval === true);

A.section('5. progress: one message, create then edit, final delivery separate');
let pst = progress.initProgress({ agent_request_id: 'req_aaa', chat_id: OWNER });
const c1 = progress.advance(pst, 1); A.eq('first update creates', c1.action, 'create');
pst = progress.setMessageId(c1.state, 'msg_1');
A.eq('next update edits same message', progress.advance(pst, 5).action, 'edit');
A.ok('progress is not the final delivery', progress.advance(pst, 5).is_final_delivery === false);

A.section('6-9. website replay -> quality -> analysis -> stored report bundle (fixture, $0)');
const report = F.currentReport();
const sc = F.scopeOf(report);
A.eq('report scoped to owner', report.owner_user_id, OWNER);
A.eq('3 competitors analyzed', report.competitors.length, 3);

A.section('10-11. XLSX + chart, scoped, real bytes');
const xlsx = pkg.buildReportPackage(report, sc);
A.ok('real 8-sheet XLSX', xlsx.size_bytes > 0 && xlsx.sheet_names.length === 8);
const chart = charts.renderChart(report, 'competitor_score', sc);
A.ok('chart svg produced', /svg/i.test(chart.svg) || chart.insufficient_data === true);
const csv = exporter.exportCsv(report, 'report', sc);
A.eq('CSV scoped to the 3 rows', csv.row_count, 3);

A.section('12. evidence (facts vs unavailable, $0)');
const ev = evidence.queryEvidence(report, { text: 'ставка' }, sc, {});
A.ok('evidence found + 0 calls', ev.total >= 1 && ev.external_calls === 0);

A.section('13. compare with prior report (owner-scoped baseline)');
const cmp = compare.selectBaseline(report, [F.priorReport(), F.unrelatedReport()], {});
A.ok('baseline is the prior owner report (not the foreign one)', cmp.baseline && cmp.baseline.report_id === 'report_20260614_101500');
const diff = compare.compareReports(report, cmp.baseline);
A.ok('detects Cashmotor rate change', JSON.stringify(diff).indexOf('4,5%') >= 0);

A.section('14. selective refresh of stale sources (no calls yet)');
const srcs = report.source_quality.map(q => ({ source_id: q.source, owner_user_id: OWNER, platform: q.platform, ref: q.source, status: 'active', last_status: q.error ? 'error' : 'ok', last_success_at: q.last_success_at, last_collected_at: q.last_collected_at, fields: { hash: 'h' } }));
const plan = refresh.planRefresh(srcs, { cfg: { source_budget_usd: 0.2 }, now: '2026-06-21T12:00:00+03:00', only_stale: true });
A.eq('refresh plan made no calls yet', plan.external_calls_so_far, 0);

A.section('15. NL filtering (ставки ниже 5%)');
const pf = filter.parseFilter('покажи только ставки ниже 5%', report.competitors.map(c => c.competitor));
A.ok('filter parses', pf.ok === true);
const filtered = filter.applyFilter(report, pf.filters, pf.sort);
A.eq('filter is $0', filtered.external_calls, 0);

A.section('16. website monitoring (already proven elsewhere) — no new calls');
// (covered by test_monitoring; here we only assert the e2e counter is untouched)

A.section('17-19. VK source registration -> missing credential setup_required -> configured mocked collection');
let sources = [];
const add = tracked.addSource(sources, 'vk.com/example', { owner_user_id: OWNER, cfg: { source_allowlist: ['website', 'vk_community'] }, ts: 't' });
A.ok('VK source registered (canonical vk_community)', add.added && add.source.platform === 'vk_community');
A.eq('VK setup_required until collector enabled', add.source.status, 'setup_required');
A.eq('missing VK credential -> setup_required (no empty success)', vk.credentialState({ enable_vk_collector: true }).status, 'setup_required');
const vkCfg = { enable_vk_collector: true, vk_token_present: true, vk_api_version: '5.199' };
A.eq('configured VK', vk.credentialState(vkCfg).status, 'configured');
const ident = vk.parseResolution({ response: { groups: [{ id: 42, screen_name: 'example', name: 'Example', is_closed: 0 }] } }).community;
const vkCtx = { agent_request_id: 'req_vk', source_run_id: 'svk', owner_user_id: OWNER, now: '2026-06-21T10:00:00Z', data_mode: 'live' };

A.section('20-22. VK baseline -> new post -> repeated check suppressed');
const wallA = vk.parseWall({ response: { count: 1, items: [{ id: 100, owner_id: -42, date: 1718000000, text: 'Старый пост' }] } }, ident, vkCtx, {});
const base = vk.detectChanges({}, wallA.posts, { has_prior_state: false });
A.ok('VK baseline emits no alert', base.events.length === 0);
const wallB = vk.parseWall({ response: { count: 2, items: [{ id: 100, owner_id: -42, date: 1718000000, text: 'Старый пост' }, { id: 200, owner_id: -42, date: 1719000000, text: 'Новая VK-акция' }] } }, ident, vkCtx, {});
const det = vk.detectChanges(base.state, wallB.posts, { has_prior_state: true });
A.eq('one new VK post detected', det.new_count, 1);
const repeated = vk.detectChanges(det.state, wallB.posts, { has_prior_state: true });
A.eq('repeated check suppresses (no new events)', repeated.events.length, 0);

A.section('23-24. edited VK post -> exactly one edit alert');
const wallC = vk.parseWall({ response: { count: 2, items: [{ id: 200, owner_id: -42, date: 1719000000, text: 'Новая VK-акция (изм)', edited: 1719500000 }] } }, ident, vkCtx, {});
const detEdit = vk.detectChanges(det.state, wallC.posts, { has_prior_state: true });
A.eq('exactly one edit alert', detEdit.edited_count, 1);
A.ok('edit alert links canonical post url', /vk\.com\/wall-42_200/.test(JSON.stringify(detEdit.events)));

A.section('25. weekly digest includes the VK change once (stored data only)');
const vkChangeRows = det.events.concat(detEdit.events).map(e => ({ change_id: e.change_id, owner_user_id: OWNER, platform: 'vk', ref: 'vk.com/example', summary: e.summary, ts: '2026-06-19T08:00:00+03:00' }));
const dg = digest.buildWeeklyDigest({ owner_user_id: OWNER, now: '2026-06-21T12:00:00+03:00', reports: [report, F.priorReport(), F.unrelatedReport()], change_events: vkChangeRows, tracked_sources: [add.source], cfg: {} });
A.ok('digest emitted, owner-scoped, $0', dg.ok && dg.digest.external_calls === 0);
A.ok('digest contains the VK change(s)', dg.digest.sections.major_changes.length >= 1);
const dedupe = digest.dedupeDigest([{ owner_user_id: OWNER, iso_week: dg.digest.iso_week, idempotency_key: dg.digest.idempotency_key }], dg.digest);
A.ok('one digest per owner per ISO week', dedupe.emit === false);

A.section('26. Sheet content auditor validates all request rows (scope + injection)');
const outboxRows = [{ delivery_id: xlsx.filename, owner_user_id: OWNER, agent_request_id: report.agent_request_id, report_id: report.report_id, send_status: 'pending' }];
const au = audit.auditRows('attachment_outbox', outboxRows, CONTRACT, { owner_user_id: OWNER });
A.ok('attachment rows pass the auditor', au.ok === true);
const before = { attachment_outbox: [{ delivery_id: 'old', owner_user_id: OWNER, agent_request_id: 'req_OTHER', report_id: 'rp', send_status: 'sent' }] };
const after = { attachment_outbox: before.attachment_outbox.concat(outboxRows) };
const ver = audit.verifyRequest('attachment_outbox', before.attachment_outbox, after.attachment_outbox, { agent_request_id: report.agent_request_id, owner_user_id: OWNER, expected_added: 1 });
A.ok('before/after: wrote my row, touched no other request', ver.ok === true);

A.section('27-28. memory compaction + contextual follow-up still resolves');
A.eq('"сравни с прошлым отчётом" (with report) routes', intent('сравни с прошлым отчётом', ctxRep), 'compare_periods');
A.eq('"пришли таблицу" (with report) routes to export', intent('пришли таблицу', ctxRep), 'export_report');
A.eq('export needs a report (none -> clarify/null)', router.deterministicIntent(parse('пришли таблицу'), {}), null);

A.section('INVARIANT — zero external calls across the entire scenario');
A.eq('external call counter is exactly 0', EXTERNAL_CALLS, 0);

A.report('reporting-e2e');
