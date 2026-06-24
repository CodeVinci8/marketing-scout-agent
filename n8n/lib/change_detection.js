'use strict';
// change_detection.js — classify what ACTUALLY changed between two source snapshots (Section 31 / 6.2).
//
// source_monitor.applyCheckResult flags "the content hash differs"; that is too blunt to alert on (a tracking
// param or whitespace edit would fire). This module classifies the change at the FIELD level so the monitor
// alerts only on meaningful change and suppresses cosmetic noise. Pure + deterministic + self-contained, $0.
//
// A snapshot is a small normalized object: { available, status, price, title, body }. Returns one of:
//   no_change | cosmetic | content | price_increase | price_decrease | status_change | source_failure |
//   source_recovery  — with old/new values where known.

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
// "4,5%" / " 4.5 % " -> 4.5 ; non-numeric -> null (never fabricate).
function priceNum(v) { var s = str(v).replace('%', '').replace(',', '.').replace(/[^0-9.]/g, ' ').trim().split(/\s+/)[0]; if (s === '') return null; var n = Number(s); return isFinite(n) ? n : null; }
// strip cosmetic noise: collapse whitespace, drop html tags, drop tracking query params, lowercase.
function meaningfulText(v) {
  return low(v).replace(/<[^>]+>/g, ' ').replace(/[?&](utm_[a-z]+|gclid|fbclid|_ga|sessionid)=[^&\s]*/g, '').replace(/\s+/g, ' ').trim();
}
function meaningfulKey(snap) {
  snap = snap || {};
  return JSON.stringify({ status: low(snap.status), price: priceNum(snap.price), title: meaningfulText(snap.title), body: meaningfulText(snap.body) });
}

// classify(prev, next): prev may be null/baseline. Returns { type, meaningful, old, new, field }.
function classify(prev, next) {
  next = next || {};
  // availability transitions take priority
  if (next.available === false) {
    if (!prev || prev.available !== false) return { type: 'source_failure', meaningful: true, field: 'available', old: prev ? prev.available : null, new: false };
    return { type: 'no_change', meaningful: false, field: 'available', old: false, new: false };
  }
  if (prev && prev.available === false && next.available !== false) {
    return { type: 'source_recovery', meaningful: true, field: 'available', old: false, new: true };
  }
  if (!prev) return { type: 'baseline', meaningful: false, field: null, old: null, new: null };

  // price: numeric direction
  var p0 = priceNum(prev.price), p1 = priceNum(next.price);
  if (p0 != null && p1 != null && p0 !== p1) {
    return { type: p1 > p0 ? 'price_increase' : 'price_decrease', meaningful: true, field: 'price', old: p0, new: p1 };
  }
  // status
  if (low(prev.status) !== low(next.status) && (prev.status != null || next.status != null)) {
    return { type: 'status_change', meaningful: true, field: 'status', old: str(prev.status), new: str(next.status) };
  }
  // meaningful text change vs cosmetic
  var sameMeaningful = meaningfulKey(prev) === meaningfulKey(next);
  if (sameMeaningful) {
    // raw differs but meaningful key identical => cosmetic; identical raw => no change
    var rawSame = JSON.stringify(prev) === JSON.stringify(next);
    return { type: rawSame ? 'no_change' : 'cosmetic', meaningful: false, field: null, old: null, new: null };
  }
  return { type: 'content', meaningful: true, field: 'content', old: meaningfulText(prev.title || prev.body).slice(0, 60), new: meaningfulText(next.title || next.body).slice(0, 60) };
}

// Should we ALERT on this classification? (meaningful + above any configured price threshold + not in cooldown).
function shouldAlert(cls, cfg) {
  cfg = cfg || {};
  if (!cls || !cls.meaningful) return { alert: false, reason: cls ? cls.type : 'no_change' };
  if ((cls.type === 'price_increase' || cls.type === 'price_decrease') && cfg.min_price_delta != null) {
    var delta = Math.abs((cls.new || 0) - (cls.old || 0));
    if (delta < Number(cfg.min_price_delta)) return { alert: false, reason: 'below_price_threshold' };
  }
  return { alert: true, reason: cls.type };
}

module.exports = { classify, shouldAlert, meaningfulKey, meaningfulText, priceNum };
