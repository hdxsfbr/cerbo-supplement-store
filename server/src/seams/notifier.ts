// ─── SEAM: notifications (email) ──────────────────────────────────────────────────────────────
// WHAT IS FAKED: emailing the patient their checkout link when a provider sends an order.
// WHERE THE SEAM IS: `Notifier.orderReadyForPayment`. The send route calls it and ALSO returns
//   the checkout URL in its response, so the UI can show the link the "email" would contain.
// WHAT PRODUCTION WOULD DO: send via the practice's transactional email provider (or push the
//   order into Cerbo's patient-portal queue, where supplement refills already surface today).
//   `NoopNotifier` just logs. See DECISIONS.md, R4.

export interface PaymentNotification {
  orderId: number;
  patient: { id: number; name: string; email: string | null };
  checkoutUrl: string;
}

export interface Notifier {
  orderReadyForPayment(n: PaymentNotification): Promise<void>;
}

export class NoopNotifier implements Notifier {
  constructor(private readonly log: (msg: string) => void = (m) => console.log(m)) {}

  async orderReadyForPayment(n: PaymentNotification): Promise<void> {
    this.log(
      `[notifier:noop] would email ${n.patient.email ?? '(no email)'} (${n.patient.name}) ` +
        `about order ${n.orderId}: ${n.checkoutUrl}`,
    );
  }
}
