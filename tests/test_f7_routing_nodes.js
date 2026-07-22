'use strict';
// test_f7_routing_nodes.js — F-7 ANALYSIS-ROUTE-001 at the WORKFLOW level.
//
// Runs the REAL generated WF20 `Build Analysis Inputs` and WF28 `Prepare Analysis` Code-node source (not a
// re-implementation) and proves analysis_type now controls EXECUTION, not just the cache key. Uses the fixed
// analysis_bridge (BRIDGE-IDENTITY-001), so assertions are written against DISTINCT contributing sources.
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function wf(file) { let j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', file), 'utf8')); return Array.isArray(j) ? j[0] : j; }
const WF20 = wf('20_agent_orchestrator.json');
const WF28 = wf('28_claude_analyst.json');
const nodeCode = (w, name) => { const n = (w.nodes || []).find((x) => x.name === name); if (!n) throw new Error('missing ' + name); return n.parameters.jsCode; };

function run(code, $json, prior, env) {
  const sandbox = {
    $json: $json,
    $: (name) => ({ first: () => ({ json: prior[name] }), all: () => (prior['__all__' + name] || []).map((j) => ({ json: j })) }),
    $env: env || {}, console: { log: () => {} },
    Date: Date, JSON: JSON, Math: Math, String: String, Number: Number, Object: Object, Array: Array,
    isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, RegExp: RegExp, Error: Error, isFinite: isFinite, Set: Set, Buffer: Buffer
  };
  sandbox.global = sandbox;
  return vm.runInNewContext('(function(){' + code + '})()', sandbox, { timeout: 20000 })[0].json;
}

// N genuinely different competitors, each with its own domain + run id (so the bridge keeps them distinct).
function bundle(n) {
  const competitors = [], evidence = [], offers = [], quality = [];
  for (let i = 0; i < n; i++) {
    const host = 'comp' + i + '.ru';
    competitors.push({ competitor: 'Компания ' + i, source_url: 'https://' + host + '/', source_run_id: 'run' + i, quality: 'accepted', positioning: 'позиционирование ' + i });
    offers.push({ competitor: 'Компания ' + i, evidence_url: 'https://' + host + '/pts', offer: 'займ под ПТС ' + i, price_rate: 'от 2,' + i + '%', cta: 'оставить заявку', source_run_id: 'run' + i });
    evidence.push({ competitor: 'Компания ' + i, url: 'https://' + host + '/pts', excerpt: 'ставка от 2,' + i + '% в месяц', evidence_id: 'b' + i, source_run_id: 'run' + i });
    quality.push({ source: host, status: 'healthy', source_run_id: 'run' + i });
  }
  return { competitors, offers, evidence, source_quality: quality, niche: 'credit_brokerage', region: 'Москва/МО', report_id: 'report_test' };
}

function buildInputs(nSources, planMode) {
  const gate = {
    cfg: { enable_claude: true, enable_llm_analysis: true, llm_max_analyses_per_run: 5 },
    plan: { niche: 'credit_brokerage', region: 'Москва/МО', analysis_mode: planMode, sources: ['website'] },
    request: { agent_request_id: 'req_f7', owner_user_id: '1188830082', chat_id: '1188830082', data_mode: 'live' },
    idempotency_key: 'req_f7::website'
  };
  return run(nodeCode(WF20, 'Build Analysis Inputs'), {}, {
    'Approval & Budget Gate': gate,
    'Run WF12 Report': { report_id: 'report_test', report_bundle: JSON.stringify(bundle(nSources)) },
    'Resolve Collection Set': {}
  });
}
// Exactly ONE contributing source (single competitor; offer & evidence share its identity via run id/domain).
function buildInputsOne(planMode) {
  const b = {
    competitors: [{ competitor: 'Залог 24', source_url: 'https://zalog24h.ru/', source_run_id: 'run0', quality: 'accepted', positioning: 'ценовой якорь' }],
    offers: [{ competitor: 'Залог 24', offer: 'займ под ПТС', price_rate: 'от 2,4%', cta: 'заявка', source_run_id: 'run0' }],
    evidence: [{ competitor: 'Залог 24', url: 'https://zalog24h.ru/pts', excerpt: 'выдача до 90% от рыночной стоимости', evidence_id: 'e0', source_run_id: 'run0' }],
    source_quality: [{ source: 'zalog24h.ru', status: 'healthy', source_run_id: 'run0' }],
    niche: 'credit_brokerage', region: 'Москва/МО', report_id: 'report_one'
  };
  const gate = { cfg: { enable_claude: true, enable_llm_analysis: true, llm_max_analyses_per_run: 5 },
    plan: { niche: 'credit_brokerage', region: 'Москва/МО', analysis_mode: planMode, sources: ['website'] },
    request: { agent_request_id: 'req_one', owner_user_id: '1', chat_id: '1', data_mode: 'live' }, idempotency_key: 'k' };
  return run(nodeCode(WF20, 'Build Analysis Inputs'), {}, {
    'Approval & Budget Gate': gate, 'Run WF12 Report': { report_id: 'report_one', report_bundle: JSON.stringify(b) }, 'Resolve Collection Set': {}
  });
}

function prep28(t, env) {
  return run(nodeCode(WF28, 'Prepare Analysis'), {}, {
    'Read llm_analysis_results': {}, '__all__Read llm_analysis_results': [],
    'When Called by Agent': {
      agent_request_id: t.agent_request_id, source_run_id: t.source_run_id, report_id: t.report_id,
      owner_user_id: t.owner_user_id, chat_id: t.chat_id, analysis_type: t.analysis_type,
      evidence_input: t.evidence_input, niche: t.niche, region: t.region
    }
  }, env || { MS_ENABLE_CLAUDE: 'true', MS_ENABLE_LLM_ANALYSIS: 'true' });
}

A.section('WF20 — one source, source_analysis: single-source, one WF28 call');
{
  const o = buildInputsOne('source_analysis');
  A.ok('analyses', o.do_analyze);
  A.eq('mode', o.analysis_mode, 'source_analysis');
  A.eq('one contributing source (split records consolidated)', o.contributing_sources, 1);
  A.eq('one target', o.targets.length, 1);
  A.ok('target not multi', o.targets[0].source_kind !== 'multi');
  A.eq('target carries the mode', o.targets[0].analysis_type, 'source_analysis');
  A.ok('not downgraded', !o.analysis_mode_downgraded);
}

A.section('WF20 — TWO distinct sources requested as comparison → ONE multi-source package');
{
  const o = buildInputs(2, 'comparison');
  A.eq('mode is comparison', o.analysis_mode, 'comparison');
  A.eq('two contributing sources', o.contributing_sources, 2);
  A.eq('exactly ONE WF28 call', o.targets.length, 1);
  A.eq('target is multi', o.targets[0].source_kind, 'multi');
  A.eq('target analysis_type', o.targets[0].analysis_type, 'comparison');
  const pkg = JSON.parse(o.targets[0].evidence_input);
  A.eq('multi package schema', pkg.schema, 'evidence_package.multi.v1');
  A.eq('two sources in the package', pkg.sources.length, 2);
  A.ok('evidence present', pkg.evidence_items.length >= 2);
  A.eq('evidence ids unique', new Set(pkg.evidence_items.map((e) => e.evidence_id)).size, pkg.evidence_items.length);
  A.ok('each source keeps its own evidence ids', pkg.sources.every((s) => s.evidence_ids.length > 0));
  A.ok('source identity preserved', pkg.sources.map((s) => s.source_id).join(',').indexOf('comp0.ru') >= 0);
  A.ok('source run id preserved', pkg.sources.every((s) => !!s.source_run_id));
  A.eq('mode recorded in the package', pkg.analysis_request.analysis_mode, 'comparison');
}

A.section('WF20 — THREE distinct sources → synthesis');
{
  const o = buildInputs(3, 'synthesis');
  A.eq('mode is synthesis', o.analysis_mode, 'synthesis');
  A.eq('three contributing sources', o.contributing_sources, 3);
  A.eq('one call', o.targets.length, 1);
  const pkg = JSON.parse(o.targets[0].evidence_input);
  A.eq('three sources', pkg.sources.length, 3);
  A.eq('analysis_type', o.targets[0].analysis_type, 'synthesis');
}

A.section('WF20 — one source requested as comparison is DOWNGRADED, never faked');
{
  const o = buildInputsOne('comparison');
  A.eq('downgraded to single-source', o.analysis_mode, 'source_analysis');
  A.ok('downgrade flagged', o.analysis_mode_downgraded);
  A.eq('requested mode kept for audit', o.analysis_mode_requested, 'comparison');
  A.ok('russian reason available to the renderer', (o.analysis_mode_reason_ru || '').length > 0);
  A.ok('target is NOT multi', o.targets[0].source_kind !== 'multi');
  A.eq('target type follows the resolved mode', o.targets[0].analysis_type, 'source_analysis');

  const o2 = buildInputs(2, 'synthesis');
  A.eq('synthesis with 2 sources becomes comparison', o2.analysis_mode, 'comparison');
  A.ok('flagged', o2.analysis_mode_downgraded);
}

A.section('WF28 Prepare — the multi-source package selects the SYNTHESIS call');
{
  const o = buildInputs(2, 'comparison');
  const prep = prep28(o.targets[0]);
  A.eq('mode reached WF28', prep.ctx.analysis_type, 'comparison');
  A.ok('recognised as multi-source', prep.multi_source);
  A.eq('call decided', prep.mode, 'call');
  A.ok('a request body was built', !!prep.claude_body);
  const body = JSON.stringify(prep.claude_body);
  A.ok('synthesis tool selected', body.indexOf('submit_synthesis') > 0);
  A.ok('single-source tool NOT selected', body.indexOf('submit_analysis') < 0);
  A.ok('allowed ids from the multi package', (prep.allowed_ids || []).length >= 2);
  A.ok('package hash present', !!prep.ctx.evidence_package_hash);
  A.eq('source scope marks multi', prep.ctx.source_scope.kind, 'multi');
  A.eq('source count carried', prep.ctx.source_scope.source_count, 2);
}

A.section('WF28 Prepare — single source still uses the single-source contract');
{
  const o = buildInputsOne('source_analysis');
  const prep = prep28(o.targets[0]);
  A.eq('mode', prep.ctx.analysis_type, 'source_analysis');
  A.ok('not multi', !prep.multi_source);
  const body = JSON.stringify(prep.claude_body);
  A.ok('single-source tool selected', body.indexOf('submit_analysis') > 0);
  A.ok('synthesis tool NOT selected', body.indexOf('submit_synthesis') < 0);
}

A.section('WF28 — a comparison LABEL over a single-source package cannot fake a comparison');
{
  const o = buildInputsOne('source_analysis');
  const t = Object.assign({}, o.targets[0], { analysis_type: 'comparison' }); // lie about the mode
  const prep = prep28(t);
  A.eq('falls back to single-source', prep.ctx.analysis_type, 'source_analysis');
  A.ok('not multi', !prep.multi_source);
  A.ok('single-source tool used', JSON.stringify(prep.claude_body).indexOf('submit_analysis') > 0);
}

A.section('cache key separation — the resolved mode is part of the analysis lineage');
{
  const two = buildInputs(2, 'comparison');
  const prepC = prep28(two.targets[0]);
  const one = buildInputsOne('source_analysis');
  const prepS = prep28(one.targets[0]);
  A.eq('comparison analysis_type', prepC.ctx.analysis_type, 'comparison');
  A.eq('single analysis_type', prepS.ctx.analysis_type, 'source_analysis');
  A.ok('different modes => different cache identity', prepC.ctx.analysis_type !== prepS.ctx.analysis_type);
}

A.report('f7-routing-nodes');
