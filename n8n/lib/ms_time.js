'use strict';
// ============================================================================================================
// ms_time.js — single source of truth for Marketing Scout system timestamps.
//
// Product timezone is Europe/Moscow (override with env MS_TIMEZONE). System-generated timestamps are PERSISTED
// as RFC3339 with the zone's offset, e.g. "2026-06-23T15:04:05.000+03:00". User-facing Telegram timestamps are
// rendered in Russian as "DD.MM.YYYY HH:mm МСК".
//
// Offsets come from the IANA tz database via Intl.DateTimeFormat — NOT a hard-coded "+3 hours" arithmetic
// shortcut — so the helper stays correct if the zone's rules ever change and works for any IANA zone the
// operator configures. Multi-timezone per-user preferences MAY be added later; the current product timezone is
// Europe/Moscow.
//
// Embeddable: no external requires, all top-level functions, single module.exports at the bottom (so the
// workflow generators can inline it into n8n Code nodes between drift markers, like the other libs).
// ============================================================================================================

var DEFAULT_TZ = 'Europe/Moscow';

function resolveTz(env) {
  env = env || {};
  var tz = String(env.MS_TIMEZONE == null ? '' : env.MS_TIMEZONE).trim();
  return tz || DEFAULT_TZ;
}

function pad2(n) { n = Math.floor(Math.abs(Number(n) || 0)); return (n < 10 ? '0' : '') + n; }
function pad3(n) { n = Math.floor(Math.abs(Number(n) || 0)); return (n < 10 ? '00' : (n < 100 ? '0' : '')) + n; }

// minutes east of UTC for `date` in `tz`, derived from the IANA database via Intl (never hard-coded).
function tzOffsetMinutes(date, tz) {
  var dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  var map = {};
  dtf.formatToParts(date).forEach(function (p) { map[p.type] = p.value; });
  var hh = (+map.hour) % 24;     // some ICU builds render midnight as "24"
  var asUTC = Date.UTC(+map.year, (+map.month) - 1, +map.day, hh, +map.minute, +map.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

function offsetLabel(mins) {
  var sign = mins < 0 ? '-' : '+';
  var a = Math.abs(mins);
  return sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}

// instant (epoch ms) whose WALL-CLOCK in `tz` is the given Y-M-D H:M:S.mmm. Uses the IANA offset at ~that time
// (one correction pass — exact for fixed-offset zones like Europe/Moscow, and stable away from DST seams).
function wallToInstant(y, mo, d, h, mi, s, ms, tz) {
  var provUTC = Date.UTC(y, mo - 1, d, h, mi, s, ms || 0);
  var off = tzOffsetMinutes(new Date(provUTC), tz);
  return provUTC - off * 60000;
}

// Accept Date | epoch-number | parseable string and return a Date (or null). For STRINGS this routes through
// instantOf, so offset-less / locale renderings are interpreted in the product timezone.
function toDate(input, env) {
  if (input instanceof Date) return isFinite(input.getTime()) ? input : null;
  if (typeof input === 'number') return isFinite(input) ? new Date(input) : null;
  var ms = instantOf(input, env);
  return isFinite(ms) ? new Date(ms) : null;
}

// Robust parse of a timestamp VALUE to epoch ms; NaN if not a recognizable timestamp.
//  - explicit offset / "Z"               -> exact instant
//  - ISO-ish without offset              -> interpreted as wall-clock in the product timezone
//  - "DD.MM.YYYY[ HH:mm[:ss]]" (RU/EU)   -> wall-clock in the product timezone (Google/Sheets RU rendering)
//  - "M/D/YYYY[ HH:mm[:ss]]" (en-US)     -> wall-clock in the product timezone (Google/Sheets US rendering)
//  - bare numbers / Date objects: Date -> getTime; number -> NaN (ambiguous, never coerced — mirrors the
//    Stage 3C comparator policy of not treating arbitrary numbers as instants)
function instantOf(value, env) {
  if (value instanceof Date) return isFinite(value.getTime()) ? value.getTime() : NaN;
  if (value == null) return NaN;
  if (typeof value === 'number') return NaN;
  var tz = resolveTz(env);
  var s = String(value).trim();
  if (s === '') return NaN;
  var m;
  // explicit offset or Z anywhere at the end
  if (/(?:[zZ]|[+\-]\d{2}:?\d{2})$/.test(s)) { var t = Date.parse(s); return isFinite(t) ? t : NaN; }
  // ISO-ish, no offset: YYYY-MM-DD[ T]HH:mm[:ss[.fff]]
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/))) {
    var msv = m[7] ? Number((m[7] + '00').slice(0, 3)) : 0;
    return wallToInstant(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), msv, tz);
  }
  // RU/EU dotted: DD.MM.YYYY[ HH:mm[:ss]]
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
    return wallToInstant(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), 0, tz);
  }
  // en-US slashed: M/D/YYYY[ HH:mm[:ss]]
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
    return wallToInstant(+m[3], +m[1], +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), 0, tz);
  }
  return NaN;
}

// RFC3339 with the product-timezone offset, e.g. "2026-06-23T15:04:05.000+03:00". Empty string on bad input.
function toRFC3339(input, env) {
  var tz = resolveTz(env);
  var d = toDate(input, env); if (!d) return '';
  var off = tzOffsetMinutes(d, tz);
  var local = new Date(d.getTime() + off * 60000);
  return local.getUTCFullYear() + '-' + pad2(local.getUTCMonth() + 1) + '-' + pad2(local.getUTCDate()) +
    'T' + pad2(local.getUTCHours()) + ':' + pad2(local.getUTCMinutes()) + ':' + pad2(local.getUTCSeconds()) +
    '.' + pad3(local.getUTCMilliseconds()) + offsetLabel(off);
}

// User-facing Russian display, e.g. "23.06.2026 15:04 МСК" (or " ±HH:MM" suffix for a non-Moscow zone).
function toDisplay(input, env) {
  var tz = resolveTz(env);
  var d = toDate(input, env); if (!d) return '';
  var off = tzOffsetMinutes(d, tz);
  var local = new Date(d.getTime() + off * 60000);
  var suffix = (tz === DEFAULT_TZ) ? ' МСК' : (' ' + offsetLabel(off));
  return pad2(local.getUTCDate()) + '.' + pad2(local.getUTCMonth() + 1) + '.' + local.getUTCFullYear() +
    ' ' + pad2(local.getUTCHours()) + ':' + pad2(local.getUTCMinutes()) + suffix;
}

// "now" helpers (a Date may be injected for deterministic tests).
function nowRFC3339(env, dateLike) { return toRFC3339(dateLike != null ? dateLike : new Date(), env); }
function nowDisplay(env, dateLike) { return toDisplay(dateLike != null ? dateLike : new Date(), env); }

// true iff two timestamp values denote the same instant (offset-aware; product-tz for offset-less forms).
function sameInstant(a, b, env) {
  var ia = instantOf(a, env), ib = instantOf(b, env);
  return isFinite(ia) && isFinite(ib) && ia === ib;
}

module.exports = {
  DEFAULT_TZ: DEFAULT_TZ,
  resolveTz: resolveTz,
  tzOffsetMinutes: tzOffsetMinutes,
  offsetLabel: offsetLabel,
  wallToInstant: wallToInstant,
  toDate: toDate,
  instantOf: instantOf,
  toRFC3339: toRFC3339,
  toDisplay: toDisplay,
  nowRFC3339: nowRFC3339,
  nowDisplay: nowDisplay,
  sameInstant: sameInstant
};
