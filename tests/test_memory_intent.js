'use strict';
// test_memory_intent.js — MEMORY-INTENT-001: natural-language memory questions reach the memory view, not the
// competitor-clarification fallback; WF22 resolves the coarse 'manage_memory' action to a concrete sub-op.
const A = require('./_assert');
const R = require('../n8n/lib/intent_router.js');

function intent(t) { const r = R.routeIntent({ kind: 'request', text: t }); return r.intent && r.intent.intent; }

A.section('intent_router — NL memory questions route to manage_memory');
['что ты помнишь', 'что ты обо мне помнишь', 'покажи память', 'какие предпочтения сохранены', 'что ты запомнил'].forEach(function (t) {
  A.eq('"' + t + '" -> manage_memory', intent(t), 'manage_memory');
});
A.eq('/memory still routes to manage_memory (regression)', intent('/memory'), 'manage_memory');

A.section('memory routing does not swallow real requests');
A.eq('a competitor request stays competitor_search', intent('найди кредитных брокеров в Москве'), 'competitor_search');
A.eq('a source list stays manage_sources', intent('покажи мои источники'), 'manage_sources');

A.section('WF22 resolves the coarse manage_memory action to a concrete op (drift-proof)');
const gen = require('../tools/gen_stage4_workflows.js');
function node(file, name) { const w = (gen.generated || []).find(g => g.file === file).workflow; return w.nodes.find(n => n.name === name); }
const apply = node('22_conversation_control.json', 'Apply Control Command').parameters.jsCode;
A.ok('derives memory sub-op when coarse manage_memory arrives', /inp\.domain==='memory'&&\['memory','view','forget','forget_all','new','context'\]\.indexOf\(String\(inp\.op\)\)<0/.test(apply));
A.ok('NL memory defaults to view', /'view'/.test(apply) && /forget_all/.test(apply));
A.ok('empty-memory reply is helpful (offers what it can remember)', apply.indexOf('Могу запомнить нишу, регион, источники') >= 0);

A.report('memory-intent');
