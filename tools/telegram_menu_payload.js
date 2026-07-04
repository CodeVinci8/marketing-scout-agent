'use strict';
// telegram_menu_payload.js — §8 TELEGRAM-MENU-001: emit the Telegram Bot API bodies for the native command
// menu from the ONE canonical registry (n8n/lib/telegram_commands.js). Validates before emitting; exits
// non-zero on an invalid registry so registration fails closed. Never touches the bot token.
//
// Usage:
//   node tools/telegram_menu_payload.js set-commands   -> setMyCommands JSON body
//   node tools/telegram_menu_payload.js set-menu       -> setChatMenuButton JSON body
//   node tools/telegram_menu_payload.js expected       -> canonical command array (for getMyCommands compare)
const TC = require('../n8n/lib/telegram_commands.js');

const v = TC.validateCommands(TC.botCommands());
if (!v.ok) { console.error('INVALID_COMMAND_REGISTRY: ' + v.errors.join('; ')); process.exit(1); }

const mode = String(process.argv[2] || 'set-commands');
if (mode === 'set-commands') process.stdout.write(JSON.stringify(TC.setMyCommandsBody()));
else if (mode === 'set-menu') process.stdout.write(JSON.stringify(TC.setChatMenuButtonBody()));
else if (mode === 'expected') process.stdout.write(JSON.stringify(TC.botCommands()));
else { console.error('unknown mode: ' + mode); process.exit(2); }
