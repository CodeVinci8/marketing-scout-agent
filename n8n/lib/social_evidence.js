'use strict';
// social_evidence.js — SOCIAL-BRIDGE-001. Turn verbatim `raw_market_records` rows into bounded, strictly-scoped
// evidence rows that the WF12 report bundle can carry, so a Telegram channel / VK community can be analysed as a
// SOURCE even when it has no competitor profile.
//
// Why this exists (production defect, request req_76722076, executions 1096/1101):
//   Telegram collection worked — 30 items received, 22 written, 22 relevant, source_outcome=collected_with_data —
//   but `Build Analysis Inputs` produced ZERO analysis targets, WF28 was never called, records_analyzed was 0, and
//   the user was told no competitor profiles with offers/prices were found. The verbatim posts were sitting in
//   raw_market_records the whole time; WF12 simply never read them, and analysis_bridge derives targets from
//   competitor profiles. Social posts deliberately do NOT become competitor profiles (DEC-133/DEC-135 quality
//   policy), so valid evidence was lost between collection and analysis.
//
// Scoping is FAIL-CLOSED, in this order. A row must survive every gate:
//   1. request scope   — the row's agent_request_id/source_run_id must belong to THIS request family;
//   2. source-run scope— when the WF16 quality gate produced an eligible-run list, the row's source_run_id must be
//                        in it (a degraded/excluded run contributes nothing);
//   3. platform        — social only (website evidence already flows through competitor_profiles/offers);
//   4. citable         — a real public post URL AND non-empty verbatim text, else the model could not cite it;
//   5. post-level relevance (DEC-133/135) — decided by the POST TEXT alone: channel/system noise is dropped and
//                        the text must derive a recognizable service. An unrelated post is never evidence.
// Bounding: per-source and total caps, and a per-excerpt character cap, so one chatty channel cannot blow up the
// evidence package or the paid analysis call.
//
// Embeddable: unique se*-prefixed names, no cross-lib require. The service classifier is intentionally a verbatim
// copy of semantic_core.deriveServiceFromText — a Code node cannot require() a sibling lib, and
// tests/test_social_evidence.js asserts the two stay identical.

