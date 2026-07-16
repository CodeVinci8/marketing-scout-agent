'use strict';
// test_reporting_workflows.js — proves the reporting-UX libraries are actually wired into generated n8n
// workflows (not just unit-tested): WF24 (export/filter/compare/refresh/evidence + document/photo delivery +
// attachment outbox dedup) and WF25 (weekly digest), scope_preview in WF19's approval message, progress in
// WF20, plus NL routing for the reporting phrases. Runtime-shaped (runs the actual Code nodes), $0, 0 calls.
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const H = require('./wf_harness.js');
const F = require('./fixtures/report_fixtures.js');
const router = require('../n8n/lib/intent_router.js');
const charter = require('../n8n/lib/agent_charter.js');

// same extraction the generator uses (strips 'use strict', module.exports AND local cross-requires)
function libCore(name) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  s = s.replace(/^\s*const\s*\{[^}]*\}\s*=\s*require\('\.\/[^']+'\);\s*$/gm, '');
  return s.trim();
}
function extract(code, name) {
  const m = code.match(new RegExp('// embedded n8n/lib/' + name + '\\.js[^\\n]*\\n([\\s\\S]*?)\\n// --- end embedded ' + name + ' ---'));
  return m ? m[1] : null;
}
function nodeCode(wf, name) { const n = wf.nodes.find(x => x.name === name); return n ? n.parameters.jsCode : null; }

const WF24 = H.loadWorkflow('24_report_export_delivery.json');
const WF25 = H.loadWorkflow('25_weekly_digest.json');
const WF19 = H.loadWorkflow('19_request_planner.json');
const WF20 = H.loadWorkflow('20_agent_orchestrator.json');

