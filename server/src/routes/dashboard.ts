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

export const LOW_STOCK_THRESHOLD = 25;

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

export interface InventoryRow {
  id: number;
  name: string;
  sku: string | null;
  unit_cogs_cents: number;
  default_price_cents: number;
  inventory_count: number;
  /** Units sold across the practice (all providers) — matches the shared stock count. */
  units_sold: number;
  /** Units sold by the acting provider — matches the money tiles' scope. */
  units_sold_mine: number;
}

/**
 * Stock is practice-wide (Cerbo holds the inventory), so `inventory_count` and `units_sold` are
 * NOT provider-scoped; `units_sold_mine` is, so the table can sit next to per-provider money
 * tiles without looking inconsistent.
 */
export async function dashboardInventory(
  q: Queryable,
  providerId: number,
): Promise<InventoryRow[]> {
  return q<InventoryRow[]>`
    SELECT s.id, s.name, s.sku, s.unit_cogs_cents, s.default_price_cents, s.inventory_count,
           COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                     WHERE oi.supplement_id = s.id AND o.status = 'paid'), 0)::int AS units_sold,
           COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                     WHERE oi.supplement_id = s.id AND o.status = 'paid' AND o.provider_id = ${providerId}), 0)::int AS units_sold_mine
    FROM supplements s ORDER BY s.name`;
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const { sql } = app.deps;

  app.get('/api/dashboard/summary', async (req) => {
    const provider = await requireProvider(req);

    const [totals, paid_orders, inventory] = await sql.begin(
      'isolation level repeatable read read only',
      async (tx) =>
        Promise.all([
          dashboardTotals(tx, provider.id),
          dashboardPaidOrders(tx, provider.id),
          dashboardInventory(tx, provider.id),
        ]),
    );

    return {
      provider: { id: provider.id, name: provider.name },
      ...totals,
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
