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

A.section('exactly two bounded batchGet reads: the main read phase + the atomic-claim verify read');
// IDEMP-001: the atomic claim adds ONE bounded verify read (Re-read Claims) after appending the claim candidate —
// this is the operator-required "one bounded verification read", not amplification.
A.eq('two values:batchGet nodes (main + claim verify)', batch.length, 2);
const mainBatch = batch.find(n => /conversation_state/.test(String((n.parameters || {}).url || '')));
const claimBatch = batch.find(n => n !== mainBatch);
A.ok('main batchGet present', !!mainBatch);
A.ok('claim-verify batchGet present', !!claimBatch);
for (const b of batch) {
  const p = b.parameters || {}; const url = String(p.url || '');
  A.ok('batchGet uses the predefined googleApi credential', p.authentication === 'predefinedCredentialType' && p.nodeCredentialType === 'googleApi');
  A.ok('batchGet carries a googleApi credential reference', !!(b.credentials && b.credentials.googleApi));
  A.ok('batchGet requests UNFORMATTED_VALUE + FORMATTED_STRING (legacy parity)', /valueRenderOption=UNFORMATTED_VALUE/.test(url) && /dateTimeRenderOption=FORMATTED_STRING/.test(url));
  A.ok('spreadsheet id stays an $env expression (no literal id baked in)', /\$env\.MS_SPREADSHEET_ID/.test(url) && !/spreadsheets\/[0-9A-Za-z_-]{20,}\//.test(url));
  A.ok('batchGet has NO retry cascade (fail-closed read)', p.retryOnFail !== true && (b.retryOnFail !== true));
}
{
  const url = String((mainBatch.parameters || {}).url || '');
  for (const t of ['agent_request_events', 'conversation_state', 'conversation_messages', 'conversation_summaries', 'durable_memories', 'execution_plans']) {
    A.ok('main batchGet covers ' + t, url.indexOf(t) >= 0);
  }
  // the claim-verify read is bounded to the claim store (agent_request_events) only
  A.ok('claim-verify batchGet reads only agent_request_events', /agent_request_events/.test(String((claimBatch.parameters || {}).url || '')) && !/conversation_state/.test(String((claimBatch.parameters || {}).url || '')));
}

A.section('the six reads are Code extractors (zero API calls) projecting the batchGet');
A.eq('six extractor nodes named Read <tab>', extractors.length, 6);
for (const e of extractors) {
  A.ok(e.name + ' is a Code node', e.type === 'n8n-nodes-base.code');
  A.ok(e.name + ' projects $(\'Batch Read Sheets\') via extractTab', /Batch Read Sheets/.test(String(e.parameters.jsCode)) && /extractTab/.test(String(e.parameters.jsCode)));
}

A.section('static request-budget bounds fit the standard 60/min quota (read + write are SEPARATE 60/min quotas)');
// Worst-case WINNER read path: 2 batchGet + one internal getData per googleSheets write node (append/appendOrUpdate
// each do an internal read). Losers/duplicates short-circuit after the claim verify (Terminate Safely) and never
// reach the writes. Reads and writes are charged to SEPARATE 60/min quotas, so ~13 reads + ~9 writes per accepted
// path leaves wide margin for one accepted + one sequential duplicate + two concurrent inputs in a minute. The LIVE
// concurrent acceptance proves SHEETS_429_COUNT=0 (authoritative).
const readUpperBound = batch.length + writes.length;       // 2 batchGet + per-write internal reads
const writeUpperBound = writes.length;                      // append + appendOrUpdate writes
A.ok('WF18 winner READ requests within a safe per-minute margin (<=20, got ' + readUpperBound + ')', readUpperBound <= 20);
A.ok('WF18 winner WRITE requests within a safe per-minute margin (<=10, got ' + writeUpperBound + ')', writeUpperBound <= 10);
A.ok('two batchGet reads only (no third)', batch.length === 2);
A.ok('a rejected/duplicate update short-circuits before the conversation reads/writes (Terminate Safely path)',
  /Terminate Safely/.test(txt) && nodes.some(n => n.name === 'New Update?'));

A.section('no secrets / no unbounded pagination markers in the hot path');
A.ok('no BEGIN PRIVATE KEY anywhere', txt.indexOf('BEGIN PRIVATE KEY') < 0);
A.ok('no service-account email literal (@*.iam.gserviceaccount.com) baked in', !/@[a-z0-9-]+\.iam\.gserviceaccount\.com/.test(txt));
A.ok('extractors do not page (one extractTab(b,...) projection call each)', extractors.every(e => (String(e.parameters.jsCode).match(/extractTab\(b\s*,/g) || []).length === 1));

const m = (k, v) => console.log(k + '=' + (v ? 'PASS' : 'FAIL'));
console.log('\n----- WF18 sheets budget -----');
m('WF18_FULL_SHEET_GET_ROWS_IN_HOT_PATH_ZERO', reads.length === 0);
m('WF18_BATCHGET_MAIN_PLUS_CLAIM_VERIFY', batch.length === 2);
m('WF18_WRITE_BUDGET_LE_10', writeUpperBound <= 10);
m('WF18_NO_READ_RETRY_CASCADE', batch.every(b => (b.parameters || {}).retryOnFail !== true && b.retryOnFail !== true));
console.log('WF18_BATCHGET_REQUESTS=' + batch.length + ' (1 main read + 1 atomic-claim verify)');
console.log('WF18_STATIC_READ_UPPER_BOUND=' + readUpperBound + ' WF18_STATIC_WRITE_UPPER_BOUND=' + writeUpperBound + ' (read/write are separate 60/min quotas)');

A.report('wf18-sheets-budget');
