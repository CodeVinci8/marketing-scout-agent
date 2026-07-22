'use strict';
// test_bridge_identity.js — BRIDGE-IDENTITY-001.
//
// analysis_bridge keyed competitor targets by DOMAIN (abSourceId of source_url) and offer targets by the
// offer's evidence_url — which WF12 frequently omits, so an offer fell back to a NAME key. One real competitor
// («Залог 24» at zalog24h.ru) therefore split into TWO targets (domain-keyed + name-keyed), same source_run_id,
// same company. analysis_router counts distinct sources to choose comparison vs synthesis, so this split let a
// SINGLE source pose as a two-source comparison. Consolidation must fix the CONTRACT, not the counting.
const A = require('./_assert.js');
const AB = require('../n8n/lib/analysis_bridge.js');

function targetsFor(bundle) {
  return AB.buildAnalysisTargets(bundle, { agent_request_id: 'q', niche: 'credit_brokerage', region: 'Москва/МО' }, { max_targets: 6 }).targets;
}
const sources = (ts) => ts.map((t) => t.evidence_input.source.source_id);

A.section('identity signals — present fields only, strongest first');
{
  const sig = AB.abIdentitySignals({ source_run_id: 'run0', source_url: 'https://Zalog24H.ru/pts', company_name: 'Залог 24', source_key: 'zalog24h.ru' });
  A.ok('run id captured', sig.indexOf('run:run0') >= 0);
  A.ok('domain normalized (host, no www, lowercase)', sig.indexOf('dom:zalog24h.ru') >= 0);
  A.ok('name normalized', sig.indexOf('name:залог 24') >= 0);

  // An absent optional field must NOT appear as a signal (it must never split a source).
  const sig2 = AB.abIdentitySignals({ source_run_id: '', source_url: '', company_name: 'Залог 24', source_key: 'Залог 24' });
  A.eq('only the name signal when url+run absent', sig2.length, 1);
  A.eq('the signal is the name', sig2[0], 'name:залог 24');

  A.eq('canonical domain strips path', AB.abCanonicalDomain('https://www.zalog24h.ru/pts/x'), 'zalog24h.ru');
  A.eq('social community keeps its segment', AB.abCanonicalDomain('https://t.me/rusmicrofinance/123'), 't.me/rusmicrofinance');
}

A.section('THE DEFECT: one competitor + a url-less offer = ONE source');
{
  const ts = targetsFor({
    competitors: [{ competitor: 'Залог 24', source_url: 'https://zalog24h.ru/', source_run_id: 'run0', quality: 'accepted', positioning: 'ценовой якорь от 2,4%' }],
    offers: [{ competitor: 'Залог 24', offer: 'займ под ПТС', price_rate: 'от 2,4%', cta: 'оставить заявку', source_run_id: 'run0', collected_at: '2026-07-22' }],
    evidence: [], source_quality: [{ source: 'zalog24h.ru', status: 'healthy', source_run_id: 'run0' }]
  });
  A.eq('exactly ONE target', ts.length, 1);
  A.ok('evidence from BOTH records merged', ts[0].evidence_input.evidence.length >= 2);
  A.eq('company preserved', ts[0].evidence_input.current_run_facts.company_name, 'Залог 24');
  A.ok('offer summary retained', ts[0].evidence_input.current_run_facts.offer_summary.indexOf('займ') >= 0);
}

A.section('merge holds even when the offer has NO run id (name is the only shared signal)');
{
  const ts = targetsFor({
    competitors: [{ competitor: 'Залог 24', source_url: 'https://zalog24h.ru/', source_run_id: 'run0', quality: 'accepted', positioning: 'якорь' }],
    offers: [{ competitor: 'Залог 24', offer: 'займ', price_rate: 'от 2,4%' }], // no url, no run id
    evidence: [], source_quality: []
  });
  A.eq('still one source', ts.length, 1);
}

