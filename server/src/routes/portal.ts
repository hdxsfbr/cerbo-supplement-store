// Patient portal (HDX-96): what the patient sees when they "sign in" — their secure messages and
// their supplement invoices. Capability token stands in for the portal session (identity seam).
// Stand-in for Cerbo's portal: Secure Messages + Patient Invoices.

import type { FastifyInstance } from 'fastify';
import { publicOrigin } from '../app.js';
import { notFound } from '../errors.js';
import { checkoutUrl } from '../orders/load.js';

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  const { sql, identity } = app.deps;

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

    const invoices = (
      await sql<
        {
          id: number;
          status: string;
          total_cents: number;
          sent_at: string;
          paid_at: string | null;
          checkout_token: string;
          item_count: number;
        }[]
      >`
        SELECT o.id, o.status, o.total_cents, o.sent_at, o.paid_at, o.checkout_token,
               (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
        FROM orders o
        WHERE o.patient_id = ${who.patient.id} AND o.status IN ('awaiting_payment', 'paid')
        ORDER BY o.sent_at DESC, o.id DESC`
    ).map(({ checkout_token, ...o }) => ({
      ...o,
      checkout_url: checkoutUrl(origin, checkout_token),
    }));

    const balance_due_cents = invoices
      .filter((i) => i.status === 'awaiting_payment')
      .reduce((s, i) => s + i.total_cents, 0);

    return {
      patient: { id: who.patient.id, name: who.patient.name, email: who.patient.email },
      provider: { name: who.provider.name },
      messages,
      invoices,
      balance_due_cents,
    };
  });
}
