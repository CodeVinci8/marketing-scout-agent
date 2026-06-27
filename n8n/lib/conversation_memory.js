'use strict';
// conversation_memory.js — Part 3 + 4: bounded, multi-layer conversation memory.
//
// The full transcript is NEVER sent to Claude. Context is assembled in priority order under a token budget:
//   L0 charter · L1 current request state · L2 recent message window · L3 rolling summary ·
//   L4 durable memory · L5 relevant artifacts.
// Older messages are compacted into a versioned rolling summary that PRESERVES decisions/entities/IDs/
// references verbatim (the summarizer may never rewrite an ID, report or decision). Durable memory is isolated
// per Telegram user, supports forget/forget-all with audit (the deleted sensitive value is not retained), and
// never stores secrets. Standalone + deterministic so it embeds into a Code node.

function str(v) { return v == null ? '' : String(v).trim(); }
function low(v) { return str(v).toLowerCase(); }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

// ~4 chars per token is good enough for budgeting fixtures (no tokenizer dependency).
function estimateTokens(text) { return Math.ceil(str(text).length / 4); }

const WINDOW_DEFAULT = 8;
const MEMORY_TYPES = ['preference', 'region', 'niche', 'format', 'tracked_competitor', 'selected_source', 'decision', 'monitoring_goal', 'saved_report'];
const ID_RX = /\b(req_[a-z0-9_]+|rep_[a-z0-9_]+|firecrawl_[0-9_]+|apify_[a-z0-9_]+|dlv_[a-z0-9_]+|conv_[a-z0-9_]+)\b/gi;
const SECRET_RX = /token|secret|api[_-]?key|passwor|bearer|bot[0-9]{6,}:|sk-ant|aiza[0-9a-z\-_]{10,}|xox[bap]-/i;

// ---- L1 current request state -----------------------------------------------------------------------------
function newConversationState(conversationId, userId) {
  return {
    conversation_id: str(conversationId), owner_user_id: str(userId),
    active_agent_request_id: '', current_intent: '', current_state: 'idle', current_plan_id: '',
    last_report_id: '', last_source_run_ids: [], selected_competitors: [], selected_sources: [],
    pending_clarification: '', pending_approval: false, current_region: '', current_service: '',
    comparison_baseline_id: '', no_memory: false, revision: 0, updated_at: ''
  };
}
function patchState(state, patch, ts) {
  return Object.assign({}, state || {}, patch || {}, { updated_at: str(ts) || (state && state.updated_at) || '' });
}

// STATE-004 / MEMORY-001 / STATE-005: pick the authoritative current state row for one conversation+owner
// (highest revision, tie-broken by updated_at) instead of "last row in sheet order". Owner is part of the key so
// group chats / multiple users never read each other's state.
function selectLatestState(rows, conversationId, ownerUserId) {
  const mine = (rows || []).filter(r => str(r.conversation_id) === str(conversationId) && (ownerUserId == null || str(r.owner_user_id) === str(ownerUserId)));
  if (!mine.length) return null;
  return mine.slice().sort((a, b) => {
    const dr = num(b.revision, 0) - num(a.revision, 0);
    if (dr) return dr;
    return str(b.updated_at) < str(a.updated_at) ? -1 : 1;
  })[0];
}
// Patch the EXISTING latest row (preserving prior fields) and bump a monotonic revision — never overwrite a
// newer state with a blank fresh object. prev_revision is recorded so a conflict (stale write) is detectable.
function advanceState(existing, patch, ts) {
  patch = patch || {};
  const base = existing || newConversationState(patch.conversation_id, patch.owner_user_id);
  const rev = num(base.revision, 0) + 1;
  return Object.assign({}, base, patch, { revision: rev, prev_revision: num(base.revision, 0), updated_at: str(ts) || (base.updated_at || '') });
}
// True when the revision we read at the start no longer matches what is durably stored (someone else advanced it).
function stateConflict(expectedRevision, currentRevision) {
  return num(expectedRevision, -1) >= 0 && num(currentRevision, 0) !== num(expectedRevision, 0);
}
// Latest valid rolling summary for one conversation+owner, by highest version (MEMORY-002 continuity).
function selectLatestSummary(rows, conversationId, ownerUserId) {
  const mine = (rows || []).filter(r => str(r.conversation_id) === str(conversationId) && (ownerUserId == null || ownerUserId === '' || str(r.owner_user_id) === str(ownerUserId) || r.owner_user_id == null));
  if (!mine.length) return null;
  return mine.slice().sort((a, b) => num(b.version, 0) - num(a.version, 0))[0];
}

