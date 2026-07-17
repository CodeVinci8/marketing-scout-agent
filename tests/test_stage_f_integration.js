'use strict';
// STAGE-F-INTEGRATION — WF20 calls WF28 in the real approved-run path.
// Covers: the credential-availability capability (CAP-CLAUDE-001), the deterministic-bundle -> bounded
// evidence_input bridge, the WF20 topology (fail-open convergence), analysis fold-back, and owner isolation.
// Offline, $0, no external calls.
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const CAP = require('../n8n/lib/llm_capability.js');
const AB = require('../n8n/lib/analysis_bridge.js');
const CFG = require('../n8n/lib/agent_config.js');
const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
const node20 = (n) => wf20.nodes.find(x => x.name === n);
const NOW = new Date().toISOString();
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();

A.section('CAP-CLAUDE-001 — credential availability is derived from proof, never from a secret');
{
  // The live shape of a real proven call (WF28 exec 834).
  const proven = [{ created_at: ago(1), provider_request_id: '741925a6-b87e-410f-bf9e-844482f79a97', input_tokens: 7285, output_tokens: 4120, error_category: '' }];
  const c1 = CAP.claudeCapability({}, proven);
  A.eq('a recent provider call proves the bound credential works', c1.available, true);
  A.eq('mode = proven_credential', c1.mode, 'proven_credential');
  A.ok('proof carries its timestamp', !!c1.proof_at);
  // Production reality: no env key, working credential. This is the case the old model got wrong.
  A.eq('no env key + telemetry proof => still available', CAP.claudeCapability({ claude_key_present: false }, proven).available, true);

  const authFail = [{ created_at: ago(1), error_category: 'auth_error' }];
  A.eq('newest call failing auth => unavailable', CAP.claudeCapability({}, authFail).available, false);
  A.eq('mode = auth_failing', CAP.claudeCapability({}, authFail).mode, 'auth_failing');
  // A declaration must NOT override observed auth failure.
  A.eq('observed auth failure beats an operator declaration', CAP.claudeCapability({ claude_credential_declared: true }, authFail).available, false);
  // Newest wins: a later success clears an earlier failure and vice versa.
  A.eq('a later success clears an earlier auth failure',
    CAP.claudeCapability({}, [{ created_at: ago(5), error_category: 'auth_error' }, { created_at: ago(1), provider_request_id: 'r1' }]).available, true);
  A.eq('a later auth failure overrides an earlier success',
    CAP.claudeCapability({}, [{ created_at: ago(5), provider_request_id: 'r1' }, { created_at: ago(1), error_category: 'auth_error' }]).available, false);

  A.eq('a STALE proof proves nothing (the credential may have rotated)', CAP.claudeCapability({}, [{ created_at: ago(90), provider_request_id: 'old' }]).available, false);
  A.eq('no signal at all => unavailable (fail-closed)', CAP.claudeCapability({}, []).available, false);
  A.eq('env key alone => available', CAP.claudeCapability({ claude_key_present: true }, []).available, true);
  A.eq('operator declaration alone => available (weakest signal)', CAP.claudeCapability({ claude_credential_declared: true }, []).mode, 'declared_credential');

  // A schema/validation failure is a MODEL problem — it still proves the credential authenticated.
  A.eq('a validation failure still proves auth works',
    CAP.claudeCapability({}, [{ created_at: ago(1), provider_request_id: 'r9', error_category: 'validation_failed' }]).available, true);
  // A locally-gated row never reached the provider and proves nothing either way.
  A.eq('a disabled/no-evidence row proves nothing', CAP.claudeCapability({}, [{ created_at: ago(1), error_category: 'disabled' }]).available, false);
  A.eq('lkRowOutcome: local gate => unknown', CAP.lkRowOutcome({ error_category: 'no_evidence' }), 'unknown');

  const folded = CAP.withClaudeCapability({ enable_claude: true }, proven);
  A.eq('withClaudeCapability sets claude_available for cost_model', folded.claude_available, true);
  A.eq('withClaudeCapability keeps the original config', folded.enable_claude, true);
  A.ok('withClaudeCapability never leaks a key field', Object.keys(folded).every(k => !/api_key|secret|token/i.test(k)));
}

