# Key Decisions

A running log of the decisions made on this project, kept as they happen (not reconstructed
afterward). Feeds directly into the "key decisions and trade-offs" deliverable.

---

## 1. Build standalone — no real EHR integration

**Date:** 2026-10-05
**Context:** The brief frames the store as living "inside our product" (Cerbo's EHR), but Cerbo is
proprietary — there's no codebase or sandbox to integrate with in a 1–2 day take-home.
**Decision:** Build a standalone app. Keep the EHR boundary as a clean seam: provider/patient
identity comes from seeded data behind a thin gateway layer that, in production, would be backed by
the EHR session and Cerbo's REST API (docs.cer.bo).
**Trade-off:** No real integration to show off, but the brief explicitly says to stub auth and keep
seams clean. The seam itself is the demonstration.

## 2. Mimic Cerbo's actual UI

**Date:** 2026-10-05
**Context:** The provider experience is meant to feel like part of Cerbo, not a separate storefront.
Cerbo's public Storylane demo shows their real interface.
**Decision:** Style provider-facing screens in Cerbo's design language (colored panel headers, dense
tables, ledger-style billing block) using the reference captures in `docs/cerbo-ui-reference/`.
Patient checkout gets a cleaner patient-portal look, matching how Cerbo separates the two surfaces.
**Trade-off:** Slightly more styling effort than the brief requires ("we are not grading visual
design"), but it sells the product vision and cost is low since we're copying an established idiom.
**Noted:** Their chart already has a Supplements tab and a supplement-refill portal queue — the
feature slots into an existing mental model.

## 3. Mirror Cerbo's tech stack

**Date:** 2026-10-05
**Context:** No tech restrictions in the brief. Cerbo's profile lists Vue, TypeScript/JavaScript,
MySQL/Postgres, REST, AWS/Docker/CI-CD.
**Decision:** Vue 3 + TS + Vite SPA, Fastify (TS) REST API, Postgres, docker-compose locally,
Dockerized deploy, GitLab CI. Plain SPA + REST server rather than Nuxt, because that mirrors
their actual architecture.
**Trade-off:** A meta-framework like Nuxt or Next would deploy slightly faster, but matching the
partner's real stack makes the work directly legible to their team.

## 4. Fee math: 75 bps on order total, borne by the provider margin

**Date:** 2026-10-05 (proposed — revisit when payment flow lands)
**Context:** The brief requires COGS + provider margin + 75 bps platform fee to sum exactly to what
the patient paid.
**Decision:** All money in integer cents. Platform fee = round-half-up(order_total × 75 / 10000),
computed once on the order total (not per item, fewer rounding seams). Provider margin =
total − COGS − fee, so the fee comes out of the provider's margin and the patient pays sticker price.
Ledger entries are append-only; a DB-level check enforces that splits sum to the total exactly.
**Trade-off:** Per-item fee attribution would make item-level reporting richer but creates rounding
residue to allocate; order-level keeps the invariant trivially auditable.

## 5. Adopt spec-kit for spec-driven development

**Date:** 2026-10-05
**Context:** Andre wanted to try GitHub's spec-kit (github.com/github/spec-kit). The take-home
grades "effective AI leverage" and crisp decision communication; spec-kit's artifacts (spec, plan,
tasks) double as that documentation.
**Decision:** Initialized spec-kit with the Claude Code integration (`specify init --here
--integration claude`). Workflow: /speckit-constitution → /speckit-specify (fed from docs/PRD.md) →
/speckit-plan → /speckit-tasks → /speckit-implement. Treat generated specs as drafts to prune —
keep them lean given the 1–2 day time box.
**Trade-off:** Adds process ceremony to a small vertical slice, and its output overlaps with our
hand-written PRD (the spec will reference the PRD rather than duplicate it). In exchange we get a
dependency-ordered task breakdown and a built-in paper trail for the AI-usage deliverable.

## 6. Pricing lives on the order line, with catalog defaults as pre-fill

