'use strict';
// progress_tracker.js — one concise, throttled, editable Telegram progress message (Section 10).
//
// Not one message per n8n node: a single message is created once and EDITED as the run crosses meaningful
// stages. Re-emitting the same stage is throttled (no flood); a retry never creates a second message (edit the
// existing one). Cancellation/failure immediately rewrite the message and name the stage. Progress updates are
// NOT final delivery — the final report stays separately idempotent. If Telegram edit fails, the fallback is
// to send a fresh message (and adopt its id). Pure + deterministic state machine, $0.

function str(v) { return v == null ? '' : String(v); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

const STAGES = [
  'План подтверждён', 'Ищу источники', 'Собираю страницы', 'Проверяю качество', 'Анализирую данные',
  'Сравниваю результаты', 'Данные собраны, формирую отчёт', 'Готовлю таблицу и графики', 'Отправляю результат', 'Готово'
];
const TOTAL = STAGES.length;
const DEFAULT_THROTTLE_MS = 3000;

function initProgress(ids) {
  ids = ids || {};
  return {
    request_id: str(ids.agent_request_id), chat_id: str(ids.chat_id),
    message_id: '', stage: 0, total: TOTAL, status: 'pending',
    last_update_ts: '', fallback_count: 0, final_delivered: false, delivery_id: '', throttle_ms: num(ids.throttle_ms, DEFAULT_THROTTLE_MS)
  };
}

function bar(stage, total) {
  const filled = Math.max(0, Math.min(total, stage));
  return '▰'.repeat(filled) + '▱'.repeat(total - filled);
}
function visibleText(state, name, prefix) {
  return (prefix || '⏳') + ' Этап ' + state.stage + '/' + state.total + ': ' + name + '\n' + bar(state.stage, state.total);
}
function out(state, action, name, prefix) {
  return {
    state: state, action: action, text: visibleText(state, name, prefix),
    // request id lives in diagnostic metadata, NOT in the user-visible text
    meta: { request_id: state.request_id, stage: state.stage, total: state.total, status: state.status },
    is_final_delivery: false
  };
}

// advance(state, stageNum, opts{now}) -> { state, action: 'create'|'edit'|'skip', text, meta }
function advance(state, stageNum, opts) {
  state = Object.assign({}, state); opts = opts || {};
  stageNum = Math.max(1, Math.min(TOTAL, num(stageNum, state.stage + 1)));
  if (state.status === 'cancelled' || state.status === 'failed') return out(state, 'skip', STAGES[state.stage - 1] || STAGES[0]);
  // throttle: never go backwards; re-emitting the SAME stage is a no-op (no flood)
  if (stageNum <= state.stage && state.message_id) { const o = out(state, 'skip', STAGES[Math.max(0, state.stage - 1)]); o.throttled = true; return o; }
  // time throttle within the same window for same stage handled above; stage advance is always meaningful
  state.stage = stageNum; state.status = stageNum >= TOTAL ? 'complete' : 'running';
  state.last_update_ts = str(opts.now);
  const name = STAGES[stageNum - 1];
  if (!state.message_id) { return out(state, 'create', name); }   // first send -> create one message
  return out(state, 'edit', name);                                 // thereafter -> edit the same message
}

// record the id Telegram returned for the created/sent message
function setMessageId(state, messageId) { return Object.assign({}, state, { message_id: str(messageId) }); }

function cancel(state, opts) {
  state = Object.assign({}, state, { status: 'cancelled', last_update_ts: str((opts || {}).now) });
  const name = STAGES[Math.max(0, state.stage - 1)] || STAGES[0];
  const o = out(state, state.message_id ? 'edit' : 'create', name, '⛔');
  o.text = '⛔ Отменено на этапе ' + state.stage + '/' + state.total + ': ' + name;
  return o;
}
function fail(state, stageNum, error, opts) {
  state = Object.assign({}, state, { status: 'failed', stage: Math.max(1, Math.min(TOTAL, num(stageNum, state.stage))), last_update_ts: str((opts || {}).now) });
  const name = STAGES[state.stage - 1];
  const o = out(state, state.message_id ? 'edit' : 'create', name, '⚠️');
  o.text = '⚠️ Сбой на этапе ' + state.stage + '/' + state.total + ' (' + name + '): ' + (str(error) || 'неизвестная ошибка') + '. Прошлый отчёт сохранён.';
  return o;
}

// applyEditResult(state, ok) -> when an edit fails, fall back to a fresh message (clear id so next is 'create')
function applyEditResult(state, ok) {
  if (ok) return Object.assign({}, state);
  return Object.assign({}, state, { message_id: '', fallback_count: num(state.fallback_count, 0) + 1 });
}

// --- final delivery is separate + idempotent (a completed progress message is NOT a delivered report) ---
function canDeliver(state, deliveryId) {
  if (state.final_delivered && str(state.delivery_id) === str(deliveryId)) return false; // duplicate
  return true;
}
function markDelivered(state, deliveryId) {
  return Object.assign({}, state, { final_delivered: true, delivery_id: str(deliveryId) });
}

// =========================================================================================================
// DELIVERY-LIFECYCLE-001 (F-2 corrected): the ONE progress message is the single source of delivery truth.
//
// The success of the TEXT report is shown the MOMENT Telegram confirms it (a real report_message_id) — it is
// NEVER blocked on, or coupled to, the XLSX. The SAME message then tracks the Excel upload to its own terminal.
// We render "отправлен" for a report or a file ONLY when we hold the Telegram message id that proves it. There
// is no separate terminal status message — every state below is an EDIT of the same progress message.
//
// Exact user-visible order for the happy path:
//   processing …                                  (intermediate stage bars — advance())
//   → report_sent      «✅ Отчёт готов. Excel-файл отправляется…»   (the instant the text report is confirmed)
//   → document_sending (same visible text; the sendDocument call is in flight)
//   → delivered        «✅ Готово. Отчёт и Excel-файл отправлены.»  (requires BOTH message ids)
// Failure branches:
//   report never sent        → report_failed     «⚠️ Не удалось отправить отчёт. Попробуйте повторить запрос.»
//   report ok, xlsx fails    → document_retrying  «⚠️ Отчёт отправлен, но Excel-файл доставить не удалось. Повторяю отправку…»
//   report ok, xlsx exhausted→ document_failed    «⚠️ Отчёт отправлен, но Excel-файл доставить не удалось. Попробуйте запросить файл повторно.»
// A successful run with no workbook to send has its own honest terminal:
//   delivered_report_only    «✅ Готово. Отчёт отправлен.»
// Analysis-outcome terminals (the delivered report itself carries the honest wording; no workbook) are preserved.
// The FULL delivery-state contract. Every state a lifecycle function can emit appears here, in DELIVERY_TEXT
// (its single canonical user-visible string) and in DELIVERY_RANK (its monotonic order) — no state may exist in
// one table and not the others, so a consumer that switches on delivery_state can never meet an unlisted value.
var DELIVERY_STATES = [
  'processing', 'report_sent', 'document_sending', 'delivered', 'delivered_report_only',
  'report_failed', 'document_retrying', 'document_failed', 'analysis_failed', 'no_data', 'partial'
];
// DELIVERY_TEXT is the ONE place every terminal/intermediate string lives (deliveryTerminalEdit reads it rather
// than inlining literals, so the wording can never drift between the contract and the renderer).
var DELIVERY_TEXT = {
  report_sent: '✅ Отчёт готов. Excel-файл отправляется…',
  document_sending: '✅ Отчёт готов. Excel-файл отправляется…',
  delivered: '✅ Готово. Отчёт и Excel-файл отправлены.',
  delivered_report_only: '✅ Готово. Отчёт отправлен.',
  report_failed: '⚠️ Не удалось отправить отчёт. Попробуйте повторить запрос.',
  document_retrying: '⚠️ Отчёт отправлен, но Excel-файл доставить не удалось. Повторяю отправку…',
  document_failed: '⚠️ Отчёт отправлен, но Excel-файл доставить не удалось. Попробуйте запросить файл повторно.',
  analysis_failed: '⚠️ Анализ не завершён: данные получить не удалось.',
  no_data: '✅ Проверка завершена. Данные для анализа не получены.',
  partial: '⚠️ Анализ завершён частично. Доступные результаты отправлены.'
};
// Rank for the monotonic guard: a run never goes backwards, and any terminal (rank 9) is sticky.
var DELIVERY_RANK = {
  processing: 0, report_sent: 1, document_sending: 2, document_retrying: 2,
  delivered: 9, delivered_report_only: 9, report_failed: 9, document_failed: 9, analysis_failed: 9, no_data: 9, partial: 9
};
function isTerminalDelivery(dstate) { return (DELIVERY_RANK[str(dstate)] || 0) >= 9; }
function deliveryText(dstate) { return DELIVERY_TEXT[str(dstate)] || ''; }

// The edit to apply the INSTANT the text-report send attempt resolves. Success REQUIRES a real Telegram message
// id — a report we cannot prove was delivered is report_failed (truthful), never report_sent.
function deliveryReportEdit(ctx) {
  ctx = ctx || {};
  var has = !!str(ctx.report_message_id);
  var dstate = has ? 'report_sent' : 'report_failed';
  return { delivery_state: dstate, text: deliveryText(dstate), report_message_id: str(ctx.report_message_id), is_terminal: !has };
}

// The terminal edit, driven ONLY by verified facts. ctx:
//   report_message_id      — Telegram id of the delivered text report ('' if it never sent)
//   document_message_id    — Telegram id of the delivered XLSX ('' if not (yet) delivered)
//   xlsx_expected          — a workbook was produced for this run (false => report-only run, no Excel to send)
//   attempts, max_attempts — sendDocument attempts already made / allowed (retry accounting)
//   analysis {final_state, has_analysis, records} — run outcome, for honest no-data/partial/failed wording
function deliveryTerminalEdit(ctx) {
  ctx = ctx || {};
  var an = ctx.analysis || {};
  var fs = str(an.final_state) || 'completed';
  var hasAnalysis = !!an.has_analysis;
  var records = num(an.records, 0);
  var hasReport = !!str(ctx.report_message_id);
  var hasDoc = !!str(ctx.document_message_id);
  var xlsxExpected = ctx.xlsx_expected === true;
  var attempts = num(ctx.attempts, 0);
  var maxAttempts = Math.max(1, num(ctx.max_attempts, 1));
  function T(dstate, text, terminal) { return { delivery_state: dstate, text: text || deliveryText(dstate), is_terminal: terminal !== false }; }

  // The text report never reached Telegram -> claim NOTHING was sent.
  if (!hasReport) return T('report_failed');
  // Honest analysis-outcome terminals (the delivered report carries the wording; there is no workbook). Wording
  // comes from the canonical DELIVERY_TEXT table via deliveryText() — no inline literals to drift.
  if (fs === 'failed' && !hasAnalysis) return T('analysis_failed');
  if (!hasAnalysis && (fs === 'no_data' || records === 0)) return T('no_data');
  if (fs === 'partial') return T('partial');
  // Successful run with no workbook produced -> report-only terminal.
  if (!xlsxExpected) return T('delivered_report_only');
  // Workbook expected: the terminal is decided ONLY by the real sendDocument result.
  if (hasDoc) return T('delivered');                                   // BOTH message ids confirmed
  if (attempts < maxAttempts) return T('document_retrying', null, false); // another attempt follows (NOT terminal)
  return T('document_failed');                                          // retries exhausted
}

// Monotonic delivery guard (idempotency): a terminal state is sticky, and a duplicate worker / stale callback can
// never move the state backwards (delivered -> processing) or re-fire a terminal edit. Returns
// {state, changed, duplicate} — changed=false + duplicate=true means "ignore, already handled".
function advanceDelivery(prev, next) {
  var p = str(prev) || 'processing', n = str(next) || 'processing';
  if (isTerminalDelivery(p)) return { state: p, changed: false, duplicate: true };
  if ((DELIVERY_RANK[n] || 0) < (DELIVERY_RANK[p] || 0)) return { state: p, changed: false, duplicate: true };
  if (n === p) return { state: p, changed: false, duplicate: true };
  return { state: n, changed: true, duplicate: false };
}

module.exports = {
  STAGES, TOTAL, DEFAULT_THROTTLE_MS, initProgress, advance, setMessageId, cancel, fail, applyEditResult,
  canDeliver, markDelivered, bar,
  DELIVERY_STATES, DELIVERY_TEXT, deliveryText, isTerminalDelivery,
  deliveryReportEdit, deliveryTerminalEdit, advanceDelivery
};
