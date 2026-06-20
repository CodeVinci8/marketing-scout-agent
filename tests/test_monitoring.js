// test_monitoring.js — Part 2 (proactive delivery in the REAL WF20 path) + Part 3 (scheduled monitoring
// contract + WF23 nodes). Drift + offline harness execution. $0, no network.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');
const H = require('./wf_harness');
const mon = require('../n8n/lib/source_monitor');
const trk = require('../n8n/lib/tracked_sources');
const resp = require('../n8n/lib/conversation_response');
const charter = require('../n8n/lib/agent_charter');

function libCore(name) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  return s.trim();
}
function extract(code, name) {
  const m = code.match(new RegExp('// embedded n8n/lib/' + name + '\\.js[^\\n]*\\n([\\s\\S]*?)\\n// --- end embedded ' + name + ' ---'));
  return m ? m[1] : null;
}

A.section('Drift — monitoring + proactive delivery Code nodes embed n8n/lib/* byte-identically');
const EMBEDS = [
  ['23_scheduled_source_monitor.json', 'Select Due Sources', ['tracked_sources', 'source_monitor']],
  ['23_scheduled_source_monitor.json', 'Check & Detect Change', ['source_monitor']],
  ['23_scheduled_source_monitor.json', 'Build Change Notification', ['source_monitor', 'conversation_response', 'agent_charter']],
  ['20_agent_orchestrator.json', 'Build Delivery Outbox', ['telegram_io', 'conversation_response', 'agent_charter']]
];
const WFS = {};
for (const [f] of EMBEDS) if (!WFS[f]) WFS[f] = H.loadWorkflow(f);
for (const [f, node, libs] of EMBEDS) {
  const code = WFS[f].nodes.find(n => n.name === node).parameters.jsCode;
  for (const lib of libs) A.eq(f + ' :: ' + node + ' embeds ' + lib, extract(code, lib), libCore(lib));
}

// ---- Part 3 — source_monitor contract ---------------------------------------------------------------------
const CFG = { source_allowlist: ['website', 'telegram_channel', 'vk_community'], monitor_interval_hours: 24, max_external_calls: 40 };
const NOW = '2026-06-21T10:00:00Z';

A.section('source_monitor — collector truthfulness (Telegram/VK setup_required by default)');
A.eq('website collector configured', mon.collectorState('website', CFG).state, 'configured');
A.eq('telegram setup_required without flag', mon.collectorState('telegram_channel', CFG).state, 'setup_required');
A.ok('telegram reason explains gating', /approval-gated|fixture/.test(mon.collectorState('telegram_channel', CFG).reason));
A.eq('telegram configured when enabled', mon.collectorState('telegram_channel', Object.assign({ enable_telegram_collector: true }, CFG)).state, 'configured');
A.eq('vk setup_required (disabled placeholder)', mon.collectorState('vk_community', CFG).state, 'setup_required');
A.eq('vk configured when enabled', mon.collectorState('vk_community', Object.assign({ enable_vk_collector: true }, CFG)).state, 'configured');

A.section('source_monitor — idempotency window + due selection');
A.ok('scheduled vs manual windows differ', mon.checkWindow(NOW, 24, 'scheduled') !== mon.checkWindow(NOW, 24, 'manual'));
A.eq('same scheduled window is stable', mon.checkWindow(NOW, 24, 'scheduled'), mon.checkWindow(NOW, 24, 'scheduled'));
A.eq('idempotency key deterministic', mon.checkIdempotencyKey('src_1', 'sched_1'), mon.checkIdempotencyKey('src_1', 'sched_1'));
const SRC = (over) => Object.assign({ source_id: 'src_111_web', owner_user_id: '111', platform: 'website', ref: 'https://cashmotor.ru/', label: 'cashmotor.ru', status: 'active', next_check_at: '', last_content_hash: '', check_interval_hours: 24 }, over || {});
const due = mon.dueSources([
  SRC(), SRC({ source_id: 's_paused', status: 'paused' }), SRC({ source_id: 's_removed', status: 'removed' }),
  SRC({ source_id: 's_setup', platform: 'telegram_channel' }), SRC({ source_id: 's_notdue', next_check_at: '2999-01-01T00:00:00Z' })
], NOW, CFG, 'scheduled');
A.eq('only the due website source is checkable', due.due.length, 1);
A.ok('paused/removed/setup_required/not-due are skipped', due.skipped.length === 4);
A.ok('telegram without collector reported setup_required', due.skipped.some(s => s.reason === 'setup_required'));
A.eq('manual mode ignores not-due', mon.dueSources([SRC({ next_check_at: '2999-01-01T00:00:00Z' })], NOW, CFG, 'manual').due.length, 1);

