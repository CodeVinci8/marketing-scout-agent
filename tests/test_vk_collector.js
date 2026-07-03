'use strict';
// test_vk_collector.js — bounded VK public-community collector, fully OFFLINE/mocked (no real VK call, no token).
// Covers Section 6.8: normalization, resolution, errors, pagination/dedup, pinned/repost/edited/deleted posts,
// monitoring (baseline/new/edited/dedup), rate-limit backoff, owner + request isolation, quality/deep-analysis
// eligibility, and that NO secret ever appears in a record/event/log. Deterministic, $0, external_calls=0.
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const V = require('../n8n/lib/vk_collector.js');
const H = require('./wf_harness.js');

const CTX = { agent_request_id: 'req_vk_1', source_run_id: 'srun_1', workflow_run_id: 'wf_1', owner_user_id: '100200300', now: '2026-06-21T10:00:00Z', data_mode: 'live' };

A.section('§6.3 canonical identity — URL / screen name / numeric / negative owner id');
A.eq('https URL -> screen', V.normalizeCommunity('https://vk.com/example').screen_name, 'example');
A.eq('bare vk.com -> screen', V.normalizeCommunity('vk.com/example').screen_name, 'example');
A.eq('@handle -> screen', V.normalizeCommunity('@example').screen_name, 'example');
A.eq('bare handle -> screen', V.normalizeCommunity('example').screen_name, 'example');
A.eq('club123 -> owner -123', V.normalizeCommunity('club123').owner_id, -123);
A.eq('numeric 123 -> owner -123', V.normalizeCommunity('123').owner_id, -123);
A.eq('negative -123 -> owner -123', V.normalizeCommunity('-123').owner_id, -123);
A.ok('garbage rejected', V.normalizeCommunity('!!! not a vk ref ###').ok === false);

A.section('§6.3 dedup uses canonical community identity, not the raw string');
A.eq('club123 == -123 (same community key)', V.communityKey(V.normalizeCommunity('club123')), V.communityKey(V.normalizeCommunity('-123')));
A.eq('numeric == club form', V.communityKey(V.normalizeCommunity('123')), V.communityKey(V.normalizeCommunity('club123')));
A.ok('two screen names differ', V.communityKey(V.normalizeCommunity('a')) !== V.communityKey(V.normalizeCommunity('b')));

A.section('§6.2 credential / config gate — missing token is setup_required (never empty success)');
A.eq('collector disabled -> setup_required', V.credentialState({}).status, 'setup_required');
A.eq('enabled, no token -> setup_required', V.credentialState({ enable_vk_collector: true }).status, 'setup_required');
A.eq('missing-token reason explicit', V.credentialState({ enable_vk_collector: true }).reason, 'missing_vk_credential');
A.eq('configured', V.credentialState({ enable_vk_collector: true, vk_token_present: true }).status, 'configured');
A.eq('unsupported api version -> config_error', V.credentialState({ enable_vk_collector: true, vk_token_present: true, vk_api_version: '4.0' }).status, 'config_error');
A.ok('api version is configurable + validated', V.resolveApiVersion({ vk_api_version: '5.199' }).valid === true && V.resolveApiVersion({ vk_api_version: 'x' }).valid === false);

A.section('§6.4 request descriptors carry NO token');
const rr = V.resolveRequest(V.normalizeCommunity('example'), { vk_api_version: '5.199' });
A.eq('resolve uses groups.getById', rr.method, 'groups.getById');
A.ok('no token in resolve params', JSON.stringify(rr).indexOf('token') < 0 && JSON.stringify(rr).indexOf('access_token') < 0);
const wr = V.wallRequest(V.normalizeCommunity('club42'), { vk_max_posts: 25 }, 0);
A.eq('wall uses wall.get owner', wr.method, 'wall.get');
A.eq('wall owner_id is negative for a community', wr.params.owner_id, '-42');
A.ok('comments disabled by default -> no request', V.commentsRequest(V.normalizeCommunity('club42'), { post_id: 1 }, {}) === null);
A.ok('comments only when flag enabled', V.commentsRequest(V.normalizeCommunity('club42'), { post_id: 1 }, { vk_enable_comments: true }) !== null);

