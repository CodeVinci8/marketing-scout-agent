'use strict';
// conversation_response.js — Part 5: conversational response generation.
//
// Every reply must be useful WITHOUT buttons. The text explicitly states what was understood, what is missing,
// what will happen next, whether approval is needed, the expected source scope + call/budget ceiling, the
// current result, factual limitations, and a natural-language invitation to continue. Buttons (optional) are
// shortcuts whose callback_data maps to REAL router intents — they never add capabilities. Standalone +
// deterministic; user-facing text is Russian (operator preference).

function str(v) { return v == null ? '' : String(v).trim(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

// Generic conversational reply skeleton — populated by the gateway from the routed intent + plan.
function buildConversationalReply(p) {
  p = p || {};
  const lines = [];
  if (p.understood) lines.push('Понял так: ' + str(p.understood));
  if (p.missing) lines.push('Не хватает: ' + str(p.missing));
  if (p.next) lines.push('Дальше: ' + str(p.next));
  if (p.requires_approval) lines.push('Нужно ваше подтверждение перед запуском (платные/внешние действия).');
  if (p.source_scope) lines.push('Источники: ' + str(p.source_scope));
  if (p.budget_ceiling) lines.push('Лимит вызовов/бюджет: ' + str(p.budget_ceiling));
  if (p.result) lines.push(str(p.result));
  if (p.limitations) lines.push('Ограничения: ' + str(p.limitations));
  const followups = (p.followups || []).map(str).filter(Boolean);
  if (followups.length) lines.push('Можно дальше: ' + followups.join('; ') + '. Просто напишите, что сделать.');
  return lines.join('\n');
}

// Clarification reply — exactly one concise question, with no external work implied.
function clarificationReply(question) {
  return str(question) || 'Уточните, пожалуйста, что сделать дальше?';
}

// Follow-up suggestions are drawn ONLY from currently-available capabilities (honest; never invents).
function followupSuggestions(availableCaps) {
  const names = (availableCaps || []).filter(c => c && c.available && ['deep_competitor_analysis', 'add_source', 'generate_ideas', 'compare_periods', 'manage_sources'].indexOf(c.id) >= 0).map(c => c.name);
  return names;
}

// Post-report conversational reply: factual summary -> changes -> ideas -> limitations -> NL invitation.
function postReportReply(report, availableCaps) {
  report = report || {};
  const lines = [];
  lines.push('Готово. ' + (str(report.summary_text) || ('Найдено записей в отчёте: ' + num(report.rows_after_filters || report.competitor_count, 0) + '.')));
  const changes = [].concat(report.changes || report.major_findings || []).map(str).filter(Boolean);
  if (changes.length) lines.push('Главное: ' + changes.join('; ') + '.');
  const ideas = [].concat(report.ideas || report.recommendations || []).map(str).filter(Boolean);
  if (ideas.length) lines.push('Идеи (это рекомендации, не факты): ' + ideas.slice(0, 5).join('; ') + '.');
  const limits = [].concat(report.limitations || []).map(str).filter(Boolean);
  if (limits.length) lines.push('Ограничения данных: ' + limits.join('; ') + '.');
  const sugg = followupSuggestions(availableCaps);
  if (sugg.length) {
    lines.push('Я могу: ' + sugg.join(', ') + ' — или найти новые каналы привлечения и подготовить идеи для вашего оффера. Просто напишите, что сделать дальше.');
  } else {
    lines.push('Напишите, что сделать дальше.');
  }
  return lines.join('\n');
}

// --- optional buttons (shortcuts only; callback_data maps to REAL router intents) --------------------------
function approvalButtons(agentRequestId) {
  return { inline_keyboard: [[
    { text: '✅ Запустить', callback_data: 'approve:' + str(agentRequestId) },
    { text: '✖ Отклонить', callback_data: 'reject:' + str(agentRequestId) }
  ]] };
}
// Each button's callback_data is `intent:<capability_id>` — the router parses these deterministically, so a
// button is exactly equivalent to typing the corresponding request. Only AVAILABLE capabilities are offered.
function actionButtons(availableCaps) {
  const wanted = ['deep_competitor_analysis', 'add_source', 'generate_ideas', 'compare_periods', 'manage_sources'];
  const rows = (availableCaps || []).filter(c => c && c.available && wanted.indexOf(c.id) >= 0)
    .map(c => [{ text: c.name, callback_data: 'intent:' + c.id }]);
  return rows.length ? { inline_keyboard: rows } : null;
}

// --- proactive post-report continuation (attached to the REAL delivery path) -------------------------------
// Conversational phrasing per capability for the proactive section. (Claude may rephrase, but the action set
// comes from the deterministic registry — never invented here.)
// Sentence phrasing (lowercase) — reads naturally inside "Я могу <phrase>, <phrase>. …".
const PROACTIVE_LABELS = {
  deep_competitor_analysis: 'подробнее сравнить конкурентов',
  generate_ideas: 'предложить идеи для оффера',
  add_source: 'добавить источники в мониторинг',
  rerun_request: 'проверить изменения повторно',
  compare_periods: 'сравнить с прошлым периодом',
  manage_sources: 'настроить или проверить источники',
  competitor_discovery: 'найти новые источники-конкуренты'
};
// RQ-BUTTONS-001: button captions are proper-cased and concise (a button is a title, not a mid-sentence clause).
const PROACTIVE_BUTTON_LABELS = {
  deep_competitor_analysis: 'Подробнее сравнить конкурентов',
  generate_ideas: 'Предложить идеи для оффера',
  add_source: 'Добавить источники в мониторинг',
  rerun_request: 'Проверить изменения повторно',
  compare_periods: 'Сравнить с прошлым периодом',
  manage_sources: 'Настроить источники',
  competitor_discovery: 'Найти новые источники'
};
function btnCap(s) { s = str(s); return s ? (s.charAt(0).toUpperCase() + s.slice(1)) : s; }
// State-aware action set, drawn ONLY from available capabilities. A success report offers the rich set; a
// partial/no-data report offers recovery actions instead of "success" actions.
function proactiveActions(state, availableCaps) {
  state = str(state).toLowerCase();
  const noData = state === 'no_data';
  const partial = state === 'partial';
  let wanted;
  if (noData) wanted = ['competitor_discovery', 'rerun_request', 'manage_sources', 'add_source'];
  else if (partial) wanted = ['rerun_request', 'competitor_discovery', 'generate_ideas', 'manage_sources', 'compare_periods'];
  else wanted = ['deep_competitor_analysis', 'generate_ideas', 'add_source', 'rerun_request', 'compare_periods'];
  const byId = {}; (availableCaps || []).forEach(c => { if (c) byId[c.id] = c; });
  return wanted.filter(id => byId[id] && byId[id].available).map(id => ({
    id: id,
    label: PROACTIVE_LABELS[id] || (byId[id].name),
    button_label: PROACTIVE_BUTTON_LABELS[id] || btnCap(PROACTIVE_LABELS[id] || byId[id].name)
  }));
}
// The proactive sentence — useful WITHOUT buttons, ending with the natural-language invitation.
function proactiveText(state, availableCaps) {
  const acts = proactiveActions(state, availableCaps);
  if (!acts.length) return 'Напишите, что сделать дальше.';
  return 'Я могу ' + acts.map(a => a.label).join(', ') + '. Просто напишите, что сделать дальше.';
}
// Optional keyboard for the proactive actions (intent:<id> == the equivalent free-text request). Caller
// attaches this to the FINAL message chunk only.
function proactiveKeyboard(state, availableCaps) {
  const acts = proactiveActions(state, availableCaps);
  return acts.length ? { inline_keyboard: acts.map(a => [{ text: a.button_label || a.label, callback_data: 'intent:' + a.id }]) } : null;
}
// The full delivery body: IMMUTABLE report facts first (verbatim, never rewritten), then a state-aware
// proactive continuation. Partial/no-data get an honest one-line status before the continuation.
// DEFECT-4: the report is authored in GitHub-flavoured Markdown (# headings, ** bold, - lists) which Telegram
// does NOT render — the user sees raw "# Отчёт" / "**". Convert to clean plain text (no parse_mode, so there is
// no escaping/formatting failure mode): drop heading hashes, unwrap bold/italic/code, bullets -> •, links ->
// "text (url)". Structure and facts are preserved; only the markup characters go.
function plainifyForTelegram(md) {
  let s = str(md);
  if (!s) return s;
  s = s.split('\n').map(function (ln) {
    let t = ln.replace(/^\s{0,3}#{1,6}\s+/, '');   // headings
    t = t.replace(/^(\s*)[-*+]\s+/, '$1• ');        // list bullets
    t = t.replace(/^\s{0,3}>\s?/, '');              // blockquote
    return t;
  }).join('\n');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1'); // bold
  // B5: strip single-underscore italics (_текст_) that Telegram would otherwise render literally, WITHOUT
  // touching snake_case identifiers — the opening _ must follow start/space/punct and the closing _ must be
  // followed by end/space/punct, so source_run_id / min_lead_score stay intact.
  s = s.replace(/(^|[\s(])_([^_\n]{1,300}?)_(?=$|[\s.,;:!?)])/g, '$1$2');
  s = s.replace(/`([^`]+)`/g, '$1');                                     // inline code
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');     // links
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
function deliveryBody(report, summary, availableCaps) {
  report = report || {}; summary = summary || {};
  const state = str(summary.final_state).toLowerCase() || 'completed';
  const noData = num(summary.records_reported, 0) === 0 && state !== 'completed';
  // UX-RU-002: final_state is an internal enum — the fallback line maps it to Russian, never prints it raw.
  const stateRu = { completed: 'анализ завершён', partial: 'анализ завершён частично', no_data: 'данных не собрано', failed: 'анализ остановлен' };
  const facts = plainifyForTelegram(str(report.report_markdown)) || str(report.summary_text) ||
    ('Итог: ' + (stateRu[state] || 'анализ завершён') + '. Записей в отчёте: ' + num(summary.records_reported, 0) + '.');
  const lines = [facts];
  if (noData || state === 'no_data') lines.push('Подходящих данных не собрано.');
  else if (state === 'partial') lines.push('Отчёт частичный — часть источников не отработала.');
  lines.push(proactiveText(noData ? 'no_data' : state, availableCaps));
  return lines.join('\n\n');
}

module.exports = {
  buildConversationalReply, clarificationReply, followupSuggestions, postReportReply,
  approvalButtons, actionButtons, proactiveActions, proactiveText, proactiveKeyboard, deliveryBody, plainifyForTelegram, str, num
};
