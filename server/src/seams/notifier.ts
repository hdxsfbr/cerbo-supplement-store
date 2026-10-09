// ─── SEAM: notifications (patient portal + email) ──────────────────────────────────────────────
// WHAT IS FAKED: delivery. Cerbo's real channel for "you have a bill to pay" is a secure portal
//   message plus an email nudge (API: Secure Messages, Patient Emails). `PortalNotifier` writes
//   both as rows in `notifications`; the demo patient portal reads them back. Nothing is sent.
// WHERE THE SEAM IS: `Notifier.orderReadyForPayment`. The send route calls it AFTER the order
//   transition commits and treats failure as non-fatal (the checkout link is in the response).
// WHAT PRODUCTION WOULD DO: enqueue an outbox row inside the send transaction and deliver
//   asynchronously with retries through Cerbo's messaging + the practice's email provider.
//   `NoopNotifier` only logs (handy for API-only runs). See DECISIONS.md R4, HDX-89, HDX-96.

import type { Queryable } from '../db/client.js';

export interface PaymentNotification {
  orderId: number;
  patient: { id: number; name: string; email: string | null };
  providerName: string;
  amountCents: number;
  checkoutUrl: string;
  portalUrl: string;
}

export interface Notifier {
  orderReadyForPayment(n: PaymentNotification): Promise<void>;
}

export class NoopNotifier implements Notifier {
  constructor(private readonly log: (msg: string) => void = (m) => console.log(m)) {}

  async orderReadyForPayment(n: PaymentNotification): Promise<void> {
    this.log(
      `[notifier:noop] would message ${n.patient.name} (${n.patient.email ?? 'no email'}) ` +
        `about order ${n.orderId}: ${n.checkoutUrl}`,
    );
  }
}

function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Composes the two messages a patient would actually receive. Exported so tests can pin the copy. */
export function composeNotifications(n: PaymentNotification) {
  const amount = dollars(n.amountCents);
  const portal = {
    channel: 'portal_message' as const,
    recipient: null,
    subject: `Supplement order #${n.orderId} from ${n.providerName} — ${amount} due`,
    body:
      `${n.providerName} has put together a supplement order for you totalling ${amount}. ` +
      `Review the items and pay securely from this message.`,
    link: n.checkoutUrl,
  };
  const email = {
    channel: 'email' as const,
    recipient: n.patient.email,
    subject: `New message from ${n.providerName} in your patient portal`,
    body:
      `Hi ${n.patient.name.split(' ')[0]}, you have a new secure message and a ${amount} supplement ` +
      `order waiting in your patient portal. Sign in to review and pay.`,
    link: n.portalUrl,
  };
  return [portal, email];
}

/** Writes the portal message + email nudge to `notifications` (the demo's delivery channel). */
export class PortalNotifier implements Notifier {
  constructor(private readonly sql: Queryable) {}

  async orderReadyForPayment(n: PaymentNotification): Promise<void> {
    const rows = composeNotifications(n)
      .filter((m) => m.channel !== 'email' || m.recipient) // no address → no email, portal still goes
      .map((m) => ({ ...m, patient_id: n.patient.id, order_id: n.orderId }));
    await this.sql`INSERT INTO notifications ${this.sql(rows)}`;
  }
}
