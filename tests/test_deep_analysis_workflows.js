// test_deep_analysis_workflows.js — WF21 (deep analysis) + WF20 reuse node: drift proof + offline harness. $0.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');
const H = require('./wf_harness');

function libCore(name) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  return s.trim();
}
function extract(code, name) {
  const m = code.match(new RegExp('// embedded n8n/lib/' + name + '\\.js[^\\n]*\\n([\\s\\S]*?)\\n// --- end embedded ' + name + ' ---'));
  return m ? m[1] : null;
}

A.section('Deep analysis — Code nodes embed n8n/lib/* with no drift');
const EMBEDS = [
  ['21_deep_competitor_analysis.json', 'Build Deep Plan', ['deep_analysis', 'agent_charter']],
  ['21_deep_competitor_analysis.json', 'Deep Approval & Budget Gate', ['approval_gate', 'agent_state']],
  ['21_deep_competitor_analysis.json', 'Assemble Deep Report', ['deep_analysis']],
  ['21_deep_competitor_analysis.json', 'Build Deep Reply', ['conversation_response']],
  ['20_agent_orchestrator.json', 'Orchestration Reuse Decision', ['orchestration_policy']],
  ['20_agent_orchestrator.json', 'Build Reuse Response', ['conversation_response']]
];
const WFS = {};
for (const [file] of EMBEDS) if (!WFS[file]) WFS[file] = H.loadWorkflow(file);
for (const [file, node, libs] of EMBEDS) {
  const code = WFS[file].nodes.find(n => n.name === node).parameters.jsCode;
  for (const lib of libs) A.eq(file + ' :: ' + node + ' embeds ' + lib + ' (no drift)', extract(code, lib), libCore(lib));
}

// ---- WF21 deep analysis flow ------------------------------------------------------------------------------
const WF21 = WFS['21_deep_competitor_analysis.json'];
const CFG_FULL = { source_allowlist: ['website', 'telegram_channel', 'vk_community'], require_approval: true, max_external_calls: 40, source_budget_usd: 0.20, llm_budget_usd: 0.50, deep_page_limit: 6, max_competitors_deep: 3, config_complete: true };
const TRACKED = [
  { platform: 'telegram_channel', ref: '@cashmotor', status: 'active' },
  { platform: 'vk_community', ref: 'vk.com/cashmotor', status: 'active' }
];
function deepRun(input, opts) {
  opts = opts || {};
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [opts.cfg || CFG_FULL]);
  H.inject(run, 'Read tracked_sources', opts.tracked || TRACKED);
  H.runCodeNode(run, WF21, 'Build Deep Plan', [{ json: input }]);
  const gate = H.runCodeNode(run, WF21, 'Deep Approval & Budget Gate', [])[0].json;
  return { run, gate, plan: H.runCodeNode(run, WF21, 'Build Deep Plan', [{ json: input }])[0].json };
}

A.section('WF21 — approved deep plan passes the gate and degrades gracefully');
const COMPS = [{ company_name: 'CASHMOTOR', root_url: 'https://cashmotor.ru/' }, { company_name: 'CarCapital', root_url: 'https://carcapital.ru/' }];
const d = deepRun({ competitors: COMPS, requested_platforms: ['website', 'telegram_channel', 'vk_community'], request: { agent_request_id: 'req_1', chat_id: '555', state: 'approved', approved: true } });
A.eq('full-scope deep plan tier', d.plan.deep_plan.scope_tier, 'full');
A.eq('deep plan requires approval', d.plan.deep_plan.requires_approval, true);
A.eq('approved deep request passes gate', d.gate.gate_allowed, true);
// assemble: facts vs recommendations
const goodEv = { source_url: 'https://cashmotor.ru/tariffs', source_record_id: 'firecrawl_x::rec1', source_run_id: 'firecrawl_x', excerpt: 'ставка от 0,1%/день', collected_at: '2026-06-21', quality_status: 'healthy', confidence: 0.9 };
const findings = [{ finding_id: 'f_prices_1', dimension: 'prices', type: 'fact', value: 'от 0,1%/день', evidence: goodEv }];
const recs = [{ type: 'recommendation', text: 'снизить ставку', derived_from: ['f_prices_1'], confidence: 0.6 }, { type: 'recommendation', text: 'без обоснования', derived_from: [], confidence: 0.4 }];
H.runCodeNode(d.run, WF21, 'Assemble Deep Report', [{ json: { findings, recommendations: recs } }]);
const reply = H.runCodeNode(d.run, WF21, 'Build Deep Reply', [])[0].json;
A.eq('deep report keeps 1 evidence-backed fact', reply.fact_count, 1);
A.eq('deep report keeps 1 supported recommendation', reply.recommendation_count, 1);
A.ok('deep reply marks ideas as recommendations', /рекомендации, не факты/.test(JSON.parse(reply.telegram_send_body).text));

A.section('WF21 — website-only config reports telegram/vk unavailable honestly + blocks cancelled');
const dWeb = deepRun({ competitors: COMPS, requested_platforms: ['website', 'telegram_channel'], request: { agent_request_id: 'req_2', chat_id: '5', state: 'approved', approved: true } }, { cfg: Object.assign({}, CFG_FULL, { source_allowlist: ['website'] }), tracked: [] });
A.ok('telegram reported unavailable on website-only', dWeb.plan.deep_plan.unavailable_sources.some(u => u.platform === 'telegram_channel'));
A.eq('website-only deep plan tier', dWeb.plan.deep_plan.scope_tier, 'website_only');
const dCancel = deepRun({ competitors: COMPS, requested_platforms: ['website'], request: { agent_request_id: 'req_3', chat_id: '5', state: 'cancelled', approved: false } });
A.eq('cancelled deep request blocked by gate', dCancel.gate.gate_allowed, false);
const blocked = H.runCodeNode(dCancel.run, WF21, 'Build Deep Blocked Reply', [])[0].json;
A.ok('blocked reply explains the reason', /не запущен/i.test(JSON.parse(blocked.telegram_send_body).text));

// ---- WF20 reuse decision ----------------------------------------------------------------------------------
const WF20 = WFS['20_agent_orchestrator.json'];
function reuse(input) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [{ source_allowlist: ['website'], evidence_max_age_days: 7, max_external_calls: 40 }]);
  const dec = H.runCodeNode(run, WF20, 'Orchestration Reuse Decision', [{ json: input }])[0].json;
  const resp = H.runCodeNode(run, WF20, 'Build Reuse Response', [{ json: dec }])[0].json;
  return { dec, resp };
}
A.section('WF20 — follow-up reuses stored evidence instead of recollecting');
const ideas = reuse({ intent: { intent: 'generate_ideas' }, ctx: { last_report_id: 'rep_1', conversation_id: 'conv_1' }, request: { agent_request_id: 'req_1', chat_id: '5' } });
A.eq('generate_ideas => no external call', ideas.dec.needs_external_call, false);
A.eq('reuse decision reason persisted', ideas.dec.orchestration_decision.reason, 'answerable_from_last_report');
A.ok('reuse response tells user no new paid calls', /без новых платных/i.test(JSON.parse(ideas.resp.telegram_send_body).text));
const search = reuse({ intent: { intent: 'competitor_search' }, ctx: {}, request: { agent_request_id: 'req_2', chat_id: '5' } });
A.eq('fresh search => external call needed', search.dec.needs_external_call, true);

A.report('deep-analysis-workflows');
