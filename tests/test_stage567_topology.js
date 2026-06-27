// test_stage567_topology.js — REAL committed-graph topology audit for Stage 5 (adapters/sources), Stage 6
// (reporting/delivery) and Stage 7 (monitoring/digest). The existing stage5/7 suites are library/fixture tests;
// this asserts the wiring in the actual n8n workflow JSON so a "library exists but is not wired" / "a guard was
// removed" / "a schedule got activated" regression fails CI. Pure + offline ($0, no docker, no network).
'use strict';
const A = require('./_assert');
const path = require('path');

const WF = f => require(path.join(__dirname, '..', 'n8n', 'workflows', f));
const M = require('../config/workflow_manifest.json');
const txt = wf => JSON.stringify(wf);
const types = wf => { const t = {}; (wf.nodes || []).forEach(n => { t[n.type] = (t[n.type] || 0) + 1; }); return t; };
const feeders = wf => { const f = {}; const C = wf.connections || {}; for (const s of Object.keys(C)) (C[s].main || []).forEach(b => (b || []).forEach(x => { (f[x.node] = f[x.node] || []).push(s); })); return f; };

// ===============================================================================================================
A.section('Stage 5 — every runtime workflow is INACTIVE (no source can self-start)');
for (const f of M.deployment.import_order) A.ok(f + ' active=false', WF(f).active === false);

A.section('Stage 5 — source collectors embed their library + enforce the external-actions kill switch');
{
  const vk = WF('26_vk_public_community_collector.json');
  A.ok('WF26 embeds vk_collector', /vk_collector|VK Public Community/i.test(txt(vk)));
  A.ok('WF26 references the MS_ENABLE_VK collector flag', /MS_ENABLE_VK/.test(txt(vk)));
  A.ok('WF26 references the MS_ENABLE_EXTERNAL_ACTIONS kill switch', /MS_ENABLE_EXTERNAL_ACTIONS/.test(txt(vk)));
  A.ok('WF26 is bounded (MS_MAX_* limits)', /MS_MAX_ITEMS_PER_SOURCE|MS_MAX_SOURCES/.test(txt(vk)));
  A.ok('WF26 is a callable sub-workflow (Execute Workflow Trigger)', !!types(vk)['n8n-nodes-base.executeWorkflowTrigger']);
}

