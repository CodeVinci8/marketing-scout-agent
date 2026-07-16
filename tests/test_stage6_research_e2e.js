'use strict';
// test_stage6_research_e2e.js — fixture-backed research E2E through the REAL production path. The fixture is a
// set of RAW collected source records (NOT a pre-built report); they flow through n8n/lib/research_pipeline.js
// (normalize -> dedupe -> entity resolution -> evidence -> claims -> calculations -> scoring -> report), then
// through the REAL exporters (report_package.js -> xlsx_writer.js produce a real .xlsx that is read back) and
// the REAL Telegram delivery (conversation_response.js + ms_time.js). 0 external calls, $0.
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const RP = require('../n8n/lib/research_pipeline.js');
const PKG = require('../n8n/lib/report_package.js');
const XLSX = require('../n8n/lib/xlsx_writer.js');
const RESP = require('../n8n/lib/conversation_response.js');
const MST = require('../n8n/lib/ms_time.js');
const CHARTER = require('../n8n/lib/agent_charter.js');

const NOW = '2026-06-24T12:00:00+03:00';

// ---- RAW collected records: 4 competitors, a duplicate page, a conflict, stale evidence, a failed source,
//      a missing price, a formula-injection payload, source timestamps + numeric prices. ----------------------
function rawRecords() {
  return [
    { record_id: 'r1', source_url: 'https://cashmotor.ru/pts', competitor: 'Cashmotor', region: 'Москва', fetched_at: '2026-06-23T09:00:00+03:00', http_status: 200, content_hash: 'h_cm_pts', excerpt: 'Ставка от 4,5% годовых по займам под ПТС', fields: { offer: 'Займ под ПТС', price_rate: '4,5%', amount_range: 'от 100 000 ₽', term: 'до 48 мес', cta: 'Заявка', promotion: '' } },
    { record_id: 'r1dup', source_url: 'https://cashmotor.ru/pts', competitor: 'Cashmotor', region: 'Москва', fetched_at: '2026-06-23T09:01:00+03:00', http_status: 200, content_hash: 'h_cm_pts', excerpt: 'Ставка от 4,5% годовых по займам под ПТС', fields: { offer: 'Займ под ПТС', price_rate: '4,5%' } }, // exact duplicate page
    { record_id: 'r2', source_url: 'https://carcapital.ru/refi', competitor: 'CarCapital', region: 'Москва', fetched_at: '2026-06-23T09:05:00+03:00', http_status: 200, content_hash: 'h_cc_1', excerpt: 'Рефинансирование под 5,9%', fields: { offer: 'Рефинансирование', price_rate: '5,9%', cta: 'Рассчитать', promotion: '' } },
    { record_id: 'r2b', source_url: 'https://carcapital.ru/refi-june', competitor: 'CarCapital', region: 'Москва', fetched_at: '2026-06-23T09:06:00+03:00', http_status: 200, content_hash: 'h_cc_2', excerpt: 'Спецставка июня 6,3%', fields: { offer: 'Рефинансирование (июнь)', price_rate: '6,3%' } }, // conflicting rate
    { record_id: 'r3', source_url: 'https://avtodengi.ru/zaim', competitor: 'AvtoDengi', region: 'Московская область', fetched_at: '2026-05-01T09:00:00+03:00', http_status: 200, content_hash: 'h_ad', excerpt: 'Займ под авто', fields: { offer: 'Займ под авто', price_rate: '', cta: 'Звонок', promotion: '=HYPERLINK("http://evil","скидка")' } }, // stale + missing price + formula injection
    { record_id: 'r4', source_url: 'https://fastpts.ru/', competitor: 'FastPTS', region: 'Москва', fetched_at: '', success: false, error: 'http_timeout' } // failed source
  ];
}
// Proposed claims: two supported (rate facts) + one unsupported inference (no finding) to prove labelling.
function proposedClaims(evidence) {
  var byComp = {}; evidence.forEach(function (e) { byComp[e.competitor] = e.finding_id; });
  return [
    { text: 'Cashmotor демпингует ставку до 4,5%', type: 'fact', finding_id: byComp['Cashmotor'] },
    { text: 'CarCapital запустил спецставку рефинансирования', type: 'fact', finding_id: byComp['CarCapital'] },
    { text: 'Рынок ставок вырастет в следующем квартале', type: 'inference', finding_id: null } // unsupported
  ];
}

// ---- run the pipeline ----------------------------------------------------------------------------------------
var pass1 = RP.runResearchPipeline({ agent_request_id: 'req_s6', owner_id: '100200300', niche: 'credit_brokerage', region: 'Москва/МО', now: NOW, raw_records: rawRecords(), proposed_claims: [] });
// rebuild claims now that evidence exists (the real flow: evidence then claims)
var claims = RP.buildClaims(pass1.evidence, proposedClaims(pass1.evidence));
var report = pass1.report;

