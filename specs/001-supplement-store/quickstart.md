# Quickstart & Validation Guide

## Prerequisites

- Docker + docker-compose
- Node 22 + npm (only for running tests/lint outside containers)

## Run locally

```bash
docker compose up --build
# web:    http://localhost:5173
# api:    http://localhost:3000/api
# db:     postgres://localhost:5432/cerbo_store (migrations + seeds run on API boot)
```

## Validation scenarios

### 1. Money math unit suite (fastest signal)

```bash
cd server && npm test -- split
```

Expected: all cases green, including: sum invariant property, $0.01 order (fee 0), fee exactly
on a half-cent boundary (rounds up), multi-item negative-margin order.

### 2. End-to-end core flow (spec US1 + US2)

1. Open the web app → Order Builder (acting provider defaults to Dr. Welby via identity seam).
2. Pick patient "Zeus King", add 2 supplements; see price pre-filled from catalog default;
   override one price; split preview updates live.
3. Send order → copy the checkout URL shown (Notifier stub).
4. Open checkout URL (patient surface), press Pay.
5. Expected: receipt view; in Order Audit the three ledger entries sum exactly to the total,
   with the fee memo showing the computation.

### 3. Invariant & idempotency (integration suite, real Postgres)

```bash
cd server && npm run test:integration
```

Expected green: double-pay replay returns original result (one payment row); pay with second
key → 409; editing a sent order → 409; a hand-crafted transaction attempting a 4th ledger entry
or a mismatched sum is rejected **by the database**, not app code.

### 4. Dashboard reconciliation (spec US3)

With ≥2 paid orders (seed script or manual), open Dashboard: gross/margin/fee tiles must equal
the sums from each order's audit view (SC-004); inventory edit persists across reload (FR-008).

### 5. Deployed URL

Same flow as scenario 2 on the Railway URL; `GET /api/health` returns `{ ok: true }` and the
migration version.

## References

- Endpoints: [contracts/api.md](./contracts/api.md)
- Schema & invariant triggers: [data-model.md](./data-model.md)
- Decisions: [/DECISIONS.md](../../DECISIONS.md) · Constitution: `.specify/memory/constitution.md`

## Validation results — 2026-10-05 (T027)

| # | Scenario | Result |
|---|---|---|
| 1 | Money math unit suite (`npm test`) | ✅ 20/20 — includes 200¢ → 2¢ half-up, 1¢ → 0¢, $1.34 → 1¢, negative margin, 5 000-run sum-invariant property |
| 2 | End-to-end core flow (headless Chrome against the compose stack) | ✅ builder → send → patient pay (double-click) → reload shows receipt → audit `BALANCED: $66.00 of $66.00 ✓`; the demo order deliberately lands on the half-cent case (6600¢ × 75 bps = 49.5¢ → 50¢) |
| 3 | Invariant & idempotency (`npm run test:integration`) | ✅ 45/45 — replay returns original receipt; different key → 409; sent order edit → 409; hand-rolled SQL (4th entry, mismatched sum, wrong fee, paid-without-ledger, wrong payment amount, UPDATE/DELETE/TRUNCATE on the ledger) rejected **by Postgres** with SQLSTATEs CB001/CB002/CB003 |
| 4 | Dashboard reconciliation (UI + `dashboard.test.ts`) | ✅ tiles equal Σ per-order ledgers; `cogs + margin + fees = gross` line shown green; inventory edit persists across reload; a sale past zero stock flags "oversold" |
| 5 | Deployed URL | ⏳ pending Railway deploy — image verified locally (`docker run` against compose Postgres: `/api/health` ok, SPA + history fallback, checkout links derive from request host) |

Screenshots of each screen are in `docs/screenshots/`.
