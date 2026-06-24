'use strict';
// test_telegram_commands.js — offline acceptance for scripts/configure_telegram_commands.sh.
// Proves: exact canonical Russian menu, dry-run makes zero network requests, the bot token is read only from
// the environment + never printed, a token-shaped CLI argument is refused, and the syntax is valid. NO network.
const A = require('./_assert.js');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'configure_telegram_commands.sh');
const FAKE = 'FAKE123:offline-not-a-real-token';

function run(args, env, expectFail) {
  try {
    const out = execFileSync('bash', [SCRIPT].concat(args || []), { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
    return { code: 0, out: out };
  } catch (e) { return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}

A.section('script is syntactically valid bash');
A.ok('bash -n passes', (function () { try { execFileSync('bash', ['-n', SCRIPT]); return true; } catch (e) { return false; } })());

A.section('--print-commands prints the EXACT canonical Russian menu in order');
var pc = run(['--print-commands'], {});
A.eq('print-commands exits 0', pc.code, 0);
var expected = [
  'start - Запустить агента и показать примеры задач',
  'help - Возможности агента и примеры запросов',
  'new - Начать новую задачу',
  'status - Статус текущей задачи',
  'cancel - Отменить текущую задачу'
];
A.eq('exact 5-line menu in exact order', pc.out.trim().split('\n').map(function (s) { return s.trim(); }), expected);
A.ok('does not advertise internal/destructive commands', !/reset_all|admin|debug|approve|reject|forget|\/memory|\/context/.test(pc.out));

A.section('dry-run is the default: zero network, token masked, token never printed');
var dr = run([], { MS_TELEGRAM_BOT_TOKEN: FAKE });
A.eq('dry-run exits 0', dr.code, 0);
A.ok('reports the token as present + masked', /MS_TELEGRAM_BOT_TOKEN: present \(masked\)/.test(dr.out));
A.ok('declares zero network requests', /DRY-RUN: 0 network requests/.test(dr.out));
A.ok('renders the language_code ru payload', /"language_code": "ru"/.test(dr.out));
A.ok('payload carries all five commands', expected.every(function (line) {
  var name = line.split(' - ')[0], desc = line.split(' - ')[1];
  return dr.out.indexOf('"command": "' + name + '"') >= 0 && dr.out.indexOf('"description": "' + desc + '"') >= 0;
}));
A.ok('the token VALUE never appears in output', dr.out.indexOf(FAKE) < 0);
A.ok('ends with a PASS marker', /PASS: dry-run/.test(dr.out));

A.section('dry-run without a token still works (no network needed) and reports MISSING');
var drNo = run([], { MS_TELEGRAM_BOT_TOKEN: '' });
A.eq('dry-run without token exits 0', drNo.code, 0);
A.ok('reports the token MISSING', /MS_TELEGRAM_BOT_TOKEN: MISSING/.test(drNo.out));

A.section('refuses a token supplied as a CLI argument (fail closed)');
var argTok = run(['bot12345:secret-shaped'], {});
A.ok('token-shaped CLI arg is refused with non-zero exit', argTok.code !== 0);
A.ok('the refused arg value is not echoed back as a token', !/secret-shaped/.test(argTok.out) || /refusing/.test(argTok.out));
var badArg = run(['--nonsense'], {});
A.ok('unknown flag fails closed', badArg.code !== 0);

A.report('TELEGRAM COMMAND CONFIG (offline, 0 network, token env-only)');
