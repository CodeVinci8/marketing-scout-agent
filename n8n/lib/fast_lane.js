'use strict';
// fast_lane.js — §8 sub-2s static replies inside the secure WF18 gateway (FAST-LANE-001).
//
// The measured ~30s latency for /start came from the pre-dispatch Sheets phase (batchGet + claim append +
// re-read + 5 sequential persistence writes) that ALL updates paid before any reply. Static commands need
// none of it: their replies are pure functions of config (plan_render_ru + agent_charter), they read no
// conversation state and mutate nothing.
//
// Safety model: the fast lane runs AFTER the fail-closed ingress gate (secret + kill-switch + private chat +
// authorization), so only the authorized owner ever reaches it. It is limited to a hard allowlist of STATIC
// commands with zero business side effects — no Sheets read/write, no state change, no dispatch — so a rare
// duplicate delivery re-sends the same static text and nothing else (idempotent by content). Every stateful
// path (requests, approvals, status, cancel, exports) still goes through the durable claim protocol.
//
// Embeddable: unique fl*-prefixed top-level names, no cross-lib require (the Code node embeds plan_render_ru
// and agent_charter alongside; tests assert the who-am-I regex stays in sync with plan_render_ru.ruIsWhoAmI).

function flStr(v) { return v == null ? '' : String(v).trim(); }

// Mirror of plan_render_ru.ruIsWhoAmI (kept in sync by tests/test_fast_lane.js).
var FL_WHOAMI_RX = /кто\s+(ты|вы)|ты\s+кто|вы\s+кто|что\s+ты\s+такое|что\s+ты\s+за|что\s+такое\s+vinci|что\s+за\s+(бот|агент|сервис|vinci)|расскажи\s+о\s+себе|представься|who\s+are\s+you|what\s+are\s+you/i;

// '' when the text is not a static fast-lane command.
function fastLaneKind(text) {
  var t = flStr(text);
  if (/^\/start\b/i.test(t)) return 'start';
  if (/^\/help\b/i.test(t)) return 'help';
  if (FL_WHOAMI_RX.test(t)) return 'whoami';
  return '';
}

// Decision for a PARSED, ingress-accepted update. Callbacks are never fast-lane (approval/reject security
// stays on the claimed path); /status и /cancel are stateful and stay behind the claim protocol too.
function fastLaneDecision(parsed) {
  parsed = parsed || {};
  if (parsed.kind === 'callback') return { fast: false, kind: '' };
  var k = fastLaneKind(parsed.text);
  return { fast: !!k, kind: k };
}

module.exports = { fastLaneKind, fastLaneDecision, FL_WHOAMI_RX };
