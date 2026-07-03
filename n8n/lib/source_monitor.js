'use strict';
// source_monitor.js — Part 3: real scheduled tracked-source monitoring contract.
//
// Turns the tracked_sources registry into actual monitoring: pick the sources that are DUE, check each through
// the collector that genuinely exists for its platform, detect a MEANINGFUL change via a normalized content
// hash, update lifecycle fields, persist a change event, and notify exactly once. Telegram/VK are only checked
// when a real collector is configured; otherwise the source is honestly marked setup_required. Pure +
// deterministic, no I/O, no secrets; the WF23 Code nodes embed this.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

const MONITOR_INTERVAL_DEFAULT_H = 24;
// What collector actually exists per platform. website -> the real WF04 website pipeline. Telegram has a
// fixture-first/approval-gated t.me public-preview collector (WF11); VK has only fixture + disabled live
// placeholders (WF13). So tg/vk are "configured" ONLY when the operator explicitly enables them via a
// non-secret flag; otherwise the honest state is setup_required.
function collectorState(platform, cfg) {
  cfg = cfg || {}; platform = low(platform);
  if (platform === 'website') return { state: 'configured', workflow: 'WF04', reason: '' };
  if (platform === 'telegram_channel') {
    return cfg.enable_telegram_collector === true
      ? { state: 'configured', workflow: 'WF11', reason: '' }
      : { state: 'setup_required', workflow: 'WF11', reason: 'Telegram public-preview collector is approval-gated/fixture-first; enable MS_ENABLE_TELEGRAM_COLLECTOR per channel' };
  }
  if (platform === 'vk_community') {
    return cfg.enable_vk_collector === true
      ? { state: 'configured', workflow: 'WF13', reason: '' }
      : { state: 'setup_required', workflow: 'WF13', reason: 'VK live collector is a disabled placeholder; requires a configured VK collector + credentials' };
  }
  return { state: 'setup_required', workflow: '', reason: 'no collector for platform ' + platform };
}

// Idempotency window for a check. Scheduled checks bucket by interval (so two firings in the same window dedupe);
// a manual "check now" uses a finer window so it is NOT deduped against the scheduled run.
function checkWindow(now, intervalHours, mode) {
  const t = Date.parse(str(now)) || Date.now();
  if (low(mode) === 'manual') return 'manual_' + Math.floor(t / 1000);
  const ms = Math.max(1, num(intervalHours, MONITOR_INTERVAL_DEFAULT_H)) * 3600000;
  return 'sched_' + Math.floor(t / ms);
}
function checkIdempotencyKey(sourceId, window) { return str(sourceId) + '::' + str(window); }

function nextCheckAt(now, intervalHours) {
  const t = Date.parse(str(now)) || Date.now();
  return new Date(t + Math.max(1, num(intervalHours, MONITOR_INTERVAL_DEFAULT_H)) * 3600000).toISOString();
}
function isDue(source, now) {
  const nxt = str(source && source.next_check_at);
  if (!nxt) return true; // never checked => due
  const t = Date.parse(nxt); if (!isFinite(t)) return true;
  return (Date.parse(str(now)) || Date.now()) >= t;
}

// Partition active sources into due (checkable) vs skipped (paused/removed/setup_required/not-due). Telegram/VK
// without a configured collector are reported as setup_required, never silently skipped.
function dueSources(sources, now, cfg, mode) {
  sources = Array.isArray(sources) ? sources : []; cfg = cfg || {};
  const due = []; const skipped = [];
  for (const s of sources) {
    const st = low(s.status);
    if (st === 'paused' || st === 'removed') { skipped.push({ source: s, reason: st }); continue; }
    if (st === 'setup_required') { skipped.push({ source: s, reason: 'setup_required' }); continue; }
    const col = collectorState(s.platform, cfg);
    if (col.state !== 'configured') { skipped.push({ source: s, reason: 'setup_required', detail: col.reason }); continue; }
    if (low(mode) !== 'manual' && !isDue(s, now)) { skipped.push({ source: s, reason: 'not_due' }); continue; }
    due.push(Object.assign({}, s, { collector_workflow: col.workflow }));
  }
  return { due: due, skipped: skipped };
}

// Stable normalized content from FACTUAL fields only (so cosmetic noise doesn't trigger false changes).
function normalizeContent(fields) {
  fields = fields || {};
  const keys = Object.keys(fields).sort();
  return keys.map(k => low(k) + '=' + low(typeof fields[k] === 'string' ? fields[k] : JSON.stringify(fields[k]))).join('|');
}
function contentHash(s) {
  s = String(s == null ? '' : s); let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'c' + h.toString(16);
}

