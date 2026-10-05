# Cerbo Supplement Store — vertical slice

A provider assembles a supplement order for a patient inside a screen that feels native to
Cerbo's EHR, the patient pays through a stubbed checkout, and the system records exactly where
every cent went: **COGS + provider margin + a 75 bps platform fee = what the patient paid**, as
integer cents, in an append-only ledger whose invariants are enforced by the database itself.

- **Live demo:** https://app-production-500d.up.railway.app (Railway, single image + managed Postgres; `GET /api/health` reports migration status)
- **Stack:** Vue 3 + TypeScript SPA · Fastify (TypeScript) REST API · PostgreSQL 16 · Docker
  (mirrors Cerbo's own stack — [DECISIONS.md #3](DECISIONS.md))
- **Docs:** [Architecture + glossary](docs/ARCHITECTURE.md) · [PRD](docs/PRD.md) ·
  [Decision log](DECISIONS.md) · [AI usage log](AI_USAGE.md) ·
  [Spec, plan, data model, API contracts, tasks](specs/001-supplement-store/)

| Provider: order builder (Cerbo chart idiom) | Patient: checkout (portal style) |
|---|---|
| ![order builder](docs/screenshots/order-builder-draft.png) | ![checkout](docs/screenshots/checkout.png) |

| Provider: cent-by-cent audit | Provider: dashboard |
|---|---|
| ![audit](docs/screenshots/order-audit.png) | ![dashboard](docs/screenshots/dashboard.png) |

## Run it

Prerequisites: Docker with Compose. (Node 22 + npm only if you want tests/lint outside Docker.)

```bash
docker compose up --build
# web  →  http://localhost:5173
# api  →  http://localhost:3000/api/health
# db   →  postgres://cerbo:cerbo@localhost:5432/cerbo_store   (migrations + seeds run on API boot)
```

Ports taken? Copy `.env.example` to `.env` and set `API_PORT` / `WEB_PORT` / `DB_PORT`. To reach
it from another machine (LAN, Tailscale), also set `PUBLIC_WEB_ORIGIN` and `VITE_API_BASE` to
that machine's address — payment links are built from `PUBLIC_WEB_ORIGIN`.

### The 3-minute demo path

1. **Order builder** (`/orders/new`) — you are "Dr. Marcus Welby" via the identity seam (switch
   provider top-right). Pick **Zeus King**, add two supplements. Prices pre-fill from the
   catalog default; override one, or type a margin % and watch the price derive. The amber
   *Billing* panel shows the live split.
2. **Send to patient** — the order locks and a payment link appears (that link *is* the
   "email"; the notifier is a stub).
3. **Open the link** — the patient surface. Press **Pay**. Double-click it. Refresh. One payment.
4. **Audit** (`/orders/:id/audit`) — the ledger: three entries, their memos, Σ = amount paid,
   and the fee computation (`75 bps of 6600¢ = 49.5¢ → 50¢ (half-up)`).
5. **Reporting** (`/dashboard`) — GMV, margin, COGS, fees as sums over the ledger; inventory
   with inline edit, low/oversold flags.

### Tests

```bash
npm install
npm test                       # money math, no DB (20 cases: half-cent boundaries, 1¢ order, negative margin, 5k-run sum-invariant property)
docker compose up -d db
npm run test:integration       # 45 cases against a throwaway Postgres per file — see below
npm run typecheck && npm run lint && npm run format:check
```

The integration suite creates a fresh database per test file, runs the real migrations, and
then tries to break the money model from *outside* the application — hand-rolled SQL inserting
a mismatched split, a wrong fee, a 4th ledger entry, an `UPDATE` on the ledger, a payment on an
unpaid order — and asserts the **database** rejects each one. It also fires five concurrent pay
requests with the same key (five identical 200s, one payment) and with different keys (one 200,
four 409s). CI runs all of it (`.gitlab-ci.yml`).

## How the money works

```
total   = Σ quantity × unit_price_cents            what the patient pays (sticker price)
cogs    = Σ quantity × unit_cogs_cents             cost basis, snapshotted onto the line at assembly
fee     = ⌊(total × 75 + 5000) ÷ 10000⌋             75 bps of total, rounded half-up, once per order
margin  = total − cogs − fee                       residual ⇒ the sum is exact by construction
```

The fee comes out of the provider's margin; the patient never sees a fee line (DECISIONS.md #4).

**Where it is enforced** — `server/src/db/migrations/002_integrity.sql` is the most important
file in the repo. At `COMMIT`, for every paid order, a deferred constraint trigger asserts:

1. exactly one `cogs`, one `provider_margin`, one `platform_fee` entry;
2. their sum equals `orders.total_cents`;
3. exactly one payment, of that same amount, that all three entries reference;
4. `cogs` equals Σ of the lines' snapshotted COGS;
5. `platform_fee` equals the formula above.

Separately: `ledger_entries` rejects `UPDATE`/`DELETE`/`TRUNCATE` (trigger + revoked
privileges); orders move only `draft → awaiting_payment → paid`; items are locked once sent;
a paid order is immutable; the COGS snapshot is written by a trigger from the catalog, so no
caller can fabricate it. `server/src/money/split.ts` computes the same numbers in TypeScript —
if the two ever disagree the payment transaction fails instead of recording a wrong split.

Idempotency: the client generates a key per checkout session; a replay returns the original
receipt; a different key on a paid order gets `409 already_paid`; `payments.order_id` is
`UNIQUE` as the backstop beneath the application logic.

## Architecture in one paragraph

`web/` is a Vue 3 SPA with two visual surfaces — provider screens in Cerbo's chart idiom
(`cerbo.css`: coloured panel headers, dense zebra tables, ledger-style billing block) and the
patient checkout in a plain portal style (`portal.css`). `server/` is a Fastify API with raw SQL
through the `postgres` driver (no ORM on money paths); routes are thin, the database holds the
invariants. One Docker image serves both (`Dockerfile`). Diagrams, the pay-flow sequence, and a
glossary are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
server/src/db/migrations/     001 schema · 002 integrity triggers · 003 seed
server/src/money/split.ts     the split, pure integer math
server/src/seams/             identity · payment · notifier (interfaces + fakes)
server/src/routes/            catalog · patients · orders · checkout · dashboard
web/src/views/                OrderBuilder · Checkout · OrderAudit · Dashboard
```

## What is stubbed, and where the seam is

| Boundary | What is faked here | Where the seam is | What production would do |
|---|---|---|---|
| **Identity / EHR** | Acting provider comes from an `x-acting-provider` header (switcher in the nav); patient access is a random capability token on the order (`/pay/<token>`). | `server/src/seams/identity.ts` → `IdentityProvider` | Read the EHR session for the provider; back the patient link with the portal session or a signed, expiring link. Routes never change. |
| **Payment** | `FakePaymentGateway.charge()` always succeeds and returns a deterministic reference per idempotency key. | `server/src/seams/payment.ts` → `PaymentGateway` | Create/confirm a PaymentIntent (Stripe or similar) with the same idempotency key *before* the DB transaction; handle declines/3DS/webhooks; store the processor reference. The DB still refuses a second payment per order and re-asserts the split at commit, so a buggy gateway cannot corrupt the ledger. |
| **Email / notification** | `NoopNotifier` logs; the UI shows the payment link instead. | `server/src/seams/notifier.ts` → `Notifier` | Transactional email, or push into Cerbo's patient-portal queue (where supplement refills already surface). |
| **Shipping / fulfilment** | Not modelled. Inventory is a count that decrements at payment and may go negative (flagged). | — | Reservation at send, release on expiry, fulfilment events. |
| **Providers / patients / catalog** | Seeded by migration `003_seed.sql` (Greek-god demo patients, 8 supplements with COGS and default prices). | the migration | Synced from the EHR and a catalog service. |

## Assumptions and deliberate cuts

- US-only, USD-only, cash-pay retail. No tax, shipping cost, insurance, or compliance logic.
- One practice context per provider; patients belong to one provider. No multi-practice isolation.
- The platform fee is computed once on the order total (not per line) and is borne by the
  provider's margin. Rounding is half-up. (DECISIONS.md #4)
- Pricing lives on the order line; the catalog's default price only pre-fills. (DECISIONS.md #6)
- Negative margin is allowed with a warning — the provider's call.
- No refunds/returns. The append-only ledger is designed for compensating entries, which is the
  obvious next feature; `UNIQUE (order_id, entry_type)` would relax to accommodate them.
- No real auth, no catalog management UI, no search, no imagery, no tests for UI chrome.
- Low-stock threshold is a constant (25); inventory is informational, not a sales blocker.

**What I'd do next with more time:** refunds as compensating entries; reservation-based
inventory; a real payment gateway behind the existing seam with webhook reconciliation; per-item
fee attribution reporting (keeping the order-level fee as the ledger truth); role separation at
the DB (an app role without `DISABLE TRIGGER` rights, which a superuser compose role currently
bypasses); Cerbo chart integration via their REST API so orders land in the patient record.

## A note on the incentive structure

This model asks a provider to set a patient-invisible markup on products they also prescribe.
That is a real conflict of interest — and also the status quo on third-party supplement
marketplaces today, in a cash-pay retail setting. The design leans toward transparency where it
can without changing the business model: the patient receipt is itemised; every paid order has
a cent-exact, append-only audit trail; the margin is visible to the provider on every screen,
including a warning whenever a line is priced below cost. See DECISIONS.md #7.

## Deploy

Single image, managed Postgres. `Dockerfile` builds the SPA and API and serves both from
Fastify; migrations run on boot; payment links derive from the request host, so no origin
config is needed on a single-origin deploy.

```bash
docker build -t cerbo-store .
docker run -p 3000:3000 -e DATABASE_URL=postgres://user:pass@host:5432/db cerbo-store
```

Deployed with the Railway CLI: `railway init` → `railway add --database postgres` →
`railway add --service app --variables 'DATABASE_URL=${{Postgres.DATABASE_URL}}'` →
`railway up --service app` → `railway domain`. Live at https://app-production-500d.up.railway.app.
