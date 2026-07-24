'use strict';
// test_f2_delivery.js — F-2 DELIVERY-LIFECYCLE-001: the ONE Telegram progress message is the single source of
// delivery truth. Proves, OFFLINE ($0, no network), that:
//   • the delivery-state contract is internally consistent (states / text / rank tables agree);
//   • the text-report success edit fires the INSTANT Telegram confirms a real report_message_id, decoupled
//     from XLSX generation/send;
//   • a terminal ✅ "…отправлены" is emitted ONLY when a real document_message_id proves it — never from
//     branch completion / xlsx_skipped / absence of an exception;
//   • report-only success, report-send failure, XLSX retry, and XLSX-exhausted each render their honest string;
//   • analysis_failed / no_data / partial terminals are preserved;
//   • duplicate callbacks / stale branches cannot move the terminal state backwards or re-fire a terminal edit;
//   • cancellation is not regressed;
//   • no SEPARATE terminal message is sent (every terminal is an EDIT of the same message);
//   • the progress_tracker embedded into the generated WF20 delivery nodes is byte-identical to the library.
// It exercises BOTH the pure progress_tracker functions AND the actual WF20 Code nodes via the node harness, so
// the proof covers the shipped wiring, not just the helpers.
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const H = require('./wf_harness.js');
const PT = require('../n8n/lib/progress_tracker.js');

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
function nodeUrl(wf, name) { const n = wf.nodes.find(x => x.name === name); return (n && n.parameters && n.parameters.url) || ''; }

const WF20 = H.loadWorkflow('20_agent_orchestrator.json');

function edges(wf) {
  const out = [];
  for (const [from, conn] of Object.entries(wf.connections || {})) {
    (conn.main || []).forEach((arr, oi) => (arr || []).forEach(c => out.push({ from, to: c.node, out: oi })));
  }
  return out;
}
function hasEdge(wf, from, to, oi) { return edges(wf).some(e => e.from === from && e.to === to && (oi == null || e.out === oi)); }
function isLeaf(wf, name) { return !edges(wf).some(e => e.from === name); }

// ============================================================================================================
A.section('delivery-state contract is internally consistent (no state lives in one table but not the others)');
{
  // every declared state is classifiable (terminal-or-not) by the public API; every text key is a declared state
  A.ok('every DELIVERY_STATES entry is classifiable as terminal-or-not', PT.DELIVERY_STATES.every(s => typeof PT.isTerminalDelivery(s) === 'boolean'));
  A.ok('every terminal state is sticky (advanceDelivery refuses to move off it)', PT.DELIVERY_STATES.filter(s => PT.isTerminalDelivery(s)).every(s => PT.advanceDelivery(s, 'processing').duplicate === true && PT.advanceDelivery(s, 'processing').changed === false));
  A.ok('every DELIVERY_TEXT key is a declared state', Object.keys(PT.DELIVERY_TEXT).every(s => PT.DELIVERY_STATES.indexOf(s) >= 0));
  // 'processing' is the only state rendered by the stage-bar (advance()), not by a canonical delivery string
  A.ok('every non-processing state has a canonical user-visible string', PT.DELIVERY_STATES.filter(s => s !== 'processing').every(s => PT.deliveryText(s).length > 0));
  A.eq('processing carries no delivery string (rendered by the stage bar)', PT.deliveryText('processing'), '');
  // exact required wording (the F-2 acceptance strings)
  A.eq('report_sent string', PT.deliveryText('report_sent'), '✅ Отчёт готов. Excel-файл отправляется…');
  A.eq('delivered string', PT.deliveryText('delivered'), '✅ Готово. Отчёт и Excel-файл отправлены.');
  A.eq('delivered_report_only string', PT.deliveryText('delivered_report_only'), '✅ Готово. Отчёт отправлен.');
  A.eq('report_failed string', PT.deliveryText('report_failed'), '⚠️ Не удалось отправить отчёт. Попробуйте повторить запрос.');
  A.eq('document_retrying string', PT.deliveryText('document_retrying'), '⚠️ Отчёт отправлен, но Excel-файл доставить не удалось. Повторяю отправку…');
  A.eq('document_failed string', PT.deliveryText('document_failed'), '⚠️ Отчёт отправлен, но Excel-файл доставить не удалось. Попробуйте запросить файл повторно.');
  // the four states the earlier contract omitted are now present in every table
  ['delivered_report_only', 'analysis_failed', 'no_data', 'partial'].forEach(s => {
    A.ok('contract lists ' + s, PT.DELIVERY_STATES.indexOf(s) >= 0);
    A.ok(s + ' has canonical text', PT.deliveryText(s).length > 0);
    A.ok(s + ' is terminal', PT.isTerminalDelivery(s));
  });
}

