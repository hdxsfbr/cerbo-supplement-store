<!--
Sync Impact Report
- Version change: 1.0.0 → 1.0.1 (PATCH: CI provider corrected to GitLab CI; repo is on GitLab, not GitHub)
- Modified principles: n/a (initial adoption)
- Added sections: Core Principles (I–VI), Stack & Scope Constraints, Development Workflow, Governance
- Removed sections: none
- Follow-up TODOs: none
-->

# Cerbo Supplement Store Constitution

Take-home vertical slice for Cerbo (Gauntlet partner project): a provider assembles a supplement
order for a patient, the patient pays, and the system computes and records an auditable money
split. See `docs/PRD.md` for requirements (FR-1…FR-5) and `DECISIONS.md` for the decision log.

## Core Principles

### I. Money Correctness Above All (NON-NEGOTIABLE)

All monetary values MUST be integer cents end to end — no floats, no decimal strings doing
arithmetic. For every paid order, the persisted split MUST satisfy exactly:
`COGS + provider_margin + platform_fee == amount_paid`. The platform fee is 75 bps of the order
total, rounded half-up, computed once per order. The ledger is append-only: no UPDATE or DELETE on
ledger entries; corrections are compensating entries. The sum invariant MUST be enforced at the
database level (constraint or transactional check), and the money path MUST be covered by tests
including rounding edge cases ($0.01 items, half-cent fee boundaries, multi-item orders).

### II. Mirror the Partner's Stack

The stack is Vue 3 + TypeScript SPA, Fastify (TypeScript) REST API, Postgres, Docker. No React,
no Nuxt/Next, no GraphQL, and no ORM that hides the SQL on money paths — schema and money queries
stay inspectable. Rationale: the reviewer is Cerbo; work in their stack is directly legible to
their team (see DECISIONS.md #3).

### III. Clean Seams for Everything Stubbed

Payments, auth/identity (the EHR seam), email, and shipping MUST be faked behind thin,
clearly-marked interfaces that a real implementation could replace without touching callers. Every
stub MUST be documented (what is faked, where the seam is, what the real version would do).
Rationale: the brief grades seam quality, not integration breadth.

### IV. Pragmatic Scope Under the Time Box

Build the smallest thing that proves understanding within 1–2 days. Out of scope: catalog
browsing UX, search, product imagery, tax, compliance, multi-state/international, real
integrations. Test coverage targets money paths and core flow, never coverage for its own sake.
When in doubt, cut and document the cut.

### V. Decisions Documented as They Happen

`DECISIONS.md` (Date / Context / Decision / Trade-off) and `AI_USAGE.md` MUST be updated
continuously as decisions are made and AI is used — not reconstructed at the end. Candor is
required: record where AI helped, where it misled, and where it was overridden. Rationale: both
files are graded deliverables, and in-the-moment logs are the honest version.

### VI. Two Surfaces, Two Design Languages

Provider-facing screens follow Cerbo's chart idiom (colored panel headers, dense tables,
ledger-style billing block) per `docs/cerbo-ui-reference/DESIGN-NOTES.md`. Patient-facing checkout
uses a cleaner patient-portal style. Styling effort stays proportional: the goal is that the
feature reads as native to Cerbo, not pixel-perfect reproduction.

## Stack & Scope Constraints

- Monorepo: `web/` (Vue 3 + Vite + TS + Pinia), `server/` (Fastify + TS), SQL migrations in
  `server/` run against Postgres.
- Local dev via docker-compose (Postgres + services); deployable as Docker image(s) to a public
  URL (Railway/Fly or similar). CI via GitLab CI (the repo is hosted on GitLab).
- Seed data provides providers, patients, and a small supplement catalog (with unit COGS); the
  Greek-god demo patients from Cerbo's own demo are the preferred seed flavor.
- US-only, single currency (USD), Cerbo holds inventory.

## Development Workflow

- Spec-driven: /speckit-specify → /speckit-plan → /speckit-tasks → /speckit-implement, with
  generated artifacts pruned for brevity rather than accepted verbatim.
- Money-path code lands test-first where practical; the split invariant test suite MUST pass
  before any UI work builds on top of it.
- Commits reference the FR they advance (e.g., "FR-3: persist ledger split") when applicable.

## Governance

This constitution governs scope and engineering judgment calls for the take-home. When a proposed
change conflicts with a principle, either the change is rejected or the principle is amended here
first, with the amendment logged in `DECISIONS.md`. Versioning follows semver: MAJOR for principle
removals/redefinitions, MINOR for new or materially expanded principles, PATCH for clarifications.
Compliance check is lightweight: before implement starts and before submission, verify the money
invariant, seam documentation, and decision-log currency.

**Version**: 1.0.1 | **Ratified**: 2026-10-05 | **Last Amended**: 2026-10-05
