-- 005_portal_and_cards.sql — patient-portal notifications (HDX-96) and card details on payments (HDX-97).

-- Capability token standing in for the patient's portal login (identity seam).
ALTER TABLE patients
  ADD COLUMN portal_token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '');

-- Outbound messages to patients. The notifier seam writes here; in production this is Cerbo's
-- Secure Messages (portal queue) + Patient Emails. Append-only by convention (no triggers: it is
-- not money), read by the portal page and by the order builder's "what went out" block.
CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id  bigint NOT NULL REFERENCES patients(id),
  order_id    bigint REFERENCES orders(id),
  channel     text NOT NULL CHECK (channel IN ('portal_message', 'email')),
  recipient   text,                     -- email address for 'email'; null for portal messages
  subject     text NOT NULL,
  body        text NOT NULL,
  link        text,                     -- the action link embedded in the message (checkout URL)
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notifications_patient_idx ON notifications (patient_id, created_at DESC);
CREATE INDEX notifications_order_idx ON notifications (order_id);

-- What the (fake) processor told us about the instrument. Never the PAN.
ALTER TABLE payments
  ADD COLUMN card_brand text,
  ADD COLUMN card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');
