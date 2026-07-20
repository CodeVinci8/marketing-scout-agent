// test_wf26_vk_parse.js — VK-PARSE-001 regression on the REAL WF26 "Parse Wall & Detect Changes" node ($0).
// LIVE-EXPOSED defect: the node's MAIN input is 'Read source_change_events' (linear chain
// VK wall.get -> Read vk_post_state -> Read source_change_events -> Parse), so $json was a change-events sheet
// row, NOT the wall.get response. parseWall($json) read `.response.items` off the wrong object -> 0 posts, so
// a live VK collection persisted 0 vk_posts even though wall.get returned real posts. Prior unit tests injected
// the wall response as $json directly, masking the wiring bug. This proves the node now reads the wall response
// from $('VK wall.get') and shapes every real post regardless of what flows in as $json.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const wf = H.loadWorkflow('26_vk_public_community_collector.json');

const identity = {
  ok: true, platform: 'vk', source_type: 'vk_community_wall', community_id: 236140557,
  screen_name: 'kredit874', owner_id: -236140557, canonical_url: 'https://vk.com/kredit874',
  display_name: 'Кредитный брокер', key: 'vk_community_wall::kredit874', members_count: 14935, type: 'group',
};
const nowSec = Math.floor(Date.now() / 1000);
function post(id, text) { return { id, owner_id: -236140557, from_id: -236140557, date: nowSec - 3600, text, likes: { count: 1 }, comments: { count: 0 }, reposts: { count: 0 }, views: { count: 100 } }; }
const wallResponse = { response: { count: 2, items: [post(308, 'До 100.000 рублей с любой КИ за 5 минут'), post(310, 'Кредитный брокер: помощь в получении кредита')] } };

function runParse(dollarJson) {
  const run = H.makeRun();
  H.inject(run, 'Parse Community', [{
    resolved: true, configured: true, identity, mode: 'collect', data_mode: 'live',
    agent_request_id: 'req_vk', source_run_id: 'req_vk::vk::kredit874', workflow_run_id: 'w', owner_user_id: 'o',
  }]);
  H.inject(run, 'VK wall.get', [wallResponse]);            // the REAL wall response lives here
  H.inject(run, 'Read vk_post_state', []);
  H.inject(run, 'Read source_change_events', [{ change_id: 'legacy_1', row_number: 1 }]);
  return H.runCodeNode(run, wf, 'Parse Wall & Detect Changes', [dollarJson])[0].json;
}

A.section('VK-PARSE-001 — wall posts parsed from VK wall.get even when $json is a change-events row');
// simulate the REAL wiring: $json = a source_change_events row (NOT the wall response)
const out = runParse({ json: { row_number: 1, change_id: 'legacy_1', platform: 'vk' } });
A.ok('parse ok', out.ok === true, JSON.stringify(out.error || {}));
A.eq('all real posts parsed into records (read from VK wall.get, not $json)', (out.records || []).length, 2);
A.ok('records carry canonical VK post URLs', (out.records || []).every(r => /vk\.com\/wall-?\d+_\d+/.test(String(r.canonical_url || ''))), JSON.stringify((out.records || []).map(r => r.canonical_url)));

A.section('VK-PARSE-001 — still parses when $json is empty (defensive)');
const out2 = runParse({ json: {} });
A.eq('records parsed from wall.get with empty $json', (out2.records || []).length, 2);

A.report('wf26-vk-parse');