A.section('source_monitor — change detection lifecycle');
const base = mon.applyCheckResult(SRC(), { ok: true, fields: { price: '1000', rate: '0.1' } }, NOW, CFG);
A.eq('first check is a baseline (no change)', base.changed, false);
A.eq('baseline sets status', base.source.last_status, 'baseline');
A.ok('baseline sets next_check_at', !!base.source.next_check_at);
const same = mon.applyCheckResult(base.source, { ok: true, fields: { price: '1000', rate: '0.1' } }, NOW, CFG);
A.eq('identical content => unchanged', same.changed, false);
A.eq('unchanged status', same.source.last_status, 'unchanged');
const diff = mon.applyCheckResult(base.source, { ok: true, fields: { price: '900', rate: '0.1' } }, NOW, CFG);
A.eq('different content => changed', diff.changed, true);
A.ok('change stamps last_change_at', !!diff.source.last_change_at);
const errd = mon.applyCheckResult(base.source, { ok: false, error: 'timeout' }, NOW, CFG);
A.eq('error increments error_count', errd.source.error_count, 1);
A.eq('error status', errd.source.last_status, 'error');

A.section('source_monitor — change event + notify-once');
const ev = mon.makeChangeEvent(diff.source, diff.prev_hash, diff.new_hash, 'цена снизилась', NOW);
A.ok('change_id deterministic in source+hash', ev.change_id === diff.source.source_id + '::' + diff.new_hash);
A.eq('first notification allowed', mon.shouldNotifyChange([], ev).notify, true);
A.eq('duplicate change not notified twice', mon.shouldNotifyChange([ev], ev).notify, false);
A.ok('notification text is conversational', /Изменение у отслеживаемого источника/.test(mon.changeNotificationText(diff.source, ev)));
A.ok('notification offers only available capability actions', mon.changeNotificationKeyboard(charter.availableCapabilities(CFG)).inline_keyboard.every(r => /intent:/.test(r[0].callback_data)));

A.section('tracked_sources — monitoring fields + honest initial status');
const addWeb = trk.addSource([], 'https://cashmotor.ru/', { owner_user_id: '111', chat_id: '555', cfg: CFG, ts: NOW });
A.eq('website source starts active', addWeb.source.status, 'active');
A.ok('website source carries next_check_at', !!addWeb.source.next_check_at);
A.eq('website source has error_count 0', addWeb.source.error_count, 0);
A.eq('website source keeps chat_id for notifications', addWeb.source.chat_id, '555');
const addTg = trk.addSource([], 'https://t.me/chan', { owner_user_id: '111', cfg: CFG, ts: NOW });
A.eq('telegram source added but setup_required (no collector)', addTg.source.status, 'setup_required');
const addTgOn = trk.addSource([], 'https://t.me/chan', { owner_user_id: '111', cfg: Object.assign({ enable_telegram_collector: true }, CFG), ts: NOW });
A.eq('telegram source active when collector enabled', addTgOn.source.status, 'active');

// ---- WF23 harness -----------------------------------------------------------------------------------------
const WF23 = WFS['23_scheduled_source_monitor.json'];
function monitorRun(input, opts) {
  opts = opts || {};
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [Object.assign({ mode: opts.mode || 'scheduled', monitor_interval_hours: 24, max_external_calls: 40, source_allowlist: ['website', 'telegram_channel', 'vk_community'] }, opts.cfg || {})]);
  H.inject(run, 'Read tracked_sources', opts.sources || []);
  H.inject(run, 'Read source_change_events', opts.changes || []);
  const detect = H.runCodeNode(run, WF23, 'Check & Detect Change', [{ json: input }])[0].json;
  return { run, detect };
}

A.section('WF23 — Select Due Sources picks active website sources');
const selRun = H.makeRun();
H.inject(selRun, 'Resolve Agent Config', [{ mode: 'scheduled', monitor_interval_hours: 24, max_external_calls: 40, source_allowlist: ['website'] }]);
H.inject(selRun, 'Read tracked_sources', [SRC(), SRC({ source_id: 's_paused', status: 'paused' })]);
const sel = H.runCodeNode(selRun, WF23, 'Select Due Sources', []);
A.eq('one due source selected', sel.length, 1);
A.eq('due item carries an idempotency key', /::sched_/.test(sel[0].json.idempotency_key), true);

