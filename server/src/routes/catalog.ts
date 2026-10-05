// Catalog: the practice's supplement list with cost basis, default price and inventory.
// Inventory is informational (FR-008): providers set an absolute count; sales decrement it at
// payment time (DECISIONS #12) and it may go negative — flagged, not blocked.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, parse, requireProvider } from '../app.js';
import { notFound } from '../errors.js';

const inventoryBody = z.object({
  inventory_count: z.number().int().min(-1_000_000).max(1_000_000),
});

export interface SupplementRow {
  id: number;
  name: string;
  sku: string | null;
  unit_cogs_cents: number;
  default_price_cents: number;
  inventory_count: number;
}

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const { sql } = app.deps;

  app.get('/api/supplements', async (req) => {
    await requireProvider(req);
    const supplements = await sql<SupplementRow[]>`
      SELECT id, name, sku, unit_cogs_cents, default_price_cents, inventory_count
      FROM supplements ORDER BY name`;
    return { supplements };
  });

  app.patch<{ Params: { id: string } }>('/api/supplements/:id/inventory', async (req) => {
    await requireProvider(req);
    const id = idParam(req.params.id);
    const { inventory_count } = parse(inventoryBody, req.body);
    const [row] = await sql<SupplementRow[]>`
      UPDATE supplements SET inventory_count = ${inventory_count} WHERE id = ${id}
      RETURNING id, name, sku, unit_cogs_cents, default_price_cents, inventory_count`;
    if (!row) throw notFound('Supplement');
    return row;
  });
}
