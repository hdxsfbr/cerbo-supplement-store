# Data Model: In-House Supplement Store

All monetary columns are `BIGINT` integer cents (suffix `_cents`). All tables get `id BIGINT
GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, `created_at timestamptz NOT NULL DEFAULT now()`.
Spec entity → table mapping is 1:1.

## providers

| Column | Type | Notes |
|--------|------|-------|
| name | text NOT NULL | e.g., "Dr. Marcus Welby" |
| npi | text | flavor only, not validated |

## patients

| Column | Type | Notes |
|--------|------|-------|
| provider_id | FK → providers | practice affiliation (single practice per patient in this slice) |
| name | text NOT NULL | Greek-god seed flavor ("Zeus King") |
| email | text | display only; Notifier is a no-op |

## supplements

| Column | Type | Notes |
|--------|------|-------|
| name | text NOT NULL | |
| sku | text UNIQUE | |
| unit_cogs_cents | bigint NOT NULL CHECK (>= 0) | current cost basis; snapshotted into order_items |
| default_price_cents | bigint NOT NULL CHECK (>= 0) | pre-fills order lines (DECISIONS.md #6) |
| inventory_count | integer NOT NULL DEFAULT 0 | informational; may go negative (flagged in UI) |

## orders

| Column | Type | Notes |
|--------|------|-------|
| provider_id | FK → providers | |
| patient_id | FK → patients | must belong to provider (enforced in insert SQL) |
| status | text NOT NULL CHECK IN ('draft','awaiting_payment','paid') | lifecycle, FR-010 |
| checkout_token | text UNIQUE NOT NULL | capability token for the patient link (identity seam) |
| total_cents | bigint | denormalized sum of items; set when sent; frozen thereafter |
| sent_at / paid_at | timestamptz | transition timestamps |

**Transitions** (optimistic SQL guards + trigger freezing financial fields after `draft`):
`draft → awaiting_payment` (requires ≥1 item; computes & freezes total) → `paid` (payment
confirm only). No other transitions in this slice.

## order_items

| Column | Type | Notes |
|--------|------|-------|
| order_id | FK → orders ON DELETE CASCADE | |
| supplement_id | FK → supplements | |
| quantity | integer NOT NULL CHECK (> 0) | |
| unit_cogs_cents | bigint NOT NULL | **snapshot** at assembly (FR-002) |
| unit_price_cents | bigint NOT NULL CHECK (>= 0) | provider-set; below COGS allowed (warn in UI) |

## payments

| Column | Type | Notes |
|--------|------|-------|
| order_id | FK → orders, **UNIQUE** | one payment per order — DB-level idempotency backstop (FR-009) |
| idempotency_key | text UNIQUE NOT NULL | from the payment seam |
| amount_cents | bigint NOT NULL | must equal orders.total_cents (checked in confirm transaction) |
| status | text NOT NULL CHECK IN ('succeeded') | only success exists in the fake gateway; schema leaves room |

## ledger_entries  (append-only — the system of record for the split)

| Column | Type | Notes |
|--------|------|-------|
| order_id | FK → orders | |
| payment_id | FK → payments | |
| entry_type | text NOT NULL CHECK IN ('cogs','provider_margin','platform_fee') | |
| amount_cents | bigint NOT NULL | may be negative only for provider_margin (below-COGS pricing) |
| memo | text | human-readable computation note, e.g. "75 bps of 13400 = 100.5 → 101 (half-up)" |

**Integrity (migration-level, constitution I / FR-005):**

1. `REVOKE UPDATE, DELETE ON ledger_entries` from the app role **and** a trigger raising an
   exception on UPDATE/DELETE (belt and suspenders).
2. Deferred constraint trigger on `ledger_entries` (and on `orders` transition to `paid`):
   at commit, for any affected paid order, assert exactly one entry per entry_type and
   `SUM(amount_cents) = orders.total_cents`. Abort the transaction otherwise.
3. `UNIQUE (order_id, entry_type)` — one split component each per order in this slice
   (compensating entries would relax this in a future amendment).

## Split computation (pure function, `server/src/money/split.ts`)

```
totalCents  = Σ item.quantity × item.unit_price_cents
cogsCents   = Σ item.quantity × item.unit_cogs_cents
feeCents    = floor((totalCents × 75 + 5000) / 10000)   // 75 bps, half-up
marginCents = totalCents − cogsCents − feeCents           // residual ⇒ sum is exact by construction
```

Properties (unit-tested): `cogs + margin + fee ≡ total` for all inputs; fee(0)=0; fee is
monotonic; margin may be negative; one-cent and half-cent boundary cases pinned.

## Seed data (migration `00X_seed.sql`)

- 2 providers: Dr. Marcus Welby, Dr. Sarah Anderson
- 6 patients: Zeus King, Hera Elaine Queen, Demeter W Harvest, Apollo Ray Sun, Athena Wise,
  Poseidon C. Waters (split across the providers)
- 8 supplements with realistic functional-medicine names, unit COGS $4–$38, default prices with
  ~30–60% margin, inventory 20–200
