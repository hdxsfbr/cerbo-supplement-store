// Patient portal (HDX-96): what the patient sees when they "sign in" — their secure messages and
// their supplement invoices. Capability token stands in for the portal session (identity seam).
// Stand-in for Cerbo's portal: Secure Messages + Patient Invoices.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, publicOrigin } from '../app.js';
import { notFound } from '../errors.js';
import { checkoutUrl } from '../orders/load.js';

const signInBody = z.object({ patient_id: z.number().int().positive() });

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  const { sql, identity } = app.deps;

  // POST /api/portal/session — demo sign-in: patient id → portal token (identity seam).
  app.post('/api/portal/session', async (req, reply) => {
    const body = parse(signInBody, req.body);
    const session = await identity.portalSignIn(body.patient_id);
    if (!session) throw notFound('Patient');
    reply.code(201);
    return {
      token: session.token,
      patient: session.identity.patient,
      provider: { name: session.identity.provider.name },
    };
  });

  app.get<{ Params: { token: string } }>('/api/portal/:token', async (req) => {
    const who = await identity.resolvePortal(req.params.token);
    if (!who) throw notFound('Portal link');
    const origin = publicOrigin(req);

    const messages = await sql<
      {
        id: number;
        order_id: number | null;
        channel: string;
        subject: string;
        body: string;
        link: string | null;
        created_at: string;
        read_at: string | null;
        order_status: string | null;
      }[]
    >`
      SELECT n.id, n.order_id, n.channel, n.subject, n.body, n.link, n.created_at, n.read_at,
             o.status AS order_status
      FROM notifications n LEFT JOIN orders o ON o.id = n.order_id
      WHERE n.patient_id = ${who.patient.id} AND n.channel = 'portal_message'
      ORDER BY n.created_at DESC, n.id DESC`;

    const orderRows = await sql<
      {
        id: number;
        status: string;
        total_cents: number;
        sent_at: string;
        paid_at: string | null;
        checkout_token: string;
        item_count: number;
        card_brand: string | null;
        card_last4: string | null;
      }[]
    >`
      SELECT o.id, o.status, o.total_cents, o.sent_at, o.paid_at, o.checkout_token,
             (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
             pay.card_brand, pay.card_last4
      FROM orders o LEFT JOIN payments pay ON pay.order_id = o.id
      WHERE o.patient_id = ${who.patient.id} AND o.status IN ('awaiting_payment', 'paid')
      ORDER BY o.sent_at DESC, o.id DESC`;
    const ids = orderRows.map((o) => o.id);
    const itemRows = ids.length
      ? await sql<
          {
            order_id: number;
            name: string;
            sku: string | null;
            quantity: number;
            unit_price_cents: number;
            sig: string | null;
          }[]
        >`
          SELECT oi.order_id, s.name, s.sku, oi.quantity, oi.unit_price_cents, oi.sig
          FROM order_items oi JOIN supplements s ON s.id = oi.supplement_id
          WHERE oi.order_id IN ${sql(ids)}
          ORDER BY oi.order_id, oi.id`
      : [];
    const invoices = orderRows.map(({ checkout_token, card_brand, card_last4, ...o }) => ({
      ...o,
      checkout_url: checkoutUrl(origin, checkout_token),
      card: card_brand && card_last4 ? { brand: card_brand, last4: card_last4 } : null,
      items: itemRows
        .filter((i) => i.order_id === o.id)
        .map(({ order_id: _o, ...i }) => ({
          ...i,
          line_total_cents: i.quantity * i.unit_price_cents,
        })),
    }));
    // The card most recently used to pay, as the portal's "payment method on file".
    const payment_method = invoices.find((i) => i.card)?.card ?? null;

    const balance_due_cents = invoices
      .filter((i) => i.status === 'awaiting_payment')
      .reduce((s, i) => s + i.total_cents, 0);

    return {
      patient: { id: who.patient.id, name: who.patient.name, email: who.patient.email },
      provider: { name: who.provider.name },
      messages,
      invoices,
      balance_due_cents,
      payment_method,
    };
  });
}
