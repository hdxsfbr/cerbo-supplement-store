// Provider dashboard (US3, T022). Every money aggregate is a SUM over ledger_entries — the same
// rows the per-order audit shows — so the dashboard reconciles with the audits structurally
// (SC-004), not by a parallel computation that could drift.

import type { FastifyInstance } from 'fastify';
import { requireProvider } from '../app.js';

const LOW_STOCK_THRESHOLD = 25;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const { sql } = app.deps;

  app.get('/api/dashboard/summary', async (req) => {
    const provider = await requireProvider(req);

    const [totals] = await sql<
      {
        orders_paid: number;
        gross_cents: number;
        cogs_cents: number;
        margin_cents: number;
        fees_cents: number;
      }[]
    >`
      SELECT count(DISTINCT o.id)::int                                             AS orders_paid,
             COALESCE(SUM(l.amount_cents), 0)::bigint                               AS gross_cents,
             COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'cogs'), 0)::bigint            AS cogs_cents,
             COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'provider_margin'), 0)::bigint AS margin_cents,
             COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'platform_fee'), 0)::bigint    AS fees_cents
      FROM orders o
      JOIN ledger_entries l ON l.order_id = o.id
      WHERE o.provider_id = ${provider.id} AND o.status = 'paid'`;

    const paid_orders = await sql<
      {
        id: number;
        patient_name: string;
        paid_at: string;
        total_cents: number;
        cogs_cents: number;
        margin_cents: number;
        fee_cents: number;
      }[]
    >`
      SELECT o.id, p.name AS patient_name, o.paid_at, o.total_cents,
             COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'cogs'), 0)::bigint            AS cogs_cents,
             COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'provider_margin'), 0)::bigint AS margin_cents,
             COALESCE(SUM(l.amount_cents) FILTER (WHERE l.entry_type = 'platform_fee'), 0)::bigint    AS fee_cents
      FROM orders o
      JOIN patients p ON p.id = o.patient_id
      JOIN ledger_entries l ON l.order_id = o.id
      WHERE o.provider_id = ${provider.id} AND o.status = 'paid'
      GROUP BY o.id, p.name
      ORDER BY o.paid_at DESC, o.id DESC`;

    const inventory = await sql<
      {
        id: number;
        name: string;
        sku: string | null;
        unit_cogs_cents: number;
        default_price_cents: number;
        inventory_count: number;
        units_sold: number;
      }[]
    >`
      SELECT s.id, s.name, s.sku, s.unit_cogs_cents, s.default_price_cents, s.inventory_count,
             COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                       WHERE oi.supplement_id = s.id AND o.status = 'paid'), 0)::int AS units_sold
      FROM supplements s ORDER BY s.name`;

    return {
      provider: { id: provider.id, name: provider.name },
      ...totals!,
      paid_orders,
      inventory: inventory.map((s) => ({
        ...s,
        low: s.inventory_count >= 0 && s.inventory_count < LOW_STOCK_THRESHOLD,
        negative: s.inventory_count < 0,
      })),
      low_stock_threshold: LOW_STOCK_THRESHOLD,
    };
  });
}