A.section('deliveryReportEdit — success REQUIRES a real Telegram message id (never inferred from no-error)');
{
  const ok = PT.deliveryReportEdit({ report_message_id: '585' });
  A.eq('a real report id => report_sent', ok.delivery_state, 'report_sent');
  A.eq('report_sent is NOT terminal (the workbook tail still follows)', ok.is_terminal, false);
  A.eq('report_sent text is the canonical string', ok.text, PT.deliveryText('report_sent'));
  A.eq('the confirmed report id is carried forward', ok.report_message_id, '585');
  const noId = PT.deliveryReportEdit({ report_message_id: '' });
  A.eq('no report id => report_failed (truthful)', noId.delivery_state, 'report_failed');
  A.eq('report_failed is terminal', noId.is_terminal, true);
  A.eq('report_failed text is the canonical string', noId.text, PT.deliveryText('report_failed'));
  const missing = PT.deliveryReportEdit({});
  A.eq('a missing sendMessage result is report_failed, not report_sent', missing.delivery_state, 'report_failed');
}

A.section('deliveryTerminalEdit — the terminal is decided ONLY by verified facts');
{
  const T = PT.deliveryTerminalEdit;
  // happy path: both message ids present, workbook expected
  const del = T({ report_message_id: '585', document_message_id: '586', xlsx_expected: true, attempts: 1, max_attempts: 2, analysis: { final_state: 'completed', has_analysis: true, records: 10 } });
  A.eq('report id + document id + workbook => delivered', del.delivery_state, 'delivered');
  A.eq('delivered text', del.text, PT.deliveryText('delivered'));
  A.eq('delivered is terminal', del.is_terminal, true);
  // report-only success: no workbook to send
  const ro = T({ report_message_id: '585', document_message_id: '', xlsx_expected: false, analysis: { final_state: 'completed', has_analysis: true, records: 4 } });
  A.eq('report ok + no workbook => delivered_report_only', ro.delivery_state, 'delivered_report_only');
  A.eq('delivered_report_only text', ro.text, PT.deliveryText('delivered_report_only'));
  // report never reached Telegram: claim NOTHING
  const rf = T({ report_message_id: '', document_message_id: '586', xlsx_expected: true, analysis: { final_state: 'completed', has_analysis: true, records: 10 } });
  A.eq('no report id => report_failed even if a document id exists', rf.delivery_state, 'report_failed');
  // THE CORE F-2 PROOF: workbook expected but NO document id — must NEVER be "delivered"
  const retrying = T({ report_message_id: '585', document_message_id: '', xlsx_expected: true, attempts: 1, max_attempts: 2, analysis: { final_state: 'completed', has_analysis: true, records: 10 } });
  A.eq('workbook expected + no document id (attempt remaining) => document_retrying, NOT delivered', retrying.delivery_state, 'document_retrying');
  A.eq('document_retrying is NOT terminal (a retry follows)', retrying.is_terminal, false);
  const exhausted = T({ report_message_id: '585', document_message_id: '', xlsx_expected: true, attempts: 2, max_attempts: 2, analysis: { final_state: 'completed', has_analysis: true, records: 10 } });
  A.eq('workbook expected + no document id (retries exhausted) => document_failed, NOT delivered', exhausted.delivery_state, 'document_failed');
  A.eq('document_failed is terminal', exhausted.is_terminal, true);
  A.ok('neither retry state ever claims the file was sent', retrying.text.indexOf('отправлен') >= 0 && retrying.text.indexOf('не удалось') >= 0 && exhausted.text.indexOf('не удалось') >= 0);
  A.ok('no XLSX state is ever the delivered "…отправлены" string', retrying.text !== PT.deliveryText('delivered') && exhausted.text !== PT.deliveryText('delivered'));
  // analysis-outcome terminals are preserved (report carries the honest wording; no workbook)
  A.eq('failed analysis (no analysis produced) => analysis_failed', T({ report_message_id: '585', analysis: { final_state: 'failed', has_analysis: false, records: 0 } }).delivery_state, 'analysis_failed');
  A.eq('no records + no analysis => no_data', T({ report_message_id: '585', analysis: { final_state: 'no_data', has_analysis: false, records: 0 } }).delivery_state, 'no_data');
  A.eq('a completed run with zero records => no_data', T({ report_message_id: '585', analysis: { final_state: 'completed', has_analysis: false, records: 0 } }).delivery_state, 'no_data');
  A.eq('partial analysis => partial', T({ report_message_id: '585', xlsx_expected: true, document_message_id: '586', analysis: { final_state: 'partial', has_analysis: true, records: 3 } }).delivery_state, 'partial');
  A.ok('analysis terminals win over the workbook path (partial not overwritten by delivered)', T({ report_message_id: '585', xlsx_expected: true, document_message_id: '586', analysis: { final_state: 'partial', has_analysis: true, records: 3 } }).text === PT.deliveryText('partial'));
}