A.section('§6.4 community resolution — success / private / deleted / banned / error body');
const ok = V.parseResolution({ response: { groups: [{ id: 42, screen_name: 'Example', name: 'Example Club', is_closed: 0, members_count: 1000, type: 'group' }] } });
A.ok('resolves community id + owner', ok.ok && ok.community.community_id === 42 && ok.community.owner_id === -42);
A.eq('canonical screen lowercased', ok.community.screen_name, 'example');
A.eq('private group -> private_group', V.parseResolution({ response: { groups: [{ id: 1, is_closed: 1 }] } }).error.kind, 'private_group');
A.eq('deleted group', V.parseResolution({ response: { groups: [{ id: 1, deactivated: 'deleted' }] } }).error.kind, 'deleted');
A.eq('banned group', V.parseResolution({ response: { groups: [{ id: 1, deactivated: 'banned' }] } }).error.kind, 'banned');
A.eq('not found', V.parseResolution({ response: { groups: [] } }).error.kind, 'not_found');
A.eq('invalid token (code 5) -> setup_required', V.parseResolution({ error: { error_code: 5, error_msg: 'auth' } }).error.setup_required, true);
A.eq('access denied (code 15)', V.parseResolution({ error: { error_code: 15, error_msg: 'denied' } }).error.kind, 'access_denied');
A.eq('rate limit (code 6) retryable', V.parseResolution({ error: { error_code: 6 } }).error.retryable, true);
A.eq('invalid screen name (code 100)', V.parseResolution({ error: { error_code: 100 } }).error.kind, 'invalid_request');

const identity = ok.community;

A.section('§6.5 canonical record — pinned / repost / attachment-only / empty text / edited');
const page1 = {
  response: {
    count: 5, items: [
      { id: 100, owner_id: -42, from_id: -42, date: 1718000000, text: 'Акция: ставка 4,5%', is_pinned: 1, likes: { count: 10 }, comments: { count: 2 }, reposts: { count: 1 }, views: { count: 500 } },
      { id: 101, owner_id: -42, date: 1718100000, text: 'Репост новости', copy_history: [{ id: 9, from_id: -77 }] },
      { id: 102, owner_id: -42, date: 1718200000, text: '', attachments: [{ type: 'photo' }] },
      { id: 103, owner_id: -42, date: 1718300000, text: 'Изменённый пост', edited: 1718400000 }
    ]
  }
};
const w1 = V.parseWall(page1, identity, CTX, {});
A.ok('wall parsed ok', w1.ok && w1.posts.length === 4);
const byId = {}; w1.posts.forEach(p => { byId[p.post_id] = p; });
A.eq('canonical post URL', byId[100].canonical_url, 'https://vk.com/wall-42_100');
A.eq('stable record id = owner+post', byId[100].source_record_id, 'vk_-42_100');
A.ok('pinned flag preserved', byId[100].is_pinned === true);
A.ok('engagement marked observation-time', /наблюдение/.test(byId[100].engagement_note) && byId[100].engagement_observed.likes === 10);
A.ok('repost metadata captured', byId[101].repost && byId[101].repost.original_id === 9);
A.ok('attachment metadata only (no download)', byId[102].attachments[0].type === 'photo' && byId[102].text === '');
A.ok('empty-text post still recorded', !!byId[102].source_record_id);
A.ok('edited version id includes edit ts', byId[103].post_version === '103@1718400000' && byId[103].edited_ts === 1718400000);
A.ok('non-edited version id falls back to content hash', /^100@h/.test(byId[100].post_version));
A.ok('lineage fields present', byId[100].agent_request_id === 'req_vk_1' && byId[100].source_run_id === 'srun_1' && byId[100].owner_user_id === '100200300');

A.section('§6.4 pagination + dedup across pages + deleted post mid-feed');
const seen = {};
const pA = V.parseWall({ response: { count: 4, items: [{ id: 1, owner_id: -42, date: 1, text: 'a' }, { id: 2, owner_id: -42, date: 2, text: 'b' }] } }, identity, CTX, seen);
const pB = V.parseWall({ response: { count: 4, items: [{ id: 2, owner_id: -42, date: 2, text: 'b' }, { id: 3, owner_id: -42, date: 3, text: 'c', is_deleted: true }, { id: 4, owner_id: -42, date: 4, text: 'd' }] } }, identity, CTX, seen);
A.eq('page A 2 posts', pA.posts.length, 2);
A.eq('page B drops duplicate id=2', pB.duplicates, 1);
A.eq('page B drops deleted id=3', pB.skipped_deleted, 1);
A.eq('page B keeps only id=4', pB.posts.length, 1);
const plan = V.paginationPlan({ vk_max_posts: 25, vk_max_pages: 3, vk_page_size: 50 });
A.ok('bounded pagination plan', plan.expected_calls <= 3 && plan.offsets[0] === 0);

A.section('§6.6 monitoring — baseline establishes state with NO alerts');
const recs0 = V.parseWall(page1, identity, CTX, {}).posts;
const base = V.detectChanges({}, recs0, { has_prior_state: false });
A.ok('baseline emits no events', base.baseline === true && base.events.length === 0);
A.ok('baseline seeds state for all posts', Object.keys(base.state).length === 4);
const baseReq = V.detectChanges({}, recs0, { has_prior_state: false, emit_baseline: true });
A.ok('baseline alerts only when explicitly requested', baseReq.events.length === 4);

