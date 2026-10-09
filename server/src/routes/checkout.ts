// Patient checkout by capability token (identity seam) and the pay transaction (US2, T017).
//
// POST /pay is the money path. One database transaction does all of:
//   payment row  →  order status 'paid'  →  three ledger entries  →  inventory decrement
// and the deferred constraint trigger (002_integrity.sql §2) re-checks the whole split at
// COMMIT. If anything disagrees — sum, fee, COGS, payment amount — the transaction rolls back
// and nothing is recorded. Idempotency: the order row is locked FOR UPDATE, so a replay with
// the same key finds the existing payment and returns the original receipt; a different key
// on a paid order gets 409 already_paid (backed by payments.order_id UNIQUE even without the lock).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, publicOrigin } from '../app.js';
import { HttpError, notFound } from '../errors.js';
import { PaymentDeclinedError } from '../seams/payment.js';
import { computeSplit } from '../money/split.js';
import { loadOrder, patientOrderView, type LoadedOrder } from '../orders/load.js';
import type { Queryable } from '../db/client.js';
import type { LedgerEntryType } from '../types.js';

const payBody = z.object({
  idempotency_key: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'idempotency_key must be URL-safe'),
  // Optional so API-only callers keep working; the browser always sends it (HDX-97).
  payment_method: z
    .object({
      token: z.string().min(8).max(128),
      brand: z.string().min(1).max(20),
      last4: z.string().regex(/^\d{4}$/),
    })
    .optional(),
});

export interface PaymentRow {
  id: number;
  order_id: number;
  idempotency_key: string;
  amount_cents: number;
  status: string;
  gateway_ref: string | null;
  card_brand: string | null;
  card_last4: string | null;
  created_at: string;
}

const LEDGER_ORDER: LedgerEntryType[] = ['cogs', 'provider_margin', 'platform_fee'];

export async function loadPayment(sql: Queryable, orderId: number): Promise<PaymentRow | null> {
  const [row] = await sql<PaymentRow[]>`
    SELECT id, order_id, idempotency_key, amount_cents, status, gateway_ref, card_brand, card_last4, created_at
    FROM payments WHERE order_id = ${orderId}`;
  return row ?? null;
}

function receipt(loaded: LoadedOrder, payment: PaymentRow | null, origin: string) {
  const view = patientOrderView(loaded, origin);
  return payment
    ? {
        ...view,
        payment: {
          id: payment.id,
          idempotency_key: payment.idempotency_key,
          amount_cents: payment.amount_cents,
          gateway_ref: payment.gateway_ref,
          card_brand: payment.card_brand,
          card_last4: payment.card_last4,
          created_at: payment.created_at,
        },
      }
    : view;
}

