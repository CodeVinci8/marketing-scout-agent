// test_wf26_vk_comments.js — Stage D / D2: bounded public VK comments -> public lead signals.
// Proves the LIB comment helpers (parse / deterministic noise gate / community-owned separation / lineage), that
// classifyOffline's AUDIENCE branch is the single scoring contract for comments, the WF26 comment-branch topology
// (gated by vk_comments_approval, embeds semantic_core+vk_collector), the canonical raw_market_records mapping
// (touchpoint_type=public_comment, source_type=public_discussion, approval_status=new; columns are a subset of the
// real 68-col contract), and that NO vk_comments parallel tab was introduced.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert');
const vk = require('../n8n/lib/vk_collector.js');
const sc = require('../n8n/lib/semantic_core.js');
const gen = require('../tools/gen_stage4_workflows.js');
const wf = (gen.generated || []).find(g => g.file === '26_vk_public_community_collector.json').workflow;
function node(n) { return (wf.nodes || []).find(x => x.name === n); }
function code(n) { const x = node(n); return x && x.parameters ? String(x.parameters.jsCode || '') : ''; }

A.section('D2 lib — deterministic noise gate (reject stickers/emoji/greeting/praise/contest/too-short)');
const NOISE = ['', '👍👍', '❤️', 'Привет!', 'Спасибо, полезно', 'Класс!', 'конкурс участвую', 'ок'];
NOISE.forEach(t => A.ok('noise rejected: "' + t + '"', vk.commentNoiseClass(t).noise === true, 'not rejected: ' + JSON.stringify(vk.commentNoiseClass(t))));
const REAL = [
  'Нужен кредит после отказов банков, поможете?',
  'Подскажите, как получить кредит с плохой кредитной историей?',
  'Сколько стоит услуга брокера? Боюсь предоплаты и мошенников',
  'Взяли деньги за кредит и пропали, это развод'
];
REAL.forEach(t => A.ok('real demand kept: "' + t.slice(0, 30) + '…"', vk.commentNoiseClass(t).noise === false, 'wrongly rejected: ' + JSON.stringify(vk.commentNoiseClass(t))));

A.section('D2 lib — community-owned separation (a community-authored comment can never be a lead)');
const ident = { community_id: 111, owner_id: -111, screen_name: 'kredit874', display_name: 'Кредитный брокер', canonical_url: 'https://vk.com/kredit874' };
A.ok('negative from_id (a group) is owner-authored', vk.commentIsOwnerAuthored(-111, ident) === true, 'not flagged');
A.ok('exact community owner_id is owner-authored', vk.commentIsOwnerAuthored(-111, ident) === true, 'not flagged');
A.ok('a real user (positive id) is NOT owner-authored', vk.commentIsOwnerAuthored(555123, ident) === false, 'wrongly flagged');

A.section('D2 lib — parseComments (VK response, error convention, deleted, canonical reply URL)');
const resp = { response: { count: 3, items: [
  { id: 9001, from_id: 555, date: 1751000000, text: 'Нужен кредит под залог ПТС' },
  { id: 9002, from_id: -111, date: 1751000100, text: 'Оставьте заявку, поможем!' },
  { id: 9003, from_id: 777, date: 1751000200, text: 'ok', deleted: 1 }
] } };
const parsed = vk.parseComments(resp, { post_id: 42, owner_id: -111 }, ident, { agent_request_id: 'req_x', source_run_id: 'req_x::vk::kredit874', now: '2026-07-10T00:00:00Z', data_mode: 'live' });
A.ok('parse ok', parsed.ok === true, 'parse failed');
A.eq('deleted comment skipped', parsed.comments.length, 2);
A.eq('canonical reply URL', parsed.comments[0].canonical_url, 'https://vk.com/wall-111_42?reply=9001');
A.ok('VK error body -> not ok', vk.parseComments({ error: { error_code: 15, error_msg: 'Access denied' } }, {}, ident, {}).ok === false, 'error not detected');

