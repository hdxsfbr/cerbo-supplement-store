// ─── SEAM: payment gateway ─────────────────────────────────────────────────────────────────────
// WHAT IS FAKED: charging the patient. `FakePaymentGateway` always succeeds, instantly.
// WHERE THE SEAM IS: `PaymentGateway.charge`. The checkout route calls it, then — in ONE DB
//   transaction — records the payment row, flips the order to paid, and writes the ledger split.
// WHAT PRODUCTION WOULD DO: create + confirm a PaymentIntent (Stripe or similar) with the same
//   idempotency key, handle declines/3DS/webhooks, and store the processor's reference in
//   payments.gateway_ref. Nothing below the seam changes: the DB still refuses a second payment
//   for the same order (payments.order_id UNIQUE) and still asserts the split at commit, so a
//   buggy or malicious gateway implementation cannot corrupt the ledger. See DECISIONS.md, R4.

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
  charge(req: ChargeRequest): Promise<ChargeResult>;
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
