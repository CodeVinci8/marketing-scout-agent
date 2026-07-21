'use strict';
// SOCIAL-BRIDGE-001 — verbatim social posts must reach source analysis without a competitor profile, and must
// stay strictly scoped, bounded and post-level relevant. Offline, $0.
//
// Reproduces the production defect: request req_76722076 (executions 1096/1101) collected 22 relevant Telegram
// posts (source_outcome=collected_with_data) and produced ZERO analysis targets, so WF28 was never called.
const A = require('./_assert.js');
const SE = require('../n8n/lib/social_evidence.js');
const AB = require('../n8n/lib/analysis_bridge.js');
const SC = require('../n8n/lib/semantic_core.js');

const REQ = 'req_76722076';
const RUN = 'req_76722076::telegram::a1::telegram';
const VKRUN = 'req_76722076::vk::a1::vk';

// A row shaped exactly like the real production raw_market_records row (WF11 «Build raw_market_records Rows»).
function tgRow(over) {
  return Object.assign({
    record_id: 'wf11_rec_' + RUN + '_1', agent_request_id: REQ, source_run_id: RUN, data_mode: 'live',
    created_at: '2026-07-19T07:11:06.633+03:00', source_type: 'social_channel', platform: 'telegram',
    source_url: 'https://t.me/s/mfo_market', post_url: 'https://t.me/mfo_market/224',
    profile_url: 'https://t.me/mfo_market', profile_name: 'Кредитный брокер Москва',
    author_handle: '@mfo_market', published_at: '2026-05-04T15:56:40+00:00',
    text_context: 'Займ под ПТС до 3 млн, ставка от 3,5% в месяц, срок до 5 лет. Оставьте заявку&#33;',
    comment_text: '', dedup_key: 'telegram::social_channel::https://t.me/mfo_market/224'
  }, over || {});
}
function vkRow(over) {
  return Object.assign(tgRow(), {
    record_id: 'wf26_rec_1', platform: 'vk', source_run_id: VKRUN,
    source_url: 'https://vk.com/autolombard_msk', post_url: 'https://vk.com/wall-12345_678',
    profile_url: 'https://vk.com/autolombard_msk', profile_name: 'Автоломбард Москва',
    dedup_key: 'vk::social_channel::https://vk.com/wall-12345_678'
  }, over || {});
}
const CTX = { agent_request_id: REQ, included_source_runs: [RUN, VKRUN] };

A.section('drift — the post-level service classifier is the canonical one');
{
  // A Code node cannot require() a sibling lib, so social_evidence carries a verbatim copy. It must not drift.
  const probes = ['займ под птс', 'рефинансирование ипотеки', 'банкротство физлиц', 'кредитная история и БКИ',
    'кредит для бизнеса ИП и ООО', 'просто фотография кота', '', 'банковская гарантия для тендера'];
  probes.forEach(p => A.eq('same verdict for: "' + p + '"', SE.seDeriveService(p), SC.deriveServiceFromText(p)));
}