A.section('D2 lib — buildCommentRecord lineage + dedup key + public-data-only');
const rec = vk.buildCommentRecord(parsed.comments[0], ident, { agent_request_id: 'req_x', source_run_id: 'req_x::vk::kredit874', workflow_run_id: 'wf', owner_user_id: 'op', now: '2026-07-10T00:00:00Z', data_mode: 'live' });
A.eq('source_type=public_discussion', rec.source_type, 'public_discussion');
A.eq('touchpoint_type=public_comment', rec.touchpoint_type, 'public_comment');
A.eq('dedup_key by owner/post/comment', rec.dedup_key, 'vk::comment::-111_42_9001');
A.ok('carries agent_request_id + source_run_id', rec.agent_request_id === 'req_x' && rec.source_run_id === 'req_x::vk::kredit874', 'lineage missing');
A.ok('parent post id + comment id preserved', rec.post_id === 42 && rec.comment_id === 9001, 'ids missing');
A.ok('no author name/handle resolved (public id only)', !('author_name' in rec) && !('author_handle' in rec), 'author PII present');
const recOwner = vk.buildCommentRecord(parsed.comments[1], ident, {});
A.ok('community-authored comment flagged owner_authored', recOwner.owner_authored === true, 'not flagged owner_authored');

A.section('D2 — classifyOffline audience branch is the single scoring contract for comments');
function cls(t) { return sc.classifyOffline({ text_context: t, text: t, source_type: 'public_discussion', touchpoint_type: 'public_comment', post_url: 'https://vk.com/wall-111_42?reply=1', exact_evidence_url: 'x' }); }
A.eq('buying intent -> buying_intent', cls('Нужен кредит после отказов, где взять?').record_type, 'buying_intent');
A.ok('objection/complaint recognized as audience (not competitor)', ['audience_objection', 'audience_complaint', 'audience_question'].indexOf(cls('Боюсь мошенников, это развод и обман').record_type) >= 0, 'not audience');
A.ok('a plain question is an audience type', String(cls('Подскажите, как исправить кредитную историю?').record_type).indexOf('audience') >= 0 || cls('Подскажите, как исправить кредитную историю?').record_type === 'buying_intent', 'not audience');
A.ok('none of these audience comments are competitor_activity', ['buying_intent', 'audience_objection', 'audience_complaint', 'audience_question'].indexOf(cls('Нужен кредит после отказов, где взять?').record_type) >= 0, 'became competitor');

A.section('D2 — WF26 comment-branch topology, gating, embeds');
A.eq('WF26 grew to 31 nodes', wf.nodes.length, 31);
['Build VK Comment Requests', 'VK wall.getComments', 'Parse & Classify VK Comments', 'Shape VK Comment Rows', 'Append VK Comment Records'].forEach(n => A.ok('has node "' + n + '"', !!node(n), 'missing ' + n));
const conns = wf.connections;
A.ok('Parse Wall -> Build VK Comment Requests', JSON.stringify(conns['Parse Wall & Detect Changes'].main[0]).indexOf('Build VK Comment Requests') >= 0, 'edge missing');
A.ok('comment chain fully wired', ['Build VK Comment Requests', 'VK wall.getComments', 'Parse & Classify VK Comments', 'Shape VK Comment Rows'].every(n => conns[n]), 'chain broken');
A.eq('Append VK Comment Records writes raw_market_records', node('Append VK Comment Records').parameters.sheetName.value, 'raw_market_records');
const reqJs = code('Build VK Comment Requests');
A.ok('comment collection is gated (comments_enabled -> else 0 items)', /comments_enabled/.test(reqJs) && /return \[\];/.test(reqJs), 'not gated');
A.ok('bounded by max_comment_posts', /max_comment_posts/.test(reqJs), 'not bounded');
A.ok('trigger exposes vk_comments_approval', (node('When Called by Agent').parameters.workflowInputs.values || []).some(v => v.name === 'vk_comments_approval'), 'approval input missing');
A.ok('gate honors VK_COMMENTS_APPROVED', /VK_COMMENTS_APPROVED/.test(code('VK Credential Gate')) && /vk_enable_comments:true/.test(code('VK Credential Gate')), 'gate missing comment approval');
const parseJs = code('Parse & Classify VK Comments');
A.ok('parse node embeds semantic_core + vk_collector', /embedded n8n\/lib\/semantic_core\.js/.test(parseJs) && /embedded n8n\/lib\/vk_collector\.js/.test(parseJs), 'embeds missing');
A.ok('parse node calls classifyOffline on public_discussion', /classifyOffline\(\{[^}]*public_discussion/.test(parseJs), 'classifyOffline not used');
A.ok('community-owned routed to competitor context (never a lead)', /owner_authored\)\{[^}]*competitor_activity/.test(parseJs.replace(/\s+/g, '')) || /rec\.owner_authored/.test(parseJs), 'owner-authored not separated');

