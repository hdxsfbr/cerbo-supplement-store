# PRD — ECommerce Supplement Store (Cerbo)

> Mirrors the project brief on the Gauntlet portal
> (https://portal.gauntletai.com/projects/LdZBHngZolBKXp1tAcJa), Version 1, restructured as a
> working PRD with requirement IDs we can trace commits and tests back to.
> Partner: Cerbo (EHR for functional medicine providers) · Tier: Platinum · Time box: 1–2 days.

## 1. Problem

Cerbo's users are clinical providers who recommend nutritional supplements as part of patient
treatment plans. Today that happens through third-party marketplaces sitting entirely outside the
EHR:

- The provider selects supplements and places the order on the patient's behalf through an
  external marketplace.
- The order ships to the patient; the provider pays the marketplace at point of sale.
- The patient reimburses the provider separately, out-of-band.

Friction at every step: the provider fronts money and chases reimbursement, the patient experience
is disconnected from their care, nothing lands in the clinical record or the practice's financial
system, and all margin and transaction fees accrue to a third-party platform.

## 2. Goal

Bring the flow in-house:

- Providers recommend supplements to a patient directly inside the product.
- The patient pays Cerbo directly.
- The provider's margin is routed to the provider.
- Cerbo takes a **75 bps platform fee** on the transaction.

Assumptions given: Cerbo holds the inventory; US-only; regulatory/compliance out of scope.

**Business context:** supplements are recurring, high-margin, protocol-driven revenue that
currently leaks out of the ecosystem. Owning the flow improves provider/patient experience,
eliminates reimbursement leakage, and captures transaction revenue on volume that already exists.

**Impact metrics:** headline = GMV processed in-house (and the 75 bps earned on it); leading
indicator = volume migrated off third-party marketplaces. What we build should make these
measurable cleanly.

## 3. Scope: a working vertical slice

A provider assembles a supplement order for a patient, the patient pays, and the system correctly
computes and records the money split. Integrity of the core flow and quality of judgment matter
far more than breadth, styling, or polish. Anything external (payments, auth, email, shipping) is
stubbed with clean seams, and the stubs are documented.

### Functional requirements

| ID | Requirement |
|----|-------------|
| FR-1 | A provider can assemble an order for a patient: select one or more supplements, set the patient-facing price (or margin) per item. |
| FR-2 | A patient can pay for that order (stubbed/fake payment step is fine). |
| FR-3 | The system computes and persists the money split for the order: item cost (COGS), provider margin, and the 75 bps platform fee. |
| FR-4 | The split is correct and auditable — a paid order shows exactly where every cent went. |
| FR-5 | Provider dashboard shows what's been sold and supports updating inventory. |

### Explicitly out of scope

1. Real payment processing, real auth, real shipping/fulfillment integrations.
2. Catalog browsing UX, search, product imagery, styling — a hardcoded/seeded list of a few
   supplements is fine.
3. Regulatory/compliance, tax, and shipping cost.
4. Multi-state / international — assume US-only.
5. Inventory mechanics beyond what's needed — Cerbo holds the inventory; no warehouses or stock
   levels required unless useful.

Not graded on: visual design, feature breadth, or test coverage for its own sake. Build the
smallest thing that proves understanding of the problem, and explain the thinking.

## 4. What the reviewers look for

- **Technical judgment:** sensible data model, clean seams, correct money handling, pragmatic
  scoping under a time box.
- **Effective AI leverage:** using AI to move fast and knowing when to override it.
- **Clear thinking and communication:** decisions and trade-offs explained crisply; honesty about
  limitations.

## 5. Constraints & technology

- **Time:** 1–2 days.
- **Technology:** no restrictions; no off-limits tech.
- **Technical contact:** none — make assumptions and document why (see `DECISIONS.md`).

## 6. Required deliverables

1. GitHub repository (source code)
2. Deployed application URL
3. Demo video
4. Documentation (incl. technical documentation)
5. AI usage log (`AI_USAGE.md`): key decisions and trade-offs; what was deliberately cut and what
   would come next with more time; how AI was used — tools, what worked, what didn't, and how we
   iterated when it went sideways. Candor about where AI misled us is a positive signal.

Submission happens directly from the portal project page, tied to project Version 1.

## 7. Traceability

- Decisions & trade-offs → `DECISIONS.md` (running log, updated as decisions happen)
- Cerbo UI reference & design language → `docs/cerbo-ui-reference/`
- Money-split correctness (FR-3/FR-4) → ledger test suite (to come with the scaffold)
