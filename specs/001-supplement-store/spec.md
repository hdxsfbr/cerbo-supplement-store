# Feature Specification: In-House Supplement Store

**Feature Branch**: `001-supplement-store`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "Build the feature described in docs/PRD.md (ECommerce Supplement Store for Cerbo). A provider assembles a supplement order for a patient inside a Cerbo-styled UI, the patient pays via a stubbed payment step, and the system computes and persists an auditable money split (COGS + provider margin + 75 bps platform fee, integer cents, append-only ledger), with a provider dashboard showing sales and inventory."

> Traces to `docs/PRD.md` (portal brief, FR-1…FR-5) and is governed by
> `.specify/memory/constitution.md` v1.0.0. PRD requirement IDs are noted next to each
> functional requirement below.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Provider assembles an order for a patient (Priority: P1)

A provider, working in a screen that feels native to their EHR, selects one of their patients,
adds one or more supplements from the practice's catalog, and sets the patient-facing price (or a
margin percentage) per item. They see the cost basis and their resulting margin per item and for
the whole order before sending it to the patient for payment.

**Why this priority**: This is the entry point of the entire flow; without it nothing else exists.
It also carries the pricing judgment (price vs. margin per item) that drives the money split.

**Independent Test**: Seed a provider, patients, and catalog; create an order with 2+ items at
different prices; verify the order persists in a "awaiting payment" state with correct per-item
prices, cost snapshot, and a live preview of the eventual split.

**Acceptance Scenarios**:

1. **Given** a provider with patients and a seeded catalog, **When** they add two supplements to
   an order for a patient and set a price on each, **Then** the order totals update instantly and
   show cost, margin, and platform-fee preview per the pricing rules.
2. **Given** an order being assembled, **When** the provider sets a margin percentage instead of a
   price, **Then** the patient-facing price is derived and displayed before sending.
3. **Given** a completed draft, **When** the provider sends it to the patient, **Then** the order
   becomes payable by that patient and is no longer editable by the provider.
4. **Given** an empty order with no items, **When** the provider tries to send it, **Then** the
   system refuses with a clear message.

---

### User Story 2 - Patient pays and the money split is recorded (Priority: P1)

The patient opens their order in a clean patient-facing page, reviews the items and total, and
pays through a simulated payment step. The moment payment succeeds, the system records exactly
where every cent goes: item cost (COGS), provider margin, and the 75 basis-point platform fee.

**Why this priority**: This is the graded heart of the exercise — the money split must be correct
and auditable. Payment + split recording is the smallest demonstration of the business model.

**Independent Test**: Take a seeded awaiting-payment order, complete the fake payment, then verify
(a) the order is marked paid, (b) split records exist for COGS, margin, and fee, (c) the three sum
exactly to the amount paid, including on adversarial totals (one-cent items, half-cent fee
boundaries, multi-item orders).

**Acceptance Scenarios**:

1. **Given** an awaiting-payment order, **When** the patient completes the payment step, **Then**
   the order is marked paid and an immutable split record is created whose parts sum exactly to
   the amount paid.
2. **Given** a paid order, **When** anyone views its audit detail, **Then** every cent is
   attributed: per-order COGS, provider margin, and platform fee, with the fee calculation shown.
3. **Given** a payment that was already completed, **When** the same payment is submitted again
   (double-click, refresh), **Then** no duplicate charge or duplicate split records are created.
4. **Given** an order totaling an amount where the 75 bps fee lands on a fractional cent,
   **When** payment completes, **Then** the fee is rounded per the documented policy and the sum
   invariant still holds exactly.

---

### User Story 3 - Provider dashboard: sales and inventory (Priority: P2)

The provider opens a dashboard, styled like their EHR's billing views, showing what has been sold
(orders, revenue, their margin earned, platform fees deducted) and current inventory levels for
each supplement, which they can adjust.

**Why this priority**: Required by the brief (PRD FR-5) and the surface where "GMV processed
in-house" becomes visible, but it reads from data the P1 stories create — it can land last.

**Independent Test**: With several paid orders seeded, open the dashboard and verify the sales
figures equal the sum of the underlying split records, and that an inventory adjustment persists
and is reflected on the next order screen.

**Acceptance Scenarios**:

1. **Given** multiple paid orders, **When** the provider views the dashboard, **Then** totals for
   gross sales, provider margin, and platform fees match the sum of per-order split records.
2. **Given** the dashboard, **When** the provider drills into a single paid order, **Then** they
   see that order's full cent-by-cent split.
3. **Given** a supplement with inventory on hand, **When** the provider updates its stock count,
   **Then** the new count persists and displays.

---

### Edge Cases

- 75 bps fee lands on a fractional cent (e.g., order total $1.34 → fee 1.005¢): rounded half-up;
  invariant must still hold.
