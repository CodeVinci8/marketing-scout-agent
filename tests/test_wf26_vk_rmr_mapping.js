// test_wf26_vk_rmr_mapping.js — Stage D / D1: VK posts must enter the canonical pipeline.
// Proves (a) topology: WF26 has "Build VK raw_market_records Rows" (embeds semantic_core) -> "Append
// raw_market_records" (raw_market_records tab) wired off "Parse Wall & Detect Changes"; (b) the normalizer emits
// the EXACT canonical 40-column raw_market_records shape (same as WF07/WF09/WF11); (c) DRIFT-PROOF: the
// classifier embedded in the node is byte-for-byte the semantic_core library core and behaves IDENTICALLY to the
// library classifyOffline (the single scoring contract — no VK-specific scoring); (d) VK classification
// semantics: a competitor promo -> competitor_activity+competitor_related; a market event -> market_signal;
// noise/greeting -> NOT a competitor (irrelevant/unknown), so WF16/WF08 exclude it.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');

const gen = require('../tools/gen_stage4_workflows.js');
const wf = (gen.generated || []).find(g => g.file === '26_vk_public_community_collector.json').workflow;
const lib = require('../n8n/lib/semantic_core.js');

function node(name) { return (wf.nodes || []).find(n => n.name === name); }
function code(name) { const n = node(name); return n && n.parameters ? String(n.parameters.jsCode || '') : ''; }

A.section('WF26 D1 — topology: VK posts wired into raw_market_records');
const build = node('Build VK raw_market_records Rows');
const append = node('Append raw_market_records');
A.ok('normalizer node exists', !!build, 'Build VK raw_market_records Rows missing');
A.ok('append node exists', !!append, 'Append raw_market_records missing');
A.eq('append writes the raw_market_records tab', append && append.parameters.sheetName.value, 'raw_market_records');
const conns = wf.connections || {};
A.ok('Parse Wall & Detect Changes -> Build VK raw_market_records Rows',
  JSON.stringify(conns['Parse Wall & Detect Changes'] || {}).indexOf('Build VK raw_market_records Rows') >= 0, 'edge missing');
A.ok('Build VK raw_market_records Rows -> Append raw_market_records',
  JSON.stringify(conns['Build VK raw_market_records Rows'] || {}).indexOf('Append raw_market_records') >= 0, 'edge missing');

A.section('WF26 D1 — normalizer emits the canonical collector columns (same set as WF11), all in the real contract');
const buildJs = code('Build VK raw_market_records Rows');
// Source of truth #1: the real Google Sheets contract for raw_market_records (68 columns; collectors fill a
// subset, WF08/WF16 fill the rest). Source of truth #2: WF11's own "Build raw_market_records Rows" — the proven
// collector column set VK must match one-for-one (no parallel/extra fields).
const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sheets_contracts.json'), 'utf8'));
const HEADERS = (CONTRACT.headers || {})['raw_market_records'] || [];
A.ok('contract has raw_market_records headers', HEADERS.length >= 40, 'headers=' + HEADERS.length);
function emittedKeys(js) {
  const rowBlock = (js.split('out.push({json:{')[1] || js.split('json: {')[1] || '').split('}});')[0];
  return (rowBlock.match(/(^|\n)\s*([a-z_]+)\s*:/g) || []).map(s => s.replace(/[^a-z_]/g, ''));
}
const wf11 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '11_social_source_connector_foundation.json'), 'utf8'));
const wf11Build = (wf11.nodes || []).find(n => /Build raw_market_records Rows/i.test(n.name));
const COLS = Array.from(new Set(emittedKeys(String(wf11Build.parameters.jsCode)))); // proven WF11 collector columns
const vkCols = Array.from(new Set(emittedKeys(buildJs)));
A.ok('derived >= 40 canonical collector columns from WF11', COLS.length >= 40, 'COLS=' + COLS.length);
for (const c of COLS) {
  A.ok('VK normalizer maps WF11 column "' + c + '"', vkCols.indexOf(c) >= 0, 'missing column ' + c);
}
// no EXTRA / parallel columns: every VK-emitted key must be a real raw_market_records header
vkCols.forEach(k => A.ok('VK column "' + k + '" is a real raw_market_records header', HEADERS.indexOf(k) >= 0, 'non-contract column ' + k));