A.section('a Telegram channel becomes a source_analysis target WITHOUT a competitor profile');
{
  const built = SE.buildSocialEvidence([tgRow()], CTX, {});
  A.eq('one evidence row', built.evidence.length, 1);
  A.eq('logical source is the channel, not the post', built.evidence[0].source_key, 't.me/mfo_market');
  A.eq('platform preserved', built.evidence[0].platform, 'telegram');
  A.eq('post URL is citable', built.evidence[0].url, 'https://t.me/mfo_market/224');
  A.eq('evidence_id is the record id', built.evidence[0].evidence_id, 'wf11_rec_' + RUN + '_1');
  A.eq('lineage kept', [built.evidence[0].agent_request_id, built.evidence[0].source_run_id], [REQ, RUN]);
  A.eq('one logical source reported', built.sources.length, 1);

  // the bridge: NO competitors, NO offers — exactly the production situation
  const res = AB.buildAnalysisTargets({ competitors: [], offers: [], evidence: built.evidence }, { agent_request_id: REQ });
  A.eq('a target is produced (the production defect was 0)', res.targets.length, 1);
  A.eq('reason ok', res.reason, 'ok');
  const t = res.targets[0];
  A.eq('target kind is telegram', t.source_kind, 'telegram');
  A.eq('target key is the channel', t.source_key, 't.me/mfo_market');
  A.eq('company_name is the channel name, not a fabricated competitor', t.evidence_input.current_run_facts.company_name, 'Кредитный брокер Москва');
  A.eq('no invented positioning', t.evidence_input.current_run_facts.positioning, '');
  A.eq('no invented offers', t.evidence_input.current_run_facts.offer_summary, '');
  A.eq('no invented prices', t.evidence_input.current_run_facts.prices_terms, '');
  A.eq('evidence reaches the model', t.evidence_input.evidence.length, 1);
  A.eq('the evidence carries its id so a claim can cite it', t.evidence_input.evidence[0].evidence_id, 'wf11_rec_' + RUN + '_1');
  A.ok('the excerpt is the verbatim post (entities decoded)', /Займ под ПТС до 3 млн/.test(t.evidence_input.evidence[0].excerpt));
  // mandated safeguards
  const lim = t.evidence_input.limitations.join(' | ');
  A.ok('limitation: no competitor profile exists', /карточки конкурента с офферами и ценами нет/.test(lim), lim);
  A.ok('limitation: no market-wide conclusion from one channel', /не переносятся на рынок в целом/.test(lim), lim);
  A.ok('limitation: silence is not absence of audience interest', /отсутствие комментариев/.test(lim), lim);
}

A.section('a VK community becomes a source_analysis target WITHOUT a competitor profile');
{
  const built = SE.buildSocialEvidence([vkRow()], CTX, {});
  A.eq('one evidence row', built.evidence.length, 1);
  A.eq('logical source is the community', built.evidence[0].source_key, 'vk.com/autolombard_msk');
  const res = AB.buildAnalysisTargets({ competitors: [], offers: [], evidence: built.evidence }, { agent_request_id: REQ });
  A.eq('a VK target is produced', res.targets.length, 1);
  A.eq('target kind is vk', res.targets[0].source_kind, 'vk');
  A.eq('community name used', res.targets[0].evidence_input.current_run_facts.company_name, 'Автоломбард Москва');
}

A.section('post-level relevance — unrelated posts are never evidence');
{
  const off = SE.buildSocialEvidence([tgRow({ text_context: 'Всем доброе утро! Хорошего дня и отличного настроения ☀️' })], CTX, {});
  A.eq('an off-topic post is dropped', off.evidence.length, 0);
  A.eq('and it is counted as off_topic', off.dropped.off_topic, 1);
  A.eq('no target from an off-topic post', AB.buildAnalysisTargets({ competitors: [], offers: [], evidence: off.evidence }, {}).targets.length, 0);

  const sys = SE.buildSocialEvidence([tgRow({ text_context: 'Канал переименован' })], CTX, {});
  A.eq('channel/system noise is dropped', sys.evidence.length, 0);
  A.eq('counted as system_event', sys.dropped.system_event, 1);

  // WIP3-C: general finance vocabulary is insufficient — off-domain macro/bond/rating news that only mentions
  // «кредитный риск»/«долг» is not primary lending evidence (regression: banksta British Steel / Oracle CDS).
  const bonds = SE.buildSocialEvidence([tgRow({ text_context: 'Обзор рынка облигаций: растут кредитные риски эмитентов, расширяются спреды' })], CTX, {});
  A.eq('off-domain bond/credit-risk news is not primary evidence', bonds.evidence.length, 0);
  A.eq('counted as low_relevance (not off_topic)', bonds.dropped.low_relevance, 1);
  const steel = SE.buildSocialEvidence([tgRow({ text_context: 'British Steel: национализация на фоне роста кредитных рисков бюджета' })], CTX, {});
  A.eq('off-domain macro news with a finance keyword is dropped', steel.evidence.length, 0);
  // a genuine lending post with the same broad service still passes as primary
  const loan = SE.buildSocialEvidence([tgRow({ text_context: 'Взять потребительский кредит наличными — оформить заявку онлайн, ставка от 5%' })], CTX, {});
  A.eq('a genuine lending post remains primary evidence', loan.evidence.length, 1);
  A.eq('seNichePrimary keeps a specific lending service', SE.seNichePrimary('Займ под ПТС, оформить онлайн', 'pts_loan'), true);
  A.eq('seNichePrimary drops broad catch-all off-domain', SE.seNichePrimary('доходности облигаций и кредитные риски', 'consumer_credit'), false);

  const empty = SE.buildSocialEvidence([tgRow({ text_context: '', comment_text: '' })], CTX, {});
  A.eq('a post with no text is dropped', empty.dropped.no_text, 1);
  const nourl = SE.buildSocialEvidence([tgRow({ post_url: '', source_url: '', profile_url: '' })], CTX, {});
  A.eq('a post with no citable URL is dropped', nourl.dropped.no_url, 1);
}

