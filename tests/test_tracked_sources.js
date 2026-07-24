'use strict';
// test_tracked_sources.js — F-9 test debt.
//
// tracked_sources.js is embedded in NINE production workflows (WF18/19/20/21/22/23/25/26/27) and had no
// dedicated suite: it was only ever exercised incidentally. It owns owner-scoped source identity, the
// availability gate, duplicate suppression and status transitions — all of which are user-visible and
// owner-isolation sensitive.
const A = require('./_assert.js');
const TS = require('../n8n/lib/tracked_sources.js');

const CFG_ALL = { source_allowlist: ['website', 'telegram', 'vk'], enable_telegram_collector: true, enable_vk: true, monitor_interval_hours: 24 };
const CFG_WEB_ONLY = { source_allowlist: ['website'], enable_telegram_collector: false, enable_vk: false };
const ctx = (over) => Object.assign({ owner_user_id: '1188830082', chat_id: '1188830082', ts: '2026-07-22T21:00:00.000Z', cfg: CFG_ALL }, over || {});

A.section('normalizeSourceRef — one canonical key per real-world source');
{
  const cases = [
    ['https://zalog24h.ru/pts/', 'website', 'website::zalog24h.ru'],
    ['https://WWW.Zalog24H.ru', 'website', 'website::zalog24h.ru'],
    ['zalog24h.ru', 'website', 'website::zalog24h.ru'],
    ['https://t.me/rusmicrofinance', 'telegram_channel', 'telegram_channel::rusmicrofinance'],
    ['t.me/RusMicroFinance/', 'telegram_channel', 'telegram_channel::rusmicrofinance'],
    ['@rusmicrofinance', 'telegram_channel', 'telegram_channel::rusmicrofinance'],
    ['https://vk.com/sovcombank', 'vk_community', 'vk_community::sovcombank'],
    ['vk.com/SovcomBank/', 'vk_community', 'vk_community::sovcombank']
  ];
  cases.forEach(([raw, platform, key]) => {
    const n = TS.normalizeSourceRef(raw);
    A.eq('platform for ' + raw, n.platform, platform);
    A.eq('key for ' + raw, n.key, key);
  });
  // The same channel written four ways must collapse to ONE key, or the registry silently duplicates.
  const keys = ['https://t.me/probonds', 't.me/probonds', '@probonds', 'https://t.me/probonds/'].map((r) => TS.normalizeSourceRef(r).key);
  A.eq('four spellings collapse to one key', new Set(keys).size, 1);
  A.eq('unparseable input yields no key', TS.normalizeSourceRef('   ').key, '');
}

A.section('addSource — availability gate, duplicates, owner scoping');
{
  let r = TS.addSource([], 'https://zalog24h.ru', ctx());
  A.ok('website added', r.added);
  A.eq('status active', r.source.status, 'active');
  A.ok('audit row emitted', !!r.audit && r.audit.event === 'source_add');
  A.eq('owner recorded', r.source.owner_user_id, '1188830082');

  // Duplicate must NOT create a second row.
  const r2 = TS.addSource(r.sources, 'https://WWW.zalog24h.ru/some/page', ctx());
  A.ok('duplicate rejected', !r2.added);
  A.eq('reason', r2.reason, 'already_tracked');
  A.eq('registry still has one row', r2.sources.length, 1);

  // A different owner tracking the SAME source is a separate row (owner isolation).
  const r3 = TS.addSource(r.sources, 'https://zalog24h.ru', ctx({ owner_user_id: '999' }));
  A.ok('other owner may track the same source', r3.added);
  A.eq('two rows now', r3.sources.length, 2);
  A.eq('owner A sees only their own', TS.listSources(r3.sources, '1188830082').length, 1);
  A.eq('owner B sees only their own', TS.listSources(r3.sources, '999').length, 1);

  // Platform gating must be honest rather than silently accepting an uncollectable source.
  const vk = TS.addSource([], 'https://vk.com/sovcombank', ctx({ cfg: CFG_WEB_ONLY }));
  A.ok('VK rejected when not allowlisted', !vk.added);
  A.eq('honest reason', vk.reason, 'platform_unavailable');

  // Allowlisted but collector disabled => visible yet honestly not-yet-monitored.
  const tg = TS.addSource([], '@probonds', ctx({ cfg: { source_allowlist: ['website', 'telegram'], enable_telegram_collector: false } }));
  if (tg.added) A.eq('telegram without a collector is setup_required', tg.source.status, 'setup_required');
  else A.eq('or refused with an honest reason', tg.reason, 'platform_unavailable');

  A.ok('garbage input refused', !TS.addSource([], '   ', ctx()).added);
}

A.section('status transitions are owner-scoped');
{
  const base = TS.addSource([], 'https://zalog24h.ru', ctx()).sources;
  const key = base[0].key;

  const paused = TS.setSourceStatus(base, key, 'paused', ctx());
  A.eq('paused', TS.listSources(paused.sources, '1188830082')[0].status, 'paused');

  const resumed = TS.setSourceStatus(paused.sources, key, 'active', ctx());
  A.eq('resumed', TS.listSources(resumed.sources, '1188830082')[0].status, 'active');

  const removed = TS.setSourceStatus(resumed.sources, key, 'removed', ctx());
  A.eq('a removed source disappears from the listing', TS.listSources(removed.sources, '1188830082').length, 0);

  // A foreign owner must never be able to mutate someone else's source.
  const foreign = TS.setSourceStatus(base, key, 'removed', ctx({ owner_user_id: '999' }));
  A.eq("foreign owner cannot remove another owner's source", TS.listSources(foreign.sources, '1188830082').length, 1);
}

A.section('parseSourceOp — Russian intents map to registry operations');
{
  const op = (t) => TS.parseSourceOp(t).op;
  A.eq('list', op('покажи мои источники'), 'list');
  A.eq('list (bare)', op('источники'), 'list');
  A.eq('add with url', op('добавь https://zalog24h.ru'), 'add');
  A.eq('add a telegram handle', op('добавь @probonds'), 'add');
  A.eq('pause', op('поставь на паузу zalog24h.ru'), 'pause');
  A.eq('resume', op('возобнови zalog24h.ru'), 'resume');
  A.eq('remove', op('удали zalog24h.ru'), 'remove');
  A.eq('check', op('проверь zalog24h.ru'), 'check');
  A.eq('unknown text defaults to the safe read-only op', op('здравствуйте'), 'list');
  A.eq('the ref is extracted for add', TS.parseSourceOp('добавь https://zalog24h.ru/pts').arg.indexOf('zalog24h.ru') >= 0, true);
}

A.report('tracked-sources');