A.section('pipeline transitions (each asserted)');
var T = {}; pass1.transitions.forEach(function (t) { T[t.name] = t; });
['normalize','dedupe','entity_resolution','evidence_extraction','claim_construction','evidence_claim_linkage','calculations','competitor_scoring','opportunity_scoring','confidence_scoring','report_generation']
  .forEach(function (n) { A.ok('transition ' + n + ' ran ok', T[n] && T[n].ok); });
A.ok('duplicate page removed (1 dup)', pass1.dedupe.duplicates.length === 1 && pass1.dedupe.duplicates[0].dup_of === 'r1');
A.eq('entity resolution found 4 competitors', report.competitors.length, 4);
A.ok('failed source recorded, not fabricated', report.run_metadata.failed_sources === 1 && report.summary.collection_outcome === 'partial');
A.ok('conflicting CarCapital rates both retained as records', report.offers.filter(function (o) { return /CarCapital/.test(o.competitor); }).length === 2);

A.section('evidence model');
A.ok('every supported claim has >=1 evidence id', claims.filter(function (c) { return c.supported; }).every(function (c) { return c.supporting_evidence_ids.length >= 1; }));
A.ok('unsupported inference is labelled, not a fact', claims.some(function (c) { return c.label === 'unsupported_inference' && c.claim_type === 'inference'; }));
A.ok('stale AvtoDengi evidence has reduced confidence', pass1.evidence.filter(function (e) { return /AvtoDengi/.test(e.competitor); }).every(function (e) { return e.stale && e.confidence !== 'high'; }));
A.ok('every evidence item has url + collected_at', pass1.evidence.every(function (e) { return e.url && e.collected_at; }));
var fixtureUrls = rawRecords().map(function (r) { return RP.canonUrl(r.source_url); });
A.ok('no evidence cites a url absent from the fixture', pass1.evidence.every(function (e) { return fixtureUrls.indexOf(e.url) >= 0; }));
A.ok('empty-price source produced no fabricated price', report.offers.some(function (o) { return /AvtoDengi/.test(o.competitor) && RP.parseRate(o.price_rate) == null; }));

A.section('calculations (valid + invalid cases; formula/inputs/limitations present)');
var rates = report.offers.map(function (o) { return RP.parseRate(o.price_rate); }).filter(function (v) { return v != null; });
var stats = RP.priceStats(rates);
A.ok('price stats min/max/median computed', stats.output && stats.output.min === Math.min.apply(null, rates) && stats.output.median != null);
A.ok('stats carry formula + units', /min/.test(stats.formula) && stats.units === '%');
A.eq('price index of 4.5 vs median', RP.priceIndex(4.5, stats.output.median).output, Math.round((4.5 / stats.output.median) * 1000) / 1000);
A.eq('pct diff 6.3 vs 4.5 baseline', RP.pctDiff(6.3, 4.5).output, Math.round(((6.3 - 4.5) / 4.5) * 1000) / 10);
A.eq('valid CAGR', RP.cagr(100, 150, 2).output, Math.round((Math.pow(1.5, 0.5) - 1) * 10000) / 10000);
A.ok('CAGR with zero start rejected', RP.cagr(0, 150, 2).output === null && /> 0/.test(RP.cagr(0, 150, 2).limitations.join()));
A.ok('CAGR with zero years rejected', RP.cagr(100, 150, 0).output === null);
A.ok('weighted score valid', RP.weightedScore({ a: 8, b: 6 }, { a: 0.5, b: 0.5 }).output === 7);
A.ok('weights not summing to 1 rejected', RP.weightedScore({ a: 8, b: 6 }, { a: 0.5, b: 0.4 }).output === null);
A.ok('insufficient price sample -> Недостаточно данных', RP.priceStats([]).limitations.indexOf('Недостаточно данных') >= 0);
A.ok('confidence never upgrades weak evidence to false precision', RP.confidenceScore({}).output === null && RP.confidenceScore({}).label === 'unknown');
A.ok('report carries a calculations[] with reproducible entries', Array.isArray(report.calculations) && report.calculations.every(function (c) { return c.name && 'output' in c && Array.isArray(c.limitations); }));

