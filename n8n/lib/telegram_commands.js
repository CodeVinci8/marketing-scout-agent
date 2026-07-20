'use strict';
// telegram_commands.js — §8 the ONE canonical public slash-command registry (TELEGRAM-MENU-001).
//
// Source of truth for the NATIVE Telegram command menu (setMyCommands / setChatMenuButton). Registration is
// performed by scripts/telegram_webhook.sh menu-set, whose payload is generated from THIS list — there is no
// second manually maintained command list anywhere.
//
// Only commands that are genuinely implemented by the secure WF18 gateway AND intended for the end user are
// registered: /start /help (fast static lane), /status (command lane), /cancel (ack + WF22 lifecycle).
// Operator/diagnostic commands (/memory, /forget, /new, /context) are deliberately NOT advertised in the
// native menu; they remain routable. Descriptions are concise Russian (Telegram limit: 3-256 chars).

var PUBLIC_BOT_COMMANDS = [
  { command: 'start', description: 'Начало работы и примеры запросов' },
  { command: 'help', description: 'Что умеет помощник' },
  { command: 'status', description: 'Статус текущего запроса' },
  { command: 'cancel', description: 'Отменить текущую операцию' }
];

function botCommands() { return PUBLIC_BOT_COMMANDS.map(function (c) { return { command: c.command, description: c.description }; }); }

// Telegram Bot API constraints: command name ^[a-z0-9_]{1,32}$, description 3..256 chars, no duplicates.
function validateCommands(list) {
  var errors = [];
  var seen = {};
  (Array.isArray(list) ? list : []).forEach(function (c) {
    var name = String((c || {}).command || '');
    var desc = String((c || {}).description || '');
    if (!/^[a-z0-9_]{1,32}$/.test(name)) errors.push('bad_command_name:' + name);
    if (desc.length < 3 || desc.length > 256) errors.push('bad_description_length:' + name);
    if (seen[name]) errors.push('duplicate_command:' + name);
    seen[name] = true;
  });
  if (!Array.isArray(list) || !list.length) errors.push('empty_command_list');
  return { ok: errors.length === 0, errors: errors };
}

// Full setMyCommands request body (default scope so the menu shows in the private chat).
function setMyCommandsBody() { return { commands: botCommands(), scope: { type: 'default' } }; }
// Menu button that opens the command list (restores the native "menu" button).
function setChatMenuButtonBody() { return { menu_button: { type: 'commands' } }; }

module.exports = { PUBLIC_BOT_COMMANDS, botCommands, validateCommands, setMyCommandsBody, setChatMenuButtonBody };