A.section('WF24/WF25 envelope: inactive, callable + manual, no public webhook');
A.eq('WF24 inactive', WF24.active, false);
A.eq('WF25 inactive (schedule disabled by default)', WF25.active, false);
A.ok('WF24 has Execute Sub-workflow Trigger', WF24.nodes.some(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger' && n.name === 'When Called by Agent'));
A.ok('WF24 keeps a manual trigger', WF24.nodes.some(n => n.type === 'n8n-nodes-base.manualTrigger'));
A.ok('WF24 has NO public webhook', !WF24.nodes.some(n => n.type === 'n8n-nodes-base.webhook'));
A.ok('WF25 has a schedule trigger', WF25.nodes.some(n => n.type === 'n8n-nodes-base.scheduleTrigger'));
A.ok('WF25 callable + manual', WF25.nodes.some(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger') && WF25.nodes.some(n => n.type === 'n8n-nodes-base.manualTrigger'));
A.ok('WF25 has NO public webhook', !WF25.nodes.some(n => n.type === 'n8n-nodes-base.webhook'));

A.section('WF24 embeds the reporting libraries with no drift');
const EMBED24 = [['Select & Scope Report', 'report_export'], ['Build Scope Preview', 'scope_preview'], ['Init Progress', 'progress_tracker'],
  ['Apply Action', 'report_filter'], ['Apply Action', 'report_compare'], ['Apply Action', 'refresh_policy'], ['Apply Action', 'evidence'],
  ['Build Exports & Outbox', 'report_export'], ['Build Exports & Outbox', 'xlsx_writer'], ['Build Exports & Outbox', 'report_package'], ['Build Exports & Outbox', 'report_charts'], ['Build Exports & Outbox', 'attachment_router'], ['Build Exports & Outbox', 'telegram_io']];
for (const [node, lib] of EMBED24) A.eq('WF24 ' + node + ' embeds ' + lib, extract(nodeCode(WF24, node), lib), libCore(lib));
A.eq('WF25 Build Weekly Digest embeds weekly_digest', extract(nodeCode(WF25, 'Build Weekly Digest'), 'weekly_digest'), libCore('weekly_digest'));
A.eq('WF25 attachments embed report_package', extract(nodeCode(WF25, 'Build Digest Attachments'), 'report_package'), libCore('report_package'));

A.section('WF24 Telegram delivery + outbox paths actually exist');
const senders = WF24.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest');
A.ok('WF24 has a sendDocument node', senders.some(n => /sendDocument/.test(n.parameters.url)));
// QA-004: the chart is an SVG (vector); it MUST be uploaded via sendDocument, never sendPhoto.
A.ok('WF24 has NO sendPhoto node (SVG never goes via sendPhoto)', !senders.some(n => /sendPhoto/.test(n.parameters.url)));
A.ok('WF24 sends the SVG chart via sendDocument', senders.some(n => /Send Chart/.test(n.name) && /sendDocument/.test(n.parameters.url)));
A.ok('WF24 sendDocument uploads binary multipart', senders.some(n => n.parameters.contentType === 'multipart-form-data'));
A.ok('WF24 appends attachment_outbox', WF24.nodes.some(n => n.type === 'n8n-nodes-base.googleSheets' && n.parameters.operation === 'append' && n.parameters.sheetName.value === 'attachment_outbox'));
// No external collector NODE in WF24 — matched by real API HOST (not substrings, which now collide with the
// fail-closed config flag names enable_firecrawl/enable_apify embedded by agent_config in the config node).
A.ok('WF24 no Claude/external collector node', !WF24.nodes.some(n => /api\.anthropic\.com|aiprimetech\.io|firecrawl\.dev|\bapify\.com|api\.vk\.com/.test(JSON.stringify(n.parameters || {}))));

A.section('scope_preview wired into WF19 approval message; progress wired into WF20');
A.ok('WF19 Build Approval Message embeds scope_preview', !!extract(nodeCode(WF19, 'Build Approval Message'), 'scope_preview'));
A.ok('WF20 Build Progress Update embeds progress_tracker', !!extract(nodeCode(WF20, 'Build Progress Update'), 'progress_tracker'));
A.ok('WF20 progress is a parallel branch off the gate', !!(WF20.connections['Gate Allowed?'] && JSON.stringify(WF20.connections['Gate Allowed?']).indexOf('Build Progress Update') >= 0));
A.ok('WF20 sends progress separately from final outbox', WF20.nodes.some(n => n.name === 'Send Progress') && WF20.nodes.some(n => n.name === 'Send Telegram Report'));

A.section('WF24 runtime — scoped export produces CSV + real XLSX + chart; dedup; isolation');
function runExport(scopeIn, outbox, bundles) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [{ source_allowlist: ['website'], source_budget_usd: 0.2, llm_budget_usd: 0.5, max_external_calls: 40 }]);
  H.inject(run, 'Read report_bundles', (bundles || []).map(b => ({ bundle: JSON.stringify(b) })));
  H.inject(run, 'Read attachment_outbox', outbox || []);
  H.runCodeNode(run, WF24, 'Select & Scope Report', [{ json: scopeIn }]);
  H.runCodeNode(run, WF24, 'Build Scope Preview', []);
  H.runCodeNode(run, WF24, 'Apply Action', []);
  return { run, exp: H.runCodeNode(run, WF24, 'Build Exports & Outbox', [])[0] };
}
const cur = F.currentReport();
const e1 = runExport({ owner_user_id: cur.owner_user_id, agent_request_id: cur.agent_request_id, report_id: cur.report_id, action: 'export' }, [], [F.unrelatedReport(), cur]);
A.eq('CSV scoped to the 3 competitors/offers', e1.exp.json.csv_row_count, 3);
// XLSX-OMIT-EMPTY-001: WF24 exports with omit_empty, so the empty "Changes" sheet is dropped (7 populated sheets).
A.ok('real XLSX produced (>0 bytes)', e1.exp.json.xlsx_size > 0);
A.ok('populated sheets present, empty Changes omitted', ['Сводка', 'Конкуренты', 'Офферы и цены', 'Доказательства', 'Технические данные'].every(n => e1.exp.json.xlsx_sheets.indexOf(n) >= 0) && e1.exp.json.xlsx_sheets.indexOf('Изменения') < 0);
A.ok('binary document attachment present', !!(e1.exp.binary && e1.exp.binary.attachment && e1.exp.binary.attachment.data));
A.ok('binary chart attachment present', !!(e1.exp.binary && e1.exp.binary.chart));
A.eq('zero external calls', e1.exp.json.external_calls, 0);
A.eq('three attachment deliveries enqueued', e1.exp.json.attachment_deliveries.length, 3);
A.ok('delivery id is scoped (owner+req+report)', /^att_100200300_req_aaa_report_20260621/.test(e1.exp.json.attachment_deliveries[0].delivery_id));
// duplicate suppression: replay with the same delivery already 'sent'
const sentRows = e1.exp.json.attachment_deliveries.map(d => Object.assign({}, d, { send_status: 'sent' }));
const e2 = runExport({ owner_user_id: cur.owner_user_id, agent_request_id: cur.agent_request_id, report_id: cur.report_id, action: 'export' }, sentRows, [cur]);
A.ok('duplicate XLSX attachment suppressed', e2.exp.json.xlsx_should_send === false);
// owner isolation
let isolated = false;
try { runExport({ owner_user_id: '999999', agent_request_id: 'req_other', report_id: cur.report_id, action: 'export' }, [], [F.unrelatedReport(), cur]); }
catch (err) { isolated = /not found|out of scope/.test(err.message); }
A.ok('cross-owner request cannot read another owner report', isolated);

A.section('WF24 runtime — filter / compare / refresh / evidence actions (all $0)');
function runAction(action, filterText, bundles) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [{ source_allowlist: ['website'], source_budget_usd: 0.2, llm_budget_usd: 0.5 }]);
  H.inject(run, 'Read report_bundles', (bundles || []).map(b => ({ bundle: JSON.stringify(b) })));
  H.inject(run, 'Read attachment_outbox', []);
  H.runCodeNode(run, WF24, 'Select & Scope Report', [{ json: { owner_user_id: cur.owner_user_id, agent_request_id: cur.agent_request_id, report_id: cur.report_id, action: action, filter_text: filterText || '' } }]);
  H.runCodeNode(run, WF24, 'Build Scope Preview', []);
  return H.runCodeNode(run, WF24, 'Apply Action', [])[0].json.result;
}
const fAct = runAction('filter', 'покажи только ставки ниже 5%', [cur]);
A.ok('filter action returns a filtered bundle', !!fAct.filtered && fAct.filter.ok === true);
A.eq('filter is $0', fAct.external_calls, 0);
const cAct = runAction('compare', '', [cur, F.priorReport()]);
A.ok('compare picks the prior-week baseline', cAct.baseline && cAct.baseline.report_id === 'report_20260614_101500');
A.ok('compare produces a diff', !!cAct.comparison);
const rAct = runAction('refresh', '', [cur]);
A.ok('refresh produces a plan with 0 calls so far', rAct.refresh_plan && rAct.refresh_plan.external_calls_so_far === 0);
const evAct = runAction('evidence', 'ставка', [cur]);
A.ok('evidence query returns items + 0 calls', evAct.evidence && evAct.evidence.external_calls === 0);