// ---- L2 recent window -------------------------------------------------------------------------------------
function recentWindow(messages, n) {
  const m = Array.isArray(messages) ? messages : [];
  const k = num(n, WINDOW_DEFAULT);
  return m.slice(Math.max(0, m.length - k));
}

// ---- L3 rolling summary -----------------------------------------------------------------------------------
// Trigger when the recent window or approximate token count exceeds the configured threshold.
function shouldSummarize(messages, cfg) {
  cfg = cfg || {};
  const m = Array.isArray(messages) ? messages : [];
  const win = num(cfg.recent_window, WINDOW_DEFAULT);
  const maxTok = num(cfg.summary_trigger_tokens, 1200);
  const tok = m.reduce((a, x) => a + estimateTokens(x && x.text), 0);
  return m.length > win || tok > maxTok;
}

function collectIds(textBlobs) {
  const ids = []; const seen = {};
  for (const t of textBlobs) {
    const s = str(t); let mm;
    ID_RX.lastIndex = 0;
    while ((mm = ID_RX.exec(s)) !== null) { const id = mm[1]; if (!seen[id]) { seen[id] = 1; ids.push(id); } }
  }
  return ids;
}

// Compact older messages into a versioned summary. Decisions/entities/references/IDs are PRESERVED verbatim;
// the previous summary is retained for audit (prev_version). The summarizer never alters an ID/report/decision.
function rollingSummary(prevSummary, olderMessages, opts) {
  opts = opts || {};
  const prev = prevSummary || null;
  const msgs = Array.isArray(olderMessages) ? olderMessages : [];
  const decisions = [];
  for (const m of msgs) {
    const t = str(m && m.text);
    if (/approve|одобр|подтвержд|reject|отклон|cancel|отмен|добав|pause|пауз|resume|возобнов|rerun|повтор/i.test(t)) {
      decisions.push({ role: str(m.role), message_id: str(m.message_id), gist: t.slice(0, 140) });
    }
  }
  const preservedIds = collectIds(msgs.map(m => m && m.text).concat(prev ? [prev.text] : []));
  const entities = [].concat((prev && prev.entities) || [], opts.entities || []);
  const references = [].concat((prev && prev.references) || [], opts.references || []);
  const goals = [].concat((prev && prev.goals) || [], opts.goals || []);
  const unresolved = opts.unresolved || (prev && prev.unresolved) || [];
  const version = (prev && num(prev.version, 0) || 0) + 1;
  const dedup = a => { const s = {}; return a.filter(x => { const k = JSON.stringify(x); if (s[k]) return false; s[k] = 1; return true; }); };
  const text = [
    'Сводка диалога v' + version + ':',
    goals.length ? ('Цели: ' + dedup(goals).map(str).join('; ')) : '',
    decisions.length ? ('Решения: ' + decisions.map(d => d.gist).join(' | ')) : '',
    entities.length ? ('Сущности: ' + dedup(entities).map(str).join(', ')) : '',
    preservedIds.length ? ('ID: ' + preservedIds.join(', ')) : '',
    unresolved.length ? ('Открытые вопросы: ' + dedup(unresolved).map(str).join('; ')) : ''
  ].filter(Boolean).join('\n');
  return {
    version: version, prev_version: prev ? num(prev.version, 0) : 0,
    text: text, decisions: decisions, entities: dedup(entities), references: dedup(references),
    goals: dedup(goals), unresolved: dedup(unresolved), preserved_ids: preservedIds,
    covers_message_ids: msgs.map(m => str(m && m.message_id)).filter(Boolean),
    created_at: str(opts.ts)
  };
}

