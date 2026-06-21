'use strict';
// attachment_router.js — the ONE canonical policy for how a generated attachment reaches Telegram (QA-004).
// Telegram's sendPhoto re-encodes/renders raster images; a vector SVG sent via sendPhoto is rejected or mangled,
// so SVG (and every non-raster file) MUST go via sendDocument. This module is the single place that decides, and
// it is FAIL-CLOSED: an unknown MIME type throws rather than silently defaulting to a photo upload.
//
// Policy:
//   image/png   -> sendPhoto    (raster)
//   image/jpeg  -> sendPhoto    (raster)
//   image/webp  -> sendPhoto    (raster; Telegram sendPhoto accepts webp) unless opts.allowWebpPhoto===false
//   image/svg+xml -> sendDocument (vector — never a photo)
//   text/csv      -> sendDocument
//   application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (xlsx) -> sendDocument
//   application/pdf -> sendDocument
//   <anything else> -> THROW (fail closed)
//
// Pure, dependency-free and embeddable (no cross-require; AR_-prefixed module symbols so it never clashes when
// embedded alongside report_package / telegram_io in the same n8n Code node).

var AR_PHOTO_MIME = ['image/png', 'image/jpeg'];
var AR_WEBP_MIME = 'image/webp';
var AR_DOCUMENT_MIME = [
  'image/svg+xml',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/pdf',
  'text/plain',
  'application/json'
];

// Normalize: lowercase, trim, drop any "; charset=..." parameters.
function normMime(m) { return String(m == null ? '' : m).trim().toLowerCase().split(';')[0].trim(); }

// routeAttachment(mime, opts) -> { api_method, form_field, kind, mime }. Throws on unknown/empty mime (fail closed).
function routeAttachment(mime, opts) {
  opts = opts || {};
  var allowWebpPhoto = opts.allowWebpPhoto !== false; // default: webp is an acceptable photo
  var m = normMime(mime);
  if (!m) throw new Error('attachment_router: empty/unknown MIME type (fail closed)');
  if (AR_PHOTO_MIME.indexOf(m) >= 0) return { api_method: 'sendPhoto', form_field: 'photo', kind: 'photo', mime: m };
  if (m === AR_WEBP_MIME) {
    return allowWebpPhoto
      ? { api_method: 'sendPhoto', form_field: 'photo', kind: 'photo', mime: m }
      : { api_method: 'sendDocument', form_field: 'document', kind: 'document', mime: m };
  }
  if (AR_DOCUMENT_MIME.indexOf(m) >= 0) return { api_method: 'sendDocument', form_field: 'document', kind: 'document', mime: m };
  throw new Error('attachment_router: unsupported MIME type "' + m + '" (fail closed — refusing to guess sendPhoto)');
}

// Convenience predicates.
function isPhotoMime(mime, opts) { try { return routeAttachment(mime, opts).kind === 'photo'; } catch (e) { return false; } }
function isSupportedMime(mime, opts) { try { routeAttachment(mime, opts); return true; } catch (e) { return false; } }

module.exports = { routeAttachment, isPhotoMime, isSupportedMime, normMime, AR_PHOTO_MIME, AR_DOCUMENT_MIME };
