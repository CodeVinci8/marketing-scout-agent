'use strict';
// test_f8_discovery_comparison.js — F-8: the COMBINED discovery + two-source comparison path, end to end,
// OFFLINE ($0, no network, no paid collection). Every existing F-7 test injects two already-distinct sources
// directly; none starts from a DISCOVERY run. F-8 proves the HANDOFF: that genuinely-distinct discovered
// competitor candidates (WF27 output) survive into TWO contributing source identities the router counts as a
// real comparison — and that a discovered pair which is actually one company can NEVER fake a comparison.
//
// It runs the REAL shipped nodes on fixtures, not re-implementations:
//   • WF27 `Classify Candidates` + `Finalize Discovery` + `Shape Candidate Rows` on a fixture Firecrawl search
//     response (no live Firecrawl) → distinct competitor candidate_rows;
//   • those discovered rows mapped into the bundle WF20 `Build Analysis Inputs` consumes → comparison routing;
//   • WF28 `Prepare Analysis` selects the multi-source (synthesis) contract for the pair;
//   • the comparison renders into Telegram + XLSX carrying the DISCOVERED hosts.
//   • negatives: a same-host discovered pair dedups to one candidate; a single discovered competitor DOWNGRADES.
//   • the discovery nodes' embedded libs are byte-identical to n8n/lib/* (the run really is the shipped code).
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const H = require('./wf_harness.js');
const AB = require('../n8n/lib/analysis_bridge.js');
const CR = require('../n8n/lib/compact_report_ru.js');
const AR = require('../n8n/lib/analysis_report_ru.js');

// same extraction the generator uses (strips 'use strict', module.exports AND local cross-requires)
function libCore(name) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  s = s.replace(/^\s*const\s*\{[^}]*\}\s*=\s*require\('\.\/[^']+'\);\s*$/gm, '');
  return s.trim();
}
function extract(code, name) {
  const m = code.match(new RegExp('// embedded n8n/lib/' + name + '\\.js[^\\n]*\\n([\\s\\S]*?)\\n// --- end embedded ' + name + ' ---'));
  return m ? m[1] : null;
}
function nodeCode(wf, name) { const n = wf.nodes.find(x => x.name === name); return n ? n.parameters.jsCode : null; }

const WF27 = H.loadWorkflow('27_competitor_discovery.json');
const WF20 = H.loadWorkflow('20_agent_orchestrator.json');
const WF28 = H.loadWorkflow('28_claude_analyst.json');

const H1 = 'autozalog-msk.ru';   // competitor 1 — автоломбард
const H2 = 'ptsdengi.ru';        // competitor 2 — кредитный брокер

// A fixture Firecrawl `search` response body (the shape parseFirecrawlSearchResults reads): two genuinely
// distinct auto-loan providers + one aggregator that must NOT be classified as a competitor.
function searchBody(results) { return { success: true, data: results }; }
const DISCOVERY_RESULTS = [
  { url: 'https://' + H1 + '/', title: 'АвтоЗалог — автоломбард в Москве',
    description: 'Автоломбард в Москве. Займ под ПТС и залог авто, подбор кредита. Оставьте заявку — бесплатная консультация.' },
  { url: 'https://' + H2 + '/pts', title: 'ПТС Деньги — кредитный брокер, Москва',
    description: 'Кредитный брокер в Москве. Поможем получить кредит под ПТС без предоплаты, одобрение кредита. Оставить заявку.' },
  { url: 'https://vsezaymy-catalog.ru/moskva', title: 'Все займы — каталог',
    description: 'Каталог кредитов и займов Москвы. Рейтинг банков, сравнение кредитных ставок — все банки в одном месте.' }
];

// Run the REAL WF27 discovery nodes on a fixture search response. No Firecrawl, no validation scrape ($0).
function runDiscovery(results) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [{ default_region: 'Москва/МО', source_allowlist: ['website', 'telegram', 'vk'] }]);
  H.inject(run, 'Read tracked_sources', []);
  H.inject(run, 'Build Discovery Queries', [{
    chat_id: '219246148', owner_user_id: '219246148', query_region: 'Москва',
    discovery_run_id: 'disc_f8', agent_request_id: 'req_f8',
    query_meta: { platform_target: 'website', query_text: 'кредит под ПТС Москва', product: 'pts_loan' }
  }]);
  H.inject(run, 'Select Validation Targets', []);   // no validation pass (offline, $0)
  H.inject(run, 'Firecrawl Scrape', []);
  H.runCodeNode(run, WF27, 'Classify Candidates', [{ json: searchBody(results) }]);
  H.runCodeNode(run, WF27, 'Finalize Discovery', []);
  const rows = H.runCodeNode(run, WF27, 'Shape Candidate Rows', []).map(i => i.json);
  return { finalize: run.outputs['Finalize Discovery'][0].json, rows: rows };
}

