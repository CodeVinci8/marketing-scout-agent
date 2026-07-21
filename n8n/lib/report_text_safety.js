'use strict';
// report_text_safety.js — WIP3-D + WIP3-F deterministic text-truth guards for user-facing report fields.
//   D ownershipSafeRecommendationRu: never tell the user to publish INSIDE a third-party source.
//   F fragmentQuality / isDamagedFragment: keep truncated/broken commercial fragments out of confirmed facts.
// Pure, embeddable, no network.

function tsStr(v) { return v == null ? '' : String(v); }
function tsTrim(v) { return tsStr(v).replace(/\s+/g, ' ').trim(); }

// ---------- D. ownership-safe recommendations -------------------------------------------------------------
// A third-party source reference the user does NOT control: a Telegram/VK handle or link, or a bare domain/URL.
var TS_SRC_RE = /(https?:\/\/[^\s"'<>]+|t\.me\/[a-z0-9_+/]+|vk\.com\/[a-z0-9_.]+|@[a-z0-9_]{3,}|[a-z0-9-]+\.(?:ru|com|рф|net|org|io)\b[^\s"']*)/i;
// Publish-INSIDE verbs. "подготовить/создать материал" is already safe and must NOT be rewritten.
// NB: JS \w/\b exclude Cyrillic without the /u flag — use explicit [а-яё]* stems.
var TS_PUBLISH_RE2 = /(размест[а-яё]*|опублик[а-яё]*|публику[а-яё]*|выложи[а-яё]*|запост[а-яё]*|постить|пост(?:ы|ить)?\s+в\b|канал[еа]?\s+[«"]?(?:t\.me|vk\.com|@))/i;

function ownershipSafeRecommendationRu(text) {
  var t = tsStr(text);
  if (!t.trim()) return t;
  var srcM = t.match(TS_SRC_RE);
  var hasPublishVerb = TS_PUBLISH_RE2.test(t.toLowerCase());
  if (!srcM || !hasPublishVerb) return t; // nothing unsafe to rewrite
  var src = srcM[0];
  // If the recommendation is already ownership-safe (mentions «собственн…/свой канал»), leave it.
  if (/собственн|сво[йёи]м?\s+канал/i.test(t)) return t;
  return 'Подготовить для собственного канала материал на основе сигнала из ' + src + '.';
}

// ---------- F. damaged / incomplete commercial fragments --------------------------------------------------
// Return 'ok' | 'damaged' (do not use as a confirmed fact). High-precision signatures only — real short facts
// ("Ставка от 3%", "Займ до 5 млн") must stay 'ok'.
var TS_TRUNC_PARTICIPLE = /^[а-яё]{4,}(?:нн|енн|анн|ённ|ющ|ущ|ащ|ящ|вш|ем)[а-яё]?$/i; // lone truncated participle/adjective, e.g. «пониженна»
var TS_RATE_WORD = /(ставк\w*|процент\w*|комисси\w*|тариф\w*)\s*[:\-—]?\s*(пониж\w*|повыш\w*|сниж\w*|низк\w*|высок\w*|уменьш\w*)/i; // rate described by a word, no number

function isDamagedFragment(text) {
  var t = tsTrim(text);
  if (!t) return false; // empty is "no data", handled separately (not a damaged fact)
  var low = t.toLowerCase();
  var words = t.split(' ').filter(Boolean);
  var hasDigit = /\d/.test(t);
  var endsClean = /[.!?%)»"'\d]$/.test(t) || /\d\s*(₽|руб|%|млн|тыс|тр)/i.test(t);

  // 1) lone truncated participle/adjective fragment with no noun/number/punctuation (e.g. «пониженна»)
  if (words.length <= 2 && !hasDigit && TS_TRUNC_PARTICIPLE.test(words[words.length - 1])) return true;
  // 2) a rate/commission described by a truncated qualitative WORD instead of a number
  if (TS_RATE_WORD.test(low) && !/\d/.test(low.replace(TS_RATE_WORD, ''))) return true;
  // 3) dangling ending: finishes on a preposition/conjunction or a hyphen (clause cut off)
  if (/[-–—]$/.test(t)) return true;
  if (/(?:^|\s)(от|до|под|для|на|по|в|с|и|или|а|но|при|за|из|у|о|об)$/i.test(t) && !endsClean) return true;
  // 4) broken number/decimal: a digit immediately followed by a decimal separator and then a letter/end
  if (/\d[.,](?:\s|$)/.test(t) && !/\d[.,]\d/.test(t)) return true;
  // 5) a price/rate lead-in with nothing after it
  if (/(ставка от|цена от|сумма до|ставка|процентная ставка)\s*$/i.test(t)) return true;
  return false;
}

function fragmentQuality(text) { return isDamagedFragment(text) ? 'damaged' : 'ok'; }

module.exports = { ownershipSafeRecommendationRu, isDamagedFragment, fragmentQuality };