A.section('WF25 runtime — weekly digest from stored data only, dedupe, empty suppression');
function runDigest(now, digestRows, opts) {
  opts = opts || {};
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [{ telegram_allowed_user_ids: [F.OWNER] }]);
  H.inject(run, 'Read report_bundles', [F.currentReport(), F.priorReport(), F.unrelatedReport()].map(b => ({ bundle: JSON.stringify(b) })));
  H.inject(run, 'Read source_change_events', opts.changes !== undefined ? opts.changes : [{ change_id: 'c1', owner_user_id: F.OWNER, platform: 'website', ref: 'cashmotor.ru', summary: 'Cashmotor снизил ставку', ts: '2026-06-19T08:00:00+03:00' }]);
  H.inject(run, 'Read tracked_sources', opts.sources !== undefined ? opts.sources : [{ source_id: 's2', owner_user_id: F.OWNER, platform: 'website', ref: 'carcapital.ru', status: 'degraded' }]);
  H.inject(run, 'Read execution_summaries', []);
  H.inject(run, 'Read weekly_digests', digestRows || []);
  return H.runCodeNode(run, WF25, 'Build Weekly Digest', [{ json: { now: now, force: !!opts.force } }])[0].json;
}
const d1 = runDigest('2026-06-21T12:00:00+03:00', []);
A.ok('digest emitted', d1.emit === true);
A.eq('digest scoped to ISO week', d1.digest.iso_week, '2026-W25');
A.eq('digest does zero external calls', d1.digest.external_calls, 0);
A.ok('deterministic digest id', /^digest_100200300_2026-W25$/.test(d1.digest.digest_id));
// same week already emitted -> dedupe
const d2 = runDigest('2026-06-21T12:00:00+03:00', [{ digest_id: d1.digest.digest_id, owner_user_id: F.OWNER, iso_week: '2026-W25', idempotency_key: d1.digest.idempotency_key }]);
A.ok('same ISO week not re-emitted', d2.emit === false && d2.dedupe_reason === 'already_emitted_this_week');
// empty week (no in-week changes, only active sources) suppressed by default; emitted only when allowed
const d3 = runDigest('2026-08-30T12:00:00+03:00', [], { changes: [], sources: [{ source_id: 's1', owner_user_id: F.OWNER, platform: 'website', ref: 'cashmotor.ru', status: 'active' }] });
A.ok('empty week suppressed by default', d3.emit === false && d3.suppressed === true && d3.empty === true);
const d4 = runDigest('2026-08-30T12:00:00+03:00', [], { changes: [], sources: [], force: true });
A.ok('empty week emitted when forced/allowed', d4.suppressed === false && d4.empty === true);