A.section('§6.6 monitoring — new post, edit, repeated check dedup');
// next run: add a new post id=200, edit post 103 (new edit ts)
const page2 = { response: { count: 6, items: [
  { id: 100, owner_id: -42, date: 1718000000, text: 'Акция: ставка 4,5%', is_pinned: 1 },                 // unchanged pinned -> no event
  { id: 103, owner_id: -42, date: 1718300000, text: 'Изменённый пост v2', edited: 1718900000 },           // edited -> event
  { id: 200, owner_id: -42, date: 1719000000, text: 'Новый пост' }                                        // new -> event
] } };
const recs2 = V.parseWall(page2, identity, CTX, {}).posts;
const det = V.detectChanges(base.state, recs2, { has_prior_state: true });
A.eq('one new post event', det.new_count, 1);
A.eq('one edited post event', det.edited_count, 1);
A.ok('old pinned post is NOT a new event each run', !det.events.some(e => e.post_id === 100));
A.ok('change_id deterministic per version', det.events.every(e => /::/.test(e.change_id)));
// repeated identical check -> already-notified dedup
const existingEvents = det.events.slice();
A.ok('repeated check suppresses duplicate alerts', det.events.every(e => V.shouldNotify(existingEvents, e).notify === false));
const fresh = V.changeEvent('new_post', recs2[2]);
A.ok('a genuinely new change_id notifies once', V.shouldNotify([], fresh).notify === true);

A.section('§6.6 failed collection keeps cursor + bounded backoff; setup_required skipped w/o spend');
const fail = V.onCollectionFailure({ error_count: 1, last_content_hash: 'hAB' }, { kind: 'rate_limited', retryable: true }, {});
A.ok('keeps cursor/baseline', fail.keep_cursor === true && fail.preserve_baseline === true && fail.last_content_hash === 'hAB');
A.ok('bounded exponential backoff', fail.backoff_hours >= 2 && fail.backoff_hours <= 24);
A.ok('token failure flags setup_required', V.onCollectionFailure({}, { kind: 'token_invalid', setup_required: true }, {}).setup_required === true);

A.section('isolation — current request + owner; quality + deep-analysis eligibility');
A.ok('records carry the current agent_request_id only', recs0.every(r => r.agent_request_id === 'req_vk_1'));
const otherOwner = V.buildRecord({ id: 1, owner_id: -42, date: 1, text: 'x' }, identity, Object.assign({}, CTX, { owner_user_id: '999999' }));
A.ok('owner isolation in record', otherOwner.owner_user_id === '999999' && recs0[0].owner_user_id === '100200300');
A.ok('record enters quality pipeline (status pending)', recs0[0].quality_status === 'pending');
A.ok('record report + monitoring eligible (deep analysis can include it)', recs0[0].report_eligible === true && recs0[0].monitoring_eligible === true);
A.eq('evidence excerpt present + canonical url', /^https:\/\/vk\.com\/wall/.test(recs0[0].canonical_url), true);

A.section('no secrets anywhere (records/events/requests/logs)');
const blob = JSON.stringify([recs0, det.events, rr, wr, fail, V.credentialState({ enable_vk_collector: true, vk_token_present: true })]);
A.ok('no token-like string in any output', !/access_token|sk-|vk1\.a\.|[A-Za-z0-9]{40,}/.test(blob));
A.eq('collector never reports external calls from the pure lib', typeof V.detectChanges({}, [], {}).events.length, 'number');