A.section('WF23 — Check & Detect Change: baseline silent, real change notifies, duplicate suppressed');
const baseRun = monitorRun({ source: SRC(), cfg: CFG, now: NOW, fetched: { fields: { price: '1000' } } });
A.eq('baseline => no notification', baseRun.detect.needs_notification, false);
const hash1 = mon.contentHash(mon.normalizeContent({ price: '900' }));
const chg = monitorRun({ source: SRC({ last_content_hash: 'cOLD' }), cfg: CFG, now: NOW, fetched: { fields: { price: '900' }, summary: 'цена снизилась' } });
A.eq('meaningful change => needs notification', chg.detect.needs_notification, true);
A.ok('change carries a change event', !!chg.detect.change_event);
const changeId = chg.detect.change_event.change_id;
const dupChg = monitorRun({ source: SRC({ last_content_hash: 'cOLD' }), cfg: CFG, now: NOW, fetched: { fields: { price: '900' } } }, { changes: [{ change_id: changeId }] });
A.eq('already-recorded change => NOT notified again', dupChg.detect.needs_notification, false);
// build the notification from the change run
const notif = H.runCodeNode(chg.run, WF23, 'Build Change Notification', [])[0].json;
const notifBody = JSON.parse(notif.telegram_send_body);
A.ok('notification has chat + text', !!notifBody.chat_id && /Изменение/.test(notifBody.text));
A.ok('notification persists the change event before send (change_id present on append item)', notif.change_id === changeId);

A.section('WF23 — no due sources => no notification');
const none = monitorRun({ source: null });
A.eq('no due => needs_notification false', none.detect.needs_notification, false);

// ---- Part 2 / Part 8 — proactive assistance in the REAL WF20 delivery path --------------------------------
const WF20 = WFS['20_agent_orchestrator.json'];
const CFG_FULL = { source_allowlist: ['website', 'telegram_channel', 'vk_community'], max_items_per_source: 25, max_external_calls: 40, source_budget_usd: 0.2, llm_budget_usd: 0.5, require_approval: true, config_complete: true };
function deliver(adapterRaw, report) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [CFG_FULL]);
  H.runCodeNode(run, WF20, 'Approval & Budget Gate', [{ json: { request: { agent_request_id: 'req_1', state: 'approved', approved: true, chat_id: '555' }, plan: { sources: ['website'], source: 'website', est_items: 10, est_external_calls: 4, est_source_cost_usd: 0.05, est_llm_cost_usd: 0.1 } } }]);
  H.runCodeNode(run, WF20, 'Normalize Adapter Result', [{ json: { live_source_run: adapterRaw } }]);
  H.runCodeNode(run, WF20, 'Build Execution Summary', [{ json: { report: report } }]);
  return H.runCodeNode(run, WF20, 'Build Delivery Outbox', [])[0].json;
}
A.section('WF20 delivery — proactive continuation attached to the actual outbox/send path');
const okAdapter = { agent_request_id: 'req_1', source_run_id: 'firecrawl_X', items_received: 4, items_written: 4, items_relevant: 3, external_calls: 4, cost_status: 'unknown', platform: 'website', data_mode: 'live' };
const okReport = { report_id: 'rep1', report_markdown: 'ФАКТ: 2 конкурента, ставка от 0,1%/день.', rows_after_filters: 2, records_unique: 2, records_eligible: 2, records_analyzed: 2, llm_primary_calls: 0, llm_repair_calls: 0 };
const okOut = deliver(okAdapter, okReport);
const okBody = JSON.parse(okOut.telegram_send_body);
A.ok('delivery preserves the immutable report facts verbatim', /ФАКТ: 2 конкурента/.test(okBody.text));
A.ok('delivery includes a proactive continuation', /Просто напишите, что сделать дальше/.test(okBody.text));
A.ok('proactive_text exposed on the node output', /Просто напишите/.test(okOut.proactive_text));
const finalBody = JSON.parse(okOut.telegram_send_bodies)[JSON.parse(okOut.telegram_send_bodies).length - 1];
A.ok('optional keyboard attached to the FINAL chunk only', !!(finalBody.reply_markup && finalBody.reply_markup.inline_keyboard));
A.ok('every proactive button maps to a real intent', finalBody.reply_markup.inline_keyboard.every(r => /^intent:/.test(r[0].callback_data)));
A.ok('outbox row built before send (delivery id present)', /^dlv_req_1_rep1_/.test(okOut.delivery.delivery_id));

A.section('WF20 delivery — partial/no-data offer recovery actions, not success actions');
const quarAdapter = Object.assign({}, okAdapter, { quality_status: 'quarantined', items_written: 1, items_relevant: 0 });
const partialOut = deliver(quarAdapter, { report_id: 'rep2', rows_after_filters: 0, records_unique: 0, records_eligible: 0, records_analyzed: 0 });
const partialBody = JSON.parse(partialOut.telegram_send_body);
A.ok('partial/no-data reply still offers next actions', /напишите, что сделать/i.test(partialBody.text) || /проверить изменения|расшир|источник/i.test(partialBody.text));
A.ok('partial/no-data does not claim a successful report', !/2 конкурента/.test(partialBody.text));

A.report('monitoring');