A.section('two GENUINELY different competitors stay two sources');
{
  const ts = targetsFor({
    competitors: [
      { competitor: 'Залог 24', source_url: 'https://zalog24h.ru/', source_run_id: 'r1', quality: 'accepted', positioning: 'якорь' },
      { competitor: 'Автоломбард №1', source_url: 'https://autolombardn1.ru/', source_run_id: 'r2', quality: 'accepted', positioning: 'ПТС' }
    ],
    offers: [
      { competitor: 'Залог 24', offer: 'займ', price_rate: '2,4%', source_run_id: 'r1' },
      { competitor: 'Автоломбард №1', offer: 'займ', price_rate: '3%', source_run_id: 'r2' }
    ],
    evidence: [], source_quality: []
  });
  A.eq('two distinct sources', ts.length, 2);
  const s = sources(ts).sort();
  A.ok('both identities present', s.join(',').indexOf('zalog24h.ru') >= 0 || s.join(',').indexOf('Залог 24') >= 0);
}

A.section('three genuinely different sources → three targets');
{
  const ts = targetsFor({
    competitors: [
      { competitor: 'A', source_url: 'https://a.ru/', source_run_id: 'r1', quality: 'accepted', positioning: 'p1' },
      { competitor: 'B', source_url: 'https://b.ru/', source_run_id: 'r2', quality: 'accepted', positioning: 'p2' },
      { competitor: 'C', source_url: 'https://c.ru/', source_run_id: 'r3', quality: 'accepted', positioning: 'p3' }
    ],
    offers: [
      { competitor: 'A', offer: 'o', price_rate: '1%' }, { competitor: 'B', offer: 'o', price_rate: '2%' }, { competitor: 'C', offer: 'o', price_rate: '3%' }
    ],
    evidence: [], source_quality: []
  });
  A.eq('three sources', ts.length, 3);
}

A.section('same company, different URL spellings, still one source');
{
  const ts = targetsFor({
    competitors: [{ competitor: 'Залог 24', source_url: 'https://WWW.Zalog24H.ru', source_run_id: 'run0', quality: 'accepted', positioning: 'якорь' }],
    offers: [{ competitor: 'Залог 24', evidence_url: 'https://zalog24h.ru/pts', offer: 'займ', price_rate: '2,4%', source_run_id: 'run0' }],
    evidence: [{ competitor: 'Залог 24', url: 'http://zalog24h.ru/', excerpt: 'выдача до 90% от рыночной стоимости', source_run_id: 'run0' }],
    source_quality: []
  });
  A.eq('one source across three URL spellings', ts.length, 1);
}

A.section('two social channels of DIFFERENT communities stay separate');
{
  const ts = targetsFor({
    competitors: [], offers: [],
    evidence: [
      { source_key: 'telegram_channel::rusmicrofinance', source_kind: 'telegram', source_name: 'rusmicrofinance', url: 'https://t.me/rusmicrofinance/1', excerpt: 'ренкинг МФО', evidence_id: 'e1' },
      { source_key: 'telegram_channel::probonds', source_kind: 'telegram', source_name: 'probonds', url: 'https://t.me/probonds/1', excerpt: 'облигации', evidence_id: 'e2' }
    ],
    source_quality: []
  });
  A.eq('two distinct channels', ts.length, 2);
}

A.section('a profiled competitor + a social channel with the SAME name is treated as ONE entity');
{
  // Same business reachable two ways is one competitor for comparison-threshold purposes (never inflates).
  const ts = targetsFor({
    competitors: [{ competitor: 'Залог 24', source_url: 'https://zalog24h.ru/', source_run_id: 'r1', quality: 'accepted', positioning: 'якорь' }],
    offers: [],
    evidence: [{ source_key: 'zalog24h.ru', source_name: 'Залог 24', url: 'https://zalog24h.ru/pts', excerpt: 'до 90%', evidence_id: 'e1', source_run_id: 'r1' }],
    source_quality: []
  });
  A.eq('one entity', ts.length, 1);
  A.ok('not marked evidence_only (a real profile exists)', !ts[0].evidence_input.source.evidence_only);
}

A.report('bridge-identity');
