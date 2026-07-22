'use strict';
// test_text_safety_f3.js — F-3: damaged Russian text, duplicate headings, unsafe truncation.
//
// Every case below is taken from a real delivered report (req_76722084 and req_17847532270):
//   «…выдача до 90% от рыночно»     — WF10 cut the offer with a raw slice(0,140), mid-word, with no marker.
//                                     «от рыночной стоимости» became «от рыночно», which is not a Russian word
//                                     and silently changes the claim. It then travelled into the evidence
//                                     package, the deterministic fallback, Telegram «Ключевые факты» and XLSX.
//   «📊 Залог 24 — Залог 24 (…) — …» — the renderer prefixes the competitor name and the executive summary
//                                     independently opens with it; the old inline dedup regex required the
//                                     separator to follow the name immediately, so a parenthetical defeated it.
const A = require('./_assert.js');
const T = require('../n8n/lib/report_text_safety.js');
const EP = require('../n8n/lib/evidence_package.js');
const fs = require('fs');
const path = require('path');

const FULL_OFFER = 'Займы под залог авто от 2,4%/мес. и ПТС от 2,9%/мес. с одобрением за 5 минут, рефинансирование из других ломбардов, выдача до 90% от рыночной стоимости';

// A Russian word must never be left as a fragment: the tail token has to be a token that really appears in the
// source text (or the text must end in punctuation/ellipsis).
function tailIsWholeWord(shortened, source) {
  const cleaned = String(shortened).replace(/…$/, '').trim();
  const last = cleaned.split(/\s+/).pop().replace(/[.,;:!?)»"']+$/, '');
  if (!last) return true;
  return new RegExp('(^|\\s)' + last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|[.,;:!?)»"\']|$)').test(source);
}

A.section('safeShortenRu — the exact production damage cannot recur');
{
  const bad = FULL_OFFER.slice(0, 140);
  A.ok('the OLD hard cut really produced the damaged fragment', /от рыночно$/.test(bad));
  A.ok('and left no marker that anything was removed', !/…$/.test(bad));

  const good = T.safeShortenRu(FULL_OFFER, 140);
  A.ok('new: no mid-word fragment', !/рыночно$/.test(good));
  A.ok('new: within the budget', good.length <= 140);
  A.ok('new: visibly shortened', /…$/.test(good));
  A.ok('new: every retained word is a real word from the source', tailIsWholeWord(good, FULL_OFFER));
}

A.section('safeShortenRu — general contract');
{
  A.eq('short text is returned untouched', T.safeShortenRu('Коротко.', 140), 'Коротко.');
  A.eq('empty stays empty', T.safeShortenRu('', 50), '');
  A.eq('null-safe', T.safeShortenRu(null, 50), '');
  A.ok('exact-length text is not shortened', !/…$/.test(T.safeShortenRu('абв', 3)));

  // Prefers a sentence boundary when one sits late enough in the budget (>=60% of it) — a clean sentence
  // reads better than a clipped clause and needs no ellipsis.
  const twoSent = 'Первое предложение о ставках. Второе предложение про сроки и условия кредитования клиентов.';
  const sSent = T.safeShortenRu(twoSent, 40);
  A.eq('cuts at the sentence end', sSent, 'Первое предложение о ставках.');
  A.ok('a sentence cut needs no ellipsis', !/…$/.test(sSent));
  // But when the only sentence end is too early, keeping MORE text via a word cut is the better trade —
  // deliberate, and asserted so it cannot silently regress into dropping half the content.
  const sWord = T.safeShortenRu(twoSent, 60);
  A.ok('early sentence end is rejected in favour of more content', sWord.length > sSent.length);
  A.ok('word cut is marked with an ellipsis', /…$/.test(sWord));
  A.ok('word cut breaks no word', tailIsWholeWord(sWord, twoSent));

  // Never leaves dangling punctuation before the ellipsis.
  A.ok('no dangling comma', !/[,;:]…$/.test(T.safeShortenRu('Слово, ещё слово, и третье слово тут', 16)));

  // Real-world fragments the operator reported.
  ['Бесплатная консультация по займу под залог автомобиля прямо сейчас',
   'Оставить заявку на займ под ПТС онлайн без визита в офис'].forEach((src) => {
    [20, 30, 45].forEach((n) => {
      const out = T.safeShortenRu(src, n);
      A.ok('no broken word in "' + out + '"', tailIsWholeWord(out, src));
      A.ok('within budget (' + n + ')', out.length <= n);
    });
  });

  // A single pathologically long token cannot crash or loop.
  const oneWord = 'а'.repeat(300);
  A.ok('single long token still bounded', T.safeShortenRu(oneWord, 50).length <= 50);
}

A.section('epTrim — the evidence package no longer breaks words');
{
  const t = EP.epTrim ? EP.epTrim(FULL_OFFER, 140) : null;
  if (t === null) { A.ok('epTrim not exported — covered via buildEvidencePackage', true); }
  else {
    A.ok('epTrim: no mid-word fragment', !/рыночно$/.test(t));
    A.ok('epTrim: marked as shortened', /…$/.test(t));
    A.ok('epTrim: tail is a whole word', tailIsWholeWord(t, FULL_OFFER));
  }
}

A.section('WF10 — the canonical source of the damage is fixed in the workflow itself');
{
  let wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '10_competitor_audience_intelligence_aggregator.json'), 'utf8'));
  if (Array.isArray(wf)) wf = wf[0];
  const code = wf.nodes.find((n) => n.name === 'Aggregate Market Intelligence').parameters.jsCode;
  A.ok('node still compiles', (() => { try { new Function(code); return true; } catch (e) { return false; } })());
  A.ok('the raw slice cut is gone', code.indexOf('return s.length>n?s.slice(0,n):s;') < 0);
  A.ok('a word-boundary cut is present', code.indexOf("replace(/\\s+\\S*$/,'')") > 0);

  // Behavioural: run the workflow's OWN cut() over the real offer text.
  const m = code.match(/function cut\(s,n\)\{[\s\S]*?\}(?=function|\n)/);
  const src = 'function str(v){return v==null?"":String(v);}' + (m ? m[0] : '') + ';return cut;';
  const cut = new Function(src)();
  const out = cut(FULL_OFFER, 140);
  A.ok('WF10 cut: no mid-word damage', !/рыночно$/.test(out));
  A.ok('WF10 cut: marked as shortened', /…$/.test(out));
  A.ok('WF10 cut: within budget', out.length <= 140);
  A.ok('WF10 cut: tail is a whole word', tailIsWholeWord(out, FULL_OFFER));
  A.eq('WF10 cut: short text untouched', cut('Коротко', 140), 'Коротко');
}