A.section('WF08-LLM-GATE-001 — the Stage-F rollout does not silently arm the legacy per-record classifier');
{
  const on = CFG.resolveConfig({ MS_ENABLE_CLAUDE: 'true', MS_ENABLE_LLM_ANALYSIS: 'true' });
  A.eq('Stage-F flags enable the WF28 analysis role', on.enable_llm_analysis, true);
  A.eq('WF08 legacy per-record LLM stays OFF by default', on.enable_wf08_llm, false);
  const both = CFG.resolveConfig({ MS_ENABLE_CLAUDE: 'true', MS_ENABLE_LLM_ANALYSIS: 'true', MS_ENABLE_WF08_LLM: 'true' });
  A.eq('WF08 per-record LLM requires its own explicit opt-in', both.enable_wf08_llm, true);
  const master = CFG.resolveConfig({ MS_ENABLE_CLAUDE: 'false', MS_ENABLE_WF08_LLM: 'true' });
  A.eq('the Claude master switch still pins WF08 LLM off', master.enable_wf08_llm, false);
  A.eq('measured Stage-F analysis price is configured', on.cost_claude_analysis_usd, 0.07);
  A.eq('analysis fan-out per run is bounded', on.llm_max_analyses_per_run, 5);

  // WF08-LLM-GATE-001 (the spend-vs-quote gap): cost_model only QUOTES WF08's per-record calls when
  // enable_wf08_llm is set, so WF20 must only ARM them on the same flag. If WF20 kept riding on
  // enable_llm_analysis, an approved Stage-F run would spend ~12 unquoted Claude calls the user never approved.
  const wf08call = wf20.nodes.find(n => n.name === 'Run WF08 Analyzer');
  const llmParam = wf08call.parameters.workflowInputs.value.llm_enabled;
  A.ok('WF20 arms WF08 LLM on enable_wf08_llm', /enable_wf08_llm/.test(llmParam), llmParam);
  A.ok('WF20 does NOT arm WF08 LLM from the Stage-F flag', !/enable_llm_analysis/.test(llmParam), llmParam);
  A.ok('WF08 LLM defaults to OFF in the expression (fail-closed)', /=== true \? 'true' : 'false'/.test(llmParam), llmParam);
}

// A realistic WF12 bundle: one site with positioning + two offers, plus a degraded source.
const bundle = {
  report_id: 'rep_1', agent_request_id: 'req_1', owner_user_id: '1188830082', niche: 'pts_loan', region: 'Москва/МО',
  summary: { quality_status: 'degraded' },
  competitors: [{ competitor: 'Автоломбард №1', positioning: 'Займы под ПТС за 30 минут', score: 0.8, quality: 'accepted', last_checked: NOW, source_url: 'https://autolombardn1.ru/', source_run_id: 'run_a' }],
  offers: [
    { competitor: 'Автоломбард №1', offer: 'Займ под ПТС', price_rate: 'от 3% в месяц', cta: 'Оставить заявку', collected_at: NOW, evidence_url: 'https://autolombardn1.ru/pts' },
    { competitor: 'Автоломбард №1', offer: 'Займ под залог авто', price_rate: 'до 5 млн', collected_at: NOW, evidence_url: 'https://autolombardn1.ru/auto' }
  ],
  evidence: [], source_quality: [{ source: 'autolombardn1.ru', platform: 'website', status: 'degraded' }]
};
const ctx = { agent_request_id: 'req_1', owner_user_id: '1188830082', chat_id: '42', report_id: 'rep_1', niche: 'pts_loan', region: 'Москва/МО', data_mode: 'live', requested_sources: ['website'] };

