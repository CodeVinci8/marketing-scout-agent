'use strict';
// SOURCE-REUSE-001 — WF04 executes the SAME reuse/collect/refresh decision the planner promised.
//
// The defect this pins against (live: WF04 exec 948 -> WF10 exec 951): a registry hit emitted ONLY a skipped_log
// row and zero data. The planner (WF18/19/20, source_execution_policy) had promised "reuse", the stored snapshot
// was 25 minutes old and accepted, and the user was told "no sources". Planning and execution now share ONE
// decision (decideSourceExecution embedded in Evaluate Dedup), and reuse re-emits the ORIGINAL accepted rows under
// the CURRENT request's lineage — marked, $0, no Firecrawl, no duplicate snapshot/registry/raw rows.
// Offline, deterministic, $0, 0 external calls.
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const LIB = path.join(__dirname, '..', 'n8n', 'lib');
const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
const P = require(path.join(LIB, 'source_execution_policy.js'));
const wf = JSON.parse(fs.readFileSync(path.join(WFD, '04_firecrawl_url_list_resilient.json'), 'utf8'));
const wf16 = JSON.parse(fs.readFileSync(path.join(WFD, '16_source_quality_gate_health_score.json'), 'utf8'));
const node = (n) => wf.nodes.find(x => x.name === n);
const names = wf.nodes.map(n => n.name);

// Production-shaped fixtures: url_registry rows exactly as Build Registry Row writes them, mapped into the policy's
// snapshot shape exactly as Evaluate Dedup maps them.
const NOW = '2026-07-17T12:00:00+03:00';
function regRow(o) {
  return Object.assign({
    source_url: 'https://autolombardn1.ru', normalized_source_url: 'https://autolombardn1.ru',
    last_seen_at: '2026-07-17T10:18:00+03:00', processing_status: 'parsed_success',
    run_id: 'req_1784260795988::website::a1', last_route: 'monitor_queue'
  }, o);
}
function decide(snapshots, extra) {
  return P.decideSourceExecution(Object.assign({ source_url: 'https://autolombardn1.ru', snapshots: snapshots, now: NOW }, extra || {}));
}

