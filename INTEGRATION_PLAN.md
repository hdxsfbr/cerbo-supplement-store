# Integration plan: putting the supplement store inside Cerbo

How this slice becomes part of Cerbo's product once we have their codebase and infrastructure.
Written before that access, so every statement is one of two kinds: **verifiable from this repo**
(file and symbol named) or **an assumption**, marked `[A]`, with the question that settles it in
§5. Nothing here is a redesign; the money core (`server/src/money/split.ts`,
`002_integrity.sql`) is the part that does not move.

What we know about Cerbo without the code: it is tenant-per-practice, addressed as
`https://{tenant}.md-hq.com/api/v1/` with per-practice API credentials; the public REST API
exposes patients, providers, secure messages, patient emails and patient invoices; the stack is
Vue, TypeScript and PostgreSQL (DECISIONS #3). Whether tenants are separate deployments or one
routed application is not public (SCALING.md → Tenancy treats both).

## 1. Seams: what plugs in where

The routes never see a header, a token store, a processor or an email. They call three interfaces
(`server/src/seams/`). Integration replaces the fakes behind those interfaces; route code is
unchanged.

### 1.1 Identity — `IdentityProvider` (`seams/identity.ts`)

| Method | Today (fake) | In Cerbo | New code around it |
|---|---|---|---|
| `resolveProvider(headerValue)` | `x-acting-provider: <id>`, set by the demo sign-in | Read the EHR session of the logged-in user; return their provider record `[A: Cerbo's user has a provider/clinician identity usable as our provider_id]` | Session middleware in Fastify (cookie or bearer, whatever Cerbo's Vue app already carries); the demo sign-in page and `stores/login.ts` are deleted |
| `resolveCheckout(token)` | random capability token on `orders.checkout_token` | Keep as is for links in messages/emails, **or** resolve from the portal session when the patient is signed in `[A: Cerbo's portal has a server-side session we can read]` | Prefer session when present, token otherwise; add expiry to tokens (SCALING.md lists this) |
| `resolvePortal(token)` | `patients.portal_token` | Portal session → patient | Same middleware as above, portal side |
| `portalSignIn(patientId)` | hands out a token for any id | **Deleted.** Cerbo's portal login replaces it | — |

Guard rails that stay: every provider query is scoped by `provider_id` (404 on cross-provider),
patient views never carry COGS, margin or fee (DECISIONS #7).

### 1.2 Notifications — `Notifier` (`seams/notifier.ts`)

| Method | Today | In Cerbo |
|---|---|---|
| `orderReadyForPayment(n)` | writes a `portal_message` and an `email` row to `notifications` | Create a Secure Message (Cerbo API: secure messages) and a Patient Email (Cerbo API: patient emails) with the same copy (`composeNotifications`, pinned by tests) |
| `requestDeclined(n)` | writes a portal message | Secure Message |

The route calls the notifier **after** the send transaction commits and treats failure as
non-fatal (HDX-89). For production this becomes an outbox: write the intent inside the send
transaction, deliver from a worker with retries. `notifications` becomes that outbox table
(add `delivered_at`, `attempts`, `last_error`), so the data model already exists.

### 1.3 Payments — `PaymentGateway` (`seams/payment.ts`)

`charge({ orderId, amountCents, idempotencyKey, description, paymentMethod })` →
`{ status, gatewayRef, cardBrand, cardLast4 }`, declines as `PaymentDeclinedError`, outages as
any other throw. The route already maps those to 402 / 502 with nothing written.

The real adapter is whatever Cerbo uses to take card payments today
`[A: a processor with idempotent charge creation, e.g. Stripe PaymentIntents]`. Two things change
around the seam, not in it:

- **Tokenisation.** `web/src/card.ts` is a fake tokenizer; it becomes the processor's hosted
  fields / Elements so the PAN never touches our code (PCI SAQ-A). The wire shape to our server
  stays `{ token, brand, last4 }`.
- **Reconciliation.** Webhooks for the cases the synchronous call cannot see (charge succeeded
  after our timeout, later dispute). The `payments` row plus `gateway_ref` is the join key.
  The unique `payments.order_id` and the idempotency key keep "one payment per order" true even
  when a webhook and a retry race.

Open money question: **who is the merchant of record** (§5, Q4). If the practice is, the split
stays a ledger fact and Cerbo invoices the practice for fees from `ledger_entries`
(`platform_fee` rows). If Cerbo is, the processor's split-payment feature moves the fee at charge
time and the ledger must record what the processor did, not what we computed, which is a change
to `checkout.ts` and to the deferred trigger's fee check.

### 1.4 Two seams we named but did not build

- **Supplier / fulfilment** (DECISIONS #19): after `paid`, place the order with the drop-ship
  supplier and record shipped / delivered as append-only `fulfilment_events`. Interface:
  `placeOrder(order) → supplierRef`, webhook → events. Shown in the portal under Invoices.
- **Tax**: `quote(lines, shipTo) → taxCents`, a pass-through ledger entry (`tax`) excluded from the
  fee base, remitted by the practice. Needs a ship-to address at checkout, which the portal does
  not collect today. Behind Avalara / TaxJar / Stripe Tax.

## 2. Data: what we own, what becomes a read from Cerbo

Tables in this repo (`server/src/db/migrations/`):

| Table | In Cerbo | Why |
|---|---|---|
| `providers`, `patients` | **Read from Cerbo**, not stored. Our rows become foreign keys to Cerbo's ids `[A: stable integer or uuid ids]` | They are Cerbo's master records; `patients.email` and `portal_token` go with the identity seam |
| `supplements` | Ours, per practice | The practice catalog with COGS and default price; later synced from the supplier's feed |
| `orders`, `order_items`, `payments`, `ledger_entries` | **Ours, unchanged** | The money core. Append-only ledger, deferred sum invariant, COGS snapshot per line |
| `notifications` | Ours, as the outbox (§1.2) | Delivery state lives here; the message itself lives in Cerbo |
| `patient_supplements`, `order_requests`, `order_request_items` | Ours | The clinical list and the request workflow (DECISIONS #17) `[A: Cerbo has no equivalent "supplements the patient takes" record; if it does, our list links to it rather than duplicating it]` |

Every row gains `practice_id` (SCALING.md → Tenancy). If Cerbo is one database per practice,
that column is redundant but harmless; if it is shared, it is the row-level-security key. We do
not know which (§5, Q2), so the migration adds the column either way.

**Invoices.** Cerbo's portal already shows patient invoices. Our sent order *is* an invoice. The
clean integration creates a Cerbo invoice when we send (`POST /orders/:id/send`) and marks it
paid when we pay, so the patient's portal balance and statement are Cerbo's, not ours
`[A: the invoices API is writable]`. Our `PatientPortal.vue` bills section then disappears; our
order remains the source of the split.

## 3. Surfaces: what we built as pages, what becomes a component

| We built | Becomes |
|---|---|
| `CerboNav.vue`, the chart replica in `PatientChart.vue`, `PortalShell.vue` and the portal replica | **Deleted.** They exist to show where the store sits; Cerbo's real chart and portal provide the chrome |
| The Supplements tab (list, requests, picker, directions modal) in `PatientChart.vue` | A Vue component mounted in Cerbo's chart next to Medications, props: `patientId`. The chart's "+ Add Rx" modal pattern is the model we followed |
| `OrderBuilder.vue`, `Orders.vue`, `OrderAudit.vue`, `Dashboard.vue` | Store pages under Cerbo's navigation (our "Supplements" menu is the placeholder for wherever Cerbo puts them) |
| Portal: My Supplements, Secure Messages with Pay Now, Checkout | My Supplements becomes a portal component; messages and invoices are Cerbo's own with our deep links; checkout stays ours, embedded under Invoices |
| `stores/session.ts`, `stores/login.ts`, `Login.vue` | Deleted (identity seam, §1.1) |
| `styles/chart.css`, `styles/portal-xp.css` | Deleted; `cerbo.css` tokens are replaced by Cerbo's design system |

The API client (`web/src/api.ts`) and the order-draft store (`stores/orderDraft.ts`, with its
serialised-save consistency model) carry over unchanged.

## 4. Deployment

Today: one container (Fastify serves `/api/*` and the built SPA), one managed Postgres,
migrations run on boot, GitLab CI deploys `main` to Railway.

Inside Cerbo `[A: everything in this section]`: the API becomes either a service beside Cerbo's
API gateway or a module inside it; migrations move to Cerbo's migration tool and ordering;
`NODE_ENV`, `DATABASE_URL` and `PUBLIC_WEB_ORIGIN` come from their secrets; the SPA build is
consumed as components by Cerbo's Vue build rather than served as a separate app. The
`Dockerfile`, `docker-compose.yml` and `.gitlab-ci.yml` are development conveniences that go
away or get rewritten to their conventions. What must survive the move: migrations run before
traffic, the deferred-trigger invariants are never disabled, and the app's DB role holds only
INSERT/SELECT/UPDATE on the tables it needs (SCALING.md lists the least-privilege role).

## 5. Questions that gate the work

Each with the assumption the plan currently rests on.

1. **Session shape.** How does a request from Cerbo's Vue app identify the user and practice
   (cookie session, JWT, header)? *Assumed: a server-readable session we can wrap in middleware.*
2. **Tenant model.** One database per practice or one shared database? *Assumed: either; we add
   `practice_id` regardless.*
3. **Provider identity.** Is the chart's logged-in user always a provider with a stable id, or
   can staff act on a provider's behalf? *Assumed: a provider id is always resolvable; staff
   acting-on-behalf would make the acting provider a parameter of the order, not the session.*
4. **Merchant of record.** Does the practice take the patient's payment on its own processor
   account (Cerbo bills the fee afterwards), or does Cerbo take it and split? *Assumed: the
   practice; the fee is a ledger fact settled from `platform_fee` entries.*
5. **Invoices and messages.** Are the invoice and secure-message APIs writable from inside the
   product, and should our sent order become a Cerbo invoice? *Assumed: yes to both.*
6. **Processor.** Which payment processor, and does it support idempotent charges, hosted card
   fields and webhooks? *Assumed: yes to all three.*
7. **Supplier.** Which drop-ship supplier, and does it offer an ordering API with shipment
   webhooks and a catalog feed? *Assumed: at least an ordering API.*
8. **Tax.** Does Cerbo already compute sales tax anywhere? *Assumed: no; a tax service behind a seam.*
9. **Existing supplement data.** Does Cerbo have a "supplements the patient takes" record today?
   *Assumed: no; our list is the record.*

## 6. Phases

Each phase ships behind a per-practice feature flag and has an exit criterion.

| Phase | Work | Exit criterion |
|---|---|---|
| 0. Answers | §5 answered; tenancy and merchant-of-record decided | A signed-off version of this document |
| 1. Identity | Session middleware; demo sign-in removed; `providers`/`patients` read from Cerbo; `practice_id` migration | All 66 integration tests pass against a Cerbo session fake; cross-practice access is a 404 |
| 2. Surfaces | Supplements tab and My Supplements as Cerbo components; store pages under Cerbo nav; replica chrome deleted | A provider completes list → order → send inside the real chart in staging |
| 3. Money | Real processor adapter, hosted fields, webhook reconciliation; Cerbo invoice created on send | `assert_order_split()` holds on every staged payment; replay and decline paths exercised against the processor's test mode |
| 4. Messaging | Outbox worker delivering Secure Messages and Patient Emails | No notification lost across a worker restart (test) |
| 5. Fulfilment and tax | Supplier seam with shipped/delivered events in the portal; tax seam and pass-through entry | First real drop-shipped order visible end to end |

What we would not do: rewrite the split, the ledger or the deferred trigger; move money logic
into the client; relax "one payment per order"; or let the patient see cost or margin.
