// Provider order routes: assemble (draft), replace lines, send (freeze + checkout link), list.
// Lifecycle, item locking and COGS snapshotting are enforced by the DB (002_integrity.sql);
// this file mostly translates HTTP ⇄ SQL and lets the SQLSTATE→HTTP map (errors.ts) speak.
// The ledger/audit route lands with US2 (T018).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, parse, publicOrigin, requireProvider } from '../app.js';
import { HttpError, notFound, orderLocked } from '../errors.js';
import { loadOrder, providerOrderView } from '../orders/load.js';
import type { Queryable } from '../db/client.js';
import { PLATFORM_FEE_BPS, exactFeeDecimal } from '../money/split.js';
import { loadPayment } from './checkout.js';

const createOrderBody = z.object({
  patient_id: z.number().int().positive(),
  /** Pre-fill lines from the patient's supplement list (chart tab → Create Order). */
  patient_supplement_ids: z.array(z.number().int().positive()).max(100).optional(),
  /** Start this order to fulfil a patient's request; its list items are the default lines. */
  request_id: z.number().int().positive().optional(),
});

const itemsBody = z.object({
  items: z
    .array(
      z.object({
        supplement_id: z.number().int().positive(),
        quantity: z.number().int().positive().max(1_000),
        unit_price_cents: z.number().int().min(0).max(100_000_000),
        sig: z.string().trim().max(500).nullable().optional(),
        patient_supplement_id: z.number().int().positive().nullable().optional(),
      }),
    )
    .max(100),
});