A.section('bridge — the deterministic bundle becomes ONE bounded evidence_input per logical source');
{
  const r = AB.buildAnalysisTargets(bundle, ctx, {});
  A.eq('one logical source => exactly one WF28 call (never per row)', r.targets.length, 1);
  const t = r.targets[0], ei = t.evidence_input;
  A.eq('source key is the host', t.source_key, 'autolombardn1.ru');
  A.eq('source kind inferred from the URL', t.source_kind, 'website');
  A.eq('current-run facts carry the company', ei.current_run_facts.company_name, 'Автоломбард №1');
  A.eq('current-run facts carry positioning', ei.current_run_facts.positioning, 'Займы под ПТС за 30 минут');
  A.ok('current-run facts summarise offers', ei.current_run_facts.offer_summary.indexOf('Займ под ПТС') >= 0);
  A.ok('current-run facts summarise prices', ei.current_run_facts.prices_terms.indexOf('от 3% в месяц') >= 0);
  A.eq('evidence = positioning + one item per offer', ei.evidence.length, 3);
  A.ok('every evidence item has a URL', ei.evidence.every(e => /^https?:\/\//.test(e.source_url)));
  A.ok('every evidence item has a citable excerpt', ei.evidence.every(e => String(e.excerpt).trim().length > 0));
  A.ok('offer evidence carries price + CTA', ei.evidence.some(e => e.fact_type === 'offer' && /от 3% в месяц/.test(e.excerpt) && /Оставить заявку/.test(e.excerpt)));
  A.ok('degraded source quality is passed as an honest limitation', ei.limitations.some(l => /degraded/.test(l)));
  A.eq('lineage: request', ei.request.agent_request_id, 'req_1');
  A.eq('lineage: source run', ei.source.source_run_id, 'run_a');
  A.eq('deterministic score is handed to the model', ei.deterministic_scores.confidence, 0.8);
  A.eq('requested sources are scoped to this run', ei.request.requested_sources.join(','), 'website');
  A.eq('historical context is separate and empty for a current-run scan', ei.historical_context.length, 0);
  A.eq('reason=ok', r.reason, 'ok');
}

A.section('bridge — never call Claude with nothing to analyze; never explode the fan-out');
{
  A.eq('empty bundle => no targets', AB.buildAnalysisTargets({}, ctx, {}).targets.length, 0);
  A.eq('empty bundle => reason=no_sources', AB.buildAnalysisTargets({}, ctx, {}).reason, 'no_sources');
  const noEv = { competitors: [{ competitor: 'X', positioning: '', source_url: 'https://x.ru' }], offers: [] };
  A.eq('a source with no citable evidence is never sent', AB.buildAnalysisTargets(noEv, ctx, {}).targets.length, 0);
  A.eq('=> reason=no_citable_evidence', AB.buildAnalysisTargets(noEv, ctx, {}).reason, 'no_citable_evidence');
  // Many sources: hard cap applies, richest first.
  const many = { competitors: [], offers: [] };
  for (let i = 0; i < 12; i++) {
    many.competitors.push({ competitor: 'C' + i, positioning: 'p' + i, source_url: 'https://c' + i + '.ru/' });
    for (let j = 0; j <= i; j++) many.offers.push({ competitor: 'C' + i, offer: 'o' + j, evidence_url: 'https://c' + i + '.ru/o' + j });
  }
  const capped = AB.buildAnalysisTargets(many, ctx, { max_targets: 3 });
  A.eq('fan-out is hard-capped', capped.targets.length, 3);
  A.eq('12 sources were considered', capped.considered, 12);
  A.ok('the richest sources are kept', capped.targets.every(t => t.evidence_input.evidence.length > 1));
  A.ok('per-target evidence is bounded', AB.buildAnalysisTargets(many, ctx, { max_targets: 1, max_evidence_per_target: 4 }).targets[0].evidence_input.evidence.length <= 4);
}

A.section('bridge — source kinds are inferred so an analysis knows what it is reading');
{
  A.eq('telegram', AB.abSourceKind('https://t.me/somechannel/12'), 'telegram');
  A.eq('vk', AB.abSourceKind('https://vk.com/club123'), 'vk');
  A.eq('avito', AB.abSourceKind('https://www.avito.ru/moskva/x'), 'avito');
  A.eq('website', AB.abSourceKind('https://autolombardn1.ru/'), 'website');
  A.eq('unknown for an empty url', AB.abSourceKind(''), '');
  A.eq('telegram source id keeps the channel', AB.abSourceId('https://t.me/somechannel/12', ''), 't.me/somechannel');
  A.eq('vk source id keeps the community', AB.abSourceId('https://vk.com/club123?w=1', ''), 'vk.com/club123');
  A.eq('website source id drops www', AB.abSourceId('https://www.finardi.ru/pts', ''), 'finardi.ru');
  const tg = AB.buildAnalysisTargets({ competitors: [{ competitor: 'Канал', positioning: 'текст', source_url: 'https://t.me/chan' }] }, ctx, {});
  A.eq('a telegram source is analyzed as telegram', tg.targets[0].source_kind, 'telegram');
  A.eq('its evidence is typed telegram', tg.targets[0].evidence_input.evidence[0].source_type, 'telegram');
}

A.section('fold-back — WF28 returns become a run-level view (fail-open on every failure mode)');
{
  const rets = [
    { analysis_id: 'an_1', enriched: true, mode: 'call', analysis: { executive_summary_ru: 'x', items: [] }, cost_usd: 0.084, repair_used: true, repair_success: true },
    { analysis_id: 'an_2', enriched: true, mode: 'reuse', analysis: { executive_summary_ru: 'y', items: [] }, cost_usd: 0 },
    { analysis_id: 'an_3', enriched: false, mode: 'call', analysis: {}, cost_usd: 0.02, fallback_used: true }
  ];
  const c = AB.collectAnalyses(rets);
  A.eq('only enriched analyses are surfaced', c.count_enriched, 2);
  A.eq('a fallback never counts as enriched', c.analyses.every(a => a.enriched === true), true);
  A.eq('reuse is counted', c.count_reused, 1);
  A.eq('repairs are counted', c.count_repaired, 1);
  A.eq('fallbacks are counted', c.count_fallback, 1);
  A.eq('real cost is summed from actual usage', c.analysis_cost_usd, 0.104);
  A.eq('every analysis id is kept for lineage', c.analysis_ids.length, 3);
  A.eq('any_enriched', c.any_enriched, true);
  // Failure modes must degrade, never throw.
  A.eq('no returns at all => nothing enriched, $0', AB.collectAnalyses([]).count_enriched, 0);
  A.eq('undefined returns => safe', AB.collectAnalyses(undefined).any_enriched, false);
  A.eq('a crashed child ({} sentinel) is ignored', AB.collectAnalyses([{}, null]).count_total, 0);
  A.eq('all-fallback => any_enriched=false (report stays deterministic)', AB.collectAnalyses([{ analysis_id: 'a', enriched: false, fallback_used: true }]).any_enriched, false);
}

A.section('WF20 topology — WF28 is called per source and NEVER gates the deterministic report');
{
  ['Build Analysis Inputs', 'Analyze Sources?', 'Shape Analysis Targets', 'Run WF28 (Claude Analyst)', 'Merge Analyses']
    .forEach(n => A.ok('has node ' + n, !!node20(n)));
  const c = wf20.connections;
  A.ok('WF12 report flows into the analysis chain', JSON.stringify(c['Run WF12 Report']).indexOf('Build Analysis Inputs') >= 0);
  // Fail-open: BOTH branches of the IF converge on Merge Analyses, so the summary/report/XLSX always run.
  const ifOut = c['Analyze Sources?'].main;
  A.ok('true branch analyzes', JSON.stringify(ifOut[0]).indexOf('Shape Analysis Targets') >= 0);
  A.ok('false branch SKIPS straight to Merge Analyses (report still ships)', JSON.stringify(ifOut[1]).indexOf('Merge Analyses') >= 0);
  A.ok('the analyst feeds Merge Analyses', JSON.stringify(c['Run WF28 (Claude Analyst)']).indexOf('Merge Analyses') >= 0);
  A.ok('Merge Analyses feeds the summary', JSON.stringify(c['Merge Analyses']).indexOf('Build Execution Summary') >= 0);
  A.ok('the summary still reaches delivery', JSON.stringify(c['Build Execution Summary']).indexOf('Build Delivery Outbox') >= 0);

  const call = node20('Run WF28 (Claude Analyst)');
  A.eq('WF28 is called via executeWorkflow', call.type, 'n8n-nodes-base.executeWorkflow');
  A.ok('typeVersion >= 1.2 so workflowInputs are honoured', Number(call.typeVersion) >= 1.2);
  A.eq('a crashed analyst degrades instead of aborting the run', call.onError, 'continueRegularOutput');
  A.eq('an empty analyst return still emits a sentinel', call.alwaysOutputData, true);
  const inputs = call.parameters.workflowInputs.value;
  ['agent_request_id', 'source_run_id', 'report_id', 'owner_user_id', 'chat_id', 'analysis_type', 'evidence_input', 'niche', 'region']
    .forEach(k => A.ok('passes named field ' + k, inputs[k] !== undefined));
  A.eq('analysis_type is the single-source contract', inputs.analysis_type, 'single_source');
  A.ok('owner is propagated (isolation)', /owner_user_id/.test(inputs.owner_user_id));

  const prep = node20('Build Analysis Inputs').parameters.jsCode;
  A.ok('reads the WF12 bundle (bounded, quality-gated facts) — not raw Sheets', prep.indexOf("$('Run WF12 Report')") >= 0);
  A.ok('builds bounded targets via the bridge', prep.indexOf('buildAnalysisTargets') >= 0);
  A.ok('honours the Stage-F rollout gate', prep.indexOf('enable_llm_analysis===true') >= 0 && prep.indexOf('enable_claude!==false') >= 0);
  A.ok('honours the per-run fan-out cap', prep.indexOf('llm_max_analyses_per_run') >= 0);
  A.ok('a source run id is derived per target (lineage + reuse key)', prep.indexOf('source_run_id') >= 0);

  const sum = node20('Build Execution Summary').parameters.jsCode;
  A.ok('the summary reads the report from WF12 BY NAME (analysis can never replace it)', sum.indexOf("$('Run WF12 Report')") >= 0);
  A.ok('the summary folds in the REAL analysis cost', sum.indexOf('claude_analysis_cost_usd') >= 0);
  A.ok('the summary records analysis counts', sum.indexOf('llm_analyses') >= 0);
}

A.section('DELIVERY-CHUNKS-001 — every built chunk is actually sent (chunks 1..N carried the AI analysis)');
{
  // Live exec 956: Build Delivery Outbox built 4 chunks (13.5k chars; the WF28 sections sat in chunks 1-3), the
  // send node consumed only telegram_send_body — chunk 0 — and the user never saw the analysis they paid for.
  const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
  const n20 = (n) => wf20.nodes.find(x => x.name === n);
  const exp = n20('Expand Telegram Chunks');
  A.ok('WF20 has Expand Telegram Chunks', !!exp);
  A.ok('it fans telegram_send_bodies out to one item per chunk', exp.parameters.jsCode.indexOf('telegram_send_bodies') >= 0 && /bodies\.map\(/.test(exp.parameters.jsCode));
  A.ok('fail-safe: an unparsable outbox still delivers chunk 0 (delivery is never blocked)', exp.parameters.jsCode.indexOf("ob.telegram_send_body||'{}'") >= 0);
  const C20 = wf20.connections;
  const t20 = (from) => ((C20[from] || {}).main || [[]])[0].map(x => x.node).join(',');
  A.eq('outbox -> append -> expand -> send', t20('Build Delivery Outbox') + '|' + t20('Append telegram_outbox') + '|' + t20('Expand Telegram Chunks'),
    'Append telegram_outbox|Expand Telegram Chunks|Send Telegram Report');
  A.ok('send node posts $json.telegram_send_body per item', n20('Send Telegram Report').parameters.jsonBody === '={{ $json.telegram_send_body }}');
  // executable proof of the expansion contract (same expressions as the node)
  const ob = { telegram_send_bodies: JSON.stringify([{ chat_id: '1', text: 'a' }, { chat_id: '1', text: 'b' }]), telegram_send_body: JSON.stringify({ chat_id: '1', text: 'a' }) };
  let bodies = []; try { bodies = JSON.parse(ob.telegram_send_bodies || '[]'); } catch (e) { bodies = []; }
  A.eq('2 chunks -> 2 send items', bodies.length, 2);
  let bad = []; try { bad = JSON.parse('not json'); } catch (e) { bad = []; }
  A.eq('parse failure -> [] -> single-body fallback path', bad.length, 0);
}

A.report('stage-f-integration');
