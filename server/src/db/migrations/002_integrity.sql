-- 002_integrity.sql — the money invariants, enforced by the system of record (constitution I,
-- FR-005, FR-009, FR-010). Application code may *also* check these; the database is the authority.
--
-- Custom SQLSTATEs (class "CB") so the API can map DB rejections to HTTP codes:
--   CB001  ledger_entries is append-only (UPDATE/DELETE/TRUNCATE attempted)
--   CB002  split invariant violated (sum/components/payment/fee/cogs mismatch at commit)
--   CB003  order is locked (financial fields frozen after draft; immutable once paid)
--   CB004  order has no items (cannot be sent)
--
-- Contents
--   §1 ledger_entries append-only
--   §2 deferred constraint trigger: per paid order, exactly one entry per type, SUM = total_cents,
--      one payment of the same amount, COGS = Σ snapshot, fee = 75 bps half-up
--   §3 orders lifecycle: draft → awaiting_payment → paid; financial fields frozen after draft
--   §4 order_items: COGS snapshot forced from catalog on insert; rows locked unless order is draft

---------------------------------------------------------------------------------------------------
-- §1 Append-only ledger
---------------------------------------------------------------------------------------------------
CREATE FUNCTION ledger_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not permitted; record a compensating entry instead', TG_OP
    USING ERRCODE = 'CB001';
END $$;

CREATE TRIGGER ledger_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();

CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_append_only();

-- Belt and suspenders: strip the privileges too, including from the owning role. (An owner can
-- re-GRANT or DISABLE TRIGGER — that is a migration-level act, visible in this file's history,
-- not something application code can do by accident.)
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM PUBLIC, CURRENT_USER;

