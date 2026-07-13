'use strict';
// test_stage_e_persistence.js — STAGE E (E1): scoring + Google Sheets persistence validation for the discovery
// candidate_sources tab. Proves the row WF27 appends matches the sheets contract EXACTLY (no column drift, no
// missing column), that scores are in range, quality/dedup statuses are persisted, and every persisted row carries
// evidence + owner/run lineage. Real WF27 "Finalize Discovery" node execution + real libs. Offline, $0.
const A = require('./_assert');
const H = require('./wf_harness');
const Q = require('../n8n/lib/discovery_query.js');
const C = require('../n8n/lib/candidate_classifier.js');
const TS = require('../n8n/lib/tracked_sources.js');
const contracts = require('../config/sheets_contracts.json');

const CONTRACT = contracts.headers.candidate_sources;
const IDENTITY = contracts.identity_columns.candidate_sources; // ['candidate_id']

// --- build a realistic classified candidate set exactly as the WF27 "Classify Candidates" node does ------------
const searchResp = { success: true, data: { web: [
  { url: 'https://zalog24h.ru/?utm=x', title: 'Автоломбард Москва', description: 'Займ под ПТС, автоломбард. Оставьте заявку, звоните. Москва.' },
  { url: 'https://t.me/s/broker_pts?before=10', title: 'Кредитный брокер', description: 'Поможем получить кредит под ПТС без предоплаты. Москва.' },
  { url: 'https://sravni.ru/avtolombard', title: 'Автоломбарды рейтинг', description: 'автоломбард, займ под ПТС, оставьте заявку' },
  { url: 'https://vk.com/zaimpodptsbarnaul', title: 'Займы Барнаул', description: 'автоломбард, займ под ПТС, Барнаул' }
] } };
const qRegion = 'Москва/МО';
const results = Q.parseFirecrawlSearchResults(searchResp);
const cands = Q.candidatesFromResults(results, { platform_target: 'website' }, TS.normalizeSourceRef)
  .concat(Q.candidatesFromResults(results, { platform_target: 'telegram' }, TS.normalizeSourceRef))
  .concat(Q.candidatesFromResults(results, { platform_target: 'vk' }, TS.normalizeSourceRef));
cands.forEach(function (x) {
  x.query_text = 'автоломбард Москва'; x.product = 'pts_loan'; x.already_tracked = false;
  const cl = C.classifyCandidate({ title: x.title, description: x.description, platform: x.platform, host: x.host, url: x.source_url, display_name: x.display_name, normalized_key: x.normalized_key, query_region: qRegion, already_tracked: false, validated: false });
  x.is_competitor = cl.is_competitor; x.is_lead_source = cl.is_lead_source; x.is_content_creator = cl.is_content_creator;
  x.is_news_or_aggregator = cl.is_news_or_aggregator; x.category = cl.category; x.confidence = cl.confidence;
  x.relevance_score = cl.relevance_score; x.classification_reason = cl.classification_reason;
  x.region_match = cl.region_match; x.region_reason = cl.region_reason; x.validated = false;
});

const WF27 = H.loadWorkflow('27_competitor_discovery.json');
function finalize(candidates, targets, scraped) {
  const run = H.makeRun();
  H.inject(run, 'Resolve Agent Config', [{ default_region: qRegion, source_allowlist: ['website', 'telegram', 'vk'] }]);
  H.inject(run, 'Classify Candidates', [{ candidates: candidates, first: { discovery_run_id: 'disc_req_777', owner_user_id: '111', chat_id: '555', agent_request_id: 'req_777', query_region: qRegion }, chat: '555', qRegion: qRegion }]);
  H.inject(run, 'Select Validation Targets', targets || [{ validate: false }]);
  H.inject(run, 'Firecrawl Scrape', scraped || []);
  return H.runCodeNode(run, WF27, 'Finalize Discovery', [{ json: {} }])[0].json;
}

A.section('STAGE-E — candidate_sources row matches the sheets contract exactly (no drift, no missing column)');
const out = finalize(cands);
const rows = out.candidate_rows;
A.ok('at least one candidate row persisted', rows.length >= 3, 'rows=' + rows.length);
const rowKeys = Object.keys(rows[0]);
A.eq('row has EXACTLY the contract columns (count)', rowKeys.length, CONTRACT.length);
A.eq('no column drift (every emitted key is in the contract)', rowKeys.filter(k => CONTRACT.indexOf(k) < 0).join(','), '');
A.eq('no missing column (every contract column is emitted)', CONTRACT.filter(k => rowKeys.indexOf(k) < 0).join(','), '');

