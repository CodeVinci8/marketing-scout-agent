'use strict';
// Stage F core — adapter transport, contracts/validators, evidence package, cost, and the analyze→validate→
// repair→fallback orchestration. Pure/offline: fetchFn is injected, ZERO network, $0. Encodes the REAL
// aiprimetech.io behavior measured in docs/STAGE_F_API_CAPABILITY_MATRIX.md (tool_use is the only transport;
// thinking/text blocks precede tool_use; forced tool choice unreliable; errors 401/429/5xx/400/timeout).
const A = require('./_assert.js');
const AD = require('../n8n/lib/claude_adapter.js');
const CC = require('../n8n/lib/claude_contracts.js');
const EP = require('../n8n/lib/evidence_package.js');
const LC = require('../n8n/lib/llm_cost.js');
const CA = require('../n8n/lib/claude_analysis.js');

// ---- fake gateway responses (mirror measured shapes) --------------------------------------------------------
function okToolResponse(input, extraBlocks) {
  const content = (extraBlocks || []).concat([{ type: 'tool_use', name: 'submit_analysis', input: input }]);
  return { status: 200, latency_ms: 20000, headers: { 'x-request-id': 'rq_1' }, body: { id: 'msg_x', model: 'claude-sonnet-4-6', role: 'assistant', stop_reason: 'tool_use', content: content, usage: { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } };
}
function textResponse(text) { return { status: 200, latency_ms: 18000, headers: {}, body: { id: 'msg_y', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: text }], usage: { input_tokens: 1900, output_tokens: 40 } } }; }
function errResponse(status) { return { status: status, latency_ms: 200, headers: { 'x-request-id': 'rq_e' }, body: { type: 'error', error: { type: 'x', message: 'boom' } } }; }

A.section('adapter — buildToolRequest uses tool_choice:auto + hard submit instruction (measured requirement)');
{
  const b = AD.buildToolRequest({ model: 'claude-sonnet-4-6', system: 'sys', user: 'do it', tool: { name: 'submit_analysis', description: 'd', input_schema: { type: 'object' } }, max_tokens: 2048 });
  A.eq('tool_choice is auto (forced is unreliable on this gateway)', b.tool_choice.type, 'auto');
  A.eq('one tool named submit_analysis', b.tools[0].name, 'submit_analysis');
  A.ok('user message carries a hard "You MUST call" instruction', b.messages[0].content.indexOf('You MUST call the submit_analysis tool') >= 0);
  A.eq('system carried', b.system, 'sys');
}

A.section('adapter — parseClaudeResponse extracts tool_use.input, ignoring thinking/text');
{
  const r = AD.parseClaudeResponse(okToolResponse({ verdict: 'x' }, [{ type: 'thinking', thinking: 't' }, { type: 'text', text: 'preamble' }]), {});
  A.ok('ok', r.ok); A.eq('schema_mode tool_use', r.schema_mode, 'tool_use');
  A.eq('content is the tool input', r.content.verdict, 'x');
  A.eq('stop_reason', r.stop_reason, 'tool_use');
  A.eq('usage parsed', r.usage.input_tokens, 2000);
  A.eq('request_id from header', r.request_id, 'rq_1');
}
A.section('adapter — text-JSON fallback only when there is no tool_use');
{
  const r = AD.parseClaudeResponse(textResponse('here: {"verdict":"competitor","n":2} done'), {});
  A.ok('ok via fallback', r.ok); A.eq('schema_mode text_json', r.schema_mode, 'text_json');
  A.eq('parsed object', r.content.verdict, 'competitor');
  const r2 = AD.parseClaudeResponse(textResponse('no json here'), {});
  A.ok('no structured output => not ok', !r2.ok); A.eq('category', r2.error_category, 'no_structured_output');
}
A.section('adapter — error classification matches measured statuses');
{
  A.eq('401 => auth_error', AD.classifyClaudeError(401, {}), 'auth_error');
  A.eq('429 => rate_limited', AD.classifyClaudeError(429, {}), 'rate_limited');
  A.eq('500 => server_error', AD.classifyClaudeError(503, {}), 'server_error');
  A.eq('400 => bad_request', AD.classifyClaudeError(400, {}), 'bad_request');
  A.eq('0 => timeout', AD.classifyClaudeError(0, {}), 'timeout');
  A.eq('200+error body => provider_error', AD.classifyClaudeError(200, { type: 'error', error: {} }), 'provider_error');
  A.ok('timeout is transient', AD.isTransientClaudeError('timeout'));
  A.ok('rate_limited is transient', AD.isTransientClaudeError('rate_limited'));
  A.ok('auth_error is NOT transient', !AD.isTransientClaudeError('auth_error'));
  A.ok('bad_request is NOT transient', !AD.isTransientClaudeError('bad_request'));
}
A.section('adapter — callClaude retries ONLY transient, bounded');
{
  const noSleep = (ms) => Promise.resolve(); const rand = () => 0;
  let n = 0;
  return AD.callClaude(() => { n++; return Promise.resolve(n < 3 ? errResponse(503) : okToolResponse({ verdict: 'ok' })); }, { model: 'm' }, { max_attempts: 4, sleep: noSleep, rand }).then((r) => {
    A.ok('eventually ok after transient retries', r.ok); A.eq('took 3 attempts', r.attempts, 3);
    let m = 0;
    return AD.callClaude(() => { m++; return Promise.resolve(errResponse(401)); }, { model: 'm' }, { max_attempts: 4, sleep: noSleep, rand }).then((r2) => {
      A.ok('auth_error not retried => not ok', !r2.ok); A.eq('only 1 attempt for non-transient', m, 1);
      A.eq('category auth_error', r2.error_category, 'auth_error');
    });
  }).then(runOfflineRest);
}

