'use strict';
// test_live_defects.js — fixes for the fresh operator Telegram transcript (defects 2/3/4/5/6/7/11).
// Lib behaviour + generator drift proofs. Offline, $0.
const A = require('./_assert');
const fs = require('fs');
const path = require('path');
const CR = require('../n8n/lib/conversation_response.js');
const gen = require('../tools/gen_stage4_workflows.js');
function wf(file) {
  const g = (gen.generated || []).find(x => x.file === file);
  if (g) return g.workflow;                                   // gen_stage4-produced workflow
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', file), 'utf8')); // hand-maintained (WF12)
}
function node(file, name) { return wf(file).nodes.find(n => n.name === name); }
function hasEdge(w, from, to) { return !!(w.connections[from] && JSON.stringify(w.connections[from]).indexOf('"' + to + '"') >= 0); }

A.section('DEFECT-4 — report markdown is plainified for Telegram (no raw #, **, links)');
const md = '# Отчёт: конкуренты — Москва/МО\n## Дайджест\n- Профили: **0**\n- Сайты: 3\n\nСайт [ссылка](https://finardi.ru)\n\n**Вывод:** мало данных.';
const plain = CR.plainifyForTelegram(md);
A.ok('no heading hashes', !/(^|\n)\s*#/.test(plain), plain);
A.ok('no bold markers', plain.indexOf('**') < 0);
A.ok('no raw markdown links', plain.indexOf('](') < 0);
A.ok('bullets converted to •', plain.indexOf('• Профили') >= 0);
A.ok('link rendered as text (url)', /ссылка \(https:\/\/finardi\.ru\)/.test(plain));
A.ok('facts preserved', plain.indexOf('Вывод: мало данных.') >= 0 && plain.indexOf('Сайты: 3') >= 0);
const dbody = CR.deliveryBody({ report_markdown: md }, { final_state: 'completed', records_reported: 3 }, [{ id: 'generate_ideas', name: 'x', available: true }]);
A.ok('deliveryBody emits plain text (no raw markdown)', dbody.indexOf('**') < 0 && !/(^|\n)#/.test(dbody));

A.section('DEFECT-2 — Fast Static Lane dedups duplicate update_id (idempotent before the claim)');
const fast = node('18_telegram_agent_gateway.json', 'Fast Static Lane').parameters.jsCode;
A.ok('fast lane reads workflow staticData', /getWorkflowStaticData/.test(fast));
A.ok('fast lane keys on update_id and returns duplicate', /fast_seen/.test(fast) && /duplicate:true/.test(fast));
// a fast-lane duplicate must TERMINATE, not fall through to the heavy path (which would re-send the static reply).
const w18 = wf('18_telegram_agent_gateway.json');
A.ok('WF18 has a Duplicate Update? gate', !!node('18_telegram_agent_gateway.json', 'Duplicate Update?'));
A.ok('duplicate (true) branch is a dead end (no heavy path)', (w18.connections['Duplicate Update?'].main[0] || []).length === 0);
A.ok('non-duplicate (false) continues to Fast Static Reply?', JSON.stringify(w18.connections['Duplicate Update?'].main[1]).indexOf('Fast Static Reply?') >= 0);

A.section('DEFECT-11 — quick commands skip the "Принял запрос" processing ack');
const cmd = node('18_telegram_agent_gateway.json', 'Command Lane').parameters.jsCode;
A.ok('Command Lane detects quick commands and skips the ack', /__quick/.test(cmd) && /lane:'quick'/.test(cmd));
A.ok('genuine requests still get the ack', /request_ack/.test(cmd));
// eval the ACTUAL generated regex (not just presence) — catches the backtick-template "\\s" -> "s" mangling.
const qm = cmd.match(/var __quick=(\/[\s\S]*?\/i)\.test/);
A.ok('quick-command regex literal is present', !!qm, 'no __quick regex found');
if (qm) {
  const qrx = eval(qm[1]); // eslint-disable-line no-eval
  A.ok('regex MATCHES "что ты помнишь" (\\s not mangled to s)', qrx.test('что ты помнишь'));
  A.ok('regex MATCHES "покажи мои источники"', qrx.test('покажи мои источники'));
  A.ok('regex does NOT match a genuine analysis request', !qrx.test('проанализируй конкурентов по ПТС в Москве'));
}

A.section('DEFECT-5 — WF20 auto-delivers the XLSX after the report (only when data exists)');
const w20 = wf('20_agent_orchestrator.json');
A.ok('WF20 has a Build Report XLSX node', !!node('20_agent_orchestrator.json', 'Build Report XLSX'));
A.ok('WF20 has a Send Report XLSX (sendDocument)', /sendDocument/.test(JSON.stringify(node('20_agent_orchestrator.json', 'Send Report XLSX').parameters)));
// REPORT-TRUTH-C: the send now sits behind the «XLSX Ready?» gate so a skipped workbook still reaches the
// completion edit.
A.ok('bundle -> XLSX -> gate -> send wired', hasEdge(w20, 'Append report_bundles', 'Build Report XLSX') && hasEdge(w20, 'Build Report XLSX', 'XLSX Ready?') && hasEdge(w20, 'XLSX Ready?', 'Send Report XLSX'));
A.ok('XLSX build gates on run content (no empty workbook)', /hasContent/.test(node('20_agent_orchestrator.json', 'Build Report XLSX').parameters.jsCode));

A.section('DEFECT-1 — WF20 marks the plan terminal after delivery');
A.ok('WF20 has Mark Plan Complete', !!node('20_agent_orchestrator.json', 'Mark Plan Complete'));
A.ok('completion upsert sets completed/no_data/failed', /term=\(st==='no_data'\)\?'no_data'/.test(node('20_agent_orchestrator.json', 'Shape Plan Completion').parameters.jsCode));

A.section('DEFECT-6/7 — WF12 report: distinct competitor counts + gated comparison claim');
const w12 = wf('12_market_intelligence_report_builder.json');
const rep = w12.nodes.find(n => n.name === 'Build Deterministic Report').parameters.jsCode;
A.ok('DEFECT-6: digest labels SOCIAL profiles (not bare "конкурентов 0")', /Социальных профилей конкурентов/.test(rep));
A.ok('DEFECT-6: points to сайты when no social profiles', /конкуренты в этом срезе представлены сайтами/.test(rep));
A.ok('DEFECT-7: comparison claim requires real up/down deltas', /__realDeltas=__angMarkers\.filter/.test(rep) && /hasConcreteTrend=hasBaseline&&__realDeltas>0/.test(rep));

A.report('live-defects');