A.section('strict scoping is fail-closed');
{
  const foreignReq = SE.buildSocialEvidence([tgRow({ agent_request_id: 'req_OTHER', source_run_id: 'req_OTHER::telegram::a1' })], CTX, {});
  A.eq('a foreign REQUEST row is excluded', foreignReq.evidence.length, 0);
  A.eq('counted as foreign_request', foreignReq.dropped.foreign_request, 1);

  const unowned = SE.buildSocialEvidence([tgRow({ agent_request_id: '', source_run_id: '' })], CTX, {});
  A.eq('a row that names neither request nor run cannot be proven ours', unowned.evidence.length, 0);

  const staleRun = SE.buildSocialEvidence([tgRow({ source_run_id: REQ + '::telegram::a1::OLD' })], CTX, {});
  A.eq('a row from a source run the quality gate excluded is dropped', staleRun.evidence.length, 0);
  A.eq('counted as excluded_source_run', staleRun.dropped.excluded_source_run, 1);

  // with no gate list, request scope alone still governs
  const noGate = SE.buildSocialEvidence([tgRow({ source_run_id: REQ + '::telegram::a1::OLD' })], { agent_request_id: REQ, included_source_runs: [] }, {});
  A.eq('without a quality-gate list the request scope still admits the row', noGate.evidence.length, 1);

  const website = SE.buildSocialEvidence([tgRow({ platform: 'website' })], CTX, {});
  A.eq('a website row is not social evidence (it flows through competitor profiles)', website.dropped.not_social, 1);
}

A.section('bounding — one chatty channel cannot blow up the paid call');
{
  const many = [];
  for (let i = 0; i < 50; i++) {
    many.push(tgRow({ record_id: 'r' + i, post_url: 'https://t.me/mfo_market/' + i, dedup_key: 'k' + i }));
  }
  const b = SE.buildSocialEvidence(many, CTX, { max_total: 40, max_per_source: 12 });
  A.eq('per-source cap enforced', b.evidence.length, 12);
  A.ok('over-cap rows are counted, not silently lost', b.dropped.over_cap > 0);

  const dupes = SE.buildSocialEvidence([tgRow(), tgRow({ record_id: 'other' })], CTX, {});
  A.eq('the same post is never cited twice', dupes.evidence.length, 1);
  A.eq('counted as duplicate', dupes.dropped.duplicate, 1);

  const longPost = SE.buildSocialEvidence([tgRow({ text_context: 'займ под птс ' + 'я'.repeat(5000) })], CTX, { max_excerpt_chars: 300 });
  A.ok('excerpt is bounded', longPost.evidence[0].excerpt.length <= 300);

  // and the analysis target itself stays capped
  const built = SE.buildSocialEvidence(many, CTX, { max_total: 40, max_per_source: 40 });
  const res = AB.buildAnalysisTargets({ competitors: [], offers: [], evidence: built.evidence }, {}, { max_evidence_per_target: 8 });
  A.eq('evidence per target is capped', res.targets[0].evidence_input.evidence.length, 8);
}

