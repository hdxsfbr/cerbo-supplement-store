-- 008: separate the patient's SUPPLEMENT LIST (clinical: what they take) from supplement
-- ORDERS (transactions). DECISIONS #17.
--
-- patient_supplements  — one row per supplement on a patient's list; provider- or patient-added.
-- order_requests       — a patient asking the provider to order some of their list items. Never
--                        an order by itself: the provider prices and sends (money rules unchanged).
-- order_items.patient_supplement_id — which list row a line came from (nullable; ad-hoc lines ok).

CREATE TABLE patient_supplements (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id      bigint NOT NULL REFERENCES patients(id),
  supplement_id   bigint NOT NULL REFERENCES supplements(id),
  sig             text CHECK (sig IS NULL OR char_length(sig) <= 500),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discontinued')),
  added_by        text NOT NULL CHECK (added_by IN ('provider', 'patient')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  discontinued_at timestamptz
);
CREATE UNIQUE INDEX patient_supplements_active_uniq
  ON patient_supplements (patient_id, supplement_id) WHERE status = 'active';
CREATE INDEX patient_supplements_patient_idx ON patient_supplements (patient_id, created_at DESC);

ALTER TABLE order_items ADD COLUMN patient_supplement_id bigint REFERENCES patient_supplements(id);
CREATE INDEX order_items_patient_supplement_idx ON order_items (patient_supplement_id);

CREATE TABLE order_requests (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id   bigint NOT NULL REFERENCES patients(id),
  provider_id  bigint NOT NULL REFERENCES providers(id),
  status       text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'fulfilled', 'declined')),
  note         text CHECK (note IS NULL OR char_length(note) <= 500),         -- patient's note
  order_id     bigint REFERENCES orders(id),                                  -- set once the provider starts the order
  decline_note text CHECK (decline_note IS NULL OR char_length(decline_note) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX order_requests_provider_open_idx ON order_requests (provider_id) WHERE status = 'requested';
CREATE INDEX order_requests_patient_idx ON order_requests (patient_id, created_at DESC);

CREATE TABLE order_request_items (
  request_id            bigint NOT NULL REFERENCES order_requests(id) ON DELETE CASCADE,
  patient_supplement_id bigint NOT NULL REFERENCES patient_supplements(id),
  PRIMARY KEY (request_id, patient_supplement_id)
);