---------------------------------------------------------------------------------------------------
-- §2 Split invariant — evaluated once per affected order at COMMIT (deferred constraint trigger)
---------------------------------------------------------------------------------------------------
-- For a paid order, at commit, all of the following must hold:
--   (a) status = 'paid' and total_cents is set
--   (b) exactly three ledger entries: one cogs, one provider_margin, one platform_fee
--   (c) cogs + provider_margin + platform_fee = total_cents                    ← the headline rule
--   (d) exactly one payment, amount_cents = total_cents, and every entry points at it
--   (e) cogs = Σ order_items.quantity × unit_cogs_cents (the snapshot, not the live catalog)
--   (f) platform_fee = floor((total_cents × 75 + 5000) / 10000)  — 75 bps, half-up (DECISIONS #4)
-- Conversely, ledger entries or payments on an order that is not paid by commit are rejected.
CREATE FUNCTION assert_order_split(p_order_id bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  o              orders%ROWTYPE;
  v_count        integer;
  v_sum          bigint;
  v_cogs         bigint;
  v_margin       bigint;
  v_fee          bigint;
  v_payment_id   bigint;
  v_payments     integer;
  v_pay_amount   bigint;
  v_expect_cogs  bigint;
  v_expect_fee   bigint;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'split invariant: order % does not exist', p_order_id USING ERRCODE = 'CB002';
  END IF;

  -- (a)
  IF o.status <> 'paid' OR o.total_cents IS NULL THEN
    RAISE EXCEPTION 'split invariant: order % has payment/ledger rows but status is % (must be paid)',
      p_order_id, o.status USING ERRCODE = 'CB002';
  END IF;

  -- (b)
  SELECT count(*),
         coalesce(sum(amount_cents), 0),
         sum(amount_cents) FILTER (WHERE entry_type = 'cogs'),
         sum(amount_cents) FILTER (WHERE entry_type = 'provider_margin'),
         sum(amount_cents) FILTER (WHERE entry_type = 'platform_fee')
    INTO v_count, v_sum, v_cogs, v_margin, v_fee
    FROM ledger_entries WHERE order_id = p_order_id;
  IF v_count <> 3 OR v_cogs IS NULL OR v_margin IS NULL OR v_fee IS NULL THEN
    RAISE EXCEPTION 'split invariant: order % must have exactly one cogs, one provider_margin and one platform_fee entry (found % entries)',
      p_order_id, v_count USING ERRCODE = 'CB002';
  END IF;

  -- (c)
  IF v_sum <> o.total_cents THEN
    RAISE EXCEPTION 'split invariant: order % ledger sums to % cents but total_cents is % (cogs % + margin % + fee %)',
      p_order_id, v_sum, o.total_cents, v_cogs, v_margin, v_fee USING ERRCODE = 'CB002';
  END IF;

  -- (d)
  SELECT count(*), min(id), min(amount_cents) INTO v_payments, v_payment_id, v_pay_amount
    FROM payments WHERE order_id = p_order_id;
  IF v_payments <> 1 THEN
    RAISE EXCEPTION 'split invariant: order % must have exactly one payment (found %)',
      p_order_id, v_payments USING ERRCODE = 'CB002';
  END IF;
  IF v_pay_amount <> o.total_cents THEN
    RAISE EXCEPTION 'split invariant: order % payment amount % <> total_cents %',
      p_order_id, v_pay_amount, o.total_cents USING ERRCODE = 'CB002';
  END IF;
  IF EXISTS (SELECT 1 FROM ledger_entries WHERE order_id = p_order_id AND payment_id <> v_payment_id) THEN
    RAISE EXCEPTION 'split invariant: order % has ledger entries referencing a different payment',
      p_order_id USING ERRCODE = 'CB002';
  END IF;

  -- (e)
  SELECT coalesce(sum(quantity * unit_cogs_cents), 0) INTO v_expect_cogs
    FROM order_items WHERE order_id = p_order_id;
  IF v_cogs <> v_expect_cogs THEN
    RAISE EXCEPTION 'split invariant: order % cogs entry % <> snapshot COGS of items %',
      p_order_id, v_cogs, v_expect_cogs USING ERRCODE = 'CB002';
  END IF;

  -- (f)  bigint division truncates toward zero; total_cents >= 0 so this is floor()
  v_expect_fee := (o.total_cents * 75 + 5000) / 10000;
  IF v_fee <> v_expect_fee THEN
    RAISE EXCEPTION 'split invariant: order % platform_fee % <> 75 bps half-up of % (= %)',
      p_order_id, v_fee, o.total_cents, v_expect_fee USING ERRCODE = 'CB002';
  END IF;
END $$;

-- Row-level wrappers. All three tables converge on the same assertion; deferred to commit so the
-- transaction can insert payment, flip status and write three entries in any order.
CREATE FUNCTION ledger_entries_assert_split() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_order_split(NEW.order_id);
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ledger_entries_split_invariant
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_assert_split();

CREATE FUNCTION payments_assert_split() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_order_split(NEW.order_id);
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER payments_split_invariant
  AFTER INSERT OR UPDATE ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payments_assert_split();

CREATE FUNCTION orders_assert_split() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_order_split(NEW.id);
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER orders_paid_split_invariant
  AFTER INSERT OR UPDATE OF status ON orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'paid')
  EXECUTE FUNCTION orders_assert_split();

---------------------------------------------------------------------------------------------------
-- §3 Order lifecycle: draft → awaiting_payment → paid (FR-010)
---------------------------------------------------------------------------------------------------
CREATE FUNCTION orders_guard_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_items integer;
  v_total bigint;
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'order % is paid and immutable', OLD.id USING ERRCODE = 'CB003';
  END IF;

  IF NEW.id <> OLD.id OR NEW.provider_id <> OLD.provider_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.checkout_token <> OLD.checkout_token OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'order % identity fields are immutable', OLD.id USING ERRCODE = 'CB003';
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status = 'draft' THEN
      IF NEW.total_cents IS NOT NULL OR NEW.sent_at IS NOT NULL OR NEW.paid_at IS NOT NULL THEN
        RAISE EXCEPTION 'order %: total/sent_at/paid_at are set by the send/pay transitions only', OLD.id
          USING ERRCODE = 'CB003';
      END IF;
      RETURN NEW;
    ELSIF NEW.status = 'awaiting_payment' THEN
      SELECT count(*), coalesce(sum(quantity * unit_price_cents), 0)
        INTO v_items, v_total FROM order_items WHERE order_id = OLD.id;
      IF v_items = 0 THEN
        RAISE EXCEPTION 'order % has no items and cannot be sent', OLD.id USING ERRCODE = 'CB004';
      END IF;
      -- The frozen total is derived from the lines; the app may pass it, but it must agree.
      IF NEW.total_cents IS NULL THEN
        NEW.total_cents := v_total;
      ELSIF NEW.total_cents <> v_total THEN
        RAISE EXCEPTION 'order %: total_cents % does not equal sum of items %', OLD.id, NEW.total_cents, v_total
          USING ERRCODE = 'CB003';
      END IF;
      IF NEW.sent_at IS NULL THEN NEW.sent_at := now(); END IF;
      IF NEW.paid_at IS NOT NULL THEN
        RAISE EXCEPTION 'order %: paid_at cannot be set on send', OLD.id USING ERRCODE = 'CB003';
      END IF;
      RETURN NEW;
    END IF;
  ELSIF OLD.status = 'awaiting_payment' THEN
    IF NEW.total_cents <> OLD.total_cents OR NEW.sent_at <> OLD.sent_at THEN
      RAISE EXCEPTION 'order % is awaiting payment; financial fields are frozen', OLD.id
        USING ERRCODE = 'CB003';
    END IF;
    IF NEW.status = 'awaiting_payment' THEN
      RETURN NEW;
    ELSIF NEW.status = 'paid' THEN
      IF NEW.paid_at IS NULL THEN NEW.paid_at := now(); END IF;
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'order %: illegal transition % -> %', OLD.id, OLD.status, NEW.status
    USING ERRCODE = 'CB003';
END $$;

CREATE TRIGGER orders_guard_transition
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_guard_transition();

-- Orders may only be inserted as drafts; they get to 'paid' through the transitions above.
CREATE FUNCTION orders_guard_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'orders must be created as draft (got %)', NEW.status USING ERRCODE = 'CB003';
  END IF;
  IF NEW.total_cents IS NOT NULL OR NEW.sent_at IS NOT NULL OR NEW.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'draft orders cannot carry total/sent_at/paid_at' USING ERRCODE = 'CB003';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM patients WHERE id = NEW.patient_id AND provider_id = NEW.provider_id) THEN
    RAISE EXCEPTION 'patient % does not belong to provider %', NEW.patient_id, NEW.provider_id
      USING ERRCODE = 'CB003';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orders_guard_insert
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_guard_insert();

