'use strict';
// test_wf24_export.js — WF24 XLSX export/delivery fixes proven on the generated workflow (drift-proof).
//   EXPORT-CHAT-001: Select & Scope Report derives the caller (owner/agent_request_id/report_id) from the
//     "When Called by Agent" trigger via callerInput() — NOT from $json (the upstream Google Sheets Read nodes
//     replace $json with sheet rows, which left the delivery chat_id empty -> Telegram 400 "chat_id is empty").
//   EXPORT-CHART-001: the optional chart send degrades silently (onError) so a chart-insufficient report never
//     errors the run after the XLSX already went out.
const A = require('./_assert');
const gen = require('../tools/gen_stage4_workflows.js');
function node(file, name) { const w = (gen.generated || []).find(g => g.file === file).workflow; return w.nodes.find(n => n.name === name); }

A.section('EXPORT-CHAT-001 — Select & Scope reads the caller, not the sheet-row $json');
const scope = node('24_report_export_delivery.json', 'Select & Scope Report').parameters.jsCode;
A.ok('embeds callerInput()', /function callerInput\(\)/.test(scope) && /\$\('When Called by Agent'\)/.test(scope));
A.ok('owner/arid/report_id come from callerInput() (var inp=callerInput())', /var inp=callerInput\(\)/.test(scope));
A.ok('does NOT read owner from $json', scope.indexOf('var inp=$json') < 0);
A.ok('still scopes by owner + report_id', /owner_user_id\)!==owner/.test(scope) && /String\(b\.report_id\)===rid/.test(scope));

A.section('EXPORT-CHART-001 — the optional chart send is fault-tolerant (never blocks XLSX delivery)');
const chart = node('24_report_export_delivery.json', 'Send Chart (SVG via sendDocument)');
A.eq('Send Chart onError=continueRegularOutput', chart.onError, 'continueRegularOutput');
const doc = node('24_report_export_delivery.json', 'Send Document');
A.ok('Send Document is a sendDocument call (primary deliverable)', /sendDocument/.test(JSON.stringify(doc.parameters)));

A.section('WF24 callable contract unchanged (owner_user_id, report_id, action, …)');
const trig = node('24_report_export_delivery.json', 'When Called by Agent');
const inputs = (trig.parameters.workflowInputs.values || []).map(v => v.name);
['owner_user_id', 'agent_request_id', 'report_id', 'action'].forEach(k =>
  A.ok('trigger declares ' + k, inputs.indexOf(k) >= 0));

A.report('wf24-export');