function runOfflineRest() {
  A.section('contracts — validateStructured catches schema violations');
  {
    const good = { executive_summary_ru: 's', items: [{ dimension: 'offers', kind: 'fact', text_ru: 't', evidence_ids: ['ev_1'] }], recommended_actions: [], unknowns_ru: [], overall_confidence: 80, used_evidence_ids: ['ev_1'] };
    A.eq('valid analysis => no errors', CC.validateStructured(good, CC.CC_ANALYSIS_SCHEMA).length, 0);
    const badEnum = JSON.parse(JSON.stringify(good)); badEnum.items[0].dimension = 'nonsense';
    A.ok('bad dimension enum flagged', CC.validateStructured(badEnum, CC.CC_ANALYSIS_SCHEMA).some(e => /enum/.test(e)));
    const badRange = JSON.parse(JSON.stringify(good)); badRange.overall_confidence = 250;
    A.ok('out-of-range confidence flagged', CC.validateStructured(badRange, CC.CC_ANALYSIS_SCHEMA).some(e => /maximum/.test(e)));
    const missing = JSON.parse(JSON.stringify(good)); delete missing.items;
    A.ok('missing required flagged', CC.validateStructured(missing, CC.CC_ANALYSIS_SCHEMA).some(e => /missing required "items"/.test(e)));
    const extra = JSON.parse(JSON.stringify(good)); extra.hallucinated = true;
    A.ok('unexpected property flagged', CC.validateStructured(extra, CC.CC_ANALYSIS_SCHEMA).some(e => /unexpected property/.test(e)));
  }
  A.section('contracts — validateEvidenceIds blocks invented ids (no-invention gate)');
  {
    const obj = { items: [{ evidence_ids: ['ev_1', 'ev_9'] }], used_evidence_ids: ['ev_1'] };
    const errs = CC.validateEvidenceIds(obj, ['ev_1', 'ev_2']);
    A.eq('exactly one invented id flagged', errs.length, 1);
    A.ok('names the invented id', errs[0].indexOf('ev_9') >= 0);
    A.eq('all-allowed => no errors', CC.validateEvidenceIds({ evidence_ids: ['ev_1'] }, ['ev_1', 'ev_2']).length, 0);
  }
  A.section('cost — from actual usage + conservative estimate');
  {
    const c = LC.costFromUsage({ input_tokens: 2000, output_tokens: 500 }, {});
    A.eq('2000*3/1e6 + 500*15/1e6 = 0.0135', c.cost_usd, 0.0135);
    const e = LC.estimateCost(200, 700, {});
    A.ok('estimate adds gateway overhead (>= counted)', e.est_input_tokens >= 200 + 2000);
    A.ok('estimate cost positive', e.est_cost_usd > 0);
    A.eq('sumCosts adds', LC.sumCosts([{ cost_usd: 0.01 }, { cost_usd: 0.02 }]), 0.03);
  }
  A.section('evidence_package — bounded, deduped, PII-scrubbed, current/historical separated');
  {
    const input = {
      request: { agent_request_id: 'req_1', niche: 'credit', region: 'Москва/МО', collected_at: '2026-07-16' },
      source: { source_id: 'autolombardn1.ru', kind: 'website', source_run_id: 'r1', quality_status: 'healthy' },
      current_run_facts: { company_name: 'Автоломбард №1', offer_summary: 'Займы под ПТС', service_types: ['pts_loan'] },
      evidence: [
        { source_url: 'https://autolombardn1.ru/', excerpt: 'Звоните +7 495 123-45-67 или mail@a.ru прямо сейчас', fact_type: 'contact', relevance: 50 },
        { source_url: 'https://autolombardn1.ru/', excerpt: 'Звоните +7 495 123-45-67 или mail@a.ru прямо сейчас', fact_type: 'contact', relevance: 50 },
        { source_url: 'https://autolombardn1.ru/', excerpt: 'До 90% стоимости залога, одобрение за 30 минут', fact_type: 'offer', relevance: 90 }
      ],
      historical_context: [{ source_id: 'mkbkfin.ru', kind: 'website', note: 'saved snapshot' }],
      deterministic_scores: { confidence: 45, relevance: 70 }
    };
    const r = EP.buildEvidencePackage(input, {});
    A.eq('dedup removed the repeated contact evidence', r.package.evidence_items.length, 2);
    A.ok('PII scrubbed (no phone in excerpt)', !/\+7 495/.test(JSON.stringify(r.package.evidence_items)));
    A.ok('PII scrubbed (no email)', !/mail@a\.ru/.test(JSON.stringify(r.package.evidence_items)));
    A.ok('phone replaced with token', /\[тел\]/.test(JSON.stringify(r.package.evidence_items)));
    A.ok('highest-relevance evidence kept first', r.package.evidence_items[0].fact_type === 'offer');
    A.eq('allowed ids match items', r.allowed_evidence_ids.length, 2);
    A.ok('historical kept separate, labeled', r.package.historical_context[0].source_id === 'mkbkfin.ru');
    A.ok('package_hash stable', r.package_hash === EP.buildEvidencePackage(input, {}).package_hash);
    const prompt = EP.renderPackagePrompt(r.package);
    A.ok('prompt lists evidence ids', prompt.indexOf('[ev_1]') >= 0 && prompt.indexOf('[ev_2]') >= 0);
    A.ok('prompt labels historical as NOT current', /HISTORICAL CONTEXT \(NOT results/.test(prompt));
  }

  // ---- orchestration: analyze → validate → repair → fallback ------------------------------------------------
  const pkgResult = EP.buildEvidencePackage({
    request: { agent_request_id: 'req_1', niche: 'credit', region: 'Москва/МО' },
    source: { source_id: 'autolombardn1.ru', kind: 'website', quality_status: 'healthy' },
    current_run_facts: { company_name: 'Автоломбард №1', offer_summary: 'Займы под ПТС' },
    evidence: [{ source_url: 'https://autolombardn1.ru/', excerpt: 'До 90% стоимости, одобрение за 30 минут', fact_type: 'offer', relevance: 90 }]
  }, {});
  const validAnalysis = { executive_summary_ru: 'Итог', items: [{ dimension: 'offers', kind: 'fact', text_ru: 'До 90%', evidence_ids: ['ev_1'] }], recommended_actions: [{ text_ru: 'Совет', priority: 'high', evidence_ids: ['ev_1'] }], unknowns_ru: [], overall_confidence: 85, used_evidence_ids: ['ev_1'] };
  const noSleep = () => Promise.resolve(); const cfg = { sleep: noSleep, rand: () => 0 };

  A.section('orchestration — valid tool_use on first call => no repair, no fallback');
  return CA.analyzeSource(() => Promise.resolve(okToolResponse(validAnalysis)), pkgResult, cfg).then((r) => {
    A.ok('ok', r.ok); A.ok('no repair', !r.repair_used); A.ok('no fallback', !r.fallback_used);
    A.eq('schema_mode tool_use', r.schema_mode, 'tool_use'); A.eq('one call', r.calls, 1);
    A.ok('cost > 0 from usage', r.cost_usd > 0); A.eq('confidence preserved', r.analysis.overall_confidence, 85);

    A.section('orchestration — invented evidence id => ONE repair => valid');
    const bad = JSON.parse(JSON.stringify(validAnalysis)); bad.items[0].evidence_ids = ['ev_99'];
    let call = 0;
    return CA.analyzeSource(() => { call++; return Promise.resolve(okToolResponse(call === 1 ? bad : validAnalysis)); }, pkgResult, cfg).then((r2) => {
      A.ok('repaired ok', r2.ok); A.ok('repair_used', r2.repair_used); A.ok('repair_success', r2.repair_success);
      A.ok('no fallback', !r2.fallback_used); A.eq('two calls (primary + one repair)', r2.calls, 2);
      A.ok('first-pass errors recorded', r2.validation_errors.some(e => /ev_99/.test(e)));

      A.section('orchestration — repair still invalid => deterministic fallback (fail closed, no loop)');
      return CA.analyzeSource(() => Promise.resolve(okToolResponse(bad)), pkgResult, cfg).then((r3) => {
        A.ok('not ok (fallback)', !r3.ok); A.ok('fallback_used', r3.fallback_used); A.ok('repair_used once', r3.repair_used);
        A.ok('repair did NOT succeed', !r3.repair_success); A.eq('exactly 2 calls, never loops', r3.calls, 2);
        A.ok('fallback analysis has deterministic facts', r3.analysis._fallback === true);
        A.eq('fallback confidence 0', r3.analysis.overall_confidence, 0);

        A.section('orchestration — transport auth error => immediate deterministic fallback');
        return CA.analyzeSource(() => Promise.resolve(errResponse(401)), pkgResult, cfg).then((r4) => {
          A.ok('fallback_used', r4.fallback_used); A.ok('no repair on hard transport failure', !r4.repair_used);
          A.eq('one call only', r4.calls, 1); A.ok('fallback still returns a usable analysis', Array.isArray(r4.analysis.items));

          A.section('orchestration — no structured output (refusal-like) => fallback');
          return CA.analyzeSource(() => Promise.resolve(textResponse('I cannot help with that.')), pkgResult, cfg).then((r5) => {
            A.ok('fallback_used on no-tool response', r5.fallback_used);
            A.report('stage-f-core');
          });
        });
      });
    });
  });
}