CREATE FUNCTION orders_guard_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'order % is % and cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'CB003';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER orders_guard_delete
  BEFORE DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_guard_delete();

---------------------------------------------------------------------------------------------------
-- §4 Order items: locked unless the order is a draft; COGS snapshot forced from the catalog
---------------------------------------------------------------------------------------------------
CREATE FUNCTION order_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_order_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  v_status   text;
BEGIN
  SELECT status INTO v_status FROM orders WHERE id = v_order_id FOR UPDATE;
  -- Parent already gone (cascade from a draft delete) → nothing to protect.
  IF FOUND AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'order % is % and its items are locked', v_order_id, v_status USING ERRCODE = 'CB003';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.order_id <> OLD.order_id THEN
    RAISE EXCEPTION 'order items cannot move between orders' USING ERRCODE = 'CB003';
  END IF;

  -- FR-002: snapshot the cost basis at assembly time. Always taken from the catalog here, so a
  -- caller cannot write a stale or fabricated COGS, and later catalog changes never touch it.
  SELECT unit_cogs_cents INTO NEW.unit_cogs_cents FROM supplements WHERE id = NEW.supplement_id;
  IF NEW.unit_cogs_cents IS NULL THEN
    RAISE EXCEPTION 'unknown supplement %', NEW.supplement_id USING ERRCODE = 'CB003';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER order_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION order_items_guard();