// Apply a check outcome to a source's monitoring lifecycle fields + decide if a MEANINGFUL change occurred.
// The first successful check establishes a baseline (no notification); a later differing hash is a real change.
function applyCheckResult(source, result, now, cfg) {
  source = Object.assign({}, source || {}); result = result || {}; cfg = cfg || {};
  const interval = num(source.check_interval_hours, num(cfg.monitor_interval_hours, MONITOR_INTERVAL_DEFAULT_H));
  source.last_checked_at = str(now);
  source.next_check_at = nextCheckAt(now, interval);
  let changed = false; const prevHash = str(source.last_content_hash);
  if (result.ok === false) {
    source.error_count = num(source.error_count, 0) + 1;
    source.last_error = str(result.error) || 'check_failed';
    source.last_status = 'error';
    return { source: source, changed: false, prev_hash: prevHash, new_hash: prevHash };
  }
  const newHash = str(result.hash) || contentHash(normalizeContent(result.fields));
  source.last_success_at = str(now);
  source.error_count = 0; source.last_error = '';
  if (!prevHash) { source.last_content_hash = newHash; source.last_status = 'baseline'; }
  else if (newHash !== prevHash) { source.last_content_hash = newHash; source.last_change_at = str(now); source.last_status = 'changed'; changed = true; }
  else { source.last_status = 'unchanged'; }
  return { source: source, changed: changed, prev_hash: prevHash, new_hash: newHash };
}

// A confirmed-change event. change_id is deterministic in (source, new hash) so the same change can be
// acknowledged/notified exactly once.
function makeChangeEvent(source, prevHash, newHash, summary, now) {
  return {
    change_id: str(source.source_id) + '::' + str(newHash),
    source_id: str(source.source_id), owner_user_id: str(source.owner_user_id),
    platform: str(source.platform), ref: str(source.ref),
    prev_hash: str(prevHash), new_hash: str(newHash),
    summary: str(summary), status: 'detected', acknowledged: false, ts: str(now)
  };
}
// Notify only when this exact change has not already been recorded. change_id is deterministic in
// (source_id, new content hash), so an already-persisted change is never notified twice.
function shouldNotifyChange(existingEvents, changeEvent) {
  const prior = (existingEvents || []).filter(e => str(e.change_id) === str(changeEvent.change_id));
  if (prior.length) return { notify: false, reason: 'already_notified' };
  return { notify: true, reason: '' };
}

// One concise conversational change notification + optional actions (intent:<id> == the equivalent free text).
// Actions are drawn from the available capability registry; a missing capability is simply not offered.
const MONITOR_ACTIONS = [
  ['report_followup', 'объяснить изменение'],
  ['compare_periods', 'сравнить версии'],
  ['generate_ideas', 'предложить ответ на изменение'],
  ['deep_competitor_analysis', 'глубокий анализ'],
  ['manage_sources', 'поставить источник на паузу']
];
// UX-RU-002: the platform enum (telegram_channel/vk_community/…) is internal — the label/ref already
// identifies the source for the user, so the raw platform value never enters the message.
function changeNotificationText(source, changeEvent) {
  return 'Изменение у отслеживаемого источника ' + (str(source.label) || str(source.ref)) + ': ' +
    (str(changeEvent.summary) || 'обновление контента') + '. Я могу ' +
    MONITOR_ACTIONS.map(a => a[1]).join(', ') + '. Просто напишите, что сделать.';
}
function changeNotificationKeyboard(availableCaps) {
  const byId = {}; (availableCaps || []).forEach(c => { if (c) byId[c.id] = c; });
  const rows = MONITOR_ACTIONS.filter(a => byId[a[0]] && byId[a[0]].available).map(a => [{ text: a[1], callback_data: 'intent:' + a[0] }]);
  return rows.length ? { inline_keyboard: rows } : null;
}

module.exports = {
  MONITOR_INTERVAL_DEFAULT_H, MONITOR_ACTIONS, collectorState, checkWindow, checkIdempotencyKey,
  nextCheckAt, isDue, dueSources, normalizeContent, contentHash, applyCheckResult, makeChangeEvent,
  shouldNotifyChange, changeNotificationText, changeNotificationKeyboard, str, low, num
};