export async function checkoutRoutes(app: FastifyInstance): Promise<void> {
  const { sql, gateway, identity } = app.deps;

  // The capability token → order/patient mapping goes through the identity seam, so swapping
  // in a portal session or signed link touches identity.ts only, not these routes.
  const resolveToken = async (token: string) => {
    const who = await identity.resolveCheckout(token);
    if (!who) throw notFound('Checkout link');
    return who;
  };

  // GET /api/checkout/:token — what the patient sees (items + prices; never COGS/margin)
  app.get<{ Params: { token: string } }>('/api/checkout/:token', async (req) => {
    const who = await resolveToken(req.params.token);
    const loaded = await loadOrder(sql, { id: who.orderId });
    if (!loaded) throw notFound('Checkout link');
    const payment = loaded.order.status === 'paid' ? await loadPayment(sql, loaded.order.id) : null;
    return receipt(loaded, payment, publicOrigin(req));
  });

  // POST /api/checkout/:token/pay — confirm the (simulated) payment; record the split
  app.post<{ Params: { token: string } }>('/api/checkout/:token/pay', async (req) => {
    const { idempotency_key, payment_method } = parse(payBody, req.body);
    const who = await resolveToken(req.params.token);

    const result = await sql.begin(async (tx) => {
      // Serialise concurrent pay attempts on this order.
      const [lock] = await tx<{ id: number; status: string; total_cents: number | null }[]>`
        SELECT id, status, total_cents FROM orders WHERE id = ${who.orderId} FOR UPDATE`;
      if (!lock) throw notFound('Checkout link');

      const existing = await loadPayment(tx, lock.id);
      if (existing) {
        if (existing.idempotency_key === idempotency_key) {
          return { replay: true as const, orderId: lock.id, payment: existing };
        }
        throw new HttpError(409, 'already_paid', 'Order has already been paid');
      }
      if (lock.status !== 'awaiting_payment' || lock.total_cents === null) {
        throw new HttpError(
          409,
          'order_not_payable',
          `Order is ${lock.status}, not awaiting payment`,
        );
      }

      const loaded = await loadOrder(tx, { id: lock.id });
      if (!loaded) throw notFound('Order');
      const split = computeSplit(
        loaded.items.map((i) => ({
          quantity: i.quantity,
          unitPriceCents: i.unit_price_cents,
          unitCogsCents: i.unit_cogs_cents,
        })),
      );
      // Belt: the frozen total must equal what the lines say. The DB trigger re-checks at commit.
      if (split.totalCents !== lock.total_cents) {
        throw new HttpError(500, 'split_invariant', 'frozen total does not match order lines');
      }

      // ── Payment seam. The fake auto-succeeds; a real gateway would be called here with the
      //    same idempotency key, and only a success reaches the writes below.
      let charge;
      try {
        charge = await gateway.charge({
          orderId: lock.id,
          amountCents: split.totalCents,
          idempotencyKey: idempotency_key,
          description: `Supplement order #${lock.id} for ${loaded.order.patient_name}`,
          paymentMethod: payment_method,
        });
      } catch (err) {
        // Nothing has been written yet; the transaction rolls back and the order stays payable.
        if (err instanceof PaymentDeclinedError) {
          throw new HttpError(402, 'payment_declined', err.message);
        }
        throw new HttpError(
          502,
          'payment_gateway_error',
          'Payment provider unavailable; try again',
        );
      }

      const [payment] = await tx<PaymentRow[]>`
        INSERT INTO payments (order_id, idempotency_key, amount_cents, status, gateway_ref, card_brand, card_last4)
        VALUES (${lock.id}, ${idempotency_key}, ${split.totalCents}, ${charge.status}, ${charge.gatewayRef},
                ${charge.cardBrand}, ${charge.cardLast4})
        RETURNING id, order_id, idempotency_key, amount_cents, status, gateway_ref, card_brand, card_last4, created_at`;
      if (!payment) throw new HttpError(500, 'internal_error', 'payment insert returned no row');

      await tx`UPDATE orders SET status = 'paid' WHERE id = ${lock.id} AND status = 'awaiting_payment'`;

      const amounts: Record<LedgerEntryType, number> = {
        cogs: split.cogsCents,
        provider_margin: split.marginCents,
        platform_fee: split.feeCents,
      };
      await tx`INSERT INTO ledger_entries ${tx(
        LEDGER_ORDER.map((entry_type) => ({
          order_id: lock.id,
          payment_id: payment.id,
          entry_type,
          amount_cents: amounts[entry_type],
          memo: split.memos[entry_type],
        })),
      )}`;

      // DECISIONS #12: stock moves when money moves. May go negative (flagged on the dashboard).
      await tx`
        UPDATE supplements s SET inventory_count = s.inventory_count - oi.quantity
        FROM order_items oi WHERE oi.order_id = ${lock.id} AND oi.supplement_id = s.id`;

      return { replay: false as const, orderId: lock.id, payment };
    });

    const loaded = await loadOrder(sql, { id: result.orderId });
    if (!loaded) throw notFound('Order');
    return receipt(loaded, result.payment, publicOrigin(req));
  });
}