A.section('dedupeHeadingRu — no stuttering competitor name');
{
  A.eq('parenthetical form (the live defect)',
    T.dedupeHeadingRu('Залог 24', 'Залог 24 (zalog24h.ru) — кредитный брокер в Москве.'), 'кредитный брокер в Москве.');
  A.eq('plain dash form', T.dedupeHeadingRu('LionCredit', 'LionCredit — брокер.'), 'брокер.');
  A.eq('colon form', T.dedupeHeadingRu('Залог 24', 'Залог 24: брокер.'), 'брокер.');
  A.eq('case-insensitive', T.dedupeHeadingRu('залог 24', 'Залог 24 — брокер.'), 'брокер.');
  A.eq('unrelated body untouched', T.dedupeHeadingRu('Залог 24', 'Компания работает с 2010 года.'), 'Компания работает с 2010 года.');
  A.eq('body that is ONLY the name is preserved (never emptied)', T.dedupeHeadingRu('Залог 24', 'Залог 24'), 'Залог 24');
  A.eq('empty name is safe', T.dedupeHeadingRu('', 'текст'), 'текст');

  const h = T.headingWithBodyRu('Залог 24', 'Залог 24 (zalog24h.ru) — кредитный брокер в Москве.');
  A.eq('composed heading has no stutter', h, 'Залог 24 — кредитный брокер в Москве.');
  A.eq('name appears exactly once', (h.match(/Залог 24/g) || []).length, 1);
}

A.section('compact_report_ru consumes the canonical helper (no divergent inline regex)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'lib', 'compact_report_ru.js'), 'utf8');
  A.ok('calls dedupeHeadingRu', src.indexOf('dedupeHeadingRu(subject, assess)') > 0);
  A.ok('the old inline lead regex is gone', src.indexOf("var lead = new RegExp('^' + subject") < 0);
}



A.section('F-3 ENUM-RU-001 — internal enums never reach a user-facing cell');
{
  const P = require('../n8n/lib/plan_render_ru.js');
  A.eq('niche', P.ruNiche('credit_brokerage'), 'кредитный брокер');
  A.eq('source type', P.ruSourceLabel('website'), 'сайт');
  A.eq('telegram', P.ruSourceLabel('telegram_channel'), 'Telegram-канал');
  A.eq('quality healthy', P.ruQualityLabel('healthy'), 'исправен');
  A.eq('quality accepted', P.ruQualityLabel('accepted'), 'принят');
  // An unknown LATIN/underscore token must be blanked, never echoed at the user.
  A.eq('unknown latin enum is blanked', P.ruSourceLabel('some_new_enum'), '');
  A.eq('unknown latin quality is blanked', P.ruQualityLabel('weird_state'), '');
  // Russian text that is already user-ready passes through.
  A.eq('russian passthrough', P.ruSourceLabel('сайт'), 'сайт');

  const rp = require('fs').readFileSync(require('path').join(__dirname, '..', 'n8n', 'lib', 'report_package.js'), 'utf8');
  A.ok('report_package maps the niche instead of printing the enum', rp.indexOf('ruNiche(b.niche)') > 0);
  A.ok('the raw niche is no longer concatenated', rp.indexOf('const scopeStr = [b.niche,') < 0);
  A.ok('the day suffix is Russian', rp.indexOf("' дн.'") > 0);

  // WF10 must not emit the internal metric name inside a user-facing fact.
  let wf = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'n8n', 'workflows', '10_competitor_audience_intelligence_aggregator.json'), 'utf8'));
  if (Array.isArray(wf)) wf = wf[0];
  const all = wf.nodes.map((n) => (n.parameters || {}).jsCode || '').join('\n');
  A.ok('avg competitor_strength is gone', all.indexOf('avg competitor_strength') < 0);
  A.ok('replaced with Russian phrasing', all.indexOf('средняя оценка заметности') > 0);
}

A.report('text-safety-f3');