A.section('advanceDelivery — monotonic + sticky terminal (duplicate callbacks / stale branches cannot regress)');
{
  A.eq('forward transition is applied', PT.advanceDelivery('processing', 'report_sent').state, 'report_sent');
  A.eq('forward transition reports changed', PT.advanceDelivery('report_sent', 'document_sending').changed, true);
  const back = PT.advanceDelivery('document_sending', 'report_sent');
  A.eq('a backwards transition is refused (state held)', back.state, 'document_sending');
  A.eq('a backwards transition is flagged duplicate', back.duplicate, true);
  A.eq('re-emitting the same state is a no-op', PT.advanceDelivery('report_sent', 'report_sent').changed, false);
  // sticky terminal: once delivered, a stale worker cannot move it or re-fire the edit
  const stuck = PT.advanceDelivery('delivered', 'processing');
  A.eq('a terminal state is sticky against a stale processing callback', stuck.state, 'delivered');
  A.eq('a terminal state reports no change', stuck.changed, false);
  A.eq('a duplicate terminal edit is suppressed', PT.advanceDelivery('delivered', 'delivered').changed, false);
  A.eq('one terminal cannot be overwritten by another (no double terminal edit)', PT.advanceDelivery('document_failed', 'delivered').state, 'document_failed');
}

A.section('cancellation is NOT regressed by the delivery lifecycle');
{
  let st = PT.setMessageId(PT.advance(PT.initProgress({ agent_request_id: 'r', chat_id: 'c' }), 3, { now: 't0' }).state, '77');
  const cancelled = PT.cancel(st, { now: 't1' });
  A.ok('cancel still rewrites the same message with ⛔', cancelled.text.indexOf('⛔ Отменено') >= 0);
  A.eq('a cancelled run never advances again', PT.advance(cancelled.state, 6, {}).action, 'skip');
  A.eq('a failed run never advances again', PT.advance(PT.fail(st, 4, 'x', {}).state, 6, {}).action, 'skip');
}

