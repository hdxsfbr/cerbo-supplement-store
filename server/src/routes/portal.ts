// Patient portal (HDX-96): what the patient sees when they "sign in" — their secure messages and
// their supplement invoices. Capability token stands in for the portal session (identity seam).
// Stand-in for Cerbo's portal: Secure Messages + Patient Invoices.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, publicOrigin } from '../app.js';
import { HttpError, notFound } from '../errors.js';
import { checkoutUrl } from '../orders/load.js';
import { loadPatientSupplements, loadRequests, toPortalRequest } from '../supplements/list.js';

const signInBody = z.object({ patient_id: z.number().int().positive() });
const selfAddBody = z.object({
  supplement_id: z.number().int().positive(),
  sig: z.string().trim().max(500).nullable().optional(),
});
const requestBody = z.object({
  patient_supplement_ids: z.array(z.number().int().positive()).min(1).max(50),
  note: z.string().trim().max(500).nullable().optional(),
});

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

    const [supplements, requests, catalog] = await Promise.all([
      loadPatientSupplements(sql, who.patient.id, origin),
      loadRequests(sql, { patient_id: who.patient.id }),
      // Names only: the patient never sees COGS, margin, fee or even the default price here.
      sql<{ id: number; name: string; sku: string | null }[]>`
        SELECT id, name, sku FROM supplements ORDER BY name`,
    ]);

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
      supplements,
      requests: requests.map(toPortalRequest),
      catalog,
    };
  });

  // POST /api/portal/:token/supplements — patient adds a supplement they take (self-reported)
  app.post<{ Params: { token: string } }>('/api/portal/:token/supplements', async (req, reply) => {
    const who = await identity.resolvePortal(req.params.token);
    if (!who) throw notFound('Portal link');
    const body = parse(selfAddBody, req.body);
    const [sup] = await sql<
      { id: number }[]
    >`SELECT id FROM supplements WHERE id = ${body.supplement_id}`;
    if (!sup) throw notFound('Supplement');
    const [dup] = await sql<{ id: number }[]>`
      SELECT id FROM patient_supplements
      WHERE patient_id = ${who.patient.id} AND supplement_id = ${sup.id} AND status = 'active'`;
    if (dup) throw new HttpError(409, 'already_listed', 'This supplement is already on your list');
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO patient_supplements (patient_id, supplement_id, sig, added_by)
      VALUES (${who.patient.id}, ${sup.id}, ${body.sig ? body.sig : null}, 'patient') RETURNING id`;
    const rows = await loadPatientSupplements(sql, who.patient.id, publicOrigin(req));
    return reply.status(201).send(rows.find((r) => r.id === row!.id));
  });

  // POST /api/portal/:token/requests — ask the provider to order some list items. Not an order:
  // the provider prices and sends; the patient only ever sees the result as an invoice.
  app.post<{ Params: { token: string } }>('/api/portal/:token/requests', async (req, reply) => {
    const who = await identity.resolvePortal(req.params.token);
    if (!who) throw notFound('Portal link');
    const body = parse(requestBody, req.body);
    const ids = [...new Set(body.patient_supplement_ids)];
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM patient_supplements
      WHERE id IN ${sql(ids)} AND patient_id = ${who.patient.id} AND status = 'active'`;
    if (rows.length !== ids.length) {
      throw new HttpError(
        400,
        'validation_error',
        'patient_supplement_ids: not all on your active list',
      );
    }
    const [open] = await sql<{ id: number }[]>`
      SELECT r.id FROM order_requests r
      WHERE r.patient_id = ${who.patient.id} AND r.status = 'requested'
        AND EXISTS (SELECT 1 FROM order_request_items ri
                    WHERE ri.request_id = r.id AND ri.patient_supplement_id IN ${sql(ids)})`;
    if (open)
      throw new HttpError(
        409,
        'request_open',
        'One of these supplements is already in an open request',
      );
    const created = await sql.begin(async (tx) => {
      const [r] = await tx<{ id: number }[]>`
        INSERT INTO order_requests (patient_id, provider_id, note)
        VALUES (${who.patient.id}, ${who.provider.id}, ${body.note ? body.note : null}) RETURNING id`;
      await tx`INSERT INTO order_request_items ${tx(
        ids.map((psid) => ({ request_id: r!.id, patient_supplement_id: psid })),
      )}`;
      return r!;
    });
    const requests = await loadRequests(sql, { patient_id: who.patient.id });
    return reply.status(201).send(toPortalRequest(requests.find((x) => x.id === created.id)!));
  });
}
