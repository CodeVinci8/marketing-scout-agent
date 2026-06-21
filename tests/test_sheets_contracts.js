'use strict';
// test_sheets_contracts.js — Sheets contract validator + runtime content auditor + before/after request
// verifier + retention policy (Sections 14-18). All offline, read-only, $0. No real Sheet, no network.
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const SA = require('../n8n/lib/sheet_audit.js');
const RP = require('../n8n/lib/retention_policy.js');
const validator = require('../tools/validate_sheet_contracts.js');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sheets_contracts.json'), 'utf8'));

A.section('static validator — contract matches the actual workflows (no undeclared tab/drift)');
const vr = validator.build();
A.eq('validator finds zero contract/workflow drift', vr.failed, 0);
A.ok('contract declares a meaningful number of tabs', Object.keys(CONTRACT.tabs).length >= 30);
A.ok('every declared tab has a known retention class', Object.keys(CONTRACT.tabs).every(t => !!CONTRACT.retention_classes[CONTRACT.tabs[t].retention_class]));
A.ok('phase tabs declared', ['report_bundles', 'attachment_outbox', 'weekly_digests', 'vk_posts', 'vk_post_state'].every(t => !!CONTRACT.tabs[t]));

A.section('runtime auditor — required columns, scope, owner isolation, formula neutralization');
const goodRows = [{ delivery_id: 'att_1', owner_user_id: '100', agent_request_id: 'req_a', report_id: 'rep_1', send_status: 'pending' }];
const okAudit = SA.auditRows('attachment_outbox', goodRows, CONTRACT, { owner_user_id: '100' });
A.ok('clean rows pass', okAudit.ok === true && okAudit.findings.length === 0);
const badRows = [
  { delivery_id: 'att_2', report_id: 'rep_1', send_status: 'pending' },          // missing owner_user_id + agent_request_id
  { delivery_id: 'att_3', owner_user_id: '999', agent_request_id: 'req_a', report_id: 'rep_1', send_status: 'pending' } // foreign owner
];
const badAudit = SA.auditRows('attachment_outbox', badRows, CONTRACT, { owner_user_id: '100' });
A.ok('missing owner scope flagged', badAudit.owner_violations >= 1);
A.ok('missing request scope flagged', badAudit.request_violations >= 1);
A.ok('foreign owner row flagged', badAudit.foreign_rows === 1);
A.ok('audit fails overall', badAudit.ok === false);
// formula injection
A.ok('unsafe formula cell detected', SA.isUnsafeCell('=HYPERLINK("http://x")') === true);
A.ok('neutralized cell is safe', SA.isUnsafeCell("'=HYPERLINK(\"http://x\")") === false);
A.ok('finite negative number is safe (not a formula)', SA.isUnsafeCell('-4.5') === false);
const injAudit = SA.auditRows('vk_posts', [{ source_record_id: 'r1', owner_user_id: '100', owner_id: -42, post_id: 1, canonical_url: 'https://vk.com/wall-42_1', text: '=cmd()' }], CONTRACT, {});
A.ok('injection in a cell flagged', injAudit.injection_cells === 1);
A.ok('undeclared tab flagged by auditor', SA.auditRows('not_a_tab', [{}], CONTRACT, {}).findings[0].kind === 'undeclared_tab');

A.section('before/after request verification — wrote my rows, touched no other request/owner');
const before = { attachment_outbox: [{ delivery_id: 'x', owner_user_id: '100', agent_request_id: 'req_OTHER', report_id: 'rp', send_status: 'sent' }] };
const after = { attachment_outbox: before.attachment_outbox.concat([
  { delivery_id: 'a', owner_user_id: '100', agent_request_id: 'req_a', report_id: 'rep_1', send_status: 'pending' },
  { delivery_id: 'b', owner_user_id: '100', agent_request_id: 'req_a', report_id: 'rep_1', send_status: 'pending' }
]) };
const ver = SA.verifyRequest('attachment_outbox', before.attachment_outbox, after.attachment_outbox, { agent_request_id: 'req_a', owner_user_id: '100', expected_added: 2 });
A.ok('added exactly the expected rows for this request', ver.rows_added_for_request === 2 && ver.added_as_expected === true);
A.ok('no other request rows were touched', ver.foreign_rows_untouched === true);
A.ok('no foreign-owner leak', ver.foreign_owner_leak === false);
A.ok('verification passes', ver.ok === true);
// tampering with another request's rows is caught
const tampered = [{ delivery_id: 'x', owner_user_id: '100', agent_request_id: 'req_OTHER', report_id: 'rp', send_status: 'DELETED' }, { delivery_id: 'a', owner_user_id: '100', agent_request_id: 'req_a', report_id: 'rep_1', send_status: 'pending' }];
const verBad = SA.verifyRequest('attachment_outbox', before.attachment_outbox, tampered, { agent_request_id: 'req_a', owner_user_id: '100' });
A.ok('foreign tampering detected', verBad.foreign_rows_untouched === false && verBad.ok === false);
// owner leak detection
const leak = [{ delivery_id: 'a', owner_user_id: '777', agent_request_id: 'req_a', report_id: 'rep_1', send_status: 'pending' }];
A.ok('owner leak in my own rows detected', SA.verifyRequest('attachment_outbox', [], leak, { agent_request_id: 'req_a', owner_user_id: '100' }).foreign_owner_leak === true);
A.ok('verifyRun aggregates per tab', SA.verifyRun(before, after, { agent_request_id: 'req_a', owner_user_id: '100', expected_added: 2 }).ok === true);

