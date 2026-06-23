// test_ms_time.js — Moscow-time helper (Europe/Moscow product timezone) — offline, $0, no network.
'use strict';
const A = require('./_assert.js');
const T = require('../n8n/lib/ms_time.js');

A.section('1. RFC3339 output carries the Moscow offset (+03:00), IANA-derived');
A.eq('12:04Z -> 15:04 +03:00', T.toRFC3339('2026-06-23T12:04:05.000Z'), '2026-06-23T15:04:05.000+03:00');
A.ok('output ends with +03:00', /\+03:00$/.test(T.toRFC3339('2026-06-23T12:04:05.000Z')));
A.ok('offset for any 2026 date is +03:00 (Moscow has no DST)', T.offsetLabel(T.tzOffsetMinutes(new Date('2026-01-15T00:00:00Z'), 'Europe/Moscow')) === '+03:00' && T.offsetLabel(T.tzOffsetMinutes(new Date('2026-07-15T00:00:00Z'), 'Europe/Moscow')) === '+03:00');
A.ok('offset is NOT a hard-coded +3 (env override yields the configured zone)', T.toRFC3339('2026-06-23T12:04:05.000Z', { MS_TIMEZONE: 'UTC' }) === '2026-06-23T12:04:05.000+00:00');
A.eq('a Date object is accepted', T.toRFC3339(new Date('2026-06-23T12:04:05.000Z')), '2026-06-23T15:04:05.000+03:00');
A.eq('an epoch-ms number is accepted', T.toRFC3339(Date.parse('2026-06-23T12:04:05.000Z')), '2026-06-23T15:04:05.000+03:00');

A.section('2. user-facing Russian display contains МСК');
A.eq('display format DD.MM.YYYY HH:mm МСК', T.toDisplay('2026-06-23T12:04:05.000Z'), '23.06.2026 15:04 МСК');
A.ok('display ends with МСК', / МСК$/.test(T.toDisplay('2026-06-23T12:04:05.000Z')));
A.ok('non-Moscow zone shows numeric offset, not МСК', T.toDisplay('2026-06-23T12:04:05.000Z', { MS_TIMEZONE: 'UTC' }).indexOf('МСК') < 0);

A.section('3. midnight / date-boundary conversion');
A.eq('21:30Z on 31 Dec -> 00:30 +03:00 next day', T.toRFC3339('2026-12-31T21:30:00.000Z'), '2027-01-01T00:30:00.000+03:00');
A.eq('display crosses the date boundary', T.toDisplay('2026-12-31T21:30:00.000Z'), '01.01.2027 00:30 МСК');
A.eq('date-only -> Moscow midnight', T.toRFC3339('2026-06-23'), '2026-06-23T00:00:00.000+03:00');

A.section('4. instant comparison: Z vs +03:00 vs offset-less vs locale renderings');
const utc = '2026-06-23T12:04:05.000Z';
A.ok('Z == +03:00 (same instant)', T.sameInstant(utc, '2026-06-23T15:04:05.000+03:00'));
A.ok('Z == offset-less ISO interpreted as Moscow wall-clock', T.sameInstant(utc, '2026-06-23T15:04:05'));
A.ok('Z == RU dotted render (DD.MM.YYYY HH:mm:ss) as Moscow', T.sameInstant(utc, '23.06.2026 15:04:05'));
A.ok('Z == US slashed render (M/D/YYYY HH:mm:ss) as Moscow', T.sameInstant(utc, '6/23/2026 15:04:05'));
A.ok('different instants are not equal', !T.sameInstant(utc, '2026-06-23T16:04:05.000+03:00'));
A.ok('instantOf("Z") === instantOf("+03:00")', T.instantOf(utc) === T.instantOf('2026-06-23T15:04:05.000+03:00'));

A.section('5. fail-closed parsing (no false instants)');
A.ok('free text -> NaN', !isFinite(T.instantOf('competitor ПТС Москва')));
A.ok('bare number -> NaN (never coerced)', !isFinite(T.instantOf(1750000000000)));
A.ok('empty -> NaN', !isFinite(T.instantOf('')) && !isFinite(T.instantOf(null)) && !isFinite(T.instantOf(undefined)));
A.ok('bad input -> empty RFC3339/display', T.toRFC3339('nope') === '' && T.toDisplay('nope') === '');

A.section('6. nowRFC3339 / nowDisplay accept an injected Date (deterministic)');
A.eq('nowRFC3339 with injected date', T.nowRFC3339({}, new Date('2026-06-23T12:04:05.000Z')), '2026-06-23T15:04:05.000+03:00');
A.eq('nowDisplay with injected date', T.nowDisplay({}, new Date('2026-06-23T12:04:05.000Z')), '23.06.2026 15:04 МСК');

A.report('ms-time');