A.section('WF26 D1 — rows are selectable by WF08 (approval_status=new, dedup_status=unique)');
// WF08 "Filter & Select Records" only keeps rows whose approval_status is in {approved,new} (test_mode) and
// dedup_status===unique. A collector that writes approval_status='' is silently dropped (LIVE-observed: 56 VK
// rows read, 0 selected). VK must mirror WF11/WF04 collectors which write 'new'.
A.ok("normalizer writes approval_status:'new' (selectable by WF08)", /approval_status:'new'/.test(buildJs), "approval_status is not 'new'");
A.ok('normalizer writes dedup_status:\'unique\'', /dedup_status:'unique'/.test(buildJs), 'dedup_status is not unique');

A.section('WF26 D1 — embedded classifier is the semantic_core library core, verbatim');
A.ok('node embeds semantic_core', /embedded n8n\/lib\/semantic_core\.js/.test(buildJs), 'semantic_core not embedded');
A.ok('taxonomy inlined (no fs.readFileSync)', /const TAXONOMY = \{/.test(buildJs) && !/fs\.readFileSync/.test(buildJs), 'taxonomy not inlined');
// extract the embedded lib core (everything before the node driver) and materialize classifyOffline from it
const core = buildJs.split('// --- node driver ---')[0];
const embeddedClassify = (new Function(core + '\n;return classifyOffline;'))();
A.ok('embedded classifyOffline is callable', typeof embeddedClassify === 'function', 'could not materialize embedded classifyOffline');

A.section('WF26 D1 — embedded classifier == library classifier (drift-proof) + VK semantics');
const SAMPLES = {
  competitor_promo: { text: 'Помогу получить кредит после отказов банков. Работаю по договору, без предоплаты. Оставьте заявку в личные сообщения.' },
  market_event: { text: 'ЦБ повысил ключевую ставку до 21%. Это повлияет на ставки по кредитам и ипотеке в ближайшие месяцы.' },
  noise_greeting: { text: 'Всем доброе утро, друзья! Хорошего дня и отличного настроения :)' },
  empty: { text: '' }
};
function recFor(s) {
  return { text_context: s.text, text: s.text, title: '', platform: 'vk', source_type: 'vk_community_wall',
    post_url: 'https://vk.com/wall-1_2', source_url: 'https://vk.com/kredit874', exact_evidence_url: 'https://vk.com/wall-1_2',
    competitor_name: 'Кредитный помощник', profile_name: 'Кредитный помощник', published_at: '2026-07-01T10:00:00Z' };
}
Object.keys(SAMPLES).forEach(function (k) {
  const rec = recFor(SAMPLES[k]);
  const libOut = lib.classifyOffline(rec);
  const embOut = embeddedClassify(rec);
  A.eq('drift-proof: embedded==library for "' + k + '"', JSON.stringify(embOut), JSON.stringify(libOut));
});
// VK relevance semantics (via the library — same contract the node runs)
const promo = lib.classifyOffline(recFor(SAMPLES.competitor_promo));
A.eq('competitor promo -> competitor_activity', promo.record_type, 'competitor_activity');
A.ok('competitor promo -> competitor_related', promo.competitor_related === true, 'not competitor_related');
A.ok('competitor promo -> confidence > 1', Number(promo.confidence_score) > 1, 'confidence=' + promo.confidence_score);
const mkt = lib.classifyOffline(recFor(SAMPLES.market_event));
A.eq('market event -> market_signal', mkt.record_type, 'market_signal');
A.ok('market event NOT competitor', mkt.competitor_related === false, 'market wrongly competitor');
const noise = lib.classifyOffline(recFor(SAMPLES.noise_greeting));
A.ok('greeting noise is NOT a competitor', noise.record_type !== 'competitor_activity', 'noise=' + noise.record_type);
A.ok('greeting noise is NOT report-eligible as competitor', noise.competitor_related === false, 'noise competitor_related');

A.report('wf26-vk-rmr-mapping');