**Date:** 2026-10-05
**Context:** Andre questioned whether per-patient pricing was the right reading of the brief. It
is — the brief says the provider sets the patient-facing price (or margin) per item while
assembling an order, which matches how provider supplement marketplaces (e.g., Fullscript) work.
**Decision:** The order line is the source of truth for price (and therefore the money split);
the catalog carries a practice-level default price per supplement that pre-fills the order
builder and can be overridden per line.
**Trade-off:** Slightly more schema (a default-price column) in exchange for a realistic workflow
— nobody invents a price from scratch per line — while keeping the split math anchored to what
this patient actually paid.

## 7. Acknowledge the conflict-of-interest openly in the submission

**Date:** 2026-10-05
**Context:** Andre flagged that provider-set, patient-invisible markups on products the provider
also prescribes "seems scammy." It is a real, known conflict of interest in this market; it is
also the existing status quo on third-party marketplaces, and this is cash-pay retail rather than
insurance billing.
**Decision:** We build the model the brief asks for, and the submission write-up includes a short
section acknowledging the incentive structure and the design choices that lean toward
transparency: itemized patient receipts, cent-exact auditable splits, append-only history. The
margin-visible audit view is provider-facing; the patient receipt shows items and prices only.
**Trade-off:** None technically — this is candor the rubric explicitly rewards ("honesty about
limitations").

## 8. The database asserts the whole split, not just the sum

**Date:** 2026-10-05
**Context:** The brief and constitution require the sum invariant (COGS + margin + fee = total) to
be enforced by the system of record. While writing the deferred constraint trigger
(`002_integrity.sql`), it was equally cheap to assert the components, not only their sum.
**Decision:** At commit, for every paid order the DB asserts: exactly one ledger entry per type;
sum = `orders.total_cents`; exactly one payment of the same amount that all entries reference;
COGS entry = Σ snapshotted item COGS; fee entry = `floor((total × 75 + 5000) / 10000)`. The
TypeScript split function computes the same numbers; if the two ever disagree the payment
transaction fails loudly instead of recording a plausible-looking wrong split.
**Trade-off:** The fee policy now lives in two places (SQL and TS) and changing it is a migration
plus a code change. For money, that duplication is the point — it's a cross-check, not drift.

## 9. COGS snapshot is taken by the database, not the caller

**Date:** 2026-10-05
**Context:** FR-002 requires each order line to carry the cost basis at assembly time. The obvious
implementation has the API read the catalog and write `unit_cogs_cents` on insert.
**Decision:** A `BEFORE INSERT OR UPDATE` trigger on `order_items` overwrites `unit_cogs_cents`
from the catalog, so the API cannot pass a stale or fabricated value; items are also locked (any
INSERT/UPDATE/DELETE rejected) once the order leaves `draft`. Replacing a draft's lines
re-snapshots at that moment, which is the correct reading of "assembly time".
**Trade-off:** A little hidden behaviour (a column the caller doesn't set) in exchange for an
invariant that holds no matter which code path inserts the row — including tests and psql.

## 10. Integration tests run against a throwaway database per test file

**Date:** 2026-10-05
**Context:** The ledger is append-only — UPDATE/DELETE/TRUNCATE are rejected by trigger and
revoked. The usual "truncate tables between tests" pattern is therefore impossible by design.
**Decision:** The test harness creates `cerbo_test_<random>` on the configured Postgres, runs the
real migrations (schema, invariants, seeds), and drops it in teardown. Test files run serially.
**Trade-off:** A few hundred ms per file and a CREATEDB-capable role in CI; in return the tests
exercise the exact migrations and triggers that production runs, with no test-only escape hatch
in the money tables.

## 11. CI runs on GitLab CI, not GitHub Actions

**Date:** 2026-10-05
**Context:** The planning docs and the T003 scaffold assumed GitHub Actions, but the repository is
hosted on Gauntlet's GitLab (labs.gauntletai.com), where a `.github/workflows/` file is inert.
Andre caught it at the Phase 2 review.
**Decision:** Replace the workflow with `.gitlab-ci.yml` (same two jobs: `check` for typecheck/
lint/format/unit tests/build, `integration` against a `postgres:16` service). Constitution
bumped 1.0.0 → 1.0.1 (PATCH) to say "GitLab CI". The brief's "GitHub repository" deliverable is
read as "git repository with source"; the GitLab URL is what gets submitted.
**Trade-off:** None technically. The miss is logged in AI_USAGE.md as an example of the AI
pattern-matching "CI" to GitHub Actions without checking `git remote`.
