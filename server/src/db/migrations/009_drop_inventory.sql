-- 009: the practice sells through a drop-shipping supplier (DECISIONS #19). The supplier's
-- landed unit price (fulfilment and shipping included) is the COGS; there is no stock to keep,
-- so the informational inventory count and its decrement-at-payment go away.
ALTER TABLE supplements DROP COLUMN inventory_count;
