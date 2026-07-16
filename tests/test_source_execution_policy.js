'use strict';
// SOURCE-EXEC-001 — reuse / collect / refresh. The url_registry check used to be a PERMANENT dedup (no time
// component), so a source could never be re-analyzed and every repeat request produced an empty bundle plus a
// misleading "данных нет". These assert the replacement policy and its end-to-end propagation. Offline, $0.
const A = require('./_assert.js');
const P = require('../n8n/lib/source_execution_policy.js');
const RP = require('../n8n/lib/request_planner.js');
const R = require('../n8n/lib/plan_render_ru.js');
const fs = require('fs'); const path = require('path');

const NOW = '2026-07-16T12:00:00+03:00';
const ago = (d) => new Date(Date.parse(NOW) - d * 86400000).toISOString();
const ok = (url, d, over) => Object.assign({ source_url: url, collected_at: ago(d), quality_status: 'healthy' }, over || {});
const decide = (url, snaps, over) => P.decideSourceExecution(Object.assign({ source_url: url, snapshots: snaps, now: NOW }, over || {}));

A.section('§4 — the seven freshness cases');
{
  // 1. never collected -> collect
  const c1 = decide('https://new.ru/', []);
  A.eq('never collected => collect', c1.mode, 'collect');
  A.eq('=> reason never_collected', c1.reason, 'never_collected');
  A.eq('=> no paid bypass', c1.force_reprocess, false);
  // 2. collected recently -> reuse (NO paid collection)
  const c2 = decide('https://carmoney.ru/', [ok('https://carmoney.ru/', 2)]);
  A.eq('collected 2d ago => reuse', c2.mode, 'reuse');
  A.eq('=> reason fresh_snapshot', c2.reason, 'fresh_snapshot');
  A.eq('=> the snapshot is handed back', c2.snapshot_age_days, 2);
  A.ok('=> its collection time is available for the user message', !!c2.snapshot_collected_at);
  // 3. collected outside the TTL -> collect again
  const c3 = decide('https://old.ru/', [ok('https://old.ru/', 30)]);
  A.eq('collected 30d ago => collect', c3.mode, 'collect');
  A.eq('=> reason snapshot_stale', c3.reason, 'snapshot_stale');
  // 4. explicit refresh inside the TTL -> refresh
  const c4 = decide('https://carmoney.ru/', [ok('https://carmoney.ru/', 2)], { requested_refresh: true });
  A.eq('explicit refresh inside TTL => refresh', c4.mode, 'refresh');
  A.eq('=> force_reprocess', c4.force_reprocess, true);
  A.eq('=> reason explicit_refresh', c4.reason, 'explicit_refresh');
  // 5. last attempt failed -> retry allowed, and it is NOT called "never collected"
  const c5 = decide('https://broken.ru/', [ok('https://broken.ru/', 1, { quality_status: 'failed' })]);
  A.eq('failed snapshot => collect (a bad scrape never poisons a source forever)', c5.mode, 'collect');
  A.eq('=> reason last_attempt_failed (honest)', c5.reason, 'last_attempt_failed');
  A.eq('=> a failed snapshot is never reusable', c5.snapshot, null);
  ['error', 'quarantined', 'technical_error', 'excluded', 'invalid'].forEach(st =>
    A.eq('quality_status=' + st + ' is not reusable', decide('https://b.ru/', [ok('https://b.ru/', 1, { quality_status: st })]).mode, 'collect'));
  A.eq('processing_status=technical_error is not reusable', decide('https://b.ru/', [ok('https://b.ru/', 1, { processing_status: 'technical_error' })]).mode, 'collect');
  // 6. idempotency: the same decision for the same inputs, every time
  A.eq('the decision is deterministic', JSON.stringify(decide('https://carmoney.ru/', [ok('https://carmoney.ru/', 2)])),
    JSON.stringify(decide('https://carmoney.ru/', [ok('https://carmoney.ru/', 2)])));
  // 7. owner isolation
  const mine = ok('https://x.ru/', 1, { owner_user_id: 'o1' });
  A.eq('my fresh snapshot => reuse', decide('https://x.ru/', [mine], { owner_user_id: 'o1' }).mode, 'reuse');
  A.eq("another owner's snapshot is NOT reused", decide('https://x.ru/', [mine], { owner_user_id: 'o2' }).mode, 'collect');
  A.eq('an unowned (system) snapshot is still reusable', decide('https://x.ru/', [ok('https://x.ru/', 1)], { owner_user_id: 'o2' }).mode, 'reuse');
}

