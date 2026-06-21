// test_attachment_routing.js — QA-004: MIME-aware Telegram attachment routing. Proves the canonical policy
// (raster->sendPhoto, SVG/CSV/XLSX/PDF->sendDocument, unknown->fail closed) AND that the real generated WF24
// routes its SVG chart via sendDocument and never via sendPhoto. Offline, $0.
'use strict';
const A = require('./_assert');
const path = require('path');
const R = require('../n8n/lib/attachment_router.js');
const WF24 = require('../n8n/workflows/24_report_export_delivery.json');

A.section('QA-004 — canonical routing policy');
A.eq('image/png -> sendPhoto', R.routeAttachment('image/png').api_method, 'sendPhoto');
A.eq('image/png form field is photo', R.routeAttachment('image/png').form_field, 'photo');
A.eq('image/jpeg -> sendPhoto', R.routeAttachment('image/jpeg').api_method, 'sendPhoto');
A.eq('image/svg+xml -> sendDocument', R.routeAttachment('image/svg+xml').api_method, 'sendDocument');
A.eq('image/svg+xml form field is document', R.routeAttachment('image/svg+xml').form_field, 'document');
A.eq('text/csv -> sendDocument', R.routeAttachment('text/csv').api_method, 'sendDocument');
A.eq('xlsx -> sendDocument', R.routeAttachment('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').api_method, 'sendDocument');
A.eq('application/pdf -> sendDocument', R.routeAttachment('application/pdf').api_method, 'sendDocument');

A.section('QA-004 — SVG is NEVER a photo');
A.eq('isPhotoMime(svg) is false', R.isPhotoMime('image/svg+xml'), false);
A.eq('routeAttachment(svg).kind is document', R.routeAttachment('image/svg+xml').kind, 'document');

A.section('QA-004 — MIME is normalized (case + charset params)');
A.eq('uppercase + charset still routes', R.routeAttachment('IMAGE/SVG+XML; charset=utf-8').api_method, 'sendDocument');
A.eq('whitespace trimmed', R.routeAttachment('  image/png  ').api_method, 'sendPhoto');

A.section('QA-004 — fail closed on unknown / empty MIME');
function throws(label, mime, opts) { let t = false; try { R.routeAttachment(mime, opts); } catch (e) { t = true; } A.ok(label, t); }
throws('empty MIME throws', '');
throws('null MIME throws', null);
throws('unknown MIME throws (no silent sendPhoto)', 'application/x-evil');
throws('octet-stream throws (cannot guess)', 'application/octet-stream');
A.eq('isSupportedMime(unknown) is false', R.isSupportedMime('application/x-evil'), false);

A.section('QA-004 — webp policy is explicit');
A.eq('webp defaults to sendPhoto (raster)', R.routeAttachment('image/webp').api_method, 'sendPhoto');
A.eq('webp -> sendDocument when allowWebpPhoto=false', R.routeAttachment('image/webp', { allowWebpPhoto: false }).api_method, 'sendDocument');

A.section('QA-004 — the real WF24 routes its SVG chart via sendDocument, never sendPhoto');
const senders = WF24.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest');
A.ok('no WF24 sender uses sendPhoto', !senders.some(n => /sendPhoto/.test(n.parameters.url || '')));
const chartNode = senders.find(n => /Send Chart/.test(n.name));
A.ok('WF24 chart sender exists', !!chartNode);
A.ok('WF24 chart sender uses sendDocument', /sendDocument/.test(chartNode.parameters.url || ''));
A.ok('WF24 chart sender uploads the chart binary', JSON.stringify(chartNode.parameters).indexOf('chart') >= 0);
const exportsCode = (WF24.nodes.find(n => n.name === 'Build Exports & Outbox').parameters.jsCode) || '';
A.ok('WF24 exports node embeds attachment_router', /embedded n8n\/lib\/attachment_router\.js/.test(exportsCode));
A.ok('WF24 exports node actually calls routeAttachment', /routeAttachment\(/.test(exportsCode));
A.ok('WF24 chart binary mimeType is image/svg+xml', /image\/svg\+xml/.test(exportsCode));
// The router, applied to the chart MIME WF24 declares, agrees with the static send node.
A.eq('router(svg) matches the WF24 chart node method', R.routeAttachment('image/svg+xml').api_method, 'sendDocument');

A.report('attachment-routing');
void path;
