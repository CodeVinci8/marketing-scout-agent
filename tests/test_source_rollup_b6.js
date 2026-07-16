'use strict';
// B6 — the run's TERMINAL status is decided ONLY by the REQUESTED sources. Optional/unrequested branches can't
// downgrade a successful requested run; a failed requested source names itself in the Russian delivery message.
const A = require('./_assert.js');
const SA = require('../n8n/lib/source_adapter.js');
const CR = require('../n8n/lib/conversation_response.js');

function res(source, status, opts) { opts = opts || {}; return { source: source, status: status, quarantined: !!opts.quarantined, items_written: opts.written == null ? (status === 'ok' ? 5 : 0) : opts.written }; }

A.section('rollupCollection — outcome scoped to requested sources');
{
  // one requested website ok; an OPTIONAL telegram that failed must NOT make it partial
  const r1 = SA.rollupCollection([res('website', 'ok'), res('telegram', 'failed')], ['website']);
  A.eq('requested website ok + optional TG failed => complete', r1.outcome, 'complete');
  A.eq('no requested source failed', r1.failed_sources.length, 0);

  // one of three requested sources fails => partial, names the failed source
  const r2 = SA.rollupCollection([res('website', 'ok'), res('telegram', 'ok'), res('vk', 'failed')], ['website', 'telegram', 'vk']);
  A.eq('one requested source failed => partial', r2.outcome, 'partial');
  A.includes('failed_sources names vk', r2.failed_sources, 'vk');
  A.eq('two requested ok', r2.sources_ok, 2);

  // all requested sources fail => failed (not no_data)
  const r3 = SA.rollupCollection([res('website', 'failed'), res('telegram', 'failed')], ['website', 'telegram']);
  A.eq('all requested sources failed => failed', r3.outcome, 'failed');
  A.eq('both named', r3.failed_sources.length, 2);

  // a requested source that ran but returned nothing (no error) => no_data
  const r4 = SA.rollupCollection([res('website', 'empty', { written: 0 })], ['website']);
  A.eq('requested source empty, no error => no_data', r4.outcome, 'no_data');

  // quarantined requested source counts as failed-for-the-user
  const r5 = SA.rollupCollection([res('website', 'ok'), res('telegram', 'ok', { quarantined: true })], ['website', 'telegram']);
  A.eq('quarantined requested source => partial', r5.outcome, 'partial');
  A.includes('quarantined telegram named', r5.failed_sources, 'telegram');

  // legacy behaviour when no requestedSources given: all results decide
  const r6 = SA.rollupCollection([res('website', 'ok'), res('telegram', 'failed')]);
  A.eq('no requested list => legacy (all decide) => partial', r6.outcome, 'partial');

  // a single successful website request is completed (the canonical B6 case)
  const r7 = SA.rollupCollection([res('website', 'ok')], ['website']);
  A.eq('single requested website ok => complete', r7.outcome, 'complete');
}

A.section('deliveryBody — Russian message names the failed requested source, no raw keys/errors');
{
  const partialMsg = CR.deliveryBody({ report_markdown: 'Готовый отчёт.' }, { final_state: 'partial', records_reported: 3, failed_sources: ['vk'] }, []);
  A.ok('partial message names VK in Russian', partialMsg.indexOf('VK-сообщества') >= 0);
  A.ok('no raw source key "vk" leaked', !/\bvk\b/.test(partialMsg));
  A.ok('says it is partial', partialMsg.indexOf('частичный') >= 0);

  const failedMsg = CR.deliveryBody({}, { final_state: 'failed', records_reported: 0, failed_sources: ['website', 'telegram'] }, []);
  A.ok('failed message names both sources in Russian', failedMsg.indexOf('сайты') >= 0 && failedMsg.indexOf('Telegram-каналы') >= 0);
  A.ok('failed message is user-safe (no adapter error)', failedMsg.indexOf('collector_unavailable') < 0 && failedMsg.indexOf('adapter') < 0);

  const okMsg = CR.deliveryBody({ report_markdown: 'Отчёт.' }, { final_state: 'completed', records_reported: 4, failed_sources: [] }, []);
  A.ok('completed message has no failure line', okMsg.indexOf('частичный') < 0 && okMsg.indexOf('Не удалось') < 0);
}

A.report('source-rollup-b6');