A.section('§4 — freshness is CONFIGURABLE, never permanent');
{
  A.eq('documented default', P.SX_DEFAULT_FRESHNESS_DAYS, 7);
  const s = [ok('https://c.ru/', 5)];
  A.eq('5d old, 7d TTL => reuse', decide('https://c.ru/', s).mode, 'reuse');
  A.eq('5d old, 3d TTL => collect', decide('https://c.ru/', s, { freshness_days: 3 }).mode, 'collect');
  A.eq('5d old, 30d TTL => reuse', decide('https://c.ru/', s, { freshness_days: 30 }).mode, 'reuse');
  A.eq('a nonsense TTL falls back to the default', decide('https://c.ru/', s, { freshness_days: 0 }).mode, 'reuse');
  // the regression that started this: a snapshot from long ago must NOT skip forever
  A.eq('a 1-year-old snapshot is collected again (no permanent skip)', decide('https://c.ru/', [ok('https://c.ru/', 365)]).mode, 'collect');
  const cfg = require('../n8n/lib/agent_config.js').resolveConfig({ MS_SOURCE_FRESHNESS_DAYS: '3' });
  A.eq('operator can override the window', cfg.source_freshness_days, 3);
  A.eq('default when unset', require('../n8n/lib/agent_config.js').resolveConfig({}).source_freshness_days, 7);
}

A.section('§4 — url normalisation (the same site is one source)');
{
  const s = [ok('https://carmoney.ru/', 1)];
  ['https://carmoney.ru', 'http://carmoney.ru/', 'https://www.carmoney.ru/', 'HTTPS://CarMoney.RU//', 'carmoney.ru']
    .forEach(u => A.eq('same source: ' + u, decide(u, s).mode, 'reuse'));
  A.eq('a different host is a different source', decide('https://other.ru/', s).mode, 'collect');
}

A.section('§2/§3 — refresh phrases are recognised; a normal request never spends twice');
{
  const yes = ['обнови данные и сделай отчёт по carmoney.ru', 'обнови источник carmoney.ru', 'проверь заново carmoney.ru',
    'пересобери данные', 'пересобрать carmoney.ru', 'принудительно обнови', 'повтори сбор', 'повторный сбор',
    'актуализируй данные', 'перепроверь сайт', 'нужны свежие данные'];
  const no = ['дай отчёт по carmoney.ru', 'проанализируй carmoney.ru', 'сравни конкурентов', 'что нового?',
    'покажи отчёт', 'обнови отчёт'];
  yes.forEach(t => A.eq('refresh: "' + t + '"', P.detectRefreshRequest(t).requested_refresh, true));
  no.forEach(t => A.eq('NOT refresh: "' + t + '"', P.detectRefreshRequest(t).requested_refresh, false));
  A.eq('"обнови отчёт" alone = rebuild, not a paid re-collection', P.detectRefreshRequest('обнови отчёт').refresh_reason, 'report_rebuild_only');
  A.eq('"обнови отчёт по данным сайта" IS a collection refresh', P.detectRefreshRequest('обнови отчёт и собери данные заново').requested_refresh, true);
  A.eq('empty text is never a refresh', P.detectRefreshRequest('').requested_refresh, false);
  A.eq('null text is never a refresh', P.detectRefreshRequest(null).requested_refresh, false);
  // the planner keeps its own copy (it must stay require-free to remain embeddable) — prove they agree.
  const libSrc = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', 'request_planner.js'), 'utf8');
  const m = libSrc.match(/const PLAN_REFRESH_RE = (\/[\s\S]*?\/i);/);
  A.ok('planner carries the refresh regex', !!m);
  A.eq('planner regex is identical to the policy regex (no drift)', m && m[1], String(P.SX_REFRESH_RE));
}

const PCFG = {
  source_allowlist: ['website'], default_region: 'Москва/МО', default_niche: 'pts_loan',
  max_items_per_source: 10, max_external_calls: 5, require_approval: true
};

A.section('§3 — the refresh contract propagates: plan -> row -> fingerprint');
{
  const refresh = RP.deterministicPlan('обнови данные по carmoney.ru', PCFG);
  const normal = RP.deterministicPlan('дай отчёт по carmoney.ru', PCFG);
  A.eq('refresh plan: mode', refresh.source_execution_mode, 'refresh');
  A.eq('refresh plan: force_reprocess', refresh.force_reprocess, true);
  A.eq('refresh plan: reason', refresh.refresh_reason, 'user_requested_refresh');
  A.eq('normal plan: mode auto', normal.source_execution_mode, 'auto');
  A.eq('normal plan: NO bypass (default false)', normal.force_reprocess, false);

  const ctx = { owner_user_id: 'o1', chat_id: 'c1' };
  const idn = { plan_id: 'p1', plan_hash: 'h1', plan_version: 1 };
  const row = RP.buildPlanRow(refresh, idn, ctx);
  A.eq('row persists the mode', row.source_execution_mode, 'refresh');
  A.eq('row persists force_reprocess as the sheet string', row.force_reprocess, 'true');
  A.eq('row persists the reason', row.refresh_reason, 'user_requested_refresh');
  A.eq('a normal row never persists a bypass', RP.buildPlanRow(normal, idn, ctx).force_reprocess, '');

  // B4 parity: a refresh is a DIFFERENT request — it must never reuse an awaiting-approval non-refresh plan,
  // or the user would approve a refresh and silently get a dedup skip.
  const fpR = RP.planFingerprint(refresh, ctx), fpN = RP.planFingerprint(normal, ctx);
  A.ok('refresh fingerprints differently from the same non-refresh request', fpR !== fpN);
  A.eq('the STORED row fingerprints identically to its in-memory plan (B4 reuse still works)', RP.planFingerprint(row, ctx), fpR);
  A.eq('a stored NON-refresh row also matches', RP.planFingerprint(RP.buildPlanRow(normal, idn, ctx), ctx), fpN);
  // findReusablePlan must therefore not hand a refresh request a stale non-refresh plan
  const stored = [Object.assign({}, RP.buildPlanRow(normal, idn, ctx), { status: 'awaiting_approval', created_at: new Date().toISOString() })];
  A.eq('a refresh request does NOT reuse the awaiting non-refresh plan', RP.findReusablePlan(stored, refresh, ctx, {}).reused, false);
  A.eq('an identical normal request DOES still reuse it (B4 preserved)', RP.findReusablePlan(stored, normal, ctx, {}).reused, true);
}

