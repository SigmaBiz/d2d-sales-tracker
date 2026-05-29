# Session Rules (Context Externalization Protocol)

## Phase 0 — Session Start (run before any code change)
1. Read `.context/STATE.md`
2. Read `.context/PLAN.md`
3. State out loud, explicitly:
   - **β** — what I believe the task is and how the relevant system works
   - **ι** — what I understand the user wants from this session
   - **μ** — my internal model of the codebase at the relevant point
   - **ε** — any gaps or tensions between β, ι, and μ
   Wait for confirmation or correction before starting work.

## Before implementing any feature or change
- Restate the request back as a concrete spec before writing code:
  list every branch, state, and option (e.g. a popup's full
  yes/no/other flow), and every data binding (what metric each
  input feeds, any timers).
- Flag any place my request was ambiguous or where you're inferring
  intent I didn't state. Do not silently fill gaps.
- Wait for my confirmation on the restated spec before editing files.

## Phase 1 — In-Session (coherence check)
- Track plan coherence, not context window %. The signal to stop is: making edits not in the plan, asking questions that should have been resolved in Phase 0, or explaining why something fails without proposing what will work instead.
- When coherence drifts, name it: "I've left the plan — do you want me to re-anchor?" Do not compact and push through.

## Phase 2 — Session End (ε accounting)
- Update STATE.md and PLAN.md before session ends, before any /compact, and whenever a phase completes.
- Log what diverged from the plan as decomposed error type:
  - **ε_μ** — model error (codebase worked differently than expected)
  - **ε_ι** — intent error (built what was said, not what was meant)
  - **ε_β** — belief error (plan based on false assumption about external system)
- Dead-ends list in STATE.md is a calibration instrument, not a graveyard. Include the error type.

## Standing Rules
- All searches, log analysis, docs reading, and codebase exploration → delegate to subagents, always include the WHY
- When stuck or hitting a dead end: log to STATE.md with error type, then start a new session rather than pushing through
- Completeness now beats shortcuts. STATE.md and PLAN.md persist across sessions.

---

# ζ-Framework (Zeta Framework) — Applied Decision Tool

## Core Concept
The ζ-Framework uses quantum state analogies to reason about system reliability and design decisions. Key operator: **Pauli Decoherence (Π₁)** — exposes whether a design is in a mixed state (fragile, Z₁) or a pure state (stable, guaranteed, Z₂).

- **Z₁ (mixed state)** — works under ideal conditions, breaks under real-world variance (network loss, reinstalls, edge cases). Fragile.
- **Z₂ (pure state)** — guaranteed by the system contract. Does not degrade. Stable.
- **Π₁ collapse** — the act of forcing a Z₁ decision toward Z₂ by identifying which option is structurally guaranteed.

## When Claude Must Apply the ζ-Framework

Apply **before** implementation (in plan mode or Phase 0) when ANY of these conditions are true:

1. **Auth or identity decisions** — how users are identified, sessions stored, tokens persisted
2. **Data persistence architecture** — primary storage, offline queues, sync strategies
3. **Integration points with external systems** — APIs, push notifications, webhooks
4. **Features that are widespread or structural** — changes that touch many screens or the data model
5. **Any decision where two competing approaches exist** — use Π₁ to collapse Z₁→Z₂ before choosing

## How to Apply It

State the decision explicitly, then run Π₁:
1. Name the two options: Z₁ candidate vs Z₂ candidate
2. Ask: "Under what real-world conditions does Z₁ break?" List them.
3. Ask: "Is Z₂ guaranteed by a system contract (OS, framework, platform)?" If yes, collapse to Z₂.
4. Document the collapse in the plan with: `ζ-verdict: Z₁→Z₂ (reason)`

## When NOT to Apply It
- UI layout decisions (button placement, colors, spacing)
- Single-file bug fixes
- Features that don't touch data persistence or auth
- Purely additive changes with no architectural trade-offs

## Session History — ζ verdicts issued
- **Auth strategy**: Anonymous auth (Z₁, breaks on reinstall/device change) → Email/password (Z₂, permanent Supabase user ID). `ζ-verdict: Z₁→Z₂ (permanent identity, survives reinstalls)`

---

# D2D Sales Tracker — Project Context

## Business Objective
Storm-targeting canvassing app for an OKC roofing business. After a hailstorm hits the metro area, canvassers need to know which streets were hit and how hard — within hours, not days. The first crew on the right street wins the job. Every technical decision serves that outcome.

## Architecture
React Native / Expo mobile app + Vercel serverless API + Cloudflare R2 cache.
Three-tier hail intelligence system. See `.context/PLAN.md` for full tier breakdown.

## Critical Protocols
- **NO MOCK DATA** — if real data processing fails, error explicitly. Never silently fall back to fake data.
- **Field-First** — every feature must work reliably on a phone in the field.
- **OKC Metro** includes: Oklahoma City, Edmond, Moore, Norman, Midwest City, Del City, Bethany, Warr Acres, Newcastle, Mustang, Yukon.

## Key Files
- `.context/STATE.md` — current session state, blockers, dead ends
- `.context/PLAN.md` — six-phase implementation plan with checkboxes
- `api/mesh/[date].ts` — main GRIB2 → JSON API endpoint (currently broken, see STATE.md)
- `mrms-proxy-server/server-dynamic-precise.js` — last working local server iteration
- `vercel.json` — deployment config