// ---- L4 durable memory ------------------------------------------------------------------------------------
function isSecretLike(key, value) {
  return SECRET_RX.test(str(key)) || SECRET_RX.test(str(typeof value === 'string' ? value : JSON.stringify(value || '')));
}
function makeMemory(p) {
  p = p || {};
  if (MEMORY_TYPES.indexOf(str(p.memory_type)) < 0) return { ok: false, reason: 'bad_memory_type', memory: null };
  if (isSecretLike(p.key, p.value_json)) return { ok: false, reason: 'secret_blocked', memory: null };
  const scope = p.conversation_id ? str(p.conversation_id) : 'global';
  const mem = {
    memory_id: 'mem_' + str(p.owner_user_id) + '_' + str(p.memory_type) + '_' + str(p.key),
    owner_user_id: str(p.owner_user_id), scope: scope, conversation_id: p.conversation_id ? str(p.conversation_id) : '',
    memory_type: str(p.memory_type), key: str(p.key), value_json: p.value_json === undefined ? '' : p.value_json,
    source_message_id: str(p.source_message_id), confidence: num(p.confidence, 0.8), status: 'active',
    created_at: str(p.ts), updated_at: str(p.ts), last_used_at: '', expires_at: str(p.expires_at)
  };
  return { ok: true, reason: '', memory: mem };
}
// Strict per-user isolation: one user can never see another user's memory.
function memoriesForUser(memories, userId) {
  return (memories || []).filter(m => str(m.owner_user_id) === str(userId) && str(m.status) === 'active');
}
function memoryView(memories) {
  return (memories || []).filter(m => str(m.status) === 'active').map(m => ({
    memory_id: m.memory_id, type: m.memory_type, key: m.key,
    value: typeof m.value_json === 'string' ? m.value_json : JSON.stringify(m.value_json), confidence: m.confidence
  }));
}
// Forget one memory by id/key/type. The audit event records WHAT was removed (key + value hash), never the
// raw sensitive value.
function valueHash(v) { const s = typeof v === 'string' ? v : JSON.stringify(v || ''); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'h' + h.toString(16); }
function forgetMemory(memories, selector, ctx) {
  ctx = ctx || {}; const userId = str(ctx.owner_user_id);
  const sel = low(selector);
  const removed = []; const kept = [];
  for (const m of (memories || [])) {
    const mine = str(m.owner_user_id) === userId || userId === '';
    const match = mine && m.status === 'active' && (low(m.memory_id) === sel || low(m.key) === sel || low(m.memory_type) === sel || (sel && low(JSON.stringify(m.value_json)).indexOf(sel) >= 0));
    if (match) removed.push(m); else kept.push(m);
  }
  const audit = removed.map(m => ({
    event: 'memory_forget', owner_user_id: m.owner_user_id, memory_id: m.memory_id,
    memory_type: m.memory_type, key: m.key, value_hash: valueHash(m.value_json), ts: str(ctx.ts)
  }));
  // tombstone (status removed) rather than drop, so it is excluded from prompts but auditable
  const out = kept.concat(removed.map(m => Object.assign({}, m, { status: 'removed', updated_at: str(ctx.ts), value_json: '' })));
  return { memories: out, removed: removed.length, audit: audit };
}
function forgetAll(memories, ctx) {
  ctx = ctx || {};
  if (ctx.confirmed !== true) return { ok: false, reason: 'confirmation_required', memories: memories || [], removed: 0, audit: [] };
  const userId = str(ctx.owner_user_id);
  const r = (memories || []).filter(m => str(m.owner_user_id) === userId && m.status === 'active');
  const audit = r.map(m => ({ event: 'memory_forget_all', owner_user_id: m.owner_user_id, memory_id: m.memory_id, key: m.key, value_hash: valueHash(m.value_json), ts: str(ctx.ts) }));
  const out = (memories || []).map(m => (str(m.owner_user_id) === userId && m.status === 'active') ? Object.assign({}, m, { status: 'removed', updated_at: str(ctx.ts), value_json: '' }) : m);
  return { ok: true, reason: '', memories: out, removed: r.length, audit: audit };
}
// /new — reset active conversation context but KEEP durable user preferences.
function resetConversation(state, conversationId, ts) {
  const fresh = newConversationState(conversationId, state && state.owner_user_id);
  return patchState(fresh, {}, ts);
}