// Map DISCOVERED competitor candidate rows into the bundle shape WF20 `Build Analysis Inputs` consumes. This is
// the handoff a later analysis run performs: a discovered candidate becomes a tracked source, collection yields
// a competitor row keyed by the same source_url. Note both rows carry the SAME source_run_id (the discovery
// run) — a genuine two-source comparison must survive that shared batch id (BRIDGE-IDENTITY-001).
function bundleFromDiscovery(compRows) {
  return {
    competitors: compRows.map(r => ({ competitor: r.display_name, source_url: r.source_url, source_run_id: r.source_run_id, quality: 'accepted', positioning: String(r.evidence_excerpt || '').slice(0, 120) })),
    offers: compRows.map((r, i) => ({ competitor: r.display_name, evidence_url: r.source_url, offer: 'займ под ПТС', price_rate: 'от 2,' + (i + 4) + '%', cta: 'оставить заявку', source_run_id: r.source_run_id })),
    evidence: compRows.map((r, i) => ({ competitor: r.display_name, url: r.source_url, excerpt: 'ставка от 2,' + (i + 4) + '% в месяц', evidence_id: 'disc_ev_' + i, source_run_id: r.source_run_id })),
    source_quality: compRows.map(r => ({ source: r.normalized_key.replace('website::', ''), status: 'healthy', source_run_id: r.source_run_id })),
    niche: 'credit_brokerage', region: 'Москва/МО', report_id: 'report_f8'
  };
}

// Run the REAL WF20 `Build Analysis Inputs` node on a bundle (same driving pattern as test_f7_routing_nodes).
function buildInputs(bundle, planMode) {
  const run = H.makeRun();
  H.inject(run, 'Approval & Budget Gate', [{
    cfg: { enable_claude: true, enable_llm_analysis: true, llm_max_analyses_per_run: 5 },
    plan: { niche: 'credit_brokerage', region: 'Москва/МО', analysis_mode: planMode, sources: ['website'] },
    request: { agent_request_id: 'req_f8', owner_user_id: '219246148', chat_id: '219246148', data_mode: 'live' },
    idempotency_key: 'req_f8::website'
  }]);
  H.inject(run, 'Run WF12 Report', [{ report_id: 'report_f8', report_bundle: JSON.stringify(bundle) }]);
  H.inject(run, 'Resolve Collection Set', [{}]);
  return H.runCodeNode(run, WF20, 'Build Analysis Inputs', [])[0].json;
}

// Run the REAL WF28 `Prepare Analysis` node on a shaped target.
function prep28(t) {
  const run = H.makeRun();
  run.env = { MS_ENABLE_CLAUDE: 'true', MS_ENABLE_LLM_ANALYSIS: 'true' };
  H.inject(run, 'Read llm_analysis_results', []);
  const payload = {
    agent_request_id: t.agent_request_id, source_run_id: t.source_run_id, report_id: t.report_id,
    owner_user_id: t.owner_user_id, chat_id: t.chat_id, analysis_type: t.analysis_type,
    evidence_input: t.evidence_input, niche: t.niche, region: t.region
  };
  H.inject(run, 'When Called by Agent', [payload]);
  return H.runCodeNode(run, WF28, 'Prepare Analysis', [{ json: payload }])[0].json;
}

// ============================================================================================================
A.section('F-8 · discovery yields TWO genuinely-distinct competitors (real WF27 nodes, fixture search, $0)');
const disc = runDiscovery(DISCOVERY_RESULTS);
{
  const rows = disc.rows;
  const comps = rows.filter(r => r.is_competitor === true);
  A.eq('two competitor candidates discovered', comps.length, 2);
  A.ok('the aggregator is NOT a competitor', rows.some(r => /vsezaymy-catalog\.ru/.test(r.normalized_key) && r.is_competitor !== true && r.is_news_or_aggregator === true));
  const keys = comps.map(c => c.normalized_key);
  A.eq('the two competitors have DISTINCT normalized keys', new Set(keys).size, 2);
  const hosts = comps.map(c => c.normalized_key.replace('website::', ''));
  A.ok('both discovered hosts are present', hosts.indexOf(H1) >= 0 && hosts.indexOf(H2) >= 0);
  A.ok('every competitor row carries a citable evidence excerpt', comps.every(c => String(c.evidence_excerpt || '').length > 0));
  A.eq('finalize reports two competitors', disc.finalize.competitor_count, 2);
}

