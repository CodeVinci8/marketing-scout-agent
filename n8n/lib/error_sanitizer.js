'use strict';
// error_sanitizer.js — what may be persisted about a FAILED record (technical_errors / skipped_log routes).
//
// WF04-ROUTE-002. The resilient routers persist `raw_response_preview` + `parse_error` for triage. Those strings are
// built from a provider response, so without a gate they can carry an Authorization header, an api key, a cookie, a
// Claude thinking block, or a customer's phone/email straight into a durable Google Sheets tab that many people can
// open. Diagnosis needs a bounded, scrubbed EXCERPT — never the raw body.
//
// Keep: provider, source URL, safe error category, bounded sanitized excerpt, request/run lineage, timestamp.
// Drop: secrets, credentials, cookies, hidden reasoning, private PII, anything past the cap.
//
// Embeddable: unique es*-prefixed names, no cross-lib require.

function esStr(v) { return v == null ? '' : String(v); }

var ES_MAX_PREVIEW = 300;      // enough to recognise a failure shape; far too short to be a "raw body"
var ES_REDACTED = '[скрыто]';

// Ordered: the most specific secret shapes first, then generic key/value pairs, then PII.
var ES_RULES = [
  // Authorization / bearer / api-key headers (with or without a header name)
  { re: /(authorization|proxy-authorization)\s*[:=]\s*\S+/gi, to: '$1: ' + ES_REDACTED },
  { re: /\bbearer\s+[A-Za-z0-9._\-~+/]{8,}=*/gi, to: 'bearer ' + ES_REDACTED },
  { re: /\bbasic\s+[A-Za-z0-9+/]{8,}=*/gi, to: 'basic ' + ES_REDACTED },
  // cookies / set-cookie
  { re: /(set-cookie|cookie)\s*[:=]\s*[^\n;]+/gi, to: '$1: ' + ES_REDACTED },
  // provider key formats (Anthropic sk-ant-…, generic sk-…, Google AIza…, GitHub gh[pousr]_…)
  { re: /\bsk-ant-[A-Za-z0-9._\-]{8,}/g, to: ES_REDACTED },
  { re: /\bsk-[A-Za-z0-9._\-]{16,}/g, to: ES_REDACTED },
  { re: /\bAIza[0-9A-Za-z._\-]{20,}/g, to: ES_REDACTED },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, to: ES_REDACTED },
  // JWTs
  { re: /\beyJ[A-Za-z0-9._\-]{10,}\.[A-Za-z0-9._\-]{10,}\.[A-Za-z0-9._\-]{4,}/g, to: ES_REDACTED },
  // generic "<something>key|token|secret|password" : "<value>" (JSON or header style)
  { re: /("?\b[\w.\-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd|credential)\b"?)\s*[:=]\s*"?[^"\s,}{&]+"?/gi, to: '$1: ' + ES_REDACTED },
  // url query secrets: ?key=… &token=…
  { re: /([?&](?:key|token|api_key|apikey|access_token|secret|password)=)[^&\s]+/gi, to: '$1' + ES_REDACTED },
  // private PII — we analyze public positioning, never harvest contacts
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, to: '[email]' },
  { re: /\+?\d[\d\s().-]{9,}\d/g, to: '[тел]' }
];

// Strip a model's hidden reasoning: it is never persisted, in any shape.
function esStripThinking(s) {
  return esStr(s)
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, ' ')
    .replace(/<thinking>[\s\S]*?<\/antml:thinking>/gi, ' ')
    .replace(/"type"\s*:\s*"thinking"[\s\S]*?(?=[,}]\s*"type"|$)/gi, ' ')
    .replace(/\bthinking\s*[:=]\s*"[^"]*"/gi, ' ');
}

// sanitizeErrorPreview(raw, opts) -> a bounded, secret-free, PII-free excerpt safe to persist.
function sanitizeErrorPreview(raw, opts) {
  opts = opts || {};
  var max = Number(opts.max_chars);
  if (!isFinite(max) || max <= 0) max = ES_MAX_PREVIEW;
  var s = esStripThinking(raw);
  for (var i = 0; i < ES_RULES.length; i++) s = s.replace(ES_RULES[i].re, ES_RULES[i].to);
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

// Does a string still look like it carries a secret? Used as a fail-closed assertion before persisting.
function esLooksSecret(s) {
  s = esStr(s);
  return /\b(sk-ant-|sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9._-]{10,}\.)/.test(s) ||
    /(authorization|set-cookie)\s*[:=]\s*(?!\[скрыто\])\S+/i.test(s);
}

// The ONLY diagnostic fields a failed record may persist. Anything not listed here is dropped by construction.
function sanitizeErrorRecord(rec, opts) {
  rec = rec || {};
  return {
    provider: esStr(rec.provider),
    source_url: esStr(rec.source_url),
    error_category: esStr(rec.error_category || rec.processing_status),
    parse_error: sanitizeErrorPreview(rec.parse_error, { max_chars: (opts && opts.max_chars) || ES_MAX_PREVIEW }),
    raw_response_preview: sanitizeErrorPreview(rec.raw_response_preview, { max_chars: (opts && opts.max_chars) || ES_MAX_PREVIEW }),
    agent_request_id: esStr(rec.agent_request_id),
    source_run_id: esStr(rec.source_run_id),
    run_id: esStr(rec.run_id),
    created_at: esStr(rec.created_at)
  };
}

module.exports = { ES_MAX_PREVIEW, ES_RULES, sanitizeErrorPreview, sanitizeErrorRecord, esLooksSecret, esStripThinking };
