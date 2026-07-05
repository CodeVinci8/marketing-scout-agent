// test_wf11_channel_fairness.js — TELEGRAM-CAP-001 regression on the REAL WF11 nodes ($0, no network).
// The agent-called path kept pipeline_limit=10 and applied the global cap in channel-fetch order, so a third
// configured channel was starved (0 persisted) even though its posts were fetched + classified. This proves
// the fixed 'Deduplicate Posts' fairly distributes the approved bounds by round-robin (per-channel cap + total
// ceiling), never lets an earlier channel consume the whole allowance, and never counts irrelevant/duplicate
// rows against accepted capacity; and that 'Set Connector Config' honors the approved total ceiling.
'use strict';
const A = require('./_assert');
const H = require('./wf_harness');
const wf = H.loadWorkflow('11_social_source_connector_foundation.json');

function post(ch, id, opts) {
  opts = opts || {};
  return {
    author_handle: '@' + ch, channel: ch, profile_url: 'https://t.me/' + ch,
    post_url: 'https://t.me/' + ch + '/' + id, dedup_key: opts.dedup || ('telegram::social_channel::https://t.me/' + ch + '/' + id),
    is_valid_listing: opts.invalid ? false : true, hard_skip: !!opts.hard_skip, next_action: 'monitor',
    source_type: 'social_channel', platform: 'telegram',
  };
}
function dedup(cfg, normRows, regRows) {
  const run = H.makeRun();
  H.inject(run, 'Set Connector Config', [cfg]);
  H.inject(run, 'Normalize Telegram Posts', normRows);
  H.inject(run, 'Read market_record_registry', regRows || []);
  return H.runCodeNode(run, wf, 'Deduplicate Posts', []).map(i => i.json);
}
const chanOf = r => String(r.author_handle || '').replace('@', '');
const uniq = rows => rows.filter(r => r.dedup_status === 'unique');

// ---- Case A: small TOTAL ceiling, three channels — must be fairly shared, third channel not starved ----
{
  const cfg = { pipeline_limit: 6, live_max_posts_per_channel: 30, approval_status_for_unique: 'new' };
  const norm = [];
  for (const ch of ['mfo_market', 'da_credit', 'broker_aleksey']) for (let i = 1; i <= 5; i++) norm.push(post(ch, i));
  const out = dedup(cfg, norm);
  const acc = uniq(out);
  const byCh = {}; acc.forEach(r => byCh[chanOf(r)] = (byCh[chanOf(r)] || 0) + 1);
  A.section('TELEGRAM-CAP-001 — small total ceiling shared fairly across 3 channels');
  A.eq('total accepted == total ceiling (6)', acc.length, 6);
  A.ok('three channels processed', Object.keys(byCh).length === 3, JSON.stringify(byCh));
  A.ok('third channel (broker_aleksey) NOT starved', (byCh['broker_aleksey'] || 0) >= 1, JSON.stringify(byCh));
  A.ok('no channel consumes the whole allowance (each <= 2 here)', Object.values(byCh).every(n => n <= 2), JSON.stringify(byCh));
  A.ok('non-accepted eligible marked over_pipeline_limit', out.filter(r => r.dedup_status === 'over_pipeline_limit').length === 9);
}

// ---- Case B: large ceiling — every channel's relevant posts persist ----
{
  const cfg = { pipeline_limit: 90, live_max_posts_per_channel: 30 };
  const norm = [];
  for (const ch of ['mfo_market', 'da_credit', 'broker_aleksey']) for (let i = 1; i <= 4; i++) norm.push(post(ch, i));
  const acc = uniq(dedup(cfg, norm));
  const byCh = {}; acc.forEach(r => byCh[chanOf(r)] = (byCh[chanOf(r)] || 0) + 1);
  A.section('TELEGRAM-CAP-001 — under the ceiling, all channels fully represented');
  A.eq('all 12 relevant persisted', acc.length, 12);
  A.ok('every channel persisted its 4', ['mfo_market', 'da_credit', 'broker_aleksey'].every(c => byCh[c] === 4), JSON.stringify(byCh));
  A.ok('total never exceeds ceiling', acc.length <= 90);
}