A.section('retention — dry-run by default; deletion only when explicitly enabled');
const NOW = '2026-06-21T00:00:00Z';
const snapshot = {
  // operational tab: one old (eligible), one recent (keep), one active-request (protected)
  raw_market_records: [
    { agent_request_id: 'req_old', created_at: '2026-01-01T00:00:00Z' },
    { agent_request_id: 'req_new', created_at: '2026-06-20T00:00:00Z' },
    { agent_request_id: 'req_live', created_at: '2026-01-01T00:00:00Z' }
  ],
  durable_memories: [{ owner_user_id: '100', created_at: '2024-01-01T00:00:00Z' }],
  telegram_outbox: [
    { delivery_id: 'd1', agent_request_id: 'req_x', send_status: 'sent', created_at: '2026-01-01T00:00:00Z' },
    { delivery_id: 'd2', agent_request_id: 'req_x', send_status: 'pending', created_at: '2026-01-01T00:00:00Z' }
  ],
  tracked_sources: [{ source_id: 's1', owner_user_id: '100', status: 'active', added_at: '2024-01-01T00:00:00Z' }],
  report_bundles: [
    { report_id: 'rep_recent', owner_user_id: '100', agent_request_id: 'r', created_at: '2026-06-10T00:00:00Z' },
    { report_id: 'rep_old', owner_user_id: '100', agent_request_id: 'r', created_at: '2024-01-01T00:00:00Z' }
  ],
  attachment_outbox: [{ delivery_id: 'att_old', owner_user_id: '100', agent_request_id: 'r', report_id: 'rep_old', send_status: 'sent', created_at: '2024-01-01T00:00:00Z' }]
};
const ctx = { now: NOW, recent_report_days: 30, active_request_ids: { req_live: true }, retained_report_ids: { rep_old: false } };
const dry = RP.plan(snapshot, CONTRACT, ctx);
A.ok('dry-run by default', dry.dry_run === true && Object.keys(dry.would_delete).length === 0);
A.ok('old operational row eligible', dry.audit.raw_market_records.eligible.length === 1);
A.ok('active request row protected', dry.audit.raw_market_records.kept >= 2);
A.ok('durable memories never eligible', dry.audit.durable_memories.eligible_count === 0);
A.ok('unsent outbox protected; sent old outbox eligible', dry.audit.telegram_outbox.eligible_count === 1);
A.ok('monitoring baseline (active source) protected', dry.audit.tracked_sources.eligible_count === 0);
A.ok('recent report protected', RP.classifyTab('report_bundles', snapshot.report_bundles, CONTRACT, ctx).eligible.length === 1);
// attachment bound to a RETAINED report must be protected even if old
const ctxRetain = Object.assign({}, ctx, { retained_report_ids: { rep_old: true } });
A.ok('attachment of a retained report is protected', RP.classifyTab('attachment_outbox', snapshot.attachment_outbox, CONTRACT, ctxRetain).eligible_count === 0);

A.section('retention — enable_delete populates would_delete only on explicit opt-in');
const live = RP.plan(snapshot, CONTRACT, ctx, { enable_delete: true });
A.ok('enable_delete is not the default', live.dry_run === false && live.enable_delete === true);
A.ok('would_delete populated only when enabled', Object.keys(live.would_delete).length > 0);
A.ok('undateable rows are never deleted', RP.classifyTab('raw_market_records', [{ agent_request_id: 'x' }], CONTRACT, ctx).eligible_count === 0);

A.report('sheets-contracts');
