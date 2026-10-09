# Scaling analysis: 10 → 100 000 users

"Users" here means **providers using the store**, because they drive the writes. Patients are
roughly 50–200 per provider but each patient touches the system a few times a year; order volume
scales with providers. Assumptions per tier (Cerbo is functional-medicine, protocol-driven, so
supplement orders are frequent):

| Tier | Providers | Patients (≈100/provider) | Orders/day (≈3/provider) | Peak API req/s | Ledger rows/year |
|---|---|---|---|---|---|
| T1 | 10 | 1 000 | 30 | < 1 | ~33 k |
| T2 | 100 | 10 000 | 300 | ~1 | ~330 k |
| T3 | 1 000 | 100 000 | 3 000 | ~10 | ~3.3 M |
| T4 | 10 000 | 1 000 000 | 30 000 | ~100 | ~33 M |
| T5 | 100 000 | 10 000 000 | 300 000 | ~1 000 | ~330 M |

For context, 100 000 providers is well beyond the US functional-medicine market; T5 is included
to show where the design's assumptions finally break, not as a plan.

## Where the current design stands (T0: one Railway container, one Postgres)

- Fastify, single process, `postgres` pool `max: 10`, serves the SPA too.
- Every money write is one short transaction; the pay path holds a row lock for ~5 ms (fake
  gateway) — contention is per order, so independent orders never block each other.
- Dashboard sums `ledger_entries` for one provider on every load (index on `orders.provider_id`,
  then join) — cheap while a provider has thousands of rows, not millions.
- Migrations run on boot under an advisory lock, so N replicas booting together are safe.
- Checkout links derive from the request host; no sticky state in the process; the app is already
  stateless and horizontally scalable except for `max: 10` connections per replica.

## Tier by tier

### T1 — 10 providers, ~30 orders/day
**Nothing breaks.** The current deployment is over-provisioned for this. What matters is
correctness and operations, not capacity:

- Add **backups/PITR** on Postgres (Railway offers it) and test a restore. The ledger is the only
  copy of the money story.
- Replace the superuser role with an **app role** that has no `DISABLE TRIGGER`/DDL rights so the
  ledger's `REVOKE` is real, not decorative.
- Real identity (EHR session) and a real gateway behind the existing seams. Move the gateway call
  outside the DB transaction (pending payment row → charge → mark succeeded; webhook reconcile).
- Capability tokens get an **expiry** and a one-time "portal login" exchange.

### T2 — 100 providers, ~300 orders/day, ~1 req/s
Still one box, but the first design debts surface:

- **Notifications become real** (email/portal API calls, 100s/day). Best-effort-after-commit is
  no longer acceptable: write an **outbox row inside the send transaction**, deliver from a worker
  with retries. Same table, one more column (`delivered_at`, `attempts`).
- **Observability**: request latency histograms, 5xx and `CB002` alerts, gateway error rate.
  Without this you cannot tell a slow Postgres from a slow processor.
- **Rate limiting** on the two unauthenticated routes (`/checkout/:token/*`, `/portal/:token`) —
  tokens are unguessable, but enumeration attempts should be cheap to drop.
- Inventory: 300 orders/day against a shared stock table is fine; the `UPDATE … inventory_count -=`
  inside the pay transaction serialises on hot SKUs only momentarily.

### T3 — 1 000 providers, ~3 000 orders/day, ~10 req/s, ~3 M ledger rows/year
This is where the **single-process, sum-on-read** shape stops being free:

- **Dashboard aggregates**: summing a provider's ledger is still indexed and small per provider,
  but a *platform-wide* dashboard (Cerbo's own GMV view) would scan millions of rows. Add a
  **daily rollup table** (`provider_id, day, gross, cogs, margin, fees, orders`) maintained by the
  pay transaction (same tx, one `UPSERT`) or by a nightly job. Reconciliation stays structural:
  rollup rows are *derived*; the audit still reads the ledger.
- **Connection pooling**: 2–3 API replicas × `max 10` = 30 direct connections, fine; beyond that
  put **PgBouncer** (transaction pooling) in front. Note the `FOR UPDATE` + deferred-trigger pay
  path must stay on one connection for the whole transaction — transaction pooling is compatible,
  session pooling features (advisory locks across statements) are not used except in migrations,
  which run once at boot.
- **Static assets to a CDN** (the SPA bundle is 70 kB; it's the TLS handshakes, not bytes).
- **Horizontal replicas** behind Railway's/ALB load balancing; the app is already stateless.
- **Table growth**: `notifications` and `order_items` grow fastest. Partition by month or archive
  paid orders older than N years to a cold table. Indexes: `(provider_id, created_at)` on orders
  already exists; add `(patient_id, created_at)` on orders for the portal.

### T4 — 10 000 providers, ~30 000 orders/day, ~100 req/s, ~33 M ledger rows/year
The database becomes the thing to design around:

- **Read replicas** for dashboard, audit and portal reads; writes (assemble, send, pay) stay on
  the primary. Only the pay path needs strict consistency; the dashboard tolerates seconds of lag
  if the UI says so.
- **Hot-row contention on inventory**: 30 k decrements/day on ~8–50 SKUs is still < 1/s per SKU,
  fine. At 10× that, move stock to a per-SKU ledger (append "−qty" rows, sum on read, roll up) —
  the same append-only pattern as money.
- **Idempotency keys** are client-generated UUIDs stored on `payments`; the unique index is the
  guard. At this size add a **TTL/cleanup** for abandoned checkout sessions and consider a
  dedicated `payment_attempts` table (also wanted for metrics).
- **Deferred constraint trigger cost**: `assert_order_split()` runs 3–5 small indexed queries per
  paid order at commit; ~0.5 ms. It is not the bottleneck even at T5. Keep it.
- **Tenancy decision point** (see below): per-practice instances stop being operationally sane
  around here (10 000 deployments); a shared multi-tenant deployment with `practice_id` + RLS is
  the natural shape, with per-tenant rate limits and noisy-neighbour protection.
- **Queue for side effects**: notifications, receipts, inventory alerts, analytics rollups all
  leave the request path via the outbox → worker pattern introduced at T2.

### T5 — 100 000 providers, ~300 000 orders/day, ~1 000 req/s, ~330 M ledger rows/year
Hypothetical for this market, but the shape that survives is:

- **Shard by practice** (`practice_id` hash → database). Every money invariant is *within one
  order*, which is within one practice, so sharding never splits a transaction. Cross-shard
  analytics come from the rollups, not from live sums.
- **Partitioned ledger** (`ledger_entries` by month) with the append-only guarantees kept per
  partition; archival to cheap storage after the retention period.
- **Event stream** (ledger entries as events) feeding the analytics warehouse; the Postgres ledger
  remains the system of record, the warehouse answers "GMV by state by month".
- **Multi-region** only if Cerbo needs it for latency or residency; the pay path's single-row
  lock means active-active is unnecessary — one primary per shard is enough.
- **Payment processor limits** become the real ceiling (rate limits, settlement batches, dispute
  handling) long before Postgres does.

## What never changes

- Integer cents, append-only ledger, DB-asserted split at commit. These cost microseconds and are
  what make every other change safe: rollups, replicas and shards are all *derived* from rows the
  database refuses to let be wrong.
- One payment per order, idempotency by unique key, row lock per order. Contention is
  per-order, so it scales with orders, not with providers.

## Tenancy: shared vs per-practice

Cerbo addresses practices as `https://{tenant}.md-hq.com/api/v1/` with per-practice credentials.
Whether that is one application routed by subdomain or an instance per practice is not public
(their security page is not reachable), so both are considered:

| | Per-practice instances | Shared multi-tenant |
|---|---|---|
| Fits this code | Yes, as-is: one image + one `DATABASE_URL` per practice (what Railway runs today) | Needs `practice_id` on providers/supplements/orders/notifications, composite indexes, and Postgres **row-level security** keyed on the session's practice |
| Isolation | Strongest: blast radius and data residency per practice | Logical only; RLS + tests must prove it |
| Cost at T1–T2 | Fine (tens of small instances) | Fine |
| Cost at T3–T4 | Thousands of databases: migrations, backups, upgrades and monitoring become the product | One schema, one migration path, noisy-neighbour controls needed |
| Catalog/inventory | Naturally per practice ("Cerbo holds the inventory" per practice warehouse?) | Needs a decision: shared catalog with per-practice pricing (DECISIONS #6 already puts price on the order line) |
| Recommendation | Keep for pilots and for practices that require it | Default once past ~100 practices; the schema change is additive and the invariants are unchanged |

A practical hybrid: a shared control plane (catalog, fee policy, platform reporting) and
per-practice *data* either in one RLS-protected database or in a database per large practice,
with `practice_id` present everywhere so moving between the two is a data copy, not a rewrite.

## Summary table

| Tier | What breaks first | Change |
|---|---|---|
| T1 | nothing; risk is ops | backups/PITR, least-privilege DB role, real seams, token expiry |
| T2 | best-effort notifications, blind spots | outbox + worker, metrics/alerts, rate limits |
| T3 | sum-on-read dashboards, connection count | daily rollups, PgBouncer, replicas, CDN, partition/archive |
| T4 | read load on primary, tenancy ops | read replicas, payment_attempts, shared multi-tenant with RLS, queues |
| T5 | single database | shard by practice, partitioned ledger, event stream to warehouse |
