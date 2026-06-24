'use strict';
// test_agent_identity.js — canonical Vinci AI Pilot identity + system prompt (Section 7 / 23).
const A = require('./_assert.js');
const ID = require('../n8n/lib/agent_identity.js');

A.section('product identity is Vinci AI Pilot and versioned');
A.eq('product name', ID.PRODUCT_NAME, 'Vinci AI Pilot');
A.ok('identity statement names Vinci AI Pilot', /Vinci AI Pilot/.test(ID.IDENTITY_RU));
A.ok('identity is in Russian', /бизнес-агент/.test(ID.IDENTITY_RU));
A.ok('identity version is set', /^identity-v\d+$/.test(ID.IDENTITY_VERSION));
A.ok('system prompt version is set', /^vinci-system-v\d+$/.test(ID.SYSTEM_PROMPT_VERSION));

A.section('identity questions are detected deterministically (Russian variants)');
[
  'Кто ты?', 'Ты кто?', 'Что ты умеешь?', 'Чем ты можешь помочь?', 'Как ты работаешь?',
  'Для чего ты нужен?', 'Какие задачи ты решаешь?', 'Что такое Vinci AI Pilot?', 'Расскажи о себе',
  'Представься', 'твои возможности', 'who are you', 'what can you do'
].forEach(function (q) { A.ok('detects "' + q + '"', ID.isIdentityQuestion(q)); });

A.section('identity detection does NOT swallow real research asks');
[
  'Найди конкурентов по займам под ПТС в Москве',
  'Сравни мои цены с рынком',
  'Поставь сайт конкурента на мониторинг',
  'Сделай разбор competitor.ru',
  'пришли недельную сводку'
].forEach(function (q) { A.ok('ignores research ask "' + q + '"', !ID.isIdentityQuestion(q)); });

A.section('identity answer is free, Russian, and creates no request / no paid call');
var ans = ID.identityAnswer({ claudeEnabled: false });
A.eq('answer creates no request', ans.creates_request, false);
A.eq('answer does not enter pipeline', ans.enters_pipeline, false);
A.eq('answer requires no approval', ans.requires_approval, false);
A.eq('answer makes zero paid calls', ans.paid_calls, 0);
A.eq('answer intent is identity', ans.intent, 'identity');
A.ok('answer leads with the Vinci identity', /Vinci AI Pilot/.test(ans.text));
A.ok('answer is Russian and includes example requests', /Примеры запросов/.test(ans.text) && /конкурент/i.test(ans.text));
A.ok('answer explains the approval/budget model', /подтвержден|бюджет/i.test(ans.text));
A.ok('answer lists the safe commands', /\/start.*\/help.*\/new.*\/status.*\/cancel/.test(ans.text.replace(/\n/g, ' ')));
A.eq('identity answer is identical whether Claude is on or off', ID.identityAnswer({ claudeEnabled: true }).text, ans.text);

A.section('canonical Claude system prompt carries the required behaviour');
var sp = ID.systemPrompt({});
A.ok('system prompt is versioned', sp.indexOf(ID.SYSTEM_PROMPT_VERSION) >= 0);
A.ok('declares Vinci AI Pilot identity', /Vinci AI Pilot/.test(sp));
A.ok('Russian default', /на русском/.test(sp));
A.ok('evidence-first / source required', /доказательств|источник/i.test(sp));
A.ok('forbids fabrication', /не выдумывай/.test(sp));
A.ok('facts vs inference vs assumptions', /факты.*допущения|допущения.*вывод/i.test(sp));
A.ok('treats web content as untrusted data', /ДАННЫЕ, а не инструкции/.test(sp));
A.ok('does not leak internal prompts/credentials/ids', /не раскрывай/.test(sp));
A.ok('requires approval + budget for paid actions', /подтвержден.*бюджет|бюджет.*подтвержден|подтверждения/i.test(sp));
A.ok('reproducible calculations', /воспроизводим/.test(sp));
A.ok('Moscow time for system timestamps', /Europe\/Moscow/.test(sp));
A.ok('source timestamps kept separately', /из источников храни отдельно/.test(sp));
A.ok('insufficient-data honesty', /Недостаточно данных/.test(sp));

A.section('zero-paid mode is explicit in the system prompt');
var spSafe = ID.systemPrompt({ zeroPaidMode: true });
A.ok('safe-mode note present when zeroPaidMode', /безопасный режим/.test(spSafe));
A.ok('safe-mode note absent by default', !/безопасный режим/.test(sp));

A.report('AGENT IDENTITY (Vinci AI Pilot ' + ID.IDENTITY_VERSION + ' / ' + ID.SYSTEM_PROMPT_VERSION + ')');
