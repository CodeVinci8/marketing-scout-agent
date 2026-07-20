'use strict';
// test_source_registry.js — SOURCE-OP-001: the monitored-source registry usable purely by natural language.
// WF18 dispatches only the coarse action ('manage_sources'); parseSourceOp turns the user's text into a concrete
// sub-op (list/add/pause/resume/remove/check) + arg, so the registry actually acts instead of replying
// "Команда источников не распознана". Owner isolation, URL dedup, and Avito-while-blocked are re-asserted.
const A = require('./_assert');
const TS = require('../n8n/lib/tracked_sources.js');
const CFG = require('../n8n/lib/agent_config.js');

A.section('parseSourceOp — natural language -> concrete op (+arg)');
A.eq('покажи мои источники -> list', TS.parseSourceOp('покажи мои источники').op, 'list');
A.eq('список источников -> list', TS.parseSourceOp('список источников').op, 'list');
const add = TS.parseSourceOp('добавь сайт https://finardi.ru в мониторинг');
A.eq('добавь <url> -> add', add.op, 'add');
A.ok('add extracts the url', /finardi\.ru/.test(add.arg), 'arg=' + add.arg);
const pause = TS.parseSourceOp('поставь на паузу vk.com/kredit874');
A.eq('поставь на паузу -> pause', pause.op, 'pause');
A.ok('pause extracts the ref', /vk\.com\/kredit874/.test(pause.arg), 'arg=' + pause.arg);
A.eq('возобнови источник -> resume', TS.parseSourceOp('возобнови источник finardi.ru').op, 'resume');
A.eq('убери источник -> remove', TS.parseSourceOp('убери источник finardi.ru').op, 'remove');
A.eq('проверь источник -> check', TS.parseSourceOp('проверь источник finardi.ru').op, 'check');
A.eq('a bare URL alone -> add', TS.parseSourceOp('https://mkbkfin.ru').op, 'add');
A.eq('unknown source chatter defaults to list (safe)', TS.parseSourceOp('что там с источниками').op, 'list');

A.section('registry ops — add is idempotent (URL dedup) + owner-isolated');
const cfg = CFG.resolveConfig({ MS_SPREADSHEET_ID: 'S', MS_TELEGRAM_ALLOWED_USER_IDS: '111', MS_SOURCE_ALLOWLIST: 'website,telegram' });
let sources = [];
const a1 = TS.addSource(sources, 'https://finardi.ru', { owner_user_id: '111', cfg: cfg, ts: 't1' });
A.ok('first add succeeds', a1.added, a1.reason);
sources = a1.sources;
const a2 = TS.addSource(sources, 'https://finardi.ru/', { owner_user_id: '111', cfg: cfg, ts: 't2' });
A.ok('same url re-add is deduped (not added twice)', !a2.added && a2.reason === 'already_tracked', a2.reason);
A.eq('registry still holds exactly 1 source for the owner', TS.listSources(sources, '111').length, 1);
A.eq('a DIFFERENT owner sees none of it (isolation)', TS.listSources(sources, '999').length, 0);
const chk = TS.checkSource(sources, 'https://finardi.ru', { owner_user_id: '111' });
A.ok('check finds the tracked source', chk && chk.found, 'not found');
const pausedRes = TS.setSourceStatus(sources, a1.source.key, 'paused', { owner_user_id: '111', ts: 't3' });
A.ok('pause changes status', pausedRes.changed, pausedRes.reason);
A.ok('foreign owner cannot pause it', !TS.setSourceStatus(sources, a1.source.key, 'paused', { owner_user_id: '999', ts: 't4' }).changed, 'foreign owner changed it');

A.section('AVITO-BLOCK-001 — Avito platform is not addable to the registry while blocked');
A.ok('avito platform not available while blocked', !TS.sourceAvailable(cfg, 'avito'));
A.ok('website + telegram_channel available (allowlisted)', TS.sourceAvailable(cfg, 'website') && (cfg.source_allowlist.indexOf('telegram') >= 0));

A.section('DEFECT-10 — long platform names alias to the short allowlist (telegram_channel->telegram, vk_community->vk)');
A.ok('telegram_channel available when telegram allowlisted', TS.sourceAvailable({ source_allowlist: ['website', 'telegram'] }, 'telegram_channel'));
A.ok('vk_community NOT available when vk not allowlisted', !TS.sourceAvailable({ source_allowlist: ['website', 'telegram'] }, 'vk_community'));
A.ok('vk_community available when vk allowlisted', TS.sourceAvailable({ source_allowlist: ['website', 'vk'] }, 'vk_community'));
// a real Telegram add now succeeds under a telegram allowlist (was falsely "площадка недоступна")
const tgAdd = TS.addSource([], 't.me/broker_pts', { owner_user_id: '111', cfg: TS && require('../n8n/lib/agent_config.js').resolveConfig({ MS_SPREADSHEET_ID: 'S', MS_TELEGRAM_ALLOWED_USER_IDS: '111', MS_SOURCE_ALLOWLIST: 'website,telegram', MS_ENABLE_TELEGRAM_COLLECTOR: 'true' }), ts: 't1' });
A.ok('adding a Telegram channel succeeds when telegram is allowlisted', tgAdd.added, tgAdd.reason);

A.section('WF22 wires parseSourceOp (generator drift-proof)');
const gen = require('../tools/gen_stage4_workflows.js');
function node(file, name) { const w = (gen.generated || []).find(g => g.file === file).workflow; return w.nodes.find(n => n.name === name); }
const apply = node('22_conversation_control.json', 'Apply Control Command').parameters.jsCode;
A.ok('embeds parseSourceOp', /parseSourceOp\(/.test(apply));
A.ok('derives the sub-op when a coarse manage_sources action arrives', /\['add','list','pause','resume','remove','check'\]\.indexOf\(String\(inp\.op\)\)<0/.test(apply));
const trig = node('22_conversation_control.json', 'When Called by Agent');
A.ok('WF22 trigger declares text input', (trig.parameters.workflowInputs.values || []).map(v => v.name).indexOf('text') >= 0);

A.report('source-registry');