A.section('privacy — direct contact identifiers never reach the model');
{
  const b = SE.buildSocialEvidence([tgRow({ text_context: 'Займ под ПТС, звоните +7 999 123 45 67 или пишите @manager_ivan, mail@example.ru' })], CTX, {});
  const ex = b.evidence[0].excerpt;
  A.ok('phone redacted', ex.indexOf('999 123 45 67') < 0, ex);
  A.ok('handle redacted', ex.indexOf('@manager_ivan') < 0, ex);
  A.ok('email redacted', ex.indexOf('mail@example.ru') < 0, ex);
  A.ok('the business fact survives', /Займ под ПТС/.test(ex), ex);
}

A.section('competitor-profile behaviour is unchanged (no regression on the website path)');
{
  const bundle = {
    competitors: [{ competitor: 'ООО Автоломбард', source_url: 'https://autolombardn1.ru', positioning: 'займы под ПТС за 30 минут', score: 82, last_checked: '2026-07-19', source_run_id: 'wf10_x' }],
    offers: [{ competitor: 'ООО Автоломбард', offer: 'Займ под ПТС', price_rate: 'от 3%', evidence_url: 'https://autolombardn1.ru/pts', collected_at: '2026-07-19' }],
    evidence: []
  };
  const res = AB.buildAnalysisTargets(bundle, { agent_request_id: REQ });
  A.eq('the website profile still produces exactly one target', res.targets.length, 1);
  A.eq('kind is website', res.targets[0].source_kind, 'website');
  A.eq('positioning still present', res.targets[0].evidence_input.current_run_facts.positioning, 'займы под ПТС за 30 минут');
  A.eq('offer still present', res.targets[0].evidence_input.current_run_facts.offer_summary, 'Займ под ПТС');
  A.ok('a profiled source gets NO evidence-only limitations', res.targets[0].evidence_input.limitations.join(' ').indexOf('карточки конкурента') < 0);

  // website evidence rows still ATTACH to their profile instead of creating a second target
  const withEv = AB.buildAnalysisTargets(Object.assign({}, bundle, {
    evidence: [{ competitor: 'ООО Автоломбард', url: 'https://autolombardn1.ru/pts', excerpt: 'ставка от 3% в месяц', finding: 'pricing' }]
  }), { agent_request_id: REQ });
  A.eq('still one target — evidence attached, not duplicated', withEv.targets.length, 1);
  A.eq('the profile gained the evidence row', withEv.targets[0].evidence_input.evidence.length, 3);
}

A.section('mixed run — a profiled website AND an unprofiled channel both get analysed');
{
  const built = SE.buildSocialEvidence([tgRow(), vkRow()], CTX, {});
  const res = AB.buildAnalysisTargets({
    competitors: [{ competitor: 'ООО Автоломбард', source_url: 'https://autolombardn1.ru', positioning: 'займы под ПТС' }],
    offers: [], evidence: built.evidence
  }, { agent_request_id: REQ });
  A.eq('three logical sources analysed', res.targets.length, 3);
  A.eq('kinds cover all three', res.targets.map(t => t.source_kind).sort(), ['telegram', 'vk', 'website']);
}

