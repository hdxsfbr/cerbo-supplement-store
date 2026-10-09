-- 007: optional patient sig (directions) per order line. Free text, provider-authored, shown to
-- the patient at checkout/portal alongside the item name. Nullable so existing callers are
-- unaffected; the chart-embedded order flow fills it from the Patient Sig fieldset.
ALTER TABLE order_items ADD COLUMN sig text CHECK (sig IS NULL OR char_length(sig) <= 500);