- One-cent order: fee rounds to 0¢; split is COGS + margin only; invariant holds.
- Provider sets a price below COGS: allowed, with a visible warning — margin can be negative
  (provider's call), fee still applies, invariant holds.
- Payment submitted twice (double-click, refresh, replay): exactly one paid state, one set of
  split records.
- Provider attempts to edit an order after sending it for payment: refused; order is locked once
  payable.
- Patient opens an order that was already paid: sees a receipt view, not a pay button.
- Inventory sold below zero: permitted but flagged on the dashboard (stock tracking is
  informational in this slice, not a sales blocker).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (PRD FR-1): Providers MUST be able to assemble an order for one of their patients by
  selecting one or more supplements from a seeded catalog and setting a patient-facing price or a
  margin percentage per item. The catalog's default price per supplement pre-fills each line and
  is overridable; the order line is the source of truth for the money split (DECISIONS.md #6).
- **FR-002** (PRD FR-1): The system MUST snapshot each item's cost basis (COGS) into the order at
  assembly time, so later catalog cost changes never alter historical orders.
- **FR-003** (PRD FR-2): Patients MUST be able to view their order and complete a simulated
  payment step; the payment boundary MUST be a clean, documented stub.
- **FR-004** (PRD FR-3): Upon successful payment, the system MUST compute and persist the money
  split — COGS, provider margin, and a platform fee of 75 basis points of the order total
  (rounded half-up, computed once per order) — as immutable records.
- **FR-005** (PRD FR-4): The split records for any paid order MUST sum exactly to the amount the
  patient paid, with no exceptions; this invariant MUST be enforced by the system of record, not
  only by application code.
- **FR-006** (PRD FR-4): Any paid order MUST expose an audit view showing where every cent went,
  including the fee computation inputs (total, rate, rounding).
- **FR-007** (PRD FR-5): Providers MUST have a dashboard showing sales (orders, gross, margin,
  fees) whose aggregates reconcile exactly with the underlying split records.
- **FR-008** (PRD FR-5): Providers MUST be able to view and update per-supplement inventory
  counts.
- **FR-009**: Payment completion MUST be idempotent — repeated submission of the same payment
  produces no duplicate paid states or split records.
- **FR-010**: Orders MUST follow a lifecycle (draft → awaiting payment → paid) where financial
  fields are frozen once awaiting payment and the record is immutable once paid.
- **FR-011**: Provider and patient identity MUST come from seeded data behind a documented seam
  standing in for the EHR; no real authentication.

### Key Entities

- **Provider**: A clinician who assembles orders and earns margin. Seeded; stands in for the EHR
  user.
- **Patient**: The payer. Belongs to a provider's practice. Seeded; stands in for the EHR patient
  record.
- **Supplement**: Catalog item with a name and current unit cost (COGS) and an inventory count.
- **Order**: A provider-assembled cart for one patient; carries lifecycle state and totals.
- **Order Item**: A supplement on an order, with quantity, snapshotted unit COGS, and the
  patient-facing unit price set by the provider.
- **Payment**: The (stubbed) record of the patient paying an order, with idempotency protection.
- **Split / Ledger Entry**: Immutable records attributing every cent of a paid order to COGS,
  provider margin, or platform fee. Append-only; corrections are new entries.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of paid orders — including adversarial cases (one-cent items, fee landing
  on half-cents, multi-item orders) — the recorded split sums exactly to the amount paid.
- **SC-002**: Given only the stored records of a paid order, a reviewer can account for every
  cent (COGS, margin, fee, rounding) without reading application code.
- **SC-003**: A provider can assemble and send a multi-item order in under 2 minutes; a patient
  can review and pay in under 1 minute.
- **SC-004**: Dashboard aggregates reconcile to the cent with the sum of per-order splits at all
  times.
- **SC-005**: The full demo path (assemble → pay → audit → dashboard) runs end-to-end in under
  5 minutes on the deployed application.
- **SC-006**: Every stubbed boundary (payment, identity/EHR, email, shipping) is identifiable in
  the documentation with what the real implementation would replace.

## Assumptions

- Cerbo holds the inventory; single warehouse, no fulfillment modeling. Inventory counts are
  informational and can go negative (flagged, not blocking).
- US-only, USD-only; tax, shipping cost, and compliance are out of scope per the brief.
- The platform fee is calculated on the order total (what the patient pays) and is borne by the
  provider's margin; the patient always pays sticker price. Rounding is half-up. (DECISIONS.md #4.)
- Negative provider margin is permitted (provider may deliberately price below cost); the system
  warns but does not block.
- A small seeded catalog (≈6–10 supplements) is sufficient; no catalog management UI.
- One provider practice context is sufficient for the demo; multi-practice isolation is out of
  scope.
- Refunds/returns are out of scope for this slice; the append-only ledger design leaves room for
  compensating entries later.
- "Patient pays" needs no real notification channel; sharing/opening the payment link manually is
  acceptable for the demo (email is a documented stub).
- The provider-margin breakdown is provider-facing only; the patient receipt shows items and
  prices, not the split. The submission write-up acknowledges the incentive structure openly
  (DECISIONS.md #7).
