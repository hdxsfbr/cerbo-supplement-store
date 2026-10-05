-- 001_schema.sql — core tables. All money is BIGINT integer cents (suffix _cents).
-- See specs/001-supplement-store/data-model.md. Integrity triggers live in 002_integrity.sql.

CREATE TABLE providers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  npi         text,                                   -- flavor only; not validated
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE patients (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id bigint NOT NULL REFERENCES providers(id),
  name        text NOT NULL,
  email       text,                                   -- display only; Notifier is a no-op
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_provider_idx ON patients (provider_id);

CREATE TABLE supplements (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                text NOT NULL,
  sku                 text UNIQUE,
  unit_cogs_cents     bigint NOT NULL CHECK (unit_cogs_cents >= 0),     -- current cost basis
  default_price_cents bigint NOT NULL CHECK (default_price_cents >= 0), -- pre-fills order lines (DECISIONS #6)
  inventory_count     integer NOT NULL DEFAULT 0,                        -- informational; may go negative
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id    bigint NOT NULL REFERENCES providers(id),
  patient_id     bigint NOT NULL REFERENCES patients(id),
  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'awaiting_payment', 'paid')),
  -- Capability token for the patient link (identity seam stand-in for the portal session).
  checkout_token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  total_cents    bigint CHECK (total_cents IS NULL OR total_cents >= 0), -- set on send; frozen after
  sent_at        timestamptz,
  paid_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR (total_cents IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
CREATE INDEX orders_provider_idx ON orders (provider_id, created_at DESC);

CREATE TABLE order_items (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplement_id   bigint NOT NULL REFERENCES supplements(id),
  quantity        integer NOT NULL CHECK (quantity > 0),
  unit_cogs_cents bigint NOT NULL CHECK (unit_cogs_cents >= 0),  -- SNAPSHOT at assembly (FR-002)
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0), -- provider-set; below COGS allowed
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, supplement_id)
);

CREATE TABLE payments (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        bigint NOT NULL UNIQUE REFERENCES orders(id),  -- one payment per order (FR-009 backstop)
  idempotency_key text NOT NULL UNIQUE,                           -- from the payment seam / client
  amount_cents    bigint NOT NULL CHECK (amount_cents >= 0),
  status          text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded')),
  gateway_ref     text,                                           -- opaque reference from the gateway stub
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only system of record for the split. Guards in 002_integrity.sql.
CREATE TABLE ledger_entries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES orders(id),
  payment_id   bigint NOT NULL REFERENCES payments(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('cogs', 'provider_margin', 'platform_fee')),
  amount_cents bigint NOT NULL,
  memo         text,                                             -- human-readable computation note
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, entry_type),                                 -- one component each per order
  -- Only the provider's margin may be negative (pricing below COGS is the provider's call).
  CHECK (entry_type = 'provider_margin' OR amount_cents >= 0)
);
CREATE INDEX ledger_entries_order_idx ON ledger_entries (order_id);
