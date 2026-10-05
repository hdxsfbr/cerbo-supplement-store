// Load an order with its lines and compute the split — shared by the provider routes (orders.ts)
// and the patient checkout routes (checkout.ts). The split is computed from the lines on every
// read; for paid orders the ledger (system of record) is guaranteed equal by the DB invariant.

import type { Queryable } from '../db/client.js';
import { PLATFORM_FEE_BPS, computeSplit, type Split } from '../money/split.js';
import type { OrderStatus } from '../types.js';

export interface OrderRow {
  id: number;
  provider_id: number;
  patient_id: number;
  status: OrderStatus;
  checkout_token: string;
  total_cents: number | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  patient_name: string;
  patient_email: string | null;
  provider_name: string;
}

export interface OrderItemRow {
  id: number;
  supplement_id: number;
  name: string;
  sku: string | null;
  quantity: number;
  unit_cogs_cents: number;
  unit_price_cents: number;
}

export interface LoadedOrder {
  order: OrderRow;
  items: OrderItemRow[];
  split: Split;
}

export async function loadOrder(
  sql: Queryable,
  where: { id: number; provider_id?: number } | { checkout_token: string },
): Promise<LoadedOrder | null> {
  const base = sql`
    SELECT o.id, o.provider_id, o.patient_id, o.status, o.checkout_token, o.total_cents,
           o.sent_at, o.paid_at, o.created_at,
           p.name AS patient_name, p.email AS patient_email, pr.name AS provider_name
    FROM orders o
    JOIN patients p ON p.id = o.patient_id
    JOIN providers pr ON pr.id = o.provider_id`;
  const [order] =
    'checkout_token' in where
      ? await sql<OrderRow[]>`${base} WHERE o.checkout_token = ${where.checkout_token}`
      : where.provider_id === undefined
        ? await sql<OrderRow[]>`${base} WHERE o.id = ${where.id}`
        : await sql<
            OrderRow[]
          >`${base} WHERE o.id = ${where.id} AND o.provider_id = ${where.provider_id}`;
  if (!order) return null;

  const items = await sql<OrderItemRow[]>`
    SELECT oi.id, oi.supplement_id, s.name, s.sku, oi.quantity, oi.unit_cogs_cents, oi.unit_price_cents
    FROM order_items oi JOIN supplements s ON s.id = oi.supplement_id
    WHERE oi.order_id = ${order.id}
    ORDER BY oi.id`;

  const split = computeSplit(
    items.map((i) => ({
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      unitCogsCents: i.unit_cogs_cents,
    })),
  );
  return { order, items, split };
}

export function checkoutUrl(publicWebOrigin: string, token: string): string {
  return `${publicWebOrigin.replace(/\/$/, '')}/pay/${token}`;
}

/** Provider-facing JSON shape: everything, including cost basis and margin. */
export function providerOrderView(loaded: LoadedOrder, publicWebOrigin: string) {
  const { order, items, split } = loaded;
  return {
    id: order.id,
    status: order.status,
    provider: { id: order.provider_id, name: order.provider_name },
    patient: { id: order.patient_id, name: order.patient_name, email: order.patient_email },
    items: items.map((i) => ({
      id: i.id,
      supplement_id: i.supplement_id,
      name: i.name,
      sku: i.sku,
      quantity: i.quantity,
      unit_cogs_cents: i.unit_cogs_cents,
      unit_price_cents: i.unit_price_cents,
      line_total_cents: i.quantity * i.unit_price_cents,
      line_cogs_cents: i.quantity * i.unit_cogs_cents,
      below_cogs: i.unit_price_cents < i.unit_cogs_cents,
    })),
    // Frozen once sent; while drafting it is the live sum of the lines.
    total_cents: order.total_cents ?? split.totalCents,
    split: {
      total_cents: split.totalCents,
      cogs_cents: split.cogsCents,
      fee_cents: split.feeCents,
      margin_cents: split.marginCents,
      fee_bps: PLATFORM_FEE_BPS,
      memos: split.memos,
    },
    checkout_url:
      order.status === 'draft' ? null : checkoutUrl(publicWebOrigin, order.checkout_token),
    sent_at: order.sent_at,
    paid_at: order.paid_at,
    created_at: order.created_at,
  };
}

/** Patient-facing JSON shape: items and prices only — no cost basis, no margin (DECISIONS #7). */
export function patientOrderView(loaded: LoadedOrder) {
  const { order, items, split } = loaded;
  return {
    id: order.id,
    status: order.status,
    paid: order.status === 'paid',
    provider: { name: order.provider_name },
    patient: { name: order.patient_name },
    items: items.map((i) => ({
      name: i.name,
      sku: i.sku,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
      line_total_cents: i.quantity * i.unit_price_cents,
    })),
    total_cents: order.total_cents ?? split.totalCents,
    sent_at: order.sent_at,
    paid_at: order.paid_at,
  };
}
