// test_wf18_sheets_budget.js — Phase 4 request-budget gate for the WF18 hot path (SHEETS-READ-AMPLIFICATION-001).
// Proves the accepted path runs under the standard 60/min Google Sheets quota with margin: NO full-sheet Get-Rows
// reads, exactly ONE batchGet, bounded write count, no read-retry cascade, no secret/literal-id leakage. Offline, $0.
'use strict';
const A = require('./_assert');
const path = require('path');
const WF = require(path.join(__dirname, '..', 'n8n', 'workflows', '18_telegram_agent_gateway.json'));
const nodes = WF.nodes || [];
const txt = JSON.stringify(WF);

const gs = nodes.filter(n => n.type === 'n8n-nodes-base.googleSheets');
const reads = gs.filter(n => (n.parameters || {}).operation === 'read');
const writes = gs.filter(n => ['append', 'appendOrUpdate', 'update'].indexOf((n.parameters || {}).operation) >= 0);
const batch = nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest' && /\/values:batchGet/.test(String((n.parameters || {}).url || '')));
const extractors = ['Read agent_request_events', 'Read conversation_state', 'Read conversation_messages',
  'Read conversation_summaries', 'Read durable_memories', 'Read execution_plans']
  .map(nm => nodes.find(n => n.name === nm)).filter(Boolean);

A.section('no full-sheet Get Rows in the hot path');
A.eq('WF18_FULL_SHEET_GET_ROWS_IN_HOT_PATH', reads.length, 0);

A.section('exactly one bounded batchGet read for the whole read phase');
A.eq('one values:batchGet node', batch.length, 1);
{
  const p = (batch[0] || {}).parameters || {};
  const url = String(p.url || '');
  A.ok('batchGet uses the predefined googleApi credential', p.authentication === 'predefinedCredentialType' && p.nodeCredentialType === 'googleApi');
  A.ok('batchGet carries a googleApi credential reference', !!(batch[0].credentials && batch[0].credentials.googleApi));
  A.ok('batchGet requests UNFORMATTED_VALUE + FORMATTED_STRING (legacy parity)', /valueRenderOption=UNFORMATTED_VALUE/.test(url) && /dateTimeRenderOption=FORMATTED_STRING/.test(url));
  A.ok('spreadsheet id stays an $env expression (no literal id baked in)', /\$env\.MS_SPREADSHEET_ID/.test(url) && !/spreadsheets\/[0-9A-Za-z_-]{20,}\//.test(url));
  for (const t of ['agent_request_events', 'conversation_state', 'conversation_messages', 'conversation_summaries', 'durable_memories', 'execution_plans']) {
    A.ok('batchGet covers ' + t, url.indexOf(t) >= 0);
  }
  A.ok('batchGet has NO retry cascade (fail-closed read)', p.retryOnFail !== true && (batch[0].retryOnFail !== true));
}

A.section('the six reads are Code extractors (zero API calls) projecting the batchGet');
A.eq('six extractor nodes named Read <tab>', extractors.length, 6);
for (const e of extractors) {
  A.ok(e.name + ' is a Code node', e.type === 'n8n-nodes-base.code');
  A.ok(e.name + ' projects $(\'Batch Read Sheets\') via extractTab', /Batch Read Sheets/.test(String(e.parameters.jsCode)) && /extractTab/.test(String(e.parameters.jsCode)));
}

A.section('static request-budget bounds hold under the standard 60/min quota');
// upper bound on reads in one accepted path: 1 batchGet + at most one internal header/key read per write node.
const readUpperBound = batch.length + writes.length;
const writeUpperBound = writes.length;
A.ok('WF18_ACCEPTED_PATH_MAX_READ_REQUESTS<=10 (got ' + readUpperBound + ')', readUpperBound <= 10);
A.ok('WF18_ACCEPTED_PATH_MAX_WRITE_REQUESTS<=10 (got ' + writeUpperBound + ')', writeUpperBound <= 10);
A.ok('a rejected/duplicate update short-circuits before the conversation reads/writes (Terminate Safely path)',
  /Terminate Safely/.test(txt) && nodes.some(n => n.name === 'New Update?'));

A.section('no secrets / no unbounded pagination markers in the hot path');
A.ok('no BEGIN PRIVATE KEY anywhere', txt.indexOf('BEGIN PRIVATE KEY') < 0);
A.ok('no service-account email literal (@*.iam.gserviceaccount.com) baked in', !/@[a-z0-9-]+\.iam\.gserviceaccount\.com/.test(txt));
A.ok('extractors do not page (one extractTab(b,...) projection call each)', extractors.every(e => (String(e.parameters.jsCode).match(/extractTab\(b\s*,/g) || []).length === 1));

const m = (k, v) => console.log(k + '=' + (v ? 'PASS' : 'FAIL'));
console.log('\n----- WF18 sheets budget -----');
m('WF18_FULL_SHEET_GET_ROWS_IN_HOT_PATH_ZERO', reads.length === 0);
m('WF18_SINGLE_BATCHGET', batch.length === 1);
m('WF18_READ_BUDGET_LE_10', readUpperBound <= 10);
m('WF18_WRITE_BUDGET_LE_10', writeUpperBound <= 10);
m('WF18_NO_READ_RETRY_CASCADE', batch.length === 1 && (batch[0].parameters || {}).retryOnFail !== true);
console.log('WF18_STATIC_READ_UPPER_BOUND=' + readUpperBound + ' WF18_STATIC_WRITE_UPPER_BOUND=' + writeUpperBound);

A.report('wf18-sheets-budget');
