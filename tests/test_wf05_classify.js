// test_wf05_classify.js — WF05 Stage C Closure on the REAL Classify Candidates node ($0, no network).
// Covers: broad-query/narrow-focus representation (S2-D1); regulator/publisher/direct/indirect/source
// separation incl. cbr.ru NOT a direct competitor (S2-D2); non-uniform confidence (S2-D3); canonical
// service hints (S2-D4); Apify cost telemetry unknown!=zero (S2-D5); root-domain canonicalization (S2-D6).
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');

const wf = H.loadWorkflow('05_apify_search_candidate_discovery.json');

function classify(metaOverride, candidates, registry) {
  const run = H.makeRun();
  const meta = H.runCodeNode(run, wf, 'Set Discovery Request', [])[0].json;
  Object.assign(meta, metaOverride || {});
  run.outputs['Set Discovery Request'] = [{ json: meta }];
  run.outputs['Normalize Apify Results'] = [{ json: { ok: true, error_preview: '', candidate_count_raw: candidates.length, candidates } }];
  H.inject(run, 'Read url_registry', registry || []);
  return H.runCodeNode(run, wf, 'Classify Candidates', [])[0].json;
}

const candidates = [
  { candidate_url: 'https://www.mkbk.ru/?utm_source=google&gclid=x#top', normalized_source_url: 'https://mkbk.ru', title: 'МКБ — займ под ПТС в Москве', snippet: 'Деньги под залог ПТС, низкая ставка, Москва', domain: 'mkbk.ru', rank: 1 },
  { candidate_url: 'https://cbr.ru/banking_sector/', normalized_source_url: 'https://cbr.ru/banking_sector', title: 'Банк России — регулятор', snippet: 'О кредитных организациях', domain: 'cbr.ru', rank: 2 },
  { candidate_url: 'https://www.banki.ru/products/credits/', normalized_source_url: 'https://banki.ru/products/credits', title: 'Кредиты — Банки.ру', snippet: 'Сравнение кредитов и займов', domain: 'banki.ru', rank: 3 },
  { candidate_url: 'https://rbc.ru/articles/top-10-brokers', normalized_source_url: 'https://rbc.ru/articles/top-10-brokers', title: 'Топ-10 брокеров', snippet: 'Рейтинг кредитных брокеров', domain: 'rbc.ru', rank: 4 }
];
const out = classify({}, candidates, []);
function byDomain(d) { return out.candidateRows.find(r => r.domain === d); }
const mkbk = byDomain('mkbk.ru'), cbr = byDomain('cbr.ru'), banki = byDomain('banki.ru'), rbc = byDomain('rbc.ru');

A.section('WF05 — regulator/publisher/direct/indirect separation; cbr.ru NOT a direct competitor (S2-D2)');
A.eq('mkbk = direct_competitor', mkbk.candidate_type, 'direct_competitor');
A.eq('mkbk competitor_class = direct', mkbk.competitor_class, 'direct');
A.eq('cbr.ru = regulator (NOT direct_competitor)', cbr.candidate_type, 'regulator');
A.ok('cbr.ru is NOT a competitor entity', cbr.is_competitor_entity === false);
A.eq('rbc.ru = publisher_article', rbc.candidate_type, 'publisher_article');
A.ok('rbc.ru is NOT a competitor entity', rbc.is_competitor_entity === false);
A.eq('banki.ru competitor_class = indirect', banki.competitor_class, 'indirect');
A.eq('regulator_count = 1', out.regulator_count, 1);
A.eq('publisher_count = 1', out.publisher_count, 1);
A.eq('direct_competitor_count = 1', out.direct_competitor_count, 1);
A.ok('regulator note flags "not a competitor"', /NOT a competitor/.test(cbr.notes));

A.section('WF05 — root-domain detection + URL canonicalization (S2-D6)');
A.eq('mkbk root detected', mkbk.is_root, true);
A.eq('mkbk canonical strips www/tracking/fragment/slash', mkbk.canonical_url, 'https://mkbk.ru');
A.eq('cbr non-root', cbr.is_root, false);

A.section('WF05 — non-uniform, evidence-based confidence (S2-D3)');
A.ok('confidence varies across candidate types', new Set(out.candidateRows.map(r => r.confidence_score)).size >= 3);
A.ok('direct competitor outranks the regulator', mkbk.confidence_score > cbr.confidence_score);
A.ok('direct competitor outranks the article', mkbk.confidence_score > rbc.confidence_score);

A.section('WF05 — canonical service hints (S2-D4)');
A.eq('mkbk service_primary = pts_loan', mkbk.service_primary, 'pts_loan');
A.ok('every row has a service_hint field', out.candidateRows.every(r => typeof r.service_hint === 'string'));

A.section('WF05 — broad query vs narrow focus representation (S2-D1)');
A.ok('requested_search_scope present', !!out.requested_search_scope);
A.ok('query_terms tokenized', Array.isArray(out.query_terms) && out.query_terms.length > 0);
// broad credit-broker query must NOT be forced to the narrow pts_loan focus
const broad = classify({ query: 'кредитный брокер помощь в получении кредита Москва', service_focus: 'pts_loan' }, candidates, []);
A.eq('broad query -> service_primary credit_brokerage', broad.service_primary, 'credit_brokerage');
A.eq('broad query -> scope broad_credit_brokerage', broad.requested_search_scope, 'broad_credit_brokerage');
A.ok('narrow pts_loan focus preserved as secondary', /pts_loan/.test(broad.service_secondary));

A.section('WF05 — Apify cost telemetry: unknown != zero (S2-D5)');
A.eq('apify_cost_status = unknown', out.apify_cost_status, 'unknown');
A.eq('actual_apify_cost_usd null (not 0)', out.actual_apify_cost_usd, null);
A.eq('estimated_apify_cost_usd null (not 0)', out.estimated_apify_cost_usd, null);

A.report('wf05-classify');
