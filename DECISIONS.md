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

**Date:** 2026-10-05 (shipped in T017; enforced by `002_integrity.sql` §2)
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

## 12. Inventory decrements at payment, may go negative (shipped in T017)

**Date:** 2026-10-05
**Context:** The brief treats inventory as informational ("no stock levels required unless
useful"), but the spec's edge case "inventory sold below zero: permitted but flagged" implies
sales do move the count. Drawing the pay-flow sequence for `ARCHITECTURE.md` forced the
question of *when*.
**Decision:** Decrement `supplements.inventory_count` by line quantity inside the same
transaction that records the payment and ledger (not at send time — an unpaid order holds no
stock). No floor: negative counts are allowed and flagged red on the dashboard. Provider edits
via `PATCH /supplements/:id/inventory` set the absolute count.
**Trade-off:** No reservation/oversell protection, which is fine for "Cerbo holds the inventory"
at demo scale; a real version would reserve at send and release on expiry.

## 13. Checkout links derive from the request host in production

**Date:** 2026-10-05
**Context:** The single-image deploy serves SPA and API from one origin, and the Railway domain
is only known after the first deploy. Hard-coding `PUBLIC_WEB_ORIGIN` would mean a second deploy
just to fix links.
**Decision:** When `PUBLIC_WEB_ORIGIN` is unset in production, build payment links from
`x-forwarded-proto` / `x-forwarded-host` (falling back to `Host`). Local dev and the Tailscale
demo still set it explicitly because the SPA and API are on different ports there.
**Trade-off:** Trusting forwarded headers is fine behind Railway's edge; behind an untrusted proxy
you would pin the origin instead. The env var remains the override.

## 14. Notify patients the way Cerbo does: portal message + email nudge, and a demo portal

**Date:** 2026-10-08
**Context:** The first cut had the provider copy a payment link, which was honest about the
notifier being a stub but nothing like Cerbo's product. Cerbo's portal already does secure
messaging and "view and pay bills online"; its API exposes Secure Messages, Patient Emails and
Patient Invoices. Andre asked for the flow to look like Cerbo's and for a payment form that
doesn't look fake.
**Decision:** The notifier seam now *records* the two messages Cerbo would send (portal message
with the pay link, email nudge pointing at the portal) in a `notifications` table, and a small
patient-portal page shows messages, balance due and invoices. Checkout gets a card form with a
browser-side fake tokenizer: only `{token, brand, last4}` reaches the server; Stripe-style test
numbers drive success / decline / processing error through the real 402/502 paths. The seams'
interfaces are unchanged; only their fake implementations got more faithful.
**Trade-off:** More surface to maintain for a demo, and a "fake tokenizer" is a thing a reader
has to understand is fake. In exchange the demo tells the true story: the provider never
handles a link, the patient pays from a message, and declines are a real path.

## 15. Embed the store where Cerbo keeps its Rx flow, and persist a per-line patient sig

**Date:** 2026-10-09
**Context:** The standalone order builder works but is not how a Cerbo provider would meet the
feature. Cerbo's chart has a Medications panel with an "+ Add New Rx" picker and a "+ Complete
Rx" form (docs/cerbo-ui-reference/). Andre asked for a replica of the chart and then for the
store to live inside it as a Supplements tab with the same two-modal flow.
**Decision:** `/experimental-chart` (branch `experiments`) hosts the replica; only the Supplements
tab and its two modals are wired to the API, and they reuse the existing order-draft store, so the
consistency model (serialised saves, validity gating) is unchanged. The Rx form's Patient Sig
fieldset maps to a new nullable `order_items.sig` column (migration 007, ≤500 chars) that the
checkout view shows to the patient. Pharmacy-only concepts (refills, days supply, protocols,
"warn when supply runs out", print) were dropped rather than left as dead chrome.
**Trade-off:** The sig is free text composed from selects plus a note, not a structured dose
record, so it cannot be reasoned about (interactions, adherence) later without re-parsing. That
is enough for a storefront; a real EHR integration would store the structured fields Cerbo's Rx
model already has.

## 16. A demo sign-in and a Cerbo-shaped portal, on top of the same seams

**Date:** 2026-10-09
**Context:** Andre wanted the demo to open like Cerbo does: sign in, land on a chart (doctor)
or the patient portal (patient), and have the store's patient side look like Cerbo's real
portal (docs/cerbo-ui-reference/portal-*.png) rather than the plain `/portal/:token` page.
**Decision:** The root is a hard-coded sign-in (two providers, two patients, `stores/login.ts`).
A doctor login sets the acting provider on the identity seam; a patient login calls
`POST /api/portal/session`, a new identity-seam method that exchanges a seeded patient id for
that patient's portal capability token, after which the Cerbo-style portal uses the existing
`GET /api/portal/:token`. That view gained invoice line items (with `sig`), the card used per
payment, and a `payment_method` summary; no new tables. Paying still goes through the
unchanged `/pay/:token` checkout, which now returns to the new portal for signed-in patients.
**Trade-off:** `POST /api/portal/session` hands out a capability token for any patient id with
no credential check. That is acceptable only because the whole identity seam is a stand-in;
it is documented as such and would be the first thing replaced by Cerbo's portal session.

## 17. The supplement list is clinical; orders are transactions started from it

**Date:** 2026-10-09
**Context:** The chart's first Supplements tab mixed "what this patient takes" with order lines
in one stream, and the portal's My Supplements did the same. Andre asked what the proper
workflow is for a doctor to start an order and for a patient to start one.
**Decision:** Two concepts, two tables. `patient_supplements` is the list: catalog item + sig +
status, added by the provider (chart) or the patient (portal, self-reported). Orders are
created *from* selected list rows (`POST /api/orders` with `patient_supplement_ids`), pre-filled
at catalog price with the list sig, and completed on the existing order page. Each order line
remembers its list row, so the list shows the latest order state per item. A patient can
*request* an order for list rows (`order_requests`); the request is never an order. The provider
either starts an order from it (prices it, sends it, request → fulfilled on send) or declines it
with a note that becomes a portal message. Patients never see prices or margins in the list.
**Trade-off:** One more hop for the doctor (list → select → order page) versus the earlier
modal that priced and sent in place. In exchange the chart reads like Cerbo (a medications-style
list) and the money path has exactly one entry point, the order page, which keeps the split and
ledger rules untouched. Requests add a small inbox the provider must watch; we surface it as a
badge on the tab rather than a new page.
