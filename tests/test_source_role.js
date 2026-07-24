'use strict';
// test_source_role.js — WIP2 SOURCE-ROLE-001: role is decided from EVIDENCE, never from the niche.
const A = require('./_assert');
const SR = require('../n8n/lib/source_role.js');

function ev(list) { return list.map(function (t, i) { return { evidence_id: 'ev_' + (i + 1), excerpt: t }; }); }

A.section('source_role — a public news/industry channel is NOT a competitor');
{
  // rusmicrofinance-shaped: regulator + rating agency + association → industry source
  const r = SR.classifySourceRole({ source_id: 't.me/rusmicrofinance', kind: 'telegram', niche: 'credit_brokerage',
    evidence: ev([
      'По данным «Эксперт РА», рынок ломбардов вырастет на 35% в 2026 году',
      'Банк России составил ренкинг МФО по числу обоснованных жалоб',
      'Ассоциация НАУМИР приглашает на вебинар по регулированию микрофинансов',
      'Инвестиции в долговые портфели МФО достигнут 26 млрд рублей'
    ]) });
  A.eq('rusmicrofinance -> industry_source', r.source_role, 'industry_source');
  A.eq('rusmicrofinance NOT a direct competitor', r.direct_competitor, false);
  A.ok('has role_reason', !!r.role_reason && r.role_reason.length > 5);
  A.ok('has evidence_ids', r.evidence_ids.length >= 1);
  A.ok('carries limitations', r.limitations.length >= 1);

  // banksta / frank_media-shaped: third-person market news → news source
  const news = SR.classifySourceRole({ source_id: 't.me/banksta', kind: 'telegram', niche: 'credit_brokerage',
    evidence: ev([
      'Сбербанк сообщил о росте выдачи кредитов на 20% за квартал',
      'Аналитики прогнозируют рост просрочки по потребительским займам',
      'По данным отчёта, ключевые банки нарастили кредитный портфель'
    ]) });
  A.eq('banksta -> news_source', news.source_role, 'news_source');
  A.eq('banksta NOT a direct competitor', news.direct_competitor, false);

  // PRObonds-shaped: bonds/market commentary, credit-risk mentions but no niche offers → news, not competitor
  const bonds = SR.classifySourceRole({ source_id: 't.me/probonds', kind: 'telegram', niche: 'credit_brokerage',
    evidence: ev([
      'Обзор рынка облигаций: доходности выросли, аналитики ждут коррекцию',
      'По данным эмитента, выручка за квартал снизилась, растёт долговая нагрузка',
      'Прогноз по ставкам: рынок закладывает ужесточение'
    ]) });
  A.ok('PRObonds is NOT a direct competitor', bonds.direct_competitor === false);
  A.ok('PRObonds role is news/industry/uncertain, never direct_competitor', ['news_source', 'industry_source', 'irrelevant_or_uncertain'].indexOf(bonds.source_role) >= 0);
}

A.section('source_role — a source that advertises its own niche offers IS a competitor');
{
  const comp = SR.classifySourceRole({ source_id: 'autolombardn1.ru', kind: 'website', niche: 'credit_brokerage',
    evidence: ev([
      'Оформите займ под ПТС за 30 минут, ставка от 3% в месяц — подать заявку онлайн',
      'Выдаём деньги под залог авто, одобрение без справок, у нас деньги за 1 час',
      'Наши условия: займ до 5 млн под залог ПТС, оформить онлайн'
    ]) });
  A.eq('own-offer site -> direct_competitor', comp.source_role, 'direct_competitor');
  A.eq('direct_competitor=true', comp.direct_competitor, true);
  A.ok('confidence is meaningful', comp.role_confidence >= 0.5);
}

A.section('source_role — off-topic / empty are uncertain, never competitor');
{
  const off = SR.classifySourceRole({ source_id: 't.me/x', kind: 'telegram', niche: 'credit_brokerage',
    evidence: ev([
      'British Steel nationalisation talks continue in Parliament',
      'Oracle CDS spreads widen after earnings miss'
    ]) });
  A.eq('off-topic -> irrelevant_or_uncertain', off.source_role, 'irrelevant_or_uncertain');
  A.eq('off-topic NOT competitor', off.direct_competitor, false);

  const empty = SR.classifySourceRole({ source_id: 't.me/y', kind: 'telegram', niche: 'credit_brokerage', evidence: [] });
  A.eq('no evidence -> irrelevant_or_uncertain', empty.source_role, 'irrelevant_or_uncertain');
  A.eq('no evidence confidence 0', empty.role_confidence, 0);
}

A.report('source-role');