// ============================================================================================================
// WF20 WIRING — run the ACTUAL generated Code nodes so the proof covers the shipped delivery tail, not helpers.
// Every Progress node reads $('Approval & Budget Gate').first().json unguarded, so it is always injected.
function runReportSent(sendReportRows, mid) {
  const run = H.makeRun();
  H.inject(run, 'Approval & Budget Gate', [{ request: { agent_request_id: 'r1', chat_id: 'c1' } }]);
  H.inject(run, 'When Called by Agent', [{ progress_message_id: mid === undefined ? 900 : mid }]);
  if (sendReportRows) H.inject(run, 'Send Telegram Report', sendReportRows);
  return H.runCodeNode(run, WF20, 'Progress: Report Sent', [{ json: {} }])[0].json;
}
function runRetrying(buildXlsx, caption) {
  const run = H.makeRun();
  H.inject(run, 'Approval & Budget Gate', [{ request: { agent_request_id: 'r1', chat_id: 'c1' } }]);
  H.inject(run, 'When Called by Agent', [{ progress_message_id: 900 }]);
  if (buildXlsx) H.inject(run, 'Build Report XLSX', [{ caption: caption || 'Таблица Excel по анализу конкурентов', xlsx_skipped: false }]);
  return H.runCodeNode(run, WF20, 'Progress: Retrying', [{ json: {} }])[0].json;
}
function runDone(cfg) {
  cfg = cfg || {};
  const run = H.makeRun();
  H.inject(run, 'Approval & Budget Gate', [{ request: { agent_request_id: 'r1', chat_id: 'c1' } }]);
  H.inject(run, 'When Called by Agent', [{ progress_message_id: cfg.mid === undefined ? 900 : cfg.mid }]);
  H.inject(run, 'Progress: Report Sent', [{ report_message_id: cfg.reportMid || '', report_ok: !!cfg.reportMid }]);
  if (cfg.xlsxBuilt) H.inject(run, 'Build Report XLSX', [{ xlsx_skipped: false }]);
  if (cfg.sendXlsx) H.inject(run, 'Send Report XLSX', cfg.sendXlsx);
  if (cfg.sendRetry) H.inject(run, 'Send Report XLSX Retry', cfg.sendRetry);
  H.inject(run, 'Build Execution Summary', [{ summary: cfg.summary || { final_state: 'completed', records_reported: 10, llm_analyses: 2, llm_analyses_reused: 0 } }]);
  return H.runCodeNode(run, WF20, 'Progress: Done', [{ json: {} }])[0].json;
}

A.section('WF20 Progress: Report Sent — report success is confirmed by a real message_id, decoupled from XLSX');
{
  // the node MUST NOT consult any workbook node when deciding report success (proves the decoupling in code)
  const src = nodeCode(WF20, 'Progress: Report Sent');
  A.ok('the report-sent edit never reads a workbook/XLSX node', !/Report XLSX|Build Report XLSX|Send Report XLSX/.test(src));
  // multi-chunk send: the first chunk that carries a real message_id proves delivery
  const ok = runReportSent([{ result: { message_id: 585 } }, { result: { message_id: 586 } }]);
  A.eq('a real sendMessage result => report_ok', ok.report_ok, true);
  A.eq('delivery_state is report_sent', ok.delivery_state, 'report_sent');
  A.eq('the confirmed report_message_id is the first chunk id', ok.report_message_id, '585');
  A.eq('the edit body targets the ONE progress message', JSON.parse(ok.telegram_edit_body).message_id, 900);
  A.eq('the edit shows the report-ready string immediately', JSON.parse(ok.telegram_edit_body).text, PT.deliveryText('report_sent'));
  // fail-open Send Telegram Report produced an item but NO message_id -> report_failed (never inferred success)
  const failed = runReportSent([{ ok: false, description: 'blocked' }]);
  A.eq('an item without a message_id is report_failed', failed.report_ok, false);
  A.eq('delivery_state is report_failed', failed.delivery_state, 'report_failed');
  A.eq('the edit shows the honest report-failure string', JSON.parse(failed.telegram_edit_body).text, PT.deliveryText('report_failed'));
  // no progress message id captured -> edit is skipped silently (progress is UX, never a run-killer)
  const noMid = runReportSent([{ result: { message_id: 585 } }], '');
  A.eq('a missing progress message id skips the edit', noMid.progress_skipped, true);
  A.eq('but report success is still computed for the gate', noMid.report_ok, true);
}