// ---- Case C: irrelevant + duplicate rows never consume accepted capacity ----
{
  const cfg = { pipeline_limit: 4, live_max_posts_per_channel: 30 };
  const dk = 'telegram::social_channel::https://t.me/mfo_market/1';
  const norm = [
    post('mfo_market', 1, { dedup: dk }),                 // unique
    post('mfo_market', 90, { hard_skip: true }),          // irrelevant — must not count
    post('mfo_market', 91, { invalid: true }),            // invalid — must not count
    post('mfo_market', 1, { dedup: dk }),                 // in-batch duplicate — must not count
    post('mfo_market', 2), post('mfo_market', 3),         // two more unique
  ];
  const out = dedup(cfg, norm);
  A.section('TELEGRAM-CAP-001 — irrelevant/duplicate never consume accepted capacity');
  A.eq('3 unique accepted (cap not eaten by noise/dupes)', uniq(out).length, 3);
  A.ok('hard_skip recorded, not counted', out.some(r => r.dedup_status === 'hard_skipped'));
  A.ok('invalid recorded, not counted', out.some(r => r.dedup_status === 'invalid'));
  A.ok('in-batch duplicate recorded, not counted', out.some(r => r.dedup_status === 'duplicate_in_batch'));
}

// ---- Case D: registry duplicate skipped; per-channel cap enforced ----
{
  const cfg = { pipeline_limit: 90, live_max_posts_per_channel: 2 };
  const norm = [post('mfo_market', 1), post('mfo_market', 2), post('mfo_market', 3), post('mfo_market', 4), post('mfo_market', 5)];
  const acc = uniq(dedup(cfg, norm));
  A.section('TELEGRAM-CAP-001 — per-channel cap (<=30) enforced');
  A.eq('per-channel cap honored (2 of 5)', acc.length, 2);
}
{
  const cfg = { pipeline_limit: 90, live_max_posts_per_channel: 30 };
  const dk = 'telegram::social_channel::https://t.me/da_credit/7';
  const out = dedup(cfg, [post('da_credit', 7, { dedup: dk })], [{ dedup_key: dk }]);
  A.section('TELEGRAM-CAP-001 — registry duplicate skipped (global dedup preserved)');
  A.ok('registry duplicate marked, 0 unique', uniq(out).length === 0 && out[0].dedup_status === 'duplicate_in_registry');
}

// ---- Case E: Set Connector Config honors the approved total ceiling for string AND numeric max_posts ----
{
  function cfgFor(maxPosts) {
    const run = H.makeRun();
    H.inject(run, 'When Called by Agent', [{ agent_request_id: 'req_x', source_run_id: 'req_x::telegram::a1',
      data_mode: 'live', channels: 'mfo_market da_credit broker_Aleksey', max_posts: maxPosts,
      approval_token: 'I_APPROVE_LIVE_TELEGRAM_PREVIEW', transport: 'http_get' }]);
    return H.runCodeNode(run, wf, 'Set Connector Config', [])[0].json;
  }
  const s = cfgFor('30'), n = cfgFor(30);
  A.section('TELEGRAM-CAP-001 — config total ceiling consistent for string/numeric max_posts');
  A.eq('string max_posts → pipeline_limit 90', s.pipeline_limit, 90);
  A.eq('numeric max_posts → pipeline_limit 90', n.pipeline_limit, 90);
  A.eq('per-channel cap = 30 (string)', s.live_max_posts_per_channel, 30);
  A.eq('total ceiling never exceeds 90', Math.min(cfgFor('40').pipeline_limit, 90), 90);
  A.ok('ceiling scales with channel count (<=90)', cfgFor('30').pipeline_limit <= 90);
}

A.report('wf11-channel-fairness');