A.section('NL routing — reporting phrases route to the capabilities backed by WF24/WF25');
const ctx = { last_report: { competitors: [{ company_name: 'Cashmotor' }] }, last_report_id: 'report_20260621_101500' };
function intentOf(text) { const r = router.deterministicIntent({ kind: 'request', text: text, callback_data: '', update_id: '1', message_id: '1', chat_id: '5', user_id: '1' }, ctx); return r && r.intent; }
const ROUTES = [
  ['Пришли таблицу', 'export_report'], ['Сделай Excel', 'export_report'], ['Экспортируй CSV', 'export_report'],
  ['Покажи график', 'show_chart'], ['Покажи доказательства', 'show_evidence'],
  ['Сравни с прошлым отчётом', 'compare_periods'], ['Обнови только устаревшие источники', 'refresh_sources'],
  ['Покажи только ставки ниже 5%', 'filter_report'],
  ['Пришли недельную сводку', 'weekly_digest'], ['Что изменилось за эту неделю?', 'weekly_digest'],
  ['Включи еженедельный отчёт', 'manage_digest'], ['Выключи еженедельный отчёт', 'manage_digest']
];
for (const [t, want] of ROUTES) A.eq('route «' + t + '»', intentOf(t), want);
A.ok('refresh_sources requires approval (external work)', router.APPROVAL_INTENTS.indexOf('refresh_sources') >= 0);
A.ok('export/chart/evidence/filter need a prior report', router.HISTORY_REQUIRED_INTENTS.indexOf('export_report') >= 0);
// capability registry stays in sync (each routed intent that is a capability exists)
for (const cap of ['export_report', 'show_chart', 'show_evidence', 'filter_report', 'refresh_sources', 'weekly_digest', 'manage_digest']) {
  A.ok('charter knows ' + cap, !!charter.capabilityById(cap) && router.INTENT_IDS.indexOf(cap) >= 0);
}

A.report('reporting-workflows');
