// Provider dashboard (US3, T022). Every money aggregate is a SUM over ledger_entries — the same
// rows the per-order audit shows — so the dashboard reconciles with the audits structurally
// (SC-004), not by a parallel computation that could drift.
//
// The three reads run inside one REPEATABLE READ, READ ONLY transaction so they see a single
// snapshot: a payment committing between them cannot make the tiles disagree with the table
// (review finding HDX-86). READ COMMITTED would give each statement its own snapshot.

import type { FastifyInstance } from 'fastify';
import { requireProvider } from '../app.js';
import type { Queryable } from '../db/client.js';

export interface DashboardTotals {
  orders_paid: number;
  gross_cents: number;
  cogs_cents: number;
  margin_cents: number;
  fees_cents: number;
}

export async function dashboardTotals(q: Queryable, providerId: number): Promise<DashboardTotals> {
  const [row] = await q<DashboardTotals[]>`
    SELECT count(DISTINCT o.id)::int                                             AS orders_paid,
           COALESCE(SUM(l.amount_cents), 0)::bigint                               AS gross_cents,
           COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'cogs'), 0)::bigint            AS cogs_cents,
           COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'provider_margin'), 0)::bigint AS margin_cents,
           COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'platform_fee'), 0)::bigint    AS fees_cents
    FROM orders o
    JOIN ledger_entries l ON l.order_id = o.id
    WHERE o.provider_id = ${providerId} AND o.status = 'paid'`;
  return row!;
}

export interface PaidOrderRow {
  id: number;
  patient_name: string;
  paid_at: string;
  total_cents: number;
  cogs_cents: number;
  margin_cents: number;
  fee_cents: number;
}

export async function dashboardPaidOrders(
  q: Queryable,
  providerId: number,
): Promise<PaidOrderRow[]> {
  return q<PaidOrderRow[]>`
    SELECT o.id, p.name AS patient_name, o.paid_at, o.total_cents,
           COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'cogs'), 0)::bigint            AS cogs_cents,
           COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'provider_margin'), 0)::bigint AS margin_cents,
           COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'platform_fee'), 0)::bigint    AS fee_cents
    FROM orders o
    JOIN patients p ON p.id = o.patient_id
    JOIN ledger_entries l ON l.order_id = o.id
    WHERE o.provider_id = ${providerId} AND o.status = 'paid'
    GROUP BY o.id, p.name
    ORDER BY o.paid_at DESC, o.id DESC`;
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const { sql } = app.deps;

  app.get('/api/dashboard/summary', async (req) => {
    const provider = await requireProvider(req);

    const [totals, paid_orders] = await sql.begin(
      'isolation level repeatable read read only',
      async (tx) =>
        Promise.all([dashboardTotals(tx, provider.id), dashboardPaidOrders(tx, provider.id)]),
    );

    return {
      provider: { id: provider.id, name: provider.name },
      ...totals,
      paid_orders,
    };
  });
}