A.section('WF20 Report Delivered? — the workbook tail is gated on a CONFIRMED report send');
{
  const gate = WF20.nodes.find(n => n.name === 'Report Delivered?');
  A.ok('gate reads report_ok === true', JSON.stringify(gate.parameters).indexOf("report_ok === true") >= 0);
  A.ok('report confirmed -> build the workbook', hasEdge(WF20, 'Report Delivered?', 'Build Report XLSX', 0));
  A.ok('report NOT confirmed -> straight to the honest terminal (no orphan Excel)', hasEdge(WF20, 'Report Delivered?', 'Progress: Done', 1));
}

A.section('WF20 Progress: Retrying — renders «Повторяю отправку…» and re-attaches the workbook');
{
  const r = runRetrying(true, 'Таблица по анализу');
  A.eq('delivery_state is document_retrying', r.delivery_state, 'document_retrying');
  A.eq('the retry edit shows the canonical retrying string', JSON.parse(r.telegram_edit_body).text, PT.deliveryText('document_retrying'));
  A.eq('the workbook caption is carried into the retry send', r.caption, 'Таблица по анализу');
  A.ok('XLSX Sent? routes a missing document id to the retry', hasEdge(WF20, 'XLSX Sent?', 'Progress: Retrying', 1));
  A.ok('the retry edits progress AND re-sends the document', hasEdge(WF20, 'Progress: Retrying', 'Edit Progress (Retrying)') && hasEdge(WF20, 'Progress: Retrying', 'Send Report XLSX Retry'));
  A.ok('the retry send is a sendDocument multipart upload', /sendDocument/.test(nodeUrl(WF20, 'Send Report XLSX Retry')) && WF20.nodes.find(n => n.name === 'Send Report XLSX Retry').parameters.contentType === 'multipart-form-data');
}

A.section('WF20 Progress: Done — the terminal ✅ is emitted ONLY on a proven document_message_id');
{
  // happy path: report id + XLSX built + real sendDocument message_id => delivered
  const del = runDone({ reportMid: '585', xlsxBuilt: true, sendXlsx: [{ result: { message_id: 586 } }] });
  A.eq('report id + workbook + document id => delivered', del.delivery_state, 'delivered');
  A.eq('the terminal edit shows the both-sent string', JSON.parse(del.telegram_edit_body).text, PT.deliveryText('delivered'));
  A.eq('the terminal edit targets the SAME progress message', JSON.parse(del.telegram_edit_body).message_id, 900);
  // delivered via the RETRY: first send failed (no id), retry carried the real document id
  const delRetry = runDone({ reportMid: '585', xlsxBuilt: true, sendXlsx: [{ ok: false }], sendRetry: [{ result: { message_id: 587 } }] });
  A.eq('a document id from the RETRY still yields delivered', delRetry.delivery_state, 'delivered');
  // THE F-2 REGRESSION: a fail-open Send Report XLSX item (branch completed, NO message id) must NOT be delivered
  const noDoc1 = runDone({ reportMid: '585', xlsxBuilt: true, sendXlsx: [{ ok: false, description: 'file too big' }] });
  A.ok('a completed-but-unconfirmed workbook branch is NEVER delivered', noDoc1.delivery_state !== 'delivered');
  A.eq('one failed send (retry pending) => document_retrying', noDoc1.delivery_state, 'document_retrying');
  const noDoc2 = runDone({ reportMid: '585', xlsxBuilt: true, sendXlsx: [{ ok: false }], sendRetry: [{ ok: false }] });
  A.eq('both sends failed (retries exhausted) => document_failed, NOT delivered', noDoc2.delivery_state, 'document_failed');
  A.ok('the exhausted terminal never claims the file was sent', JSON.parse(noDoc2.telegram_edit_body).text.indexOf('не удалось') >= 0 && JSON.parse(noDoc2.telegram_edit_body).text !== PT.deliveryText('delivered'));
  // report-only success: no workbook produced -> delivered_report_only (never "…и Excel-файл отправлены")
  const ro = runDone({ reportMid: '585', xlsxBuilt: false });
  A.eq('report id + no workbook => delivered_report_only', ro.delivery_state, 'delivered_report_only');
  A.eq('report-only terminal string', JSON.parse(ro.telegram_edit_body).text, PT.deliveryText('delivered_report_only'));
  // report never confirmed -> report_failed even though Progress: Done is the terminal node
  const rf = runDone({ reportMid: '', xlsxBuilt: true, sendXlsx: [{ result: { message_id: 586 } }] });
  A.eq('no confirmed report => report_failed at the terminal', rf.delivery_state, 'report_failed');
  // analysis-outcome terminals preserved
  A.eq('failed analysis => analysis_failed', runDone({ reportMid: '585', summary: { final_state: 'failed', records_reported: 0, llm_analyses: 0, llm_analyses_reused: 0 } }).delivery_state, 'analysis_failed');
  A.eq('no records => no_data', runDone({ reportMid: '585', summary: { final_state: 'no_data', records_reported: 0, llm_analyses: 0, llm_analyses_reused: 0 } }).delivery_state, 'no_data');
  A.eq('partial run => partial', runDone({ reportMid: '585', xlsxBuilt: true, sendXlsx: [{ result: { message_id: 586 } }], summary: { final_state: 'partial', records_reported: 3, llm_analyses: 1, llm_analyses_reused: 0 } }).delivery_state, 'partial');
  // a stale duplicate (no ack id captured) skips the edit rather than re-firing a terminal
  const dup = runDone({ reportMid: '585', xlsxBuilt: true, sendXlsx: [{ result: { message_id: 586 } }], mid: '' });
  A.eq('a run without the progress message id skips the terminal edit', dup.progress_skipped, true);
}

