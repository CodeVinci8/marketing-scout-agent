'use strict';
// test_report_text_safety.js — WIP3-D ownership-safe recommendations + WIP3-F damaged-fragment detection.
const A = require('./_assert');
const TS = require('../n8n/lib/report_text_safety.js');

A.section('WIP3-D — ownership-safe recommendations (never publish inside a third-party source)');
{
  const bad = 'Разместить в канале t.me/banksta контент о снижении ставок';
  const safe = TS.ownershipSafeRecommendationRu(bad);
  A.ok('rewrites third-party publish', safe.indexOf('Разместить в канале t.me/banksta') < 0);
  A.ok('уses ownership-safe wording', /Подготовить для собственного канала/.test(safe));
  A.ok('keeps the source as a SIGNAL reference', safe.indexOf('t.me/banksta') >= 0);

  A.ok('VK third-party publish rewritten', /собственного канала/.test(TS.ownershipSafeRecommendationRu('Опубликовать в vk.com/sovcombank пост про акцию')));
  A.ok('website publish rewritten', /собственного канала/.test(TS.ownershipSafeRecommendationRu('Выложить на autolombardn1.ru материал')));

  // already-safe recommendations are untouched
  const good = 'Подготовить для собственного канала материал на основе сигнала из t.me/banksta.';
  A.eq('already-safe is unchanged', TS.ownershipSafeRecommendationRu(good), good);
  const noSrc = 'Добавить калькулятор займа на собственный сайт';
  A.eq('no third-party source -> unchanged', TS.ownershipSafeRecommendationRu(noSrc), noSrc);
  const analyze = 'Проанализировать сигналы из t.me/banksta для собственной стратегии';
  A.eq('analysis mention (no publish verb) -> unchanged', TS.ownershipSafeRecommendationRu(analyze), analyze);
}

A.section('WIP3-F — damaged/incomplete commercial fragments excluded from facts');
{
  // documented regression
  A.eq('«пониженна» -> damaged', TS.fragmentQuality('пониженна'), 'damaged');
  A.ok('«пониженна» isDamaged', TS.isDamagedFragment('пониженна'));
  A.ok('rate described by a truncated word -> damaged', TS.isDamagedFragment('Ставка: пониженна'));
  A.ok('dangling hyphen -> damaged', TS.isDamagedFragment('Кредит под залог автомобиля -'));
  A.ok('ends on a preposition -> damaged', TS.isDamagedFragment('Займ выдаётся под'));
  A.ok('lead-in with no value -> damaged', TS.isDamagedFragment('Ставка от'));

  // real short facts must survive
  A.eq('«Ставка от 3% в месяц» -> ok', TS.fragmentQuality('Ставка от 3% в месяц'), 'ok');
  A.eq('«Займы до 5 млн рублей» -> ok', TS.fragmentQuality('Займы до 5 млн рублей'), 'ok');
  A.eq('«Займ под залог ПТС» -> ok', TS.fragmentQuality('Займ под залог ПТС'), 'ok');
  A.eq('«Одобрение за 30 минут без справок» -> ok', TS.fragmentQuality('Одобрение за 30 минут без справок'), 'ok');
  A.eq('«До 90% стоимости автомобиля» -> ok', TS.fragmentQuality('До 90% стоимости автомобиля'), 'ok');
  A.eq('empty is not a "damaged fact"', TS.isDamagedFragment(''), false);
}

A.report('report-text-safety');