A.section('WF12 export — the canonical embed cannot drift from the lib');
{
  const fs = require('fs');
  const path = require('path');
  const E = require('../tools/embed_lib.js');
  const wfPath = path.join(__dirname, '..', 'n8n', 'workflows', '12_market_intelligence_report_builder.json');
  const doc = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
  const wf = Array.isArray(doc) ? doc[0] : doc;
  const node = (wf.nodes || []).find(n => n.name === 'Build Deterministic Report');
  const js = node.parameters.jsCode;

  const expected = E.isolatedModule('__SE', E.stripCore(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', 'social_evidence.js'), 'utf8')), ['buildSocialEvidence']);
  A.ok('WF12 embeds the canonical social_evidence lib verbatim', js.indexOf(expected) >= 0);

  // the read node exists, is scoped to the right tab, and is wired into the deterministic report
  const read = (wf.nodes || []).find(n => n.name === 'Read raw_market_records');
  A.ok('WF12 has the Read raw_market_records node', !!read);
  A.eq('it reads the raw_market_records tab', read.parameters.sheetName.value, 'raw_market_records');
  A.eq('it is a Google Sheets node', read.type, 'n8n-nodes-base.googleSheets');
  A.ok('the repo ships a PLACEHOLDER credential (never a real id)', /^PASTE_/.test(read.credentials.googleApi.id));
  A.eq('its credential NAME matches the sibling read node it inherits from',
    read.credentials.googleApi.name, (wf.nodes.find(n => n.name === 'Read competitor_profiles')).credentials.googleApi.name);
  A.eq('source_health now feeds the new read node', wf.connections['Read source_health'].main[0].map(e => e.node), ['Read raw_market_records']);
  A.eq('the new read node feeds Build Deterministic Report', wf.connections['Read raw_market_records'].main[0].map(e => e.node), ['Build Deterministic Report']);
  A.ok('the deterministic report consumes it', /rowsOf\('Read raw_market_records'\)/.test(js));
  A.ok('and the bundle carries the social evidence', /evidence:socialEvidence,/.test(js));
  A.ok('the read node is not committed with a real spreadsheet id', /MS_SPREADSHEET_ID/.test(JSON.stringify(read.parameters.documentId)));
}

A.section('WF12 behavioural — the real node turns collected posts into bundle evidence');
{
  const H = require('./wf_harness.js');
  const WF12 = H.loadWorkflow('12_market_intelligence_report_builder.json');
  const run = H.makeRun();
  const cfg = H.runCodeNode(run, WF12, 'Set Report Config', [])[0].json;
  Object.assign(cfg, { niche_id: 'credit_brokerage', region: 'Москва/МО', agent_request_id: REQ, report_data_mode: 'live' });
  run.outputs['Set Report Config'] = [{ json: cfg }];
  ['Read competitor_profiles', 'Read market_angles', 'Read audience_activity_signals',
    'Read competitor_site_snapshots', 'Read public_lead_signals'].forEach(n => H.inject(run, n, []));
  // WF12 fail-closes without a WF10 plan row; supply the minimum so the social path is what is under test.
  H.inject(run, 'Read content_positioning_plan', [{ plan_id: 'plan_20260719_071152', niche: 'credit_brokerage',
    region: 'Москва/МО', top_angles: 'x', source_evidence: 'rows=1 (window 30d)' }]);
  H.inject(run, 'Read source_health', [{ source_run_id: RUN, agent_request_id: REQ, data_mode: 'live',
    quality_status: 'healthy', report_eligible: true, source_key: 'mfo_market', platform: 'telegram', quality_score: 90 }]);
  // the exact production row shape, plus one off-topic post and one row from a foreign request
  H.inject(run, 'Read raw_market_records', [
    tgRow(),
    tgRow({ record_id: 'r2', post_url: 'https://t.me/mfo_market/225', dedup_key: 'k2', text_context: 'Всем хорошего дня! 🌞' }),
    tgRow({ record_id: 'r3', post_url: 'https://t.me/mfo_market/226', dedup_key: 'k3', agent_request_id: 'req_OTHER', source_run_id: 'req_OTHER::telegram::a1' })
  ]);
  const out = H.runCodeNode(run, WF12, 'Build Deterministic Report', [])[0].json;
  const bundle = JSON.parse(out.report_bundle);
  A.eq('exactly the one relevant, in-scope post became bundle evidence', bundle.evidence.length, 1);
  A.eq('it is the production post', bundle.evidence[0].url, 'https://t.me/mfo_market/224');
  A.eq('it carries a resolvable evidence id', bundle.evidence[0].evidence_id, 'wf11_rec_' + RUN + '_1');
  A.eq('and its logical source key', bundle.evidence[0].source_key, 't.me/mfo_market');

  // …and that bundle now produces a real WF28 target — the end of the defect chain
  const res = AB.buildAnalysisTargets(bundle, { agent_request_id: REQ });
  A.eq('the deterministic bundle yields one analysis target', res.targets.length, 1);
  A.eq('target is the Telegram channel', [res.targets[0].source_kind, res.targets[0].source_key], ['telegram', 't.me/mfo_market']);
}

A.report('social-evidence');
