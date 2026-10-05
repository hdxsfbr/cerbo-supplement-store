-- 004_truncate_guards.sql — close the TRUNCATE gap (review finding HDX-87).
--
-- The row-level guards in 002_integrity.sql fire on INSERT/UPDATE/DELETE but TRUNCATE bypasses
-- row triggers entirely. A plain `TRUNCATE order_items` would erase the lines of paid orders
-- while leaving the orders and ledger in place — the ledger would still be correct (its COGS
-- entry is immutable), but the audit view could no longer show what was sold.
--
-- Policy: these tables are history. TRUNCATE is refused outright; there is no legitimate
-- application-level reason to empty them. Schema resets go through a fresh database, which is
-- how both the test harness and `docker compose down -v` already work.
--
-- Boundary note (also in README → limitations): a superuser or table owner can still
-- `ALTER TABLE … DISABLE TRIGGER` or drop the table. That is an administrator deliberately
-- stepping outside the application, and is visible in the DB's own history; the triggers guard
-- against application and operator mistakes, not against a hostile DBA. A production rollout
-- would run the API under a role that owns nothing and holds only INSERT/SELECT/UPDATE on
-- the specific tables it needs.

CREATE FUNCTION history_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is order history and cannot be truncated; reset the database instead', TG_TABLE_NAME
    USING ERRCODE = 'CB003';
END $$;

CREATE TRIGGER order_items_no_truncate
  BEFORE TRUNCATE ON order_items
  FOR EACH STATEMENT EXECUTE FUNCTION history_no_truncate();

CREATE TRIGGER orders_no_truncate
  BEFORE TRUNCATE ON orders
  FOR EACH STATEMENT EXECUTE FUNCTION history_no_truncate();

CREATE TRIGGER payments_no_truncate
  BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION history_no_truncate();

REVOKE TRUNCATE ON order_items, orders, payments FROM PUBLIC, CURRENT_USER;
