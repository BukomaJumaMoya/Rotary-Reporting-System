# Rotaract District Information System (DIS)
### Technical documentation package — District 9218, RY 2027–2028

**Status:** Design baseline v1.0 · schema at v1.6 · **in build, M0 sessions 1–3 complete**
**Prepared:** August 2026
**Target launch:** 1 July 2027 (district charter date)
**Ownership:** District property. Repository to be held under a district-controlled GitHub organisation from first commit.

---

## What this package is

A complete design baseline sufficient to begin implementation immediately, written to be consumed both by a human developer and by Claude Code as working context.

| # | Document | Purpose |
|---|---|---|
| 01 | `01-SRS.md` | Scope, actors, functional and non-functional requirements, use case inventory |
| 02 | `02-Architecture.md` | System architecture, stack decisions with rationale, deployment topology, security design |
| 03 | `03-Data-Model.md` | Entity-relationship diagrams by domain, with design narrative |
| — | `schema.sql` | Runnable PostgreSQL DDL — the authoritative schema |
| 04 | `04-Diagrams.md` | Data flow diagrams (L0/L1/L2), use case diagrams, sequence diagrams, state machines |
| 05 | `05-API-Spec.md` | REST API surface, conventions, error model, authorisation matrix |
| 06 | `06-Assessment-Engine.md` | The scoring rules engine — design, DSL, metric resolver registry |
| 07 | `07-Roadmap.md` | Build sequence, milestones, definition of done, pilot plan |
| 08 | `08-Incumbent-Assessment.md` | What the predecessor system does, and why several rules exist |
| 09 | `09-ClaudeCode-M0-Sessions.md` | Session-by-session prompts for M0, with progress |
| 10 | `10-Build-Log.md` | **What has actually been built** — state, decisions, traps, what is stubbed |
| — | `CLAUDE.md` | Project context file for Claude Code — drop at repository root |

## Reading order

**If you are picking up the build:** `CLAUDE.md` → `10-Build-Log.md` → the session prompt in `09-ClaudeCode-M0-Sessions.md`. The design documents describe the intended system; `10-Build-Log.md` describes the one that exists.

**If you are starting from scratch:** `CLAUDE.md` → `02-Architecture.md` → `schema.sql` → `07-Roadmap.md`.

**If you are presenting to the district:** `01-SRS.md` §1–3 and `07-Roadmap.md` only. Nobody in a district meeting wants to see a DDL.

## Naming

The working name throughout is **DIS** (District Information System), repository `rotaract-dis`. Substitute your own name freely — it appears only in `CLAUDE.md`, the README, and package metadata.

## Design axioms

Six commitments that everything else derives from. If a decision conflicts with one of these, the decision is wrong.

1. **The Rotary Year is a dimension, not a filter.** Every transactional row carries `rotary_year_id`. Year context is applied in the data access layer, never left to individual queries.
2. **District affiliation is temporal.** Clubs move between districts. Affiliation is a dated relationship, never a column on `clubs`.
3. **Membership is an event log.** The current roster is derived. Any question about change over time must be answerable without a schema change.
4. **One activity model.** New activity types are configuration rows, never new tables and never a deployment.
5. **The assessment rubric is data.** The PIME Chair edits criteria and weights through the interface. Hard-coding this year's rubric is the single most expensive mistake available.
6. **Personal data is private by default.** Nothing containing contact details is served to an unauthenticated request, ever.

## What is deliberately out of scope for v1

Business directory, public announcements feed, marketing site, birthday automation, social feed, chat. These made the incumbent system wide and shallow. Ship the reporting and assessment spine first.