A.section('D2 — comment rows map to the canonical contract (subset of 68-col raw_market_records; no vk_comments tab)');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sheets_contracts.json'), 'utf8'));
const HEADERS = (CONTRACT.headers || {})['raw_market_records'] || [];
A.ok('no vk_comments tab in contract', !((CONTRACT.tabs || {})['vk_comments']) && !((CONTRACT.headers || {})['vk_comments']), 'vk_comments tab was created');
const shapeJs = code('Shape VK Comment Rows');
const rowBlock = (shapeJs.split('out.push({json:{')[1] || '').split('}});')[0];
const emitted = (rowBlock.match(/(^|\n)\s*([a-z_]+)\s*:/g) || []).map(s => s.replace(/[^a-z_]/g, ''));
emitted.forEach(k => A.ok('comment column "' + k + '" is a real raw_market_records header', HEADERS.indexOf(k) >= 0, 'non-contract column ' + k));
A.ok("shape sets touchpoint_type:'public_comment'", /touchpoint_type:'public_comment'/.test(shapeJs), 'wrong touchpoint');
A.ok("shape sets source_type:'public_discussion'", /source_type:'public_discussion'/.test(shapeJs), 'wrong source_type');
A.ok("shape sets approval_status:'new' (WF08/WF14 selectable)", /approval_status:'new'/.test(shapeJs), 'approval_status not new');
A.ok('shape persists only accepted + competitor_owned (drops noise/error)', /_kind!=='accepted'&&r\._kind!=='competitor_owned'/.test(shapeJs.replace(/\s+/g, '')), 'noise not dropped');

A.section('D2 — drift proof: embedded classifyOffline in the comment node == library (dual-embed context)');
const core = parseJs.split('// --- node driver ---')[0];
const embClassify = (new Function(core + '\n;return classifyOffline;'))();
['Нужен кредит после отказов, где взять?', 'Боюсь мошенников, это развод', 'Подскажите про рефинансирование', 'ok'].forEach(t => {
  const rec2 = { text_context: t, text: t, source_type: 'public_discussion', touchpoint_type: 'public_comment', post_url: 'x', exact_evidence_url: 'x' };
  A.eq('embedded==library for "' + t.slice(0, 20) + '"', JSON.stringify(embClassify(rec2)), JSON.stringify(sc.classifyOffline(rec2)));
});

A.section('D2 — WF14 is request-scopable (callable trigger + override), sole public_lead_signals writer');
const wf14 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', '14_public_lead_signal_triage.json'), 'utf8'));
const trig14 = (wf14.nodes || []).find(n => n.name === 'When Called by Agent');
A.ok('WF14 has a callable trigger', !!trig14 && trig14.type === 'n8n-nodes-base.executeWorkflowTrigger', 'no callable trigger');
A.ok('WF14 trigger exposes source_agent_request_id', trig14 && (trig14.parameters.workflowInputs.values || []).some(v => v.name === 'source_agent_request_id'), 'no request-scope input');
A.ok('WF14 trigger wired to Set Triage Config', JSON.stringify((wf14.connections || {})['When Called by Agent'] || {}).indexOf('Set Triage Config') >= 0, 'trigger not wired');
const cfg14 = (wf14.nodes || []).find(n => n.name === 'Set Triage Config').parameters.jsCode;
A.ok('Set Triage Config applies source_agent_request_id override', /__cfg\.source_agent_request_id\s*=/.test(cfg14), 'no override');
A.ok('manual run still returns a config (defaults preserved)', /return \[\{ json: __cfg \}\]/.test(cfg14), 'override return missing');
const w14writers = ((CONTRACT.tabs || {})['public_lead_signals'] || {}).writers || [];
A.ok('WF14 remains the sole public_lead_signals writer (no parallel VK lead tab)', JSON.stringify(w14writers) === JSON.stringify(['14']), 'writers=' + JSON.stringify(w14writers));

A.report('wf26-vk-comments');