// ---- L5 artifacts (retrieve only what's needed; never whole Sheets tabs) ----------------------------------
function selectArtifacts(refs, store) {
  refs = refs || {}; store = store || {};
  const out = {};
  if (refs.plan && store.plans) out.plan = (store.plans || []).find(p => str(p.plan_id) === str(refs.plan)) || null;
  if (refs.request_state) out.request_state = store.request_state || null;
  if (refs.last_report && store.reports) out.last_report = (store.reports || []).find(r => str(r.report_id) === str(refs.last_report)) || null;
  if (refs.competitors && store.competitors) {
    const want = (refs.competitors || []).map(str);
    out.competitors = (store.competitors || []).filter(c => want.indexOf(str(c.company_name || c.ref)) >= 0);
  }
  if (refs.sources && store.tracked_sources) out.tracked_sources = store.tracked_sources;
  if (refs.baseline && store.reports) out.baseline = (store.reports || []).find(r => str(r.report_id) === str(refs.baseline)) || null;
  return out;
}

// ---- retrieval + token budget -----------------------------------------------------------------------------
const PRIORITY = ['charter', 'state', 'safety', 'newest', 'artifacts', 'recent', 'summary', 'durable'];
const REQUIRED = ['charter', 'state', 'safety', 'newest'];

// Assemble the prompt context under a token budget, in priority order. Required sections (charter, current
// state, safety/approval constraints, newest user message) are NEVER dropped. Optional sections are added
// while the budget holds; the rest are recorded as omitted. Returns the assembly + a usage record.
function buildContext(sections, cfg) {
  sections = sections || {}; cfg = cfg || {};
  const maxTokens = num(cfg.max_context_tokens, 6000);
  const included = []; const omitted = []; let used = 0;
  const parts = [];
  // 1. required first (always)
  for (const name of REQUIRED) {
    const text = str(sections[name]);
    if (!text) continue;
    used += estimateTokens(text); included.push(name); parts.push({ name: name, text: text });
  }
  let truncated = false;
  // 2. optional in priority order, within budget
  for (const name of PRIORITY) {
    if (REQUIRED.indexOf(name) >= 0) continue;
    const text = str(sections[name]);
    if (!text) continue;
    const t = estimateTokens(text);
    if (used + t <= maxTokens) { used += t; included.push(name); parts.push({ name: name, text: text }); }
    else { omitted.push(name); truncated = true; }
  }
  return {
    prompt: parts.map(p => '## ' + p.name + '\n' + p.text).join('\n\n'),
    sections_included: included, sections_omitted: omitted,
    est_input_tokens: used, max_context_tokens: maxTokens, truncated: truncated,
    summary_version: num(sections.summary_version, 0)
  };
}

function contextUsageRecord(ctxResult, ids) {
  ids = ids || {};
  return {
    conversation_id: str(ids.conversation_id), agent_request_id: str(ids.agent_request_id),
    est_input_tokens: num(ctxResult.est_input_tokens, 0), max_context_tokens: num(ctxResult.max_context_tokens, 0),
    sections_included: (ctxResult.sections_included || []).join(','), sections_omitted: (ctxResult.sections_omitted || []).join(','),
    summary_version: num(ctxResult.summary_version, 0), truncated: !!ctxResult.truncated, ts: str(ids.ts)
  };
}

module.exports = {
  WINDOW_DEFAULT, MEMORY_TYPES, PRIORITY, REQUIRED, estimateTokens,
  newConversationState, patchState, selectLatestState, advanceState, stateConflict, selectLatestSummary,
  recentWindow, shouldSummarize, rollingSummary, collectIds,
  isSecretLike, makeMemory, memoriesForUser, memoryView, forgetMemory, forgetAll, resetConversation,
  selectArtifacts, buildContext, contextUsageRecord, valueHash, str, low, num
};