A.section('WF20 delivery tail is EDIT-only — no separate terminal "Готово" message is ever sent');
{
  // the report-success edit fires off the confirmed text send; the terminal edit follows the workbook tail
  A.ok('report-success edit hangs off the confirmed Send Telegram Report', hasEdge(WF20, 'Send Telegram Report', 'Progress: Report Sent') && hasEdge(WF20, 'Progress: Report Sent', 'Edit Progress (Report Sent)'));
  A.ok('the terminal is NEVER wired directly to the text send', !hasEdge(WF20, 'Send Telegram Report', 'Progress: Done'));
  A.ok('the terminal edit follows the workbook tail (sent-gate / no-workbook skip / retry)',
    hasEdge(WF20, 'XLSX Sent?', 'Progress: Done', 0) && hasEdge(WF20, 'XLSX Ready?', 'Progress: Done', 1) && hasEdge(WF20, 'Send Report XLSX Retry', 'Progress: Done'));
  // every delivery status change is an editMessageText, and the terminal editor is a LEAF (nothing sends after it)
  for (const nm of ['Edit Progress (Report Sent)', 'Edit Progress (Retrying)', 'Edit Progress (Done)']) {
    A.ok(nm + ' is an editMessageText edit', /editMessageText/.test(nodeUrl(WF20, nm)));
    A.eq(nm + ' degrades on Telegram errors (progress is UX)', WF20.nodes.find(n => n.name === nm).onError, 'continueRegularOutput');
  }
  A.ok('Progress: Done only feeds its edit (single terminal edit)', hasEdge(WF20, 'Progress: Done', 'Edit Progress (Done)'));
  A.ok('the terminal edit is a leaf — no new message is sent afterwards', isLeaf(WF20, 'Edit Progress (Done)'));
  // the old branch-completion terminal edge is gone: the summary append no longer drives the bundle/workbook
  A.ok('Append execution_summaries no longer drives the delivery tail', !hasEdge(WF20, 'Append execution_summaries', 'Shape Report Bundle'));
}

A.section('WF20 delivery nodes embed progress_tracker with NO drift from the canonical library');
{
  const core = libCore('progress_tracker');
  for (const nm of ['Progress: Report Sent', 'Progress: Retrying', 'Progress: Done']) {
    A.eq(nm + ' embeds the canonical progress_tracker byte-for-byte', extract(nodeCode(WF20, nm), 'progress_tracker'), core);
  }
}

A.report('f2-delivery');