function seStr(v) { return v == null ? '' : String(v); }
function seLow(v) { return seStr(v).toLowerCase(); }
function seNum(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

// Same family semantics WF12 already uses for lead rows: "req_1" matches "req_1::telegram::a1".
function seFamMatch(a, b) {
  a = seStr(a); b = seStr(b);
  if (!b) return true;
  if (!a) return false;
  return a === b || a.indexOf(b + '::') === 0 || b.indexOf(a + '::') === 0;
}

// --- verbatim copy of semantic_core.deriveServiceFromText (drift-asserted by the test) -----------------------
function seDeriveService(text) {
  const t = seLow(text);
  if (!t) return 'unknown';
  if (/возвратн[а-яё]*\s+лизинг|sale.?leaseback|leaseback/.test(t)) return 'auto_lease_refinance';
  if (/птс|pts|под залог авто|залог автомобил|под авто/.test(t)) return 'pts_loan';
  if (/под залог недвиж|залог квартир|залог дома|под квартир/.test(t)) return 'real_estate_secured_loan';
  if (/ипотек/.test(t) && /рефинанс/.test(t)) return 'mortgage_refinance';
  if (/ипотек/.test(t)) return 'mortgage_brokerage';
  if (/кредитн[а-яё]* истори|исправ[а-яё]* кредитн|очист[а-яё]* кредитн|бки/.test(t)) return 'credit_history_consulting';
  if (/после отказ|с просрочк|плох[а-яё]* кредитн|отказах банк/.test(t)) return 'credit_after_refusals';
  if (/для бизнеса|ип и ооо|оборотн|тендерн|бизнес-кредит/.test(t)) return 'business_credit';
  if (/банковск[а-яё]* гарант/.test(t)) return 'bank_guarantee';
  if (/банкрот/.test(t)) return 'bankruptcy_advisory';
  if (/рефинанс/.test(t)) return 'debt_refinancing';
  if (/объедин[а-яё]* кредит|консолидац/.test(t)) return 'debt_consolidation';
  if (/залог|под обеспечени/.test(t)) return 'secured_financing';
  if (/кредитн[а-яё]* брокер|подбор банк|помощь.{0,12}кредит/.test(t)) return 'credit_brokerage';
  if (/кредит|займ/.test(t)) return 'consumer_credit';
  return 'unknown';
}
// --- WIP3-C: niche-primary gate on top of the drift-asserted seDeriveService (semantic_core is NOT modified) ---
// A post that matched ONLY the broad кредит/займ catch-all is admitted as PRIMARY lending evidence only when it is
// actually about lending — not macro/bond/sovereign/rating news that merely mentions «кредитный риск»/«долг».
// (regression: banksta British Steel / Oracle CDS / generic bond credit-risk must not be primary evidence.)
var SE_OFFDOMAIN = /облигац|евробонд|\bбонд|\bcds\b|дефолтн[а-яё]* своп|кредитн[а-яё]* дефолтн|суверен|эмитент|\bспред|доходност[ьи]|национализац|british steel|oracle|индекс[а-яё]*\s+(?:мосбирж|ртс|s&p|dow)|котировк|акци[йяе]/;
var SE_OFFER_SIGNAL = /оформ|заявк|ставка от|под залог|выда[её]м|выдач|получи(?:те|ть)? деньг|одобрени|деньги за|займ под|кредит под|рассрочк|наши услови|подать заявку/;
function seNichePrimary(text, service) {
  if (service !== 'consumer_credit') return true;           // specific lending services are always primary
  var t = seLow(text);
  if (SE_OFFER_SIGNAL.test(t)) return true;                 // a concrete loan-offer signal keeps it primary
  if (SE_OFFDOMAIN.test(t)) return false;                   // otherwise off-domain macro/bond/rating news → not primary
  return true;
}

// Channel/system noise ("канал переименован", pinned-message notices …) is never market evidence.
function seIsSystemEvent(text) {
  var t = seStr(text);
  return /channel name was changed to/i.test(t)
    || /(название|имя)\s+канала\s+(изменено|сменено|поменя)/i.test(t)
    || /(изменил|сменил|поменял)\s+название\s+канала/i.test(t)
    || /канал\s+переименован/i.test(t)
    || /(закреплённое|закрепленное)\s+сообщение/i.test(t)
    || /^\s*(вступил|присоединил)[а-яё]*\s+к\s+(каналу|группе)/i.test(t);
}

var SE_SOCIAL_PLATFORMS = ['telegram', 'vk'];

function seDecodeEntities(s) {
  return seStr(s)
    .replace(/&#(\d+);/g, function (_, d) { try { return String.fromCharCode(Number(d)); } catch (e) { return ''; } })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Contact scrubbing mirrors WF12's report-layer redaction: business numbers survive, direct contact identifiers
// do not. The excerpt must stay VERBATIM in substance — we redact identifiers, we never paraphrase.
var SE_CONTACT_MARK = '[PUBLIC CONTACT REDACTED]';
function seRedact(s) {
  s = seStr(s); if (!s) return s;
  s = s.replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, SE_CONTACT_MARK);
  s = s.replace(/(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g, SE_CONTACT_MARK);
  s = s.replace(/\+\d[\d\s().\-]{8,}\d/g, SE_CONTACT_MARK);
  s = s.replace(/@[A-Za-z0-9_]{3,32}/g, SE_CONTACT_MARK);
  return s;
}

function seClean(s, max) {
  var t = seRedact(seDecodeEntities(s)).replace(/\s+/g, ' ').trim();
  if (max && t.length > max) t = t.slice(0, max - 1) + '…';
  return t;
}

// The logical source a post belongs to: the channel/community, not the individual post.
function seSourceKeyOf(row) {
  var prof = seStr(row.profile_url) || seStr(row.source_url);
  var m = prof.match(/^https?:\/\/([^\/?#]+)([^?#]*)/i);
  if (m) {
    var host = m[1].replace(/^www\./i, '');
    var seg = seStr(m[2]).split('/').filter(function (x) { return x && x !== 's'; })[0] || '';
    if (seg) return host + '/' + seg;
    return host;
  }
  return seStr(row.author_handle) || seStr(row.profile_name) || seStr(row.platform);
}

/**
 * buildSocialEvidence(rows, ctx, opts)
 * @param {Array}  rows raw_market_records rows (verbatim collected posts)
 * @param {object} ctx  { agent_request_id, included_source_runs: [] }
 * @param {object} opts { max_total, max_per_source, max_excerpt_chars, platforms }
 * @returns {{evidence: Array, sources: Array, considered: number, dropped: object}}
 *   evidence rows are shaped for bundle.evidence and carry the lineage every downstream consumer needs.
 */
function buildSocialEvidence(rows, ctx, opts) {
  rows = Array.isArray(rows) ? rows : [];
  ctx = ctx || {}; opts = opts || {};
  var maxTotal = seNum(opts.max_total, 40);
  var maxPerSource = seNum(opts.max_per_source, 12);
  var maxChars = seNum(opts.max_excerpt_chars, 600);
  var platforms = Array.isArray(opts.platforms) && opts.platforms.length ? opts.platforms : SE_SOCIAL_PLATFORMS;
  var reqId = seStr(ctx.agent_request_id);
  var includedRuns = Array.isArray(ctx.included_source_runs) ? ctx.included_source_runs.filter(Boolean) : [];

  var dropped = { foreign_request: 0, excluded_source_run: 0, not_social: 0, no_url: 0, no_text: 0,
    system_event: 0, off_topic: 0, low_relevance: 0, duplicate: 0, over_cap: 0 };
  var perSource = {};
  var seenPost = {};
  var out = [];
  var sources = {};
  var considered = 0;

  rows.forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    considered++;

    // 1. request scope — a row from another request may never enter this report.
    var rowReq = seStr(r.agent_request_id), rowRun = seStr(r.source_run_id);
    if (!(seFamMatch(rowReq, reqId) || seFamMatch(rowRun, reqId))) { dropped.foreign_request++; return; }
    // A row that names NEITHER a request nor a run cannot be proven to belong here.
    if (!rowReq && !rowRun) { dropped.foreign_request++; return; }

    // 2. source-run scope — honour the WF16 quality gate when it produced a list.
    if (includedRuns.length && includedRuns.indexOf(rowRun) < 0) { dropped.excluded_source_run++; return; }

    // 3. social platforms only
    var platform = seLow(r.platform);
    if (platforms.indexOf(platform) < 0) { dropped.not_social++; return; }

    // 4. citable: a public post URL and verbatim text
    var url = seStr(r.post_url) || seStr(r.source_url) || seStr(r.profile_url);
    if (!url) { dropped.no_url++; return; }
    var rawText = seStr(r.text_context) || seStr(r.comment_text);
    if (!seStr(rawText).trim()) { dropped.no_text++; return; }

    // 5. post-level relevance decided by the POST TEXT alone (DEC-133/135)
    if (seIsSystemEvent(rawText)) { dropped.system_event++; return; }
    var service = seDeriveService(rawText);
    if (service === 'unknown') { dropped.off_topic++; return; }
    // WIP3-C: general finance vocabulary is insufficient — off-domain macro/bond/rating news is not primary evidence.
    if (!seNichePrimary(rawText, service)) { dropped.low_relevance++; return; }

    var excerpt = seClean(rawText, maxChars);
    if (!excerpt) { dropped.no_text++; return; }

    // dedup on the post URL — the same post must never be cited twice
    var dkey = seStr(r.dedup_key) || url;
    if (seenPost[dkey]) { dropped.duplicate++; return; }
    seenPost[dkey] = true;

    var key = seSourceKeyOf(r);
    perSource[key] = seNum(perSource[key], 0);
    if (perSource[key] >= maxPerSource) { dropped.over_cap++; return; }
    if (out.length >= maxTotal) { dropped.over_cap++; return; }
    perSource[key]++;

    if (!sources[key]) {
      sources[key] = {
        source_key: key, platform: platform, source_kind: platform,
        source_name: seClean(r.profile_name, 120) || key,
        profile_url: seStr(r.profile_url) || seStr(r.source_url),
        source_run_id: rowRun, agent_request_id: rowReq, records: 0
      };
    }
    sources[key].records++;

    out.push({
      // bundle.evidence contract (consumed by analysis_bridge)
      evidence_id: seStr(r.record_id) || (key + '#' + out.length),
      competitor: sources[key].source_name,
      url: url,
      excerpt: excerpt,
      finding: 'social_post',
      collected_at: seStr(r.published_at) || seStr(r.created_at),
      source_quality: 'accepted',
      // social lineage the deterministic layer must keep for the report/XLSX
      source_key: key,
      source_kind: platform,
      platform: platform,
      source_run_id: rowRun,
      agent_request_id: rowReq,
      record_id: seStr(r.record_id),
      derived_service: service,
      profile_url: sources[key].profile_url
    });
  });

  return {
    evidence: out,
    sources: Object.keys(sources).map(function (k) { return sources[k]; }),
    considered: considered,
    dropped: dropped
  };
}

module.exports = {
  buildSocialEvidence, seDeriveService, seNichePrimary, seIsSystemEvent, seSourceKeyOf, seFamMatch, seClean,
  SE_SOCIAL_PLATFORMS
};
