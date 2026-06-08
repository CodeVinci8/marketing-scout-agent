# STAKEHOLDER_INTERVIEW_2026_06_08.md — Stakeholder Interview (Product Reframe)

**Date:** 2026-06-08
**Participants:** operator/stakeholder (secured-lending business, Moscow & Moscow Oblast) + project agent.
**Purpose:** capture the stakeholder's vision after Stage 3.0 started as "Lead Source Evaluation". The interview
clarified the product is **broader than lead parsing** — an agentic business automation system, not a slash-command bot.

> This doc preserves the **raw business meaning**. Terms are kept as the stakeholder used them: Avito, Yandex
> Dzen, comments, brokers, Moscow, subscribers, competitors, semantics, ads, USP, outreach, calls, auto-calls,
> "agent as employee".

---

## 1. Raw structured notes (as said)

**Sources & behavior**
- **Avito:** competitors, "quick money", ads/listings. Look at listings, reviews, chats/comments where possible.
- **Parse people who leave comments. Build a table. Comments are important.**
- **Yandex Dzen:** potentially find contacts / touchpoints. Go to thematic pages and their comments.
- **Example:** collect **brokers in Moscow**, analyze their pages, **subscribers**, **comments**.
- Find **people interested in services**.

**Competitor intelligence**
- Competitors: collect **semantics**, **where they advertise**, **what they publish**, **their advantages**.
- Find **relevant queries that bring them clients**.
- Build **USP**.

**Outreach (later)**
- Later: **outreach, calling, auto-calling**. (Not now.)

**Business framing**
- Business processes, marketing, brokers, services, "quick money".
- Understand **where there is a touchpoint with the client**.
- **The agent should work like an employee.**

---

## 2. Interpreted needs

- The deliverable is not "hot leads only" — it is **points of contact with the client** at every temperature
  (hot lead → warm touchpoint → cold audience), **plus** competitor intelligence and content/semantic signals.
- **Comments and commenters** are a first-class data source, not a side effect — both for warm touchpoints and
  for mining competitor audiences.
- The agent must **remember** business context, known competitors, prior findings, and **what has already been
  checked**, so it behaves like an employee rather than a stateless command runner.
- After producing results, the agent should **recommend next actions** (not just dump rows).
- Competitor analysis is a primary output: semantics, ad channels, publishing patterns, advantages → feed a
  **USP/positioning** capability.

## 3. Product implications

- **Reframe:** product = **Business Scout Agent** (an AI employee with internal automations). Marketing / lead /
  competitor intelligence is its **first capability domain** ("Marketing Scout").
- Telegram/chat is a **future control interface**, not the product; the core is **tools + memory + analysis**.
- Stage 3 is reframed from "Lead Source Evaluation" to **Social/Classified Touchpoint Discovery** — lead
  discovery becomes a **subset** of touchpoint discovery.
- New record classes are needed beyond `lead_signal` (warm touchpoints, cold audience, competitor audience,
  semantic/ad signals, pains, questions/objections).
- New **internal tools** are implied: comment mining, competitor audience mining, semantic/ads analysis,
  USP/positioning, outreach drafting, reporting, and a **next-action recommender**.
- A **project-owned memory** layer is needed (business profile, competitors, source quality, follow-ups, etc.).

## 4. Risks / constraints

- **Compliance & privacy:** parsing commenters / subscribers / audiences must be **public data only**, minimized,
  and never used for unauthorized outreach. ToS/anti-bot/platform rules apply per source.
- **Outreach / calling / auto-calling:** legally sensitive (consent, telecom rules) — **deferred** until a
  dedicated compliance/platform review. No mass send, no autocall in any near-term stage.
- **Source access:** Avito/Dzen/VK/Telegram each need separate feasibility + access design; Telegram **parser**
  ≠ Telegram **Control Bot**.
- **Scope creep:** "agent as employee" is broad; build incrementally behind human approval and cost gates.
- **Data quality:** comments/audiences are noisy; classification + dedup must be robust.

## 5. Open questions for the next stakeholder conversation

1. **Full desired-agent list:** what specific "agents"/automations does he want, and in what priority?
2. **Outreach scope & legality:** what outreach is actually intended (manual first-touch only? calls?), and who
   owns telecom/consent compliance?
3. **Definition of a "good" touchpoint:** when is a commenter/subscriber worth contacting vs noise?
4. **Region/service scope:** only PTS/auto/real-estate secured lending, or other services/niches (market_profile)?
5. **Data retention/privacy posture:** how long to keep personal data; what minimization rules?
6. **Reporting cadence:** weekly digest? per-run summary? which export format (Sheet links vs XLSX)?
7. **Budget envelope:** acceptable source-acquisition and analysis spend per run/week.
