// test_wf26_vk_enable.js — VK-ENABLE-001 regression on the REAL WF26 "VK Credential Gate" node ($0, no network).
// Two live defects made every VK run fail-closed to setup_required: (1) the per-call `community` input arrives on
// the trigger but the gate read it from the prior node's $json (empty) -> unparseable_vk_ref; (2) the collector
// is env-gated (MS_ENABLE_VK=false) with no way to run an operator-authorized bounded test without an env
// restart. This proves the gate now merges the trigger inputs (community passthrough) AND honors an explicit
// per-call approval to enable the collector, while staying fail-closed for un-approved calls. The token is never
// in the gate — it stays in the n8n credential on the HTTP nodes.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const wf = H.loadWorkflow('26_vk_public_community_collector.json');

// env-disabled config (mirrors MS_ENABLE_VK=false in production)
const cfgDisabled = { enable_vk: false, enable_vk_collector: false, vk_token_present: false, vk_api_version: '5.199' };

function gate(trigger) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [cfgDisabled]);
  H.inject(run, 'When Called by Agent', [trigger]);
  return H.runCodeNode(run, wf, 'VK Credential Gate', [])[0].json;
}

A.section('VK-ENABLE-001 — community passthrough from the trigger');
const g1 = gate({ community: 'https://vk.com/kredit874', agent_request_id: 'req_vk_x', vk_enable_approval: 'VK_LIVE_APPROVED' });
A.ok('identity parsed from trigger community (not empty)', g1.identity && g1.identity.ok === true, JSON.stringify(g1.identity));
A.ok('screen_name resolved to kredit874', g1.identity.screen_name === 'kredit874' || String(g1.identity.ref || g1.identity.screen_name || '').indexOf('kredit874') >= 0, JSON.stringify(g1.identity));

A.section('VK-ENABLE-001 — explicit approval enables the collector (env stays disabled)');
A.ok('configured=true with approval + community', g1.configured === true, JSON.stringify({ cred: g1.credential, ident: g1.identity }));
A.ok('credential ok via approval', g1.credential && g1.credential.ok === true, JSON.stringify(g1.credential));

A.section('VK-ENABLE-001 — fail-closed without approval (env kill-switch preserved)');
const g2 = gate({ community: 'https://vk.com/kredit874', agent_request_id: 'req_vk_x' });
A.ok('configured=false without approval', g2.configured === false);
A.ok('credential setup_required / vk_collector_disabled', g2.credential && g2.credential.ok === false && /disabled|setup/i.test(g2.credential.reason || g2.credential.status || ''), JSON.stringify(g2.credential));

A.section('VK-ENABLE-001 — approval but missing community still fails closed (no blind enable)');
const g3 = gate({ agent_request_id: 'req_vk_x', vk_enable_approval: 'VK_LIVE_APPROVED' });
A.ok('configured=false when community missing', g3.configured === false, JSON.stringify(g3.identity));

A.section('VK-ENABLE-001 — token is never present in the gate output (stays in the credential)');
A.ok('no access_token field on gate output', !('access_token' in g1) && JSON.stringify(g1).toLowerCase().indexOf('access_token') < 0);

A.report('wf26-vk-enable');