A.section('Stage 5 — WF04 has NO direct-SSRF surface (n8n only calls fixed allowlisted API hosts)');
{
  const wf = WF('04_firecrawl_url_list_resilient.json');
  const ALLOWED = ['api.firecrawl.dev', 'aiprimetech.io']; // Firecrawl API + the Claude endpoint host
  const https = (wf.nodes || []).filter(n => n.type === 'n8n-nodes-base.httpRequest');
  A.ok('WF04 has httpRequest nodes', https.length > 0);
  for (const n of https) {
    const url = String((n.parameters && n.parameters.url) || '');
    A.ok(n.name + ' targets a fixed https literal (not an expression to a raw user url)', /^https:\/\//.test(url) && url.indexOf('{{') < 0);
    let host = ''; try { host = new URL(url).host; } catch (e) { void e; }
    A.ok(n.name + ' host is allowlisted (' + host + ')', ALLOWED.indexOf(host) >= 0);
  }
  // the untrusted user URL is a PARAMETER to Firecrawl's API, not a host n8n fetches directly -> no direct SSRF.
  A.ok('WF04 routes the user url through the Firecrawl API (server-side fetch)', /api\.firecrawl\.dev/.test(txt(wf)));
  // the paid Firecrawl call is gated (data_mode/placeholder — the Stage C pattern) rather than fired unconditionally
  A.ok('WF04 gates the paid call (data_mode / placeholder)', /data_mode/.test(txt(wf)) && /placeholder/i.test(txt(wf)));
}

A.section('Stage 5 — the apify candidate-discovery adapter normalizes urls via the url_safety library');
{
  // url_safety.normalizeUrl IS wired where n8n itself handles raw urls (the apify search adapter, WF05). The runtime
  // website source (WF04) delegates fetching to Firecrawl's API, so it needs no direct n8n url-fetch SSRF guard.
  const wf = WF('05_apify_search_candidate_discovery.json');
  A.ok('WF05 (apify search) uses url_safety.normalizeUrl', /normalizeUrl/.test(txt(wf)));
}

A.section('Stage 5 — the kill switch + approval are present across the orchestration graph');
for (const f of ['20_agent_orchestrator.json', '23_scheduled_source_monitor.json', '26_vk_public_community_collector.json']) {
  A.ok(f + ' references MS_ENABLE_EXTERNAL_ACTIONS', /MS_ENABLE_EXTERNAL_ACTIONS/.test(txt(WF(f))));
}
A.ok('WF20 enforces approval + budget before any collection', /Approval & Budget Gate|MS_REQUIRE_APPROVAL/.test(txt(WF('20_agent_orchestrator.json'))));

// ===============================================================================================================
A.section('Stage 6 — WF24 reporting is a callable contract with zlib + document delivery');
{
  const wf = WF('24_report_export_delivery.json');
  A.ok('WF24 active=false', wf.active === false);
  A.ok('WF24 is callable (Execute Workflow Trigger)', !!types(wf)['n8n-nodes-base.executeWorkflowTrigger']);
  A.ok('WF24 uses zlib (XLSX writer)', /zlib/.test(txt(wf)));
  A.ok('WF24 routes attachments (attachment_router / sendDocument)', /attachment_router/.test(txt(wf)) && /sendDocument/.test(txt(wf)));
  A.ok('WF24 chunks long Telegram messages', /chunkMessage|chunk/.test(txt(wf)));
  // SVG must go via sendDocument, never sendPhoto (raster charts may still use sendPhoto — both nodes present is OK)
  A.ok('WF24 has a sendDocument path for documents/SVG', /sendDocument/.test(txt(wf)));
}

// ===============================================================================================================
A.section('Stage 7 — scheduled workflows stay INACTIVE, carry a Schedule Trigger, and are feature-flag gated');
{
  for (const [k, f, flag] of [['WF23', '23_scheduled_source_monitor.json', 'MS_MONITORING_ENABLED'], ['WF25', '25_weekly_digest.json', 'MS_WEEKLY_DIGEST_ENABLED']]) {
    const wf = WF(f);
    A.ok(k + ' active=false (a schedule cannot self-activate)', wf.active === false);
    A.ok(k + ' has a Schedule Trigger', !!types(wf)['n8n-nodes-base.scheduleTrigger']);
    A.ok(k + ' is gated by ' + flag, new RegExp(flag).test(txt(wf)));
  }
  // WF25 weekly digest is STORED-DATA-ONLY (no collector sub-workflow calls) and once-per-ISO-week
  const wd = WF('25_weekly_digest.json');
  A.eq('WF25 makes ZERO Execute Workflow (collector) calls', types(wd)['n8n-nodes-base.executeWorkflow'] || 0, 0);
  A.ok('WF25 enforces one-per-ISO-week (week key)', /ISO|isoWeek|week_key|weekKey|per.?week/i.test(txt(wd)));
  // WF23 monitor calls collectors per the manifest binding edges
  const mon = WF('23_scheduled_source_monitor.json');
  A.ok('WF23 calls collectors via Execute Workflow', (types(mon)['n8n-nodes-base.executeWorkflow'] || 0) >= 1);
}

A.section('Stage 7 — the manifest activation policy gates the schedules (they never activate by default)');
{
  A.ok('WF18 is the only always-on trigger', JSON.stringify(M.trigger_workflows_always) === JSON.stringify(['18_telegram_agent_gateway.json']));
  A.ok('WF23 activates ONLY when monitoring is enabled', (M.trigger_workflows_when_monitoring || []).indexOf('23_scheduled_source_monitor.json') >= 0);
  A.ok('WF25 activates ONLY when the weekly digest is enabled', (M.trigger_workflows_when_weekly_digest || []).indexOf('25_weekly_digest.json') >= 0);
  // the deploy expects ZERO active workflows after an inactive import (the manifest lists none)
  A.eq('expected_active_after_import is empty (no workflow active after import)', (M.deployment.expected_active_after_import || []).length, 0);
}

A.section('Stage 7 — the 13 manifest binding edges include the scheduled-monitor collector calls');
{
  const edges = M.deployment.binding_edges.map(e => e.caller_wf + '->' + e.target_wf);
  A.ok('WF23 -> WF26 (VK) edge present', edges.indexOf('WF23->WF26') >= 0);
  A.ok('WF23 -> WF04 (website) edge present', edges.indexOf('WF23->WF04') >= 0);
  A.eq('binding edge count is 13', M.deployment.binding_edges.length, 13);
}

A.report('stage567-topology');
