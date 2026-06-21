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
  'Сравниваю результаты', 'Формирую отчёт', 'Готовлю таблицу и графики', 'Отправляю результат', 'Готово'
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

module.exports = { STAGES, TOTAL, DEFAULT_THROTTLE_MS, initProgress, advance, setMessageId, cancel, fail, applyEditResult, canDeliver, markDelivered, bar };