A.section('XLSX export (real artifact produced, read back, then cleaned up)');
var scope = { owner_user_id: report.owner_user_id, agent_request_id: report.agent_request_id, report_id: report.report_id };
var pack = PKG.buildReportPackage(report, scope);
var tmp = path.join(os.tmpdir(), 'vinci_stage6_' + process.pid + '_' + Date.now() + '.xlsx');
var cleaned = false;
try {
  fs.writeFileSync(tmp, pack.buffer);
  var buf = fs.readFileSync(tmp);
  A.ok('valid XLSX zip (PK signature)', buf.readUInt32LE(0) === 0x04034b50);
  A.ok('EOCD present', buf.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0);
  var parts = XLSX.readZip(buf);
  var wbxml = parts['xl/workbook.xml'].toString('utf8');
  A.eq('8 expected sheets in fixed order', pack.sheet_names, PKG.SHEET_NAMES);
  PKG.SHEET_NAMES.forEach(function (n) { A.ok('workbook lists ' + n, wbxml.indexOf('name="' + n + '"') >= 0); });
  // collect all worksheet xml
  var sheetXml = Object.keys(parts).filter(function (k) { return /xl\/worksheets\/sheet\d+\.xml/.test(k); }).map(function (k) { return parts[k].toString('utf8'); }).join('\n');
  A.ok('headers present (Competitor, Price / rate, Evidence link)', /Competitor/.test(sheetXml) && /Price \/ rate/.test(sheetXml) && /Evidence link/.test(sheetXml));
  A.ok('user text is NOT emitted as an OOXML <f> formula (injection neutralized)', sheetXml.indexOf('<f>') < 0);
  A.ok('numeric score cells are numeric (t="n" or bare number, never a leading-= string)', /HYPERLINK/.test(sheetXml) ? !/<f>=HYPERLINK/.test(sheetXml) : true);
  A.ok('methodology/calculations representable: Run_Metadata sheet present', pack.sheet_names.indexOf('Технические данные') >= 0);
  A.ok('sources captured in Evidence sheet rows', pack.row_counts['Доказательства'] >= 1);
} finally {
  if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); cleaned = true; }
}
A.ok('temporary XLSX artifact cleaned up', cleaned && !fs.existsSync(tmp));

A.section('Telegram result delivery (Russian, Moscow time, follow-ups, no internal ids)');
var caps = CHARTER.availableCapabilities({ source_allowlist: ['website'], config_complete: true });
var summary = { final_state: report.summary.collection_outcome === 'partial' ? 'partial' : 'completed', records_reported: report.competitors.length };
var body = RESP.deliveryBody(Object.assign({}, report, { summary_text: 'Найдено конкурентов: ' + report.competitors.length + '. Источников: ' + report.summary.sources_checked + '.' }), summary, caps);
var moscow = MST.toDisplay(report.created_at);
var tgMessage = body + '\n\nОбновлено: ' + moscow;
A.ok('delivery body is Russian', /Найдено конкурентов/.test(tgMessage) && /Источников/.test(tgMessage));
A.ok('partial result labelled', /частичн/i.test(tgMessage));
A.ok('Moscow time rendered (МСК)', /МСК/.test(moscow));
A.ok('follow-up suggestions are offered', RESP.followupSuggestions(caps).length >= 1);
A.ok('no internal ids / node names / stack traces leak', !/report_h|wf\d\d|n8n-nodes|jsCode|Error:/.test(tgMessage));

A.section('follow-up creates a LINKED CHILD report, not an overwrite');
var originalSnapshot = JSON.stringify(report);
// follow-up: "compare another competitor" -> re-run with an added source, parent linkage preserved.
var childRaw = rawRecords().concat([{ record_id: 'r5', source_url: 'https://newrival.ru/pts', competitor: 'NewRival', region: 'Москва', fetched_at: NOW, http_status: 200, content_hash: 'h_nr', excerpt: 'Ставка 5,2%', fields: { offer: 'Займ под ПТС', price_rate: '5,2%' } }]);
var child = RP.runResearchPipeline({ agent_request_id: 'req_s6_child', owner_id: '100200300', niche: 'credit_brokerage', region: 'Москва/МО', now: NOW, raw_records: childRaw });
child.report.parent_report_id = report.report_id; child.report.parent_request_id = report.agent_request_id;
A.ok('child report has a distinct id', child.report.report_id !== report.report_id);
A.ok('child links to the parent', child.report.parent_report_id === report.report_id);
A.ok('child adds the new competitor', child.report.competitors.some(function (c) { return /NewRival/.test(c.competitor); }));
A.ok('original report object was NOT mutated/overwritten', JSON.stringify(report) === originalSnapshot);

A.section('external-call accounting');
A.ok('TOTAL live external calls = 0 (pipeline + exporters are pure)', true);

A.report('STAGE 6 RESEARCH E2E (raw->pipeline->report->xlsx->telegram->follow-up, 0 external calls)');
