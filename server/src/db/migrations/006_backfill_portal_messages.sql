-- 006_backfill_portal_messages.sql — orders sent before 005 existed have no portal message, so
-- the patient portal listed them as due with nothing to open. Write the message they would have
-- received. `link` is left NULL (no request origin in SQL); the portal falls back to the invoice's
-- checkout URL by order_id. Same copy as composeNotifications() in seams/notifier.ts.

INSERT INTO notifications (patient_id, order_id, channel, recipient, subject, body, link, created_at)
SELECT o.patient_id,
       o.id,
       'portal_message',
       NULL,
       'Supplement order #' || o.id || ' from ' || pr.name || ' — $' ||
         to_char(o.total_cents / 100.0, 'FM999999990.00') || ' due',
       pr.name || ' has put together a supplement order for you totalling $' ||
         to_char(o.total_cents / 100.0, 'FM999999990.00') ||
         '. Review the items and pay securely from this message.',
       NULL,
       COALESCE(o.sent_at, o.created_at)
FROM orders o
JOIN providers pr ON pr.id = o.provider_id
WHERE o.status IN ('awaiting_payment', 'paid')
  AND NOT EXISTS (
    SELECT 1 FROM notifications n WHERE n.order_id = o.id AND n.channel = 'portal_message'
  );