export interface NotificationRow {
  id: number;
  channel: 'portal_message' | 'email';
  recipient: string | null;
  subject: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export async function notificationsFor(
  sql: Queryable,
  orderId: number,
): Promise<NotificationRow[]> {
  return sql<NotificationRow[]>`
    SELECT id, channel, recipient, subject, body, link, created_at, read_at
    FROM notifications WHERE order_id = ${orderId} ORDER BY id`;
}

export async function ordersRoutes(app: FastifyInstance): Promise<void> {
  const { sql, notifier } = app.deps;

  const view = async (id: number, providerId: number, origin: string) => {
    const loaded = await loadOrder(sql, { id, provider_id: providerId });
    if (!loaded) throw notFound('Order');
    return providerOrderView(loaded, origin);
  };

  // POST /api/orders — create a draft for one of the provider's patients
  app.post('/api/orders', async (req, reply) => {
    const provider = await requireProvider(req);
    const body = parse(createOrderBody, req.body);
    const [patient] = await sql<{ id: number }[]>`
      SELECT id FROM patients WHERE id = ${body.patient_id} AND provider_id = ${provider.id}`;
    if (!patient) throw notFound('Patient');

    // Lines come from the patient's supplement list: explicitly chosen rows, or the rows of the
    // request being fulfilled. Prices start at the catalog default; the provider edits on the
    // order page before sending. Ad-hoc lines (PUT /items) remain possible.
    let listIds = body.patient_supplement_ids ?? [];
    let request: { id: number } | null = null;
    if (body.request_id !== undefined) {
      const [r] = await sql<{ id: number; item_ids: number[] }[]>`
        SELECT r.id, COALESCE(array_agg(ri.patient_supplement_id) FILTER (WHERE ri.request_id IS NOT NULL), '{}') AS item_ids
        FROM order_requests r LEFT JOIN order_request_items ri ON ri.request_id = r.id
        WHERE r.id = ${body.request_id} AND r.provider_id = ${provider.id}
          AND r.patient_id = ${patient.id} AND r.status = 'requested' AND r.order_id IS NULL
        GROUP BY r.id`;
      if (!r) throw notFound('Request');
      request = { id: r.id };
      if (listIds.length === 0) listIds = r.item_ids;
    }
    const lines =
      listIds.length === 0
        ? []
        : await sql<{ id: number; supplement_id: number; sig: string | null; price: number }[]>`
            SELECT ps.id, ps.supplement_id, ps.sig, s.default_price_cents AS price
            FROM patient_supplements ps JOIN supplements s ON s.id = ps.supplement_id
            WHERE ps.id IN ${sql(listIds)} AND ps.patient_id = ${patient.id} AND ps.status = 'active'
            ORDER BY ps.id`;
    if (lines.length !== new Set(listIds).size) {
      throw new HttpError(
        400,
        'validation_error',
        'patient_supplement_ids: not all on this patient’s active list',
      );
    }

    const created = await sql.begin(async (tx) => {
      const [o] = await tx<{ id: number }[]>`
        INSERT INTO orders (provider_id, patient_id) VALUES (${provider.id}, ${patient.id})
        RETURNING id`;
      if (!o) throw new HttpError(500, 'internal_error', 'order insert returned no row');
      if (lines.length > 0) {
        await tx`INSERT INTO order_items ${tx(
          lines.map((l) => ({
            order_id: o.id,
            supplement_id: l.supplement_id,
            quantity: 1,
            unit_price_cents: l.price,
            unit_cogs_cents: 0, // overwritten from the catalog by order_items_guard
            sig: l.sig,
            patient_supplement_id: l.id,
          })),
        )}`;
      }
      if (request) {
        await tx`UPDATE order_requests SET order_id = ${o.id} WHERE id = ${request.id}`;
      }
      return o;
    });
    return reply.status(201).send(await view(created.id, provider.id, publicOrigin(req)));
  });

  // PUT /api/orders/:id/items — replace the draft's lines (COGS snapshot taken by the DB)
  app.put<{ Params: { id: string } }>('/api/orders/:id/items', async (req) => {
    const provider = await requireProvider(req);
    const id = idParam(req.params.id);
    const body = parse(itemsBody, req.body);
    const ids = body.items.map((i) => i.supplement_id);
    if (new Set(ids).size !== ids.length) {
      throw new HttpError(400, 'validation_error', 'items: duplicate supplement_id');
    }

    const [owned] = await sql<{ id: number }[]>`
      SELECT id FROM orders WHERE id = ${id} AND provider_id = ${provider.id}`;
    if (!owned) throw notFound('Order');

    await sql.begin(async (tx) => {
      // Lock the order row so concurrent edits serialise; the item trigger re-checks status.
      await tx`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
      await tx`DELETE FROM order_items WHERE order_id = ${id}`; // CB003 if not draft
      if (body.items.length > 0) {
        // unit_cogs_cents is overwritten from the catalog by order_items_guard (DECISIONS #9);
        // a value is required by NOT NULL at parse time, so pass 0 as a placeholder.
        await tx`INSERT INTO order_items ${tx(
          body.items.map((i) => ({
            order_id: id,
            supplement_id: i.supplement_id,
            quantity: i.quantity,
            unit_price_cents: i.unit_price_cents,
            sig: i.sig ? i.sig : null,
            patient_supplement_id: i.patient_supplement_id ?? null,
            unit_cogs_cents: 0,
          })),
        )}`;
      }
    });
    return view(id, provider.id, publicOrigin(req));
  });

  // GET /api/orders/:id — order + lines + live split preview (+ what was sent to the patient)
  app.get<{ Params: { id: string } }>('/api/orders/:id', async (req) => {
    const provider = await requireProvider(req);
    const id = idParam(req.params.id);
    const result = await view(id, provider.id, publicOrigin(req));
    return { ...result, notifications: await notificationsFor(sql, id) };
  });

  // POST /api/orders/:id/send — draft → awaiting_payment; freezes total; issues checkout link
  app.post<{ Params: { id: string } }>('/api/orders/:id/send', async (req) => {
    const provider = await requireProvider(req);
    const id = idParam(req.params.id);
    const [owned] = await sql<{ id: number }[]>`
      SELECT id FROM orders WHERE id = ${id} AND provider_id = ${provider.id}`;
    if (!owned) throw notFound('Order');

    // The trigger derives and freezes total_cents and requires ≥1 item (CB004 → 422). The
    // status guard makes a repeat send a no-op at the DB, so we detect it and answer 409.
    const sent = await sql`
      UPDATE orders SET status = 'awaiting_payment' WHERE id = ${id} AND status = 'draft'`;
    if (sent.count === 0) throw orderLocked('Order has already been sent');
    // A request this order was started from is now fulfilled.
    await sql`
      UPDATE order_requests SET status = 'fulfilled', resolved_at = now()
      WHERE order_id = ${id} AND status = 'requested'`;

    const result = await view(id, provider.id, publicOrigin(req));

    // Notification is best-effort and happens AFTER the transition committed. The checkout link
    // is in this response regardless, so a notifier outage must not read as a failed send (the
    // transition cannot be retried — it already happened). A real adapter would enqueue into an
    // outbox table inside the send transaction and deliver asynchronously (HDX-89).
    let notified = true;
    try {
      await notifier.orderReadyForPayment({
        orderId: id,
        patient: result.patient,
        providerName: result.provider.name,
        amountCents: result.total_cents,
        checkoutUrl: result.checkout_url!,
        portalUrl: result.portal_url,
      });
    } catch (err) {
      notified = false;
      req.log.error({ err, orderId: id }, 'notifier failed after send; order is payable');
    }
    return { ...result, notified, notifications: await notificationsFor(sql, id) };
  });

  // GET /api/orders/:id/ledger — audit view of a paid order: every cent, straight from the ledger
  app.get<{ Params: { id: string } }>('/api/orders/:id/ledger', async (req) => {
    const provider = await requireProvider(req);
    const id = idParam(req.params.id);
    const loaded = await loadOrder(sql, { id, provider_id: provider.id });
    if (!loaded) throw notFound('Order');
    if (loaded.order.status !== 'paid' || loaded.order.total_cents === null) {
      throw new HttpError(409, 'order_not_paid', 'Ledger exists only for paid orders');
    }
    const payment = await loadPayment(sql, id);
    const entries = await sql<
      {
        id: number;
        entry_type: string;
        amount_cents: number;
        memo: string | null;
        created_at: string;
      }[]
    >`
      SELECT id, entry_type, amount_cents, memo, created_at
      FROM ledger_entries WHERE order_id = ${id}
      ORDER BY array_position(ARRAY['cogs','provider_margin','platform_fee'], entry_type)`;
    const total = loaded.order.total_cents;
    const feeEntry = entries.find((e) => e.entry_type === 'platform_fee');
    const view = providerOrderView(loaded, publicOrigin(req));
    return {
      order_id: id,
      status: loaded.order.status,
      patient: view.patient,
      provider: view.provider,
      total_cents: total,
      paid_at: loaded.order.paid_at,
      payment,
      entries,
      sum_cents: entries.reduce((s, e) => s + e.amount_cents, 0),
      fee_computation: {
        total_cents: total,
        fee_bps: PLATFORM_FEE_BPS,
        exact: exactFeeDecimal(total),
        rounding: 'half-up',
        fee_cents: feeEntry?.amount_cents ?? null,
      },
      items: view.items,
    };
  });

  // GET /api/orders — the acting provider's orders, newest first
  app.get('/api/orders', async (req) => {
    const provider = await requireProvider(req);
    const orders = await sql<
      {
        id: number;
        status: string;
        patient_id: number;
        patient_name: string;
        total_cents: number;
        item_count: number;
        created_at: string;
        sent_at: string | null;
        paid_at: string | null;
      }[]
    >`
      SELECT o.id, o.status, o.patient_id, p.name AS patient_name,
             COALESCE(o.total_cents, (SELECT COALESCE(SUM(quantity * unit_price_cents), 0)
                                      FROM order_items WHERE order_id = o.id))::bigint AS total_cents,
             (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count,
             o.created_at, o.sent_at, o.paid_at
      FROM orders o JOIN patients p ON p.id = o.patient_id
      WHERE o.provider_id = ${provider.id}
      ORDER BY o.created_at DESC, o.id DESC`;
    return { orders };
  });
}
