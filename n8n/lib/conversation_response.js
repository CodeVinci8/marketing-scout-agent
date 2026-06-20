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

module.exports = {
  buildConversationalReply, clarificationReply, followupSuggestions, postReportReply,
  approvalButtons, actionButtons, str, num
};
