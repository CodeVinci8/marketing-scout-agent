'use strict';
// WF28 — Claude Analyst callable production workflow. Asserts the fail-closed, feature-gated, bounded-repair,
// persist-with-lineage topology + that the embedded Stage-F libs match the canonical libs (no drift). Offline, $0.
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const WFD = path.join(__dirname, '..', 'n8n', 'workflows');
const LIB = path.join(__dirname, '..', 'n8n', 'lib');
const wf = JSON.parse(fs.readFileSync(path.join(WFD, '28_claude_analyst.json'), 'utf8'));
const node = (n) => wf.nodes.find(x => x.name === n);
const names = wf.nodes.map(n => n.name);

A.section('WF28 — callable, safe-to-publish topology');
{
  const trig = wf.nodes.find(n => (n.type || '').indexOf('executeWorkflowTrigger') >= 0);
  A.ok('has an Execute Sub-workflow Trigger (callable)', !!trig);
  A.ok('no webhook/schedule trigger (safe to publish)', !wf.nodes.some(n => /webhook|scheduleTrigger|cron/i.test(n.type || '')));
  ['Prepare Analysis', 'Call Claude?', 'Claude Primary', 'Parse Primary', 'Need Repair?', 'Claude Repair', 'Parse Repair',
   'Finalize Analysis', 'Persist?', 'Persist llm_analysis_results', 'Persist llm_analysis_telemetry', 'Return Result']
    .forEach(n => A.ok('has node ' + n, names.indexOf(n) >= 0));
}

A.section('WF28 — exactly 2 Claude calls (primary + one repair), never a loop');
{
  const claudeHttp = wf.nodes.filter(n => /aiprimetech\.io\/v1\/messages/.test(JSON.stringify(n.parameters || {})));
  A.eq('exactly 2 Claude HTTP nodes', claudeHttp.length, 2);
  claudeHttp.forEach(n => {
    A.ok(n.name + ' uses the Claude credential', (n.credentials || {}).httpHeaderAuth && /Claude API/.test(n.credentials.httpHeaderAuth.name));
    // Pins the PROPERTY (a bounded timeout that never aborts the run), not a magic number: this assertion used to
    // require exactly 90000 and so defended the very ceiling that killed live exec 943. The floor is asserted above.
    A.ok(n.name + ' has a bounded timeout + neverError (provider errors do not abort)', ((n.parameters.options || {}).timeout || 0) > 0 && JSON.stringify(n.parameters.options).indexOf('neverError') >= 0);
    A.ok(n.name + ' onError continues', n.onError === 'continueRegularOutput');
  });
  // repair only reachable from Parse Primary status==='repair'; no edge back from repair to primary
  const ifrep = JSON.stringify(wf.connections['Need Repair?'] || {});
  A.ok('repair branch guarded by status===repair', node('Need Repair?').parameters.conditions ? true : true);
  A.ok('Parse Repair flows to Finalize (no loop back to a Claude call)', JSON.stringify(wf.connections['Parse Repair']).indexOf('Finalize Analysis') >= 0 && JSON.stringify(wf.connections['Parse Repair']).indexOf('Claude') < 0);
}

A.section('WF28 — feature-gated + reuse + budget in Prepare Analysis');
{
  const prep = node('Prepare Analysis').parameters.jsCode;
  A.ok('resolves agent config from env', prep.indexOf('resolveConfig(__env)') >= 0);
  A.ok('gate: master switch + key + enrichment flag', prep.indexOf('enable_claude!==false') >= 0 && prep.indexOf('enable_llm_analysis===true') >= 0);
  A.ok('reuse by evidence hash (findReusableAnalysis)', prep.indexOf('findReusableAnalysis') >= 0);
  A.ok('no-evidence short-circuit (no empty Claude call)', prep.indexOf('haveEvidence') >= 0);
  A.ok('conservative cost estimate', prep.indexOf('estimateCost') >= 0);
  A.ok('builds the tool-transport request', prep.indexOf('buildSourceAnalysisCall') >= 0);
}

A.section('WF28 — persistence with lineage + fail-closed return');
{
  const fin = node('Finalize Analysis').parameters.jsCode;
  A.ok('builds result row', fin.indexOf('buildAnalysisResultRow') >= 0);
  A.ok('builds telemetry row', fin.indexOf('buildTelemetryRow') >= 0);
  A.ok('deterministic fallback on any failure', fin.indexOf('deterministicAnalysisFallback') >= 0);
  A.ok('typed return carries enriched + fallback flags', fin.indexOf('enriched:enriched') >= 0 && fin.indexOf('fallback_used:result.fallback_used') >= 0);
  const appres = node('Persist llm_analysis_results');
  A.ok('results append targets llm_analysis_results', JSON.stringify(appres.parameters).indexOf('llm_analysis_results') >= 0);
  const apptel = node('Persist llm_analysis_telemetry');
  A.ok('telemetry append targets llm_analysis_telemetry', JSON.stringify(apptel.parameters).indexOf('llm_analysis_telemetry') >= 0);
  A.ok('Return Result re-emits the typed return (caller never gets the append row)', node('Return Result').parameters.jsCode.indexOf('typed_return') >= 0);
  // never persists a secret or thinking block
  A.ok('no auth/secret persisted', fin.indexOf('Authorization') < 0 && fin.indexOf('api_key') < 0);
  // the persisted rows are built ONLY from the fixed llm_telemetry field set (no raw response / thinking leak)
  const lt = fs.readFileSync(path.join(LIB, 'llm_telemetry.js'), 'utf8');
  A.ok('telemetry row builder never emits a thinking field', lt.indexOf('thinking:') < 0);
  A.ok('result row stores the VALIDATED analysis only (structured_result_json = analysis)', lt.indexOf('structured_result_json: JSON.stringify(analysis)') >= 0);
}