A.section('SOURCE-REUSE-001 — the 14 reuse-contract decisions (canonical policy, production row shapes)');
{
  // 1. fresh accepted snapshot -> reuse
  const d1 = decide([regRow({})]);
  A.eq('1. fresh accepted snapshot -> reuse', d1.mode, 'reuse');
  A.ok('1b. reuse carries the original run + collected_at', d1.snapshot.run_id === 'req_1784260795988::website::a1' && d1.snapshot_collected_at !== '');
  // 2. fresh but FAILED snapshot -> not reusable (retry instead)
  const d2 = decide([regRow({ processing_status: 'technical_error' })]);
  A.eq('2. fresh failed snapshot -> collect (never reuse a failure)', d2.mode, 'collect');
  A.eq('2b. and the reason is honest', d2.reason, 'last_attempt_failed');
  // 3. fresh QUARANTINED snapshot -> not reusable
  const d3 = decide([regRow({ processing_status: 'quarantined' })]);
  A.eq('3. fresh quarantined snapshot -> collect', d3.mode, 'collect');
  // 4. stale snapshot -> collect
  const d4 = decide([regRow({ last_seen_at: '2026-06-01T10:00:00+03:00' })]);
  A.eq('4. stale snapshot -> collect', d4.mode, 'collect');
  A.eq('4b. reason=snapshot_stale', d4.reason, 'snapshot_stale');
  // 5. explicit refresh inside the TTL -> refresh (freshness bypassed, nothing else)
  const d5 = decide([regRow({})], { requested_refresh: true });
  A.eq('5. explicit refresh inside TTL -> refresh', d5.mode, 'refresh');
  A.eq('5b. refresh sets force_reprocess', d5.force_reprocess, true);
  // 6. failed previous attempt -> retry (a failure must never poison the source)
  const d6 = decide([regRow({ processing_status: 'failed' })]);
  A.eq('6. failed previous attempt -> collect (retry allowed)', d6.mode, 'collect');
  // 7. different owner -> no reuse (owner isolation whenever rows carry an owner)
  const d7 = decide([regRow({ owner_user_id: '999' })], { owner_user_id: '111' });
  A.eq('7. different owner -> no reuse', d7.mode, 'collect');
  const d7b = decide([regRow({ owner_user_id: '111' })], { owner_user_id: '111' });
  A.eq('7b. same owner -> reuse', d7b.mode, 'reuse');
  // 13/14 (analysis-level) are pinned in WF28's Prepare Analysis via findReusableAnalysis:
  const lt = fs.readFileSync(path.join(LIB, 'llm_telemetry.js'), 'utf8');
  A.ok('13. deterministic_fallback analysis is never reusable', /deterministic_fallback['"]?\)?\s*return/.test(lt.replace(/\n/g, ' ')) || lt.indexOf("=== 'deterministic_fallback') return") >= 0);
  const wf28 = JSON.parse(fs.readFileSync(path.join(WFD, '28_claude_analyst.json'), 'utf8'));
  A.ok('14. valid same-hash analysis reusable for $0 (findReusableAnalysis in WF28)', wf28.nodes.find(n => n.name === 'Prepare Analysis').parameters.jsCode.indexOf('findReusableAnalysis') >= 0);
}

A.section('SOURCE-REUSE-001 — WF04 topology: the reuse branch exists and is $0');
{
  ['Source Health Lookup', 'IF Reuse?', 'Read Reuse Route Rows', 'Build Reuse Records', 'IF Reuse Records OK?',
   'Append Reuse Route Row', 'Build Reuse Health Row', 'Append Reuse source_health']
    .forEach(n => A.ok('has node ' + n, names.indexOf(n) >= 0));
  A.ok('the permanent-dedup IF is gone', names.indexOf('IF Duplicate?') < 0);
  const C = wf.connections;
  const t = (from, i) => (C[from].main[i] || []).map(x => x.node).join(',');
  A.eq('registry -> health -> decision', t('Registry Lookup', 0) + '|' + t('Source Health Lookup', 0), 'Source Health Lookup|Evaluate Dedup');
  A.eq('IF Reuse? true -> readback', t('IF Reuse?', 0), 'Read Reuse Route Rows');
  A.eq('IF Reuse? false -> Firecrawl (collect/refresh)', t('IF Reuse?', 1), 'Build Firecrawl Request');
  A.eq('readback -> alias builder -> guard', t('Read Reuse Route Rows', 0) + '|' + t('Build Reuse Records', 0), 'Build Reuse Records|IF Reuse Records OK?');
  A.eq('reuse failed -> honest skip log', t('IF Reuse Records OK?', 0), 'Append Skipped Log (Duplicate)');
  A.eq('reuse ok -> route row -> inherited health -> loop', t('IF Reuse Records OK?', 1) + '|' + t('Append Reuse Route Row', 0) + '|' + t('Build Reuse Health Row', 0) + '|' + t('Append Reuse source_health', 0),
    'Append Reuse Route Row|Build Reuse Health Row|Append Reuse source_health|Loop Over Items');
  // 11. no Firecrawl call on reuse: nothing on the reuse branch is an httpRequest
  ['Read Reuse Route Rows', 'Build Reuse Records', 'Append Reuse Route Row', 'Build Reuse Health Row', 'Append Reuse source_health']
    .forEach(n => A.ok('11. reuse branch node ' + n + ' makes no HTTP call', (node(n).type || '').indexOf('httpRequest') < 0));
  // 12. no duplicate snapshot / registry / raw rows: the reuse branch reaches none of those appends.
  // The walk stops at Loop Over Items — the next ITERATION (which may legitimately collect another url) is not
  // part of this url's reuse path.
  const reach = new Set(); const q = ['Read Reuse Route Rows'];
  while (q.length) { const n = q.shift(); if (reach.has(n) || n === 'Loop Over Items') continue; reach.add(n); ((C[n] || {}).main || []).forEach(a => (a || []).forEach(x => q.push(x.node))); }
  ['Append url_registry', 'Append competitor_site_snapshots', 'Append raw_market_records', 'Firecrawl Scrape API']
    .forEach(n => A.ok('12. reuse branch never reaches ' + n, !reach.has(n)));
  // the registry read must see EVERY row for the url (first-match returned the OLDEST run)
  A.eq('Registry Lookup returns all matches (freshest run decides)', node('Registry Lookup').parameters.options.returnAllMatches, 'returnAllMatches');
  A.eq('reuse readback returns all matches', node('Read Reuse Route Rows').parameters.options.returnAllMatches, 'returnAllMatches');
}

A.section('SOURCE-REUSE-001 — Evaluate Dedup embeds the canonical policy (no drift) + fail-closed guards');
{
  const c = node('Evaluate Dedup').parameters.jsCode;
  let lib = fs.readFileSync(path.join(LIB, 'source_execution_policy.js'), 'utf8');
  lib = lib.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '').trim();
  const m = c.match(/\/\/ embedded n8n\/lib\/source_execution_policy\.js[^\n]*\n([\s\S]*?)\n\/\/ --- end embedded source_execution_policy ---/);
  A.ok('policy is embedded with markers', !!m);
  A.eq('embedded policy is byte-identical to the canonical lib core', m && m[1].trim(), lib);
  A.ok('decision comes from decideSourceExecution', c.indexOf('decideSourceExecution({') >= 0);
  A.ok('owner scope flows into the decision', /owner_user_id:\s*ownerId/.test(c));
  A.ok('only the three data queues are reusable (skipped_log history is not "saved data")', c.indexOf("REUSABLE_ROUTES = ['monitor_queue', 'content_queue', 'review_queue']") >= 0);
  A.ok("2/3. blocked/quarantined/failed ORIGINAL run is never reused (health gate)", c.indexOf("BAD_HEALTH = ['quarantined', 'failed', 'error', 'invalid', 'excluded']") >= 0);
  A.ok('an unscored original run falls back to collect (fail closed)', c.indexOf("'original_run_unscored'") >= 0);
  A.ok('an ineligible original run falls back to collect', c.indexOf("'original_run_not_eligible'") >= 0);
}

A.section('SOURCE-REUSE-001 — the alias record: current lineage, original truth, explicit markers');
{
  const c = node('Build Reuse Records').parameters.jsCode;
  // 10. current request gets its own lineage
  A.ok('10. run_id is overridden to the CURRENT run', /run_id:\s*str\(ctx\.run_id\)/.test(c) && /source_run_id:\s*str\(ctx\.run_id\)/.test(c));
  // 9. reused snapshot keeps the original timestamp — parsed_at is NOT in the override set
  const overrideBlock = c.slice(c.indexOf('return usable.map'));
  A.ok('9. parsed_at (original collection time) is never overridden', !/parsed_at\s*:/.test(overrideBlock));
  A.ok('9b. created_at is the reuse EVENT time (documented in place)', /created_at:\s*now/.test(overrideBlock));
  // 8. visible to WF10/WF12: the alias row self-describes as live and is appended to the ORIGINAL data route
  A.ok('8. alias row is data_mode=live (WF10 verification gate contract)', /data_mode:\s*'live'/.test(overrideBlock));
  A.ok('markers: parse_method=reused_snapshot + processing_status=reused', /parse_method:\s*'reused_snapshot'/.test(overrideBlock) && /processing_status:\s*'reused'/.test(overrideBlock));
  A.ok('markers: quality_flags gains reused_snapshot', overrideBlock.indexOf("'reused_snapshot'") >= 0 && /quality_flags:/.test(overrideBlock));
  A.ok('never claims fresh collection (preview says reused + $0)', /Reused accepted snapshot/.test(c) && /\$0/.test(c));
  A.ok('readback rows are filtered to the EXACT original run', /str\(r\.run_id\)\s*!==\s*str\(ctx\.original_run_id\)/.test(c));
  A.ok('unusable originals are excluded (failed/quarantined/ineligible)', /BAD_PS/.test(c) && /quarantined/.test(c) && /report_eligible/.test(c));
  A.ok('empty readback fails CLOSED with an honest reason (no fabricated data)', c.indexOf("processing_status: 'reuse_readback_empty'") >= 0 && c.indexOf("route: 'skipped_log'") >= 0);
}

A.section('SOURCE-REUSE-001 — inherited health row (WF10 runs require_source_health=true)');
{
  const c = node('Build Reuse Health Row').parameters.jsCode;
  A.ok('health row re-keyed to the CURRENT run', /source_run_id:\s*str\(ctx\.run_id\)/.test(c));
  A.ok('inherits the ORIGINAL run verdict (copy, not invention)', /ctx\.original_health_row/.test(c));
  A.ok('zero calls / zero cost recorded truthfully', /external_calls:\s*0/.test(c) && /actual_source_cost_usd:\s*0/.test(c) && /'not_applicable'/.test(c));
  A.ok('flagged reused_snapshot + notes name the original run', /reused_snapshot/.test(c) && /original_run_id/.test(c));
  // WF16 must SKIP the pure-reuse run or its "0 fresh records" row overwrites this one (last-wins index)
  const asm = wf16.nodes.find(n => n.name === 'Assemble Run Bundles').parameters.jsCode;
  A.ok('WF16 detects the reuse run (live_source_runs mode=reuse)', /low\(x\.mode\)==='reuse'/.test(asm) && /reuse_skip:true/.test(asm));
  const bsh = wf16.nodes.find(n => n.name === 'Build Source Health').parameters.jsCode;
  A.ok('WF16 emits a skip marker instead of scoring a reuse bundle', /reuse_skip===true/.test(bsh) && /skip_write:true/.test(bsh));
  const ifw = wf16.nodes.find(n => n.name === 'IF Write Result?').parameters.conditions.conditions;
  A.ok('WF16 write gate blocks the skip marker', ifw.some(x => String(x.leftValue).indexOf('skip_write') >= 0));
}

A.section('SOURCE-REUSE-001 — deterministic adapter return + typed outcome');
{
  const C = wf.connections;
  const t = (from, i) => (C[from].main[i] || []).map(x => x.node).join(',');
  A.eq('done-side is serialized (deterministic sub-workflow return)',
    t('Loop Over Items', 0) + '|' + t('Append live_source_runs', 0) + '|' + t('Append agent_requests', 0),
    'Build live_source_runs Row|Build agent_requests Row|Final Summary Output');
  A.ok('Final Summary Output is terminal (it IS the return value on a pure-reuse run)', !C['Final Summary Output']);
  const fin = node('Final Summary Output').parameters.jsCode;
  A.ok('typed execution_mode (reuse|mixed|refresh|collect)', /__execMode/.test(fin) && fin.indexOf("'reuse'") >= 0 && fin.indexOf("'refresh'") >= 0);
  A.ok('typed source_outcome incl. reused_snapshot', fin.indexOf("'reused_snapshot'") >= 0 && fin.indexOf("'collected_with_data'") >= 0 && fin.indexOf("'refreshed_with_data'") >= 0);
  A.ok('original snapshot lineage exposed', /original_snapshot_run_id/.test(fin) && /original_snapshot_collected_at/.test(fin));
  A.ok('$0 is only reported when there were truly 0 paid calls', /firecrawlCalls===0\?0:null/.test(fin));
  const lrow = node('Build live_source_runs Row').parameters.jsCode;
  A.ok('live_source_runs mode=reuse on a pure-reuse run (WF16 skip key)', /pureReuse\?'reuse':'live'/.test(lrow));
  // executable proof of the mode/outcome arithmetic (same expressions as the node)
  function modeOf(written, reused, fc, force) { const pure = (written === 0 && reused > 0 && fc === 0); return pure ? 'reuse' : (reused > 0 ? 'mixed' : (force ? 'refresh' : 'collect')); }
  A.eq('pure reuse -> reuse', modeOf(0, 2, 0, false), 'reuse');
  A.eq('mixed run -> mixed', modeOf(1, 1, 1, false), 'mixed');
  A.eq('forced -> refresh', modeOf(1, 0, 1, true), 'refresh');
  A.eq('plain -> collect', modeOf(1, 0, 1, false), 'collect');
}

A.section('SOURCE-REUSE-001 — planner inputs travel to the executor; the user is told the truth');
{
  const trig = wf.nodes.find(n => (n.type || '').indexOf('executeWorkflowTrigger') >= 0);
  ['owner_user_id', 'source_execution_mode', 'freshness_days'].forEach(k =>
    A.ok('WF04 declares callable input ' + k, trig.parameters.workflowInputs.values.some(v => v.name === k)));
  const wf20 = JSON.parse(fs.readFileSync(path.join(WFD, '20_agent_orchestrator.json'), 'utf8'));
  const call = wf20.nodes.find(n => n.name === 'Run Website Source (WF04)').parameters.workflowInputs.value;
  ['owner_user_id', 'source_execution_mode', 'freshness_days'].forEach(k =>
    A.ok('WF20 passes ' + k + ' to WF04', !!call[k]));
  const normweb = wf20.nodes.find(n => n.name === 'Normalize Website Result').parameters.jsCode;
  A.ok('ADAPTER-RETURN-001: snapshot-shaped return mapped honestly (no fake zeros)', normweb.indexOf('raw.snapshot_id') >= 0);
  // adapter + summary + delivery carry the reuse truth end to end
  const sa = fs.readFileSync(path.join(LIB, 'source_adapter.js'), 'utf8');
  A.ok('adapter exposes execution_mode/source_outcome/original snapshot lineage', /execution_mode: str\(raw\.execution_mode\)/.test(sa) && /original_snapshot_collected_at/.test(sa));
  const es = fs.readFileSync(path.join(LIB, 'execution_summary.js'), 'utf8');
  A.ok('summary lists reused_sources', /reused_sources: adapters/.test(es));
  const cr = fs.readFileSync(path.join(LIB, 'conversation_response.js'), 'utf8');
  A.ok('Telegram delivery states saved data + original collection time + $0', /Использованы сохранённые данные/.test(cr) && /стоимость сбора \$0/.test(cr));
  const CR = require(path.join(LIB, 'conversation_response.js'));
  const body = CR.deliveryBody({ report_markdown: 'Отчёт.' }, {
    final_state: 'completed', records_reported: 2,
    reused_sources: [{ source: 'website', original_run_id: 'req_x::website::a1', original_collected_at: '2026-07-17T10:18:24.931+03:00' }]
  }, []);
  A.ok('deliveryBody renders the reuse line with the real timestamp', body.indexOf('Использованы сохранённые данные') >= 0 && body.indexOf('17.07.2026 10:18') >= 0);
  const body2 = CR.deliveryBody({ report_markdown: 'Отчёт.' }, { final_state: 'completed', records_reported: 2 }, []);
  A.ok('no reuse -> no reuse line (never claims saved data on a fresh collect)', body2.indexOf('сохранённые данные') < 0);
}

A.section('ANALYSIS-REUSE-001 — same evidence, same owner => the paid analysis is reused across requests');
{
  // Live: exec 972 re-analyzed the same snapshot 3h after exec 962 because findReusableAnalysis required
  // analysis_id equality — and ltAnalysisId embeds agent_request_id + source_run_id, new for every request.
  const LT = require(path.join(LIB, 'llm_telemetry.js'));
  const row = (o) => Object.assign({
    analysis_id: 'an_old1', owner_user_id: '111', agent_request_id: 'req_OLD', source_run_id: 'req_OLD::website::a1',
    analysis_type: 'single_source', evidence_package_hash: 'h1', schema_version: 'v1', prompt_version: 'p1',
    structured_result_json: '{"executive_summary_ru":"x"}', quality_status: 'ok', created_at: '2026-07-17T07:21:56.000Z'
  }, o);
  const ctx = { owner_user_id: '111', agent_request_id: 'req_NEW', source_run_id: 'req_NEW::website::a1',
    analysis_type: 'single_source', evidence_package_hash: 'h1', schema_version: 'v1', prompt_version: 'p1' };
  const hit = LT.findReusableAnalysis([row({})], ctx);
  A.ok('cross-REQUEST reuse now matches (same owner+type+hash)', !!hit && hit.analysis.executive_summary_ru === 'x');
  A.ok('the reused result keeps the CURRENT request identity + names its origin', !!hit && hit.analysis_id === LT.ltAnalysisId(ctx) && hit.reused_from_analysis_id === 'an_old1');
  A.eq('different owner -> never reused (isolation)', LT.findReusableAnalysis([row({ owner_user_id: '999' })], ctx), null);
  A.eq('different evidence hash -> fresh call', LT.findReusableAnalysis([row({ evidence_package_hash: 'h2' })], ctx), null);
  A.eq('different analysis_type -> fresh call', LT.findReusableAnalysis([row({ analysis_type: 'comparison' })], ctx), null);
  A.eq('deterministic_fallback -> never reused', LT.findReusableAnalysis([row({ quality_status: 'deterministic_fallback' })], ctx), null);
  A.eq('prompt version moved -> invalidated (quality control)', LT.findReusableAnalysis([row({ prompt_version: 'p0' })], ctx), null);
  A.eq('schema version moved -> invalidated', LT.findReusableAnalysis([row({ schema_version: 'v0' })], ctx), null);
  A.eq('no evidence hash in ctx -> nothing to reuse (fail closed)', LT.findReusableAnalysis([row({})], Object.assign({}, ctx, { evidence_package_hash: '' })), null);
  const newest = LT.findReusableAnalysis([row({ structured_result_json: '{"executive_summary_ru":"old"}', created_at: '2026-07-16T00:00:00Z' }),
    row({ analysis_id: 'an_new1', structured_result_json: '{"executive_summary_ru":"new"}', created_at: '2026-07-17T00:00:00Z' })], ctx);
  A.eq('newest valid analysis wins', newest.analysis.executive_summary_ru, 'new');
  A.ok('a successfully repaired analysis IS reusable (operator decision)', !!LT.findReusableAnalysis([row({ quality_status: 'repaired' })], ctx));
}

A.report('wf04-source-reuse');