A.section('F-8 · the discovered pair routes to a REAL two-source comparison (real WF20 Build Analysis Inputs)');
const compRows = disc.rows.filter(r => r.is_competitor === true);
{
  const bundle = bundleFromDiscovery(compRows);
  const o = buildInputs(bundle, 'comparison');
  A.ok('analysis will run', o.do_analyze);
  A.eq('mode is comparison', o.analysis_mode, 'comparison');
  A.eq('exactly TWO contributing sources (shared discovery run id did NOT collapse them)', o.contributing_sources, 2);
  A.ok('not downgraded — this is a genuine comparison', !o.analysis_mode_downgraded);
  A.eq('exactly ONE multi-source WF28 call', o.targets.length, 1);
  A.eq('target is multi', o.targets[0].source_kind, 'multi');
  A.eq('target carries the comparison mode', o.targets[0].analysis_type, 'comparison');
  const pkg = JSON.parse(o.targets[0].evidence_input);
  A.eq('multi package schema', pkg.schema, 'evidence_package.multi.v1');
  A.eq('two sources in the package', pkg.sources.length, 2);
  A.ok('each source keeps its own evidence ids', pkg.sources.every(s => (s.evidence_ids || []).length > 0));
}

A.section('F-8 · discovery identity SURVIVES the handoff (discovered host === routed source id)');
{
  const bundle = bundleFromDiscovery(compRows);
  const o = buildInputs(bundle, 'comparison');
  const pkg = JSON.parse(o.targets[0].evidence_input);
  const pkgIds = pkg.sources.map(s => s.source_id).sort();
  // The router counts DISTINCT sources by the bridge's abSourceId — the same identity discovery keyed on. If
  // these two disagreed, a discovered pair could either be silently merged (lost comparison) or split (faked).
  const bridgeIds = compRows.map(r => AB.abSourceId(r.source_url, r.display_name)).sort();
  A.eq('bridge derives one id per discovered competitor', new Set(bridgeIds).size, 2);
  A.ok('the routed package source ids ARE the bridge ids of the discovered rows', JSON.stringify(pkgIds) === JSON.stringify(bridgeIds));
  A.ok('both discovered hosts appear as package sources', pkgIds.indexOf(H1) >= 0 && pkgIds.indexOf(H2) >= 0);
}

A.section('F-8 · WF28 Prepare selects the multi-source contract for the discovered pair');
{
  const o = buildInputs(bundleFromDiscovery(compRows), 'comparison');
  const prep = prep28(o.targets[0]);
  A.eq('mode reached WF28', prep.ctx.analysis_type, 'comparison');
  A.ok('recognised as multi-source', prep.multi_source);
  A.eq('call decided', prep.mode, 'call');
  const body = JSON.stringify(prep.claude_body);
  A.ok('multi-source (synthesis) tool selected', body.indexOf('submit_synthesis') > 0);
  A.ok('single-source tool NOT selected', body.indexOf('submit_analysis') < 0);
  A.eq('source scope marks multi', prep.ctx.source_scope.kind, 'multi');
  A.eq('two sources carried into the call', prep.ctx.source_scope.source_count, 2);
}

A.section('F-8 · the comparison RENDERS carrying the discovered hosts (Telegram + XLSX, deterministic fixture)');
{
  // A deterministic comparison result over the two DISCOVERED sources (no Claude call). Its evidence_map is the
  // multi package's map that travels back on WF28's typedReturn — this is what resolves ev_N to real URLs.
  const COMPARISON = {
    enriched: true, quality_status: 'ok', mode: 'call', source: { source_id: 'multi' },
    evidence_map: [
      { id: 'ev_1', url: 'https://' + H1, type: 'website', excerpt: 'займ под ПТС', fact_type: 'positioning', collected_at: '2026-07-24T10:00:00+03:00', quality_status: 'accepted' },
      { id: 'ev_2', url: 'https://' + H1, type: 'website', excerpt: 'от 2,4%', fact_type: 'offer', collected_at: '2026-07-24T10:00:00+03:00', quality_status: 'accepted' },
      { id: 'ev_3', url: 'https://' + H2, type: 'website', excerpt: 'без предоплаты', fact_type: 'positioning', collected_at: '2026-07-24T10:00:05+03:00', quality_status: 'accepted' },
      { id: 'ev_4', url: 'https://' + H2, type: 'website', excerpt: 'одобрение кредита', fact_type: 'offer', collected_at: '2026-07-24T10:00:05+03:00', quality_status: 'accepted' }
    ],
    analysis: {
      overview_ru: 'В пакете 2 источника (' + H1 + ', ' + H2 + ') — оба московских игрока. Достаточно для сравнения двух игроков, не всего рынка.',
      comparisons: [
        { aspect: 'positioning', text_ru: H1 + ' — автоломбард (залог авто) [ev_1]; ' + H2 + ' — брокер (без предоплаты) [ev_3].', evidence_ids: ['ev_1', 'ev_3'] },
        { aspect: 'prices', text_ru: H1 + ' декларирует ставку [ev_2]; ' + H2 + ' продаёт одобрение [ev_4].', evidence_ids: ['ev_2', 'ev_4'] }
      ],
      recurring_pains_ru: ['непрозрачные условия'],
      opportunities: [{ text_ru: 'Прозрачный калькулятор ставки [ev_1]', evidence_ids: ['ev_1'] }],
      recommended_experiments: [{ text_ru: 'A/B тест лендинга', priority: 'medium', evidence_ids: ['ev_1'] }],
      used_evidence_ids: ['ev_1', 'ev_2', 'ev_3', 'ev_4']
    }
  };
  const noEvLeak = s => !/\bev_\d+\b/.test(String(s == null ? '' : s));

  const tg = CR.crCompactReportRu({ bundle: { analysis_mode: 'comparison' }, analyses: [COMPARISON], summary: { records_reported: 4, final_state: 'completed' }, cost_line: '💰 $0.06', xlsx_expected: true });
  A.eq('Telegram profile is multi', tg.profile, 'multi');
  A.ok('Telegram shows the comparison section', tg.text.indexOf('⚖️ Сравнение источников') >= 0);
  A.ok('Telegram names BOTH discovered hosts', tg.text.indexOf(H1) >= 0 && tg.text.indexOf(H2) >= 0);
  A.ok('no raw ev_N id leaks to Telegram', noEvLeak(tg.text));

  const x = AR.analysisXlsxData([COMPARISON]);
  A.eq('two comparison rows in the workbook', x.comparisons.length, 2);
  A.ok('no raw ev_N id leaks into comparison text', x.comparisons.every(c => noEvLeak(c.text)));
  A.eq('two evidence rows (one per discovered source URL)', x.evidence.length, 2);
  A.ok('evidence resolves to BOTH discovered hosts', x.evidence.some(e => new RegExp(H1).test(e.url)) && x.evidence.some(e => new RegExp(H2).test(e.url)));
}

