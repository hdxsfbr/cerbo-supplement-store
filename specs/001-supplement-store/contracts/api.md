# REST API Contracts

Base path `/api`. JSON in/out. All money fields are integer cents with names ending `_cents`.
Errors: `{ "error": { "code": string, "message": string } }` with appropriate 4xx/5xx.

**Identity seam**: provider endpoints read the acting provider from `x-acting-provider: <id>`
(stand-in for the EHR session; see `server/src/seams/identity.ts`). Patient checkout endpoints
authenticate by capability token in the URL — no header.

## Provider — catalog & inventory

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/supplements` | List catalog | includes `unit_cogs_cents`, `default_price_cents`, `inventory_count` |
| `PATCH /api/supplements/:id/inventory` | Set inventory count | body `{ "inventory_count": int }` (FR-008) |

## Provider — patients

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/patients` | List the acting provider's patients | for the order builder picker |

## Provider — orders

| Method & Path | Purpose | Notes |
|---|---|---|
| `POST /api/orders` | Create draft | body `{ patient_id }` → order with status `draft` |
| `PUT /api/orders/:id/items` | Replace draft items | body `{ items: [{ supplement_id, quantity, unit_price_cents, sig? }] }` (`sig` = optional patient directions, ≤500 chars); server snapshots `unit_cogs_cents`; 409 unless status=`draft` |
| `GET /api/orders/:id` | Fetch order + items + live split preview | preview computed, not persisted, while draft |
| `POST /api/orders/:id/send` | draft → awaiting_payment | 422 if no items; freezes `total_cents`; returns `checkout_url` (the "email" — Notifier no-op logs it) |
| `GET /api/orders/:id/ledger` | Audit view of a paid order | entries + memo + fee inputs (FR-006); 409 if not paid |
| `GET /api/orders` | List acting provider's orders | dashboard drill-in |

## Patient — checkout (capability token)

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/checkout/:token` | Patient view of order | items, prices, total; if already paid → receipt shape `{ paid: true, ... }` |
| `POST /api/checkout/:token/pay` | Confirm fake payment | body `{ idempotency_key }` (client-generated UUID, stable per checkout session). Transactionally: creates payment, marks paid, writes 3 ledger entries. Replays return the original result, 200. (FR-004, FR-009) |

## Provider — dashboard

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/dashboard/summary` | Aggregates for acting provider | `{ orders_paid, gross_cents, cogs_cents, margin_cents, fees_cents }` — computed by summing ledger_entries so reconciliation is structural (SC-004); plus low/negative-inventory flags |

## Contract invariants (tested in integration)

1. For any paid order: `GET /api/orders/:id/ledger` entries sum exactly to `total_cents`.
2. Double `POST /pay` with same key → one `payments` row, one ledger set, same response.
3. Double `POST /pay` with *different* keys → second gets 409 `already_paid` (UNIQUE order_id).
4. Mutations on non-draft orders → 409 `order_locked`.
5. `dashboard/summary` equals the sum over `orders/:id/ledger` for all paid orders.

## Patient portal (HDX-96)

| Route | Purpose | Notes |
|---|---|---|
| `POST /api/portal/session` | Demo portal sign-in | body `{ patient_id }` → `{ token, patient, provider }`; identity-seam stand-in for the portal login |
| `GET /api/portal/:token` | Patient's portal view | messages, invoices (with items incl. `sig`, and the card used), `balance_due_cents`, `payment_method` |