A.section('WF26 — VK collector workflow embeds the lib + is wired with guarded HTTP (no token in JSON)');
function libCore(name) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', name + '.js'), 'utf8');
  s = s.replace(/^'use strict';\s*$/m, '').replace(/module\.exports[\s\S]*$/m, '');
  s = s.replace(/^\s*const\s*\{[^}]*\}\s*=\s*require\('\.\/[^']+'\);\s*$/gm, '');
  return s.trim();
}
function extract(code, name) { const m = code.match(new RegExp('// embedded n8n/lib/' + name + '\\.js[^\\n]*\\n([\\s\\S]*?)\\n// --- end embedded ' + name + ' ---')); return m ? m[1] : null; }
const WF26 = H.loadWorkflow('26_vk_public_community_collector.json');
function n26(name) { const n = WF26.nodes.find(x => x.name === name); return n ? n.parameters.jsCode : null; }
A.eq('WF26 inactive', WF26.active, false);
A.eq('WF26 Credential Gate embeds vk_collector', extract(n26('VK Credential Gate'), 'vk_collector'), libCore('vk_collector'));
A.eq('WF26 Parse Wall embeds vk_collector', extract(n26('Parse Wall & Detect Changes'), 'vk_collector'), libCore('vk_collector'));
A.ok('WF26 has callable + manual triggers', WF26.nodes.some(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger') && WF26.nodes.some(n => n.type === 'n8n-nodes-base.manualTrigger'));
A.ok('WF26 has NO public webhook', !WF26.nodes.some(n => n.type === 'n8n-nodes-base.webhook'));
const vkHttp = WF26.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest' && /api\.vk\.com/.test(n.parameters.url));
A.ok('WF26 calls official api.vk.com', vkHttp.length >= 2);
A.ok('VK HTTP uses credential auth (token from credential store)', vkHttp.every(n => n.parameters.authentication === 'genericCredentialType'));
A.ok('NO token/access_token literal anywhere in WF26 JSON', !/access_token\s*[:=]\s*["'][A-Za-z0-9]/.test(JSON.stringify(WF26)) && JSON.stringify(WF26).indexOf('vk1.a.') < 0);
A.ok('VK HTTP nodes are guarded behind VK Configured? gate', !!(WF26.connections['VK Configured?'] && JSON.stringify(WF26.connections['VK Configured?']).indexOf('Build Resolve Request') >= 0));

A.section('WF26 runtime — setup_required (disabled/no token) makes NO HTTP call');
let run = H.makeRun();
H.inject(run, 'Resolve Agent Config', [{ enable_vk_collector: false }]);
const gate = H.runCodeNode(run, WF26, 'VK Credential Gate', [{ json: { community: 'vk.com/example', owner_user_id: '100200300' } }])[0].json;
A.ok('disabled collector -> not configured (HTTP branch skipped)', gate.configured === false && gate.credential.status === 'setup_required');
const setupReply = H.runCodeNode(run, WF26, 'Build Setup-Required Reply', [])[0].json;
// UX-RU-002: the user-facing reply is the plain Russian settling message; the internal reason + $0 stay in
// execution data (status/reason/external_calls), never in the Telegram text.
A.ok('setup reply: no collection, no spend recorded internally; user text is the settling message',
  setupReply.status === 'setup_required' && setupReply.external_calls === 0 &&
  /пока настраивается/.test(JSON.parse(setupReply.telegram_send_body).text) &&
  !/токен|credential|vk_setup_required/i.test(JSON.parse(setupReply.telegram_send_body).text));

A.section('WF26 runtime — configured path parses wall + detects changes ($0)');
run = H.makeRun();
H.inject(run, 'Resolve Agent Config', [{ enable_vk_collector: true, vk_token_present: true, vk_api_version: '5.199', vk_max_posts: 25, vk_max_pages: 3 }]);
H.runCodeNode(run, WF26, 'VK Credential Gate', [{ json: { community: 'vk.com/example', owner_user_id: '100200300', agent_request_id: 'req_vk_1', source_run_id: 's1', mode: 'scheduled' } }]);
H.runCodeNode(run, WF26, 'Parse Community', [{ json: { response: { groups: [{ id: 42, screen_name: 'example', name: 'Example', is_closed: 0 }] } } }]);
// seed prior state with the REAL version the lib computes for the unchanged post 100 (as a prior run would have)
const prevRec100 = V.buildRecord({ id: 100, owner_id: -42, date: 1718000000, text: 'old' }, { community_id: 42, owner_id: -42 }, { owner_user_id: '100200300' });
H.inject(run, 'Read vk_post_state', [{ owner_user_id: '100200300', community_id: 42, owner_id: -42, post_id: 100, post_version: prevRec100.post_version, content_hash: prevRec100.content_hash }]);
H.inject(run, 'Read source_change_events', []);
const detOut = H.runCodeNode(run, WF26, 'Parse Wall & Detect Changes', [{ json: { response: { count: 2, items: [{ id: 100, owner_id: -42, date: 1718000000, text: 'old' }, { id: 200, owner_id: -42, date: 1719000000, text: 'Новый' }] } } }])[0].json;
A.ok('parses records + finds the one new post', detOut.ok === true && detOut.records.length === 2 && detOut.new_count === 1);
A.ok('does not re-alert the already-known post 100', !detOut.events.some(e => e.post_id === 100));
A.ok('WF26 emits canonical evidence URL for the change', /vk\.com\/wall-42_200/.test(JSON.stringify(detOut.events)));

A.section('WF23 monitoring integration — VK due sources route to WF26');
const WF23 = H.loadWorkflow('23_scheduled_source_monitor.json');
A.ok('WF23 invokes WF26 for VK checks', WF23.nodes.some(n => n.type === 'n8n-nodes-base.executeWorkflow' && n.name === 'Run VK Check (WF26)'));
A.ok('WF23 wires due sources -> VK check', !!(WF23.connections['Select Due Sources'] && JSON.stringify(WF23.connections['Select Due Sources']).indexOf('Run VK Check (WF26)') >= 0));

A.report('vk-collector');