A.section('F-8 · a discovered pair that is really ONE company can NOT fake a comparison (dedup at discovery)');
{
  // Same host, different spellings/paths (www + a deep path). Discovery keys websites by canonical host, so the
  // two collapse to ONE candidate — a same-company pair can never even REACH the router as two sources.
  const dup = runDiscovery([
    { url: 'https://' + H1 + '/', title: 'АвтоЗалог', description: 'Автоломбард в Москве. Займ под ПТС, подбор кредита. Оставьте заявку.' },
    { url: 'https://www.' + H1 + '/pts-zaim', title: 'АвтоЗалог — ПТС', description: 'Автоломбард. Займ под ПТС без предоплаты, одобрение кредита. Оставить заявку.' }
  ]);
  const hostRows = dup.rows.filter(r => r.normalized_key.replace('website::', '') === H1);
  A.eq('the same-host pair dedups to ONE candidate', hostRows.length, 1);
}

A.section('F-8 · a SINGLE discovered competitor requested as comparison is DOWNGRADED, never faked');
{
  const single = runDiscovery([DISCOVERY_RESULTS[0], DISCOVERY_RESULTS[2]]);   // one competitor + one aggregator
  const singleComp = single.rows.filter(r => r.is_competitor === true);
  A.eq('exactly one discovered competitor', singleComp.length, 1);
  const o = buildInputs(bundleFromDiscovery(singleComp), 'comparison');
  A.eq('downgraded to single-source', o.analysis_mode, 'source_analysis');
  A.ok('downgrade flagged for audit', o.analysis_mode_downgraded);
  A.eq('requested mode kept', o.analysis_mode_requested, 'comparison');
  A.ok('a Russian downgrade reason is available to the renderer', String(o.analysis_mode_reason_ru || '').length > 0);
  A.ok('target is NOT multi', o.targets[0].source_kind !== 'multi');
  A.eq('target follows the resolved single-source mode', o.targets[0].analysis_type, 'source_analysis');
}

A.section('F-8 · the WF27 discovery nodes really run the SHIPPED libs (embedded === n8n/lib, byte-identical)');
{
  const classify = nodeCode(WF27, 'Classify Candidates');
  const finalize = nodeCode(WF27, 'Finalize Discovery');
  ['discovery_query', 'candidate_classifier', 'tracked_sources'].forEach(name => {
    const emb = extract(classify, name);
    A.ok('Classify Candidates embeds ' + name, emb != null);
    A.ok(name + ' embedded in Classify Candidates is byte-identical to the library', emb === libCore(name));
  });
  const embCC = extract(finalize, 'candidate_classifier');
  A.ok('Finalize Discovery embeds candidate_classifier', embCC != null);
  A.ok('candidate_classifier embedded in Finalize Discovery is byte-identical to the library', embCC === libCore('candidate_classifier'));
}

A.report('f8-discovery-comparison');