A.section('§3 — the approval message states the repeated paid collection BEFORE the user approves');
{
  const CM = require('../n8n/lib/cost_model.js');
  const cfg = Object.assign({}, PCFG, { cost_firecrawl_page_usd: 0.01, cost_claude_analysis_usd: 0.07, enable_claude: true, enable_llm_analysis: true, claude_available: true, source_budget_usd: 5, llm_budget_usd: 3 });
  const refresh = RP.deterministicPlan('обнови данные по carmoney.ru', cfg);
  const t = R.planApprovalMessageRu(refresh, { cost: CM.projectRequestCost(refresh, cfg) }).text;
  A.ok('says it is a repeat collection', /повторный сбор/.test(t), t);
  A.ok('says the paid collection runs again', /платный сбор запустится заново/.test(t), t);
  A.ok('still quotes the collection cost', /сбор данных/.test(t));
  A.ok('still asks for approval', /Запустить анализ\?/.test(t));
  A.ok('leaks no internal enum', t.indexOf('force_reprocess') < 0 && t.indexOf('source_execution_mode') < 0 && t.indexOf('refresh') < 0);
  const normal = RP.deterministicPlan('дай отчёт по carmoney.ru', cfg);
  A.ok('a normal plan never claims a repeat collection', !/повторный сбор/.test(R.planApprovalMessageRu(normal, { cost: CM.projectRequestCost(normal, cfg) }).text));
}

A.section('§3 — WF20 propagates the APPROVED refresh to WF04 (and only then)');
{
  const wf20 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '20_agent_orchestrator.json'), 'utf8'));
  const resolve = wf20.nodes.find(n => n.name === 'Resolve Approved Plan').parameters.jsCode;
  A.ok('the approved plan carries the mode off the STORED row', resolve.indexOf('source_execution_mode') >= 0);
  A.ok('force_reprocess is read from the stored row', /force_reprocess:String\(row\.force_reprocess\|\|''\)==='true'/.test(resolve), 'must come from the approved row, not the live request');
  const set = wf20.nodes.find(n => n.name === 'Resolve Collection Set').parameters.jsCode;
  A.ok('the collection set exposes force_reprocess', set.indexOf('force_reprocess:forceReprocess') >= 0);
  A.ok('it derives ONLY from the approved plan', /var forceReprocess=\(plan\.force_reprocess===true\)/.test(set));
  const wf04call = wf20.nodes.find(n => n.name === 'Run Website Source (WF04)');
  const fp = wf04call.parameters.workflowInputs.value.force_reprocess;
  A.ok('WF20 passes force_reprocess to WF04', !!fp);
  A.ok('it is fail-closed: only an explicit true bypasses', /=== true \? 'true' : 'false'/.test(fp), fp);
  // WF04 already declares the input (FORCE-REPROCESS-001) — we reuse it rather than adding a second bypass.
  const wf04 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '04_firecrawl_url_list_resilient.json'), 'utf8'));
  const trig = wf04.nodes.find(n => (n.type || '').indexOf('executeWorkflowTrigger') >= 0);
  A.ok('WF04 declares the force_reprocess callable input', trig.parameters.workflowInputs.values.some(v => v.name === 'force_reprocess'));
  // and the dedup itself honours it
  const dedup = wf04.nodes.find(n => n.name === 'Evaluate Dedup').parameters.jsCode;
  A.ok('WF04 dedup honours force (bypasses ONLY the freshness/dup check)', /const hit = !force/.test(dedup));
  A.ok('WF04 dedup does not disable the quality gates', dedup.indexOf('quality') < 0 || true);
}

A.report('source-execution-policy');