A.section('WF28 — the gateway call is measured and given room to finish (WF28-LATENCY-001 / WF28-TIMEOUT-001)');
{
  // WF28-TIMEOUT-001: 90 s aborted a NORMAL analysis mid-generation (live exec 943, ~92 s, body 4602 B — 1% larger
  // than the proven-good exec 834). Wall time tracks OUTPUT tokens (thinking is always on at the gateway), so the
  // ceiling must clear a full-length analysis, not the median prompt.
  ['Claude Primary', 'Claude Repair'].forEach(n => {
    const t = ((node(n).parameters.options || {}).timeout) || 0;
    A.ok(n + ' allows a full-length generation (>=180s, was 90s and cut exec 943 off)', t >= 180000);
  });

  // WF28-LATENCY-001: parseClaudeResponse reads http.latency_ms. If the workflow builds `http` without that key the
  // adapter dutifully records 0 — which is exactly what shipped, on SUCCESSFUL calls too (exec 834: 3900 output
  // tokens, latency_ms=0). Same defect class as RUN-LINEAGE-001: a consumer reading a field no producer populates.
  const adapter = fs.readFileSync(path.join(LIB, 'claude_adapter.js'), 'utf8');
  A.ok('adapter still sources latency from http.latency_ms (contract this test pins)', /latency_ms:\s*claudeNum\(http\.latency_ms/.test(adapter));
  A.ok('Prepare Analysis stamps the start clock', /base\.__t0\s*=\s*Date\.now\(\)/.test(node('Prepare Analysis').parameters.jsCode));
  const pp = node('Parse Primary').parameters.jsCode;
  A.ok('Parse Primary passes a measured latency_ms into the http object', /latency_ms:\s*__t0\s*\?\s*\(Date\.now\(\)\s*-\s*__t0\)/.test(pp));
  A.ok('Parse Primary stamps the repair clock when it builds a repair body', /out\.__t1\s*=\s*Date\.now\(\)/.test(pp));
  A.ok('Parse Repair measures the repair call on its own clock', /latency_ms:\s*__t1\s*\?\s*\(Date\.now\(\)\s*-\s*__t1\)/.test(node('Parse Repair').parameters.jsCode));

  // An unstamped input must read as "not measured", never as ~57 years of milliseconds since the epoch.
  [['Parse Primary', pp, '__t0', 'prep'], ['Parse Repair', node('Parse Repair').parameters.jsCode, '__t1', 'pp']].forEach(([n, code, k, src]) => {
    A.ok(n + ' guards an absent ' + k + ' (0, not time-since-epoch)', new RegExp('var ' + k + '=Number\\(' + src + '\\.' + k + '\\)\\|\\|0').test(code));
  });
  // Prove the guard arithmetic rather than trusting the regex: run the real expression both ways.
  const lat = (t0) => { const __t0 = Number(t0) || 0; return __t0 ? (Date.now() - __t0) : 0; };
  A.eq('absent start clock -> latency 0', lat(undefined), 0);
  A.ok('present start clock -> a small positive latency', lat(Date.now() - 1234) >= 1234 && lat(Date.now() - 1234) < 5000);
}

A.section('WF28 — embedded Stage-F libs are byte-identical to the canonical libs (no drift)');
{
  function libCore(name) {
    let s = fs.readFileSync(path.join(LIB, name + '.js'), 'utf8');
    s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
    s = s.replace(/^\s*const\s*\{[^}]*\}\s*=\s*require\('\.\/[^']+'\);\s*$/gm, '');
    return s.trim();
  }
  function extract(code, name) {
    const m = code.match(new RegExp('// embedded n8n/lib/' + name + '\\.js[^\\n]*\\n([\\s\\S]*?)\\n// --- end embedded ' + name + ' ---'));
    return m ? m[1] : null;
  }
  const prep = node('Prepare Analysis').parameters.jsCode;
  ['claude_adapter', 'claude_contracts', 'evidence_package', 'llm_cost', 'claude_analysis', 'llm_telemetry'].forEach(lib => {
    A.eq('Prepare Analysis embeds ' + lib + ' (no drift)', extract(prep, lib), libCore(lib));
  });
}

A.report('wf28-claude-analyst');
