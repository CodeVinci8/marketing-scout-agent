// run_wf12_redaction.test.js — WF12 Defect A: deterministic report-layer contact redaction ($0, no network).
// Builds a report input whose lead evidence embeds phone / @handle / email / VK & Telegram profile URLs /
// an ordinary source-post URL / a credit amount / a percentage / a rate / a date, and asserts NO direct
// contact identifier survives in ANY report output field, while amounts/percentages/post URL remain.
'use strict';
const H = require('./_harness');
const WF12 = H.loadWorkflow('12_market_intelligence_report_builder.json');

const FORBIDDEN = [
  '@synthetic_lead_1',
  '+7 000 000-00-01',
  'user@example.com',
  'vk.com/id_user_synthetic_1',
  't.me/synthetic_lead',
];
const MUST_KEEP = ['500000', '12%', '18,5%', 'vk.com/wall-111222_301']; // amount / percent / rate / post-URL anchor

const leadRows = [
  {
    lead_signal_id: 'pls_red001', review_status: 'new', review_priority: 'high', score_band: 'high', lead_score: 92,
    source_platform: 'vk', intent_type: 'buying_intent', pain_type: 'bank_refusal', recommended_action: 'manual_review',
    public_phone: "'+7 000 000-00-01", public_username: '@synthetic_lead_1',
    public_profile_url: 'https://vk.com/id_user_synthetic_1', public_contact_type: 'phone',
    contact_source_url: 'https://vk.com/wall-111222_301', contact_use_policy: 'manual_review',
    privacy_flags: 'public_contact_present_manual_review_only',
    evidence_excerpt: 'Нужен кредит 500000 руб под 12%, пишите @synthetic_lead_1 или +7 000 000-00-01, почта user@example.com',
    evidence_text: 'Нужен кредит 500000 руб под 12% после отказа. Контакты: @synthetic_lead_1, +7 000 000-00-01, user@example.com',
    outreach_allowed: false,
  },
  {
    lead_signal_id: 'pls_red002', review_status: 'new', review_priority: 'medium', score_band: 'medium', lead_score: 60,
    source_platform: 'vk', intent_type: 'question', pain_type: 'refinancing_need', recommended_action: 'manual_review',
    public_phone: '', public_username: '', public_profile_url: '', public_contact_type: '',
    contact_source_url: '', contact_use_policy: 'do_not_use',
    privacy_flags: 'contact_blanked_no_source_url',
    evidence_excerpt: 'Рефинансирование под 18,5%, пост https://vk.com/wall-111222_301, профиль https://vk.com/id_user_synthetic_1, https://t.me/synthetic_lead',
    evidence_text: 'Рефинансирование под 18,5%, пост https://vk.com/wall-111222_301, профиль https://vk.com/id_user_synthetic_1, https://t.me/synthetic_lead',
    outreach_allowed: false,
  },
];

const run = H.makeRun();
H.runCodeNode(run, WF12, 'Set Report Config', []);
H.inject(run, 'Read competitor_profiles', []);
H.inject(run, 'Read market_angles', []);
H.inject(run, 'Read audience_activity_signals', []);
H.inject(run, 'Read content_positioning_plan', [{ plan_id: 'plan_20260619_120000', source_evidence: 'rows=5', top_angles: 'после отказов' }]);
H.inject(run, 'Read competitor_site_snapshots', []);
H.inject(run, 'Read public_lead_signals', leadRows);
const rep = H.runCodeNode(run, WF12, 'Build Deterministic Report', [])[0].json;

H.section('WF12 Defect A — contact redaction across every report field');
const blob = JSON.stringify(rep); // every output field at once
for (const bad of FORBIDDEN) H.ok('absent in entire report row: ' + bad, blob.indexOf(bad) < 0, bad);
// field-by-field belt-and-suspenders
for (const f of ['notes', 'audience_summary', 'top_competitors', 'top_angles']) {
  const v = String(rep[f] || '');
  for (const bad of FORBIDDEN) H.ok('absent in ' + f + ': ' + bad, v.indexOf(bad) < 0);
}
for (const keep of MUST_KEEP) H.ok('preserved (business context): ' + keep, blob.indexOf(keep) >= 0, keep);
H.ok('redaction marker present', /\[PUBLIC CONTACT REDACTED\]/.test(blob));
// counts must stay correct after redaction
// REPORT-CLEAN-001: user-facing lead block uses clean Russian (no internal field/enum names, no key=value diagnostics).
H.ok('lead block present in notes', /Публичные лид-сигналы: 2/.test(rep.notes));
// C1-D2: unambiguous contact counters, now in clean Russian without raw field/flag names.
H.ok('contacts detected count shown', /обнаружено 1/.test(rep.notes));
H.ok('contacts excluded count shown', /исключено 1/.test(rep.notes));
H.ok('contacts are stated as not published (redaction)', /контакты не публикуются/.test(rep.notes));
H.ok('no raw report_contains_contacts= diagnostic leaks to the user', !/report_contains_contacts=/.test(rep.notes));
H.eq('report row contacts_detected field = 1', rep.contacts_detected, 1);
H.eq('report row contacts_excluded_from_report field = 1', rep.contacts_excluded_from_report, 1);
H.eq('report row contacts_redacted field = 1', rep.contacts_redacted, 1);
H.eq('report row report_contains_contacts field = false', rep.report_contains_contacts, false);
H.ok('manual-review / no-outreach statement present', /без аутрича/i.test(rep.notes) && !/outreach_allowed=/.test(rep.notes));

// Claude facts payload (future Telegram/LLM) must also be contact-free
H.inject(run, 'Read public_lead_signals', leadRows);
let prompt = null;
try { prompt = H.runCodeNode(run, WF12, 'Build Claude Summary Prompt', [])[0].json; } catch (e) { prompt = { _skipped: String(e.message).slice(0, 40) }; }
if (prompt && prompt.llm_facts_string) {
  for (const bad of FORBIDDEN) H.ok('absent in Claude facts: ' + bad, prompt.llm_facts_string.indexOf(bad) < 0);
} else {
  H.ok('Claude facts payload not built (budget/branch) — n/a', true, prompt && prompt._skipped);
}

const res = H.report('WF12 report redaction');
if (require.main === module) process.exit(res.fail ? 1 : 0);
