# STAGE_C_ACCEPTANCE_PACK.md — Combined Acceptance Pack (Phase C of the LOCKED A/B/C/D model)

**Status:** 📋 ACCEPTANCE PLAN — run **after** the Stage 3.5 Lead Scout build (DEC-139) and before Stage 4 / Phase D.
**Date:** 2026-06-17 · **Decisions:** DEC-138 (LOCKED A/B/C/D), DEC-139 (Stage 3.5 BUILT).
**Principle (DEC-138):** **no micro-tests per node.** Stage C is ONE deliberate pass of a small set of end-to-end
checks covering Stage 2 paid/live + Stage 3 regression + Stage 3.5 lead end-to-end + safety. Maximum **7 checks**.

> Some checks need paid/live runs or live credentials. Those steps are operator-run and are marked
> `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN` here — the agent does not execute them. Deterministic/fixture
> checks are $0 and can run immediately.

---

## The 7 checks

### C1 — Stage 2 paid/live website snapshot acceptance  *(operator; paid Firecrawl/Apify)*
`WF05 (discovery) → approve direct_competitor candidates → WF06 (handoff) → WF04 (analyzer) → WF12 website block`.
**Expect:** `competitor_site_snapshots` rows (baseline), per-run `live_source_runs`/`agent_requests`, WF06 idempotent
`processed` marking on re-run, WF12 "Сайты конкурентов" block populated. **State:** `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN`.
Cost recorded in `COSTS_AND_LIMITS.md`.

### C2 — Stage 3 regression sanity  *($0 deterministic, or 1 controlled live channel)*
WF11 tracked-channel **fixture** run (no regression) → WF08 deterministic handoff → WF10 → WF12. **Expect:** fixture
counters unchanged, `claude_calls=0`, `technical_errors=0`, deterministic report still PASS. Optional: one controlled
Telegram public-preview live channel (own approval). **State:** fixture = ready now; live = operator-gated.

### C3 — Stage 3.5 fixture lead-source run  *($0, ready now)*
WF13 **fixture mode** → `raw_market_records` audience rows → WF14 v0.3 → `public_lead_signals`. **Expect:** WF13
items_received=9, hard_skipped=1, unique=7 (5 consumer-demand comments + 1 competitor + 1 market post), duplicates=1;
WF14 writes ~5 scored lead signals (high/medium/low bands), repeat run writes 0 + `duplicates_skipped>0`,
`self_test_passed=true`. **State:** ready now ($0).

### C4 — Stage 3.5 controlled public VK source run  *(operator; live VK official API)*
Arm WF13 live: `live_approval_token=I_APPROVE_LIVE_VK_PUBLIC_DISCUSSION`, fill `live_group_allowlist` (1–2 public
groups for `wall.get`) and/or `live_post_allowlist` (1–2 public post URLs for `wall.getComments`), bind the VK API
credential in n8n, enable the disabled HTTP node. Run once. **Expect:** real public comments → audience rows →
WF14 lead signals; `live_source_runs +1` (mode=live, external_calls counted, cost ≈ $0 free public API);
**no member extraction, no private data.** **State:** `BLOCKED_BY_OPERATOR_CREDENTIALS_OR_LIVE_RUN` (see §VK below).

### C5 — WF14 lead scoring / dedup / contact-policy check  *($0, ready now)*
On C3/C4 output: verify `lead_score`/`score_band`/`review_priority` are sane; severe pains (bank_refusal / overdue /
bad КИ / pledge) score higher; **dedup** holds on repeat; public contacts appear **only** with `contact_source_url`
and are blanked → `do_not_use` when unprovable; **every row has `outreach_allowed=false`** and
`recommended_action ∈ {manual_review, content_idea, monitor, ignore}`. **State:** ready now (already fixture-validated;
re-confirm on real data).

### C6 — WF12 report lead block check  *($0, ready now)*
Run WF12 after C3/C4. **Expect:** "Аудитория и публичные лид-сигналы" block shows new-lead count, H/M/L priority,
public-contact-evidence count + policy-hidden count, top pains/intents, and top-N **anonymized** lead summaries —
and **no phone/username/profile is ever printed** in the report; manual-review + no-outreach statements present.
**State:** ready now.

### C7 — Safety check  *($0, ready now)*
Across all lead outputs and workflow code: **no auto-outreach** (no message/call generation, `outreach_allowed=false`
everywhere); **no hidden/private/member extraction, no MTProto, no private-group scraping**; public contacts only with
`contact_source_url` + evidence; approval tokens never stored as values in ledgers (WF15 validator). **State:** ready now.

---

## VK live lead-source readiness (for C4 — exact operator steps)

**App / token:** a VK **standalone/service** app token with access to the **public** wall. Public `wall.get` /
`wall.getComments` work on open communities; no special review needed for public read. **Bind the token ONLY as an
n8n credential** — never in the workflow JSON (`access_token` is a placeholder string there).

**Permissions:** read-only public wall/comments. **Do NOT** request friends/messages/groups-management/offline scopes.

**Methods (the only ones used):** `wall.get` (public group walls) and `wall.getComments` (public post comments).
API version `5.199`.

**Required public objects (operator provides):**
- `live_group_allowlist` — 1–2 public group screen names or URLs (for `wall.get`).
- `live_post_allowlist` — 1–2 public post URLs `https://vk.com/wall-<owner>_<post>` (for `wall.getComments`).

**Rate / cost:** public `wall.get`/`wall.getComments` are **free** (no USD per call); exposure is VK rate limits
(operational), not money. Keep `live_max_items_per_group ≤ 10`, 1–2 targets on the first smoke. Log to
`live_source_runs` (and `COSTS_AND_LIMITS.md` with `cost_not_recovered` if anything unexpected).

**Must NOT be collected (hard policy):** private/closed groups, private messages, member/follower lists, hidden
contacts, friends graphs, any non-public field. Contacts only if **verbatim public** in the post/comment text, always
with `contact_source_url`. **No auto-outreach** — manager-decision only.

---

## After Stage C passes

→ **Phase D — Stage 4 Claude Intelligence Layer** (4.1 Enrichment Core → 4.2 Synthesis & Executive Report →
4.3 Agent-Ready Report & Control Contract), each approval-gated, budget-gated, cost/token-logged, deterministic
fallback intact. Never call Claude before Phase D approval. See `STAGE_4_REPORT_AND_CLAUDE_LAYER.md`.