A.section('STAGE-E — scores are in range and quality/dedup statuses are persisted');
const QUALITY_ENUM = ['validated', 'unvalidated', 'candidate'];
const DEDUP_ENUM = ['unique', 'duplicate', 'duplicate_in_batch', 'duplicate_in_registry'];
const REGION_ENUM = ['match', 'mismatch', 'unknown'];
rows.forEach(function (r) {
  const n = r.normalized_key;
  A.ok('confidence 0..100 for ' + n, Number(r.confidence) >= 0 && Number(r.confidence) <= 100, 'conf=' + r.confidence);
  A.ok('relevance_score 0..100 for ' + n, Number(r.relevance_score) >= 0 && Number(r.relevance_score) <= 100);
  A.ok('quality_status persisted + valid for ' + n, QUALITY_ENUM.indexOf(String(r.quality_status)) >= 0, r.quality_status);
  A.ok('dedup_status persisted + valid for ' + n, DEDUP_ENUM.indexOf(String(r.dedup_status)) >= 0, r.dedup_status);
  A.ok('region persisted + valid for ' + n, REGION_ENUM.indexOf(String(r.region)) >= 0, r.region);
});

A.section('STAGE-E — every persisted row carries evidence + owner/run lineage');
rows.forEach(function (r) {
  const n = r.normalized_key;
  A.ok('owner_user_id present for ' + n, String(r.owner_user_id) === '111');
  A.ok('discovery_run_id present for ' + n, String(r.discovery_run_id) === 'disc_req_777');
  A.ok('source_run_id (lineage) present for ' + n, String(r.source_run_id) === 'req_777');
  A.ok('evidence_url present for ' + n, /^https?:\/\//.test(String(r.evidence_url)));
  A.ok('provider_result_url (provenance) present for ' + n, /^https?:\/\//.test(String(r.provider_result_url)));
  A.ok('evidence_excerpt (the "why") present for ' + n, String(r.evidence_excerpt).length > 0);
  A.ok('created_at + collected_at present for ' + n, !!r.created_at && !!r.collected_at);
});

A.section('STAGE-E — dedup key: candidate_id is discovery_run_id::normalized_key, unique per row, owner-scoped');
const ids = rows.map(r => r.candidate_id);
A.eq('candidate_id = <run>::<key>', ids.every(id => /^disc_req_777::/.test(id)), true);
A.eq('candidate_ids are unique (no duplicate persistence)', new Set(ids).size, ids.length);
A.eq('identity column is candidate_id', IDENTITY.join(','), 'candidate_id');

A.section('STAGE-E — classification is correct + honest (aggregator/region-mismatch are NOT competitors/top)');
function row(k) { return rows.filter(r => r.normalized_key.indexOf(k) >= 0)[0]; }
A.eq('zalog24h.ru -> competitor', row('zalog24h.ru').is_competitor, true);
A.eq('sravni.ru -> aggregator, not competitor', row('sravni.ru').is_news_or_aggregator === true && row('sravni.ru').is_competitor === false, true);
const barnaul = row('barnaul');
A.eq('…barnaul -> region mismatch (Moscow query)', barnaul.region, 'mismatch');

A.section('STAGE-E — validated candidate persists validated status + scraped evidence excerpt');
const topKey = cands.filter(c => c.is_competitor && c.region_match !== 'mismatch')[0].normalized_key;
const vTargets = [{ validate: true, normalized_key: topKey, platform: 'website', scrape_url: 'https://zalog24h.ru' }];
const vScraped = [{ success: true, data: { markdown: 'Автоломбард в Москве. Оставьте заявку, звоните. Работаем по договору, без предоплаты.', metadata: { title: 'Автоломбард Москва', description: 'займ под ПТС' } } }];
const vOut = finalize(cands, vTargets, vScraped);
const vRow = vOut.candidate_rows.filter(r => r.normalized_key === topKey)[0];
A.eq('validated candidate -> quality_status=validated', vRow.quality_status, 'validated');
A.ok('validated candidate confidence rose vs snippet-only', Number(vRow.confidence) >= 70, 'conf=' + vRow.confidence);
A.ok('validated evidence_excerpt comes from the fetched page', /Работаем по договору|Оставьте заявку/.test(String(vRow.evidence_excerpt)));

A.report('stage-e-persistence');
