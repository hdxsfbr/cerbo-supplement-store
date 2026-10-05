# Phase 0 Research: In-House Supplement Store

No `NEEDS CLARIFICATION` markers existed in the Technical Context (stack was fixed by
constitution II / DECISIONS.md #3). Research below records the remaining technology choices and
the reasoning, so the plan is reproducible.

## R1. Fee rounding implementation

- **Decision**: `feeCents = Math.floor((totalCents * 75 + 5000) / 10000)` — pure integer
  arithmetic, half-up. Guard with `Number.isSafeInteger`; totals here are far below 2^53 so
  BigInt is unnecessary ceremony.
- **Rationale**: Half-up on 75 bps matches DECISIONS.md #4; integer math avoids float drift
  entirely; the formula is trivially unit-testable at the boundaries (fee fraction exactly .5,
  one-cent totals, zero).
- **Alternatives considered**: `Math.round(total * 0.0075)` (float — rejected, violates
  constitution I); BigInt everywhere (safe but noisy; unneeded at demo scale — revisit if sums
  could approach 2^53); banker's rounding (less intuitive to audit, no requirement for it).

## R2. Enforcing the sum invariant at the DB level

- **Decision**: Append-only `ledger_entries` (REVOKE UPDATE/DELETE + trigger raising on
  UPDATE/DELETE), plus a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` that fires when
  an order transitions to `paid` and at every ledger insert, verifying
  `SUM(amount_cents) FILTER (per component) == orders.total_cents` at transaction commit.
- **Rationale**: A plain CHECK can't span tables; a deferred constraint trigger validates the
  complete set of entries exactly once per transaction, so the invariant holds no matter what
  application code does — which is what PRD FR-4 ("correct and auditable") and constitution I
  demand.
- **Alternatives considered**: application-level assertion only (rejected: not "enforced by the
  system of record"); materialized check table (overkill); storing the split on the order row
  and deriving ledger (rejected: ledger must be the source of truth, append-only).

## R3. Postgres client & migrations

- **Decision**: `postgres` (porsager) tagged-template client; migrations as numbered plain
  `.sql` files applied by a ~40-line runner recording applied filenames in a
  `schema_migrations` table.
- **Rationale**: Thin, popular, excellent TS ergonomics, zero query-builder magic — SQL on money
  paths stays reviewable (constitution II). Plain SQL migrations keep the invariant trigger and
  grants readable in one place.
- **Alternatives considered**: `pg` + manual pooling (fine, but clunkier TS); Drizzle (nice but
  schema DSL hides the SQL the graders should read); Prisma/TypeORM (rejected outright —
  constitution II).

## R4. Payment / identity / email seams

- **Decision**: Three TS interfaces in `server/src/seams/`: `PaymentGateway`
  (`createIntent`, `confirm` — fake auto-succeeds, honors an idempotency key),
  `IdentityProvider` (returns the acting provider/patient from seeded data — the EHR seam; a
  header `x-acting-provider` / signed order token stands in for the EHR session), `Notifier`
  (no-op; "email" = the checkout URL surfaced in the UI). Payment idempotency is still re-enforced
  in the DB via a unique key on `payments(order_id)` + status transition guard, so the seam being
  fake never weakens the invariant.
- **Rationale**: Constitution III: swappable boundaries, documented, with correctness anchored
  beneath the seam, not inside the stub.
- **Alternatives considered**: Stripe test mode (realistic but adds keys/webhooks/time; the brief
  explicitly blesses fakes); embedding "paid" as a boolean mutation with no payment record
  (rejected: kills the idempotency story and audit trail).

## R5. Deploy target

- **Decision**: Railway — one service from the repo Dockerfile (Fastify serves `web/dist`
  statically) + managed Postgres add-on; migrations run on boot.
- **Rationale**: Fastest credible path to the required public URL with a real Postgres;
  single-image keeps CORS/config trivial for the demo.
- **Alternatives considered**: Fly.io (equally good; Railway chosen for simpler Postgres
  provisioning UX), Vercel+Neon (splits SPA/API, wrong shape for a Fastify-served SPA), AWS
  (matches Cerbo's infra line but is a time sink for a take-home).

## R6. Styling approach for the Cerbo idiom

- **Decision**: Hand-rolled CSS with custom properties — `cerbo.css` design tokens (panel header
  palette, dense table rules, ledger row styles) per `docs/cerbo-ui-reference/DESIGN-NOTES.md`,
  and a separate lighter `portal.css` for checkout. No Tailwind/component library.
- **Rationale**: The idiom is specific (colored panel headers, zebra tables, red charges); a
  utility framework fights it and adds a dependency for 3 screens. Two stylesheets make
  constitution VI's "two surfaces" literal.
- **Alternatives considered**: Tailwind (fine generally; noise here), Vuetify/PrimeVue (would
  look like a component library, not like Cerbo).

## R7. Order lifecycle & locking

- **Decision**: `orders.status`: `draft → awaiting_payment → paid` enforced by a DB CHECK on
  allowed values plus transition guards in SQL (`UPDATE ... WHERE status = 'draft'` style
  optimistic transitions); financial columns frozen after `draft` by trigger.
- **Rationale**: Spec FR-010; cheap to enforce in the same migration that defines the schema.
- **Alternatives considered**: app-layer state machine only (rejected: same reasoning as R2).
