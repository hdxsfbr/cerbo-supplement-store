// ─── SEAM: payment gateway ─────────────────────────────────────────────────────────────────────
// WHAT IS FAKED: charging the patient. `FakePaymentGateway` always succeeds, instantly.
// WHERE THE SEAM IS: `PaymentGateway.charge`. The checkout route calls it, then — in ONE DB
//   transaction — records the payment row, flips the order to paid, and writes the ledger split.
// WHAT PRODUCTION WOULD DO: create + confirm a PaymentIntent (Stripe or similar) keyed by the
//   same idempotency key, handle declines/3DS/webhooks, and store the processor's reference in
//   payments.gateway_ref. The DB guarantees survive unchanged: one payment per order, split
//   asserted at commit — so a buggy gateway cannot corrupt the ledger.
//
// WHAT WOULD HAVE TO CHANGE in checkout.ts for a real processor (this is orchestration, not
//   the seam — see README → "The payment boundary"): the charge would move out from under the
//   row lock (no network calls inside a DB transaction), a `pending` payment row would be
//   written first so the order carries a durable processor identity, and `succeeded` would be
//   set from the processor's response or webhook. The shipped fake is synchronous and cannot
//   fail between "charged" and "recorded", so the simpler single-transaction shape is correct
//   *for the fake* and documented as such. See DECISIONS.md R4, HDX-88.

import { createHash } from 'node:crypto';
import type { Cents } from '../types.js';

export interface ChargeRequest {
  orderId: number;
  amountCents: Cents;
  /** Client-generated, stable per checkout session. Replays must be safe. */
  idempotencyKey: string;
  description: string;
}

export interface ChargeResult {
  status: 'succeeded';
  /** Opaque processor reference. Deterministic per idempotency key in the fake. */
  gatewayRef: string;
}

export interface PaymentGateway {
  /** Resolve on success; throw PaymentDeclinedError for a decline; throw anything else for an outage. */
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

/** The processor answered and said no (declined card, fraud block…). Mapped to 402 by the route. */
export class PaymentDeclinedError extends Error {
  constructor(
    message: string,
    public readonly declineCode: string = 'declined',
  ) {
    super(message);
    this.name = 'PaymentDeclinedError';
  }
}

export class FakePaymentGateway implements PaymentGateway {
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!Number.isSafeInteger(req.amountCents) || req.amountCents < 0) {
      throw new RangeError(`FakePaymentGateway: invalid amount ${req.amountCents}`);
    }
    // Same key → same reference, mimicking a processor honouring idempotency keys.
    const digest = createHash('sha256').update(req.idempotencyKey).digest('hex').slice(0, 24);
    return { status: 'succeeded', gatewayRef: `fake_pi_${digest}` };
  }
}
